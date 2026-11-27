import assert from "node:assert/strict";
import test from "node:test";
import { applyCorrections } from "../../src/corrections.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";

const menu = frozenPhoneMenu();
const T = (speaker: string, text: string) => ({ speaker, text });
const quesadilla = menu.find((item) => /^sq-quesadilla-/.test(String(item.id)) && !/combo|pack|platter/.test(String(item.id)));
const gordita = menu.find((item) => /^sq-gordita-[A-Z0-9]+$/.test(String(item.id)));
const taco = menu.find((item) => /^sq-taco-/.test(String(item.id)));
const menudo = menu.find((item) => /^sq-menudo-menudo-con-tortillas/.test(String(item.id)));
const tortilla = (style: "QCO" | "QHR") => ({ step: "(A) Q Tortilla Options", option: style === "QCO" ? "(QCO) Quesadilla Comal / Homemade" : "(QHR) Quesadilla Harina / Flour" });
const meat = (name: string) => ({ step: "(B) Q Carnes / Meats", option: name });
const styleOf = (line: any) => (line.modifiers || []).map((m: any) => String(m.option)).join(" ");

test("no, de harina replaces that line's style and does not touch the other meat", () => {
  const cart: any[] = [
    { itemId: quesadilla.id, quantity: 1, modifiers: [tortilla("QCO"), meat("Chorizo / Mexican Sausage")] },
    { itemId: quesadilla.id, quantity: 1, modifiers: [tortilla("QCO"), meat("Tripa / Beef Tripe")] },
  ];
  applyCorrections(cart, [
    T("caller", "Una quesadilla de chorizo."),
    T("staff", "De comal, verdad?"),
    T("caller", "No, de harina."),
    T("caller", "Y una quesadilla de tripa de comal."),
  ], menu);
  const chorizo = cart.filter((l) => /chorizo/i.test(styleOf(l)));
  const tripa = cart.filter((l) => /tripa/i.test(styleOf(l)));
  assert.equal(chorizo.length, 1);
  assert.match(styleOf(chorizo[0]), /QHR|Harina|Flour/);
  assert.doesNotMatch(styleOf(chorizo[0]), /QCO/);
  assert.equal(tripa.length, 1);
  assert.match(styleOf(tripa[0]), /QCO|Comal/);
});

test("en vez de replaces one meat's dish and leaves the other meat and an unrelated item", () => {
  const cart: any[] = [
    { itemId: menudo.id, quantity: 1, modifiers: [] },
    { itemId: quesadilla.id, quantity: 3, modifiers: [tortilla("QCO"), meat("Tripa / Beef Tripe")] },
    { itemId: quesadilla.id, quantity: 3, modifiers: [tortilla("QCO"), meat("Bistec / Steak")] },
  ];
  applyCorrections(cart, [
    T("caller", "Tres quesadillas de tripa al comal."),
    T("caller", "Tres quesadillas de bistec al comal."),
    T("caller", "No, mejor tres tacos de bistec, quesadillas de bistec no."),
  ], menu);
  assert.equal(cart.filter((l) => String(l.itemId) === menudo.id).length, 1);
  assert.equal(cart.some((l) => String(l.itemId) === quesadilla.id && /bistec/i.test(styleOf(l))), false);
  assert.equal(cart.some((l) => String(l.itemId) === quesadilla.id && /tripa/i.test(styleOf(l))), true);
  const tacos = cart.filter((l) => String(l.itemId) === taco.id && /bistec/i.test(styleOf(l)));
  assert.equal(tacos.length, 1);
  assert.equal(tacos[0].quantity, 3);
});

test("con queso changes the gorditas and does not add a second item", () => {
  const cart: any[] = [
    { itemId: gordita.id, quantity: 1, modifiers: [{ step: "(A) Gordita Options", option: "(GD) Gordita" }, meat("Duro / Pork Rinds")] },
    { itemId: gordita.id, quantity: 1, modifiers: [{ step: "(A) Gordita Options", option: "(GD) Gordita" }, meat("Nopales con Papas / Cacti with Potatoes")] },
  ];
  applyCorrections(cart, [
    T("caller", "Me pone dos gorditas, una de duro y una de nopales."),
    T("caller", "Me les puede poner queso."),
  ], menu);
  const gorditas = cart.filter((l) => String(l.itemId) === gordita.id);
  assert.equal(gorditas.length, 2);
  assert.equal(gorditas.every((l) => /\(QGD\)/.test(styleOf(l))), true);
  assert.equal(gorditas.some((l) => /^\(GD\)/.test(styleOf(l)) || styleOf(l).includes("(GD) Gordita") && !styleOf(l).includes("QGD")), false);
});

test("a name or a drink does not shrink the count, and silence is not a yes", () => {
  const cart: any[] = [
    { itemId: gordita.id, quantity: 2, modifiers: [{ step: "(A) Gordita Options", option: "(QGD) Queso Gordita" }, meat("Picadillo / Ground Beef with Potatoes")] },
  ];
  applyCorrections(cart, [
    T("caller", "Van a ser dos queso gorditas de picadillo."),
    T("staff", "A nombre de quien?"),
    T("caller", "Mauricio, y me puede poner un agua de horchata."),
    T("staff", "Unos diez minutos."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
  const quiet: any[] = [
    { itemId: quesadilla.id, quantity: 2, modifiers: [tortilla("QCO"), meat("Bistec / Steak")] },
  ];
  applyCorrections(quiet, [
    T("caller", "Dos quesadillas de bistec."),
    T("staff", "¿Tres?"),
  ], menu);
  assert.equal(quiet[0].quantity, 2);
  applyCorrections(quiet, [
    T("caller", "Dos quesadillas de bistec."),
    T("staff", "¿Dos?"),
    T("caller", "Sí."),
  ], menu);
  assert.equal(quiet[0].quantity, 2);
});
