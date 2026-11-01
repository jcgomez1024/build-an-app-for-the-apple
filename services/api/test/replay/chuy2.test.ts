import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyQdRecap, applyBurritoMeatRepeat } from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const raw = fx("CA4bdd506-menu.json"); const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const opts = (l: any) => l.modifiers.map((m: any) => m.option).join(" | ");
test("chuy2: caller recap rebuilds 6 regular + 2 preparada QD buche, drops phantoms", () => {
  const d = fx("CAc212a3-chuy2.json"); const c = structuredClone(d.cart.cart);
  assert.equal(applyQdRecap(c, d.turns, menu), true);
  const qd = c.filter((l: any) => /^sq-qd-/.test(l.itemId));
  assert.equal(qd.length, 2);
  assert.equal(qd[0].quantity, 6); assert.match(opts(qd[0]), /REGULAR/); assert.match(opts(qd[0]), /Buche/); assert.doesNotMatch(opts(qd[0]), /Lengua/);
  assert.equal(qd[1].quantity, 2); assert.match(opts(qd[1]), /Preparada/); assert.match(opts(qd[1]), /Buche/); assert.doesNotMatch(opts(qd[1]), /Lengua/);
  assert.equal(c.filter((l: any) => /^sq-quesadilla/.test(l.itemId)).length, 0);
});
test("chuy2: repeated burrito meat wins, aguacate noted", () => {
  const d = fx("CAc212a3-chuy2.json"); const c = structuredClone(d.cart.cart);
  applyBurritoMeatRepeat(c, d.turns, menu);
  const b = c.find((l: any) => /^sq-burrito-/.test(l.itemId));
  assert.match(opts(b), /Lengua/); assert.doesNotMatch(opts(b), /Buche/); assert.ok((b.elviNotes || []).some((n: string) => /aguacate/.test(n)));
});
test("chuy2: 'eso es cierto' / staff echo of aguacate are never names", () => {
  for (const f of ["CAf7b081-chuy2-prev.json", "CAc212a3-chuy2.json"]) { const n = nameFromTranscriptInfo(fx(f).turns)?.name || ""; assert.doesNotMatch(n, /cierto|aguacat/i); }
});
test("chuy2: no recap total match → no change", () => {
  const d = fx("CAc212a3-chuy2.json"); const t = d.turns.map((x: any) => ({ ...x, text: x.text.replace(/ocho y el burrito/i, "nueve y el burrito") }));
  const c = structuredClone(d.cart.cart); assert.equal(applyQdRecap(c, t, menu), false); assert.deepEqual(c, d.cart.cart);
});
