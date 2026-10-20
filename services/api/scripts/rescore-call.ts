/** fix1036: re-run Elvi's shadow order for one recorded call from its stored turns; appends a new "recording" event
 *  (latest wins in loadCalls). Usage: npx tsx scripts/rescore-call.ts <CallSid> [--dry]. Local data only; no calls/SMS. */
import dotenv from "dotenv"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") }); dotenv.config({ path: path.join(root, ".env.twilio") });
const { shadowOrderFromTurns } = await import("../src/call-scoring.ts");
const { chatWithElvi } = await import("../src/elvi.ts");
const { getMenu, getFullMenu } = await import("../src/square.ts");
const { resolveTenant } = await import("../src/tenant.ts");
const sid = process.argv[2]; const dry = process.argv.includes("--dry");
const dir = path.join(root, "data/logs/calls");
let rec: any = null, file = "";
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) for (const l of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
  if (!l.trim()) continue; const e = JSON.parse(l); if (e.callSid === sid && e.event === "recording") { rec = e; file = f; }
}
if (!rec) { console.error("no recording event"); process.exit(1); }
const tenant = resolveTenant(undefined);
const cfg: any = { env: tenant.square.env, accessToken: tenant.square.accessToken, locationId: tenant.square.locationId, apiVersion: tenant.square.apiVersion, appPublicUrl: "http://localhost:4000", businessName: tenant.branding.displayName };
const menu = await getMenu(cfg); const resolverMenu = await getFullMenu(cfg).catch(() => menu);
const key = `rescore-${sid.slice(-12)}-${Date.now()}`;
const run = async (transcript: string, language: "es" | "en", history: any[]) => chatWithElvi({ transcript: transcript.slice(0, 1000), language, menu, history, resolverMenu, sessionKey: key } as any, { apiKey: tenant.xai.apiKey, baseUrl: tenant.xai.baseUrl, model: tenant.xai.model } as any);
const r: any = await shadowOrderFromTurns(rec.turns.map((t: any) => ({ ...t })), run as any);
for (const s of r.steps) if (s.source !== "staff") console.log(" ", s.source, "|", String(s.heard||"").slice(0,70), "=>", String(s.reply || "").slice(0, 90), s.actions || "");
console.log("fulfillment", r.fulfillment, "cart", r.cart.map((l: any) => `${l.quantity}×${l.itemId} ${(l.modifiers || []).map((m: any) => m.option).join("+")}`));
if (!dry) fs.appendFileSync(path.join(dir, file), JSON.stringify({ ...rec, ts: new Date().toISOString(), elviOrder: r, rescoredBy: "fix1036" }) + "\n");
