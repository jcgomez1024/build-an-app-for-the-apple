import assert from "node:assert/strict";
import test from "node:test";
import { applyLineScopedQuantity, applyStaffReadback } from "../../src/list-repair.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";

const menu = frozenPhoneMenu();

test("a shadow staff readback does not add lines the cart does not have", () => {
  const cart: any[] = [];
  const turns = [
    { speaker: "caller", text: "Quiero ordenar." },
    { speaker: "staff", text: "Te tengo tres tacos de pastor y dos quesadillas de bistec." },
  ];
  applyStaffReadback(cart, turns, menu, true);
  assert.equal(cart.length, 0);
  const live: any[] = [];
  applyStaffReadback(live, turns, menu, false);
  assert.equal(live.length, 2);
});

test("a later count changes only the named line", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyLineScopedQuantity(cart, [
    { speaker: "caller", text: "Six tacos of chorizo." },
    { speaker: "caller", text: "Seis tacos de chorizo." },
  ]);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 6);
});
