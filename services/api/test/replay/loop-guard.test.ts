import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoopCall } from "../../src/twilio.ts";
const lines = ["+15550001609"], ringSet = new Set(["5550006793"]);
test("loop2: staff cell dialing the line directly is NOT a loop", () => assert.equal(isLoopCall({ from: "+15550006793", fwdFrom: "", lines, ringSet }), false));
test("loop2: ring leg forwarded back (From our line / diverted from ring phone) IS a loop", () => {
  assert.equal(isLoopCall({ from: "+15550001609", fwdFrom: "+15550006793", lines, ringSet }), true);
  assert.equal(isLoopCall({ from: "+15550009999", fwdFrom: "+15550006793", lines, ringSet }), true);
  assert.equal(isLoopCall({ from: "+15550009999", fwdFrom: "", lines, ringSet, echo: true }), true);
  assert.equal(isLoopCall({ from: "+15550009999", fwdFrom: "", lines, ringSet }), false);
});
