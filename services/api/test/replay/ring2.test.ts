// ring2: early ringing never bridges before the notice ends; no English prompt on hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bridgeWaitSec, INTRO_MS } from "../../src/twilio.ts";
test("ring2: bridge waits for the rest of the notice, never negative", () => {
  const now = 1_000_000;
  assert.equal(bridgeWaitSec(now + 3200, now), 4);
  assert.equal(bridgeWaitSec(now - 10, now), 0);
  assert.equal(bridgeWaitSec(undefined, now), 0);
  assert.ok(INTRO_MS() >= 5000);
});
test("ring2: hold loop has no 'For English, press 2'", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../../src/twilio.ts", import.meta.url), "utf8");
  const hold = src.slice(src.indexOf("const holdTwiml"), src.indexOf("const voicemailXml"));
  assert.doesNotMatch(hold, /playOrSay\(base, sw\.voice/);
});
test("instant1: auto-connect (TWILIO_PRESS1=0) skips the whisper unless TWILIO_AUTO_WHISPER=1", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../../src/twilio.ts", import.meta.url), "utf8");
  const i = src.indexOf('process.env.TWILIO_PRESS1 === "0" && process.env.TWILIO_AUTO_WHISPER !== "1"');
  assert.ok(i > 0);
  const branch = src.slice(i, src.indexOf("}", src.indexOf("return res.type", i)));
  assert.match(branch, /<Redirect method="POST">\$\{action\}&amp;auto=1<\/Redirect>/);
  assert.doesNotMatch(branch, /whisper\s*\|\||playCloned/);
});
