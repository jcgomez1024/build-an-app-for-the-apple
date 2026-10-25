// pablo1-name (CAf8d98c ~4:46 PM ET Oct 25): returning caller Pablo.
// Cart already correct: 5× Taco Taquero costilla $15. Name miss only:
// order_name "Taqueros" from:'vocative' — staff tortilla check "Taqueros, ¿verdad?"
// Staff said Pablo twice; callers.json still Pablo (savedToMemory false).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T16:46:00-04:00";
const { nameFromAnswer, nameFromTranscript, nameFromStaffVocative, nameFromTranscriptInfo } =
  await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAf8d98c-turns.json", import.meta.url), "utf8"));

test("pablo1-name: Taqueros / menu SKUs never names", () => {
  assert.equal(nameFromAnswer("Taqueros"), null);
  assert.equal(nameFromAnswer("Taqueros, ¿verdad?"), null);
  assert.equal(nameFromAnswer("Nachos"), null);
  assert.equal(nameFromAnswer("Flautas"), null);
  assert.equal(nameFromAnswer("Tostadas"), null);
});

test("pablo1-name: CAf8d98c transcript → Pablo, not Taqueros", () => {
  assert.equal(nameFromStaffVocative(turns as any), "Pablo");
  const n = nameFromTranscript(turns as any);
  assert.ok(n && /^pablo$/i.test(n), "name Pablo: " + n);
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "heard info");
  assert.ok(/^pablo$/i.test(info!.name), "info name Pablo: " + info!.name);
  assert.notEqual(info!.name.toLowerCase(), "taqueros");
  assert.equal(info!.source, "vocative");
});

test("pablo1-name: verdad SKU alone never wins over trailing Pablo", () => {
  const only = [
    { speaker: "staff" as const, text: "Taqueros, ¿verdad?" },
    { speaker: "caller" as const, text: "Sí." },
  ];
  assert.equal(nameFromStaffVocative(only), null);
  const withPablo = [
    { speaker: "staff" as const, text: "¿Qué le vamos a poner, Pablo?" },
    { speaker: "staff" as const, text: "Taqueros, ¿verdad?" },
    { speaker: "staff" as const, text: "cinco taqueros de costilla, Pablo." },
  ];
  assert.equal(nameFromStaffVocative(withPablo), "Pablo");
});
