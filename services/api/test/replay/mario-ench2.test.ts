// mario-ench2 (CAdd04d8): "dos orden de enchilada" / "de pollo" on the real phone menu,
// which also contains Tacos al Vapor. Vapor's description says "these enchiladas", so a tied
// score used to pick vapor. Not mario1 (jarrito). Isolated enchilada-only menus hide this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMenuRequest } from "../../src/menu-intelligence.ts";
import { ENCH_ID, VAPOR_ID } from "../../src/readback-pass.ts";

const menu = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const ask = (text: string) => resolveMenuRequest(menu, { text, language: "es", actionHint: "add_item", toolArgs: { itemQuery: text } } as any);
const idOf = (r: any) => r.actions?.[0]?.itemId || r.selectedItem?.itemId;

test("mario-ench2: full menu has both dishes; enchilada orders are enchiladas, not steamed tacos", () => {
  assert.ok(menu.some((i: any) => i.id === ENCH_ID));
  assert.ok(menu.some((i: any) => i.id === VAPOR_ID));
  const open = ask("dos orden de enchilada");
  assert.equal(open.reason, "missing_required_modifiers");
  assert.equal(idOf(open), ENCH_ID);
  const done = ask("dos orden de enchilada de pollo");
  assert.equal(done.ok, true);
  assert.equal(done.actions[0].itemId, ENCH_ID);
  assert.equal(done.actions[0].quantity, 2);
  assert.equal(done.actions[0].modifiers[0].option, "Pollo / Chicken");
  const three = ask("tres órdenes de enchilada. Sí.");
  assert.equal(three.reason, "missing_required_modifiers");
  assert.equal(idOf(three), ENCH_ID);
  const threePollo = ask("tres órdenes de enchilada de pollo");
  assert.equal(threePollo.ok, true);
  assert.equal(threePollo.actions[0].itemId, ENCH_ID);
  assert.equal(threePollo.actions[0].quantity, 3);
  assert.equal(threePollo.actions[0].modifiers[0].option, "Pollo / Chicken");
  assert.notEqual(idOf(ask("tacos al vapor de pollo")), ENCH_ID);
});

test("mario-ench2: a decimal price stays one token", () => {
  const agua = [{ id: "a250", name: "Agua 2.50", aliases: [] }, { id: "a", name: "Agua", aliases: ["2", "50"] }];
  const r = resolveMenuRequest(agua as any, { text: "agua 2.50", language: "es", actionHint: "add_item", toolArgs: { itemQuery: "agua 2.50" } } as any);
  assert.equal(idOf(r), "a250");
});
