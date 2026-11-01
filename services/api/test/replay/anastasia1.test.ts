// anastasia1 (CAb32fa45, Sun Nov 1 3:21 PM ET): English pickup — 1 Nachos Elvis chorizo con todo; 1 grande chorizo no beans (rice, fresco, crema, onion, cilantro); 2 regular "same thing".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyBurritoGroupFillings, applyNachosSaid } from "../../src/list-repair.ts";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAb32fa4-anastasia-burrito1.json", import.meta.url), "utf8"));
const opts = (l: any) => (l.modifiers || []).map((m: any) => m.option);
test("anastasia1: multi-burrito 'same thing' → chorizo, no beans, 5 toppings on all three", () => {
  const cart = structuredClone(d.elviOrder.cart); applyBurritoGroupFillings(cart, d.turns);
  for (const l of cart.filter((x: any) => /burrito/.test(x.itemId))) { const o = opts(l);
    assert.ok(o.includes("Chorizo / Mexican Sausage"), JSON.stringify(o)); assert.ok(!o.some((x: string) => /Frijoles/.test(x)), JSON.stringify(o));
    for (const t of ["Arroz / Rice", "Queso Fresco / Cheese", "Crema / Sour Cream", "Cebolla / Onion", "Cilantro"]) assert.ok(o.includes(t), t); }
});
test("anastasia1: chorizo nachos get meat + staff-listed toppings, not just melted cheese", () => {
  const cart = structuredClone(d.elviOrder.cart); applyNachosSaid(cart, d.turns);
  const o = opts(cart.find((x: any) => /nachos/.test(x.itemId)));
  assert.ok(o.includes("Chorizo / Mexican Sausage")); assert.ok(!o.includes("Queso Derretido / Melted Cheese"));
  for (const t of ["Frijoles / Pinto Beans", "Lechuga / Lettuce", "Pico de Gallo", "Crema / Sour Cream", "Queso Dip / Cheese Dip"]) assert.ok(o.includes(t), t);
});
test("anastasia1: single-burrito no-op guards — no 'same', regular beans kept", () => {
  const cart = [{ itemId: "sq-burrito-TGWBEN", quantity: 1, modifiers: [{ step: "(B) Burrito Carne Options", option: "Pollo / Chicken" }, { step: "(C) Burrito Options", option: "Frijoles Refritos / Refried Beans" }] }];
  applyBurritoGroupFillings(cart, [{ speaker: "caller", text: "a chicken burrito please" }] as any); assert.ok(opts(cart[0]).includes("Frijoles Refritos / Refried Beans"));
});
test("anastasia1: pickup never carries transcript text as address", async () => {
  const run = Object.assign(async () => ({ actions: [], reply: "?" }) as any, { menu: () => [] });
  const r: any = await shadowOrderFromTurns(d.turns, run as any); assert.equal(r.address ?? null, null);
});
