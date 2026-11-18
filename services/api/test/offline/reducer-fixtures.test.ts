import assert from "node:assert/strict";
import test from "node:test";
import { companionMeatOrders } from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { bindModifier, dropUnavailableOnSwitch, quantityScoped, type ShadowLine } from "../../src/shadow-reducer.ts";

const taco = (quantity: number, option = "Bistec / Steak"): ShadowLine => ({ itemId: "sq-taco-TAR7L5", quantity, modifiers: [{ step: "Carnes", option }] });

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

test("X con Y both meats is pending Carlos", { skip: "pending Carlos: do not lock X con Y as both meats on a quesadilla" }, () => {
  companionMeatOrders("Dos quesadillas de bistec con chorizo.");
});

test("goodbye and filler phrases are never names, EN and ES", () => {
  assert.equal(nameFromTranscriptInfo([{ speaker: "caller", text: "Goodbye." }, { speaker: "staff", text: "Bye." }]), null);
  assert.equal(nameFromTranscriptInfo([{ speaker: "caller", text: "Hasta luego." }, { speaker: "staff", text: "Adiós." }]), null);
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "Okay, and." }]), null);
});
