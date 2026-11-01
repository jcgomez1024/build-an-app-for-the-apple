import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyExtraCarne, liveExtraCarne, wantsExtraCarne, extraCarneOption } from "../../src/list-repair.ts";
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const raw = fx("CA4bdd506-menu.json"); const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const d = fx("CA391bc9-sergio1.json");
const MEN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const opts = (l: any) => (l.modifiers || []).map((m: any) => m.option).join(" | ");
test("sergio1 after-call: 'cargadito… extra' + staff 'extra carne' → EXTRA Carne on the menudo", () => {
  const c = structuredClone(d.cart.cart);
  assert.equal(applyExtraCarne(c, d.turns, menu), true);
  assert.match(opts(c[0]), /EXTRA Carne \/ Meat \(\+\$3\.00\)/); assert.match(opts(c[0]), /Corn/);
  assert.equal(applyExtraCarne(c, d.turns, menu), false); // no double stamp
});
test("sergio1 rule: phrases", () => {
  for (const t of ["extra carne", "lo quiero cargadito", "con más carne por favor", "extra meat on it", "doble carne"]) assert.ok(wantsExtraCarne(t), t);
  assert.ok(wantsExtraCarne("un poquito más, extra", "Claro, extra carne."));
  for (const t of ["un menudo sin pata", "con pata", "sin extra carne", "cargo a la tarjeta"]) assert.ok(!wantsExtraCarne(t), t);
  assert.equal(extraCarneOption(menu, MEN)?.option, "EXTRA Carne / Meat (+$3.00)");
});
test("sergio1 rule: no extra-meat ask → nothing added; two eligible lines → ambiguous, untouched", () => {
  const c = structuredClone(d.cart.cart);
  assert.equal(applyExtraCarne(c, [{ speaker: "caller", text: "un menudo sin pata" }] as any, menu), false);
  const two = [structuredClone(d.cart.cart[0]), structuredClone(d.cart.cart[0])];
  assert.equal(applyExtraCarne(two, [{ speaker: "caller", text: "uno cargadito" }] as any, menu), false);
});
test("sergio1 live: menudo in cart + 'cargadito' → update with EXTRA Carne; on an add → stamped on the add", () => {
  const cart = structuredClone(d.cart.cart);
  const r = liveExtraCarne({ reply: "¿Algo más?", actions: [] }, { transcript: "pero lo quiero cargadito de eso", history: [], cart, menu, language: "es" });
  assert.equal(r.actions[0].type, "update_item"); assert.match(opts(r.actions[0]), /EXTRA Carne/); assert.match(opts(r.actions[0]), /Corn/);
  const r2 = liveExtraCarne({ reply: "x", actions: [{ type: "add_item", itemId: MEN, quantity: 1, modifiers: [] }] }, { transcript: "un menudo con más carne", history: [], cart: [], menu });
  assert.match(opts(r2.actions[0]), /EXTRA Carne/);
  const r3 = liveExtraCarne({ reply: "x", actions: [] }, { transcript: "Ajá, exacto, extra", history: [{ role: "staff", text: "Claro, extra carne." }], cart, menu });
  assert.equal(r3.actions.length, 1);
  const r4 = liveExtraCarne({ reply: "x", actions: [] }, { transcript: "un menudo sin pata", history: [], cart, menu });
  assert.equal(r4.actions.length, 0);
});
