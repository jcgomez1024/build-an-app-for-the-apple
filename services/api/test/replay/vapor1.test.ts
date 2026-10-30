// vapor1 (CA331ca94, Oct 30 1:53 PM ET, Víctor, Spanish pickup, staff-answered, 145 s): "dos órdenes de tacos al vapor" —
// order 1: 1 papa, 1 frijol, 3 prensado; order 2: 1 frijol, 4 prensado; + "una quesitoto de chorizo".
// Elvi rang 5 Taco de Comal (4 frijol, 1 prensado), no quesitorta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyVaporOrders, applyQuesoTortaSpoken, VAPOR_ID, VAPOR_WORDS } from "../../src/readback-pass.ts";
import { applySharedAliases } from "../../src/aliases.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA331ca94-turns.json", import.meta.url), "utf8"));
const TCO = "sq-taco-TAR7L5";
const taco = (q: number, meat: string) => ({ type: "add_item", itemId: TCO, quantity: q, modifiers: [{ step: "(A) Taco Options", option: "(TCO) Taco de Comal / Homemade" }, { step: "(B) Carnes", option: meat }] });
const miss = async (t: string) => /tres de prensado/i.test(t) ? { reply: "ok", actions: [taco(3, "Frijoles Refritos / Refried Beans"), taco(1, "Prensado / Spicy Pork")] }
  : /lleno de frijoles/i.test(t) ? { reply: "ok", actions: [taco(1, "Frijoles Refritos / Refried Beans")] } : { reply: "ok", actions: [] };
const vap = (cart: any[]) => cart.filter((l) => l.itemId === VAPOR_ID);
test("vapor1: two vapor orders with per-order filling mix, no comal tacos, plus the queso torta de chorizo", async () => {
  const r: any = await shadowOrderFromTurns(turns, miss as any);
  assert.equal(r.cart.filter((l: any) => /^sq-taco-/.test(l.itemId)).length, 0);
  const v = vap(r.cart); assert.equal(v.length, 2);
  assert.deepEqual(v.map((l) => l.elviNotes[0]).sort(), ["vapor: 1 frijol, 4 prensado", "vapor: 1 papa, 1 frijol, 3 prensado"]);
  assert.ok(v.every((l) => l.quantity === 1));
  const qt = r.cart.find((l: any) => /^sq-torta-/.test(l.itemId));
  assert.ok(qt && qt.modifiers.some((m: any) => /QTO/.test(m.option)) && qt.modifiers.some((m: any) => /Chorizo/.test(m.option)));
});
test("vapor1: synonyms map to vapor; quesitoto/queso torta map to Queso Torta", () => {
  for (const s of ["tacos al vapor", "tacos de vapor", "tacos sudados", "tacos de canasta"]) assert.ok(VAPOR_WORDS.test(s), s);
  assert.match(applySharedAliases("dame tres tacos sudados", "phone"), /tacos al vapor/);
  assert.match(applySharedAliases("una quesitoto de chorizo", "phone"), /quesitorta/);
  for (const s of ["una quesitoto de chorizo", "una quesitorta de bistec", "una queso torta de pollo"]) {
    const c: any[] = []; applyQuesoTortaSpoken(c, [{ speaker: "caller", text: s }] as any);
    assert.equal(c.length, 1, s); assert.match(c[0].modifiers[0].option, /QTO/);
  }
});
test("vapor1: one order of sudados, mix from staff read-back", () => {
  const c: any[] = [];
  applyVaporOrders(c, [{ speaker: "caller", text: "una orden de tacos sudados" }, { speaker: "staff", text: "Dos de papa y tres de frijol." }] as any);
  assert.equal(vap(c).length, 1); assert.equal(vap(c)[0].elviNotes[0], "vapor: 2 papa, 3 frijol");
});
test("vapor1: comal tacos stay when the caller said comal", () => {
  const c: any[] = [{ itemId: TCO, quantity: 2, modifiers: [{ option: "(TCO) Taco de Comal / Homemade" }, { option: "Frijoles Refritos / Refried Beans" }] }];
  applyVaporOrders(c, [{ speaker: "caller", text: "una orden de tacos al vapor y dos tacos de comal de frijol" }, { speaker: "staff", text: "cinco de papa" }] as any);
  assert.equal(c.filter((l) => l.itemId === TCO).length, 1); assert.equal(vap(c).length, 1);
});
