// laura2 (CAa219aaf, Nov 6 2026 ~5:17 PM ET, 56s, pickup): 5 plain gorditas de duro and
// 3 street tacos de costilla. Staff restates "gorditas de duro"; the caller agrees ("Ujú") and later
// "tortilla normal". The final readback is "cinco gorditas de duro y tres tacos taqueros de costilla."
// Cuero is not a catalog meat and is not mapped to duro unless staff says duro and the caller agrees.
// Combo / meal modifier lists are not valid on a plain gordita. A filler yes does not add a steak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { applyGorditaChicharron, applySeparatedDishOrder, gorditaChicharronMeat } from "../../src/list-repair.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CAa219aaf-laura2.json", import.meta.url), "utf8"));
const GORDITA = "sq-gordita-M647RE";
const TACO = "sq-taco-TAR7L5";
const GD = { step: "(A) Gordita Options", option: "(GD) Gordita" };
const DURO = { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" };
const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
const HUEVO = { step: "(B) Q Carnes / Meats", option: "Huevo con Chile / Spicy Egg" };
const COMBO_SHELL = { step: "(A) Gorditas Option COMBO", option: "(GD) 2 x Gorditas" };
const MEAL_DURO = { step: "(H) Item #8 Carne/Meat Option MEAL", option: "1 x Duro / Pork Rinds" };
const TST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
const TCO = { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade" };
const COSTILLA = { step: "(B) T Carnes / Meats Opciones", option: "Costilla / Beef Rib" };
const TACO_DURO = { step: "(B) T Carnes / Meats Opciones", option: "Duro / Pork Rinds" };

const MENU = [
  { id: GORDITA, name: "Gordita", modifierGroups: [
    { name: "(A) Gordita Options", options: [{ name: GD.option }, { name: "(QGD) Queso Gordita" }] },
    { name: "(B) Q Carnes / Meats", options: [{ name: BISTEC.option }, { name: DURO.option }, { name: HUEVO.option }, { name: "Prensado / Spicy Pork" }] },
  ] },
  { id: "sq-combo-gorditas-PSPNTM", name: "COMBO Gorditas", modifierGroups: [
    { name: "(A) Gorditas Option COMBO", options: [{ name: "(GD) 2 x Gorditas" }] },
    { name: "(B) Item #1 Carne/Meat Option COMBO", options: [{ name: "1 x Duro / Pork Rinds" }, { name: "1 x Bistec / Steak" }] },
  ] },
  { id: "sq-8-pack-meal-gd-8-x-gorditas-RDTXJT", name: "8 Pack MEAL (GD) 8 x Gorditas", modifierGroups: [
    { name: "(H) Item #8 Carne/Meat Option MEAL", options: [{ name: "1 x Duro / Pork Rinds" }, { name: "1 x Bistec / Steak" }] },
  ] },
  { id: TACO, name: "Taco", modifierGroups: [
    { name: "(A) T Tortilla Options", options: [{ name: TCO.option }, { name: "(THR) Taco Harina / Flour" }, { name: TST.option }] },
    { name: "(B) T Carnes / Meats Opciones", options: [{ name: COSTILLA.option }, { name: TACO_DURO.option }, { name: BISTEC.option }] },
  ] },
];

/** The live model asked, then added the lines that landed on the accepted ticket. Which turn created the steak line was not in the action log. */
function stub() {
  let gorditaAsk = false, picked = false, uju = false, tacos = false, comal = false, normal = false, readback = false, filler = false;
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/gorditas?/.test(t) && /cuero|chicharr/.test(t) && !gorditaAsk) {
      gorditaAsk = true;
      return { actions: [], reply: "¿Chicharrón del duro en chile verde o prensado en chile rojo?" };
    }
    if (/duro/.test(t) && /gordita|chicharr/.test(t) && !picked) {
      picked = true;
      return { actions: [{ type: "add_item", itemId: GORDITA, quantity: 5, modifiers: [GD, DURO, HUEVO] }], reply: "Gordita: chicharrón duro y huevo con chile. ¿Algo más?" };
    }
    if (/^uj[uú]\b/.test(t) && !uju) {
      uju = true;
      return { actions: [{ type: "add_item", itemId: GORDITA, quantity: 5, modifiers: [GD, BISTEC] }], reply: "¿Algo más?" };
    }
    if (/tacos?/.test(t) && /costilla/.test(t) && !tacos) {
      tacos = true;
      return {
        actions: [{ type: "add_item", itemId: TACO, quantity: 3, modifiers: [TST, COSTILLA] }],
        reply: "¿Taco Comal, Taco Harina o Taco Taquero?",
      };
    }
    if (/taco comal|del comal/.test(t) && !comal) {
      comal = true;
      return {
        actions: [
          { type: "add_item", itemId: TACO, quantity: 3, modifiers: [TCO, COSTILLA] },
          { type: "add_item", itemId: TACO, quantity: 5, modifiers: [TCO, TACO_DURO] },
        ],
        reply: "Taco comal. ¿Algo más?",
      };
    }
    if (/tortilla normal/.test(t) && !normal) {
      normal = true;
      return { actions: [{ type: "add_item", itemId: TACO, quantity: 5, modifiers: [TST, TACO_DURO] }], reply: "¿Algo más?" };
    }
    if (/le tengo/.test(t) && /gorditas?/.test(t) && /tacos?/.test(t) && !readback) {
      readback = true;
      return {
        actions: [
          { type: "add_item", itemId: TACO, quantity: 5, modifiers: [TCO, TACO_DURO] },
          { type: "add_item", itemId: TACO, quantity: 3, modifiers: [TST, COSTILLA] },
          { type: "add_item", itemId: GORDITA, quantity: 5, modifiers: [COMBO_SHELL, MEAL_DURO] },
        ],
        reply: "5 × Taco comal chicharrón duro; 3 × Taco taquero costilla. ¿Y los 5 de gordita de pork rinds, de comal por igual?",
      };
    }
    if (/as[ií] est[aá] bien|est[aá] bien/.test(t) && !filler) {
      filler = true;
      return { actions: [{ type: "add_item", itemId: GORDITA, quantity: 5, modifiers: [GD, BISTEC] }], reply: "¿Algo más?" };
    }
    return { actions: [], reply: "¿Algo más?" };
  };
  r.menu = () => MENU;
  return r;
}

