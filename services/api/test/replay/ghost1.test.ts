import test from "node:test"; import assert from "node:assert/strict";
import { ticketLines } from "../../src/call-accuracy.ts";
const li = (o: any) => ({ quantity: "1", total_money: { amount: 550 }, gross_sales_money: { amount: 550 }, modifiers: [], ...o });
test("Entry Error custom amounts are dropped; nameless ones are ghosts; catalog items untouched", () => {
  const ls = ticketLines({ line_items: [
    li({ name: "Taco", catalog_object_id: "X1", variation_name: "Regular", item_type: "ITEM" }),
    li({ name: "Entry Error", item_type: "CUSTOM_AMOUNT" }),
    li({ name: "", note: "entry error", item_type: "CUSTOM_AMOUNT" }),
    li({ name: "", item_type: "CUSTOM_AMOUNT", total_money: { amount: 900 }, gross_sales_money: { amount: 900 } }),
    li({ name: "Delivery fee", item_type: "CUSTOM_AMOUNT" }),
  ] });
  assert.deepEqual(ls.map((l: any) => [l.baseName, !!l.ghost]), [["Taco", false], ["", true], ["Delivery fee", false]]);
});
