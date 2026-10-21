// unclear1: synthetic. Messy calls train (examples/finetune) but never count in accuracy or coaching.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
process.env.UNCLEAR_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "unc-")), "u.json");
const U = await import("../../src/unclear.ts");
const L = await import("../../src/learning.ts");
const sid = "CA" + "e".repeat(32);
test("unclear1: toggle by call id is reversible", () => {
  assert.equal(U.isUnclear(sid), false);
  U.setUnclear(sid, true, { by: "test", note: "relaying" }); assert.equal(U.isUnclear(sid), true); assert.equal(U.loadUnclear()[sid].note, "relaying");
  U.setUnclear(sid, false); assert.equal(U.isUnclear(sid), false);
  assert.throws(() => U.setUnclear("nope", true));
});
const line = (name: string, choices: string[]) => ({ name, baseName: name, quantity: 1, choices, unitCents: 500, totalCents: 500 });
const row = (callSid: string, unclear: any) => ({ callSid, at: "2026-10-21T17:55:00Z", score: 50, unclear, turns: [{ speaker: "caller", text: "una gordita" }], ticket: { lines: [line("Gordita", ["Bistec / Steak"])] }, elvi: [line("Gordita", ["Chorizo"])], audit: { flags: [] } });
test("unclear1: messy example is kept for training, excluded from accuracy and coaching", () => {
  const messy = L.phoneExample(row("CA" + "1".repeat(32), { note: "relaying" }))!, clear = L.phoneExample(row("CA" + "2".repeat(32), null))!;
  assert.equal(messy.difficulty, "messy"); assert.equal(clear.difficulty, "clear");
  assert.equal(L.finetuneRow(messy).difficulty, "messy");
  assert.equal(L.voiceAccuracy([messy, clear] as any).reduce((n: number, w: any) => n + w.calls, 0), 1);
  const withMiss = (e: any) => ({ ...e, staffMisses: [{ kind: "missing_item", detail: "Gordita", elvi: "Gordita" }] });
  assert.deepEqual(L.staffPatterns([withMiss(messy)] as any), []);
  assert.equal(L.staffPatterns([withMiss(clear)] as any).length, 1);
});
