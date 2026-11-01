import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyQuesadillaMeatSaid, liveQuesadillaMeat } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA89ab95-marcela-qhr1.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR";
test("marcela-qhr1: 3 QHR with no meat get bistec + 'bistec no tan dorado' note; menudos untouched", () => {
  const c = structuredClone(d.cart); assert.equal(applyQuesadillaMeatSaid(c, d.turns), true);
  const q = c.find((l: any) => l.itemId === Q);
  assert.equal(q.quantity, 3); assert.ok(q.modifiers.some((m: any) => m.option === "Bistec / Steak"));
  assert.ok(q.modifiers.some((m: any) => /QHR/.test(m.option))); assert.deepEqual(q.elviNotes, ["bistec no tan dorado"]);
  assert.equal(c.filter((l: any) => /menudo/.test(l.itemId)).length, 2);
});
test("marcela-qhr1 rule: an existing meat is kept; poco dorado note", () => {
  const c: any[] = [{ itemId: Q, quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] }];
  applyQuesadillaMeatSaid(c, [{ speaker: "caller", text: "una quesadilla de bistec poco dorada" }] as any);
  assert.equal(c[0].modifiers.length, 1); assert.deepEqual(c[0].elviNotes, ["poco dorada"]);
});
test("marcela-qhr1 live: meatless QCO/QHR add takes the meat the caller said", () => {
  const r = liveQuesadillaMeat({ reply: "3 × Quesadilla: harina, bistec.", actions: [{ type: "add_item", itemId: Q, quantity: 3, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }] }] },
    { transcript: "tres quesadillas de bistec de harina", history: [] });
  assert.ok(r.actions[0].modifiers.some((m: any) => m.option === "Bistec / Steak"));
});
