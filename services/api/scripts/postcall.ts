/** postcall1: after a call ends, one strong xAI request reads the whole transcript and writes the final order in Square POS terms.
 *  Usage: npx tsx scripts/postcall.ts [--only CallSid,...] [--model M] [--fresh]. Read-only: scores against staff tickets, writes only data/learning/postcall*.json (gitignored). */
import dotenv from "dotenv"; import fs from "node:fs"; import path from "node:path"; import { createHash } from "node:crypto"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });
const { scoreOrder, callerNamedSalsa } = await import("../src/call-accuracy.ts");
const { withIncludedToppings } = await import("../src/standard-toppings.ts");
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const model = arg("--model") || process.env.POSTCALL_MODEL || "grok-4.20-0309-reasoning";
const only = arg("--only") ? new Set(arg("--only")!.split(",")) : null, fresh = process.argv.includes("--fresh");
const cat = JSON.parse(fs.readFileSync(path.join(root, "data/logs/pos-catalog.json"), "utf8"));
const money = (c: number) => (c ? ` +$${(c / 100).toFixed(2)}` : "");
const usedLists = [...new Set(cat.items.flatMap((it: any) => it.modifierListIds))].filter((id: any) => cat.modifierLists[id]);
const menuText = "MODIFIER LISTS\n" + usedLists.map((id: any, i: number) => `L${i} ${cat.modifierLists[id].name}: ${cat.modifierLists[id].modifiers.map((x: any) => x.name + money(x.priceCents)).join(" | ")}`).join("\n") +
  "\nITEMS\n" + cat.items.map((it: any) => `${it.name}: ${it.variations.map((v: any) => v.name).join(" | ")}${it.modifierListIds.length ? " {" + it.modifierListIds.map((id: string) => "L" + usedLists.indexOf(id)).filter((x: string) => x !== "L-1").join(",") + "}" : ""}`).join("\n");
const RULES = `Cocina Elvis (Mexican restaurant, Painesville OH) phone order. Rules: each plate has exactly one tortilla type (Comal/corn homemade or Harina/flour); extra tortillas are a paid Extras add-on. The default salsa (mild Salsa Asada) is included unless the caller names another. Taquitos = street tacos (Taquero); flautas = tacos dorados. "platillo"/"plato" = a plate/dinner with rice and beans, never a torta. When a caller gives a total then splits meats ("cuatro quesadillas, dos de pastor y dos de bistec") split the quantity. Staff confirmations and corrections in the call are authoritative for the final order. Include sides and drinks ordered.`;
const sys = `${RULES}\n\nReturn ONLY JSON {"lines":[{"name":"<ITEM> · <variation>","quantity":n,"choices":["<variation>","<modifier>",...]}]} using exact names from this Square menu. One line per distinct configuration.\n\nMENU\n${menuText}`;
const cf = path.join(root, "data/learning/postcall-cache.json"); let cache: Record<string, any> = {}; try { cache = JSON.parse(fs.readFileSync(cf, "utf8")); } catch {}
async function readOrder(turns: any[]) {
  const transcript = turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
  const k = createHash("sha256").update(model + sys + transcript).digest("hex");
  if (cache[k] && !fresh) return cache[k];
  const r = await fetch("https://api.x.ai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, { role: "user", content: `Call transcript:\n${transcript}` }], response_format: { type: "json_object" } }) });
  const j: any = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 200));
  const out = { lines: JSON.parse(j.choices[0].message.content).lines || [], usage: j.usage }; cache[k] = out; fs.writeFileSync(cf, JSON.stringify(cache)); return out;
}
const data: any = await (await fetch("http://localhost:4000/api/calls/accuracy?days=90")).json();
const res: any[] = [];
for (const row of data.calls || []) {
  if (!row.compare || (only && !only.has(row.callSid))) continue;
  try {
    const o = await readOrder(row.turns || []);
    const lines = o.lines.map((l: any) => { const v = String(l.name).split(" · ")[1]; const ch = (l.choices || []).filter(Boolean); return { ...l, choices: v && !ch.includes(v) ? [v, ...ch] : ch }; }).map((l: any) => ({ ...l, freeChoices: [], quantity: Number(l.quantity) || 1 }));
    const s = scoreOrder(lines.map(withIncludedToppings), row.compare.truth.map(withIncludedToppings), { salsaNamed: callerNamedSalsa(row.turns || []) }).score;
    res.push({ callSid: row.callSid, at: row.at, unclear: !!row.unclear, source: row.source, postcall: s, replay: row.replay?.median ?? null, tokens: o.usage?.total_tokens, lines: lines.map((l: any) => `${l.quantity}× ${l.name} [${l.choices.join("; ")}]`) });
    console.error(`${row.at} ${row.source}${row.unclear ? " unclear" : ""} postcall=${s} elviReplay=${row.replay?.median ?? "?"} tokens=${o.usage?.total_tokens ?? "cached"}`);
  } catch (e) { console.error(row.at, "ERR", String(e).slice(0, 200)); }
}
const cust = res.filter((x) => x.source !== "training" && !x.unclear), avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;
fs.writeFileSync(path.join(root, "data/learning/postcall.json"), JSON.stringify({ at: new Date().toISOString(), model, calls: res }, null, 1));
console.log(JSON.stringify({ model, customers: cust.length, postcallAvg: avg(cust.map((x) => x.postcall)), elviReplayAvg: avg(cust.filter((x) => x.replay != null).map((x) => x.replay)) }));
