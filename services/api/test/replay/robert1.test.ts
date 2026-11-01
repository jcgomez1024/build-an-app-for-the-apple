import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEnglishMultiItem, liveMultiItem, noReaskAnswered } from "../../src/list-repair.ts";
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const raw = fx("CA4bdd506-menu.json"); const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const opts = (l: any) => (l.modifiers || []).map((m: any) => m.option).join(" | ");
const B4 = { type: "add_item", itemId: "sq-burrito-TGWBEN", quantity: 4, modifiers: [{ step: "(B) Burrito Carne Options", option: "Bistec / Steak" }, { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" }] };
test("robert1 after-call: 4 TST asada, 1 burrito asada notes, queso dip, phantom relleno burrito gone", () => {
  const d = fx("CAcaddf9-robert1.json"); const c = structuredClone(d.cart.cart);
  assert.equal(applyEnglishMultiItem(c, d.turns, menu), true);
  assert.equal(c.length, 3);
  const t = c.find((l: any) => /^sq-taco-/.test(l.itemId)); assert.equal(t.quantity, 4); assert.match(opts(t), /TST/); assert.match(opts(t), /Bistec/);
  const b = c.filter((l: any) => /^sq-burrito-/.test(l.itemId)); assert.equal(b.length, 1); assert.equal(b[0].quantity, 1);
  assert.match(opts(b[0]), /Bistec/); assert.doesNotMatch(opts(b[0]), /Relleno|Frijoles/);
  for (const n of ["extra carne asada", "solo lechuga", "no arroz", "no frijoles", "no queso", "salsa verde"]) assert.ok(b[0].elviNotes.includes(n), n);
  assert.ok(t.elviNotes.includes("salsa verde"));
  const q = c.find((l: any) => /^sq-dips-/.test(l.itemId)); assert.match(opts(q), /Queso Dip con Chips/);
});
test("robert1 live: 'four street tacos … one burrito grande' splits into 4 TST + 1 burrito", () => {
  const r = liveMultiItem({ reply: "x", actions: [B4] }, { transcript: "we'll do four, street tacos with carne asada Yep, we'll do one burrito grande", menu, cart: [] });
  assert.equal(r.actions.length, 2); assert.equal(r.actions[0].quantity, 4); assert.match(r.actions[0].itemId, /^sq-taco-/); assert.match(opts(r.actions[0]), /TST/);
  assert.equal(r.actions[1].quantity, 1); assert.match(r.actions[1].itemId, /^sq-burrito-/);
});
test("robert1 live: 'chips and queso' never adds a burrito", () => {
  const r = liveMultiItem({ reply: "x", actions: [{ type: "add_item", itemId: "sq-burrito-TGWBEN", quantity: 1, modifiers: [] }] }, { transcript: "Yep. And then can we get chips and queso", menu, cart: [] });
  assert.equal(r.actions[0].itemId, "sq-dips-MAIPCN");
});
test("robert1 live: burrito meat already set → no re-ask", () => {
  const cart = [{ itemId: "sq-burrito-TGWBEN", quantity: 1, modifiers: B4.modifiers }];
  const r = noReaskAnswered({ reply: "Burrito: Bistec, Cabeza, Carnitas or Chorizo?", actions: [] }, { transcript: "with extra carne asada", cart, history: [], language: "en" });
  assert.equal(r.reply, "Okay.");
  const r2 = noReaskAnswered({ reply: "Burrito: Bistec, Cabeza, Carnitas or Chorizo?", actions: [] }, { transcript: "a burrito", cart: [{ itemId: "sq-burrito-TGWBEN", quantity: 1, modifiers: [B4.modifiers[1]] }], history: [], language: "en" });
  assert.notEqual(r2.reply, "Okay.");
});
test("robert1: plain 'two burritos' untouched", () => {
  const c = [{ itemId: "sq-burrito-TGWBEN", quantity: 2, modifiers: structuredClone(B4.modifiers) }];
  applyEnglishMultiItem(c, [{ speaker: "caller", text: "two burritos with steak" }] as any, menu); assert.equal(c.length, 1); assert.equal(c[0].quantity, 2);
});
