import assert from "node:assert/strict";
import test from "node:test";
import { applyStaffReadback } from "../../src/list-repair.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";

const menu = frozenPhoneMenu();
const previousConfirm = process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY;
test.before(() => { delete process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY; });
test.after(() => {
  if (previousConfirm === undefined) delete process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY;
  else process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY = previousConfirm;
});

const taco = (meat: string, tortilla: string, qty = 1) => ({
  itemId: "sq-taco-TAR7L5",
  quantity: qty,
  modifiers: [
    { step: "(B) T Carnes / Meats Opciones", option: meat },
    { step: "(A) T Tortilla Options", option: tortilla },
  ],
});
const quesadilla = (meat: string, tortilla: string, qty = 1) => ({
  itemId: "sq-quesadilla-HLT6CR",
  quantity: qty,
  modifiers: [
    { step: "(B) Q Carnes / Meats", option: meat },
    { step: "(A) Q Tortilla Options", option: tortilla },
  ],
});

test("a disagreed readback keeps the caller's taco meat and tortilla", () => {
  const cart = [
    taco("Chorizo / Mexican Sausage", "(TCO) Taco Comal / Homemade (+$1.00)", 4),
    quesadilla("Pollo / Chicken", "(QCO) Quesadilla Comal / Homemade (+$1.00)", 2),
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Dame cuatro tacos de comal de chorizo y dos quesadillas de comal de pollo." },
    { speaker: "staff", text: "Te tengo cuatro tacos taqueros de bistec y dos quesadillas de harina de pastor." },
  ], menu, true);
  assert.match(JSON.stringify(cart[0].modifiers), /Chorizo/);
  assert.match(JSON.stringify(cart[0].modifiers), /Comal/);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /Street|Taquero|Bistec/);
  assert.match(JSON.stringify(cart[1].modifiers), /Pollo/);
  assert.match(JSON.stringify(cart[1].modifiers), /Comal/);
  assert.equal(cart[0].quantity, 4);
  assert.equal(cart[1].quantity, 2);
  const flags = ((cart as any).readbackFlags || []).join(" ");
  assert.match(flags, /meat:/);
  assert.match(flags, /style:/);
});

test("an unclear reply still keeps the caller's harina and meat", () => {
  const cart = [
    taco("Lengua / Beef Tongue (+$0.50)", "(THR) Taco Harina / Flour (+$0.50)", 3),
    quesadilla("Picadillo / Ground Beef with Potatoes", "(QHR) Quesadilla Harina / Flour", 1),
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Me regala tres tacos de harina de lengua y una quesadilla de harina de picadillo." },
    { speaker: "staff", text: "Te tengo tres tacos de comal de cabeza y una quesadilla de comal de bistec." },
    { speaker: "caller", text: "Mmm, a ver, dejame pensar." },
  ], menu, true);
  assert.match(JSON.stringify(cart[0].modifiers), /Lengua/);
  assert.match(JSON.stringify(cart[0].modifiers), /Harina|Flour/);
  assert.match(JSON.stringify(cart[1].modifiers), /Picadillo/);
  assert.match(JSON.stringify(cart[1].modifiers), /Harina|Flour/);
  const flags = ((cart as any).readbackFlags || []).join(" ");
  assert.match(flags, /meat:/);
  assert.match(flags, /style:/);
});

test("a disagreed taco readback leaves the burrito line alone", () => {
  const burrito = {
    itemId: "sq-burrito-example",
    quantity: 1,
    modifiers: [{ step: "(B) Burrito Carne Options", option: "Carnitas / Pulled Pork (+$1.00)" }],
  };
  const cart = [
    taco("Chorizo / Mexican Sausage", "(TCO) Taco Comal / Homemade (+$1.00)", 2),
    quesadilla("Pollo / Chicken", "(QCO) Quesadilla Comal / Homemade (+$1.00)", 1),
    burrito,
  ];
  const before = JSON.stringify(burrito);
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Dos tacos de comal de chorizo y una quesadilla de comal de pollo, y un burrito de carnitas." },
    { speaker: "staff", text: "Te tengo dos tacos taqueros de pastor y una quesadilla de harina de bistec." },
  ], menu, true);
  assert.equal(JSON.stringify(cart[2]), before);
  assert.equal(cart[2].quantity, 1);
});
