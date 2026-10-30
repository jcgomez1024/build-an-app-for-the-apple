// gio1 (CA9b72ed0, Oct 30 ~10:50 AM ET, pickup): "dos quesadillas" (comal) … "una de tripa y de bistec" → 2 QCO: 1 tripa + 1 bistec.
// Live miss: QCO tripa x1 + QCO bistec x2 — the announced "dos" stayed on one split line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { unaSplitMeats, applyUnaSplit } from "../../src/spoken-ledger.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA9b72ed0-turns.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR";
const mod = (m: string) => [{ step: "(A) Q Tortilla", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: m }];
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join("|");

test("gio1: replay with the live miss shape → 2 QCO, 1 tripa + 1 bistec", async () => {
  const r: any = await shadowOrderFromTurns(turns, (async (t: string) => /tripa y de bistec/.test(t)
    ? { reply: "ok", actions: [{ type: "add_item", itemId: Q, quantity: 1, modifiers: mod("Tripa / Tripe") }, { type: "add_item", itemId: Q, quantity: 2, modifiers: mod("Bistec / Steak") }] }
    : { reply: "ok", actions: [] }) as any);
  const q = r.cart.filter((l: any) => l.itemId === Q);
  assert.equal(q.reduce((n: number, l: any) => n + l.quantity, 0), 2);
  assert.equal(q.filter((l: any) => /Tripa/.test(opts(l)) && l.quantity === 1).length, 1);
  assert.equal(q.filter((l: any) => /Bistec/.test(opts(l)) && l.quantity === 1).length, 1);
  assert.ok(q.every((l: any) => /\(QCO\)/.test(opts(l))));
});

test("gio1: live — una-split meats each get qty 1; counted lines untouched", () => {
  assert.deepEqual(unaSplitMeats("Ah, una de tripa y de bistec."), ["tripa", "bistec"]);
  assert.deepEqual(unaSplitMeats("una de tripa y una de bistec"), ["tripa", "bistec"]);
  assert.equal(unaSplitMeats("dos de bistec y una de pastor"), null);
  assert.equal(unaSplitMeats("una de bistec y dos de pastor"), null);
  assert.equal(unaSplitMeats("dos quesadillas de comal"), null);
  const acts: any[] = [{ type: "add_item", itemId: Q, quantity: 1, modifiers: mod("Tripa / Tripe") }, { type: "add_item", itemId: Q, quantity: 2, modifiers: mod("Bistec / Steak") }];
  assert.equal(applyUnaSplit(acts, ["tripa", "bistec"]), true);
  assert.deepEqual(acts.map((a) => a.quantity), [1, 1]);
});
