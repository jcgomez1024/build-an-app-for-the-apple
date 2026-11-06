// alicia1 (CA8fe34d24, Nov 6 ~2:53 PM ET, pickup): one steak fried quesadilla deluxe,
// a side of rice and beans (small — "it comes together"), sour cream, and a can of Pepsi.
// The miss treated "side of rice and beans" as a quesadilla (Comal/Harina/Taquera, then
// Quesadilla Comal + frijoles) plus a rice-only side, and "a can of Pepsi" as an unnamed can of Coke.
// Not a one-call special case: any side of rice and beans rings the combined side, and Pepsi stays Pepsi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyCombinedRiceBeansSide, combinedRiceBeansSide, guardRiceBeansSide, liveRiceBeansSide, SIDE_RB, SIDE_RICE_ONLY } from "../../src/list-repair.ts";
import { ringUnnamedSodas } from "../../src/order-repair.ts";
import { normalizeSpokenCatalogAliases } from "../../src/text-intents.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CA8fe34d24-alicia1.json", import.meta.url), "utf8"));
const QD = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const Q = "sq-quesadilla-HLT6CR";
const EXTRAS = "sq-extras-mild-salsa-asada-2oz-T6PGNT";
const PEPSI = "sq-drink-pepsi-DIJPIW";
const COKE = "sq-drink-coca-cola-JJE4KC";
const QCO = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
const FRIJ = { step: "(B) Q Carnes / Meats", option: "Frijoles Refritos / Refried Beans" };
const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
const DELUXE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
const SHELL_Q = "Quesadilla: ¿Quesadilla Comal, Quesadilla Harina o Quesadilla Taquera?";

const MENU = [
  { id: QD, name: "Quesadilla Dorada", modifierGroups: [{ name: "(QD) Style", options: [{ name: "(QD) DELUXE Preparada" }] }, { name: "(B) Q Carnes / Meats", options: [{ name: "Bistec / Steak" }] }] },
  { id: Q, name: "Quesadilla", modifierGroups: [{ name: "(A) Q Tortilla Options", options: [{ name: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { name: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { name: "(QST) Quesadilla Taquera / Street Quesadilla" }] }, { name: "(B) Q Carnes / Meats", options: [{ name: "Frijoles Refritos / Refried Beans" }, { name: "Bistec / Steak" }] }] },
  { id: SIDE_RICE_ONLY, name: "Sides Arroz / Rice", squareVariationId: "26S6E6Z2PMZ5OK5NC43BKN7A", modifierGroups: [] },
  { id: SIDE_RB, name: "Sides Arroz-Rice and Frijole-Beans", squareVariationId: "I5HNHWWJJ2QRQST6A3WAK6FG", modifierGroups: [] },
  { id: "sq-sides-grande-arroz-rice-frijoles-beans-OTJKZV", name: "Sides GRANDE Arroz-Rice / Frijoles-Beans", squareVariationId: "OTJKZVP2FHVBRCTBEO7MB76V", modifierGroups: [] },
  { id: EXTRAS, name: "Extras", modifierGroups: [{ name: "Extras options", options: [{ name: "Crema / Sour Cream 2oz" }] }] },
  { id: COKE, name: "Coca Cola", squareVariationId: "JJE4KCJT752VBETFD7PWKLKN", modifierGroups: [] },
  { id: PEPSI, name: "Pepsi", squareVariationId: "DIJPIW4BWHOSNF3YKGIRZRMB", modifierGroups: [] },
];

/** Stub repeats the live miss: the side opens a quesadilla shell question and rings rice only; Pepsi is not rung. */
function stub() {
  let qd = false, rice = false, crema = false, comal = false;
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/fried quesadilla|quesadillas?\s+doradas?|en aceite|quesadilla deluxe/.test(t) && !qd) {
      qd = true;
      return { actions: [{ type: "add_item", itemId: QD, quantity: 1, modifiers: [DELUXE, BISTEC] }], reply: "One fried quesadilla deluxe, steak. Anything else?" };
    }
    if (/rice and beans|arroz y frijol|frijole-beans/.test(t) && !rice) {
      rice = true;
      return { actions: [{ type: "add_item", itemId: SIDE_RICE_ONLY, quantity: 1, modifiers: [] }], reply: SHELL_Q };
    }
    if (/quesadilla comal/.test(t) && !comal) {
      comal = true;
      return { actions: [{ type: "add_item", itemId: Q, quantity: 1, modifiers: [QCO, FRIJ] }], reply: "Quesadilla comal, beans. Anything else?" };
    }
    if (/sour cream|crema/.test(t) && !crema) {
      crema = true;
      return { actions: [{ type: "add_item", itemId: EXTRAS, quantity: 1, modifiers: [{ step: "Extras options", option: "Crema / Sour Cream 2oz" }] }], reply: "Sour cream. Anything else?" };
    }
    return { actions: [], reply: "Anything else?" };
  };
  r.menu = () => MENU;
  return r;
}

const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");

test("alicia1: a side of rice and beans is the combined side; two separate sides are not", () => {
  assert.deepEqual(combinedRiceBeansSide("And then can I get a side of rice and beans?"), { grande: false });
  assert.deepEqual(combinedRiceBeansSide("The small, that just comes, yeah, it comes together, right?", "Rice and beans small or the large?"), { grande: false });
  assert.deepEqual(combinedRiceBeansSide("the large", "rice and beans, small or the large?"), { grande: true });
  assert.equal(combinedRiceBeansSide("a side of rice"), null);
  assert.equal(combinedRiceBeansSide("a side of rice and then a side of beans"), null);
  assert.equal(combinedRiceBeansSide("burrito with rice and beans"), null);
});

