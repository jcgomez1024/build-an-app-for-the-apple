// appdelivery1 / appsopes1: customer app = website delivery fees; phone unchanged; app sells only the 10" sopesaso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appQuoteFor, loadAppDelivery, quoteFor, loadDeliveryConfig } from "../../src/delivery-zone.ts";
import { deliveryLines, sandboxDeliveryCharges, CatalogOnlyError } from "../../src/square.ts";
import { appSmallSopeReply } from "../../src/elvi.ts";
import { getLaunchConfig } from "../../src/launch-config.ts";

const app = loadAppDelivery()!;
test("appdelivery1: website tiers + $1 service, ETA 40, 10 mi limit, $10 min", () => {
  const a = appQuoteFor(3.9, app); assert.equal(a.deliveryCents, 299); assert.equal(a.serviceCents, 100); assert.equal(a.feeCents, 399); assert.equal(a.etaMinutes, 40); assert.equal(a.minimumCents, 1000);
  assert.equal(appQuoteFor(4.0, app).deliveryCents, 299);
  assert.equal(appQuoteFor(4.1, app).deliveryCents, 699);
  assert.equal(appQuoteFor(10, app).feeCents, 799);
  const out = appQuoteFor(10.2, app); assert.equal(out.ok, false); assert.equal(out.reason, "out_of_range");
});
test("appdelivery1: phone fees unchanged ($5/$8, no service fee)", () => {
  const cfg = loadDeliveryConfig();
  assert.equal(quoteFor(3, null, cfg).feeCents, 500); assert.equal(quoteFor(6, null, cfg).feeCents, 800); assert.equal(quoteFor(6, null, cfg).serviceCents, 0);
});
test("appdelivery1: production app delivery refuses without catalog variations; phone uses Delivery 1/2", () => {
  const q = appQuoteFor(2, app);
  assert.throws(() => deliveryLines({}, q), (e: any) => e instanceof CatalogOnlyError && /\$2\.99/.test(e.message) && /\$1\.00/.test(e.message));
  const file = { app: { squareFeeVariations: { "299": "V299" }, squareServiceFeeVariation: "VSVC" } };
  assert.deepEqual(deliveryLines({}, q, file).map((l) => l.catalog_object_id), ["V299", "VSVC"]);
  assert.deepEqual(deliveryLines({ __internalPhone: true }, quoteFor(2, null, loadDeliveryConfig())).map((l) => l.catalog_object_id), ["UVVEBGR56Z52F2JL44V3V2CW"]);
  assert.deepEqual(sandboxDeliveryCharges(q).map((c) => c.amount_money.amount), [299, 100]);
});
test("appdelivery1: delivery enabled for the app via delivery.json", () => {
  if (process.env.DELIVERY_ENABLED === undefined && !process.env.FULFILLMENT_MODES) { const c = getLaunchConfig(); assert.equal(c.deliveryEnabled, true); assert.deepEqual(c.fulfillmentModes, ["PICKUP", "DELIVERY"]); }
});
test("appsopes1: small sopes in the app → ask (es/en), no add; phone/regular untouched", () => {
  const es = appSmallSopeReply({ channel: "app", language: "es", transcript: "dos sopes chiquitos de bistec" })!;
  assert.deepEqual(es.actions, []); assert.match(es.reply, /10 pulgadas/); assert.match(es.reply, /llamarnos/);
  assert.match(appSmallSopeReply({ channel: "app", language: "en", transcript: "two small sopes" })!.reply, /10-inch/);
  assert.equal(appSmallSopeReply({ channel: "phone", language: "es", transcript: "dos sopes chiquitos" }), null);
  assert.equal(appSmallSopeReply({ language: "es", transcript: "dos sopes chiquitos" }), null);
  assert.equal(appSmallSopeReply({ channel: "app", language: "es", transcript: "un sopesaso de pastor con todo" }), null);
});
