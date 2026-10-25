/** freddy1 / juanTst1 — REPLAY_BACKEND=nvidia|xai score vs Auditor truth */
import dotenv from "dotenv"; import path from "node:path"; import { fileURLToPath } from "node:url";
import fs from "node:fs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });
import { resolveTenant } from "../src/tenant.ts";
import { getMenu, getFullMenu } from "../src/square.ts";
import { chatWithElvi } from "../src/elvi.ts";
import { shadowOrderFromTurns, DORADA_DELUXE_ID, DORADA_REG_ID } from "../src/call-scoring.ts";
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
const qty = (lines: any[]) => lines.reduce((n, l) => n + (Number(l.quantity) || 1), 0);

async function runCase(label: string, sid: string, orderId: string | null, check: (r: any, info: any) => { ok: boolean; fields: Record<string, unknown> }, truth?: any[]) {
  const turns = loadTurns(sid);
  console.log("\n========", label, b, "turns", turns.length);
  let ticketTruth: any[] = truth || [];
  if (orderId) {
    const ord = await fetchOrder(orderId);
    if (ord) {
      ticketTruth = ticketLines(ord) as any[];
      console.log("TICKET:", ticketTruth.map((l: any) => `${l.quantity}× ${l.name} [${(l.choices || []).slice(0, 5).join("; ")}]`));
    }
  }
  const info = nameFromTranscriptInfo(turns);
  const key = `${label}-${b}-${Date.now()}`;
  const run = (t: string, language: "es"|"en", history: any[]) =>
    chatWithElvi({ transcript: applySharedAliases(t, "phone").slice(0, 1000), language, menu, history, resolverMenu, sessionKey: key } as any, backend as any);
  const r: any = await shadowOrderFromTurns(turns, run as any);
  const elines = elviLines(r.cart || [], resolverMenu as any);
  const scored = ticketTruth.length ? scoreOrder(elines as any, ticketTruth as any) : { score: null, misses: [] };
  console.log("NAME", info);
  console.log("FUL", r.fulfillment);
  console.log("LINES:", elines.map((l: any) => `${l.quantity}× ${l.name} [${(l.choices || []).slice(0, 5).join("; ")}]`));
  for (const l of r.cart || []) console.log(JSON.stringify({ id: l.itemId, q: l.quantity, mods: (l.modifiers||[]).map((m:any)=>m.option).slice(0,6), notes: l.elviNotes }));
  if (scored.score != null) console.log("SCORE", scored.score, "misses", JSON.stringify(scored.misses).slice(0, 400));
  const { ok, fields } = check(r, info);
  console.log("CHECK", ok, fields);
  if (!ok) process.exitCode = 1;
  return ok;
}

