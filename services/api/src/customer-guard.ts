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
