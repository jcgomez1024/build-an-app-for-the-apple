// addons1 (Carlos): con frijoles / con queso fresco / extra queso derretido = paid "(C) Con / With" add-ons (+$0.50),
// except when it's the sole filling or the dish already includes it (sopesaso/huarache con todo, QD DELUXE Preparada).
import { test } from "node:test";
import assert from "node:assert/strict";
import { withConAddons } from "../../src/standard-toppings.ts";
import { auditCall } from "../../src/auditor.ts";
import { applySharedAliases } from "../../src/aliases.ts";

const CON = { name: "(C) Con / With", options: [
  { name: "**Con Frijoles / With Beans (+$0.50)", priceDeltaCents: 50 }, { name: "**Con Arroz / With Rice (+$0.50)", priceDeltaCents: 50 },
  { name: "**Con Queso Fresco / With Cheese (+$0.50)", priceDeltaCents: 50 }, { name: "**EXTRA Queso Derretido / Melted Cheese (+$0.50)", priceDeltaCents: 50 }] };
const MEATS = { name: "(B) Q Carnes / Meats", options: [{ name: "Bistec / Steak" }, { name: "Frijoles Refritos / Refried Beans" }, { name: "Queso Derretido / Melted Cheese" }] };
const menu = [
  { id: "q", name: "Quesadilla", modifierGroups: [MEATS, CON] },
  { id: "dlx", name: "(QD) Quesadilla Dorada (QD) DELUXE Preparada", modifierGroups: [MEATS, CON] },
  { id: "s", name: "Sopesaso Elvis", modifierGroups: [{ name: "(B) Toppings", options: [{ name: "Frijoles / Pinto Beans" }, { name: "Queso Fresco / Fresco Cheese" }] }] }];
const add = (itemId: string, opts: string[]) => [{ type: "add_item", itemId, quantity: 1, modifiers: opts.map((option) => ({ step: "x", option })) }];
const opts = (r: any) => r[0].modifiers.map((m: any) => m.option);

test("addons1: con frijoles / con queso fresco / extra queso derretido → paid add-ons", () => {
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak"]), menu, "una quesadilla de bistec con frijoles")), ["Bistec / Steak", "**Con Frijoles / With Beans (+$0.50)"]);
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak", "Frijoles Refritos / Refried Beans"]), menu, "steak quesadilla with beans")), ["Bistec / Steak", "**Con Frijoles / With Beans (+$0.50)"]);
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak"]), menu, "de bistec con queso fresco")), ["Bistec / Steak", "**Con Queso Fresco / With Cheese (+$0.50)"]);
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak"]), menu, "steak, extra melted cheese")), ["Bistec / Steak", "**EXTRA Queso Derretido / Melted Cheese (+$0.50)"]);
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak"]), menu, "de bistec con arroz y frijoles")), ["Bistec / Steak", "**Con Arroz / With Rice (+$0.50)", "**Con Frijoles / With Beans (+$0.50)"]);
});

test("addons1: sole filling stays the filling; included toppings never charged", () => {
  assert.deepEqual(opts(withConAddons(add("q", ["Frijoles Refritos / Refried Beans"]), menu, "una quesadilla de frijoles")), ["Frijoles Refritos / Refried Beans"]);
  assert.deepEqual(opts(withConAddons(add("dlx", ["Bistec / Steak"]), menu, "dorada deluxe de bistec con queso fresco")), ["Bistec / Steak"]);
  assert.deepEqual(opts(withConAddons(add("s", ["Frijoles / Pinto Beans"]), menu, "sopesaso con todo, con frijoles y queso fresco")), ["Frijoles / Pinto Beans"]);
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak"]), menu, "steak quesadilla, extra cheese")), ["Bistec / Steak"]); // plain "extra cheese" isn't the add-on
});

test("addons1: aliases", () => {
  assert.equal(applySharedAliases("con frijolitos", "phone"), "con frijoles");
  assert.equal(applySharedAliases("con quesito fresco", "phone"), "con queso fresco");
});

test("addons1: auditor — add-on said but not rung → STAFF_MISSING; not said → ELVI_MISS; sopesaso frijoles not an add-on", () => {
  const row = (text: string, eCh: string[], tCh: string[], name = "Quesadilla") => {
    const e = { name, baseName: name, variationId: "V", quantity: 1, choices: eCh, totalCents: 1000 }; const t = { ...e, choices: tCh };
    return { recordingSid: "RE", at: new Date(0).toISOString(), recordingSec: 30, turns: [{ speaker: "caller", text }, { speaker: "staff", text: "okay, anything else?" }], elvi: [e], ticket: { lines: [t] }, pairs: [{ ticket: t, elvi: e }] };
  };
  const types = (r: any) => auditCall(r, Date.now())!.flags.map((f) => f.type);
  assert.deepEqual(types(row("una de bistec con frijoles", ["Bistec / Steak", "**Con Frijoles / With Beans (+$0.50)"], ["Bistec / Steak"])), ["STAFF_MISSING"]);
  assert.deepEqual(types(row("una de bistec, extra melted cheese", ["Bistec / Steak", "**EXTRA Queso Derretido / Melted Cheese (+$0.50)"], ["Bistec / Steak"])), ["STAFF_MISSING"]);
  assert.deepEqual(types(row("una de bistec con queso", ["Bistec / Steak", "**Con Queso Fresco / With Cheese (+$0.50)"], ["Bistec / Steak"])), ["ELVI_MISS"]);
  assert.deepEqual(types(row("sopesaso de bistec con todo", ["Bistec / Steak"], ["Bistec / Steak", "Frijoles / Pinto Beans", "Queso Fresco / Fresco Cheese"], "Sopesaso Elvis")), []);
});
