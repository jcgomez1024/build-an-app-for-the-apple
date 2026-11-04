import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { makeItNAsUpdate, applyMakeItNMerge, applyExtraCounts } from "../../src/modifier-turns.js";

// nikki1 (CA31f9eb): 2 steak flour quesadillas → "can you just make it four regular quesadillas, the steak?" → staff "four flour quesadilla
// steak, two sour creams, and a side of rice" → 4 × QHR steak (not 6), Crema 2oz × 2, rice × 1.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA31f9eb-nikki1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR", CR = "sq-extras-mild-salsa-asada-2oz-T6PGNT", RICE = "sq-sides-arroz-rice-26S6E6";
const qhr = (q: number) => ({ type: "add_item", itemId: Q, quantity: q, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }] });
// worst case: model re-adds 4 on the "make it four" turn
const stub = () => { const r: any = async (t: string) => {
  if (/flour tortillas/i.test(t)) return { actions: [qhr(2)], reply: "2 quesadillas." };
  if (/make it four/i.test(t)) return { actions: [qhr(4)], reply: "4 quesadillas." };
  if (/sour creams?/i.test(t)) return { actions: [{ type: "add_item", itemId: CR, quantity: 1, modifiers: [{ step: "Extras options", option: "Crema / Sour Cream 2oz" }] }], reply: "Sour cream." };
  if (/side of rice/i.test(t)) return { actions: [{ type: "add_item", itemId: RICE, quantity: 1, modifiers: [] }], reply: "Rice." };
  return { actions: [], reply: "Okay." }; }; r.menu = () => M; return r; };

test("nikki1: 'just make it four' replaces the 2 → one line of 4 QHR steak; two sour creams → Crema × 2", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const qs = r.cart.filter((l: any) => l.itemId === Q);
  assert.equal(qs.length, 1, JSON.stringify(r.cart)); assert.equal(qs[0].quantity, 4);
  assert.match(JSON.stringify(qs[0].modifiers), /QHR/); assert.match(JSON.stringify(qs[0].modifiers), /Bistec/);
  const cr = r.cart.filter((l: any) => l.itemId === CR); assert.equal(cr.length, 1); assert.equal(cr[0].quantity, 2);
  assert.equal(r.cart.filter((l: any) => l.itemId === RICE).length, 1);
});
test("nikki1: live — 'make it N' with no action → update_item qty N; plain 'four quesadillas' still adds", () => {
  const cart = [{ ...qhr(2) }]; const a: any[] = [];
  assert.ok(makeItNAsUpdate(a, cart, "can you just make it four regular quesadillas, the steak"));
  assert.equal(a[0].type, "update_item"); assert.equal(a[0].quantity, 4); assert.match(JSON.stringify(a[0].modifiers), /QHR/);
  const b: any[] = [qhr(4)]; assert.equal(makeItNAsUpdate(b, cart, "and four quesadillas de pollo"), false); assert.equal(b[0].type, "add_item");
  const c: any[] = []; assert.ok(makeItNAsUpdate(c, cart, "mejor hazlas tres")); assert.equal(c[0].quantity, 3);
});
test("nikki1: after-call merge keeps different meats apart; extra count needs ≥2", () => {
  const cart: any[] = [qhr(2), { ...qhr(4), modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] }];
  applyMakeItNMerge(cart, [{ speaker: "caller", text: "make it four quesadillas" }] as any); assert.equal(cart.length, 2);
  const e: any[] = [{ itemId: CR, quantity: 1, modifiers: [{ step: "Extras options", option: "Crema / Sour Cream 2oz" }] }];
  applyExtraCounts(e, [{ speaker: "caller", text: "and a sour cream" }] as any); assert.equal(e[0].quantity, 1);
  applyExtraCounts(e, [{ speaker: "caller", text: "a couple sour creams too" }] as any); assert.equal(e[0].quantity, 2);
});
