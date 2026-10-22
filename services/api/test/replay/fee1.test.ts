import test from "node:test"; import assert from "node:assert/strict";
import { ticketLines, scoreOrder } from "../../src/call-accuracy.ts";
import { ticketFulfillment } from "../../src/delivery.ts";
const li = (name: string, q: number, cents: number, cat = true) => ({ name, ...(cat ? { catalog_object_id: "C-" + name } : { item_type: "CUSTOM_AMOUNT" }), variation_name: "Regular", quantity: String(q), base_price_money: { amount: cents }, total_money: { amount: cents * q }, gross_sales_money: { amount: cents * q }, modifiers: [] });
const NB = () => li("NO BEBIDA / NO DRINK", 1, 0);
test("fee1: catalog Delivery Fee on a PICKUP ticket = delivery; not an item", () => {
  const o = { fulfillments: [{ type: "PICKUP" }], line_items: [li("Taco", 2, 300), { ...li("Delivery Fee", 1, 800), variation_name: "Delivery 2" }] };
  assert.equal(ticketFulfillment(o).fulfillment, "DELIVERY");
  const T = ticketLines(o); const E: any[] = [{ baseName: "Taco", name: "Taco", quantity: 2, choices: [], unitCents: 300, totalCents: 600 }];
  assert.equal(scoreOrder(E, T).score, 100);
});
test("fee1: nameless $8 on a combined ticket is the fee (not a ghost); elsewhere it stays a possible ghost", () => {
  const big = { fulfillments: [{ type: "PICKUP" }], line_items: [li("Taco", 6, 300), NB(), li("Torta", 6, 900), li("", 1, 800, false)] };
  const fee: any = ticketLines(big).find((l: any) => l.totalCents === 800);
  assert.equal(fee.baseName, "Delivery Fee"); assert.ok(!fee.ghost);
  assert.equal(ticketFulfillment(big).fulfillment, "DELIVERY");
  const small = { line_items: [li("Taco", 1, 300), li("", 1, 800, false)] };
  assert.ok((ticketLines(small).find((l: any) => l.totalCents === 800) as any).ghost);
  assert.equal(ticketFulfillment(small).fulfillment, "PICKUP");
});
test("fee1: Delivery service charge = delivery", () => {
  assert.equal(ticketFulfillment({ line_items: [li("Taco", 1, 300)], service_charges: [{ name: "Delivery", amount_money: { amount: 299 } }] }).fulfillment, "DELIVERY");
});
