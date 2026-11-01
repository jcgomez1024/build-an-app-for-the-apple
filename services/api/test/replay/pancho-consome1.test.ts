import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyConsomeTotal, consomeTotalSaid, liveConsomeTotal } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA35a4a9-pancho-consome1.json", import.meta.url), "utf8"));
const solo = (l: any) => l.modifiers.some((m: any) => /SOLO/.test(m.option));
test("pancho-consome1: 'dos consomé y una birria nomás' = birria + 1 extra consomé", () => {
  const c = structuredClone(d.cart);
  assert.equal(applyConsomeTotal(c, d.turns), true);
  assert.equal(c.filter((l: any) => !solo(l)).length, 1);
  const s = c.filter(solo); assert.equal(s.length, 1); assert.equal(s[0].quantity, 1);
  assert.equal(applyConsomeTotal(c, d.turns), false);
});
test("pancho-consome1: patterns and guards", () => {
  assert.deepEqual(consomeTotalSaid("que sean dos consomé y una birria nomás"), { consome: 2, birria: 1 });
  assert.deepEqual(consomeTotalSaid("una birria y tres consomés"), { consome: 3, birria: 1 });
  assert.equal(consomeTotalSaid("dos consomés extra"), null);
  const c = [{ itemId: "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD", quantity: 2, modifiers: [] }];
  assert.equal(applyConsomeTotal(c, [{ speaker: "caller", text: "dos consomé y una birria" }]), false); // birria count disagrees → leave it
});
test("pancho-consome1: live settled count adds no more consomés", () => {
  const r = liveConsomeTotal({ reply: "2 consomés de 16 oz. ¿Algo más?", actions: [{ type: "add_item", itemId: "x", modifiers: [{ option: "SOLO / ONLY 16oz de Consome" }] }] },
    { transcript: "una birria nomás", language: "es", history: [{ role: "customer", text: "que sean dos consomé" }] });
  assert.equal(r.actions.length, 0); assert.match(r.reply, /birria con su consomé y un consomé extra/);
});
