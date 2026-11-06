// larry3 (CA6496f86, Fri Nov 6 2026 ~11:44 AM ET, Larry, English pickup).
// One caller list — four grande steak burritos, six steak quesadillas, two steak street tacos —
// was rung as 16 street quesadillas (4+4+6+2). "two of the peppers" then added the burrito and missed the side.
// Not larry2 (a different call). Not a SID special case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { englishListHits, applyCollapsedEnglishList } from "../../src/list-repair.ts";
import { splitDishClauses, spokenQtyFor } from "../../src/elvi.ts";
import { normalizeSpokenCatalogAliases } from "../../src/text-intents.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA6496f86-larry3.json", import.meta.url), "utf8")).turns;
const Q = "sq-quesadilla-HLT6CR", B = "sq-burrito-TGWBEN", T = "sq-taco-TAR7L5", X = "sq-extras-mild-salsa-asada-2oz-T6PGNT";
const BISTEC = "Bistec / Steak";
const qLine = (quantity: number) => ({ type: "add_item", itemId: Q, quantity, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QST) Quesadilla Taquera / Street Quesadilla" }, { step: "(B) Q Carnes / Meats", option: BISTEC }] });
const FILL = ["Frijoles Refritos / Refried Beans", "Arroz / Rice", "Queso Fresco / Cheese", "Crema / Sour Cream", "Cebolla / Onion", "Cilantro"].map((name) => ({ name, priceDeltaCents: 0 }));
const menu = [
  { id: Q, name: "Quesadilla", modifierGroups: [
    { name: "(A) Q Tortilla Options", options: [{ name: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { name: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { name: "(QST) Quesadilla Taquera / Street Quesadilla" }] },
    { name: "(B) Q Carnes / Meats", options: [{ name: BISTEC }] },
  ] },
  { id: B, name: "Burrito", modifierGroups: [
    { name: "(A) Burrito Size", options: [{ name: "Regular '10" }, { name: "Grande '12 (+$3.00)" }] },
    { name: "(B) Burrito Carne Options", options: [{ name: BISTEC }] },
    { name: "(C) Burrito Options", options: FILL },
  ] },
  { id: T, name: "Taco", modifierGroups: [
    { name: "(A) T Tortilla Options", options: [{ name: "(TST) Taco Taquero / Street Taco" }, { name: "(TCO) Taco Comal / Homemade (+$1.00)" }] },
    { name: "(B) T Carnes / Meats Opciones", options: [{ name: BISTEC }] },
  ] },
  { id: X, name: "Extras", modifierGroups: [{ name: "Extras options", options: [{ name: "Cebolla y Chiles Asados" }] }] },
];
const miss = async (t: string) => {
  if (/grande burritos/i.test(t) && /quesadillas/i.test(t) && /street tacos/i.test(t))
    return { reply: "14 comal quesadillas: 4 steak, 4 steak, 6 steak; 2 × Quesadilla: street, steak. Anything else?", actions: [qLine(4), qLine(4), qLine(6), qLine(2)] };
  if (/peppers/i.test(t))
    return { reply: "Okay.", actions: [{ type: "add_item", itemId: B, quantity: 4, modifiers: [{ step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" }, { step: "(B) Burrito Carne Options", option: BISTEC }] }] };
  return { reply: "Okay.", actions: [] };
};
(miss as any).menu = () => menu;
const units = (ls: any[]) => ls.reduce((n, l) => n + (Number(l.quantity) || 1), 0);
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");

test("larry3: an English list keeps each dish's count; street tacos are tacos", () => {
  const blob = "four of your grande burritos then six of your steak quesadillas and two of your steak street tacos";
  const hits = englishListHits(blob);
  assert.deepEqual(hits.map((h) => [h.kind, h.qty]), [["burrito", 4], ["quesadilla", 6], ["taco", 2]]);
  assert.equal(hits.find((h) => h.kind === "taco")?.style, "taquero");
  assert.equal(spokenQtyFor("four of your grande burritos", [{ name: "Burrito" }]), 4);
  assert.equal(spokenQtyFor("six of your steak quesadillas", [{ name: "Quesadilla" }]), 6);
  const clauses = splitDishClauses(blob);
  assert.equal(clauses.filter((c) => /burrito/.test(c)).length, 1);
  assert.equal(clauses.filter((c) => /quesadilla/.test(c)).length, 1);
  assert.equal(clauses.filter((c) => /taco/.test(c)).length, 1);
  assert.match(normalizeSpokenCatalogAliases("two of the peppers"), /cebolla y chiles asados/);
});

test("larry3: 4 grande steak burritos, 6 steak quesadillas, 2 steak street tacos, 2 asados, Larry", async () => {
  const r: any = await shadowOrderFromTurns(turns, miss as any);
  const c = r.cart;
  const dump = JSON.stringify(c.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l) })));
  const b = c.filter((l: any) => l.itemId === B);
  assert.equal(units(b), 4, dump);
  assert.ok(b.every((l: any) => /Grande/.test(opts(l)) && /Bistec/.test(opts(l))), dump);
  for (const top of ["Arroz", "Frijoles", "Queso Fresco", "Crema", "Cebolla", "Cilantro"]) assert.match(opts(b[0]), new RegExp(top), dump);
  const q = c.filter((l: any) => l.itemId === Q);
  assert.equal(units(q), 6, dump);
  assert.ok(q.every((l: any) => /Bistec/.test(opts(l)) && !/QHR|QST|Flour|Street Quesadilla/.test(opts(l))), dump);
  const t = c.filter((l: any) => l.itemId === T);
  assert.equal(units(t), 2, dump);
  assert.ok(t.every((l: any) => /TST/.test(opts(l)) && /Bistec/.test(opts(l))), dump);
  assert.equal(units(c.filter((l: any) => l.itemId === X && /Cebolla y Chiles/.test(opts(l)))), 2, dump);
  assert.equal(c.filter((l: any) => /quesadilla|taco|burrito/i.test(String(l.itemId))).length, 3, dump);
  assert.equal(nameFromTranscriptInfo(turns)?.name, "Larry");
});

test("larry3: a plain two-burrito line is not rewritten", () => {
  const cart = [{ itemId: B, quantity: 2, modifiers: [{ step: "(B) Burrito Carne Options", option: BISTEC }] }];
  assert.equal(applyCollapsedEnglishList(cart, [{ speaker: "caller", text: "two burritos with steak" }] as any, menu), false);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
});
