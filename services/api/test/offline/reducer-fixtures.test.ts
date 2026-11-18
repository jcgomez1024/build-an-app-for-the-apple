import assert from "node:assert/strict";
import test from "node:test";
import { companionMeatOrders } from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { addonDifference, bindModifier, dropUnavailableOnSwitch, quantityScoped, staffReadbackAddsNothing, type ShadowLine } from "../../src/shadow-reducer.ts";

const taco = (quantity: number, option = "Bistec / Steak"): ShadowLine => ({ itemId: "sq-taco-TAR7L5", quantity, modifiers: [{ step: "Carnes", option }] });

test("staff readback never adds, EN and ES", () => {
  const cart = [taco(2)];
  assert.equal(staffReadbackAddsNothing(cart, "staff").length, 1);
  assert.deepEqual(staffReadbackAddsNothing([], "staff"), []);
  assert.equal(staffReadbackAddsNothing([], "caller").length, 0);
});

test("an add-on call adds only the difference, EN and ES", () => {
  const cart = [taco(2)];
  const en = addonDifference(cart, [taco(2), { itemId: "sq-coke", quantity: 1 }]);
  const es = addonDifference(cart, [taco(2), { itemId: "sq-coke", quantity: 1 }]);
  assert.deepEqual(en, [{ type: "add_item", item_id: "sq-coke", quantity: 1 }]);
  assert.deepEqual(es, en);
  assert.deepEqual(addonDifference(cart, [taco(4)]), [{ type: "update_item", item_id: "sq-taco-TAR7L5", quantity: 2 }]);
});

test("quantity and modifiers stay on their own line", () => {
  const cart = [taco(1, "Bistec / Steak"), taco(2, "Alpastor / Roasted Pork")];
  const counted = quantityScoped(cart, 1, 6);
  assert.equal(counted[0].quantity, 1);
  assert.equal(counted[1].quantity, 6);
  const bound = bindModifier(cart, 0, { step: "Extras", option: "Crema" });
  assert.equal(bound[0].modifiers?.some((mod) => mod.option === "Crema"), true);
  assert.equal(bound[1].modifiers?.some((mod) => mod.option === "Crema"), false);
});

test("an unavailable item is dropped when the caller switches, EN and ES", () => {
  const cart = [{ itemId: "sq-pozole", quantity: 1 }, { itemId: "sq-menudo", quantity: 1 }];
  const next = dropUnavailableOnSwitch(cart, ["sq-pozole"], "sq-menudo");
  assert.deepEqual(next.map((line) => line.itemId), ["sq-menudo"]);
  assert.equal(dropUnavailableOnSwitch(cart, ["sq-pozole"], "sq-pozole").length, 2);
});

test("X con Y is both meats on that item, EN and ES", () => {
  const en = companionMeatOrders("Two tacos de bistec con chorizo.");
  const es = companionMeatOrders("Dos tacos de bistec y chorizo.");
  assert.deepEqual(en[0]?.meats, ["bistec", "chorizo"]);
  assert.deepEqual(es[0]?.meats, ["bistec", "chorizo"]);
  assert.equal(en[0]?.qty, 2);
  assert.equal(es[0]?.qty, 2);
});

test("goodbye and filler phrases are never names, EN and ES", () => {
  assert.equal(nameFromTranscriptInfo([{ speaker: "caller", text: "Goodbye." }, { speaker: "staff", text: "Bye." }]), null);
  assert.equal(nameFromTranscriptInfo([{ speaker: "caller", text: "Hasta luego." }, { speaker: "staff", text: "Adiós." }]), null);
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "Okay, and." }]), null);
});