await runCase("freddy1", "CA710ac649668638f9e679218b50cd05f5", null, (r, info) => {
  const cart = r.cart || [];
  const qd = cart.filter((l: any) => String(l.itemId) === DORADA_DELUXE_ID);
  const qdReg = cart.filter((l: any) => String(l.itemId) === DORADA_REG_ID);
  const tacos = cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  const tcoTripa = tacos.filter((l: any) =>
    (l.modifiers || []).some((m: any) => /TCO|comal|homemade/i.test(String(m.option)))
    && (l.modifiers || []).some((m: any) => /tripa/i.test(String(m.option))));
  const tst = tacos.filter((l: any) => (l.modifiers || []).some((m: any) => /TST|taquer|street/i.test(String(m.option))));
  const tacoBistec = tacos.filter((l: any) => (l.modifiers || []).some((m: any) => /bistec/i.test(String(m.option))));
  const noCrema = qd.every((l: any) => (l.elviNotes || []).some((n: string) => /no crema/i.test(n)));
  const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option));
  const hasTripa2 = qd.some((l: any) => qty([l]) === 2 && meatOf(l).some((o: string) => /tripa/i.test(o)));
  const hasBistec1 = qd.some((l: any) => qty([l]) === 1 && meatOf(l).filter((o: string) => /bistec|tripa|prensado|chorizo|lengua|cabeza/i.test(o)).length === 1 && meatOf(l).some((o: string) => /bistec/i.test(o)));
  const hasPrensado1 = qd.some((l: any) => qty([l]) === 1 && meatOf(l).some((o: string) => /prensado/i.test(o)));
  const hasBistChorizo = qd.some((l: any) => qty([l]) === 1 && meatOf(l).some((o: string) => /bistec/i.test(o)) && meatOf(l).some((o: string) => /chorizo/i.test(o)));
  const fields = {
    name: info?.name,
    qdDeluxeQty: qty(qd),
    qdRegQty: qty(qdReg),
    tripa2: hasTripa2,
    bistec1: hasBistec1,
    prensado1: hasPrensado1,
    bistecChorizo1: hasBistChorizo,
    noCrema,
    tcoTripaQty: qty(tcoTripa),
    tstPhantom: tst.length,
    tacoBistecPhantom: tacoBistec.length,
    cartLen: cart.length,
  };
  const ok = info?.name === "Freddy"
    && qty(qd) === 5 && qty(qdReg) === 0
    && hasTripa2 && hasBistec1 && hasPrensado1 && hasBistChorizo && noCrema
    && qty(tcoTripa) === 5 && tst.length === 0 && tacoBistec.length === 0
    && cart.length === 5;
  return { ok, fields };
}, [
  { name: "Quesadilla Dorada", quantity: 2, choices: ["(QD) DELUXE Preparada", "Tripa / Beef Tripe"] },
  { name: "Quesadilla Dorada", quantity: 1, choices: ["(QD) DELUXE Preparada", "Bistec / Steak"] },
  { name: "Quesadilla Dorada", quantity: 1, choices: ["(QD) DELUXE Preparada", "Prensado / Spicy Pork"] },
  { name: "Quesadilla Dorada", quantity: 1, choices: ["(QD) DELUXE Preparada", "Bistec / Steak", "Chorizo / Mexican Sausage"] },
  { name: "Taco", quantity: 5, choices: ["(TCO) Tortilla Comal / Homemade", "Tripa / Beef Tripe"] },
]);

await runCase("juanTst1", "CAec1c4cd1f85fdc638a4030cdb2a58d1c", "H4esjslhe9GNtNge8zxgOkCwpHSZY", (r, info) => {
  const cart = r.cart || [];
  const tacos = cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  const horch = cart.filter((l: any) => /horchata/i.test(String(l.itemId)));
  const sopes = cart.filter((l: any) => /sopes[ae]so/i.test(String(l.itemId)));
  const allTst = tacos.every((l: any) => (l.modifiers || []).some((m: any) => /TST|taquer|street/i.test(String(m.option))));
  const fields = {
    name: info?.name,
    lengua: mq(tacos, /lengua/i),
    bistec: mq(tacos, /bistec|steak/i),
    cabeza: mq(tacos, /cabeza/i),
    tripa: mq(tacos, /tripa/i),
    chorizo: mq(tacos, /chorizo/i),
    allTst,
    horchataQty: qty(horch),
    sopePhantom: sopes.length,
    cartLen: cart.length,
  };
  const ok = info?.name === "Juan"
    && mq(tacos, /lengua/i) === 4 && mq(tacos, /bistec|steak/i) === 5
    && mq(tacos, /cabeza/i) === 4 && mq(tacos, /tripa/i) === 4 && mq(tacos, /chorizo/i) === 3
    && allTst && qty(horch) === 2 && sopes.length === 0 && cart.length === 6;
  return { ok, fields };
}, [
  { name: "Taco", quantity: 4, choices: ["(TST) Tortilla Taquera / Street Taco", "Lengua / Beef Tongue"] },
  { name: "Taco", quantity: 5, choices: ["(TST) Tortilla Taquera / Street Taco", "Bistec / Steak"] },
  { name: "Taco", quantity: 4, choices: ["(TST) Tortilla Taquera / Street Taco", "Cabeza / Beef Head"] },
  { name: "Taco", quantity: 4, choices: ["(TST) Tortilla Taquera / Street Taco", "Tripa / Beef Tripe"] },
  { name: "Taco", quantity: 3, choices: ["(TST) Tortilla Taquera / Street Taco", "Chorizo / Mexican Sausage"] },
  { name: "Horchata", quantity: 2, choices: [] },
]);
