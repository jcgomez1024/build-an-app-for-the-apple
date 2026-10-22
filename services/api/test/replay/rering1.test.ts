import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldReRing } from "../../src/twilio.ts";
// Synthetic: a single ring leg times out 18 s into the wait; caller still holding.
test("re-rings after a leg no-answer while caller waits", () => {
  assert.equal(shouldReRing("no-answer", false, false, 18, 150), true);
  assert.equal(shouldReRing("busy", false, false, 18, 150), true);
});
test("does not re-ring when canceled by us, other leg ringing, answered, or near max wait", () => {
  assert.equal(shouldReRing("canceled", true, false, 18, 150), false);
  assert.equal(shouldReRing("no-answer", true, false, 18, 150), false);
  assert.equal(shouldReRing("no-answer", false, true, 18, 150), false);
  assert.equal(shouldReRing("completed", false, false, 18, 150), false);
  assert.equal(shouldReRing("no-answer", false, false, 147, 150), false);
});
