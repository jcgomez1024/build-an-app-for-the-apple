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
const burrito = menu.find((item) => /^sq-burrito-/.test(String(item.id)) && !/combo/.test(String(item.id)));
const sope = menu.find((item) => /^sq-sopesaso-/.test(String(item.id)));
const gorditaLine = (option: string, meatName: string) => ({ itemId: gordita.id, quantity: 1, modifiers: [{ step: "(A) Gordita Options", option }, meat(meatName)] });
const isQueso = (line: any) => /\(QGD\)/.test(styleOf(line));
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

test("a later con queso does not change the earlier plain gordita", () => {
  const cart: any[] = [
    gorditaLine("(GD) Gordita", "Duro / Pork Rinds"),
    gorditaLine("(GD) Gordita", "Duro / Pork Rinds"),
  ];
  applyCorrections(cart, [
    T("caller", "Una gordita de duro."),
    T("caller", "Otra gordita de duro con queso."),
  ], menu);
  assert.equal(isQueso(cart[0]), false);
  assert.equal(isQueso(cart[1]), true);
});

test("another gordita with cheese leaves the first one plain", () => {
  const cart: any[] = [
    gorditaLine("(GD) Gordita", "Bistec / Steak"),
    gorditaLine("(GD) Gordita", "Bistec / Steak"),
  ];
  applyCorrections(cart, [
    T("caller", "One gordita, steak."),
    T("caller", "Y otra de bistec, con queso por favor."),
  ], menu);
  assert.equal(isQueso(cart[0]), false);
  assert.equal(isQueso(cart[1]), true);
});

test("gorditas stay when the same turn also orders sopes", () => {
  const cart: any[] = [
    gorditaLine("(GD) Gordita", "Duro / Pork Rinds"),
    { itemId: sope.id, quantity: 2, modifiers: [meat("Duro / Pork Rinds")] },
  ];
  applyCorrections(cart, [T("caller", "Dos gorditas de duro y dos sopes de duro.")], menu);
  assert.equal(cart.some((l) => String(l.itemId) === gordita.id), true);
  assert.equal(cart.filter((l) => String(l.itemId) === sope.id).every((l) => lineMeatsOf(l).length <= 1), true);
});

test("a self correction to sopes drops the gorditas and does not fuse their meat onto the sope", () => {
  const cart: any[] = [
    gorditaLine("(GD) Gordita", "Bistec / Steak"),
  ];
  applyCorrections(cart, [T("caller", "Dos gorditas de bistec, ah, dos sopes de pastor.")], menu);
  assert.equal(cart.some((l) => String(l.itemId) === gordita.id), false);
  const sopes = cart.filter((l) => /sope/i.test(String(l.itemId)));
  assert.equal(sopes.length, 1);
  assert.deepEqual(lineMeatsOf(sopes[0]), ["alpastor"]);
});

test("an empty cart stays empty when the caller adds queso", () => {
  const cart: any[] = [];
  applyCorrections(cart, [
    T("caller", "Dos gorditas de duro."),
    T("caller", "Me las haces con queso."),
  ], menu);
  assert.equal(cart.length, 0);
});

test("an empty cart stays empty when the caller swaps a meat", () => {
  const cart: any[] = [];
  applyCorrections(cart, [
    T("caller", "Two steak tacos."),
    T("caller", "No, make them chicken."),
  ], menu);
  assert.equal(cart.length, 0);
});

