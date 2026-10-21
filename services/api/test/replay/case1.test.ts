// case1: synthetic. The caller's own words decide beans, cheese and tortilla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { caseFix } from "../../src/elvi.ts";
const menu: any[] = [
  { id: "qsd", name: "Quesadilla", modifierGroups: [{ name: "Tortilla", options: [{ name: "(QCO) Quesadilla de Comal / Homemade" }, { name: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { name: "(QTQ) Quesadilla Taquera" }] }] },
  { id: "gdt", name: "Gordita", modifierGroups: [] },
];
const run = (transcript: string, itemId: string, opts: string[], history: any[] = []) =>
  (caseFix({ language: "es", reply: "x", actions: [{ type: "add_item", itemId, quantity: 1, modifiers: opts.map((o) => ({ step: "", option: o })) }] } as any,
    { transcript, language: "es", menu, resolverMenu: menu, history } as any).actions[0] as any).modifiers.map((m: any) => m.option);
test("case1: 'sin frijoles' removes every bean option", () => {
  assert.deepEqual(run("otra gordita de bistec, pero sin frijoles, que lleve queso", "gdt", ["(QGD) Queso Gordita (+$0.50)", "**Con Frijoles / With Beans (+$0.50)", "Bistec / Steak", "Frijoles Refritos / Refried Beans"]), ["(QGD) Queso Gordita (+$0.50)", "Bistec / Steak"]);
});
test("case1: queso gordita 'con queso' gets no extra melted cheese; 'con frijoles' is one bean option", () => {
  assert.deepEqual(run("una gordita con queso y frijoles", "gdt", ["(QGD) Queso Gordita (+$0.50)", "Queso Derretido / Melted Cheese", "**Con Frijoles / With Beans (+$0.50)", "Frijoles Refritos / Refried Beans"]), ["(QGD) Queso Gordita (+$0.50)", "**Con Frijoles / With Beans (+$0.50)"]);
  assert.ok(run("gordita con queso, extra queso derretido", "gdt", ["(QGD) Queso Gordita (+$0.50)", "Queso Derretido / Melted Cheese"]).includes("Queso Derretido / Melted Cheese"));
});
test("case1: the last tortilla word wins — '¿de harina o de maíz?' … 'De maíz' → Comal", () => {
  assert.deepEqual(run("Oh, prensado", "qsd", ["(QHR) Quesadilla Harina / Flour (+$0.75)", "Prensado / Spicy Pork (+$0.50)"], [{ role: "customer", text: "¿De chicharrón dorada o de harina o de maíz?" }, { role: "customer", text: "De maíz." }]), ["(QCO) Quesadilla de Comal / Homemade", "Prensado / Spicy Pork (+$0.50)"]);
  assert.deepEqual(run("de harina", "qsd", ["(QHR) Quesadilla Harina / Flour (+$0.75)"], [{ role: "customer", text: "de maíz no, mejor" }]), ["(QHR) Quesadilla Harina / Flour (+$0.75)"]);
});
import { mergeMods } from "../../src/call-scoring.ts";
test("case1: updating a gordita to queso gordita replaces the variation (never GD + QGD on one line)", () => {
  const m = mergeMods([{ option: "(GD) Gordita" }, { option: "**Con Frijoles / With Beans (+$0.50)" }], [{ option: "(QGD) Queso Gordita (+$0.50)" }, { option: "Bistec / Steak" }]).map((x: any) => x.option);
  assert.deepEqual(m, ["**Con Frijoles / With Beans (+$0.50)", "(QGD) Queso Gordita (+$0.50)", "Bistec / Steak"]);
});
test("case1e: 'de chicharrón dorada … De maíz … prensado' is a Quesadilla Dorada with prensado", () => {
  const m2: any[] = [...menu, { id: "qd", name: "(QD) Quesadilla Dorada", modifierGroups: [{ name: "Size", options: [{ name: "(QD) REGULAR Dorada" }] }, { name: "Carnes", options: [{ name: "Prensado / Spicy Pork (+$0.50)" }, { name: "Bistec / Steak" }] }] }];
  const r: any = caseFix({ language: "es", reply: "x", actions: [{ type: "add_item", itemId: "qsd", quantity: 1, modifiers: [{ step: "", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { step: "", option: "Prensado / Spicy Pork (+$0.50)" }] }] } as any,
    { transcript: "Oh, prensado", language: "es", menu: m2, resolverMenu: m2, history: [{ role: "customer", text: "¿De cuál? De chicharrón. ¿De chicharrón dorada o de harina o de maíz?" }, { role: "customer", text: "De maíz." }] } as any);
  assert.equal(r.actions[0].itemId, "qd");
  assert.deepEqual(r.actions[0].modifiers.map((m: any) => m.option), ["(QD) REGULAR Dorada", "Prensado / Spicy Pork (+$0.50)"]);
  const plain: any = caseFix({ language: "es", reply: "x", actions: [{ type: "add_item", itemId: "qsd", quantity: 1, modifiers: [] }] } as any, { transcript: "una quesadilla de comal", language: "es", menu: m2, resolverMenu: m2, history: [] } as any);
  assert.equal(plain.actions[0].itemId, "qsd");
});
