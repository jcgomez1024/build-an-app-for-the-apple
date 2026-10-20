// rice1: "con arroz / with rice / arrocito" = the "**Con Arroz / With Rice" add-on (+$0.50) on items that have it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withRiceAddon } from "../../src/standard-toppings.ts";
import { auditCall } from "../../src/auditor.ts";
import { applySharedAliases } from "../../src/aliases.ts";

const menu = [{ id: "q", name: "Quesadilla", modifierGroups: [
  { name: "(A) Tortilla", options: [{ name: "(QCO) Quesadilla de Comal / Homemade" }] },
  { name: "(B) Q Carnes / Meats", options: [{ name: "Bistec / Steak" }, { name: "Arroz / Rice" }] },
  { name: "(C) Con / With", options: [{ name: "**Con Arroz / With Rice", priceDeltaCents: 50 }] }] },
  { id: "b", name: "Burrito", modifierGroups: [{ name: "(C) Burrito Options", options: [{ name: "Arroz / Rice" }] }] }];
const add = (itemId: string, opts: string[]) => [{ type: "add_item", itemId, quantity: 2, modifiers: opts.map((option) => ({ step: "x", option })) }];
const opts = (r: any) => r[0].modifiers.map((m: any) => m.option);

test("rice1: 'steak and rice' / 'con arroz' / 'arrocito' → Con Arroz add-on, not rice as a filling", () => {
  assert.deepEqual(opts(withRiceAddon(add("q", ["(QCO) Quesadilla de Comal / Homemade", "Bistec / Steak", "Arroz / Rice"]), menu, "two comal quesadillas, steak and rice")), ["(QCO) Quesadilla de Comal / Homemade", "Bistec / Steak", "**Con Arroz / With Rice"]);
  assert.deepEqual(opts(withRiceAddon(add("q", ["Bistec / Steak"]), menu, "de bistec con arroz")), ["Bistec / Steak", "**Con Arroz / With Rice"]);
  assert.deepEqual(opts(withRiceAddon(add("q", ["Bistec / Steak"]), menu, "de bistec con arrocito")), ["Bistec / Steak", "**Con Arroz / With Rice"]);
  assert.equal(applySharedAliases("con arrocito", "phone"), "con arroz");
});

test("rice1: rice as the only filling stays a filling; items without the add-on are untouched", () => {
  assert.deepEqual(opts(withRiceAddon(add("q", ["Arroz / Rice"]), menu, "una quesadilla de arroz")), ["Arroz / Rice"]);
  assert.deepEqual(opts(withRiceAddon(add("b", ["Arroz / Rice"]), menu, "burrito with rice")), ["Arroz / Rice"]);
});

test("rice1: caller asked for rice, ticket lacks it → STAFF_MISSING (Elvi listen-only), not ELVI_MISS", () => {
  const e = { name: "Quesadilla", baseName: "Quesadilla", variationId: "V", quantity: 2, choices: ["Bistec / Steak", "**Con Arroz / With Rice"], totalCents: 1000 };
  const t = { ...e, choices: ["Bistec / Steak"], totalCents: 900 };
  const row = { recordingSid: "RE", at: new Date(0).toISOString(), recordingSec: 30, turns: [{ speaker: "caller", text: "two quesadillas with steak and rice" }, { speaker: "staff", text: "okay, anything else?" }], elvi: [e], ticket: { lines: [t] }, pairs: [{ ticket: t, elvi: e }] };
  assert.deepEqual(auditCall(row, Date.now())!.flags.map((f) => f.type), ["STAFF_MISSING"]);
});
