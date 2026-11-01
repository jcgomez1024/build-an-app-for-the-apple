import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyMenudoSoloCaldo, liveMenudoSoloCaldo, soloCaldoSaid, soloCaldoResolve, MENUDO_SOLO_CALDO_VAR } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA2bbc40-victor-caldo1.json", import.meta.url), "utf8"));
const SC = { id: "sq-menudo-solo-caldo-menudo-PYTW56", name: "Menudo SOLO Caldo", squareVariationId: MENUDO_SOLO_CALDO_VAR, priceCents: 1000 };
const REG = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const menu = [SC, { id: REG, name: "Menudo" }];
test("victor-caldo1: after-call 2 menudos 'de puro caldo, sin la carne' → 2 Menudo SOLO Caldo", () => {
  const c = structuredClone(d.cart); assert.equal(applyMenudoSoloCaldo(c, d.turns, menu), true);
  assert.deepEqual(c.map((l: any) => [l.itemId, l.quantity, l.modifiers.length]), [[SC.id, 2, 0]]);
});
test("victor-caldo1: phrases — puro/solo/solamente caldo, sin carne, nomás el caldo; not caldo de res or plain menudo", () => {
  for (const t of ["dos menudos de puro caldo", "un menudo solo caldo", "menudo solamente caldo", "menudo sin carne", "un menudo, nomás el caldo"]) assert.ok(soloCaldoSaid(t), t);
  assert.ok(soloCaldoSaid("Sí, sin la carne", ["dos menudos. ¿Puro caldo?"]));
  assert.equal(soloCaldoSaid("un caldo de res sin carne"), false);
  assert.equal(soloCaldoSaid("dos menudos grandes"), false);
  assert.equal(soloCaldoSaid("tacos sin carne", ["¿Qué más?"]), false);
  assert.equal(soloCaldoSaid("una quesadilla sin carne", ["un menudo grande"]), false);
});
test("victor-caldo1: live — full-menudo add becomes SOLO Caldo; follow-up swaps the cart line", () => {
  const r = liveMenudoSoloCaldo({ reply: "Listo.", actions: [{ type: "add_item", itemId: REG, quantity: 2, modifiers: [{ step: "(A) Menudo Tortillas", option: "x" }] }] }, { transcript: "dos menudos de puro caldo", menu, cart: [], language: "es" });
  assert.deepEqual(r.actions, [{ type: "add_item", itemId: SC.id, quantity: 2, modifiers: [] }]); assert.match(r.reply, /2 menudos solo caldo, \$20\.00/);
  const r2 = liveMenudoSoloCaldo({ reply: "¿Algo más?", actions: [] }, { transcript: "De puro caldo, sí, sin la carne", history: [{ role: "assistant", text: "dos menudos. ¿Puro caldo?" }], menu, cart: [{ itemId: REG, quantity: 2 }], language: "es" });
  assert.deepEqual(r2.actions, [{ type: "remove_item", itemId: REG, quantity: 2 }, { type: "add_item", itemId: SC.id, quantity: 2, modifiers: [] }]);
  const plain = { reply: "ok", actions: [{ type: "add_item", itemId: REG, quantity: 1, modifiers: [] }] };
  assert.equal(liveMenudoSoloCaldo(plain, { transcript: "un menudo", menu, cart: [] }), plain);
});
test("victor-caldo1: resolver swap", () => {
  const res: any = { ok: true, actions: [{ type: "add_item", itemId: REG, quantity: 2, modifiers: [{}] }] };
  assert.equal(soloCaldoResolve(res, "dos menudos de puro caldo", menu), true); assert.equal(res.actions[0].itemId, SC.id); assert.equal(res.actions[0].quantity, 2);
  const dor: any = { ok: false, reason: "missing_required_modifiers", message: "Tacos Dorados: ¿Bistec?" };
  assert.equal(soloCaldoResolve(dor, "dos menudos de puro caldo", menu, 2, "es"), true); assert.deepEqual(dor.actions, [{ type: "add_item", itemId: SC.id, quantity: 2, modifiers: [] }]); assert.match(dor.message, /\$20\.00/);
  const plain: any = { ok: false, reason: "choose_variation" }; assert.equal(soloCaldoResolve(plain, "un menudo grande", menu), false);
});
