// pablo-tacos1 (CAa21249, Sun Nov 1 3:46 PM ET): "tacos de costilla del taquero, me puedes poner, ah, cinco" + "tres de tripa" → 5 TST costilla + 3 TST tripa.
// Elvi rang 1 costilla, then after "eso es todo" sent a merged "Taco: taquero, costilla y tripa. $3.50" update.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { trailingQty, closingOnlyTurn, liveTrailingClosing } from "../../src/eta-qty.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAa21249-pablo-tacos1.json", import.meta.url), "utf8"));
const T = "sq-taco-TAR7L5"; const st = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
const run = Object.assign(async (t: string) => { const a: any[] = [];
  if (/costilla/.test(t)) a.push({ type: "add_item", itemId: T, quantity: 1, modifiers: [st, { step: "(B) T Carnes / Meats Opciones", option: "Costilla / Beef Rib" }] });
  if (/tripa/.test(t)) a.push({ type: "add_item", itemId: T, quantity: 3, modifiers: [st, { step: "(B) T Carnes / Meats Opciones", option: "Tripa / Beef Tripe (+$0.50)" }] });
  if (/eso es todo/.test(t)) a.push({ type: "update_item", lineIndex: 0, quantity: 1, modifiers: [st, { step: "(B) T Carnes / Meats Opciones", option: "Costilla / Beef Rib" }, { step: "(B) T Carnes / Meats Opciones", option: "Tripa / Beef Tripe (+$0.50)" }] });
  return { actions: a, reply: a.length ? "ok" : "?" } as any; }, { menu: () => [] });
test("pablo-tacos1: shadow → 5 costilla + 3 tripa, no merged update after closing", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, run as any);
  const meat = (l: any) => l.modifiers.find((m: any) => /Carnes/.test(m.step))?.option;
  assert.deepEqual(r.cart.map((l: any) => [meat(l), l.quantity, l.modifiers.filter((m: any) => /Carnes/.test(m.step)).length]).sort(), [["Costilla / Beef Rib", 5, 1], ["Tripa / Beef Tripe (+$0.50)", 3, 1]]);
});
test("pablo-tacos1: trailing count after dish with filler; guards", () => {
  const a = [{ type: "add_item", quantity: 1 }]; assert.equal(trailingQty(a, "una cinco, ah, tacos de costilla del taquero, me puedes poner, ah, cinco,"), 5); assert.equal(a[0].quantity, 5);
  assert.equal(trailingQty([{ type: "add_item", quantity: 1 }], "un taco de asada y dos de pollo"), 0);
  assert.equal(trailingQty([{ type: "add_item", quantity: 1 }], "tacos de asada, llego en 5 minutos"), 0);
  assert.equal(trailingQty([{ type: "add_item", quantity: 1 }, { type: "add_item", quantity: 1 }], "tacos de asada cinco y pollo tres"), 0);
});
test("pablo-tacos1: closing-only turn never adds or updates (live)", () => {
  for (const t of ["Sí, está, eso es todo. Sí.", "No, sería todo", "that's it, thanks"]) assert.ok(closingOnlyTurn(t), t);
  for (const t of ["eso es todo, pero sin cebolla", "y un taco de pastor, es todo"]) assert.equal(closingOnlyTurn(t), false, t);
  const r = liveTrailingClosing({ reply: "Taco: taquero, costilla y tripa. $3.50", actions: [{ type: "update_item", lineIndex: 0 }] }, { transcript: "Sí, está, eso es todo. Sí.", language: "es" });
  assert.equal(r.actions.length, 0); assert.doesNotMatch(r.reply, /\$/);
});
