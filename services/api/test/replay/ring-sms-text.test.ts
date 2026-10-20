import { test } from "node:test";
import assert from "node:assert/strict";
import { ringSmsText } from "../../src/twilio.ts";
const at = new Date("2026-10-20T23:05:00Z");
const GSM = /^[A-Za-z0-9 .,'@&()+\-:\/?!]*$/;
test("smstext1: approved-sample format, one GSM-7 segment", () => {
  const a = ringSmsText({ name: "Ana", from: "+15555550123", at, forwardedFrom: "+14402898504" });
  assert.equal(a, "Cocina Elvis Staff Alert: Ana 7:05 PM (555) 555-0123 (linea 289) - please answer. Reply STOP to opt out.");
  assert.equal(ringSmsText({ name: null, from: "anonymous", at }), "Cocina Elvis Staff Alert: Cliente 7:05 PM Privado - please answer. Reply STOP to opt out.");
  const long = ringSmsText({ name: "Martín José de la Peña Rodríguez Hernández", from: "+15555550123", at: new Date("2026-10-20T16:59:00Z"), forwardedFrom: "+15555519122" });
  assert.match(long, GSM); assert.ok(long.length <= 160, String(long.length));
});
