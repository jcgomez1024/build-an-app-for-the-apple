/** cris1: Nemotron (default) or xAI score — one backend pass. */
import dotenv from "dotenv"; import path from "node:path"; import { fileURLToPath } from "node:url";
import fs from "node:fs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });
import { resolveTenant } from "../src/tenant.ts";
import { getMenu, getFullMenu } from "../src/square.ts";
import { chatWithElvi } from "../src/elvi.ts";
import { shadowOrderFromTurns, kindOfItem } from "../src/call-scoring.ts";
import { applySharedAliases } from "../src/aliases.ts";
import { scoreOrder, elviLines } from "../src/call-accuracy.ts";
import { nameFromTranscriptInfo } from "../src/order-name.ts";

const tenant: any = resolveTenant(undefined);
const cfg: any = { env: tenant.square.env, accessToken: tenant.square.accessToken, locationId: tenant.square.locationId, apiVersion: tenant.square.apiVersion };
const menu = await getMenu(cfg);
const resolverMenu: any[] = await getFullMenu(cfg).catch(() => menu);
const b = process.env.REPLAY_BACKEND || "nvidia";
const backend = b === "nvidia"
  ? { apiKey: process.env.NVIDIA_API_KEY, baseUrl: "https://integrate.api.nvidia.com/v1", model: process.env.REPLAY_MODEL || process.env.NVIDIA_REPLAY_MODEL || "nvidia/nemotron-3-ultra-550b-a55b" }
  : { apiKey: tenant.xai.apiKey, baseUrl: tenant.xai.baseUrl, model: tenant.xai.model };

function loadTurns(sid: string, fallback: string) {
  for (const day of ["2026-10-24", "2026-10-25"]) {
    const f = path.join(root, `data/logs/calls/${day}.jsonl`);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.includes(sid) || !line.includes('"recording"')) continue;
      const o = JSON.parse(line);
      if (o.event === "recording" && o.turns?.length) return o.turns;
    }
  }
  if (fs.existsSync(fallback)) return JSON.parse(fs.readFileSync(fallback, "utf8"));
  return [];
}

const sid = "CAd25680c1fb7ac8342b931c428998b328";
const turns = loadTurns(sid, "/tmp/cris-turns.json");
const wantName = "Cris";
const truth = [
  { name: "Quesadilla", quantity: 2, choices: ["(QCO) Quesadilla Comal / Homemade", "Costilla / Beef Rib"] },
  { name: "Quesadilla", quantity: 2, choices: ["(QCO) Quesadilla Comal / Homemade", "Buche / Pork Stomach"] },
  { name: "Quesadilla", quantity: 1, choices: ["(QCO) Quesadilla Comal / Homemade", "Cabeza / Beef Head"] },
];
console.log("BACKEND", b, backend.model);
const nameInfo = nameFromTranscriptInfo(turns);
const key = `cris1-${b}-${Date.now()}`;
const run = (t: string, language: "es"|"en", history: any[]) =>
  chatWithElvi({ transcript: applySharedAliases(t, "phone").slice(0, 1000), language, menu, history, resolverMenu, sessionKey: key } as any, backend as any);
const r: any = await shadowOrderFromTurns(turns.map((t: any) => ({ ...t })), run as any);
const elines = elviLines(r.cart || [], resolverMenu as any);
const scored = scoreOrder(elines as any, truth as any);
console.log("NAME", nameInfo, "want", wantName);
console.log("LINES:", elines.map((l: any) => `${l.quantity}× ${l.name} [${(l.choices||[]).join("; ")}]`));
console.log("CART:", (r.cart || []).map((l: any) => `${l.quantity}×${l.itemId} ${(l.modifiers||[]).map((m:any)=>m.option).join("+")}`));
console.log("SCORE:", scored.score, "misses:", JSON.stringify(scored.misses));
const qds = (r.cart || []).filter((l: any) => /quesadilla/i.test(String(l.itemId)) && !/dorada/i.test(String(l.itemId)));
const qtyOf = (meat: string) => qds.filter((l: any) => (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option))))
  .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
const nameOk = nameInfo?.name === wantName;
const cartOk = qtyOf("costilla") === 2 && qtyOf("buche") === 2 && qtyOf("cabeza") === 1;
console.log("PASS nameOk", nameOk, "cartOk", cartOk, "costilla", qtyOf("costilla"), "buche", qtyOf("buche"), "cabeza", qtyOf("cabeza"));
