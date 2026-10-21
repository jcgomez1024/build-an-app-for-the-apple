// followup1 + learn1 (synthetic data only, no PII).
import { test } from "node:test";
import assert from "node:assert/strict";
import { followUpFor, candidateTickets, isPosTicket } from "../../src/call-accuracy.ts";
import { pickSquareOrder } from "../../src/twilio.ts";
import { auditCall } from "../../src/auditor.ts";
import { buildOnlineLearning, safeNote } from "../../src/online-learning.ts";

const PH = "+15555550100";
const online = { id: "ON1", source: { name: "Square Online" }, state: "OPEN", created_at: "2026-01-05T20:46:00Z", total_money: { amount: 2639 },
  line_items: [{ name: "Burrito", quantity: "1", modifiers: [{ name: "Bistec / Steak" }] }],
  fulfillments: [{ type: "PICKUP", state: "PREPARED", pickup_details: { pickup_at: "2026-01-06T16:00:00Z", recipient: { phone_number: PH, display_name: "Test Person" } } }] };
const empty = { id: "Z0", source: {}, state: "COMPLETED", created_at: "2026-01-05T20:59:00Z", total_money: { amount: 0 }, line_items: [] };
const call: any = { callSid: "CA1", at: "2026-01-05T20:50:00Z", caller: PH, recordingSid: "RE1", recordingSec: 46,
  turns: [{ speaker: "staff", text: "I just saw that you placed an order, but it says for tomorrow at 11." }, { speaker: "caller", text: "Oh no, I would like it today." }] };

test("followup1: call about an existing online order → follow-up linked to it", () => {
  const f = followUpFor(call, [], [online, empty])!;
  assert.equal(f.orderId, "ON1"); assert.equal(f.matchedBy, "phone"); assert.equal(f.dueAt, "2026-01-06T16:00:00Z");
});
test("followup1: auditor — ORDER_FOLLOWUP only, no staff checks, no ping", () => {
  const a = auditCall({ ...call, followUp: followUpFor(call, [], [online]), elvi: [], ticket: null }, Date.parse("2026-01-05T23:00:00Z"))!;
  assert.deepEqual(a.flags.map((x) => x.type), ["ORDER_FOLLOWUP"]);
});
test("followup1: online and $0/no-item orders are never phone tickets", () => {
  assert.equal(isPosTicket(online), false); assert.equal(isPosTicket(empty), false);
  const elvi: any = [{ name: "Burrito", baseName: "Burrito", quantity: 1, choices: ["Bistec / Steak"], totalCents: 2639 }];
  assert.deepEqual(candidateTickets({ ...call, at: "2026-01-05T20:45:00Z" }, elvi, [online, empty]), []);
  assert.equal(pickSquareOrder({ at: "2026-01-05T20:50:00Z", caller: "+15555550199", name: null }, [empty]), null);
  assert.equal(pickSquareOrder({ at: "2026-01-05T20:40:00Z", caller: "+15555550199", name: null }, [online]), null);
});
test("followup1: a new phone order (items, no follow-up words) isn't a follow-up", () => {
  const elvi: any = [{ name: "Taco", baseName: "Taco", quantity: 2, choices: [], totalCents: 600 }];
  assert.equal(followUpFor({ ...call, turns: [{ speaker: "caller", text: "two tacos de pastor please" }] }, elvi, [online]), null);
});
test("learn1: aggregates paid online orders only, no personal data", () => {
  const paid = { ...online, state: "COMPLETED", line_items: [{ name: "Burrito", quantity: "2", note: "extra salsa", modifiers: [{ name: "Bistec / Steak" }, { name: "Arroz / Rice" }] }, { name: "Agua Fresca", quantity: "1", note: "call me 5555550100" }] };
  const paid2 = { ...paid, id: "ON2" };
  const draft = { ...online, id: "D", state: "DRAFT", tenders: [] };
  const L = buildOnlineLearning([paid, paid2, draft, { ...paid, source: { name: "Point of Sale" } }]);
  assert.equal(L.orders, 2);
  assert.equal(L.items[0].name, "Burrito"); assert.equal(L.items[0].count, 4);
  assert.equal(L.modifiersByItem["Burrito"].modifiers[0].share, 1);
  assert.deepEqual(L.combos.map((c) => c.name), ["Agua Fresca + Burrito"]);
  assert.deepEqual(L.notes.map((n) => n.name), ["extra salsa"]);
  const s = JSON.stringify(L); assert.doesNotMatch(s, /5555550100|Test Person|ON1|ON2/);
  assert.equal(safeNote("123 Main St"), null); assert.equal(safeNote("sin cebolla"), "sin cebolla");
});

import { customerPhoneOf } from "../../src/call-accuracy.ts";
test("followup1b: outbound callback (our line calls the customer) + staff naming the order time → follow-up, even if items are read back", () => {
  const ours = ["5550001609"];
  assert.equal(customerPhoneOf({ caller: "+15550001609", calledNumber: PH }, ours), "5555550100");
  const elvi: any = [{ name: "Burrito", baseName: "Burrito", quantity: 1, choices: [], totalCents: 2639 }];
  const cb: any = { ...call, turns: [{ speaker: "staff", text: "Hi, it's Cocina Elvis, your burrito shows pickup tomorrow at 11 a.m." }, { speaker: "caller", text: "Oh, today please." }] };
  assert.equal(followUpFor(cb, elvi, [online])?.orderId, "ON1");
});
