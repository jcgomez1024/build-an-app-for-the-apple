// suggest1: one offer per item; added only after "sí"; never overrides; house rule prensado/duro → con frijoles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { offerFor, withLearnedSuggestion, offerAnswer, learnedSuggestion } from "../../src/online-learning.ts";

const CON = { name: "(C) Con / With", options: [{ name: "**Con Frijoles / With Beans (+$0.50)", priceDeltaCents: 50 }] };
const quesa = { id: "q", name: "Quesadilla", modifierGroups: [{ name: "(A) Q Tortilla Options", options: [{ name: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { name: "(QHR) Quesadilla Harina / Flour" }] },
  { name: "(B) Q Carnes / Meats", options: [{ name: "Prensado / Spicy Pork (+$0.50)" }, { name: "Duro / Pork Rinds" }, { name: "Bistec / Steak" }, { name: "Frijoles Refritos / Refried Beans" }] }, CON] };
const COMAL = "(QCO) Quesadilla Comal / Homemade (+$1.00)";

test("suggest1: quesadilla comal de prensado / duro → offer Con Frijoles (paid, not added)", () => {
  for (const meat of ["Prensado / Spicy Pork (+$0.50)", "Duro / Pork Rinds"]) {
    const o = offerFor(quesa, [COMAL, meat], "una quesadilla de comal de chicharrón", "es", null)!;
    assert.equal(o.source, "house"); assert.equal(o.options[0].option, "**Con Frijoles / With Beans (+$0.50)"); assert.match(o.text, /¿La quiere con frijoles\? Son \$0\.50 más/);
    assert.match(offerFor(quesa, [COMAL, meat], "one comal quesadilla", "en", null)!.text, /Would you like it with beans/);
  }
});
test("suggest1: no offer when beans were said (with or without), on flour, other meats, or beans already on it", () => {
  assert.equal(offerFor(quesa, [COMAL, "Duro / Pork Rinds"], "de duro sin frijoles", "es", null), null);
  assert.equal(offerFor(quesa, [COMAL, "Duro / Pork Rinds"], "de duro con frijoles", "es", null), null);
  assert.equal(offerFor(quesa, ["(QHR) Quesadilla Harina / Flour", "Duro / Pork Rinds"], "de harina de duro", "es", null), null);
  assert.equal(offerFor(quesa, [COMAL, "Bistec / Steak"], "de bistec", "es", null), null);
  assert.equal(offerFor(quesa, [COMAL, "Prensado / Spicy Pork (+$0.50)", "**Con Frijoles / With Beans (+$0.50)"], "de prensado", "es", null), null);
  assert.equal(offerFor({ id: "s", name: "Sopesaso Elvis", modifierGroups: [] }, [], "sopesaso", "es", null), null);
});
test("suggest1: reply-only, once per item; 'sí' answers it, a different turn drops it", () => {
  const res = { reply: "Quesadilla: comal, duro, salsa asada. $5.00. ¿Algo más?", actions: [{ type: "add_item", itemId: "q", quantity: 1, modifiers: [{ option: COMAL }, { option: "Duro / Pork Rinds" }] }] };
  const r1: any = withLearnedSuggestion(res, { sessionKey: "S1", heard: "una quesadilla de comal de duro", lang: "es", menu: [quesa], learning: null });
  assert.match(r1.reply, /¿La quiere con frijoles\?/); assert.deepEqual(r1.actions, res.actions);
  assert.equal(withLearnedSuggestion(res, { sessionKey: "S1", heard: "otra de duro", lang: "es", menu: [quesa], learning: null }).reply, res.reply); // one per item
  const a = offerAnswer("S1", "sí, por favor", r1.reply)!; assert.equal(a.yes, true); assert.equal(a.offer.options[0].priceDeltaCents, 50);
  withLearnedSuggestion(res, { sessionKey: "S2", heard: "de duro", lang: "es", menu: [quesa], learning: null });
  assert.equal(offerAnswer("S2", "y dos tacos de pastor", "…"), null); // not an answer → dropped, normal flow
  assert.equal(offerAnswer("S2", "sí", "…"), null);
});
test("suggest1: learned offer needs ≥15 orders and ≥60 %; one group; missing file → none", () => {
  const burrito = { id: "b", name: "Burrito", modifierGroups: [{ name: "(B) Burrito Carne Options", options: [{ name: "Arroz / Rice" }] }, { name: "(C) Burrito Options", options: [{ name: "Arroz / Rice" }, { name: "Queso Fresco / Cheese" }, { name: "Frijoles Refritos / Refried Beans" }] }] };
  const L = { modifiersByItem: { "Burrito (ONLINE)": { orders: 42, modifiers: [{ name: "Arroz / Rice", share: 0.86 }, { name: "Queso Fresco / Cheese", share: 0.86 }, { name: "Frijoles Refritos / Refried Beans", share: 0.83 }] } } };
  assert.match(learnedSuggestion(burrito, ["Bistec / Steak"], "un burrito de bistec", "es", L)!.text, /La mayoría la pide con arroz, queso fresco y frijoles refritos/);
  assert.equal(learnedSuggestion(burrito, ["Bistec / Steak", "Arroz / Rice"], "burrito de bistec con arroz", "es", L), null);
  assert.equal(learnedSuggestion(burrito, ["Bistec / Steak"], "burrito", "es", { modifiersByItem: { "Burrito (ONLINE)": { orders: 9, modifiers: L.modifiersByItem["Burrito (ONLINE)"].modifiers } } }), null);
  assert.equal(learnedSuggestion(burrito, ["Bistec / Steak"], "burrito", "es", null), null);
});
