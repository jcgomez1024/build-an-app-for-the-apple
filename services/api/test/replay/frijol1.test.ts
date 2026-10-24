// frijol1 (Paco 1:59): "solo frijol y queso" = Frijoles Refritos + Queso Derretido; burrito de pollo drops Chile Relleno;
// staff toppings list + "sí" = con todo on the burrito. Synthetic, no PII.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meatOptSaid, fixNamedMeats, fixBurritoFillings } from "../../src/site-catalog.ts";
import { listedMeats, meatFragment, shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";

test("frijol1: singular frijol matches Frijoles Refritos; bare queso = derretido not fresco", () => {
  const said = "solo frijol y queso";
  assert.equal(meatOptSaid("Frijoles Refritos / Refried Beans", said), true);
  assert.equal(meatOptSaid("Queso Derretido / Melted Cheese", said), true);
  assert.equal(meatOptSaid("Queso Fresco / Cheese", said), false);
});

test("frijol1: fixNamedMeats keeps frijol + derretido on a quesadilla", () => {
  const menu = [{ id: "q", name: "Quesadilla", modifierGroups: [
    { id: "B", name: "(B) Q Carnes / Meats", maxSelections: 2, options: [
      { id: "f", name: "Frijoles Refritos / Refried Beans" },
      { id: "qd", name: "Queso Derretido / Melted Cheese" },
      { id: "qf", name: "Queso Fresco / Cheese" },
    ] },
  ] }];
  const acts = [{ type: "add_item", itemId: "q", quantity: 3, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Queso Derretido / Melted Cheese" }] }];
  const out = fixNamedMeats(acts as any, menu, "solo frijol y queso", "elvi");
  assert.deepEqual(out[0].modifiers.map((m: any) => m.option).sort(), [
    "Frijoles Refritos / Refried Beans", "Queso Derretido / Melted Cheese",
  ]);
});

test("frijol1: burrito de pollo strips Chile Relleno the model stacked on", () => {
  const menu = [{ id: "b", name: "Burrito", modifierGroups: [
    { id: "M", name: "(B) B Carnes / Meats", maxSelections: 2, options: [
      { id: "p", name: "Pollo / Chicken" },
      { id: "r", name: "Chile Relleno De Queso / Cheese Chile Relleno" },
    ] },
    { id: "O", name: "(C) Burrito Options", options: [
      { id: "a", name: "Arroz / Rice" }, { id: "f", name: "Frijoles Refritos / Refried Beans" },
    ] },
  ] }];
  const acts = [{ type: "add_item", itemId: "b", quantity: 1, modifiers: [
    { step: "(B) B Carnes / Meats", option: "Pollo / Chicken" },
    { step: "(B) B Carnes / Meats", option: "Chile Relleno De Queso / Cheese Chile Relleno" },
  ] }];
  const out = fixBurritoFillings(acts as any, menu, "y un burrito de pollo", "elvi");
  assert.deepEqual(out[0].modifiers.map((m: any) => m.option), ["Pollo / Chicken"]);
});

test("frijol1: staff toppings list + sí applies con todo to the burrito just rung", async () => {
  const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn => ({ speaker, start, end: start + 1, text, language: "es" });
  const burrito = { type: "add_item", itemId: "sq-burrito-X", quantity: 1, modifiers: [{ step: "S", option: "Regular '10" }, { step: "M", option: "Pollo / Chicken" }] };
  const withTodo = { ...burrito, modifiers: [...burrito.modifiers,
    { step: "O", option: "Arroz / Rice" }, { step: "O", option: "Frijoles Refritos / Refried Beans" },
    { step: "O", option: "Queso Fresco / Cheese" }, { step: "O", option: "Crema / Sour Cream" },
    { step: "O", option: "Cebolla / Onion" }, { step: "O", option: "Cilantro" }] };
  const run = async (text: string) => {
    if (/burrito de pollo/i.test(text)) return { reply: "Burrito de pollo. ¿Regular o grande?", actions: [burrito] };
    if (/^regular$/i.test(text) || /a regular/i.test(text)) return { reply: "Regular. ¿Algo más?", actions: [] };
    if (/con todo|el burrito con todo/i.test(text)) return { reply: "Con todo. ¿Algo más?", actions: [withTodo] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const r: any = await shadowOrderFromTurns([
    T("caller", "Y un burrito de pollo.", 0),
    T("staff", "Un burrito de pollo. ¿Lo quieres regular o grande?", 2),
    T("caller", "A regular.", 4),
    T("staff", "Muy bien.", 6),
    T("caller", "Sería todo.", 8),
    T("staff", "Arroz, frijoles, queso fresco, crema, cilantro y cebolla, ¿está bien?", 10),
    T("caller", "sí.", 12),
  ], run as any);
  const line = r.cart.find((l: any) => l.itemId === "sq-burrito-X");
  assert.ok(line, "burrito in cart");
  const opts = (line.modifiers || []).map((m: any) => m.option);
  assert.ok(opts.some((o: string) => /arroz/i.test(o)), opts.join("; "));
  assert.ok(opts.some((o: string) => /frijol/i.test(o)), opts.join("; "));
  assert.ok(opts.some((o: string) => /crema/i.test(o)), opts.join("; "));
  assert.equal(r.cart.filter((l: any) => l.itemId === "sq-burrito-X").length, 1);
});

test("pablo1: listedMeats + meatFragment cover qty de meat and De tripa", () => {
  assert.deepEqual(listedMeats("cuatro de tripa y cuatro de costilla").map((x) => [x.meat, x.qty]), [["tripa", 4], ["costilla", 4]]);
  assert.equal(meatFragment("De tripa."), "De tripa");
});

test("frijol1: solo frijol y queso sets beans+melted on quesadillas and keeps tres", async () => {
  const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn => ({ speaker, start, end: start + 1, text, language: "es" });
  const qAdd = { type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [
    { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
    { step: "(B) Q Carnes / Meats", option: "Queso Derretido / Melted Cheese" },
  ] };
  const run = async (text: string) => {
    if (/tres quesadillas|quesadillas del comal|quesadillas de comal/i.test(text)) return { reply: "Tres del comal. ¿De qué?", actions: [qAdd] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const r: any = await shadowOrderFromTurns([
    T("caller", "Me puedes dar tres quesadillas, pero solo sería este...", 0),
    T("staff", "Tres quesadillas del del comal.", 2),
    T("caller", "sí. Solo nomás, este, le pone frijol y queso.", 4),
    T("staff", "Okay. Entonces te tengo tres quesadillas del comal, de frijol", 6),
    T("caller", "Con frijol y queso.", 8),
    T("staff", "Ajá, ¿queso derretido o queso de desboronar?", 10),
    T("caller", "Sí, de derretido.", 12),
  ], run as any);
  const qs = r.cart.filter((l: any) => /quesadilla/i.test(l.itemId));
  assert.equal(qs.length, 1, JSON.stringify(r.cart));
  assert.equal(qs[0].quantity, 3, "keep tres");
  const opts = (qs[0].modifiers || []).map((m: any) => m.option);
  assert.ok(opts.some((o: string) => /Frijoles Refritos/i.test(o)), opts.join("; "));
  assert.ok(opts.some((o: string) => /Queso Derretido/i.test(o)), opts.join("; "));
  assert.ok(!opts.some((o: string) => /Queso Fresco/i.test(o)), opts.join("; "));
});

test("frijol1: toppings sí never invents phantom burritos", async () => {
  const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn => ({ speaker, start, end: start + 1, text, language: "es" });
  const burrito = { type: "add_item", itemId: "sq-burrito-TGWBEN", quantity: 1, modifiers: [
    { step: "(A) Burrito Size", option: "Regular '10" },
    { step: "(B) Burrito Carne Options", option: "Pollo / Chicken" },
    { step: "(B) Burrito Carne Options", option: "Chile Relleno De Queso / Cheese Chile Relleno" },
  ] };
  const phantom = { type: "add_item", itemId: "sq-burrito-TGWBEN", quantity: 1, modifiers: [
    { step: "(A) Burrito Size", option: "Grande '12" },
    { step: "(B) Burrito Carne Options", option: "Bistec / Steak" },
  ] };
  const run = async (text: string) => {
    if (/burrito de pollo/i.test(text)) return { reply: "Burrito de pollo.", actions: [burrito] };
    if (/con todo|arroz frijoles/i.test(text)) return { reply: "Ok.", actions: [phantom, phantom] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const r: any = await shadowOrderFromTurns([
    T("caller", "Y un burrito de pollo.", 0),
    T("staff", "Un burrito de pollo. ¿Regular o grande?", 2),
    T("caller", "A regular.", 4),
    T("staff", "Muy bien.", 6),
    T("caller", "Sería todo.", 8),
    T("staff", "Arroz, frijoles, queso fresco, crema, cilantro y cebolla, ¿está bien?", 10),
    T("caller", "sí. Ah, nueve", 12),
  ], run as any);
  const burs = r.cart.filter((l: any) => /burrito/i.test(l.itemId));
  assert.equal(burs.length, 1, JSON.stringify(r.cart));
  const opts = (burs[0].modifiers || []).map((m: any) => m.option);
  assert.ok(opts.some((o: string) => /Pollo/i.test(o)));
  assert.ok(!opts.some((o: string) => /relleno/i.test(o)), "strip chile relleno: " + opts.join("; "));
  assert.ok(opts.some((o: string) => /Arroz/i.test(o)) || opts.some((o: string) => /Crema/i.test(o)), opts.join("; "));
  assert.ok(!opts.some((o: string) => /Grande|Bistec/i.test(o)), opts.join("; "));
});
