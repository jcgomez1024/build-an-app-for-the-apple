import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCoctelNotCeviche, liveCoctelNotCeviche } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA67bc69-miriam-coctel1.json", import.meta.url), "utf8"));
const PULPO = "sq-coctel-de-camarones-shrimp-cocktail-coctel-de-camaron-shrimp-and-pulpo-calamari-B5ITWC";
test("miriam-coctel1: 'coctel de camarón' + 'con pulpo' → Coctel con pulpo, never the Ceviche", () => {
  const c = structuredClone(d.cart.cart); assert.equal(applyCoctelNotCeviche(c, d.turns), true);
  assert.equal(c.length, 1); assert.equal(c[0].itemId, PULPO); assert.equal(c[0].quantity, 1);
});
test("miriam-coctel1 rule: a caller who said ceviche keeps the ceviche", () => {
  const c = [{ itemId: "sq-ceviche-ceviche-de-camaron-shrimp-GVSGMI", quantity: 1, modifiers: [] }];
  assert.equal(applyCoctelNotCeviche(c, [{ speaker: "caller", text: "un ceviche de camarón" }] as any), false);
  const c2 = [{ itemId: "sq-ceviche-ceviche-de-camaron-shrimp-GVSGMI", quantity: 1, modifiers: [] }];
  assert.equal(applyCoctelNotCeviche(c2, [{ speaker: "caller", text: "un coctel de camarón" }] as any), true);
  assert.equal(c2[0].itemId, "sq-coctel-de-camarones-shrimp-cocktail-coctel-de-camaron-shrimp-VWHXC4");
});
test("miriam-coctel1 live: 'Con pulpo' after '¿tienes coctel de camarón?' adds the coctel", () => {
  const r = liveCoctelNotCeviche({ reply: "Ceviche Ceviche de Camaron Con Pulpo. $22.99. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-ceviche-ceviche-de-camaron-con-pulpo-shrimp-and-calamari-4PFDP3", quantity: 1 }] },
    { transcript: "Con pulpo", history: [{ role: "customer", text: "Am, hola, disculpa, ¿tienes coctel de camarón?" }], language: "es" });
  assert.equal(r.actions[0].itemId, PULPO); assert.doesNotMatch(r.reply, /Ceviche/);
});
