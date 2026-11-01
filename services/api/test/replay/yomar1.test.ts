import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyQdCorrection, liveQdCorrection, qdCorrectionMeats } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAbc24f7-yomar1.json", import.meta.url), "utf8"));
const QD = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const opts = (l: any) => (l.modifiers || []).map((m: any) => m.option).join(" | ");
test("yomar1 after-call: staff 'De comal, ¿verdad?' → caller 'en aceite, preparadas' → bistec is QD Deluxe; 2 + 2", () => {
  const c = structuredClone(d.cart.cart);
  assert.deepEqual(qdCorrectionMeats(d.turns), ["bistec"]);
  assert.equal(applyQdCorrection(c, d.turns), true);
  assert.equal(c.length, 2); assert.ok(c.every((l: any) => l.itemId === QD && l.quantity === 2));
  assert.ok(c.some((l: any) => /Bistec/.test(opts(l)))); assert.ok(c.some((l: any) => /Chorizo/.test(opts(l))));
  assert.ok(c.every((l: any) => !/QCO|Comal/.test(opts(l)) && /DELUXE Preparada/.test(opts(l))));
  assert.equal(applyQdCorrection(c, d.turns), false);
});
test("yomar1 rule: staff guess confirmed (no correction) stays QCO", () => {
  const T = [{ speaker: "caller", text: "dos quesadillas de bistec" }, { speaker: "staff", text: "De comal, ¿verdad?" }, { speaker: "caller", text: "Sí, de comal." }];
  assert.deepEqual(qdCorrectionMeats(T as any), []);
  const T2 = [{ speaker: "caller", text: "dos tacos de bistec" }, { speaker: "staff", text: "De maíz, ¿verdad?" }, { speaker: "caller", text: "doradas, preparadas" }];
  assert.deepEqual(qdCorrectionMeats(T2 as any), []);
});
test("yomar1 live: 'en aceite, preparadas' after 'dos quesadillas de biste' → QD Deluxe bistec x2", () => {
  const r = liveQdCorrection({ reply: "Quesadilla: ¿Bistec, Cabeza, Carnitas o Chorizo?", actions: [] },
    { transcript: "Ah, en de aceite, preparadas", history: [{ role: "customer", text: "dos quesadillas de biste" }, { role: "assistant", text: "Quesadilla: ¿Quesadilla Comal…?" }], cart: [], language: "es" });
  assert.equal(r.actions.length, 1); assert.equal(r.actions[0].itemId, QD); assert.equal(r.actions[0].quantity, 2); assert.match(opts(r.actions[0]), /Bistec/);
  const cart = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }] }];
  const r2 = liveQdCorrection({ reply: "x", actions: [] }, { transcript: "no, en aceite, preparadas", history: [{ role: "customer", text: "dos quesadillas de bistec" }], cart, language: "es" });
  assert.deepEqual(r2.actions.map((a: any) => a.type), ["remove_item", "add_item"]); assert.equal(r2.actions[1].itemId, QD);
  const r3 = liveQdCorrection({ reply: "x", actions: [] }, { transcript: "de comal", history: [{ role: "customer", text: "dos quesadillas de bistec" }], cart, language: "es" });
  assert.equal(r3.actions.length, 0);
});
