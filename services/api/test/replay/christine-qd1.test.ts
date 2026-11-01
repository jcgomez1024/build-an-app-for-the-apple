// christine-qd1 (CA901cc6, Sun Nov 1 4:57 PM ET): 2 QD deluxe al pastor (toppings on side), one with cheese, one without;
// gordita beans+cheese; gordita steak+beans. Elvi: paid Queso Derretido on QD #1, QCO+melted cheese instead of QD #2, no "sin queso".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyQdCheeseSplit } from "../../src/list-repair.ts";
import { caseFix } from "../../src/elvi.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA901cc6-christine-qd1.json", import.meta.url), "utf8"));
const opts = (l: any) => l.modifiers.map((m: any) => m.option);
test("christine-qd1: no paid melted cheese on QD; orphan cheese QCO becomes QD deluxe pastor 'sin queso'", () => {
  const c = structuredClone(d.elviOrder.cart); assert.ok(applyQdCheeseSplit(c, d.turns));
  const qd = c.filter((l: any) => /quesadilla-dorada/.test(l.itemId));
  assert.equal(qd.length, 2); assert.equal(c.filter((l: any) => /sq-quesadilla-HLT6CR/.test(l.itemId)).length, 0);
  for (const l of qd) { assert.ok(opts(l).includes("Alpastor / Roasted Pork")); assert.ok(opts(l).includes("(QD) DELUXE Preparada")); assert.ok(!opts(l).some((o: string) => /Melted/.test(o))); assert.ok(l.elviNotes.includes("verdura aparte")); }
  assert.equal(qd.filter((l: any) => l.elviNotes.includes("sin queso")).length, 1);
  const g = c.filter((l: any) => /gordita/.test(l.itemId)); assert.equal(g.length, 2); assert.ok(opts(g[0]).some((o: string) => /Melted/.test(o)));
  assert.equal(applyQdCheeseSplit(c, d.turns), false);
});
test("christine-qd1 general: explicit 'extra cheese' keeps melted cheese; qty-2 QD splits 1+1", () => {
  const L = () => ({ itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 2, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, { step: "(B) Q Carnes / Meats", option: "Queso Derretido / Melted Cheese" }] });
  const c1 = [L()]; applyQdCheeseSplit(c1, [{ speaker: "caller", text: "two deluxe steak with extra cheese" }]); assert.ok(opts(c1[0]).some((o: string) => /Melted/.test(o)));
  const c2: any[] = [L()]; assert.ok(applyQdCheeseSplit(c2, [{ speaker: "caller", text: "two deluxe steak, one with cheese and one without" }]));
  assert.deepEqual(c2.map((l) => [l.quantity, (l.elviNotes || []).join()]), [[1, ""], [1, "sin queso"]]);
});
test("christine-qd1 live: QD + meat + 'with cheese' drops paid Queso Derretido", () => {
  const r: any = caseFix({ actions: [{ type: "add_item", itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" }, { step: "(B) Q Carnes / Meats", option: "Queso Derretido / Melted Cheese" }] }] } as any, { transcript: "one deluxe with, cheese and al pastor", history: [] } as any);
  assert.ok(!opts(r.actions[0]).some((o: string) => /Melted/.test(o)));
});
