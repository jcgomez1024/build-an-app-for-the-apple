// cristian-qd1 (CA7c22da, Sun Nov 1 2:50 PM ET): 3 QD Deluxe (carnitas, chorizo, prensado) + delivery. Elvi rang 124× chorizo
// (house number), 2 Chilaquiles from "estoy aquí como a dos minutos", and missed prensado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { addressNumberTurn, etaOnlyTurn, capQty, capCartQty, liveEtaAddressQty } from "../../src/eta-qty.ts";
import { qdGroups } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA7c22da-cristian-qd1.json", import.meta.url), "utf8"));
const DLX = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const run = Object.assign(async (t: string) => { const a: any[] = [];
  if (/dos minutos/.test(t)) a.push({ type: "add_item", itemId: "sq-chilaquiles-con-huevo-YWKBQV", quantity: 2, modifiers: [] });
  if (/carnitas/.test(t)) a.push({ type: "add_item", itemId: DLX, quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Carnitas / Pulled Pork (+$0.50)" }] });
  if (/^deluxe$/i.test(t.trim())) a.push({ type: "add_item", itemId: DLX, quantity: 124, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] });
  return { actions: a, reply: a.length ? "ok. ¿Algo más?" : "?" } as any; }, { menu: () => [] });
test("cristian-qd1: shadow → exactly 3 QD Deluxe ×1 (carnitas, chorizo, prensado); no chilaquiles, no 124", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, run as any);
  const meat = (l: any) => (l.modifiers || []).find((m: any) => /Carnes/.test(m.step))?.option;
  assert.deepEqual(r.cart.map((l: any) => [l.itemId, l.quantity, meat(l)]).sort(), [[DLX, 1, "Carnitas / Pulled Pork"], [DLX, 1, "Chorizo / Mexican Sausage"], [DLX, 1, "Prensado / Spicy Pork"]].sort());
});
test("cristian-qd1: rewritten 'Tres QD REGULAR Dorada' still starts a dorada group; staff 'Las tres preparadas?' → sí = deluxe", () => {
  const t = [{ speaker: "caller", text: "Tres QD REGULAR Dorada." }, { speaker: "caller", text: "Una de carnitas." }, { speaker: "caller", text: "Una de chorizo." }, { speaker: "caller", text: "Y la otra de prensado." }, { speaker: "staff", text: "Las tres preparadas, ¿verdad?" }, { speaker: "caller", text: "Sí, por favor." }] as any;
  const g = qdGroups(t); assert.equal(g.length, 1); assert.equal(g[0].n, 3); assert.equal(g[0].deluxe, true); assert.equal(g[0].meats.length, 3);
});
test("cristian-qd1: house numbers during address capture and ETAs are never quantities or dishes", () => {
  const ask = ["Jackson Street. Ah, ¿me das tu dirección bien, por favor?"];
  for (const t of ["124.", "Perdón, 114, disculpa. Sí.", "Es el 124"]) assert.ok(addressNumberTurn(t, ask), t);
  assert.equal(addressNumberTurn("124.", ["¿Cuántas quiere?"]), false);
  assert.equal(addressNumberTurn("dos tacos de asada, 124", ask), false);
  for (const t of ["Eh, estoy aquí como a dos minutos, tres minutos.", "I'm like five minutes away", "en 20 minutos llego"]) assert.ok(etaOnlyTurn(t), t);
  for (const t of ["dos tacos, llego en cinco minutos", "quiero tres quesadillas"]) assert.equal(etaOnlyTurn(t), false, t);
  const live = liveEtaAddressQty({ reply: "2 × Chilaquiles", actions: [{ type: "add_item", itemId: "sq-chilaquiles-con-huevo-YWKBQV", quantity: 2 }] }, { transcript: "estoy aquí como a dos minutos", language: "es", history: [] });
  assert.equal(live.actions.length, 0);
  const live2 = liveEtaAddressQty({ reply: "x", actions: [{ type: "add_item", itemId: DLX, quantity: 124 }] }, { transcript: "124", language: "es", history: [{ role: "assistant", text: "¿Cuál es su dirección?" }] });
  assert.equal(live2.actions.length, 0);
});
test("cristian-qd1: a count > 30 on one line falls back to 1 unless said next to a dish", () => {
  const a = [{ type: "add_item", itemId: DLX, quantity: 124 }]; assert.equal(capQty(a, "un qd de chorizo"), 1); assert.equal(a[0].quantity, 1);
  const b = [{ type: "add_item", itemId: "sq-taco", quantity: 40 }]; assert.equal(capQty(b, "40 tacos de asada para una fiesta"), 0); assert.equal(b[0].quantity, 40);
  const c = [{ itemId: DLX, quantity: 124 }, { itemId: "sq-taco", quantity: 2 }];
  assert.ok(capCartQty(c, [{ speaker: "caller", text: "Nelson Street, 124" }, { speaker: "caller", text: "124 Nelson Street, y dos tacos" }]));
  assert.deepEqual(c.map((l) => l.quantity), [1, 2]);
});
