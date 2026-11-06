// nati1 (CAccade09e, Nov 6 ~5:02 PM ET, Nati, Spanish pickup):
// enchiladas orden de 6, mitad y mitad queso y papa, con todo — 3 and 3, the free toppings, no salsa.
// una orden de tacos al vapor, uno de cada — all five fillings as modifiers, not three plus a note.
// Name stays Nati. Square / SMS / callers are not part of this replay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyEnchiladaOrder, applyVaporOrders, ENCH_ID, VAPOR_ID } from "../../src/readback-pass.ts";
import { applyEnchiladaConTodo } from "../../src/list-repair.ts";
import { fixEnchiladaSpoken } from "../../src/standard-toppings.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CAccade09e-nati1.json", import.meta.url), "utf8"));
const COUNTER = "sq-enchiladas-orden-de-enchiladas-6-counter";
const STEP = "(A) Tacos al Vapor Carne Options (ONLINE)";
const FILL5 = ["Papas / Potatoes", "Frijoles / Beans", "Prensado / Pork", "Pollo / Chicken", "Queso / Cheese"];
const TOPS = ["Lechuga / Lettuce", "Cebolla / Onion", "Jitomate / Tomato", "Crema / Sour Cream", "Queso Fresco / Fresco Cheese"];
const CARNE = ["Queso / Cheese", "Papas / Potatoes", "Frijol / Beans", "Pollo / Chicken", "Prensado / Pork"];
const online = {
  id: ENCH_ID, name: "Enchiladas", modifierGroups: [
    { name: "(A) Enchiladas Carne Options (ONLINE)", options: CARNE.map((name) => ({ name, priceDeltaCents: 0 })) },
    { name: "(I) Salsa Preferencia / Preference", options: ["Mild Salsa Asada", "Mild Salsa Tomato", "Medium Salsa Verde", "Hot Salsa Roja"].map((name) => ({ name, priceDeltaCents: 0 })) },
    { name: "(C) EXTRAS", options: [{ name: "***EXTRA Hot Salsa Roja 2oz (+$0.75)", priceDeltaCents: 75 }] },
  ],
};
const counter = {
  id: COUNTER, name: "Enchiladas", modifierGroups: [
    { name: "(A) Enchiladas Carne", options: CARNE.map((name) => ({ name, priceDeltaCents: 0 })) },
    { name: "(F) Enchiladas Mas Opciones", options: TOPS.map((name) => ({ name, priceDeltaCents: 0 })) },
  ],
};
const counted = {
  id: "sq-enchiladas-orden-de-enchiladas-6-counts", name: "Enchiladas", modifierGroups: [
    { name: "(A) Enchiladas Count", options: ["3xQUESO", "3xPAPAS", "1xQUESO", "1xPAPAS"].map((name) => ({ name, priceDeltaCents: 0 })) },
    { name: "(F) Enchiladas Mas Opciones", options: TOPS.map((name) => ({ name, priceDeltaCents: 0 })) },
  ],
};
const menu = [online, counter, { id: VAPOR_ID, name: "Tacos al Vapor", modifierGroups: [{ name: STEP, options: FILL5.map((name) => ({ name, priceDeltaCents: 0 })) }] }];
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option));
const empty = async () => ({ reply: "¿Algo más?", actions: [] });
(empty as any).menu = () => menu;

test("nati1: five counted vapor fillings are modifiers, and a shorter mix stays a shorter mix", () => {
  const five: any[] = [];
  applyVaporOrders(five, [
    { speaker: "caller", text: "una orden de tacos al vapor, mixeados, uno de cada" },
    { speaker: "staff", text: "uno de papa, uno de frijol, uno de prensado, uno de pollo y uno de queso" },
  ] as any);
  assert.equal(five.length, 1);
  assert.equal(five[0].quantity, 1);
  assert.deepEqual(opts(five[0]), FILL5);
  assert.equal(five[0].elviNotes[0], "vapor: 1 papa, 1 frijol, 1 prensado, 1 pollo, 1 queso");

  const fewer: any[] = [];
  applyVaporOrders(fewer, [
    { speaker: "caller", text: "una orden de tacos al vapor" },
    { speaker: "staff", text: "Dos de papa y tres de frijol." },
  ] as any);
  assert.equal(fewer.length, 1);
  assert.equal(fewer[0].quantity, 1);
  assert.deepEqual(opts(fewer[0]), ["Papas / Potatoes", "Frijoles / Beans"]);
  assert.equal(fewer[0].elviNotes[0], "vapor: 2 papa, 3 frijol");

  const two: any[] = [];
  applyVaporOrders(two, [
    { speaker: "caller", text: "dos órdenes de tacos al vapor" },
    { speaker: "staff", text: "uno de papa, uno de frijol, uno de prensado, uno de pollo y uno de queso, y luego cuatro de prensado y uno de frijol" },
  ] as any);
  assert.equal(two.length, 2);
  assert.ok(two.every((l) => l.quantity === 1));
  assert.deepEqual(opts(two[0]), FILL5);
  assert.deepEqual(opts(two[1]), ["Frijoles / Beans", "Prensado / Pork"]);
  assert.deepEqual(two.map((l) => l.elviNotes[0]), ["vapor: 1 papa, 1 frijol, 1 prensado, 1 pollo, 1 queso", "vapor: 1 frijol, 4 prensado"]);
});

