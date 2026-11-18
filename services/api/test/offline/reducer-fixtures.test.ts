import assert from "node:assert/strict";
import test from "node:test";
import { applyCompanionMeats, companionMeatOrders } from "../../src/list-repair.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";
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

test("X con Y puts both meats on each quesadilla", () => {
  const said = "Dos quesadillas de bistec con chorizo.";
  assert.deepEqual(companionMeatOrders(said), [{ fam: "quesadilla", qty: 2, meats: ["bistec", "chorizo"] }]);
  const cart = [
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyCompanionMeats(cart, [{ speaker: "caller", text: said }], frozenPhoneMenu());
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
  const options = (cart[0].modifiers || []).map((mod) => String(mod.option));
  assert.equal(options.filter((option) => /bistec/i.test(option)).length, 1);
  assert.equal(options.filter((option) => /chorizo/i.test(option)).length, 1);
});

test("goodbye and filler phrases are never names, EN and ES", () => {
  assert.equal(nameFromTranscriptInfo([{ speaker: "caller", text: "Goodbye." }, { speaker: "staff", text: "Bye." }]), null);
  assert.equal(nameFromTranscriptInfo([{ speaker: "caller", text: "Hasta luego." }, { speaker: "staff", text: "Adiós." }]), null);
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "Okay, and." }]), null);
});
