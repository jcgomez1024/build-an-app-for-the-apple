// jesus2 (CA470a613ba5c233398dc3f5fcece2bd9f ~5:23 PM ET Oct 29): Jesús, Spanish pickup, staff answered, 69 s.
// Live miss: 2 QCO chorizo only + Queso Torta chorizo only + unrequested Queso Derretido; Coke read back "taparrosca".
// Truth (Square $17.99): 2 QCO bistec+chorizo ("chorizo y guisquel combinado", staff "bistec con chorizo"),
// 1 Queso Torta bistec+chorizo ("con queso"), 1 Coca Cola de vidrio. Pickup, Jesús.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T17:23:00-04:00";
const { shadowOrderFromTurns, rewriteCallerText } = await import("../../src/call-scoring.ts");
const { caseFix } = await import("../../src/elvi.ts");
const { applySharedAliases } = await import("../../src/aliases.ts");
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA470a61-turns.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-QSD001", T = "sq-torta-WYSN2Q", C = "sq-drink-coca-cola-JJE4KC";
const meats = ["Bistec / Steak", "Chorizo / Mexican Sausage", "Pollo / Chicken"].map((name) => ({ name }));
const con = [{ name: "**Con Frijoles / With Beans" }, { name: "**EXTRA Queso Derretido / Melted Cheese" }];
const menu: any[] = [
  { id: Q, name: "Quesadilla", modifierGroups: [{ name: "(A) Q Tortilla Options", minSelections: 1, maxSelections: 1, options: [{ name: "(QCO) Quesadilla de Comal / Homemade" }, { name: "(QHR) Quesadilla de Harina / Flour" }] }, { name: "(B) Q Carnes / Meats", minSelections: 1, maxSelections: 2, options: meats }, { name: "(C) Con / With", options: con }] },
  { id: T, name: "Torta", modifierGroups: [{ name: "(A) Torta Options", minSelections: 1, maxSelections: 1, options: [{ name: "(TO) Torta" }, { name: "(QTO) Queso Torta" }] }, { name: "(B) Torta Carne Options", minSelections: 1, maxSelections: 2, options: meats }, { name: "(C) Con / With", options: con }] },
  { id: C, name: "Coca Cola", modifierGroups: [] },
];
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option));
const live = (transcript: string, actions: any[], history: any[] = [], reply = "x") =>
  caseFix({ language: "es", reply, actions } as any, { transcript: applySharedAliases(transcript, "app"), language: "es", menu, resolverMenu: menu, history } as any) as any;