const opts = (l: any) => (l.modifiers || []).map((m: any) => `${m.step}=${m.option}`).join(" | ");
const steps = (l: any) => (l.modifiers || []).map((m: any) => String(m.step)).join(" | ");

test("laura2: cuero is not duro until staff says gorditas de duro and the caller agrees", () => {
  assert.equal(gorditaChicharronMeat([{ speaker: "caller", text: "Cinco gorditas de cuero de chicharrón." }]), null);
  assert.equal(gorditaChicharronMeat([{ speaker: "caller", text: "¿Tiene tacos de cueritos?" }, { speaker: "staff", text: "Sí, de cueritos." }, { speaker: "caller", text: "Ujú." }]), null);
  assert.equal(gorditaChicharronMeat(d.turns), "duro");
});

test("laura2: a plain gordita does not take combo or meal modifier lists", () => {
  const cart: any[] = [];
  assert.equal(applyGorditaChicharron(cart, d.turns, MENU), true);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].itemId, GORDITA);
  assert.equal(cart[0].quantity, 5);
  assert.match(opts(cart[0]), /\(GD\) Gordita/);
  assert.match(opts(cart[0]), /Duro \/ Pork Rinds/);
  assert.equal(/COMBO|MEAL|2 x Gorditas|1 x Duro/.test(opts(cart[0])), false, opts(cart[0]));
  assert.equal(/Bistec|Huevo/.test(opts(cart[0])), false, opts(cart[0]));
});

