import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { mergeConFrijolesSplit } from "../../src/modifier-turns.js";

// lupita1 (CA35cd40): "dos quesadillas al comal de chicharrón prensado con frijoles" → 2 × QCO prensado + Con Frijoles (+ Coke).
const d = JSON.parse(readFileSync(new URL("../fixtures/CA35cd40-lupita1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR", COKE = "sq-drink-coca-cola-JJE4KC";
const QCO = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, SAL = { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" };
const CON = { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" };
const split = () => [
  { type: "add_item", itemId: Q, quantity: 1, modifiers: [QCO, { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork (+$0.50)" }, SAL, CON] },
  { type: "add_item", itemId: Q, quantity: 1, modifiers: [QCO, { step: "(B) Q Carnes / Meats", option: "Frijoles Refritos / Refried Beans" }, SAL] }];
const stub = () => { const r: any = async (t: string) => { const p = t.toLowerCase();
  if (/quesadillas/.test(p)) return { actions: split(), reply: "ok" };
  if (/coca/.test(p)) return { actions: [{ type: "add_item", itemId: COKE, quantity: 1 }], reply: "ok" };
  return { actions: [], reply: "Muy bien." }; }; r.menu = () => M; return r; };

test("lupita1: live split (prensado + frijoles-only) merges into 2 × QCO prensado con frijoles", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const qs = r.cart.filter((l: any) => l.itemId === Q);
  assert.equal(qs.length, 1); assert.equal(qs[0].quantity, 2);
  const j = JSON.stringify(qs[0].modifiers);
  assert.match(j, /QCO/); assert.match(j, /Prensado/); assert.match(j, /Con Frijoles/);
  assert.doesNotMatch(JSON.stringify(r.cart), /Frijoles Refritos/);
  assert.equal(r.cart.filter((l: any) => l.itemId === COKE).length, 1);
});
test("lupita1: 'con frijoles' after a meat is a modifier; a separate beans line stays separate", () => {
  const a = split(); assert.equal(mergeConFrijolesSplit(a, "dos quesadillas al comal de prensado con frijoles"), true);
  assert.equal(a.length, 1); assert.equal(a[0].quantity, 2);
  for (const s of ["una de prensado y otra de frijoles", "dos de prensado con frijoles refritos", "una de prensado y una de frijoles con queso"]) {
    const b = split(); assert.equal(mergeConFrijolesSplit(b, s), false, s); assert.equal(b.length, 2, s); }
});
