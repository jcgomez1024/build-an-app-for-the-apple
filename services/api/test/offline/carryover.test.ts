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

test("chicos change a taco, and normales on a dorada stay regular", () => {
  const tacos = carryoverWants([T("caller", "Cuatro tacos de los chicos de bistec.")]);
  assert.equal(tacos[0]?.kind, "taco");
  assert.equal(tacos[0]?.style, "taquero");
  const doradas = carryoverWants([
    T("caller", "Dos quesadillas doradas de bistec."),
    T("caller", "Preparadas."),
    T("caller", "Y otras dos aparte normales, de bistec también."),
  ]);
  assert.equal(doradas.find((w) => w.qd === "preparada")?.n, 2);
  assert.equal(doradas.find((w) => w.qd === "regular")?.n, 2);
  assert.equal(doradas.some((w) => w.style === "taquero"), false);
});

test("a dorada is not a comal quesadilla, and a comal is not a dorada", () => {
  const fried = carryoverWants([T("caller", "Dos quesadillas duradas de bistec preparadas.")]);
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

test("plain docena y media is comal, twelve and six", () => {
  const cart: any[] = [{ itemId: "sq-tortillas-12-x-tortilla-taquera-corn-street-VEQC2Z", quantity: 1, modifiers: [] }];
  applyCarryover(cart, [T("caller", "Una docena y media de tortillas, doce y seis.")], menu);
  assert.equal(cart.some((l) => l.itemId === "sq-tortillas-12-x-tortilla-comal-handmade-VGID3H"), true);
  assert.equal(cart.some((l) => l.itemId === "sq-tortillas-6-x-tortilla-comal-handmade-YQG6N4"), true);
  assert.equal(cart.some((l) => /taquera/.test(String(l.itemId))), false);
});

test("yes to deluxe preparadas flips a regular dorada, and sin queso does not make a queso gordita", () => {
  const cart: any[] = [{ itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: 4, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCarryover(cart, [
    T("caller", "Cuatro quesadillas doradas de bistec."),
    T("staff", "¿Te gustarían deluxe preparadas?"),
    T("caller", "Sí, por favor."),
  ], menu);
  assert.equal(cart[0].itemId, "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L");
  const gordita = carryoverWants([T("caller", "Cinco gorditas de bistec, sin queso.")]);
  assert.equal(gordita[0]?.queso, false);
});
