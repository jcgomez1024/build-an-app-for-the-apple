// qty1: synthetic, no PII. Rules that used to depend on the AI's wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { carryAskedQty, isRestatement } from "../../src/call-scoring.ts";
import { caseFix } from "../../src/elvi.ts";
const taco = (q: number, meat = "Bistec / Steak") => ({ type: "add_item", itemId: "sq-taco-X", quantity: q, modifiers: [{ step: "T", option: "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "M", option: meat }] });
const sig = (x: any) => `${x.itemId}|${(x.modifiers || []).map((m: any) => m.option).sort().join(",")}`;
test("qty1: 'Sí, de hecha mano. Y también dos de,' answering the tortilla question keeps the 2 tacos already asked for", () => {
  const acts = [taco(1)]; carryAskedQty(acts, "Sí, de hecha mano. Y también dos de", "me da dos tacos de bistec", true);
  assert.equal(acts[0].quantity, 2);
});
test("qty1: no carry when the answer has its own quantity, when not answering, or for another dish", () => {
  let a = [taco(1)]; carryAskedQty(a, "una de comal", "dos tacos de bistec", true); assert.equal(a[0].quantity, 1);
  a = [taco(1)]; carryAskedQty(a, "de comal", "dos tacos de bistec", false); assert.equal(a[0].quantity, 1);
  a = [taco(1)]; carryAskedQty(a, "de comal", "dos quesadillas de bistec", true); assert.equal(a[0].quantity, 1);
});
test("qty1: 'dos de bistec' right after 2 bistec were rung is a restatement; 'dos más de bistec' / other meat are not", () => {
  const cart = [{ ...taco(2) }];
  assert.equal(isRestatement("dos de bistec", taco(2), cart, sig), true);
  assert.equal(isRestatement("dos más de bistec", taco(2), cart, sig), false);
  assert.equal(isRestatement("dos de chorizo", taco(2, "Chorizo / Mexican Sausage"), cart, sig), false);
  assert.equal(isRestatement("dos tacos de bistec", taco(2), cart, sig), false);
});
test("qty1: 'del chiquito, taquero' keeps the street taco even after an earlier 'de comal'", () => {
  const menu: any[] = [{ id: "sq-taco-X", name: "Taco", modifierGroups: [{ name: "T", options: [{ name: "(TCO) Taco Comal / Homemade (+$1.00)" }, { name: "(TFL) Taco Harina / Flour" }, { name: "(TST) Taco Taquero / Street Taco" }] }] }];
  const r: any = caseFix({ language: "es", reply: "x", actions: [{ type: "add_item", itemId: "sq-taco-X", quantity: 4, modifiers: [{ step: "T", option: "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "M", option: "Bistec / Steak" }] }] } as any,
    { transcript: "cuatro tacos, pero del chiquito, taquero, de bistec", language: "es", menu, resolverMenu: menu, history: [{ role: "customer", text: "tres quesadillas de bistec de comal" }] } as any);
  assert.ok(r.actions[0].modifiers.some((m: any) => /Taquero/.test(m.option)));
});
