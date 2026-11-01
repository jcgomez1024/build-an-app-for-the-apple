// julio-burrito1 (CA13404a, Sun Nov 1 3:27 PM ET): staff misheard "¿dos burritos… grandes?"; caller: one burrito, regular. Elvi added phantom grande.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dropStaffGrandeBurrito } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA13404a-julio-burrito1.json", import.meta.url), "utf8"));
test("julio-burrito1: phantom grande dropped, regular + QD + 2 salsas remain", () => {
  const cart = structuredClone(d.elviOrder.cart); dropStaffGrandeBurrito(cart, d.turns);
  const b = cart.filter((l: any) => /burrito/.test(l.itemId)); assert.equal(b.length, 1);
  assert.ok(b[0].modifiers.some((m: any) => m.option === "Regular '10")); assert.equal(cart.length, 3);
});
test("julio-burrito1: caller who said grande keeps it", () => {
  const cart = structuredClone(d.elviOrder.cart); const t = [...d.turns, { speaker: "caller", text: "y otro grande de asada" }];
  assert.equal(dropStaffGrandeBurrito(cart, t), false); assert.equal(cart.length, 4);
});
