// burrito2 + match3: synthetic, no PII.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { candidateTickets } from "../../src/call-accuracy.ts";
const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn => ({ speaker, start, end: start + 1, text, language: "es" });
const burrito = { type: "add_item", itemId: "sq-burrito-X", quantity: 1, modifiers: [{ step: "S", option: "Grande '12 (+$3.00)" }, { step: "M", option: "Bistec / Steak" }, { step: "M", option: "Chorizo / Mexican Sausage" }] };
test("burrito2: the auto 'así está bien' answer to a toppings question never re-adds the same burrito", async () => {
  // failure mode seen on a training call: Elvi answers the auto-accept with the same add_item again (modifiers reordered)
  const run = async (text: string) => /burrito/i.test(text) ? { reply: "Burrito: grande, bistec y chorizo. ¿Lo quiere con arroz y frijoles?", actions: [burrito] }
    : /así está bien/i.test(text) ? { reply: "Burrito listo. ¿Algo más?", actions: [{ ...burrito, modifiers: [...burrito.modifiers].reverse() }] } : { reply: "¿Algo más?", actions: [] };
  const r: any = await shadowOrderFromTurns([T("caller", "me podrías poner un burrito grande de bistec y chorizo", 0), T("caller", "Gracias.", 5)], run as any);
  assert.equal(r.cart.filter((l: any) => l.itemId === "sq-burrito-X").reduce((a: number, l: any) => a + l.quantity, 0), 1);
});
test("match3: items-only match (no phone/name) with different meats is not the call's ticket", () => {
  const call: any = { callSid: "CAm3", at: "2026-01-05T14:00:00Z", caller: "+15550000000", recordingSec: 30, recordingSid: "RE1" };
  const q = (meat: string) => ({ name: "Quesadilla", baseName: "Quesadilla", quantity: 1, choices: ["(QCO) Quesadilla de Comal / Homemade", meat], unitCents: 500, totalCents: 500 });
  const elvi: any[] = [q("Chorizo / Mexican Sausage"), q("Tripa / Beef Tripe"), q("Buche / Pork Stomach")];
  const li = (meat: string) => ({ name: "Quesadilla", variation_name: "(QCO) Quesadilla de Comal / Homemade", quantity: "1", base_price_money: { amount: 500 }, total_money: { amount: 500 }, modifiers: [{ name: meat }] });
  const other = { id: "o1", created_at: "2026-01-05T14:05:00Z", source: { name: "Point of Sale" }, line_items: [li("Alpastor / Roasted Pork"), li("Pollo / Chicken"), li("Asada")], total_money: { amount: 1500 } };
  const same = { ...other, id: "o2", line_items: [li("Chorizo / Mexican Sausage"), li("Tripa / Beef Tripe"), li("Buche / Pork Stomach")] };
  assert.equal(candidateTickets(call, elvi, [other]).length, 0);
  assert.equal(candidateTickets(call, elvi, [same]).length, 1);
});
import { cleanPhrase } from "../../src/call-scoring.ts";
test("contodo2: phone path keeps 'con todo' inside a dish phrase so the standard toppings get added", () => {
  assert.match(cleanPhrase("un burrito grande de bistec con chorizo, con todo"), /con todo/);
  assert.match(cleanPhrase("Con todo, por favor."), /^con todo$/i);
});
test("contodo2: tacos still drop 'con todo' (included onion+cilantro)", () => { assert.doesNotMatch(cleanPhrase("dos tacos de pastor con todo"), /todo/); });
