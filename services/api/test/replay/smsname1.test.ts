// smsname1: synthetic numbers/names only; no SMS is sent (TWILIO_RING_SMS unset, fetch stubbed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ringSmsText, nameFollowUpText, shouldNameFollowUp, sendNameFollowUp, _setSmsMetaForTest, _smsMetaForTest } from "../../src/twilio.ts";
test("smsname1: a name known at ring time is in the ring alert", () => {
  assert.match(ringSmsText({ name: "Testa", from: "+15555550123", at: Date.UTC(2026, 9, 21, 17, 6) }), /Staff Alert: Testa 1:06 PM/);
});
test("smsname1: follow-up text format", () => {
  assert.equal(nameFollowUpText({ name: "Álexo", from: "+15555550123", at: Date.UTC(2026, 9, 21, 17, 6) }), "Llamada 1:06 PM (...0123): Alexo");
});
test("smsname1: follow-up only when the ring alert had no name, once, real names only", () => {
  assert.equal(shouldNameFollowUp({ nameSent: false, followUp: false }, "Testa"), true);
  assert.equal(shouldNameFollowUp({ nameSent: true, followUp: false }, "Testa"), false);
  assert.equal(shouldNameFollowUp({ nameSent: false, followUp: true }, "Testa"), false);
  assert.equal(shouldNameFollowUp(undefined, "Testa"), false);
  assert.equal(shouldNameFollowUp({ nameSent: false, followUp: false }, "Mesa 4"), false);
  assert.equal(shouldNameFollowUp({ nameSent: false, followUp: false }, ""), false);
});
test("smsname1: second learned name for the same call sends nothing more", async () => {
  const sent: any[] = []; const f = globalThis.fetch;
  Object.assign(process.env, { TWILIO_RING_SMS: "1", TWILIO_SMS_NUMBERS: "+15555550100", TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "x", TWILIO_MESSAGING_SERVICE_SID: "" });
  (globalThis as any).fetch = async (u: string, o: any) => { sent.push(String(o?.body)); return new Response(JSON.stringify({ sid: "SMx", status: "queued" })); };
  try {
    _setSmsMetaForTest("CAtest1", { base: "", from: "+15555550123", line: "+15555550199", at: Date.UTC(2026, 9, 21, 17, 6), nameSent: false, followUp: false });
    await sendNameFollowUp("CAtest1", "Testa"); await sendNameFollowUp("CAtest1", "Otra");
    assert.equal(sent.length, 1); assert.match(decodeURIComponent(sent[0].replace(/\+/g, " ")), /Llamada 1:06 PM \(\.\.\.0123\): Testa/);
    assert.equal(_smsMetaForTest("CAtest1").followUp, true);
  } finally { (globalThis as any).fetch = f; delete process.env.TWILIO_RING_SMS; }
});
