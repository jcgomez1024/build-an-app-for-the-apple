// grade1: synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../../src/learning.ts";
const lines = [{ name: "Taco" }, { name: "Torta" }];
const g = (o: any) => L.gradeCall({ unclear: false, staffScore: 100, readback: { status: "none" }, truthLines: lines, ...o });
test("grade1: best / good / medium / bad", () => {
  assert.equal(g({ readback: { status: "confirmed", dishCounts: { taco: 2, torta: 1 } } }), "best");
  assert.equal(g({ readback: { status: "confirmed", dishCounts: { taco: 2 } } }), "good"); // partial read-back
  assert.equal(g({}), "good");
  assert.equal(g({ readback: { status: "corrected", dishCounts: { taco: 2 } } }), "good"); // ticket reflects the correction
  assert.equal(g({ staffScore: 80 }), "medium");
  assert.equal(g({ overridden: true }), "medium");
  assert.equal(g({ unclear: true, readback: { status: "confirmed", dishCounts: { taco: 2, torta: 1 } } }), "bad");
});
test("grade1: weights come from config defaults and become the example weight", () => {
  assert.deepEqual(L.GRADE_DEFAULTS, { best: 1, good: 0.75, medium: 0.5, bad: 0.25 });
  const line = (name: string) => ({ name, baseName: name, quantity: 1, choices: [], unitCents: 300, totalCents: 300 });
  const row = { callSid: "CA" + "4".repeat(32), at: "2026-10-21T17:00:00Z", score: 100, turns: [{ speaker: "staff", text: "hola" }, { speaker: "caller", text: "un taco" }, { speaker: "staff", text: "ok" }, { speaker: "staff", text: "Entonces un taco, ¿okay?" }, { speaker: "caller", text: "Sí" }], ticket: { lines: [line("Taco")] }, elvi: [line("Taco")], audit: { flags: [] } };
  const e = L.phoneExample(row)!; assert.equal(e.grade, "best"); assert.equal(e.weight, 1);
  const b = L.phoneExample({ ...row, callSid: "CA" + "5".repeat(32), unclear: { note: "x" } })!; assert.equal(b.grade, "bad"); assert.equal(b.weight, 0.25);
  assert.deepEqual(L.gradeStats([e, b] as any), { best: 1, good: 0, medium: 0, bad: 1 });
});
