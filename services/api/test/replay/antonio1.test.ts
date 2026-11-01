import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyConsomeSolo, liveConsomeSolo, consomeSoloQty } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAfa1c39-antonio1.json", import.meta.url), "utf8"));
const B = /^sq-birria-/;
test("antonio1: 2 QD regular bistec + 'un consomé' → consomé solo 16oz", () => {
  const c = structuredClone(d.cart.cart); assert.equal(applyConsomeSolo(c, d.turns), true);
  assert.equal(c.length, 2); assert.equal(c[0].quantity, 2); const b = c.find((l: any) => B.test(l.itemId));
  assert.equal(b.quantity, 1); assert.match(b.modifiers[0].option, /SOLO \/ ONLY 16oz de Consome/);
  assert.equal(applyConsomeSolo(c, d.turns), false);
});
test("antonio1 rule: con consomé / birria / quesabirria are not a solo consomé", () => {
  assert.equal(consomeSoloQty("y me pones un consomé."), 1); assert.equal(consomeSoloQty("solamente consomé"), 1); assert.equal(consomeSoloQty("dos consomés"), 2);
  assert.equal(consomeSoloQty("una birria con consomé"), 0); assert.equal(consomeSoloQty("quesabirrias con su consomé"), 0);
});
test("antonio1 live: 'un consomé' adds the consomé, not a QD question", () => {
  const r = liveConsomeSolo({ reply: "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?", actions: [] }, { transcript: "un consomé", cart: d.cart.cart, language: "es" });
  assert.equal(r.actions.length, 1); assert.match(r.actions[0].itemId, B); assert.doesNotMatch(r.reply, /Dorada/);
});
