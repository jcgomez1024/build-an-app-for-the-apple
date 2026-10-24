/** jesus1 + joseA1: Nemotron (default) or xAI score — one backend pass each. */
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
import { nameFromTranscriptInfo, nameFromTranscript } from "../src/order-name.ts";

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

const cases = [
  {
    id: "jesus1",
    sid: "CAdd6ef2c9ecd001befe64deaabd5bbbe8",
    fallback: "/tmp/jesus-turns.json",
    wantName: "Jesús",
    truth: [
      { name: "COMBO Gorditas", quantity: 2, choices: ["Chorizo", "Carnitas", "Arroz", "Frijoles Refritos"] },
      { name: "Taco", quantity: 1, choices: ["(TCO) Taco Comal / Homemade", "Carnitas / Pulled Pork"] },
    ],
  },
  {
    id: "joseA1",
    sid: "CA3e6d74ea78b330c083588dc10ae084e9",
    fallback: "/tmp/joseA-turns.json",
    wantName: "José Acevedo",
    truth: [
      { name: "Torta", quantity: 3, choices: ["Bistec / Steak", "Chorizo / Mexican Sausage"] },
      { name: "sq-drink-agua-fresca-horchata-32oz", quantity: 1, choices: [] },
    ],
  },
];

console.log("BACKEND", b, backend.model);
for (const c of cases) {
  const turns = loadTurns(c.sid, c.fallback);
  if (!turns.length) { console.error(c.id, "no turns"); continue; }
  const nameInfo = nameFromTranscriptInfo(turns);
  const nameAsk = nameFromTranscript(turns);
  const key = `${c.id}-${b}-${Date.now()}`;
  const run = (t: string, language: "es"|"en", history: any[]) =>
    chatWithElvi({ transcript: applySharedAliases(t, "phone").slice(0, 1000), language, menu, history, resolverMenu, sessionKey: key } as any, backend as any);
  const r: any = await shadowOrderFromTurns(turns.map((t: any) => ({ ...t })), run as any);
  const elines = elviLines(r.cart || [], resolverMenu as any);
  const scored = scoreOrder(elines as any, c.truth as any);
  console.log("\n====", c.id);
  console.log("NAME", nameInfo, "ask", nameAsk, "want", c.wantName);
  console.log("ADDR", r.address, "confirmed", r.addressConfirmed, "fulfill", r.fulfillment);
  console.log("LINES:", elines.map((l: any) => `${l.quantity}× ${l.name} [${(l.choices||[]).join("; ")}]`));
  console.log("CART:", (r.cart || []).map((l: any) => `${l.quantity}×${l.itemId} ${(l.modifiers||[]).map((m:any)=>m.option).join("+")}`));
  console.log("SCORE:", scored.score, "misses:", JSON.stringify(scored.misses));

  if (c.id === "jesus1") {
    const combos = (r.cart || []).filter((l: any) => /combo.*gordita/i.test(String(l.itemId)));
    const cq = combos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
    const opts = combos.flatMap((l: any) => (l.modifiers || []).map((m: any) => String(m.option))).join("; ");
    const tacos = (r.cart || []).filter((l: any) => kindOfItem(l.itemId) === "taco");
    const to = tacos.flatMap((l: any) => (l.modifiers || []).map((m: any) => String(m.option))).join("; ");
    const nameOk = (nameInfo?.name === c.wantName) || nameAsk === c.wantName;
    const cartOk = cq === 2 && /chorizo/i.test(opts) && /carnitas/i.test(opts) && /arroz/i.test(opts) && /frijol/i.test(opts)
      && !/SOLO\s+Frijoles/i.test(opts) && tacos.length >= 1 && /carnitas/i.test(to) && !/Mild Salsa/i.test(to);
    console.log("PASS nameOk", nameOk, "cartOk", cartOk, "comboQty", cq);
  } else {
    const tortas = (r.cart || []).filter((l: any) => kindOfItem(l.itemId) === "torta" || /torta/i.test(String(l.itemId)));
    const tq = tortas.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
    const opts = tortas.flatMap((l: any) => (l.modifiers || []).map((m: any) => String(m.option))).join("; ");
    const hor = (r.cart || []).some((l: any) => /horchata/i.test(String(l.itemId)));
    const nameOk = nameInfo?.name === c.wantName;
    const cartOk = tq === 3 && /bistec/i.test(opts) && /chorizo/i.test(opts) && hor && r.addressConfirmed === true;
    console.log("PASS nameOk", nameOk, "cartOk", cartOk, "tortaQty", tq, "hor", hor);
  }
}
