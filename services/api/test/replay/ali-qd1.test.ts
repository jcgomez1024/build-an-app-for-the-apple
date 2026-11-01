// ali-qd1 (CA318307, Sun Nov 1 3:23 PM ET): 2 QD regular duro "en el aceite", cebolla y cilantro. Elvi rang 1 Deluxe + 2 QCO comal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyQdGroups, qdGroups } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA318307-ali-qd1.json", import.meta.url), "utf8"));
test("ali-qd1: 'dos quesadillas en el aceite de chicharrón duro' → one group, 2, regular", () => {
  const g = qdGroups(d.turns); assert.equal(g.length, 1); assert.equal(g[0].n, 2); assert.equal(g[0].deluxe, false);
});
test("ali-qd1: rebuild → exactly 2× QD REGULAR Dorada duro, no comal, no deluxe", () => {
  const cart = structuredClone(d.elviOrder.cart); applyQdGroups(cart, d.turns);
  const q = cart.reduce((a: number, l: any) => a + l.quantity, 0); assert.equal(q, 2, JSON.stringify(cart));
  for (const l of cart) { assert.match(l.itemId, /qd-regular-dorada/); assert.ok(l.modifiers.some((m: any) => /Duro/.test(m.option))); }
});