test("nati1: con todo uses the item that has the free toppings and does not invent a salsa", () => {
  const cart: any[] = [];
  applyEnchiladaOrder(cart, d.turns);
  const before = cart.find((l) => /enchilad/i.test(l.itemId));
  before.modifiers.push({ step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Tomato" });
  applyEnchiladaConTodo(cart, d.turns, menu);
  const ench = cart.filter((l) => /enchilad/i.test(String(l.itemId)));
  assert.equal(ench.length, 1);
  assert.equal(ench[0].itemId, COUNTER);
  assert.equal(ench[0].quantity, 1);
  assert.equal(ench[0].elviNotes[0], "enchiladas: 3 queso, 3 papa");
  assert.ok(opts(ench[0]).includes("Queso / Cheese") && opts(ench[0]).includes("Papas / Potatoes"));
  for (const top of TOPS) assert.ok(opts(ench[0]).includes(top), top);
  assert.equal(opts(ench[0]).some((o: string) => /salsa/i.test(o)), false);

  const onlineOnly: any[] = [{ itemId: ENCH_ID, quantity: 1, modifiers: [{ step: "(A) Enchiladas Carne Options (ONLINE)", option: "Queso / Cheese" }, { step: "(A) Enchiladas Carne Options (ONLINE)", option: "Papas / Potatoes" }, { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Tomato" }], elviNotes: ["enchiladas: 3 queso, 3 papa"] }];
  applyEnchiladaConTodo(onlineOnly, d.turns, [online]);
  assert.equal(onlineOnly[0].itemId, ENCH_ID);
  assert.deepEqual(opts(onlineOnly[0]), ["Queso / Cheese", "Papas / Potatoes"]);
  assert.equal(opts(onlineOnly[0]).some((o: string) => TOPS.includes(o)), false);
});

test("nati1: a named salsa stays; con todo does not replace it with Mild Salsa Tomato", () => {
  const [kept]: any = fixEnchiladaSpoken(
    [{ type: "add_item", itemId: ENCH_ID, modifiers: [{ step: "(A) Enchiladas Carne Options (ONLINE)", option: "Frijol / Beans" }, { step: "(I) Salsa Preferencia / Preference", option: "Medium Salsa Verde" }] }],
    [online, counter],
    "enchiladas de frijol y una salsa verde aparte",
  );
  assert.equal(kept.itemId, ENCH_ID);
  assert.match(opts(kept).join(" | "), /Medium Salsa Verde/);
  assert.equal(opts(kept).some((o: string) => /Tomato|Lechuga/.test(o)), false);

  const [todo]: any = fixEnchiladaSpoken(
    [{ type: "add_item", itemId: ENCH_ID, modifiers: [{ step: "(A) Enchiladas Carne Options (ONLINE)", option: "Queso / Cheese" }, { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Tomato" }] }],
    [online],
    "enchiladas de queso con todo",
  );
  assert.equal(todo.itemId, ENCH_ID);
  assert.equal(opts(todo).some((o: string) => /salsa/i.test(o)), false);
});

test("nati1: a count-list option is used only when that count was asked", () => {
  const row = { itemId: ENCH_ID, quantity: 1, modifiers: [{ step: "(A) Enchiladas Carne Options (ONLINE)", option: "Queso / Cheese" }, { step: "(A) Enchiladas Carne Options (ONLINE)", option: "Papas / Potatoes" }], elviNotes: ["enchiladas: 3 queso, 3 papa"] };
  applyEnchiladaConTodo([row], [{ speaker: "caller", text: "una orden de enchiladas con todo" }, { speaker: "staff", text: "tres y tres de queso y de papa, con todo, ¿verdad?" }, { speaker: "caller", text: "Con todo, sí." }] as any, [online, counted]);
  assert.equal(row.itemId, counted.id);
  assert.ok(opts(row).includes("3xQUESO") && opts(row).includes("3xPAPAS"));
  assert.equal(opts(row).some((o: string) => /^1x/.test(o)), false);
  for (const top of TOPS) assert.ok(opts(row).includes(top), top);
  assert.equal(row.quantity, 1);
});

test("nati1: replay is one vapor order of five fillings, one enchilada order of 6 split 3 and 3 con todo, name Nati", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, empty as any);
  const v = r.cart.filter((l: any) => l.itemId === VAPOR_ID);
  assert.equal(v.length, 1, JSON.stringify(r.cart));
  assert.equal(v[0].quantity, 1);
  assert.deepEqual(opts(v[0]), FILL5);
  assert.equal(v[0].elviNotes[0], "vapor: 1 papa, 1 frijol, 1 prensado, 1 pollo, 1 queso");
  const ench = r.cart.filter((l: any) => /enchilad/i.test(String(l.itemId)));
  assert.equal(ench.length, 1, JSON.stringify(r.cart));
  assert.equal(ench[0].quantity, 1);
  assert.equal(ench[0].itemId, COUNTER);
  assert.equal(ench[0].elviNotes[0], "enchiladas: 3 queso, 3 papa");
  assert.ok(opts(ench[0]).includes("Queso / Cheese") && opts(ench[0]).includes("Papas / Potatoes"));
  for (const top of TOPS) assert.ok(opts(ench[0]).includes(top), opts(ench[0]).join(" | "));
  assert.equal(opts(ench[0]).some((o: string) => /salsa/i.test(o)), false);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Nati");
});
