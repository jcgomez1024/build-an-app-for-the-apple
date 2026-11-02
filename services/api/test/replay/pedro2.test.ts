import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { pickSquareOrder, laterCallFrom } from "../../src/twilio.js";
import { isAbandonedOrder, isAbandonTurn, liveCancelOrder } from "../../src/readback-pass.js";

// pedro2 (CA6db6bee): pozole + 2 tacos de pollo asked; staff "no tengo pozole hoy"; caller "entonces no quiero nada" → no order.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA6db6be-pedro2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const POZ = "sq-pozole-rojo-red-pozole-DQ7X4J";
const taco = { type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] };
const stub = (seen: string[]) => { const r: any = async (t: string) => { seen.push(t); const p = t.toLowerCase();
  if (/pozole/.test(p) && !/sabes/.test(p)) return { actions: [{ type: "add_item", itemId: POZ, quantity: 1 }], reply: "Pozole Rojo. ¿Algo más?" };
  if (/dos tacos/.test(p)) return { actions: [taco], reply: "ok" };
  return { actions: [], reply: "Muy bien. ¿Algo más?" }; }; r.menu = () => M; return r; };

test("pedro2: 'entonces no quiero nada' after staff said no pozole → empty cart, no auto-accept", async () => {
  assert.equal(isAbandonedOrder(d.turns), true);
  const r: any = await shadowOrderFromTurns(d.turns, stub([]));
  assert.deepEqual(r.cart, []); assert.equal(r.autoAccepted, false);
  assert.doesNotMatch(JSON.stringify(r.cart), /pozole/);
});
test("pedro2: abandon phrases vs. 'that's all' / later re-order", () => {
  for (const s of ["Oh, no, entonces no quiero nada.", "Mejor no, gracias.", "Entonces no.", "Never mind, thanks."]) assert.equal(isAbandonTurn(s), true, s);
  for (const s of ["Entonces no, sería todo.", "No quiero nada más.", "Mejor no le pongas cebolla.", "No, eso es todo."]) assert.equal(isAbandonTurn(s), false, s);
  const re = [...d.turns, { speaker: "caller", text: "Bueno, entonces dame dos tacos de pollo." }];
  assert.equal(isAbandonedOrder(re), false);
  const named = [...d.turns, { speaker: "staff", text: "¿A qué nombre sería la orden?" }];
  assert.equal(isAbandonedOrder(named), false);
});
test("pedro2 live: staff-unavailable pozole never re-added mid-call; abandon turn clears the cart", async () => {
  const turns = d.turns.filter((t: any) => !/no quiero nada/.test(t.text));
  const r: any = await shadowOrderFromTurns(turns, stub([]));
  assert.doesNotMatch(JSON.stringify(r.cart), /pozole/);
  const live = liveCancelOrder({ reply: "Muy bien. ¿Qué más?", actions: [] }, { transcript: "Oh, no, entonces no quiero nada", language: "es", history: [], cart: [{ itemId: "sq-taco-TAR7L5", quantity: 2 }] });
  assert.deepEqual(live.actions, [{ type: "remove_item", itemId: "sq-taco-TAR7L5", quantity: 2 }]);
});

test("pedro2: Square ticket rung after the same caller's next call started links to that later call", () => {
  const first = { callSid: "CA6db6bee", at: "2026-11-02T00:52:00.601Z", caller: "+14402313783", name: "Pedro", talkSec: 90, lines: [] as unknown[] };
  const next = { callSid: "CA0afcaf19", at: "2026-11-02T00:54:34.205Z", caller: "+14402313783", name: "Pedro" };
  const o = { id: "tF932p", created_at: "2026-11-02T00:56:20.000Z", ticket_name: "Pedro", line_items: [{ name: "Taco" }], total_money: { amount: 2075 } };
  const later = laterCallFrom(first, [first, next]);
  assert.equal(later, next.at);
  assert.equal(pickSquareOrder({ ...first, laterCallAt: later }, [o], Date.parse(o.created_at) + 3600000), null);
  assert.equal(pickSquareOrder({ ...next, laterCallAt: laterCallFrom(next, [first, next]) }, [o])?.order.id, "tF932p");
  assert.equal(pickSquareOrder(first, [o])?.by, "ticket name"); // old behaviour without the later call
});
