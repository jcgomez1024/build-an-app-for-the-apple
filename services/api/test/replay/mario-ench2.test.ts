// mario-ench2 (CAdd04d8) on the recorded phone menu, which has Taco, Tacos al Vapor,
// Tacos Dorados, and Enchiladas together. "tacos al vapor" must be the vapor SKU.
// A copied vapor description that says "enchiladas" must not steal an enchilada order.
// Not mario1 (jarrito). An enchilada-only menu hides both collisions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMenuRequest } from "../../src/menu-intelligence.ts";
import { ENCH_ID, VAPOR_ID } from "../../src/readback-pass.ts";

const TACO = "sq-taco-TAR7L5";
const DORADOS = "sq-tacos-dorados-tacos-dorados-OHFWF3";
const menu = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const ask = (text: string) => resolveMenuRequest(menu, { text, language: "es", actionHint: "add_item", toolArgs: { itemQuery: text } } as any);
const idOf = (r: any) => r.actions?.[0]?.itemId || r.selectedItem?.itemId;
const mods = (r: any) => r.actions?.[0]?.modifiers || r.provided || [];

test("mario-ench2: full menu keeps generic tacos, steamed tacos, and enchiladas apart", () => {
  assert.ok(menu.some((i: any) => i.id === TACO && i.name === "Taco"));
  assert.ok(menu.some((i: any) => i.id === VAPOR_ID));
  assert.ok(menu.some((i: any) => i.id === DORADOS));
  assert.ok(menu.some((i: any) => i.id === ENCH_ID));

  const vapor = ask("tacos al vapor de pollo");
  assert.equal(vapor.ok, true);
  assert.equal(vapor.actions[0].itemId, VAPOR_ID);
  assert.equal(vapor.actions[0].quantity, 1);
  assert.equal(vapor.actions[0].modifiers.length, 1);
  assert.match(vapor.actions[0].modifiers[0].groupName, /vapor/i);
  assert.equal(vapor.actions[0].modifiers[0].option, "Pollo / Chicken");

  const bareVapor = ask("una orden de tacos al vapor");
  assert.equal(bareVapor.reason, "missing_required_modifiers");
  assert.equal(idOf(bareVapor), VAPOR_ID);
  assert.match(bareVapor.requiredGroups[0].groupName, /vapor/i);

  const soft = ask("un taco de pollo");
  assert.equal(idOf(soft), TACO);
  assert.equal(mods(soft)[0].groupName, "(B) T Carnes / Meats Opciones");
  assert.equal(mods(soft)[0].option, "Pollo / Chicken");
  assert.equal(soft.requiredGroups[0].groupName, "(A) T Tortilla Options");

  const two = ask("dos tacos de pollo");
  assert.equal(idOf(two), TACO);
  assert.equal(mods(two)[0].option, "Pollo / Chicken");
  assert.equal(two.requiredGroups[0].groupName, "(A) T Tortilla Options");

  const flour = ask("tacos de harina de pollo");
  assert.equal(flour.ok, true);
  assert.equal(flour.actions[0].itemId, TACO);
  assert.ok(flour.actions[0].modifiers.some((m: any) => m.option === "Pollo / Chicken" && /carnes|meats/i.test(m.groupName)));
  assert.ok(flour.actions[0].modifiers.some((m: any) => /harina|flour/i.test(m.option)));

  const comal = ask("tacos de comal");
  assert.equal(idOf(comal), TACO);
  assert.ok(mods(comal).some((m: any) => /comal|homemade/i.test(m.option)));

  const steak = ask("taco de bistec");
  assert.equal(idOf(steak), TACO);
  assert.equal(mods(steak)[0].option, "Bistec / Steak");

  const dorados = ask("tacos dorados");
  assert.equal(idOf(dorados), DORADOS);
  const doradosPollo = ask("tacos dorados de pollo");
  assert.equal(doradosPollo.ok, true);
  assert.equal(doradosPollo.actions[0].itemId, DORADOS);
  assert.equal(doradosPollo.actions[0].modifiers[0].option, "Pollo / Chicken");

  const open = ask("dos orden de enchilada");
  assert.equal(open.reason, "missing_required_modifiers");
  assert.equal(idOf(open), ENCH_ID);
  const done = ask("dos orden de enchilada de pollo");
  assert.equal(done.ok, true);
  assert.equal(done.actions[0].itemId, ENCH_ID);
  assert.equal(done.actions[0].quantity, 2);
  assert.equal(done.actions[0].modifiers[0].option, "Pollo / Chicken");
  const plural = ask("enchiladas de pollo");
  assert.equal(plural.actions[0].itemId, ENCH_ID);
  assert.equal(plural.actions[0].modifiers[0].option, "Pollo / Chicken");
  const three = ask("tres órdenes de enchilada. Sí.");
  assert.equal(three.reason, "missing_required_modifiers");
  assert.equal(idOf(three), ENCH_ID);
});

test("mario-ench2: a decimal price stays one token", () => {
  const agua = [{ id: "a250", name: "Agua 2.50", aliases: [] }, { id: "a", name: "Agua", aliases: ["2", "50"] }];
  const r = resolveMenuRequest(agua as any, { text: "agua 2.50", language: "es", actionHint: "add_item", toolArgs: { itemQuery: "agua 2.50" } } as any);
  assert.equal(idOf(r), "a250");
});
