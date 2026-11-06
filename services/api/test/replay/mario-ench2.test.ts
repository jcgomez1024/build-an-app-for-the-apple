// mario-ench2 (CAdd04d8, Nov 6 ~3:38 PM ET): "dos orden de enchilada" asks the meat;
// "dos orden de enchilada de pollo" is qty 2 of the online orden with Pollo. Not mario1 (jarrito).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMenuRequest } from "../../src/menu-intelligence.ts";
import { ENCH_ID } from "../../src/readback-pass.ts";

const item = {
  id: ENCH_ID, name: "Enchiladas", nameEs: "Enchiladas", aliases: ["enchiladas", "enchilada"], priceCents: 1499,
  modifierGroups: [{ id: "c", name: "(A) Enchiladas Carne Options (ONLINE)", minSelections: 1, maxSelections: 4, options: [{ id: "p", name: "Pollo / Chicken", priceDeltaCents: 0 }] }],
};
const ask = (text: string) => resolveMenuRequest([item] as any, { text, language: "es", actionHint: "add_item", toolArgs: { itemQuery: text } } as any);

test("mario-ench2: two orders ask for the meat, then two orders of pollo", () => {
  const open = ask("dos orden de enchilada");
  assert.equal(open.reason, "missing_required_modifiers");
  assert.notEqual(open.reason, "unknown_menu_item");
  const done = ask("dos orden de enchilada de pollo");
  assert.equal(done.ok, true);
  assert.equal(done.actions[0].itemId, ENCH_ID);
  assert.equal(done.actions[0].quantity, 2);
  assert.equal(done.actions[0].modifiers[0].option, "Pollo / Chicken");
});
