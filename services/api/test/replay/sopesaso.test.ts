// sopesaso1: a 1:00 PM call pattern (anonymized): sopesaso + meat + chicharrón duro + "con todo"; name from staff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withConTodo, withIncludedToppings, standardToppings } from "../../src/standard-toppings.ts";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { compactCatalog, toPosLine } from "../../src/pos-catalog.ts";
import { auditCall } from "../../src/auditor.ts";
import { nameFromTranscript, nameFromStaffVocative } from "../../src/order-name.ts";

const TOPS = ["Frijoles / Pinto Beans", "DOUBLE Frijoles / Pinto Beans", "Lechuga / Lettuce", "Pico de Gallo", "Crema / Sour Cream", "Queso Fresco / Fresco Cheese", "Guacamole Dip"];
const menu = [{ id: "sop", name: "Sopesaso Elvis", modifierGroups: [
  { name: "(A) Elvis Carne / Meat Options", options: [{ name: "Bistec / Steak" }, { name: "Duro / Pork Rinds" }] },
  { name: "(B) Toppings", options: TOPS.map((name) => ({ name, priceDeltaCents: /DOUBLE|Guac/.test(name) ? 75 : 0 })) }] }];
const STD = ["Frijoles / Pinto Beans", "Lechuga / Lettuce", "Crema / Sour Cream", "Queso Fresco / Fresco Cheese"];

test("sopesaso1: 'con todo' = the sopesaso's standard toppings; 'sin X' removes one", () => {
  assert.deepEqual(standardToppings("Sopesaso Elvis"), STD);
  const [a]: any = withConTodo([{ type: "add_item", itemId: "sop", modifiers: [{ step: "(A) Elvis Carne / Meat Options", option: "Bistec / Steak" }] }], menu, "con todo, por favor");
  assert.deepEqual(a.modifiers.map((m: any) => m.option), ["Bistec / Steak", ...STD]);
  const [b]: any = withConTodo([{ type: "add_item", itemId: "sop", modifiers: [] }], menu, "con todo sin crema");
  assert.deepEqual(b.modifiers.map((m: any) => m.option), STD.filter((t) => !/Crema/.test(t)));
  assert.deepEqual(withConTodo([{ type: "add_item", itemId: "sop", modifiers: [] }], menu, "de bistec") as any, [{ type: "add_item", itemId: "sop", modifiers: [] }]);
  // Catalog-preselected free toppings generalize to other items.
  assert.deepEqual(standardToppings("Otro Platillo", [{ name: "(B) Toppings", options: [{ name: "Cebolla", preselected: true, priceDeltaCents: 0 }, { name: "DOUBLE Cebolla", preselected: true }] }]), ["Cebolla"]);
});

test("sopesaso1: shadow order — meat + duro answer and 'con todo' update the same sopesaso (no dropped re-add)", async () => {
  const mods: any[] = [];
  const run = async (text: string) => {
    if (/bistec/i.test(text)) mods.push({ step: "meat", option: "Bistec / Steak" }, { step: "meat", option: "Duro / Pork Rinds" });
    if (/con todo/i.test(text)) mods.push(...STD.map((option) => ({ step: "(B) Toppings", option })));
    return { reply: "Sopesaso Elvis. $14.99. ¿Algo más?", actions: [{ type: "add_item", itemId: "sop", quantity: 1, modifiers: [...mods] }] };
  };
  const turns: any[] = [
    { speaker: "caller", text: "¿me puede poner un sopesazo, por favor?", start: 1, end: 2, language: "es" },
    { speaker: "staff", text: "¿De qué, mano?", start: 3, end: 4, language: "es" },
    { speaker: "caller", text: "Eh, bistec con chicharrón del duro, por favor.", start: 5, end: 6, language: "es" },
    { speaker: "staff", text: "Okey, ¿con todo?", start: 7, end: 8, language: "es" },
    { speaker: "caller", text: "Con todo, por favor.", start: 9, end: 10, language: "es" },
  ];
  const r: any = await shadowOrderFromTurns(turns, run as any);
  assert.equal(r.cart.length, 1);
  assert.deepEqual(r.cart[0].modifiers.map((m: any) => m.option), ["Bistec / Steak", "Duro / Pork Rinds", ...STD]);
});