test("jesus2: shared aliases (live 'app' scope + shadow 'phone')", () => {
  for (const sc of ["app", "phone"] as const) {
    assert.match(applySharedAliases("dos quesadillas de comal de chorizo y guisquel combinado", sc), /chorizo y bistec combinado/);
    assert.match(applySharedAliases("Y una cuca de vino.", sc), /coca de vidrio/);
    assert.match(applySharedAliases("can I get, queso burias?", sc), /Queso Birrias/);
    assert.match(applySharedAliases("taggitorizo and steak", sc), /^chorizo and steak/);
    assert.equal(applySharedAliases("chorizo", sc), "chorizo");
    assert.match(applySharedAliases("I need a large street corn", sc), /large esquite/);
  }
  assert.match(applySharedAliases("a large street corn", "fulfillment"), /esquite/);
  assert.ok(rewriteCallerText);
});
test("jesus2 LIVE caseFix: combinado → both meats on the line", () => {
  const r = live("dos quesadillas de comal de chorizo y guisquel combinado", [{ type: "add_item", itemId: Q, quantity: 2, modifiers: [{ step: "(A)", option: "(QCO) Quesadilla de Comal / Homemade" }, { step: "(B)", option: "Chorizo / Mexican Sausage" }] }]);
  const o = opts(r.actions[0]);
  assert.ok(o.includes("Bistec / Steak") && o.includes("Chorizo / Mexican Sausage"), JSON.stringify(o));
  // two separate lines stay separate
  const r2 = live("de comal, una de chorizo y una de bistec", [{ type: "add_item", itemId: Q, quantity: 1, modifiers: [{ step: "(A)", option: "(QCO) Quesadilla de Comal / Homemade" }, { step: "(B)", option: "Chorizo / Mexican Sausage" }] }]);
  assert.deepEqual(opts(r2.actions[0]), ["(QCO) Quesadilla de Comal / Homemade", "Chorizo / Mexican Sausage"]);
});
test("jesus2 LIVE caseFix: torta 'con queso' → QTO, no Queso Derretido; extra queso keeps it", () => {
  const add = () => [{ type: "add_item", itemId: T, quantity: 1, modifiers: [{ step: "(A)", option: "(QTO) Queso Torta" }, { step: "(B)", option: "Chorizo / Mexican Sausage" }, { step: "(C)", option: " Queso Derretido / Melted Cheese" }] }];
  const r = live("Con queso, por favor.", add(), [{ role: "customer", text: "Y una torta igual de chorizo y guisquel." }]);
  assert.ok(!opts(r.actions[0]).some((o: string) => /derretido|melted/i.test(o)), JSON.stringify(r.actions));
  const r0 = live("Con queso, por favor.", [{ type: "add_item", itemId: T, quantity: 1, modifiers: [{ step: "(A)", option: "(TO) Torta" }, { step: "(C)", option: "**EXTRA Queso Derretido / Melted Cheese" }] }], [{ role: "customer", text: "una torta de bistec" }]);
  assert.ok(opts(r0.actions[0]).includes("(QTO) Queso Torta") && !opts(r0.actions[0]).includes("(TO) Torta"), JSON.stringify(r0.actions));
  assert.ok(!opts(r0.actions[0]).some((o: string) => /derretido/i.test(o)));
  const rx = live("queso torta con extra queso derretido", add());
  assert.ok(opts(rx.actions[0]).some((o: string) => /derretido/i.test(o)));
  const rb = live("Y una torta igual de chorizo y guisquel.", [{ type: "add_item", itemId: T, quantity: 1, modifiers: [{ step: "(A)", option: "(TO) Torta" }, { step: "(B)", option: "Chorizo / Mexican Sausage" }] }]);
  assert.ok(opts(rb.actions[0]).includes("Bistec / Steak"), JSON.stringify(rb.actions));
});
test("jesus2 LIVE caseFix: coca de vidrio reads back glass, not taparrosca", () => {
  const r = live("Y una cuca de vino.", [{ type: "add_item", itemId: C, quantity: 1, modifiers: [] }], [], "Una coca taparrosca. ¿Algo más?");
  assert.equal(r.actions[0].readback, "Coca Cola de vidrio");
  assert.ok(!/taparrosca/i.test(r.reply), r.reply);
  const plain = live("y una coca", [{ type: "add_item", itemId: C, quantity: 1, modifiers: [] }]);
  assert.equal(plain.actions[0].readback, undefined);
});
test("jesus2 LIVE caseFix: double meat (rich1 port)", () => {
  const m2 = [{ id: "qb", name: "Queso Birrias", modifierGroups: [{ name: "EXTRA Carne / Meat", options: [{ name: "DOUBLE Carne / Meat" }] }] }];
  const r: any = caseFix({ language: "en", reply: "x", actions: [{ type: "add_item", itemId: "qb", quantity: 1, modifiers: [] }] } as any, { transcript: "queso birrias double meat", language: "en", menu: m2, resolverMenu: m2, history: [] } as any);
  assert.ok(opts(r.actions[0]).includes("DOUBLE Carne / Meat"));
});

// Shadow replay with a stub that repeats the live miss
const stubLiveMiss = async (text: string) => {
  if (/quesadilla/i.test(text)) return { reply: "Dos quesadillas.", actions: [{ type: "add_item", itemId: Q, quantity: 2, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" }, { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] }] };
  if (/torta/i.test(text)) return { reply: "Una torta.", actions: [{ type: "add_item", itemId: T, quantity: 1, modifiers: [{ step: "(A) Torta Options", option: "(QTO) Queso Torta" }, { step: "(B) Torta Carne Options", option: "Chorizo / Mexican Sausage" }, { step: "(C) Con / With", option: " Queso Derretido / Melted Cheese" }] }] };
  if (/coca|vidrio/i.test(text)) return { reply: "Una coca taparrosca.", actions: [{ type: "add_item", itemId: C, quantity: 1, modifiers: [] }] };
  return { reply: "¿Algo más?", actions: [] };
};
test("jesus2: replay → 2 QCO bistec+chorizo, Queso Torta bistec+chorizo no melted, coca de vidrio", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const d = JSON.stringify(r.cart);
  const q = r.cart.find((l: any) => l.itemId === Q); const t = r.cart.find((l: any) => l.itemId === T); const c = r.cart.find((l: any) => /coca/.test(l.itemId));
  assert.ok(q && q.quantity === 2 && opts(q).includes("Bistec / Steak") && opts(q).includes("Chorizo / Mexican Sausage"), d);
  assert.ok(t && opts(t).some((o: string) => /QTO/.test(o)) && opts(t).includes("Bistec / Steak") && opts(t).includes("Chorizo / Mexican Sausage"), d);
  assert.ok(!opts(t).some((o: string) => /derretido|melted/i.test(o)), d);
  assert.ok(c && c.quantity === 1 && /vidrio/i.test(String(c.readback || "")) && !/taparrosca/i.test(String(c.readback || "")), d);
  assert.equal(r.cart.length, 3, d);
  assert.equal(r.fulfillment ?? "PICKUP", "PICKUP");
});
