// fallback1: deploy the Twilio-side Voice FALLBACK (Twilio Functions service "elvi-fallback") and point both lines'
// VoiceFallbackUrl at it. The primary VoiceUrl (tunnel) is never touched here.
//   node scripts/twilio-fallback.mjs --dry     show current fallback config + what would change
//   node scripts/twilio-fallback.mjs           (re)deploy functions with TWILIO_FALLBACK_NUMBERS and set the fallback URLs
// List-driven: TWILIO_FALLBACK_NUMBERS in .env.twilio (comma list; add the Cricket eSIM later and re-run).
// Restore the old twimlet voicemail: node scripts/twilio-fallback.mjs --restore (uses data/twilio-fallback-urls.before-fallback1.json)
import fs from "node:fs";
const root = new URL("../", import.meta.url);
const env = Object.fromEntries(fs.readFileSync(new URL(".env.twilio", root), "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const dry = process.argv.includes("--dry"), restore = process.argv.includes("--restore");
const acct = env.TWILIO_ACCOUNT_SID, auth = "Basic " + Buffer.from(`${acct}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
const SV = "https://serverless.twilio.com/v1", UP = "https://serverless-upload.twilio.com/v1";
async function call(url, body, method) {
  const r = await fetch(url, { method: method || (body ? "POST" : "GET"), headers: { Authorization: auth, ...(body && !(body instanceof FormData) ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body: body instanceof FormData ? body : body && new URLSearchParams(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method || (body ? "POST" : "GET")} ${url.replace(/AC[0-9a-f]{32}/, "AC…")} → ${r.status} ${j.message || ""}`);
  return j;
}
const tw = (u, body) => call(`https://api.twilio.com/2010-04-01/Accounts/${acct}${u}`, body);
const lines = String(env.TWILIO_LINES || "+14409011609,+14406642795").split(",").map((p) => p.split("=")[0].trim()).filter(Boolean);
const deskNums = String(env.TWILIO_FALLBACK_NUMBERS || "").split(",").map((s) => s.trim()).filter(Boolean);
const FUNCS = ["fallback", "fallback-screen", "fallback-accept", "fallback-done"];

async function findService() { return (await call(`${SV}/Services?PageSize=50`)).services.find((s) => s.unique_name === "elvi-fallback"); }
async function fallbackUrl(svc) {
  if (!svc) return null;
  const e = (await call(`${SV}/Services/${svc.sid}/Environments`)).environments.find((x) => x.unique_name === "prod");
  return e ? { env: e, url: `https://${e.domain_name}/fallback` } : null;
}
async function numbers() {
  const out = [];
  for (const n of lines) out.push((await tw(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(n)}`)).incoming_phone_numbers?.[0]);
  return out.filter(Boolean);
}

if (restore) {
  const saved = JSON.parse(fs.readFileSync(new URL("data/twilio-fallback-urls.before-fallback1.json", root), "utf8"));
  for (const [n, v] of Object.entries(saved.numbers)) {
    if (dry) { console.log(n, "would restore old fallback"); continue; }
    await tw(`/IncomingPhoneNumbers/${v.sid}.json`, { VoiceFallbackUrl: v.voice_fallback_url, VoiceFallbackMethod: v.voice_fallback_method || "GET" });
    console.log(n, "fallback restored (old twimlet voicemail)");
  }
  process.exit(0);
}

let svc = await findService();
let fb = await fallbackUrl(svc);
console.log("desk numbers (TWILIO_FALLBACK_NUMBERS):", deskNums.join(", ") || "(none)", "| record:", env.TWILIO_FALLBACK_RECORD !== "0", dry ? "(dry run)" : "");
if (dry) {
  console.log("functions service:", svc ? `${svc.sid} ${fb?.url || "(no prod env)"}` : "not deployed");
  if (fb) {
    const vars = (await call(`${SV}/Services/${svc.sid}/Environments/${fb.env.sid}/Variables`)).variables;
    console.log("deployed vars:", vars.map((v) => `${v.key}=${v.value}`).join(" "));
  }
  for (const num of await numbers()) console.log(num.phone_number, "fallback", num.voice_fallback_url === fb?.url ? "ok" : "would change", (num.voice_fallback_url || "").slice(0, 90) + ((num.voice_fallback_url || "").length > 90 ? "…" : ""));
  process.exit(0);
}
if (!deskNums.length) throw new Error("TWILIO_FALLBACK_NUMBERS is empty");

if (!svc) svc = await call(`${SV}/Services`, { UniqueName: "elvi-fallback", FriendlyName: "Elvi voice fallback", IncludeCredentials: "false", UiEditable: "true" });
let envr = fb?.env || await call(`${SV}/Services/${svc.sid}/Environments`, { UniqueName: "prod", DomainSuffix: "prod" });
const existing = (await call(`${SV}/Services/${svc.sid}/Functions?PageSize=50`)).functions;
const versions = [];
for (const name of FUNCS) {
  const fn = existing.find((f) => f.friendly_name === name) || await call(`${SV}/Services/${svc.sid}/Functions`, { FriendlyName: name });
  const fd = new FormData();
  fd.append("Path", `/${name}`);
  fd.append("Visibility", "protected"); // Twilio-signed requests only
  fd.append("Content", new Blob([fs.readFileSync(new URL(`scripts/twilio-fallback/${name}.js`, root))], { type: "application/javascript" }), `${name}.js`);
  versions.push((await call(`${UP}/Services/${svc.sid}/Functions/${fn.sid}/Versions`, fd)).sid);
}
// closed1: closed-day clips as public assets (played tempo copy when present).
const assetVersions = [];
const existingAssets = (await call(`${SV}/Services/${svc.sid}/Assets?PageSize=50`)).assets;
// afterhours1: also every before/after-hours clip (closed-<lang>-<before|after>-<when>-<min>.mp3).
const closedNames = [...new Set(fs.readdirSync(new URL("data/phone-prompts/", root)).map((f) => f.replace(/\.mp3$/, ""))
  .filter((n) => /^closed-(es|en)(-(before|after)-[a-z]+-\d+)?$/.test(n)))].sort();
for (const name of closedNames) {
  const dir = new URL("data/phone-prompts/", root);
  const tempo = Number(env.PROMPT_TEMPO || "1"), suf = Math.abs(tempo - 1) < 0.005 ? "" : `-t${Math.round(tempo * 100)}`;
  const file = [new URL(`${name}${suf}.mp3`, dir), new URL(`${name}.mp3`, dir)].find((u) => fs.existsSync(u));
  if (!file) { console.log("asset missing:", name); continue; }
  const as = existingAssets.find((a) => a.friendly_name === name) || await call(`${SV}/Services/${svc.sid}/Assets`, { FriendlyName: name });
  const fd = new FormData();
  fd.append("Path", `/${name}.mp3`);
  fd.append("Visibility", "public");
  fd.append("Content", new Blob([fs.readFileSync(file)], { type: "audio/mpeg" }), `${name}.mp3`);
  assetVersions.push((await call(`${UP}/Services/${svc.sid}/Assets/${as.sid}/Versions`, fd)).sid);
}
const bp = new URLSearchParams(); versions.forEach((v) => bp.append("FunctionVersions", v)); assetVersions.forEach((v) => bp.append("AssetVersions", v));
bp.append("Dependencies", JSON.stringify([{ name: "twilio", version: "5.3.0" }]));
let build = await (await fetch(`${SV}/Services/${svc.sid}/Builds`, { method: "POST", headers: { Authorization: auth, "content-type": "application/x-www-form-urlencoded" }, body: bp })).json();
if (!build.sid) throw new Error("build failed: " + (build.message || ""));
for (let i = 0; i < 60 && !["completed", "failed"].includes(build.status); i++) { await new Promise((r) => setTimeout(r, 3000)); build = await call(`${SV}/Services/${svc.sid}/Builds/${build.sid}`); }
if (build.status !== "completed") throw new Error("build " + build.status);
// hours2: phone hours for the fallback, same rules as twilio.ts phoneHours(): data/phone-hours.json (real store hours,
// not the website's), close = store close - closeLeadMinutes (30) + TWILIO_CLOSE_GRACE_MIN (0). "wd=open-close;..." minutes ET.
function phoneHoursVar() {
  if (env.TWILIO_AFTERHOURS === "0") return "";
  const hm = (x) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(x || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  let cfg = null;
  try { cfg = env.TWILIO_PHONE_HOURS_JSON ? JSON.parse(env.TWILIO_PHONE_HOURS_JSON) : JSON.parse(fs.readFileSync(new URL("data/phone-hours.json", root), "utf8")); } catch { cfg = null; }
  if (!cfg?.hours) return "";
  const lead = Math.max(0, Number(cfg.closeLeadMinutes ?? 30) || 0), grace = Math.max(0, Number(env.TWILIO_CLOSE_GRACE_MIN ?? "0") || 0);
  const closed = String(env.TWILIO_CLOSED_DAYS || "1").split(",").map((x) => Number(x.trim()));
  return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((k, wd) => {
    const l = cfg.hours[k] || []; if (!l.length || closed.includes(wd)) return null;
    const o = Math.min(...l.map((w) => hm(w.open))), c = Math.max(...l.map((w) => hm(w.close)));
    return Number.isFinite(o) && Number.isFinite(c) ? `${wd}=${o}-${c - lead + grace}` : null;
  }).filter(Boolean).join(";");
}
const want = { DESK_NUMBERS: deskNums.join(","), RECORD: env.TWILIO_FALLBACK_RECORD === "0" ? "0" : "1", RING_TIMEOUT: env.TWILIO_FALLBACK_TIMEOUT || "25",
  PASS_CALLER_ID: env.TWILIO_PASS_CALLER_ID === "0" ? "0" : "1", PRESS1: env.TWILIO_PRESS1 === "0" ? "0" : "1", AUTO_TIMEOUT: env.TWILIO_RING_TIMEOUT_SEC || "18", CLOSED_ENABLED: env.TWILIO_CLOSED_ENABLED === "1" ? "1" : "0", CLOSED_DAYS: env.TWILIO_CLOSED_DAYS || "1", CLOSED_BYPASS: env.TWILIO_CLOSED_BYPASS || "", PHONE_HOURS: phoneHoursVar(), CALLER_ID_BLOCK: [...lines, ...String(env.TWILIO_NEVER_DIAL || "").split(",")].map((s) => s.trim()).filter(Boolean).join(",") };
const have = (await call(`${SV}/Services/${svc.sid}/Environments/${envr.sid}/Variables`)).variables;
for (const [Key, Value] of Object.entries(want)) {
  const v = have.find((x) => x.key === Key);
  if (!v) await call(`${SV}/Services/${svc.sid}/Environments/${envr.sid}/Variables`, { Key, Value });
  else if (v.value !== Value) await call(`${SV}/Services/${svc.sid}/Environments/${envr.sid}/Variables/${v.sid}`, { Value });
}
await call(`${SV}/Services/${svc.sid}/Environments/${envr.sid}/Deployments`, { BuildSid: build.sid });
envr = await call(`${SV}/Services/${svc.sid}/Environments/${envr.sid}`);
const url = `https://${envr.domain_name}/fallback`;
console.log("deployed", svc.sid, "build", build.sid, url, JSON.stringify(want));
for (const num of await numbers()) {
  if (num.voice_fallback_url === url && num.voice_fallback_method === "POST") { console.log(num.phone_number, "fallback ok", url); continue; }
  const r = await tw(`/IncomingPhoneNumbers/${num.sid}.json`, { VoiceFallbackUrl: url, VoiceFallbackMethod: "POST" });
  console.log(num.phone_number, "fallback set", r.voice_fallback_url, "| primary unchanged:", r.voice_url);
}
