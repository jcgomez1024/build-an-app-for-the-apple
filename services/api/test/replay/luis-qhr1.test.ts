import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAafae22-luis-qhr1.json", import.meta.url), "utf8"));
const QHR = { type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 3, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] };
test("luis-qhr1: 3 flour quesadillas de chorizo after a costilla 'en aceite' stay QHR, not a QD", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, (async (t: string) => /chorizo/i.test(t) ? { reply: "ok", actions: [QHR] } : { reply: "", actions: [] }) as any);
  const q = r.cart.find((l: any) => l.itemId === "sq-quesadilla-HLT6CR");
  assert.ok(q && q.quantity === 3 && q.modifiers.some((m: any) => /QHR/.test(m.option)) && q.modifiers.some((m: any) => /Chorizo/.test(m.option)));
  assert.ok(!r.cart.some((l: any) => /T5STUH|ZZAV3L/.test(l.itemId) && l.modifiers?.some((m: any) => /Chorizo/.test(m.option))));
});
