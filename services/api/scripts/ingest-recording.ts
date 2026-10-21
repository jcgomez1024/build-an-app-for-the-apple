/** rec1: ingest a Twilio recording whose status callback was lost (e.g. it arrived during a server restart).
 *  Usage: npx tsx scripts/ingest-recording.ts <CallSid> [callerChannel=1]. Read-only Twilio REST (list + download);
 *  writes the wav to data/calls and appends a normal "recording" event (latest wins). No calls/SMS. */
import dotenv from "dotenv"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") }); dotenv.config({ path: path.join(root, ".env.twilio"), override: true });
const sid = process.argv[2]; const callerChannel = (Number(process.argv[3]) === 2 ? 2 : 1) as 1 | 2;
if (!/^CA[0-9a-f]{32}$/.test(sid || "")) { console.error("usage: <CallSid>"); process.exit(1); }
const A = process.env.TWILIO_ACCOUNT_SID!, auth = "Basic " + Buffer.from(`${A}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
const { scoreRecording } = await import("../src/twilio.ts");
const { chatWithElvi } = await import("../src/elvi.ts");
const { nameFromTranscript } = await import("../src/order-name.ts");
const { getMenu, getFullMenu } = await import("../src/square.ts");
const { resolveTenant } = await import("../src/tenant.ts");
const recs: any = await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${A}/Recordings.json?CallSid=${sid}`, { headers: { Authorization: auth } })).json();
const rec = (recs.recordings || []).find((r: any) => r.status === "completed"); if (!rec) { console.error("no completed recording in Twilio"); process.exit(1); }
const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${A}/Recordings/${rec.sid}.wav?RequestedChannels=2`, { headers: { Authorization: auth } });
if (!r.ok) { console.error("download", r.status); process.exit(1); }
const buf = Buffer.from(await r.arrayBuffer());
const file = path.join(root, "data/calls", `${rec.sid}.wav`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf);
const day = new Date(rec.start_time || Date.now()).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const logFile = path.join(root, "data/logs/calls", `${day}.jsonl`);
const ev = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.callSid === sid);
const caller = ev.find((e) => e.caller)?.caller || "";
const tenant = resolveTenant(undefined);
const cfg: any = { env: tenant.square.env, accessToken: tenant.square.accessToken, locationId: tenant.square.locationId, apiVersion: tenant.square.apiVersion, appPublicUrl: "http://localhost:4000", businessName: tenant.branding.displayName };
const menu = await getMenu(cfg); const resolverMenu = await getFullMenu(cfg).catch(() => menu);
const shadow = (key: string) => (t: string, language: "es" | "en", history: any[]) => chatWithElvi({ transcript: t.slice(0, 1000), language, menu, history, resolverMenu, sessionKey: key } as any, { apiKey: tenant.xai.apiKey, baseUrl: tenant.xai.baseUrl, model: tenant.xai.model } as any);
const result: any = await scoreRecording(buf, `call-${sid.slice(-40)}`, shadow as any, { callerChannel });
const name = nameFromTranscript(result.turns) || ev.find((e) => e.name)?.name || null;
fs.appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), event: "recording", callSid: sid, caller, name, greetingLanguage: ev.find((e) => e.event === "language")?.language, recordingSid: rec.sid, durationSec: rec.duration,
  file: path.relative(root, file), segments: 1, callerChannel, lines: [], ticketPhase: "final", turns: result.turns, transcript: result.transcript, elviOrder: result.elviOrder, source: "ingest-recording" }) + "\n");
console.log(`ingested ${rec.sid.slice(-6)} ${rec.duration}s, ${result.turns.length} turns, name ${name ? "found" : "none"}`);
process.exit(0);
