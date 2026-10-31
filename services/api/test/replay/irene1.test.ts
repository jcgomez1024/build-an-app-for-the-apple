// irene1 (CAa5a670, Oct 31 5:09 PM ET): "una coca … de taparrosca … Una de taparrosca" = 1 Coke, not 3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const d = JSON.parse(readFileSync(new URL("../fixtures/CAa5a670-irene1.json", import.meta.url), "utf8"));
const COKE = { itemId: "sq-drink-coca-cola-JJE4KC", quantity: 1, modifiers: [] };
test("irene1: re-mentioned coca collapses to 1; tacos untouched", () => {
  const c = structuredClone(d.cart.cart); L.mergeReMentionedDrink(c, d.turns);
  assert.deepEqual(c.map((l: any) => `${l.quantity} ${l.itemId.split("-").slice(0, 2).join("-")}`), ["3 sq-taco", "1 sq-taco", "1 sq-drink"]);
});
test("irene1 live: 'Una de taparrosca' with a Coke in the cart adds nothing; 'otra coca' still adds", () => {
  const r = { actions: [{ type: "add_item", ...COKE }] };
  assert.equal(L.liveDrinkReMention(r, { transcript: "Una de taparrosca.", cart: [COKE] }).actions.length, 0);
  assert.equal(L.liveDrinkReMention(r, { transcript: "y otra coca", cart: [COKE] }), r);
  assert.equal(L.liveDrinkReMention(r, { transcript: "una coca", cart: [] }), r);
});
test("irene1 general: 'dos cocas' keeps two lines", () => {
  const c = [structuredClone(COKE), structuredClone(COKE)];
  L.mergeReMentionedDrink(c, [{ speaker: "caller", text: "y dos cocas" }] as any); assert.equal(c.length, 2);
});
