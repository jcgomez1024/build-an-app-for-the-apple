// route1: per-line ring routing (synthetic numbers).
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.TWILIO_RING_NUMBERS = "+15550001111,+15550002222";
process.env.TWILIO_LINES = "+15550009001=Línea A,+15550009002=Línea B";
process.env.TWILIO_LINE_RING = "9001:cells,9002:desk";
const { lineRingMode, ringNumbersFor, deskTakesLine } = await import("../../src/twilio.ts");

test("route1: line A rings only the cells, never the counter page", () => {
  assert.equal(lineRingMode("+15550009001"), "cells");
  assert.deepEqual(ringNumbersFor("+15550009001", true), ["+15550001111", "+15550002222"]);
  assert.equal(deskTakesLine("+15550009001"), false);
});
test("route1: line B rings only the desk; offline desk + fallback off → no cells", () => {
  assert.equal(lineRingMode("+15550009002"), "desk"); assert.equal(deskTakesLine("+15550009002"), true);
  delete process.env.TWILIO_DESK_FALLBACK_CELLS;
  assert.deepEqual(ringNumbersFor("+15550009002", true), []);
  assert.deepEqual(ringNumbersFor("+15550009002", false), []);
});
test("route1: fallback flag on → offline desk rings the cells; online desk still doesn't", () => {
  process.env.TWILIO_DESK_FALLBACK_CELLS = "1";
  assert.deepEqual(ringNumbersFor("+15550009002", false), ["+15550001111", "+15550002222"]);
  assert.deepEqual(ringNumbersFor("+15550009002", true), []);
  delete process.env.TWILIO_DESK_FALLBACK_CELLS;
});
test("route1: unknown line / unset config → both (old behavior)", () => {
  assert.equal(lineRingMode("+15550009999"), "both");
  const saved = process.env.TWILIO_LINE_RING; delete process.env.TWILIO_LINE_RING;
  assert.equal(lineRingMode("+15550009001"), "both"); process.env.TWILIO_LINE_RING = saved;
});
