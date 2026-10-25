// link15: synthetic, no PII — time-only auto-link needs a real ordering call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSquareOrder, timeOnlyLinkOk } from "../../src/twilio.ts";
const order = { id: "o1", created_at: "2026-01-05T14:01:00Z", source: { name: "Point of Sale" }, ticket_name: "Zed", line_items: [{ name: "Taco" }], total_money: { amount: 500 } };
const base = { at: "2026-01-05T14:00:00Z", caller: "+15550000001", name: null };
test("5 s 'Bueno. Bueno.' test call does not grab the only ticket", () => {
  assert.equal(pickSquareOrder({ ...base, talkSec: 5, transcript: "STAFF: Bueno. CALLER: Bueno. Bueno." }, [order]), null);
  assert.equal(pickSquareOrder({ ...base, transcript: "CALLER: Bueno. Bueno." }, [order]), null); // duration unknown, no order speech
});
test("a real ordering call still links by time", () => {
  assert.equal(pickSquareOrder({ ...base, talkSec: 150, transcript: "CALLER: quiero seis tacos de lengua" }, [order])?.by, "only ticket in 20 min");
  assert.equal(timeOnlyLinkOk({ talkSec: 40, lines: [{}] }), true);
  assert.equal(timeOnlyLinkOk({ talkSec: 12, transcript: "dos tacos" }), false);
});
test("phone match is not gated", () => {
  const o = { ...order, fulfillments: [{ pickup_details: { recipient: { phone_number: "+15550000001" } } }] };
  assert.equal(pickSquareOrder({ ...base, talkSec: 5, transcript: "" }, [o])?.by, "phone");
});

test("empty-cart inquiry (birria Q) does not steal only ticket in 20 min", () => {
  assert.equal(timeOnlyLinkOk({ talkSec: 40, lines: [], transcript: "¿venden birria?" }), false);
  assert.equal(pickSquareOrder({ ...base, talkSec: 40, lines: [], transcript: "CALLER: Disculpe, ¿venden birria?" }, [order]), null);
});
