import assert from "node:assert/strict";
import test from "node:test";
import { applyStaffReadback, noteUnspokenRequiredChoice } from "../../src/list-repair.ts";
import { applyTacoConTodo } from "../../src/approved-decisions.ts";
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

test("one tortilla question then comal on tacos", () => {
  const item = menu.find((row) => row.id === "sq-taco-TAR7L5");
  const meat = { step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" };
  const line = { itemId: item.id, quantity: 2, modifiers: [meat], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([line], [
    { speaker: "caller", text: "Ponme dos tacos de pollo, por favor." },
    { speaker: "staff", text: "¿Los quiere de comal, de harina o taqueros?" },
    { speaker: "caller", text: "Como gustes, no importa." },
  ], menu);
  assert.match(JSON.stringify(line.modifiers), /Comal/);
  assert.equal((line.elviNotes || []).some((note) => /tortilla/i.test(note)), false);
  assert.equal(line.quantity, 2);
});

test("one tortilla question then comal on a quesadilla", () => {
  const item = menu.find((row) => /^sq-quesadilla-/.test(String(row.id)) && !/dorada/.test(String(row.id)));
  const meat = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
  const line = { itemId: item.id, quantity: 1, modifiers: [meat], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([line], [
    { speaker: "caller", text: "A quesadilla with steak." },
    { speaker: "staff", text: "Corn, flour, or homemade?" },
    { speaker: "caller", text: "I don't know, you pick." },
  ], menu);
  assert.match(JSON.stringify(line.modifiers), /Comal|Homemade/);
  assert.equal((line.elviNotes || []).some((note) => /tortilla/i.test(note)), false);
});

test("a gordita is not given comal when the taco question goes unanswered", () => {
  const tacoItem = menu.find((row) => row.id === "sq-taco-TAR7L5");
  const gordita = menu.find((row) => /^sq-gordita-/.test(String(row.id)));
  const tacoLine = { itemId: tacoItem.id, quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }], elviNotes: [] as string[] };
  const gorditaLine = { itemId: gordita.id, quantity: 1, modifiers: [{ step: "(B) Gordita Carne", option: "Deshebrada / Shredded Beef with Potatoes" }], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([tacoLine, gorditaLine], [
    { speaker: "caller", text: "Un taco de chorizo y una gordita de deshebrada." },
    { speaker: "staff", text: "¿El taco de comal, harina o taquero?" },
    { speaker: "caller", text: "El que sea." },
  ], menu);
  assert.match(JSON.stringify(tacoLine.modifiers), /Comal/);
  assert.match(JSON.stringify(gorditaLine.modifiers), /Deshebrada/);
  assert.doesNotMatch(JSON.stringify(gorditaLine.modifiers), /Comal|Taco Comal|Quesadilla Comal/);
});

const COMAL_EXTRA = "***EXTRA 3 x Comal / Homemade Tortilla";
const REGULAR_CORN = "3 x (Corn) Corn Tortilla";

test("a platillo with no tortilla said is comal", () => {
  const item = menu.find((row) => /platillo de guisado/i.test(String(row.name || "")) && !/platter|pack|combo/i.test(String(row.name || "")));
  const line = { itemId: item.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([line], [{ speaker: "caller", text: "Quiero un platillo de guisado de pollo." }], menu);
  assert.equal((line.modifiers || []).some((mod) => mod.option === COMAL_EXTRA), true);
  assert.equal((line.modifiers || []).some((mod) => mod.option === REGULAR_CORN), false);
});

test("mole, rellenos, and fajitas with no tortilla said are comal", () => {
  const spoken = [
    [/mole tradicional/i, "Un mole tradicional, por favor."],
    [/chiles rellenos/i, "Me da unos chiles rellenos."],
    [/^fajitas elvis/i, "Fajitas de res para llevar."],
  ] as const;
  for (const [nameRe, text] of spoken) {
    const item = menu.find((row) => nameRe.test(String(row.name || "")) && !/platter|pack|combo|fiesta/i.test(String(row.name || "")));
    const line = { itemId: item.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
    noteUnspokenRequiredChoice([line], [{ speaker: "caller", text }], menu);
    assert.equal((line.modifiers || []).some((mod) => mod.option === COMAL_EXTRA), true, text);
    assert.equal((line.modifiers || []).some((mod) => mod.option === REGULAR_CORN), false, text);
  }
});

test("a burrito beside a fajita order does not pick up the comal default", () => {
  const fajita = menu.find((row) => /^fajitas elvis/i.test(String(row.name || "")));
  const burrito = menu.find((row) => /^sq-burrito-/.test(String(row.id)));
  const fajitaLine = { itemId: fajita.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
  const burritoLine = { itemId: burrito.id, quantity: 1, modifiers: [{ step: "(B) Burrito Carne Options", option: "Pollo / Chicken" }], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([fajitaLine, burritoLine], [
    { speaker: "caller", text: "Unas fajitas y un burrito de pollo." },
  ], menu);
  assert.equal((fajitaLine.modifiers || []).some((mod) => mod.option === COMAL_EXTRA), true);
  assert.equal((burritoLine.modifiers || []).some((mod) => mod.option === COMAL_EXTRA), false);
  assert.match(JSON.stringify(burritoLine.modifiers), /Pollo/);
});

test("con todo on tacos is onion cilantro and lime", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 3, modifiers: [{ step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" }, { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
  ];
  applyTacoConTodo(cart, [{ speaker: "caller", text: "Tres tacos de bistec con todo." }]);
  assert.deepEqual(cart[0].elviNotes, ["cebolla, cilantro y limón"]);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /DELUXE/);
  assert.equal(cart.length, 1);
  assert.match(JSON.stringify(cart[0].modifiers), /Bistec/);
});

test("with everything on tacos is the same normal toppings", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] },
  ];
  applyTacoConTodo(cart, [
    { speaker: "caller", text: "Two chicken tacos." },
    { speaker: "caller", text: "With everything, please." },
  ]);
  assert.deepEqual(cart[0].elviNotes, ["cebolla, cilantro y limón"]);
  assert.equal(cart.length, 1);
});

test("con todo on a burrito does not rewrite the taco note or add a side", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] },
    { itemId: "sq-burrito-example", quantity: 1, modifiers: [{ step: "(B) Burrito Carne Options", option: "Carnitas / Pulled Pork (+$1.00)" }] },
  ];
  const beforeBurrito = JSON.stringify(cart[1]);
  applyTacoConTodo(cart, [
    { speaker: "caller", text: "Un taco de chorizo." },
    { speaker: "caller", text: "Y un burrito de carnitas con todo." },
  ]);
  assert.equal(cart[0].elviNotes, undefined);
  assert.equal(JSON.stringify(cart[1]), beforeBurrito);
  assert.equal(cart.length, 2);
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
