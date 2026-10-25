/** teresa1 — REPLAY_BACKEND=nvidia|xai score vs Auditor truth */
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

const mq = (lines: any[], kind: RegExp, meat: RegExp) =>
  lines.filter((l) => kind.test(String(l.itemId || l.name || "")) && (l.modifiers || l.choices || []).some((m: any) => meat.test(String(m.option || m))))
    .reduce((n, l) => n + (Number(l.quantity) || 1), 0);

const sid = "CA4bc4785bb2ac62e72768dc13a2010b77";
const turns = loadTurns(sid);
console.log("BACKEND", b, backend.model, "turns", turns.length);
const info = nameFromTranscriptInfo(turns);
const key = `teresa1-${b}-${Date.now()}`;
const run = (t: string, language: "es"|"en", history: any[]) =>
  chatWithElvi({ transcript: applySharedAliases(t, "phone").slice(0, 1000), language, menu, history, resolverMenu, sessionKey: key } as any, backend as any);
const r: any = await shadowOrderFromTurns(turns, run as any);
const elines = elviLines(r.cart || [], resolverMenu as any);
const cart = r.cart || [];
const drinks = cart.filter((l: any) => /drink|coca|pepsi|refresco/i.test(String(l.itemId) + String(l.readback || "")));
const fields = {
  name: info?.name,
  qhrBistec: mq(cart, /quesadilla/i, /bistec/i),
  tcoBistec: mq(cart, /taco/i, /bistec/i),
  tcoCostilla: mq(cart, /taco/i, /costilla/i),
  coca: drinks.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0),
  cartLen: cart.length,
  allTcoTacos: cart.filter((l: any) => /taco/i.test(String(l.itemId))).every((l: any) => (l.modifiers || []).some((m: any) => /TCO|comal|homemade/i.test(String(m.option)))),
  allQhrQ: cart.filter((l: any) => /quesadilla/i.test(String(l.itemId))).every((l: any) => (l.modifiers || []).some((m: any) => /QHR|harina|flour/i.test(String(m.option)))),
};
const ok = info?.name === "Teresa"
  && fields.qhrBistec === 3
  && fields.tcoBistec === 1
  && fields.tcoCostilla === 2
  && fields.coca === 0
  && fields.cartLen === 4
  && fields.allTcoTacos && fields.allQhrQ;

console.log("\n======== Teresa1", b);
console.log("NAME", info);
console.log("LINES:", elines.map((l: any) => `${l.quantity}× ${l.name} [${(l.choices || []).slice(0, 5).join("; ")}]`));
for (const l of cart) console.log(JSON.stringify({ id: l.itemId, q: l.quantity, mods: (l.modifiers||[]).map((m:any)=>m.option).slice(0,6) }));
console.log("CHECK", ok, fields);
if (!ok) process.exitCode = 1;
