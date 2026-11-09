import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { groupBlocks, applyGroupBlockCounts } from "../../src/group-blocks.js";

// ronald2 (CA66f2c1): "tres órdenes" — Kevin QB + 3 bistec; Pedro QB + 4 pastor ("Sí, para Pedro"); Ronald "cuatro tacos" … "Al pastor"
// ("eso es para Ronald"). Live/after-call deduped the repeats → 1 QB, 4 pastor. Expect 2 QB, 3 bistec, 8 pastor.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA66f2c1-ronald2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const TACO = "sq-taco-TAR7L5", QB = /^sq-queso-birrias/;
const taco = (n: number, meat: string) => ({ type: "add_item", itemId: TACO, quantity: n, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: meat }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] });
// worst case: model adds each person's tacos (same line twice for pastor)
const stub = () => { const r: any = async (t: string) => {
  if (/tres tacos de bistec/i.test(t)) return { actions: [taco(3, "Bistec / Steak")], reply: "3 tacos. ¿Algo más?" };
  if (/cuatro tacos de pastor/i.test(t)) return { actions: [taco(4, "Alpastor / Roasted Pork")], reply: "4 tacos. ¿Algo más?" };
  return { actions: [], reply: "Muy bien." }; }; r.menu = () => M; return r; };
const sum = (c: any[], f: (l: any) => boolean) => c.filter(f).reduce((s, l) => s + l.quantity, 0);
const meat = (re: RegExp) => (l: any) => l.itemId === TACO && re.test(JSON.stringify(l.modifiers));

test("ronald2: per-person blocks Kevin/Pedro/Ronald", () => {
  const b = groupBlocks(d.turns);
  assert.deepEqual(b.map((x) => [x.who, x.qb, Object.fromEntries(x.tacos)]),
    [["Kevin", 1, { Bistec: 3 }], ["Pedro", 1, { Alpastor: 4 }], ["Ronald", 0, { Alpastor: 4 }]]);
});
test("ronald2: replay → 2 QB, 3 bistec, 8 pastor", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  assert.equal(sum(r.cart, (l) => QB.test(l.itemId)), 2, JSON.stringify(r.cart));
  assert.equal(sum(r.cart, meat(/Bistec/)), 3); assert.equal(sum(r.cart, meat(/Alpastor/)), 8);
  assert.equal(r.cart.some((l: any) => /birria-de-chivo/i.test(String(l.itemId))), false, JSON.stringify(r.cart));
});
test("ronald2: one person restating does not add; never lowers", () => {
  const c: any[] = [{ ...taco(4, "Alpastor / Roasted Pork") }];
  applyGroupBlockCounts(c, [{ speaker: "caller", text: "cuatro tacos de pastor" }, { speaker: "caller", text: "sí, cuatro tacos de pastor, para Pedro" }]);
  assert.equal(c[0].quantity, 4);
  const e: any[] = [{ ...taco(9, "Alpastor / Roasted Pork") }];
  applyGroupBlockCounts(e, [{ speaker: "caller", text: "dos tacos de pastor para Kevin" }, { speaker: "caller", text: "y dos tacos de pastor para Pedro" }]);
  assert.equal(e[0].quantity, 9);
  const f: any[] = [{ ...taco(2, "Alpastor / Roasted Pork") }];
  applyGroupBlockCounts(f, [{ speaker: "caller", text: "dos tacos de pastor para Kevin" }, { speaker: "caller", text: "y dos tacos de pastor para Pedro" }]);
  assert.equal(f[0].quantity, 4);
});