test("laura2: readback keeps 5 gorditas duro and 3 taquero costilla, and a second pass adds nothing", () => {
  const cart: any[] = [
    { itemId: GORDITA, quantity: 5, modifiers: [GD, BISTEC] },
    { itemId: GORDITA, quantity: 5, modifiers: [COMBO_SHELL, MEAL_DURO] },
    { itemId: TACO, quantity: 3, modifiers: [TST, COSTILLA] },
    { itemId: TACO, quantity: 5, modifiers: [TST, TACO_DURO] },
    { itemId: "sq-cueritos-KEEP", quantity: 1, modifiers: [{ step: "Cueritos", option: "Cueritos" }] },
  ];
  assert.equal(applySeparatedDishOrder(cart, d.turns, MENU), true);
  const again = JSON.parse(JSON.stringify(cart));
  assert.equal(applySeparatedDishOrder(cart, d.turns, MENU), false);
  assert.deepEqual(cart, again);
  const gord = cart.filter((l) => l.itemId === GORDITA);
  const tacos = cart.filter((l) => l.itemId === TACO);
  assert.equal(gord.length, 1, JSON.stringify(cart));
  assert.equal(gord[0].quantity, 5);
  assert.match(opts(gord[0]), /\(A\) Gordita Options=\(GD\) Gordita/);
  assert.match(opts(gord[0]), /\(B\) Q Carnes \/ Meats=Duro \/ Pork Rinds/);
  assert.equal(/COMBO|MEAL|Bistec|Huevo|2 x|1 x/.test(steps(gord[0]) + opts(gord[0])), false);
  assert.equal(tacos.length, 1, JSON.stringify(cart));
  assert.equal(tacos[0].quantity, 3);
  assert.match(opts(tacos[0]), /TST/);
  assert.match(opts(tacos[0]), /Costilla/);
  assert.equal(/Duro|Comal|Bistec/.test(opts(tacos[0])), false);
  assert.equal(cart.some((l) => l.itemId === "sq-cueritos-KEEP"), true);
  const onlyCueritos: any[] = [{ itemId: TACO, quantity: 2, modifiers: [TST, { step: "(B) T Carnes / Meats Opciones", option: "Cueritos" }] }];
  const cueritosTurns = [{ speaker: "caller", text: "Dos tacos de cueritos." }, { speaker: "staff", text: "Dos tacos de cueritos." }, { speaker: "caller", text: "Sí." }];
  assert.equal(applySeparatedDishOrder(onlyCueritos, cueritosTurns, MENU), false);
  assert.equal(onlyCueritos[0].quantity, 2);
  assert.match(opts(onlyCueritos[0]), /Cueritos/);
  assert.equal(/Duro/.test(opts(onlyCueritos[0])), false);
});

test("laura2: 5 plain gorditas duro, 3 street tacos costilla, name Laura", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart || [];
  const dump = JSON.stringify(c.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l) })));
  const gord = c.filter((l: any) => /gordita/i.test(String(l.itemId)));
  const tacos = c.filter((l: any) => /^sq-taco-/i.test(String(l.itemId)) && !/dorad/i.test(String(l.itemId)));
  assert.equal(gord.length, 1, dump);
  assert.equal(gord[0].itemId, GORDITA);
  assert.equal(gord[0].quantity, 5, dump);
  assert.match(opts(gord[0]), /\(GD\) Gordita/, dump);
  assert.match(opts(gord[0]), /Duro \/ Pork Rinds/, dump);
  assert.equal(/COMBO|MEAL|Bistec|Huevo|2 x Gorditas|1 x Duro/.test(opts(gord[0])), false, dump);
  assert.equal(tacos.length, 1, dump);
  assert.equal(tacos[0].itemId, TACO);
  assert.equal(tacos[0].quantity, 3, dump);
  assert.match(opts(tacos[0]), /TST|Taquero|Street/, dump);
  assert.match(opts(tacos[0]), /Costilla/, dump);
  assert.equal(/Duro|Comal|Bistec/.test(opts(tacos[0])), false, dump);
  assert.equal(c.length, 2, dump);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Laura");
  assert.notEqual(r.fulfillment, "DELIVERY");
});
