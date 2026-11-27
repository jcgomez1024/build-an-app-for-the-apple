import assert from "node:assert/strict";
import test from "node:test";
import { applyCorrections, correctionPlan } from "../../src/corrections.ts";
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

test("a bare ah between gorditas and sopes does not drop the gorditas", () => {
  const cart: any[] = [gorditaLine("(GD) Gordita", "Bistec / Steak")];
  applyCorrections(cart, [T("caller", "Dos gorditas de bistec, ah, dos sopes de pastor.")], menu);
  assert.equal(cart.some((l) => String(l.itemId) === gordita.id), true);
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

test("quitales the onion or the cheese does not delete the chicken tacos", () => {
  for (const said of ["Quítale la cebolla a los de pollo.", "Quítale el queso a los de pollo.", "Remove the onions from the chicken tacos."]) {
    const cart: any[] = [{ itemId: taco.id, quantity: 2, modifiers: [meat("Pollo / Chicken")] }];
    applyCorrections(cart, [T("caller", said)], menu);
    assert.equal(cart.length, 1, said);
    assert.equal(cart[0].quantity, 2, said);
    assert.match(styleOf(cart[0]), /pollo/i, said);
  }
});

test("quitame uno de tripa does not delete all three", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 3, modifiers: [meat("Tripa / Beef Tripe")] }];
  applyCorrections(cart, [T("caller", "Quítame uno de tripa.")], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
});

test("a staff number that is not the order does not change a line", () => {
  const probes = [
    [T("staff", "¿Dos minutos está bien?"), T("caller", "No, diez.")],
    [T("staff", "¿Dos horchatas?"), T("caller", "No, una.")],
    [T("staff", "¿Una persona?"), T("caller", "No.")],
    [T("staff", "¿Dos de harina?"), T("caller", "No, de comal.")],
  ];
  for (const turns of probes) {
    const cart: any[] = [{ itemId: taco.id, quantity: 2, modifiers: [meat("Bistec / Steak")] }];
    applyCorrections(cart, turns, menu);
    assert.equal(cart.length, 1);
    assert.equal(cart[0].quantity, 2);
    assert.match(styleOf(cart[0]), /bistec/i);
  }
});

test("otra then a staff tres and a yes does not leave one bistec", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 2, modifiers: [meat("Bistec / Steak")] }];
  applyCorrections(cart, [
    T("caller", "Otra de bistec."),
    T("staff", "¿Tres de bistec?"),
    T("caller", "Sí."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.notEqual(cart[0].quantity, 1);
  assert.equal(cart[0].quantity, 2);
});

test("si cuatro is not forced down to three", () => {
  const cart: any[] = [{ itemId: burrito.id, quantity: 4, modifiers: [{ step: "(B) Burrito Carne Options", option: "Bistec / Steak" }] }];
  applyCorrections(cart, [
    T("staff", "¿Tres burritos?"),
    T("caller", "Sí, cuatro."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 4);
});

test("no before the gorditas does not turn them into sopes", () => {
  const cart: any[] = [
    gorditaLine("(GD) Gordita", "Duro / Pork Rinds"),
    gorditaLine("(GD) Gordita", "Duro / Pork Rinds"),
  ];
  applyCorrections(cart, [T("caller", "No, nomás dos gorditas de duro y dos sopes de bistec.")], menu);
  assert.equal(cart.filter((l) => String(l.itemId) === gordita.id).length, 2);
});

test("perdon between gorditas and sopes does not drop either meat", () => {
  const cart: any[] = [
    gorditaLine("(GD) Gordita", "Duro / Pork Rinds"),
    gorditaLine("(GD) Gordita", "Bistec / Steak"),
  ];
  applyCorrections(cart, [T("caller", "Dos gorditas, una de duro y una de bistec, perdón, dos sopes de bistec.")], menu);
  assert.equal(cart.filter((l) => String(l.itemId) === gordita.id).length, 2);
});

test("este and aparte do not delete the gorditas", () => {
  const cart: any[] = [gorditaLine("(GD) Gordita", "Duro / Pork Rinds")];
  applyCorrections(cart, [T("caller", "Dos gorditas de duro, este, aparte dos sopes de pastor.")], menu);
  assert.equal(cart.filter((l) => String(l.itemId) === gordita.id).length, 1);
});

test("dame tres de pollo nomas does not lower the pastor tacos", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 4, modifiers: [meat("Alpastor / Roasted Pork")] }];
  applyCorrections(cart, [
    T("caller", "Cuatro tacos de pastor."),
    T("caller", "Dame tres de pollo, nomás."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 4);
});

test("me pone cuatro de tripa nada mas does not lower the steak tacos", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 6, modifiers: [meat("Bistec / Steak")] }];
  applyCorrections(cart, [
    T("caller", "Seis tacos de bistec."),
    T("caller", "Me pone cuatro de tripa, nada más."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 6);
});

test("nada mas uno con queso does not lower the taco count", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 3, modifiers: [meat("Alpastor / Roasted Pork")] }];
  applyCorrections(cart, [
    T("caller", "Tres tacos de pastor."),
    T("caller", "Nada más uno con queso."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
});

test("nomas dos con cebolla does not lower the taco count", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 3, modifiers: [meat("Bistec / Steak")] }];
  applyCorrections(cart, [
    T("caller", "Tres tacos de bistec."),
    T("caller", "Nomás dos con cebolla."),
  ], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
});

test("nada mas uno sin cebolla does not lower the taco count", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 3, modifiers: [meat("Alpastor / Roasted Pork")] }];
  applyCorrections(cart, [
    T("caller", "Tres tacos de pastor."),
    T("caller", "Nada más uno, sin la cebolla."),
  ], menu);
  assert.equal(cart[0].quantity, 3);
});

test("nada mas that retells the other tacos does not lower the count", () => {
  const cart: any[] = [{ itemId: taco.id, quantity: 3, modifiers: [meat("Bistec / Steak")] }];
  applyCorrections(cart, [
    T("caller", "Tres tacos de bistec."),
    T("caller", "Nada más uno en harina, y los demás en maíz."),
  ], menu);
  assert.equal(cart[0].quantity, 3);
});

test("con todo and de todo do not mark a dorada deluxe", () => {
  for (const said of ["No, mejor una quesadilla dorada de bistec con todo.", "En vez de los tacos, una quesadilla de bistec de todo."]) {
    const plan = correctionPlan([T("caller", "Tres tacos de bistec."), T("caller", said)]);
    assert.equal(plan.ensure.some((slot) => slot.qd === "preparada"), false, said);
  }
});

test("a swap that cannot land the new item does not empty the cart", () => {
  const cart: any[] = [{ itemId: burrito.id, quantity: 2, modifiers: [{ step: "(B) Burrito Carne Options", option: "Bistec / Steak" }] }];
  applyCorrections(cart, [
    T("caller", "2 burritos."),
    T("caller", "No, mejor dos tacos de bistec."),
  ], menu);
  assert.ok(cart.length > 0);
  assert.equal(cart.some((l) => String(l.itemId) === burrito.id), true);
});

function lineMeatsOf(line: any): string[] {
  return (line.modifiers || []).map((m: any) => String(m.option)).join(" ").toLowerCase().includes("pastor") ? ["alpastor"]
    : (line.modifiers || []).map((m: any) => String(m.option)).join(" ").toLowerCase().includes("bistec") ? ["bistec"]
    : (line.modifiers || []).map((m: any) => String(m.option)).join(" ").toLowerCase().includes("duro") ? ["duro"]
    : [];
}
