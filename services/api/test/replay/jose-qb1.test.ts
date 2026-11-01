import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyQBDecline, declinedQuesabirria, liveQBDecline } from "../../src/list-repair.ts";
import { applyAskedDishes } from "../../src/asked-dishes.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA76b31b-jose-qb1.json", import.meta.url), "utf8"));
const QB = "sq-queso-birrias-qst-3-x-queso-birrias-taquera-street-con-consome-broth-VUBNR7";
const qbItem = { id: QB, name: "Queso Birrias", readbackName: "Queso Birrias", modifierGroups: [{ name: "(A) Queso Birrias Options", minSelections: 1, options: ["(QST) 3 x Queso Birrias Taquera / Street con Consome/Broth", "(QCO) 3 x Queso Birrias Comal / Homemade con Consome/Broth"] }] };
test("jose-qb1: 'que si birrias no, normales' declines; real orders don't", () => {
  for (const s of ["No, que si birrias no, normales.", "quesabirrias no", "no, normales", "sin quesibirrias"]) assert.equal(declinedQuesabirria(s), true, s);
  for (const s of ["tres quesabirrias", "dame unas quesibirrias con consomé", "tres quesadillas con birria", "dos tortas"]) assert.equal(declinedQuesabirria(s), false, s);
});
test("jose-qb1: after-call drops Queso Birrias, keeps 3 quesadillas de birria, 2 queso tortas, agua", () => {
  const c = structuredClone(d.cart);
  assert.equal(applyQBDecline(c, d.turns), true);
  assert.equal(c.some((l: any) => /queso-birrias/.test(l.itemId)), false);
  const q = c.find((l: any) => l.itemId === "sq-quesadilla-HLT6CR"); assert.equal(q.quantity, 3); assert.ok(q.modifiers.some((m: any) => /Birria/.test(m.option)));
  assert.equal(c.find((l: any) => l.itemId === "sq-torta-4GNTTE").quantity, 2); assert.ok(c.some((l: any) => /mineral/.test(l.itemId)));
  // asked-dish pass no longer rings it from the looped options question
  const c2 = c.filter((l: any) => !/queso-birrias/.test(l.itemId)); const steps = d.steps.filter((s: any) => s.source !== "asked-dish");
  applyAskedDishes(c2, steps, d.turns, [qbItem]); assert.equal(c2.some((l: any) => l.itemId === QB), false);
});
test("jose-qb1: a caller who did order quesabirrias keeps them", () => {
  const turns = [{ speaker: "caller", text: "tres quesabirrias por favor" }, { speaker: "staff", text: "¿con consomé?" }, { speaker: "caller", text: "no, sin cebolla" }];
  const c = [{ itemId: QB, quantity: 1, modifiers: [] }]; assert.equal(applyQBDecline(c, turns), false); assert.equal(c.length, 1);
  const c2: any[] = []; applyAskedDishes(c2, [{ source: "caller", heard: "tres quesabirrias por favor", reply: "Queso Birrias: ¿Taquera o Comal?" }], turns, [qbItem]); assert.equal(c2.length, 1);
});
test("jose-qb1: live decline never adds Queso Birrias or re-asks its options", () => {
  const input = { transcript: "que si birrias no, normales", language: "en", history: [{ text: "¿las quieres como quesibirrias, mojadas con consomé?" }], menu: [qbItem], cart: [] };
  const r = liveQBDecline({ reply: "Queso Birrias: 3 x Queso Birrias Taquera / Street con Consome/Broth or …?", actions: [{ type: "add_item", itemId: QB, quantity: 1 }] }, input);
  assert.equal(r.actions.length, 0); assert.doesNotMatch(r.reply, /Queso Birrias/); assert.match(r.reply, /normales/);
  const ok = { reply: "Quesadilla: ¿Comal?", actions: [] }; assert.equal(liveQBDecline(ok, { ...input, transcript: "tres quesadillas con birria" }), ok);
});
