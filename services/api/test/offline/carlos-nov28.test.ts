import assert from "node:assert/strict";
import test from "node:test";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyStaffReadback, applyStaffRecap, noteUnspokenRequiredChoice } from "../../src/list-repair.ts";
import { applyPlainTaquitos, applyTacoConTodo, holdUnstyledDorada } from "../../src/approved-decisions.ts";
import { applyCarryover } from "../../src/carryover.ts";
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

test("a yes after the staff recap keeps the confirmed count", () => {
  const cart = [
    taco("Chorizo / Mexican Sausage", "(TCO) Taco Comal / Homemade (+$1.00)", 3),
    quesadilla("Pollo / Chicken", "(QCO) Quesadilla Comal / Homemade (+$1.00)", 1),
  ];
  applyStaffRecap(cart, [
    { speaker: "caller", text: "Van tres tacos de comal de chorizo y una quesadilla de pollo." },
    { speaker: "staff", text: "Entonces serían tres tacos de comal de chorizo y una quesadilla de pollo." },
    { speaker: "caller", text: "Sí." },
  ], menu, true);
  assert.equal(cart[0].quantity, 3);
  assert.equal(cart[1].quantity, 1);
  assert.equal((cart as any).readbackFlags, undefined);
});

test("claro after the readback is still a yes", () => {
  const cart = [
    taco("Pollo / Chicken", "(THR) Taco Harina / Flour (+$0.50)", 2),
    quesadilla("Chorizo / Mexican Sausage", "(QHR) Quesadilla Harina / Flour", 1),
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Dos tacos de harina de pollo y una quesadilla de harina de chorizo." },
    { speaker: "staff", text: "Te tengo dos tacos de harina de pollo y una quesadilla de harina de chorizo." },
    { speaker: "caller", text: "Claro, así está." },
  ], menu, true);
  assert.equal(cart[0].quantity, 2);
  assert.match(JSON.stringify(cart[0].modifiers), /Pollo/);
  assert.match(JSON.stringify(cart[0].modifiers), /Harina|Flour/);
  assert.equal((cart as any).readbackFlags, undefined);
});

test("a yes on the taco recap leaves the gordita line alone", () => {
  const gordita = { itemId: "sq-gordita-M647RE", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Deshebrada / Shredded Beef with Potatoes" }] };
  const cart = [
    taco("Bistec / Steak", "(TCO) Taco Comal / Homemade (+$1.00)", 2),
    quesadilla("Pollo / Chicken", "(QCO) Quesadilla Comal / Homemade (+$1.00)", 1),
    gordita,
  ];
  const before = JSON.stringify(gordita);
  applyStaffRecap(cart, [
    { speaker: "caller", text: "Dos tacos de comal de bistec, una quesadilla de pollo y una gordita de deshebrada." },
    { speaker: "staff", text: "Entonces serían dos tacos de comal de bistec y una quesadilla de pollo." },
    { speaker: "caller", text: "Sí." },
  ], menu, true);
  assert.equal(JSON.stringify(cart[2]), before);
});

test("a tortilla said for one taco does not move onto the other", () => {
  const cart = [
    taco("Chorizo / Mexican Sausage", "(TCO) Taco Comal / Homemade (+$1.00)", 2),
    taco("Pollo / Chicken", "(TST) Taco Taquero / Street Taco", 1),
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Dos tacos de comal de chorizo y un taco taquero de pollo." },
    { speaker: "staff", text: "Te tengo dos tacos taqueros de chorizo y un taco de comal de pollo." },
  ], menu, true);
  assert.match(JSON.stringify(cart[0].modifiers), /Chorizo/);
  assert.match(JSON.stringify(cart[0].modifiers), /Comal/);
  assert.match(JSON.stringify(cart[1].modifiers), /Pollo/);
  assert.match(JSON.stringify(cart[1].modifiers), /Street|Taquero/);
  assert.equal(cart[0].quantity, 2);
  assert.equal(cart[1].quantity, 1);
});

