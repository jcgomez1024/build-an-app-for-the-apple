import assert from "node:assert/strict";
import test from "node:test";
import { applyCarryover, carryoverWants } from "../../src/carryover.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";

const menu = frozenPhoneMenu();
const T = (speaker: string, text: string) => ({ speaker, text });
const of = (wants: ReturnType<typeof carryoverWants>, kind: string, meat: string) => wants.filter((w) => w.kind === kind && w.meats.join("/") === meat);

test("a tortilla style does not move onto the next dish", () => {
  const wants = carryoverWants([
    T("caller", "Dos quesadillas de comal de bistec."),
    T("caller", "Y cuatro tacos de bistec."),
  ]);
  assert.equal(of(wants, "quesadilla", "bistec")[0]?.style, "comal");
  assert.equal(of(wants, "taco", "bistec")[0]?.style, "");
  assert.equal(of(wants, "taco", "bistec")[0]?.n, 4);
});

test("a meat said for the gordita does not ride onto the tacos", () => {
  const wants = carryoverWants([
    T("caller", "Una gordita de prensado."),
    T("caller", "Y dos tacos de costilla."),
  ]);
  assert.deepEqual(of(wants, "gordita", "prensado")[0]?.meats, ["prensado"]);
  assert.deepEqual(of(wants, "taco", "costilla")[0]?.meats, ["costilla"]);
  assert.equal(wants.some((w) => w.kind === "taco" && w.meats.includes("prensado")), false);
});

test("X con Y stays one line and una de X y una de Y stays two", () => {
  const together = carryoverWants([T("caller", "Dos quesadillas doradas de bistec con chorizo.")]);
  assert.equal(together.length, 1);
  assert.deepEqual(together[0].meats, ["bistec", "chorizo"]);
  assert.equal(together[0].kind, "qd");
  const apart = carryoverWants([T("caller", "Una quesadilla de comal de bistec y una de chorizo.")]);
  assert.equal(of(apart, "quesadilla", "bistec")[0]?.n, 1);
  assert.equal(of(apart, "quesadilla", "chorizo")[0]?.n, 1);
  assert.equal(apart.some((w) => w.meats.length > 1), false);
});

test("a staff style guess is not the style, and it does not override the caller", () => {
  const unanswered = carryoverWants([
    T("caller", "Tres quesadillas de bistec."),
    T("staff", "¿Del comal?"),
  ]);
  assert.equal(unanswered[0]?.style, "");
  assert.notEqual(unanswered[0]?.kind, "qd");
  const yes = carryoverWants([
    T("caller", "Tres quesadillas de bistec."),
    T("staff", "¿Del comal?"),
    T("caller", "Sí."),
  ]);
  assert.equal(yes[0]?.kind, "quesadilla");
  assert.equal(yes[0]?.style, "comal");
  const override = carryoverWants([
    T("caller", "Dos quesadillas de harina de pollo."),
    T("staff", "¿Del comal?"),
    T("caller", "No, de harina."),
  ]);
  assert.equal(of(override, "quesadilla", "pollo")[0]?.style, "harina");
});

test("an opening total is not the first meat when per-meat counts follow", () => {
  const wants = carryoverWants([
    T("caller", "Tres quesadillas doradas."),
    T("caller", "Dos de pastor y una de lengua."),
  ]);
  assert.equal(of(wants, "qd", "alpastor")[0]?.n, 2);
  assert.equal(of(wants, "qd", "lengua")[0]?.n, 1);
  assert.equal(wants.reduce((s, w) => s + w.n, 0), 3);
});

test("chicos and tortilla normal are street tacos, and normales on a dorada stay regular", () => {
  const tacos = carryoverWants([T("caller", "Cuatro tacos de los chicos de bistec.")]);
  assert.equal(tacos[0]?.kind, "taco");
  assert.equal(tacos[0]?.style, "taquero");
  const normal = carryoverWants([T("caller", "Dos tacos de tortilla normal de costilla.")]);
  assert.equal(normal[0]?.style, "taquero");
  const los = carryoverWants([T("caller", "Dos tacos de los normales de bistec.")]);
  assert.equal(los[0]?.style, "");
  const grande = carryoverWants([T("caller", "Dos tacos de la grande de bistec.")]);
  assert.equal(grande[0]?.style, "comal");
  const doradas = carryoverWants([
    T("caller", "Dos quesadillas doradas de bistec."),
    T("caller", "Preparadas."),
    T("caller", "Y otras dos aparte normales, de bistec también."),
  ]);
  assert.equal(doradas.find((w) => w.qd === "preparada")?.n, 2);
  assert.equal(doradas.find((w) => w.qd === "regular")?.n, 2);
});

