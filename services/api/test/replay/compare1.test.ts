// cmp1: compareRow scores Elvi and the ticket against the correct order (synthetic, no PII)
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRow } from "../../src/compare.ts";
const L = (q: number, ch: string[]) => ({ baseName: "Taco", name: "Taco · (TCO) Taco de Comal / Homemade", quantity: q, choices: ["(TCO) Taco de Comal / Homemade", ...ch], unitCents: 400, totalCents: 400 * q });
test("cmp1: ticket matches, Elvi missed a meat → staff 100, Elvi lower, line from called number", () => {
  const row = { callSid: "CAsyntheticcmp1", at: "2026-10-01T16:00:00Z", calledNumber: "+15550001609", score: 50, turns: [{ speaker: "caller", text: "dos tacos de bistec" }],
    ticket: { lines: [L(2, ["Bistec / Steak"])] }, elvi: [L(2, ["Pastor"])], audit: { flags: [] }, unclear: null };
  const c = compareRow(row)!;
  assert.equal(c.line, "1609"); assert.equal(c.staffScore, 100); assert.ok((c.elviScore ?? 100) < 100); assert.ok(c.elviMissTypes.length >= 1);
  assert.equal(c.truth.length, 1);
});
test("cmp1: no ticket → no comparison", () => { assert.equal(compareRow({ callSid: "CAx", ticket: null, elvi: [], score: null }), null); });
test("live1: live-call order scored separately from today's replay", () => {
  const row = { callSid: "CAsyntheticlive1", at: "2026-10-01T16:00:00Z", score: 100, turns: [], ticket: { lines: [L(2, ["Bistec / Steak"])] },
    elvi: [L(2, ["Bistec / Steak"])], elviLive: [L(1, ["Bistec / Steak"])], audit: { flags: [] }, unclear: null };
  const c = compareRow(row)!;
  assert.equal(c.elviScore, 100); assert.ok((c.elviLiveScore ?? 100) < 100); assert.ok(c.elviLiveMissTypes.length >= 1);
});