test("an agreed pastor count stays when staff swaps the other meat", () => {
  const cart = [
    taco("Alpastor / Roasted Pork", "(TST) Taco Taquero / Street Taco", 2),
    taco("Bistec / Steak", "(TST) Taco Taquero / Street Taco", 1),
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Dos tacos de pastor y un taco de bistec." },
    { speaker: "staff", text: "Te tengo dos tacos de bistec y un taco de pastor." },
  ], menu, true);
  assert.equal(cart[0].quantity, 2);
  assert.match(JSON.stringify(cart[0].modifiers), /Alpastor|pastor/i);
  assert.equal(cart[1].quantity, 1);
  assert.match(JSON.stringify(cart[1].modifiers), /Bistec/);
});

test("a taquera quesadilla stays taquera when the other one was comal", () => {
  const cart = [
    quesadilla("Bistec / Steak", "(QCO) Quesadilla Comal / Homemade (+$1.00)", 1),
    quesadilla("Lengua / Beef Tongue (+$0.50)", "(QST) Quesadilla Taquera / Street Quesadilla", 1),
  ];
  const gordita = { itemId: "sq-gordita-M647RE", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Deshebrada / Shredded Beef with Potatoes" }] };
  cart.push(gordita as any);
  const before = JSON.stringify(gordita);
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Una quesadilla de comal de bistec y una quesadilla taquera de lengua." },
    { speaker: "staff", text: "Te tengo una quesadilla de comal de lengua y una quesadilla de comal de bistec." },
  ], menu, true);
  assert.match(JSON.stringify(cart[1].modifiers), /Lengua/);
  assert.match(JSON.stringify(cart[1].modifiers), /Street|Taquera/);
  assert.equal(JSON.stringify(cart[2]), before);
});

test("an agreeing readback writes the catalog option name for that same choice", () => {
  const gordita = { itemId: "sq-gordita-M647RE", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken (+$0.50)" }] };
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "(B) T Carnes / Meats Opciones", option: "Lengua / Beef Tongue (+$0.50)" }] },
    quesadilla("Bistec / Steak", "(QCO) Quesadilla Comal / Homemade (+$1.00)", 1),
    gordita,
  ];
  const beforeSide = JSON.stringify(gordita);
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Dos tacos de comal de lengua y una quesadilla de comal de bistec." },
    { speaker: "staff", text: "Te tengo dos tacos de comal de lengua y una quesadilla de comal de bistec." },
    { speaker: "caller", text: "Sí." },
  ], menu, true);
  assert.deepEqual(cart[0].modifiers.map((mod) => mod.option), ["Lengua / Beef Tongue", "(TCO) Taco Comal / Homemade"]);
  assert.equal(cart[0].quantity, 2);
  assert.deepEqual(cart[1].modifiers.map((mod) => mod.option), ["Bistec / Steak", "(QCO) Quesadilla Comal / Homemade"]);
  assert.equal(JSON.stringify(cart[2]), beforeSide);
});

test("an agreeing readback does not add a price to a prensado quesadilla", () => {
  const gordita = { itemId: "sq-gordita-M647RE", quantity: 1, modifiers: [{ step: "(A) Gordita Options", option: "(GD) Gordita" }] };
  const cart = [
    quesadilla("Prensado / Spicy Pork", "(QCO) Quesadilla Comal / Homemade", 1),
    taco("Pollo / Chicken", "(TST) Taco Taquero / Street Taco", 2),
    gordita,
  ];
  const beforeTaco = JSON.stringify(cart[1]);
  const beforeSide = JSON.stringify(gordita);
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Una quesadilla de comal de prensado y dos tacos de pollo." },
    { speaker: "staff", text: "Te tengo una quesadilla de comal de prensado y dos tacos taqueros de pollo." },
    { speaker: "caller", text: "Sí, así." },
  ], menu, true);
  assert.deepEqual(cart[0].modifiers.map((mod) => mod.option), ["Prensado / Spicy Pork", "(QCO) Quesadilla Comal / Homemade"]);
  assert.equal(JSON.stringify(cart[1]), beforeTaco);
  assert.equal(JSON.stringify(cart[2]), beforeSide);
});