test("a dorada is not a comal quesadilla, and a comal is not a dorada", () => {
  const spelled = carryoverWants([T("caller", "Dos quesadillas duradas de bistec preparadas.")]);
  assert.equal(spelled[0]?.kind, "qd");
  assert.equal(spelled[0]?.qd, "preparada");
  assert.equal(carryoverWants([T("caller", "Dos quesadillas de comas de tripa.")])[0]?.style, "comal");
  assert.equal(carryoverWants([T("caller", "Una quesadilla de harin de pollo.")])[0]?.style, "harina");
  const fried = carryoverWants([T("caller", "Dos quesadillas doradas de bistec preparadas.")]);
  assert.equal(fried[0]?.kind, "qd");
  assert.equal(fried[0]?.qd, "preparada");
  const comal = carryoverWants([T("caller", "Dos quesadillas de comal de tripa.")]);
  assert.equal(comal[0]?.kind, "quesadilla");
  assert.equal(comal[0]?.style, "comal");
});

test("con frijoles stays on the items that said it", () => {
  const wants = carryoverWants([
    T("caller", "Dos quesadillas doradas de huevo con frijoles."),
    T("caller", "Y dos de deshebrada."),
    T("caller", "Todas con frijoles menos las de deshebrada."),
  ]);
  assert.equal(of(wants, "qd", "huevo")[0]?.frij, true);
  assert.equal(of(wants, "qd", "deshebrada")[0]?.frij, false);
});

test("a repeated count does not double, and otras N adds", () => {
  const wants = carryoverWants([
    T("caller", "Siete quesadillas de bistec de tortilla de maiz con extra queso."),
    T("caller", "Siete quesadillas de bistec de tortilla de maiz con extra queso."),
    T("caller", "Otras tres."),
  ]);
  assert.equal(wants[0]?.n, 10);
  assert.equal(wants[0]?.xqueso, true);
  assert.equal(wants[0]?.style, "comal");
});

function pack(count: 6 | 12): string {
  const item = menu.find((row) => new RegExp(`tortillas-${count}-x-tortilla-comal`, "i").test(String(row.id)));
  return item ? String(item.id) : "";
}
const qd = (preparada: boolean) => menu.find((item) => /^sq-qd-/.test(String(item.id)) && (preparada ? /deluxe|preparada/i : /regular/i).test(`${item.id} ${item.name || ""}`));

test("docena rings tortillas only in the same phrase, and not on an empty cart", () => {
  const empty: any[] = [];
  applyCarryover(empty, [T("caller", "Una docena y media de tortillas."), T("caller", "Two orders of peppers and onions.")], menu);
  assert.equal(empty.length, 0);
  const bare: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(bare, [T("caller", "Una docena.")], menu);
  assert.equal(bare.some((l) => /tortilla/.test(String(l.itemId))), false);
  const cart: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(cart, [T("caller", "Una docena y media de tortillas.")], menu);
  assert.equal(cart.some((l) => l.itemId === pack(12)), true);
  assert.equal(cart.some((l) => l.itemId === pack(6)), true);
});

test("con todo on sopes does not put deluxe on a gordita", () => {
  const gordita = menu.find((item) => /^sq-gordita-/.test(String(item.id)));
  const cart: any[] = [{ itemId: gordita.id, quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, { step: "(A) Gordita Options", option: "(GD) Gordita" }] }];
  applyCarryover(cart, [
    T("caller", "Dos gorditas de bistec."),
    T("caller", "Dos sopes de bistec con todo."),
  ], menu);
  assert.equal(cart.some((l) => (l.modifiers || []).some((m: any) => /DELUXE \(Lechuga/i.test(String(m.option)))), false);
});

