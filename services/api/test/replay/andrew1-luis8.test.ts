// andrew1 (CA67453b 3:46 PM ET) sopesazo "de asada" = Bistec; luis8 (CAf762f3 3:47 PM ET) 2 regular deshebrada burritos, no phantom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const opts = (l: any) => l.modifiers.map((m: any) => m.option);
test("andrew1: 'sopesazo de as, asada' → Bistec meat; gordita prensado untouched", () => {
  const d = fx("CA67453b-andrew1"); const c = structuredClone(d.cart.cart); L.applySopesAsada(c, d.turns);
  assert.ok(opts(c[0]).includes("Bistec / Steak")); assert.deepEqual(c[1], d.cart.cart[1]);
});
test("andrew1 live: sopes add with only salsa asada gets Bistec; 'salsa asada' alone does not", () => {
  const r = { actions: [{ type: "add_item", itemId: "sq-sopesaso-elvis-IP2IMW", quantity: 1, modifiers: [{ step: "(D) Salsa Options", option: "Mild Salsa Asada" }] }] };
  assert.ok(opts(L.liveSopesAsada(r, { transcript: "de asada" }).actions[0]).includes("Bistec / Steak"));
  assert.equal(L.liveSopesAsada(r, { transcript: "de pollo con salsa asada" }), r);
});
test("luis8: 2 regular deshebrada no deluxe, no cebolla/cilantro; phantom burrito gone; sopes kept", () => {
  const d = fx("CAf762f3-luis8"); const c = structuredClone(d.cart.cart); L.applyBurritoSaid(c, d.turns);
  assert.equal(c.length, 2); assert.deepEqual(c[0], d.cart.cart[0]);
  const b = c[1]; assert.equal(b.quantity, 2);
  assert.ok(opts(b).includes("Regular '10")); assert.ok(!opts(b).some((o: string) => /Grande|DELUXE|Bistec/.test(o)));
  assert.deepEqual(b.elviNotes, ["no cebolla", "no cilantro"]);
});
test("luis8 general: 'otro burrito' keeps the extra line; deluxe said keeps DELUXE", () => {
  const c: any[] = [{ itemId: "sq-burrito-TGWBEN", quantity: 2, modifiers: [{ step: "(B) Burrito Carne Options", option: "Deshebrada / Shredded Beef with Potatoes" }, { step: "(E) DELUXE Options", option: "DELUXE" }] },
    { itemId: "sq-burrito-TGWBEN", quantity: 1, modifiers: [{ step: "(B) Burrito Carne Options", option: "Bistec / Steak" }] }];
  L.applyBurritoSaid(c, [{ speaker: "caller", text: "dos burritos de deshebrada deluxe" }, { speaker: "caller", text: "y otro burrito de bistec" }] as any);
  assert.equal(c.length, 2); assert.ok(opts(c[0]).includes("DELUXE"));
});