test("confirming comal does not rewrite a comal option that is already there", () => {
  const item = menu.find((row) => /^sq-quesadilla-/.test(String(row.id)) && !/dorada/.test(String(row.id)));
  const priced = "(QCO) Quesadilla Comal / Homemade (+$1.00)";
  const line = { itemId: item.id, quantity: 2, modifiers: [{ step: "(A) Q Tortilla Options", option: priced }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }], elviNotes: ["confirmar (A) Q Tortilla Options"] };
  const gordita = menu.find((row) => /^sq-gordita-/.test(String(row.id)));
  const gorditaLine = { itemId: gordita.id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] };
  const before = JSON.stringify(gorditaLine.modifiers);
  noteUnspokenRequiredChoice([line, gorditaLine], [
    { speaker: "caller", text: "Dos quesadillas de bistec." },
    { speaker: "staff", text: "¿De comal o de harina?" },
    { speaker: "caller", text: "Como sea." },
  ], menu);
  assert.equal(line.modifiers.find((mod) => /comal/i.test(String(mod.option)))?.option, priced);
  assert.equal(JSON.stringify(gorditaLine.modifiers), before);
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

test("otro normal stays street and does not become comal", () => {
  const item = menu.find((row) => row.id === "sq-taco-TAR7L5");
  const line = { itemId: item.id, quantity: 1, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: "Costilla / Beef Rib" }], elviNotes: ["confirmar (A) T Tortilla Options"] };
  const gordita = menu.find((row) => /^sq-gordita-/.test(String(row.id)));
  const gorditaLine = { itemId: gordita.id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }], elviNotes: [] as string[] };
  const before = JSON.stringify(gorditaLine.modifiers);
  noteUnspokenRequiredChoice([line, gorditaLine], [
    { speaker: "caller", text: "Un taco de costilla." },
    { speaker: "staff", text: "¿De comal o normal?" },
    { speaker: "caller", text: "Otro normal." },
  ], menu);
  assert.match(JSON.stringify(line.modifiers), /Street|Taquero/);
  assert.doesNotMatch(JSON.stringify(line.modifiers), /Comal/);
  assert.equal(JSON.stringify(gorditaLine.modifiers), before);
});

