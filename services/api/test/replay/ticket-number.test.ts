// ticketno1: Square's own ticket numbers (fake data; no Square calls).
import { test } from "node:test";
import assert from "node:assert/strict";
const { squareRefs } = await import("../../src/call-accuracy.ts");
const t = await import("../../src/twilio.ts");
const order = (id: string, at: string, extra: any = {}) => ({ id, created_at: at, tenders: [{ id: `Ab12${id}xyz`, payment_id: `Ab12${id}xyz` }], ...extra });

test("squareRefs: Receipt # = first 4 of the payment ID, Ticket = ticket_name, Dashboard link", () => {
  const r = squareRefs(order("ORD1", "2026-10-19T15:00:00Z", { ticket_name: "Test" }));
  assert.equal(r.receiptNumber, "Ab12"); assert.equal(r.ticketName, "Test"); assert.equal(r.orderId, "ORD1");
  assert.match(r.dashboardUrl!, /dashboard\/sales\/transactions\/Ab12ORD1xyz$/);
  assert.equal(squareRefs({ id: "X" }).receiptNumber, null);
});
test("pickSquareOrder: phone match wins", () => {
  const o = [order("A", "2026-10-19T15:03:00Z"), order("B", "2026-10-19T15:04:00Z", { fulfillments: [{ pickup_details: { recipient: { phone_number: "+15555550101" } } }] })];
  assert.equal(t.pickSquareOrder({ at: "2026-10-19T15:00:00Z", caller: "+15555550101", name: null }, o)?.order.id, "B");
});
test("pickSquareOrder: ticket name = caller's first name", () => {
  const o = [order("A", "2026-10-19T15:03:00Z", { ticket_name: "Ana" }), order("B", "2026-10-19T15:04:00Z", { ticket_name: "Luis" })];
  assert.equal(t.pickSquareOrder({ at: "2026-10-19T15:00:00Z", caller: "+15555550102", name: "Luis Test" }, o)?.by, "ticket name");
});
test("pickSquareOrder: only ticket in 20 min, else no guess", () => {
  const one = [order("A", "2026-10-19T15:05:00Z"), order("Z", "2026-10-19T16:30:00Z")];
  assert.equal(t.pickSquareOrder({ at: "2026-10-19T15:00:00Z", caller: "", name: null }, one)?.order.id, "A");
  const two = [order("A", "2026-10-19T15:05:00Z"), order("B", "2026-10-19T15:06:00Z")];
  assert.equal(t.pickSquareOrder({ at: "2026-10-19T15:00:00Z", caller: "", name: null }, two), null);
});
