// custapp1: safety rails for the customer voice/touch ordering app.
// - per-IP rate limits (in-memory, fixed window)
// - checkout launch gate: live Square checkout only when CUSTOMER_CHECKOUT_LIVE=1;
//   otherwise Square SANDBOX (if sandbox creds are set) or checkout disabled.
import type { Request, Response, NextFunction } from "express";

export function clientIp(req: { headers: Record<string, any>; socket?: { remoteAddress?: string } }) {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return String(cf);
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

const buckets = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000).unref();

export function hitLimit(name: string, ip: string, max: number, windowMs: number) {
  const key = `${name}:${ip}`;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
  b.count += 1;
  return { limited: b.count > max, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

export function rateLimit(name: string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.RATE_LIMITS_OFF === "1") return next();
    const r = hitLimit(name, clientIp(req), max, windowMs);
    if (!r.limited) return next();
    res.setHeader("Retry-After", String(r.retryAfterSec));
    res.status(429).json({ error: "Too many requests, please wait a moment and try again." });
  };
}

export const VOICE_SESSION_MAX_MS = Number(process.env.VOICE_SESSION_MAX_MS || 10 * 60_000);

export function checkoutLive() {
  return process.env.CUSTOMER_CHECKOUT_LIVE === "1";
}

type SqCfg = { env: "sandbox" | "production"; accessToken?: string; locationId?: string };

/** Returns the Square config checkout may use, or null when checkout is closed. Never returns production unless CUSTOMER_CHECKOUT_LIVE=1. */
export function gatedCheckoutConfig(tenantCfg: SqCfg): SqCfg | null {
  if (checkoutLive()) return tenantCfg;
  const accessToken = process.env.SQUARE_SANDBOX_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_SANDBOX_LOCATION_ID;
  if (accessToken && locationId) return { env: "sandbox", accessToken, locationId };
  return null;
}

export const CHECKOUT_CLOSED_MESSAGE =
  "Online checkout through Elvi isn't open yet. Please order at cocinaelvis.com or call us.";

// ---- order1: host-based public access + password gate for order.cocinaelvis.app ----
import crypto from "node:crypto";

export const ORDER_HOST = process.env.ORDER_PUBLIC_HOST || "order.cocinaelvis.app";
export const PHONE_HOST = process.env.PHONE_PUBLIC_HOST || "elvi.cocinaelvis.app";
const COOKIE = "elvi_preview";
const COOKIE_DAYS = 30;

/** "local" (this Mac), "phone" (elvi host via tunnel), "order" (order host via tunnel) or "none". */
export function accessZone(req: { headers: Record<string, any> }): "local" | "phone" | "order" | "none" {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const tunneled = !!(req.headers["cf-connecting-ip"] || req.headers["cf-ray"] || req.headers["x-forwarded-for"]);
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);
  if (!tunneled && localHost) return "local";
  if (host === PHONE_HOST) return "phone";
  if (host === ORDER_HOST) return "order";
  return "none";
}

function cookieSecret() {
  const pw = process.env.ORDER_PREVIEW_PASSWORD || "";
  return pw ? crypto.createHash("sha256").update(`elvi-order-preview:${pw}`).digest() : null;
}
function sign(payload: string, key: Buffer) {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}
export function makePreviewCookie() {
  const key = cookieSecret();
  if (!key) return null;
  const exp = String(Date.now() + COOKIE_DAYS * 86400_000);
  return `${COOKIE}=${exp}.${sign(exp, key)}; Max-Age=${COOKIE_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
export function previewCookieOk(req: { headers: Record<string, any> }) {
  const key = cookieSecret();
  if (!key) return false;
  const raw = String(req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = sign(exp, key);
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
export function passwordOk(given: string) {
  const pw = process.env.ORDER_PREVIEW_PASSWORD || "";
  if (!pw) return false;
  const a = crypto.createHash("sha256").update(given.trim().toLowerCase()).digest();
  const b = crypto.createHash("sha256").update(pw.toLowerCase()).digest();
  return crypto.timingSafeEqual(a, b);
}

// Staff/phone routes never served on the order host.
export const ORDER_DENY = /^\/(api\/twilio\/|api\/phone\/|api\/calls(\/|$)|api\/square\/webhooks|calls\.html|phone\.html|web\.backup)/i;
// Phone host (unchanged from lockdown1).
export const PHONE_OK = /^\/(health\/?$|phone\.html$|vendor\/twilio-voice\.min\.js$|img\/logo-cocina-elvis\.png$|favicon\.ico$|api\/twilio\/|api\/phone\/)/;

export function loginPage(error = "") {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Elvi · Cocina Elvis (preview)</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;background:#1b1210;color:#fff}
form{width:min(92vw,360px);background:#2a1d19;padding:28px;border-radius:18px;box-shadow:0 10px 30px #0006}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 18px;color:#d9c9c3;font-size:15px}
input,button{width:100%;box-sizing:border-box;font-size:18px;padding:14px;border-radius:12px;border:0}
input{margin-bottom:12px}button{background:#e4572e;color:#fff;font-weight:600}.e{color:#ff8a80;margin-bottom:12px}</style></head>
<body><form method="post" action="/preview-login"><h1>Elvi 🌮 Cocina Elvis</h1><p>Vista previa privada · Private preview</p>
${error ? `<div class="e">${error}</div>` : ""}<input type="password" name="password" placeholder="Contraseña / Password" autocomplete="current-password" autofocus required>
<button type="submit">Entrar</button></form></body></html>`;
}