test("taquera and de los chicos stay street", () => {
  const item = menu.find((row) => row.id === "sq-taco-TAR7L5");
  const street = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
  const meat = { step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" };
  for (const answer of ["De la taquera.", "De los chicos.", "Normal."]) {
    const line = { itemId: item.id, quantity: 2, modifiers: [street, meat], elviNotes: [] as string[] };
    noteUnspokenRequiredChoice([line], [
      { speaker: "caller", text: "Dos tacos de pollo." },
      { speaker: "staff", text: "¿De comal, de harina o taqueros?" },
      { speaker: "caller", text: answer },
    ], menu);
    assert.match(JSON.stringify(line.modifiers), /Street|Taquero/, answer);
    assert.doesNotMatch(JSON.stringify(line.modifiers), /Comal/, answer);
  }
});

test("an address question with the word street is not the tortilla question", () => {
  const item = menu.find((row) => row.id === "sq-taco-TAR7L5");
  const line = { itemId: item.id, quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([line], [
    { speaker: "caller", text: "Un taco de bistec." },
    { speaker: "staff", text: "¿Me das la dirección? Oak Street." },
    { speaker: "caller", text: "Es la casa de la esquina." },
  ], menu);
  assert.doesNotMatch(JSON.stringify(line.modifiers), /Comal/);
  assert.equal((line.elviNotes || []).some((note) => /tortilla/i.test(note)), true);
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

const REGULAR_CORN = "3 x (Corn) Corn Tortilla";

test("a platillo with no tortilla said keeps its tortillas and notes comal", () => {
  const item = menu.find((row) => /platillo de guisado/i.test(String(row.name || "")) && !/platter|pack|combo/i.test(String(row.name || "")));
  const line = { itemId: item.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([line], [{ speaker: "caller", text: "Quiero un platillo de guisado de pollo." }], menu);
  assert.equal((line.elviNotes || []).includes("comal"), true);
  assert.equal((line.modifiers || []).some((mod) => mod.option === REGULAR_CORN), true);
  assert.equal((line.modifiers || []).some((mod) => /EXTRA 3 x Comal/.test(String(mod.option))), false);
});

test("mole and rellenos with no tortilla said are noted comal", () => {
  for (const [nameRe, text] of [
    [/mole tradicional/i, "Un mole tradicional, por favor."],
    [/chiles rellenos/i, "Me da unos chiles rellenos."],
  ] as const) {
    const item = menu.find((row) => nameRe.test(String(row.name || "")) && !/platter|pack|combo|fiesta/i.test(String(row.name || "")));
    const line = { itemId: item.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
    noteUnspokenRequiredChoice([line], [{ speaker: "caller", text }], menu);
    assert.equal((line.elviNotes || []).includes("comal"), true, text);
    assert.equal((line.modifiers || []).some((mod) => /EXTRA 3 x Comal/.test(String(mod.option))), false, text);
  }
});

test("a burrito beside a fajita order does not pick up the comal note", () => {
  const fajita = menu.find((row) => /^fajitas elvis/i.test(String(row.name || "")));
  const burrito = menu.find((row) => /^sq-burrito-/.test(String(row.id)));
  const fajitaLine = { itemId: fajita.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
  const burritoLine = { itemId: burrito.id, quantity: 1, modifiers: [{ step: "(B) Burrito Carne Options", option: "Pollo / Chicken" }], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([fajitaLine, burritoLine], [
    { speaker: "caller", text: "Unas fajitas y un burrito de pollo." },
  ], menu);
  assert.equal((fajitaLine.elviNotes || []).includes("comal"), true);
  assert.equal((burritoLine.elviNotes || []).includes("comal"), false);
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

test("los tacos con todo get the normal toppings", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] },
  ];
  applyTacoConTodo(cart, [{ speaker: "caller", text: "Los tacos de pollo, con todo." }]);
  assert.deepEqual(cart[0].elviNotes, ["cebolla, cilantro y limón"]);
  assert.equal(cart.length, 1);
});

test("con todo on a sope does not change the taco", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] },
    { itemId: "sq-sope-elvis", quantity: 1, modifiers: [{ step: "topping", option: "Frijoles / Pinto Beans" }] },
  ];
  const beforeTaco = JSON.stringify(cart[0]);
  const beforeSope = JSON.stringify(cart[1]);
  applyTacoConTodo(cart, [
    { speaker: "caller", text: "Un taco de chorizo." },
    { speaker: "caller", text: "Y el sope con todo." },
  ]);
  assert.equal(JSON.stringify(cart[0]), beforeTaco);
  assert.equal(JSON.stringify(cart[1]), beforeSope);
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

test("cebolla asada on the chicken taco leaves the steak taco alone", () => {
  const tacoItem = menu.find((row) => row.id === "sq-taco-TAR7L5");
  const cart: any[] = [
    { itemId: tacoItem.id, quantity: 4, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] },
    { itemId: tacoItem.id, quantity: 6, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
  ];
  applyCarryover(cart, [{ speaker: "caller", text: "La cebolla asada va en los tacos de pollo." }], menu);
  assert.equal(cart[0].modifiers.some((mod: any) => /extra cebolla y chiles asados/i.test(String(mod.option))), true);
  assert.equal(cart[1].modifiers.some((mod: any) => /extra cebolla y chiles asados/i.test(String(mod.option))), false);
  assert.equal(cart.length, 2);
});

test("cebolla asada on the regular dorada does not land on the deluxe", () => {
  const regular = menu.find((row) => /^sq-qd-/.test(String(row.id)) && /regular/i.test(`${row.id} ${row.name || ""}`));
  const deluxe = menu.find((row) => /^sq-qd-/.test(String(row.id)) && /deluxe|preparada/i.test(`${row.id} ${row.name || ""}`));
  const cart: any[] = [
    { itemId: regular.id, quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
    { itemId: deluxe.id, quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
  ];
  const before = JSON.stringify(cart[1]);
  applyCarryover(cart, [{ speaker: "caller", text: "A las regulares ponles cebolla asada." }], menu);
  assert.equal(cart[0].modifiers.some((mod: any) => /extra cebolla y chiles asados/i.test(String(mod.option))), true);
  assert.equal(JSON.stringify(cart[1]), before);
});

test("cebolla asada para llevar stays on the dish", () => {
  const qd = menu.find((row) => /^sq-qd-/.test(String(row.id)) && /regular/i.test(`${row.id} ${row.name || ""}`));
  const cart: any[] = [{ itemId: qd.id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] }];
  applyCarryover(cart, [{ speaker: "caller", text: "Quesadilla de pollo con cebolla asada para llevar." }], menu);
  assert.equal(cart.some((line) => /cebolla/.test(String(line.itemId)) && /chiles/.test(String(line.itemId))), false);
  assert.equal(cart[0].modifiers.some((mod: any) => /extra cebolla y chiles asados/i.test(String(mod.option))), true);
});

test("cebolla asada on a quesadilla is the seventy-five cent add-on", () => {
  const qd = menu.find((row) => /^sq-qd-/.test(String(row.id)) && /regular/i.test(`${row.id} ${row.name || ""}`));
  const cart: any[] = [{ itemId: qd.id, quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Queso" }] }];
  applyCarryover(cart, [{ speaker: "caller", text: "Esas quesadillas de queso, con cebolla asada." }], menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].modifiers.some((mod: any) => /extra cebolla y chiles asados/i.test(String(mod.option))), true);
});

test("cebolla asada on tacos does not become a side order", () => {
  const tacoItem = menu.find((row) => row.id === "sq-taco-TAR7L5");
  const cart: any[] = [{ itemId: tacoItem.id, quantity: 4, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Alpastor / Roasted Pork" }] }];
  applyCarryover(cart, [{ speaker: "caller", text: "Cuatro tacos de pastor con cebolla asada." }], menu);
  assert.equal(cart.some((line) => /extras/.test(String(line.itemId)) && /cebolla/.test(String(line.itemId))), false);
  assert.equal(cart[0].modifiers.some((mod: any) => /extra cebolla y chiles asados/i.test(String(mod.option))), true);
});

test("cebolla asada named for the tacos leaves the quesadilla alone", () => {
  const tacoItem = menu.find((row) => row.id === "sq-taco-TAR7L5");
  const qd = menu.find((row) => /^sq-qd-/.test(String(row.id)) && /regular/i.test(`${row.id} ${row.name || ""}`));
  const cart: any[] = [
    { itemId: tacoItem.id, quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: qd.id, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] },
  ];
  const before = JSON.stringify(cart[1]);
  applyCarryover(cart, [{ speaker: "caller", text: "La cebolla asada va en los tacos." }], menu);
  assert.equal(JSON.stringify(cart[1]), before);
  assert.equal(cart.length, 2);
  assert.equal(cart[0].modifiers.some((mod: any) => /extra cebolla y chiles asados/i.test(String(mod.option))), true);
});

test("taquitos de la taquera keep the street tortilla", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 4, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] },
  ];
  applyPlainTaquitos(cart, [{ speaker: "caller", text: "Cuatro taquitos de la taquera de pollo." }], menu);
  assert.match(JSON.stringify(cart[0].modifiers), /Street|Taquero/);
  assert.equal((cart[0].elviNotes || []).some((note: string) => /tortilla/i.test(note)), false);
});

test("taquitos de comal keep comal", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour" }, { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  const before = JSON.stringify(cart[1]);
  applyPlainTaquitos(cart, [{ speaker: "caller", text: "Dos taquitos de comal de bistec y una quesadilla de harina de chorizo." }], menu);
  assert.match(JSON.stringify(cart[0].modifiers), /Comal/);
  assert.equal(JSON.stringify(cart[1]), before);
});

test("taquitos are plain tacos and the tortilla is still open", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 3, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] },
  ];
  applyPlainTaquitos(cart, [{ speaker: "caller", text: "Me da tres taquitos de pollo." }], menu);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /Street|Taquero/);
  assert.match((cart[0].elviNotes || []).join(" "), /tortilla/i);
  assert.match(JSON.stringify(cart[0].modifiers), /Pollo/);
  assert.equal(cart.length, 1);
});

