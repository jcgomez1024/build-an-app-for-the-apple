import assert from "node:assert/strict";
import test from "node:test";
import { applyAffirmedStaffList, applyLineScopedQuantity, applyStaffReadback } from "../../src/list-repair.ts";
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

test("comalde parses as comal and a real style mismatch stays flagged", () => {
  const agreed = applyAffirmedStaffList([], [
    { speaker: "caller", text: "Tres quesadillas al comal de tripa." },
    { speaker: "staff", text: "Dos quesadillas de harina de biste, y una quesadilla de harina de chorizo, y las tres quesadillas de comalde tripa." },
    { speaker: "caller", text: "Sí, cierto." },
  ], menu);
  assert.equal(agreed.flagged.includes("style:sq-quesadilla-HLT6CR"), false, JSON.stringify(agreed.flagged));
  const clash = applyAffirmedStaffList([], [
    { speaker: "caller", text: "Tres quesadillas de harina de tripa." },
    { speaker: "staff", text: "Las tres quesadillas de comal de tripa." },
    { speaker: "caller", text: "Sí, cierto." },
  ], menu);
  assert.ok(clash.flagged.includes("style:sq-quesadilla-HLT6CR"), JSON.stringify(clash.flagged));
});

test("N más does not add again when the cart is already at the new count", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 4, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  const en = [line()];
  const es = [line()];
  applyLineScopedQuantity(en, [{ speaker: "caller", text: "Two more tacos of chorizo." }]);
  applyLineScopedQuantity(es, [{ speaker: "caller", text: "Dos tacos más de chorizo." }]);
  assert.equal(en[0].quantity, 4);
  assert.equal(es[0].quantity, 4);
});

test("otros dos and a trailing más add, EN and ES", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  const en = [line()];
  const es = [line()];
  const esTrail = [line()];
  applyLineScopedQuantity(en, [{ speaker: "caller", text: "Another two tacos of chorizo." }]);
  applyLineScopedQuantity(es, [{ speaker: "caller", text: "Otros dos tacos de chorizo." }]);
  applyLineScopedQuantity(esTrail, [{ speaker: "caller", text: "Dos tacos de chorizo más." }]);
  assert.equal(en[0].quantity, 4);
  assert.equal(es[0].quantity, 4);
  assert.equal(esTrail[0].quantity, 4);
});

test("a leading más does not add again to a line the cart already has", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] },
  ];
  applyLineScopedQuantity(cart, [{ speaker: "caller", text: "Más un taco de harina de pollo." }]);
  assert.equal(cart[0].quantity, 2);
  assert.equal(cart[1].quantity, 1);
});

test("nada más and anything else change nothing", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  for (const text of ["Nada más.", "Algo más.", "Nothing more.", "Anything else."]) {
    const cart = [line()];
    applyLineScopedQuantity(cart, [{ speaker: "caller", text }]);
    assert.equal(cart[0].quantity, 2, text);
  }
});

test("N more adds to the line instead of replacing it, EN and ES", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  const en = [line()];
  const es = [line()];
  applyLineScopedQuantity(en, [{ speaker: "caller", text: "Two more tacos of chorizo." }]);
  applyLineScopedQuantity(es, [{ speaker: "caller", text: "Dos tacos más de chorizo." }]);
  assert.equal(en[0].quantity, 4);
  assert.equal(es[0].quantity, 4);
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