test("a missing deluxe half is not added once that meat is already at its count", () => {
  const regular = qd(false);
  const cart: any[] = [{ itemId: regular.id, quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" }] }];
  applyCarryover(cart, [
    T("caller", "Dos quesadillas doradas de picadillo."),
    T("caller", "Con todo."),
    T("caller", "Una quesadilla dorada de prensado."),
  ], menu);
  const prensado = cart.filter((l) => /prensado/i.test(JSON.stringify(l.modifiers)));
  assert.equal(prensado.length, 1);
  assert.equal(prensado[0].quantity, 2);
  assert.match(String(prensado[0].itemId), /regular/i);
});

test("a drink is not a dish, and tortillas do not skip the onion side", () => {
  const horchata = menu.find((item) => /^sq-drink-agua-fresca-horchata/.test(String(item.id)));
  const drinks: any[] = [{ itemId: horchata.id, quantity: 1, modifiers: [] }];
  applyCarryover(drinks, [T("caller", "Y cebolla asada.")], menu);
  assert.equal(drinks.some((l) => /cebolla/.test(String(l.itemId))), false);
  assert.equal(drinks.some((l) => /tortilla/.test(String(l.itemId))), false);
  const withPack: any[] = [{ itemId: horchata.id, quantity: 1, modifiers: [] }];
  applyCarryover(withPack, [T("caller", "Una horchata, una docena de tortillas y peppers and onions.")], menu);
  assert.equal(withPack.some((l) => l.itemId === pack(12)), true);
  assert.equal(withPack.some((l) => /cebolla/.test(String(l.itemId))), true);
  const food: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(food, [T("caller", "Una docena de tortillas y peppers and onions.")], menu);
  assert.equal(food.some((l) => l.itemId === pack(12)), true);
  assert.equal(food.some((l) => /cebolla/.test(String(l.itemId))), true);
  const split: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(split, [
    T("caller", "Tacos de asada con cebolla."),
    T("caller", "Chiles toreados aparte."),
  ], menu);
  assert.equal(split.some((l) => /cebolla/.test(String(l.itemId))), false);
  const onePhrase: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(onePhrase, [T("caller", "Quiero cebolla con chiles asados.")], menu);
  assert.equal(onePhrase.some((l) => /cebolla/.test(String(l.itemId))), true);
  const otherWording: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] }];
  applyCarryover(otherWording, [T("caller", "Add cebolla y chile asado on the side.")], menu);
  assert.equal(otherWording.some((l) => /cebolla/.test(String(l.itemId))), true);
  const asadaMeat: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(asadaMeat, [T("caller", "Tres tacos de asada con cebolla y unos chiles toreados.")], menu);
  assert.equal(asadaMeat.some((l) => /cebolla/.test(String(l.itemId))), false);
  const asaditos: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(asaditos, [T("caller", "Y me le pones cebollita y chilitos asaditos.")], menu);
  assert.equal(asaditos.some((l) => /cebolla/.test(String(l.itemId))), true);
  const onion: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(onion, [T("caller", "A esas normales les puede poner cebolla asada.")], menu);
  assert.equal(onion.some((l) => /cebolla/.test(String(l.itemId))), true);
  const onions: any[] = [{ itemId: qd(false).id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] }];
  applyCarryover(onions, [T("caller", "Add cebollas asadas on the side.")], menu);
  assert.equal(onions.some((l) => /cebolla/.test(String(l.itemId))), true);
});

test("yes to deluxe preparadas flips a regular dorada, and sin queso does not make a queso gordita", () => {
  const regular = qd(false);
  const deluxe = qd(true);
  const cart: any[] = [{ itemId: regular.id, quantity: 4, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(cart, [
    T("caller", "Cuatro quesadillas doradas de bistec."),
    T("staff", "¿Te gustarían deluxe preparadas?"),
    T("caller", "Sí, por favor."),
  ], menu);
  assert.equal(cart[0].itemId, deluxe.id);
  const gordita = carryoverWants([T("caller", "Cinco gorditas de bistec, sin queso.")]);
  assert.equal(gordita[0]?.queso, false);
  assert.equal(carryoverWants([T("caller", "Dos tacos de biste.")])[0]?.meats[0], "bistec");
});