test("a singular taquito also waits for the tortilla", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyPlainTaquitos(cart, [{ speaker: "caller", text: "Un taquito de chorizo, por favor." }], menu);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /Street|Taquero/);
  assert.match((cart[0].elviNotes || []).join(" "), /tortilla/i);
});

test("taquitos do not change the gordita on the same ticket", () => {
  const gordita = { itemId: "sq-gordita-M647RE", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Deshebrada / Shredded Beef with Potatoes" }] };
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    gordita,
  ];
  const before = JSON.stringify(gordita);
  applyPlainTaquitos(cart, [{ speaker: "caller", text: "Dos taquitos de bistec y una gordita de deshebrada." }], menu);
  assert.equal(JSON.stringify(cart[1]), before);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /Street|Taquero/);
});

const DORADA = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";

test("quesadillas de aceite are not regular until someone says the style", () => {
  const cart = [
    { itemId: DORADA, quantity: 2, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
  ];
  const review = holdUnstyledDorada(cart, [{ speaker: "caller", text: "Dos quesadillas de aceite de bistec." }]);
  assert.equal(review, "confirmar regular o preparada");
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /REGULAR/);
});

test("quesadillas en aceite also ask instead of ringing regular", () => {
  const cart = [
    { itemId: DORADA, quantity: 1, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] },
  ];
  const before = JSON.stringify(cart[1]);
  holdUnstyledDorada(cart, [{ speaker: "caller", text: "Una quesadilla en aceite de pollo y un taco de chorizo." }]);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /REGULAR/);
  assert.equal(JSON.stringify(cart[1]), before);
});