const V = (id: string, name: string, amount: number) => ({ id, item_variation_data: { name, price_money: { amount } } });
const cat = compactCatalog([
  { type: "ITEM", id: "S", item_data: { name: "Sopesaso Elvis", modifier_list_info: [{ modifier_list_id: "M" }, { modifier_list_id: "T" }], variations: [V("S10", "Sopesaso Elvis 10”", 1500), V("S2", "2 x Sopes Elvis", 1500), V("S1", "Sope Elvis", 800)] } },
  { type: "ITEM", id: "SO", item_data: { name: "Sopesaso Elvis (ONLINE)", modifier_list_info: [{ modifier_list_id: "M" }], variations: [V("SOR", "Regular", 1499)] } },
  { type: "MODIFIER_LIST", id: "M", modifier_list_data: { name: "(A) Elvis Carne / Meat Options", modifiers: [{ id: "b", modifier_data: { name: "Bistec / Steak", price_money: { amount: 0 } } }, { id: "d", modifier_data: { name: "Duro / Pork Rinds", price_money: { amount: 0 } } }, { id: "c", modifier_data: { name: "Cabeza / Beef Head", price_money: { amount: 100 } } }] } },
  { type: "MODIFIER_LIST", id: "T", modifier_list_data: { name: "(B) Toppings", modifiers: STD.map((n, i) => ({ id: `t${i}`, modifier_data: { name: n, price_money: { amount: 0 } } })) } },
]);

test("sopesaso1: POS name/variation/upcharges — online Regular → 'Sopesaso Elvis 10”', meat upcharge from Square", () => {
  const l: any = toPosLine({ name: "Sopesaso Elvis", quantity: 1, variationId: "SOR", choices: ["Cabeza / Beef Head", "Duro / Pork Rinds"], totalCents: 1599 } as any, cat);
  assert.equal(l.name, "Sopesaso Elvis · Sopesaso Elvis 10”");
  assert.equal(l.totalCents, 1600);
});

test("sopesaso1: auditor — included toppings are not STAFF_EXTRA; matching ticket = no flags", () => {
  const ticketLine = { name: "Sopesaso Elvis · Sopesaso Elvis 10”", baseName: "Sopesaso Elvis", variationId: "S10", quantity: 1, choices: ["Sopesaso Elvis 10”", "Bistec / Steak", "Duro / Pork Rinds", ...STD], totalCents: 1500 };
  const elviLine = { ...ticketLine, choices: ["Sopesaso Elvis 10”", "Bistec / Steak", "Duro / Pork Rinds"] }; // no "con todo" heard
  const row = { recordingSid: "RE1", at: new Date(0).toISOString(), recordingSec: 30, turns: [{ speaker: "caller", text: "un sopesazo de bistec con duro" }], elvi: [withIncludedToppings(elviLine)], ticket: { lines: [ticketLine] }, pairs: [{ ticket: ticketLine, elvi: elviLine }] };
  assert.deepEqual(auditCall(row, Date.now())!.flags, []);
  assert.deepEqual(withIncludedToppings(elviLine).choices.slice(-4), STD);
});

test("sopesaso1: listen-only name — staff addresses the caller by name; vocatives ignored", () => {
  const turns: any[] = [{ speaker: "staff", text: "¿De qué, mano?" }, { speaker: "caller", text: "Con todo, por favor." }, { speaker: "staff", text: "Okey, dame veinte, Kilo." }, { speaker: "staff", text: "Órale, pues, dame veinte, mano, porfa." }];
  assert.equal(nameFromTranscript(turns), "Kilo");
  assert.equal(nameFromStaffVocative([{ speaker: "staff", text: "Gracias, joven." }, { speaker: "staff", text: "Sí, Okey." }]), null);
  assert.equal(nameFromStaffVocative([{ speaker: "caller", text: "gracias, Lima." }]), null); // caller speech never counts
});