test("a burrito does not gain crema or queso fresco from a correction", () => {
  const mods = [
    { step: "(A) Burrito Size", option: "Regular '10" },
    { step: "(B) Burrito Carne Options", option: "Bistec / Steak" },
  ];
  const cart: any[] = [{ itemId: burrito.id, quantity: 3, modifiers: mods.map((m) => ({ ...m })) }];
  applyCorrections(cart, [
    T("caller", "Póngame tres burritos de bistec."),
    T("caller", "No me le pongas ni queso ni crema."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
  assert.equal(/crema|queso fresco/i.test(styleOf(cart[0])), false);
  const english: any[] = [{ itemId: burrito.id, quantity: 1, modifiers: mods.map((m) => ({ ...m })) }];
  applyCorrections(english, [
    T("caller", "One steak burrito."),
    T("caller", "No cheese and no sour cream on it."),
  ], menu);
  assert.equal(english.length, 1);
  assert.equal(/crema|queso fresco/i.test(styleOf(english[0])), false);
});

test("torteada is not comal and dedos de is not de", () => {
  const bare = { itemId: quesadilla.id, quantity: 1, modifiers: [meat("Chorizo / Mexican Sausage")] };
  const cart: any[] = [{ ...bare, modifiers: bare.modifiers.map((m) => ({ ...m })) }];
  applyCorrections(cart, [T("caller", "La quesadilla de chorizo va torteada.")], menu);
  assert.equal(/comal|QCO|harina|QHR/i.test(styleOf(cart[0])), false);
  const other: any[] = [{ itemId: taco.id, quantity: 2, modifiers: [meat("Costilla / Beef Rib")] }];
  applyCorrections(other, [T("caller", "Esos dos dedos de costilla, torteada.")], menu);
  assert.equal(/comal|TCO|harina/i.test(styleOf(other[0])), false);
});

test("quitales los de tripa removes that line and leaves the other meat", () => {
  const cart: any[] = [
    { itemId: taco.id, quantity: 2, modifiers: [meat("Tripa / Beef Tripe")] },
    { itemId: taco.id, quantity: 1, modifiers: [meat("Bistec / Steak")] },
  ];
  applyCorrections(cart, [T("caller", "Quítale los de tripa.")], menu);
  assert.equal(cart.some((l) => /tripa/i.test(styleOf(l))), false);
  assert.equal(cart.some((l) => /bistec/i.test(styleOf(l))), true);
});

test("quita las de pollo removes the chicken and leaves the steak", () => {
  const cart: any[] = [
    { itemId: quesadilla.id, quantity: 1, modifiers: [tortilla("QCO"), meat("Pollo / Chicken")] },
    { itemId: quesadilla.id, quantity: 2, modifiers: [tortilla("QHR"), meat("Bistec / Steak")] },
  ];
  applyCorrections(cart, [T("caller", "Quita las de pollo, por favor.")], menu);
  assert.equal(cart.some((l) => /pollo/i.test(styleOf(l))), false);
  assert.equal(cart.filter((l) => /bistec/i.test(styleOf(l))).length, 1);
});

test("en vez de pastor de bistec changes the pastor line and does not add one", () => {
  const cart: any[] = [
    { itemId: taco.id, quantity: 2, modifiers: [meat("Alpastor / Roasted Pork")] },
  ];
  applyCorrections(cart, [T("caller", "En vez de pastor, de bistec.")], menu);
  assert.equal(cart.length, 1);
  assert.match(styleOf(cart[0]), /bistec/i);
  assert.doesNotMatch(styleOf(cart[0]), /pastor/i);
  const none: any[] = [];
  applyCorrections(none, [T("caller", "En vez de pastor, de bistec.")], menu);
  assert.equal(none.length, 0);
});

test("instead of the chicken, steak, retargets the line", () => {
  const cart: any[] = [
    { itemId: quesadilla.id, quantity: 1, modifiers: [tortilla("QCO"), meat("Pollo / Chicken")] },
  ];
  applyCorrections(cart, [T("caller", "En vez de pollo, de bistec.")], menu);
  assert.equal(cart.length, 1);
  assert.match(styleOf(cart[0]), /bistec/i);
  assert.doesNotMatch(styleOf(cart[0]), /pollo/i);
});

test("no tres after a staff dos keeps the caller's count", () => {
  const cart: any[] = [{ itemId: burrito.id, quantity: 2, modifiers: [{ step: "(B) Burrito Carne Options", option: "Bistec / Steak" }] }];
  applyCorrections(cart, [
    T("caller", "Tres burritos."),
    T("staff", "¿Dos?"),
    T("caller", "No, tres."),
  ], menu);
  assert.equal(cart[0].quantity, 3);
});

test("no four after a staff three keeps four tacos", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 3, modifiers: [meat("Bistec / Steak")] }];
  applyCorrections(cart, [
    T("caller", "Four tacos."),
    T("staff", "Three?"),
    T("caller", "No, four."),
  ], menu);
  assert.equal(cart[0].quantity, 4);
});

test("otra does not become a staff tres", () => {
  const cart: any[] = [{ itemId: quesadilla.id, quantity: 3, modifiers: [tortilla("QCO"), meat("Bistec / Steak")] }];
  applyCorrections(cart, [
    T("caller", "Una quesadilla de bistec."),
    T("caller", "Otra de bistec."),
    T("staff", "Tres quesadillas de bistec."),
  ], menu);
  assert.equal(cart[0].quantity, 2);
});

test("another steak taco does not become the staff count of three", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 3, modifiers: [meat("Bistec / Steak")] }];
  applyCorrections(cart, [
    T("caller", "One steak taco."),
    T("caller", "Another steak taco."),
    T("staff", "Three tacos."),
  ], menu);
  assert.equal(cart[0].quantity, 2);
});

test("otra orden with its own count does not shrink that count", () => {
  const cart: any[] = [{ itemId: burrito.id, quantity: 2, modifiers: [meat("Bistec / Steak")] }];
  applyCorrections(cart, [
    T("caller", "Si, otra orden. Dos burritos de bistec."),
    T("staff", "Dos burritos de bistec."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
});

test("otra va a ser does not shrink the pastor quesadillas", () => {
  const cart: any[] = [{ itemId: quesadilla.id, quantity: 2, modifiers: [tortilla("QCO"), meat("Alpastor / Roasted Pork")] }];
  applyCorrections(cart, [
    T("caller", "Dos quesadillas de pastor."),
    T("caller", "Otra va a ser."),
    T("staff", "Dos quesadillas de pastor."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
});

test("otra quesadilla de buche does not raise that line to the earlier tres", () => {
  const cart: any[] = [{ itemId: quesadilla.id, quantity: 1, modifiers: [tortilla("QCO"), meat("Buche / Pork Stomach")] }];
  applyCorrections(cart, [
    T("caller", "Van a ser tres quesadillas."),
    T("caller", "Y va a ser otra quesadilla de comal, de buche."),
    T("staff", "Una quesadilla de comal de buche."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 1);
});

test("la otra vez is not one more taco", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 2, modifiers: [meat("Tripa / Beef Tripe")] }];
  applyCorrections(cart, [
    T("caller", "Dos tacos de tripa."),
    T("caller", "La otra vez pedi tacos de maiz."),
    T("staff", "Dos tacos de tripa."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
});

function lineMeatsOf(line: any): string[] {
  return (line.modifiers || []).map((m: any) => String(m.option)).join(" ").toLowerCase().includes("pastor") ? ["alpastor"]
    : (line.modifiers || []).map((m: any) => String(m.option)).join(" ").toLowerCase().includes("bistec") ? ["bistec"]
    : (line.modifiers || []).map((m: any) => String(m.option)).join(" ").toLowerCase().includes("duro") ? ["duro"]
    : [];
}
