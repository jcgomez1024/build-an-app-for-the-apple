// After the tunnel restarts (new trycloudflare URL): point both Twilio numbers and the counter-phone TwiML App at it.
// Usage: node scripts/twilio-point-to-tunnel.mjs [https://xxxx.trycloudflare.com] [--dry]   (default: newest URL in /tmp/cf-tunnel.log)
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env.twilio", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const dry = process.argv.includes("--dry");
let base = process.argv.slice(2).find((a) => a.startsWith("https://"));
if (!base) base = (fs.readFileSync("/tmp/cf-tunnel.log", "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g) || []).pop();
if (!base) throw new Error("no tunnel URL found");
base = base.replace(/\/$/, "");
const sid = env.TWILIO_ACCOUNT_SID, auth = "Basic " + Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
const api = (u, body) => fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${u}`, { method: body ? "POST" : "GET", headers: { Authorization: auth, "content-type": "application/x-www-form-urlencoded" }, body: body && new URLSearchParams(body) }).then((r) => r.json());
const lines = String(env.TWILIO_LINES || "+14409011609,+14406642795").split(",").map((p) => p.split("=")[0].trim()).filter(Boolean);
console.log("tunnel:", base, dry ? "(dry run)" : "");
for (const n of lines) {
  const num = (await api(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(n)}`)).incoming_phone_numbers?.[0];
  if (!num) { console.log(n, "not found"); continue; }
  const want = `${base}/api/twilio/voice`;
  // fallback1: this script only ever sends VoiceUrl/VoiceMethod — the VoiceFallbackUrl (Twilio Function that rings the
  // desk, then backup voicemail; managed by scripts/twilio-fallback.mjs) is shown, never overwritten.
  const fb = String(num.voice_fallback_url || "");
  console.log(n, "fallback:", /\.twil\.io\/fallback$/.test(fb) ? `${fb} (desk ring → voicemail)` : fb ? `${fb.slice(0, 60)}… (old/other — run scripts/twilio-fallback.mjs)` : "NONE");
  if (num.voice_url === want) console.log(n, "ok", want);
  else if (dry) console.log(n, "would change", num.voice_url, "->", want);
  else console.log(n, "set", (await api(`/IncomingPhoneNumbers/${num.sid}.json`, { VoiceUrl: want, VoiceMethod: "POST" })).voice_url);
}
if (env.TWILIO_TWIML_APP_SID) {
  const app = await api(`/Applications/${env.TWILIO_TWIML_APP_SID}.json`), want = `${base}/api/twilio/agent`;
  if (app.voice_url === want) console.log("counter app ok", want);
  else if (dry) console.log("counter app would change", app.voice_url, "->", want);
  else console.log("counter app set", (await api(`/Applications/${env.TWILIO_TWIML_APP_SID}.json`, { VoiceUrl: want, VoiceMethod: "POST" })).voice_url);
}
