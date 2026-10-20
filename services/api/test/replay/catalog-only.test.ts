// catalog1: production orders = real Square catalog variations only (food, drinks, Delivery Fee item). No custom amounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCatalogOnly, deliveryFeeLineItem, CatalogOnlyError } from "../../src/square.ts";

test("catalog1: catalog lines pass; ad-hoc / custom-price / [TEST] lines are refused for staff", () => {
  const coke = { name: "Coca Cola", quantity: "2", catalog_object_id: "JJE4KCJT752VBETFD7PWKLKN" };
  assert.doesNotThrow(() => assertCatalogOnly([coke, deliveryFeeLineItem(500)]));
  assert.throws(() => assertCatalogOnly([coke, { name: "", quantity: "1", base_price_money: { amount: 700, currency: "USD" } }]), CatalogOnlyError);
  assert.throws(() => assertCatalogOnly([{ ...coke, base_price_money: { amount: 300, currency: "USD" } }]), /not a Square catalog item/);
  assert.throws(() => assertCatalogOnly([{ ...coke, catalog_object_id: undefined }]), CatalogOnlyError);
  assert.throws(() => assertCatalogOnly([{ ...coke, name: "[TEST] Coca Cola" }]), CatalogOnlyError);
});
test("catalog1: delivery fee is the Square 'Delivery Fee' item (Delivery 1 $5 / Delivery 2 $8); other amounts → staff", () => {
  assert.deepEqual(deliveryFeeLineItem(500), { catalog_object_id: "UVVEBGR56Z52F2JL44V3V2CW", quantity: "1" });
  assert.deepEqual(deliveryFeeLineItem(800), { catalog_object_id: "G43MX6TMJ5LICU6RDC7TRXP6", quantity: "1" });
  assert.throws(() => deliveryFeeLineItem(799), /staff must confirm/);
});
