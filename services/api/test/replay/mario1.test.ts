// mario1 (CA3870a1, Oct 31 5:23 PM ET): "y de tomarme tres un carrito" — jarrito asked, flavor never transcribed → 1 jarrito, flavor flagged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const d = JSON.parse(readFileSync(new URL("../fixtures/CA3870a1-mario1.json", import.meta.url), "utf8"));
test("mario1: asked jarrito with no flavor → 1 jarrito + 'confirmar sabor' note; quesadillas untouched", () => {
  const c = structuredClone(d.cart.cart); assert.ok(L.addAskedJarrito(c, d.turns, menu));
  assert.equal(c.length, 2); assert.equal(c[0].quantity, 4); const j = c[1];
  assert.match(j.itemId, /^sq-drink-jarrito-/); assert.doesNotMatch(j.itemId, /fresa/); assert.equal(j.quantity, 1); assert.match(j.elviNotes[0], /sabor no dicho/);
  assert.equal(L.addAskedJarrito(c, d.turns, menu), false);
});
test("mario1: flavor said → that flavor, no note; no jarrito talk → nothing", () => {
  const c: any[] = []; assert.ok(L.addAskedJarrito(c, [{ speaker: "caller", text: "y para tomar un jarrito de fresa" }] as any, menu));
  assert.match(c[0].itemId, /fresa/); assert.equal(c[0].elviNotes, undefined);
  const c2: any[] = []; assert.equal(L.addAskedJarrito(c2, [{ speaker: "caller", text: "y de tomar una horchata" }] as any, menu), false);
});
test("mario1 live: 'de tomarme un carrito' adds a placeholder jarrito once", () => {
  const r = L.liveJarritoAsk({ actions: [] }, { transcript: "Okay, y de tomarme tres un carrito,", cart: [] });
  assert.equal(r.actions.length, 1); assert.equal(r.actions[0].itemId, L.JAR_PLACEHOLDER); assert.equal(r.actions[0].quantity, 1);
  assert.equal(L.liveJarritoAsk({ actions: [] }, { transcript: "un jarrito", cart: [{ itemId: L.JAR_PLACEHOLDER }] }).actions.length, 0);
  assert.equal(L.liveJarritoAsk({ actions: [] }, { transcript: "un jarrito de fresa", cart: [] }).actions.length, 0);
});
