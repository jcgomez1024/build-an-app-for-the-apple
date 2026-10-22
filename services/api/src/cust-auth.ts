// cust1: customer phone login for order.cocinaelvis.app. Code delivery is pluggable (Twilio Verify today; our own 10DLC
// 2FA campaign or email later). Square customer lookup is READ-ONLY. Never reveals whether a phone has a profile before
// the code is verified: start() always answers the same way.
import crypto from "node:crypto";
import { hitLimit } from "./customer-guard.js";

export interface CodeSender {
  name: string;
  send(phoneE164: string, opts: { locale: "es" | "en"; channel: "sms" | "email"; email?: string }): Promise<{ ok: boolean; error?: string }>;
  check(phoneE164: string, code: string): Promise<boolean>;
}

/** Twilio Verify (≈5¢ per verification). Fraud Guard is on by default for SMS on Verify services. */
export function twilioVerifySender(env = process.env, fetcher: typeof fetch = fetch): CodeSender {
  const sid = env.TWILIO_VERIFY_SERVICE_SID || "", acct = env.TWILIO_ACCOUNT_SID || "", tok = env.TWILIO_AUTH_TOKEN || "";
  const auth = "Basic " + Buffer.from(`${acct}:${tok}`).toString("base64");
  const post = async (p: string, body: Record<string, string>) => {
    const r = await fetcher(`https://verify.twilio.com/v2/Services/${sid}/${p}`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    return { ok: r.ok, j: await r.json().catch(() => ({})) as any };
  };
  return {
    name: "twilio-verify",
    async send(to, { locale, channel, email }) {
      if (!sid || !acct || !tok) return { ok: false, error: "verify not configured" };
      const r = await post("Verifications", { To: channel === "email" && email ? email : to, Channel: channel, Locale: locale });
      return r.ok ? { ok: true } : { ok: false, error: String(r.j?.message || "send failed") };
    },
    async check(to, code) { if (!sid) return false; const r = await post("VerificationCheck", { To: to, Code: code }); return r.ok && r.j?.status === "approved"; },
  };
}
/** Email fallback: stubbed and OFF (CUST_EMAIL_FALLBACK=1 would enable once a sender exists). */
export const emailSenderStub: CodeSender = { name: "email-stub", async send() { return { ok: false, error: "email fallback off" }; }, async check() { return false; } };

export const toE164 = (raw: unknown) => { const d = String(raw || "").replace(/\D/g, ""); const t = d.length === 11 && d[0] === "1" ? d.slice(1) : d; return /^[2-9]\d{9}$/.test(t) ? `+1${t}` : null; };

/** abuse limits — per phone 3/10 min + 5/day, per IP 10/hour, global 60/hour; code checks 5 per phone per 10 min + 20/IP/hour */
export const LIMITS = { phone10m: 3, phoneDay: 5, ipHour: 10, globalHour: Number(process.env.CUST_VERIFY_GLOBAL_PER_HOUR || 60), checkPhone10m: 5, checkIpHour: 20 };
export function sendAllowed(phone: string, ip: string): { ok: boolean; retryAfterSec?: number } {
  for (const [n, k, max, ms] of [["cv-p10", phone, LIMITS.phone10m, 600_000], ["cv-pday", phone, LIMITS.phoneDay, 86_400_000], ["cv-ip", ip, LIMITS.ipHour, 3_600_000], ["cv-all", "all", LIMITS.globalHour, 3_600_000]] as const) {
    const h = hitLimit(n, k, max, ms); if (h.limited) return { ok: false, retryAfterSec: h.retryAfterSec }; }
  return { ok: true };
}
export function checkAllowed(phone: string, ip: string) {
  const a = hitLimit("cc-p", phone, LIMITS.checkPhone10m, 600_000); if (a.limited) return { ok: false, retryAfterSec: a.retryAfterSec };
  const b = hitLimit("cc-ip", ip, LIMITS.checkIpHour, 3_600_000); return b.limited ? { ok: false, retryAfterSec: b.retryAfterSec } : { ok: true };
}

/** signed session cookie (HMAC-SHA256), 30 days, httpOnly. Payload: phone (E.164), Square customer id or null, first name. */
export type CustSession = { p: string; cid: string | null; fn: string | null; em: string | null; exp: number };
export const COOKIE = "elvi_cust", MAX_AGE_S = 30 * 86400;
const secret = () => { const s = process.env.CUST_SESSION_SECRET || ""; if (s.length < 32) throw new Error("CUST_SESSION_SECRET missing"); return s; };
const b64u = (b: Buffer) => b.toString("base64url");
export function signSession(s: Omit<CustSession, "exp">, now = Date.now()): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...s, exp: now + MAX_AGE_S * 1000 })));
  return `${body}.${b64u(crypto.createHmac("sha256", secret()).update(body).digest())}`;
}
export function readSession(cookieHeader: string | undefined, now = Date.now()): CustSession | null {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(String(cookieHeader || "")); if (!m) return null;
  const [body, sig] = decodeURIComponent(m[1]).split("."); if (!body || !sig) return null;
  let want: Buffer; try { want = crypto.createHmac("sha256", secret()).update(body).digest(); } catch { return null; }
  const got = Buffer.from(sig, "base64url"); if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try { const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); return s.exp > now ? s : null; } catch { return null; }
}
export const cookieHeader = (v: string, secure = true) => `${COOKIE}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? "; Secure" : ""}`;
export const clearCookie = (secure = true) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

/** Square customer by phone (READ-ONLY Customers Search). Injected so tests use a mock. */
export type CustomerLookup = (phoneE164: string) => Promise<{ id: string; givenName: string | null; email: string | null } | null>;