test("alicia1: the side turn does not open a quesadilla shell or ring rice only", () => {
  const r = guardRiceBeansSide(
    { reply: SHELL_Q, actions: [{ type: "add_item", itemId: SIDE_RICE_ONLY, quantity: 1, modifiers: [] }, { type: "add_item", itemId: Q, quantity: 1, modifiers: [QCO, FRIJ] }] },
    "And then can I get a side of rice and beans?",
    "Anything else?",
    [],
    "en",
  );
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].itemId, SIDE_RB);
  assert.doesNotMatch(r.reply, /Comal/);
  assert.match(r.reply, /Anything else/);
  const live = liveRiceBeansSide(
    { reply: SHELL_Q, actions: [{ type: "add_item", itemId: Q, quantity: 1, modifiers: [QCO, FRIJ] }] },
    { transcript: "una orden de arroz y frijoles", language: "es", history: [], cart: [] },
  );
  assert.equal(live.actions[0].itemId, SIDE_RB);
  assert.equal(normalizeSpokenCatalogAliases("a side of rice and beans"), "Sides Arroz-Rice and Frijole-Beans");
  assert.equal(normalizeSpokenCatalogAliases("a large side of rice and beans"), "Sides GRANDE Arroz-Rice / Frijoles-Beans");
  assert.equal(normalizeSpokenCatalogAliases("a side of rice"), "sides rice");
});

test("alicia1: can of Pepsi is Pepsi; an unnamed can is still Coke to confirm", () => {
  const pepsi: any[] = [{ itemId: COKE, quantity: 1, modifiers: [], elviNotes: ["soda de lata, sabor no dicho — confirmar"] }];
  assert.equal(ringUnnamedSodas(pepsi, [{ speaker: "caller", text: "a can of Pepsi" }], MENU), true);
  assert.equal(pepsi.length, 1);
  assert.equal(pepsi[0].itemId, PEPSI);
  assert.equal(pepsi[0].elviNotes, undefined);
  const none: any[] = [];
  ringUnnamedSodas(none, [{ speaker: "caller", text: "and then a can of Pepsi" }], MENU);
  assert.equal(none[0].itemId, PEPSI);
  assert.equal(none[0].quantity, 1);
  const unnamed: any[] = [];
  ringUnnamedSodas(unnamed, [{ speaker: "caller", text: "unas dos sodas de lata" }], MENU);
  assert.equal(unnamed[0].itemId, COKE);
  assert.equal(unnamed[0].quantity, 2);
  assert.match(unnamed[0].elviNotes[0], /sabor no dicho/);
});

test("alicia1: a wrong cart (rice only + Comal frijoles + Coke note) repairs to the combined side and Pepsi", () => {
  const cart: any[] = [
    { itemId: QD, quantity: 1, modifiers: [DELUXE, BISTEC] },
    { itemId: SIDE_RICE_ONLY, quantity: 1, modifiers: [] },
    { itemId: Q, quantity: 1, modifiers: [QCO, FRIJ] },
    { itemId: EXTRAS, quantity: 1, modifiers: [{ step: "Extras options", option: "Crema / Sour Cream 2oz" }] },
    { itemId: COKE, quantity: 1, modifiers: [], elviNotes: ["soda de lata, sabor no dicho — confirmar"] },
  ];
  applyCombinedRiceBeansSide(cart, d.turns);
  ringUnnamedSodas(cart, d.turns, MENU);
  const ids = cart.map((l) => l.itemId);
  assert.ok(ids.includes(QD));
  assert.ok(ids.includes(SIDE_RB));
  assert.ok(ids.includes(EXTRAS));
  assert.ok(ids.includes(PEPSI));
  assert.equal(ids.includes(SIDE_RICE_ONLY), false);
  assert.equal(ids.includes(Q), false);
  assert.equal(ids.includes(COKE), false);
});

test("alicia1: one steak fried quesadilla, small rice and beans, crema, Pepsi — no Comal, no rice-only, no Coke", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart;
  const dump = JSON.stringify(c.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l), n: l.elviNotes })));
  const qd = c.filter((l: any) => l.itemId === QD);
  assert.equal(qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, dump);
  assert.match(opts(qd[0]), /Bistec/);
  assert.match(opts(qd[0]), /DELUXE/);
  const side = c.filter((l: any) => l.itemId === SIDE_RB);
  assert.equal(side.length, 1, dump);
  assert.equal(c.some((l: any) => l.itemId === SIDE_RICE_ONLY || /26S6E6/.test(String(l.itemId))), false, dump);
  assert.equal(c.some((l: any) => l.itemId === Q || /HLT6CR/.test(String(l.itemId))), false, dump);
  assert.equal(c.some((l: any) => /Quesadilla Comal|Frijoles Refritos/.test(opts(l))), false, dump);
  const crema = c.filter((l: any) => l.itemId === EXTRAS && /Crema|Sour Cream/i.test(opts(l)));
  assert.equal(crema.length, 1, dump);
  const drink = c.filter((l: any) => /sq-drink-/.test(String(l.itemId)));
  assert.equal(drink.length, 1, dump);
  assert.equal(drink[0].itemId, PEPSI, dump);
  assert.equal(drink[0].quantity, 1);
  assert.equal((drink[0].elviNotes || []).some((n: string) => /sabor no dicho/.test(n)), false, dump);
  assert.equal(r.fulfillment, "PICKUP");
});
