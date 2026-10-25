/** oscar2 — REPLAY_BACKEND=nvidia|xai score vs Auditor/Square truth */
import dotenv from "dotenv"; import path from "node:path"; import { fileURLToPath } from "node:url";
import fs from "node:fs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });
import { resolveTenant } from "../src/tenant.ts";
import { getMenu, getFullMenu } from "../src/square.ts";
import { chatWithElvi } from "../src/elvi.ts";
import { shadowOrderFromTurns } from "../src/call-scoring.ts";
import { applySharedAliases } from "../src/aliases.ts";
import { scoreOrder, elviLines, ticketLines } from "../src/call-accuracy.ts";
import { nameFromTranscriptInfo } from "../src/order-name.ts";

const tenant: any = resolveTenant(undefined);
const cfg: any = { env: tenant.square.env, accessToken: tenant.square.accessToken, locationId: tenant.square.locationId, apiVersion: tenant.square.apiVersion };
const menu = await getMenu(cfg);
const resolverMenu: any[] = await getFullMenu(cfg).catch(() => menu);
const b = process.env.REPLAY_BACKEND || "nvidia";
const backend = b === "nvidia"
  ? { apiKey: process.env.NVIDIA_API_KEY, baseUrl: "https://integrate.api.nvidia.com/v1", model: process.env.NVIDIA_REPLAY_MODEL || "nvidia/nemotron-3-ultra-550b-a55b" }
  : { apiKey: tenant.xai.apiKey, baseUrl: tenant.xai.baseUrl, model: tenant.xai.model };

async function fetchOrder(orderId: string) {
  const base = cfg.env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
  const res = await fetch(`${base}/v2/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Square-Version": cfg.apiVersion || "2024-01-18" },
  });
  if (!res.ok) return null;
  const j: any = await res.json();
  return j.order || null;
}

function loadTurns(sid: string) {
  for (const day of ["2026-10-24", "2026-10-25"]) {
    const f = path.join(root, `data/logs/calls/${day}.jsonl`);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.includes(sid) || !line.includes('"recording"')) continue;
      const o = JSON.parse(line);
      if (o.event === "recording" && o.callSid === sid && o.turns?.length) return o.turns;
    }
  }
  return [];
}

const mq = (lines: any[], re: RegExp) => lines.filter((l) => (l.modifiers || []).some((m: any) => re.test(String(m.option))))
  .reduce((n, l) => n + (Number(l.quantity) || 1), 0);

const sid = "CA62868055ddcda9d75fdb618f10071e2e";
const orderId = "xdIPa3WYo6RmMkI7lJQLC8N8tZOZY";
const turns = loadTurns(sid);
console.log("BACKEND", b, backend.model, "turns", turns.length);
let ticketTruth: any[] = [
  { name: "Taco", quantity: 1, choices: ["(TCO) Tortilla Comal / Homemade", "Cabeza / Beef Head"] },
  { name: "Taco", quantity: 1, choices: ["(TCO) Tortilla Comal / Homemade", "Lengua / Beef Tongue"] },
  { name: "Taco", quantity: 1, choices: ["(TCO) Tortilla Comal / Homemade", "Tripa / Beef Tripe"] },
  { name: "Taco", quantity: 1, choices: ["(TCO) Tortilla Comal / Homemade", "Costilla / Beef Rib"] },
];
const ord = await fetchOrder(orderId);
if (ord) {
  ticketTruth = ticketLines(ord) as any[];
  console.log("TICKET:", ticketTruth.map((l: any) => `${l.quantity}× ${l.name} [${(l.choices || []).slice(0, 5).join("; ")}]`));
}
const info = nameFromTranscriptInfo(turns);
const key = `oscar2-${b}-${Date.now()}`;
const run = (t: string, language: "es"|"en", history: any[]) =>
  chatWithElvi({ transcript: applySharedAliases(t, "phone").slice(0, 1000), language, menu, history, resolverMenu, sessionKey: key } as any, backend as any);
const r: any = await shadowOrderFromTurns(turns, run as any);
const elines = elviLines(r.cart || [], resolverMenu as any);
const scored = scoreOrder(elines as any, ticketTruth as any);
const tacos = (r.cart || []).filter((l: any) => /taco/i.test(String(l.itemId)));
const fields = {
  name: info?.name,
  cabeza: mq(tacos, /cabeza/i),
  lengua: mq(tacos, /lengua/i),
  tripa: mq(tacos, /tripa/i),
  costilla: mq(tacos, /costilla/i),
  allTco: tacos.every((l: any) => (l.modifiers || []).some((m: any) => /TCO|comal|homemade/i.test(String(m.option)))),
  tacoLines: tacos.length,
  cartLen: (r.cart || []).length,
};
const ok = info?.name === "Oscar"
  && fields.cabeza === 1 && fields.lengua === 1 && fields.tripa === 1 && fields.costilla === 1
  && fields.allTco && fields.tacoLines === 4 && fields.cartLen === 4;

console.log("\n======== Oscar2", b);
console.log("NAME", info);
console.log("LINES:", elines.map((l: any) => `${l.quantity}× ${l.name} [${(l.choices || []).slice(0, 5).join("; ")}]`));
for (const l of r.cart || []) console.log(JSON.stringify({ id: l.itemId, q: l.quantity, mods: (l.modifiers||[]).map((m:any)=>m.option).slice(0,6) }));
console.log("SCORE", scored.score, "misses", JSON.stringify(scored.misses).slice(0, 400));
console.log("CHECK", ok, fields);
if (!ok) process.exitCode = 1;
