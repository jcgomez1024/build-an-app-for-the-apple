import test from "node:test"; import assert from "node:assert/strict";
import { feeOnPickup, feeOnPickupReport } from "../../src/fee-check.ts";
const fee = { name: "Delivery Fee", variation_name: "Delivery 2", catalog_object_id: "F" };
const taco = { name: "Taco", catalog_object_id: "T" };
test("feepick1: delivery fee on a Pickup ticket is flagged; Delivery tickets, no-fee and canceled tickets are not", () => {
  assert.ok(feeOnPickup({ fulfillments: [{ type: "PICKUP" }], line_items: [taco, fee] }));
  assert.ok(feeOnPickup({ line_items: [taco], service_charges: [{ name: "Delivery" }] }));
  assert.ok(!feeOnPickup({ fulfillments: [{ type: "DELIVERY" }], line_items: [taco, fee] }));
  assert.ok(!feeOnPickup({ fulfillments: [{ type: "PICKUP" }], line_items: [taco] }));
  assert.ok(!feeOnPickup({ state: "CANCELED", line_items: [taco, fee] }));
});
test("feepick1: weekly report with per-device counts", () => {
  const o = (id: string, at: string) => ({ id, created_at: at, fulfillments: [{ type: "PICKUP" }], line_items: [taco, fee] });
  const r = feeOnPickupReport([o("a", "2026-01-05T17:00:00Z"), o("b", "2026-01-06T17:00:00Z"), o("c", "2026-01-13T17:00:00Z"), { id: "d", created_at: "2026-01-13T17:00:00Z", line_items: [taco] }],
    [{ order_id: "a", device_details: { device_name: "Register A" } }, { order_id: "b", device_details: { device_name: "Register A" } }, { order_id: "c", device_details: { device_name: "Sam’s iPhone" } }]);
  assert.equal(r.total, 3); assert.equal(r.ticketsWithFee, 3);
  assert.deepEqual(r.weeks.map((w) => [w.week, w.count, w.devices]), [["2026-01-05", 2, { "Register A": 2 }], ["2026-01-12", 1, { "iPhone (personal)": 1 }]]);
});
