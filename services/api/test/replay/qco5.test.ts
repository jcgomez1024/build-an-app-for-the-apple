// qco5 (CA1c1052, Oct 31 12:39 PM ET): 5 QCO = 2 bistec, 2 pastor, 1 costilla; no tortilla pack.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const N = await import("../../src/order-name.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const show = (c: any[]) => c.map((l: any) => `${l.quantity} ${l.itemId} ${l.modifiers.map((m: any) => m.option).filter((o: string) => / \/ /.test(o) && !/Homemade/.test(o)).join("|")}`);

test("qco5: 'esa de costilla' = 1 (stated total 5), no phantom 6 tortillas from 'tortilla de harina o de maíz'", () => {
  const d = fx("CA1c1052-qco5"); const c = d.cart.cart; L.dropTortillaStyleAsk(c, d.turns); L.applyStatedDishTotal(c, d.turns);
  assert.deepEqual(show(c), ["2 sq-quesadilla-HLT6CR Bistec / Steak", "2 sq-quesadilla-HLT6CR Alpastor / Roasted Pork", "1 sq-quesadilla-HLT6CR Costilla / Beef Rib"]);
});
test("qco5 general: 'una orden de tortillas de maíz' keeps the pack; counted meats keep their count", () => {
  const c = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [] }, { itemId: "sq-tortillas-6-x", quantity: 1, modifiers: [] }];
  assert.equal(L.dropTortillaStyleAsk(c, [{ speaker: "caller", text: "Y una orden de tortillas de maíz" }] as any), false);
  const c2 = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 3, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" }] }];
  assert.equal(L.applyStatedDishTotal(c2, [{ speaker: "caller", text: "dos quesadillas, tres de costilla" }] as any), false);
});
