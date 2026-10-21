import { test } from "node:test";
import assert from "node:assert/strict";
import { ringLegBody } from "../../src/twilio.ts";
test("ringtime1: ring legs ask Twilio for initiated/ringing/answered/completed events", () => {
  const b = ringLegBody({ To: "+15550001111", From: "+15550009001" });
  assert.deepEqual(b.getAll("StatusCallbackEvent"), ["initiated", "ringing", "answered", "completed"]);
  assert.equal(b.get("To"), "+15550001111");
});