test("a dorada with no style is not rung as regular", () => {
  const cart = [
    { itemId: DORADA, quantity: 2, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  const review = holdUnstyledDorada(cart, [{ speaker: "caller", text: "Dos quesadillas doradas de chorizo." }]);
  assert.equal(review, "confirmar regular o preparada");
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /REGULAR/);
  assert.match((cart[0].elviNotes || []).join(" "), /regular o preparada/);
  assert.match(JSON.stringify(cart[0].modifiers), /Chorizo/);
});

test("an english dorada with no style also asks", () => {
  const cart = [
    { itemId: DORADA, quantity: 1, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
  ];
  const review = holdUnstyledDorada(cart, [{ speaker: "caller", text: "One dorada with steak." }]);
  assert.equal(review, "confirmar regular o preparada");
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /REGULAR/);
});

test("an unstyled dorada does not change the taco beside it", () => {
  const taco = { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] };
  const cart = [
    { itemId: DORADA, quantity: 1, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Picadillo / Ground Beef with Potatoes" }] },
    taco,
  ];
  const before = JSON.stringify(taco);
  holdUnstyledDorada(cart, [{ speaker: "caller", text: "Una dorada de picadillo y dos tacos de pollo." }]);
  assert.equal(JSON.stringify(cart[1]), before);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /REGULAR/);
  const kept = [{ itemId: DORADA, quantity: 1, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) REGULAR Dorada" }] }];
  assert.equal(holdUnstyledDorada(kept, [{ speaker: "caller", text: "Las doradas, regulares." }]), null);
  assert.match(JSON.stringify(kept[0].modifiers), /REGULAR/);
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

const hasCebolla = (line: any) => (line?.modifiers || []).some((mod: any) => /extra cebolla y chiles asados/i.test(String(mod.option)));
async function shadowCart(lines: string[]) {
  const run: any = async () => ({ actions: [], reply: "" });
  run.menu = () => menu;
  const turns = lines.map((text, n) => ({ speaker: "caller", text, language: "es", start: n, end: n + 1 }));
  const order: any = await shadowOrderFromTurns(turns as any, run);
  return order.cart || [];
}

test("cebolla on the normales waits until that line exists and skips the preparadas", async () => {
  const cart = await shadowCart([
    "Dame dos quesadillas doradas preparadas de bistec.",
    "Y otras dos normales.",
    "A las normales les pongo cebolla asada.",
    "Y una gordita de pollo.",
  ]);
  const deluxe = cart.filter((line: any) => /deluxe|preparada/i.test(String(line.itemId)));
  const regular = cart.filter((line: any) => /regular/i.test(String(line.itemId)));
  const gordita = cart.find((line: any) => /gordita/i.test(String(line.itemId)));
  assert.equal(deluxe.reduce((sum: number, line: any) => sum + line.quantity, 0), 2);
  assert.equal(regular.reduce((sum: number, line: any) => sum + line.quantity, 0), 2);
  assert.equal(deluxe.some(hasCebolla), false);
  assert.equal(regular.some(hasCebolla), true);
  assert.ok(gordita);
  assert.equal(hasCebolla(gordita), false);
});

test("a meat with no dish does not put cebolla on every line of that meat", async () => {
  const cart = await shadowCart([
    "Quiero una torta de lengua y una quesadilla de harina de lengua.",
    "Ponle cebolla asada a la de lengua.",
  ]);
  const food = cart.filter((line: any) => !/extras/.test(String(line.itemId)));
  const side = cart.find((line: any) => /cebolla/.test(String(line.itemId)) && /chiles/.test(String(line.itemId)));
  assert.equal(food.length, 2);
  assert.equal(food.some(hasCebolla), false);
  assert.ok(side);
  assert.match((side.elviNotes || []).join(" "), /confirmar platillo/);
});

test("taquitos alone ring plain tacos and ask the tortilla", async () => {
  const cart = await shadowCart(["Ocho taquitos de cabeza."]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 8);
  assert.match(String(cart[0].itemId), /^sq-taco-/);
  assert.match(JSON.stringify(cart[0].modifiers), /Cabeza/);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /Street|Taquero|Comal|Harina/);
  assert.match((cart[0].elviNotes || []).join(" "), /tortilla/i);
});

test("a later tortilla answer stays on the taquitos", async () => {
  const cart = await shadowCart(["Ocho taquitos de cabeza.", "Que sean de harina, gracias."]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 8);
  assert.match(JSON.stringify(cart[0].modifiers), /Harina|Flour/);
  assert.equal((cart[0].elviNotes || []).some((note: string) => /tortilla/i.test(note)), false);
});

test("taquitos do not ask a tortilla for the gordita beside them", async () => {
  const cart = await shadowCart(["Ocho taquitos de cabeza y una gordita de nopales."]);
  const gordita = cart.find((line: any) => /gordita/i.test(String(line.itemId)));
  const taco = cart.find((line: any) => /^sq-taco-/.test(String(line.itemId)));
  assert.ok(gordita);
  assert.equal((gordita.elviNotes || []).some((note: string) => /tortilla/i.test(note)), false);
  assert.match(JSON.stringify(gordita.modifiers), /Nopales/);
  assert.ok(taco);
  assert.equal(taco.quantity, 8);
  assert.match((taco.elviNotes || []).join(" "), /tortilla/i);
});

test("fried quesadillas with no style are not rung as regular", async () => {
  const cart = await shadowCart(["Tres quesadillas fritas de cabeza."]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
  assert.match(String(cart[0].itemId), /dorada/);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /REGULAR/);
  assert.match(JSON.stringify(cart[0].modifiers), /Cabeza/);
  assert.match((cart[0].elviNotes || []).join(" "), /regular o preparada/);
});

test("english fried quesadillas also ask instead of assuming regular", async () => {
  const cart = await shadowCart(["Three fried quesadillas with carnitas."]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /REGULAR/);
  assert.match(JSON.stringify(cart[0].modifiers), /Carnitas/);
  assert.match((cart[0].elviNotes || []).join(" "), /regular o preparada/);
});

test("fried quesadillas that say preparada stay deluxe and leave the tacos alone", async () => {
  const asked = await shadowCart(["Tres quesadillas fritas preparadas de cabeza."]);
  assert.equal(asked.length, 1);
  assert.match(JSON.stringify(asked[0].modifiers), /DELUXE/);
  assert.equal((asked[0].elviNotes || []).some((note: string) => /regular o preparada/.test(note)), false);
  const cart = await shadowCart(["Dos tacos de harina de pollo.", "Y tres quesadillas fritas de cabeza."]);
  const taco = cart.find((line: any) => /^sq-taco-/.test(String(line.itemId)));
  const dorada = cart.find((line: any) => /cabeza/i.test(JSON.stringify(line.modifiers)));
  assert.ok(taco);
  assert.equal(taco.quantity, 2);
  assert.match(JSON.stringify(taco.modifiers), /Harina|Flour/);
  assert.match(JSON.stringify(taco.modifiers), /Pollo/);
  assert.equal((taco.elviNotes || []).some((note: string) => /regular o preparada/.test(note)), false);
  assert.ok(dorada);
  assert.doesNotMatch(JSON.stringify(dorada.modifiers), /REGULAR/);
  assert.match((dorada.elviNotes || []).join(" "), /regular o preparada/);
});
