// whsig1: Square webhook signature check. Square signs notificationUrl + rawBody with HMAC-SHA256 (base64) in
// x-square-hmacsha256-signature. Config (outside .env, e.g. .env.custapp): SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL.
import crypto from "node:crypto";
export type SigResult = "valid" | "invalid" | "unconfigured";
export function verifySquareSignature(rawBody: string | Buffer | undefined, signature: string | undefined, key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY, url = process.env.SQUARE_WEBHOOK_URL): SigResult {
  if (!key || !url) return "unconfigured";
  if (!rawBody || !signature) return "invalid";
  const want = crypto.createHmac("sha256", key).update(url + (typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"))).digest();
  let got: Buffer; try { got = Buffer.from(String(signature), "base64"); } catch { return "invalid"; }
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? "valid" : "invalid";
}
/** Act on a webhook? valid always; unconfigured only while checkout is sandbox (never live); invalid never. */
export const webhookTrusted = (r: SigResult, live: boolean) => r === "valid" || (r === "unconfigured" && !live);
