// delivery1: delivery vs pickup, address capture, caller memory, zones/fees/ETA, Square ticket comparison.
// Pure: fake addresses only, temp files for caller memory + geocode cache, a fake geocoder (no network), no Square/xAI/Twilio.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "elvi-delivery-test-"));
process.env.ELVI_CALLERS_FILE = path.join(tmp, "callers.json");
process.env.ELVI_GEOCODE_CACHE = path.join(tmp, "geocode.json");
const d = await import("../../src/delivery.ts");
const z = await import("../../src/delivery-zone.ts");
const mem = await import("../../src/caller-memory.ts");

test("address: caller says it, staff reads it back → confirmed, keeps unit", () => {
  const r = d.detectAddress([
    { speaker: "caller", start: 1, text: "es a domicilio, al 123 Sample Street apartamento 4" },
    { speaker: "staff", start: 4, text: "Ok, 123 Sample St, Painesville." },
  ]);
  assert.equal(r.address?.street, "123 Sample St");
  assert.equal(r.address?.unit, "Apartamento 4");
  assert.equal(r.address?.city, "Painesville");
  assert.equal(r.confirmed, true);
});
test("address: Spanish form 'calle X número N'", () => {
  assert.equal(d.detectAddress([{ text: "en la calle Ejemplo número 77 en Mentor" }]).address?.street, "77 Ejemplo St");
});
test("address: an order is not an address", () => {
  assert.equal(d.detectAddress([{ text: "quiero 3 tacos de pastor y 2 de bistec" }]).address, null);
});
test("address: correction — the latest one wins", () => {
  const r = d.detectAddress([{ speaker: "caller", start: 1, text: "45 Fake Ave" }, { speaker: "caller", start: 5, text: "no perdón, 47 Fake Ave" }]);
  assert.equal(r.address?.street, "47 Fake Ave");
});
test("redactAddresses hides addresses", () => {
  assert.equal(d.redactAddresses("send it to 12 Fixture Rd, Mentor please"), "send it to <ADDRESS> please");
});
test("call fulfillment: staff read-back counts, question ignored", () => {
  const r = d.detectFulfillment([
    { speaker: "staff", start: 1, text: "¿Para entrega a domicilio o para recoger hoy?" },
    { speaker: "caller", start: 3, text: "Sí, me lo traen" },
    { speaker: "staff", start: 6, text: "Ok, entrega a domicilio." },
  ]);
  assert.equal(r.fulfillment, "DELIVERY");
  assert.equal(r.by, "staff");
});
test("caller memory: address history with last-used date and uses", () => {
  const ph = "+15555550123";
  mem.saveCallerFulfillment(ph, "DELIVERY", { full: "10 Test Ln, Painesville, OH", street: "10 Test Ln" }, new Date("2026-10-01T15:00:00Z"));
  mem.saveCallerFulfillment(ph, "DELIVERY", { full: "22 Other Dr, Mentor, OH", street: "22 Other Dr" }, new Date("2026-10-05T15:00:00Z"));
  mem.saveCallerFulfillment(ph, "DELIVERY", { full: "10 Test Ln Apt 3, Painesville, OH", street: "10 Test Ln" }, new Date("2026-10-10T15:00:00Z"));
  mem.saveCallerFulfillment(ph, "PICKUP", null, new Date("2026-10-12T15:00:00Z"));
  const s = mem.savedDelivery(ph);
  assert.equal(s.lastFulfillment, "PICKUP");
  assert.equal(s.address?.street, "10 Test Ln");
  assert.equal(s.address?.uses, 2);
  assert.equal(s.address?.lastUsedAt, "2026-10-10T15:00:00.000Z");
  assert.equal(s.addressCount, 2);
  assert.equal(mem.savedDelivery("+15555550999").address, null);
});
test("zones: $5 up to 4 mi (prep + 20), $8 beyond (prep + 30), out of range past max", () => {
  const near = z.quoteForMiles(3.9), far = z.quoteForMiles(4.2), out = z.quoteForMiles(10.5);
  assert.equal(near.feeCents, 500); assert.equal(near.etaMinutes, 40);
  assert.equal(far.feeCents, 800); assert.equal(far.etaMinutes, 50);
  assert.equal(out.ok, false); assert.equal(out.reason, "out_of_range");
  assert.equal(near.message.es, "La entrega cuesta $5 y llega en unos 40 minutos.");
  assert.equal(far.message.en, "Delivery is $8 and takes about 50 minutes.");
});
test("geocode: success is cached; failure asks to confirm (never guesses)", async () => {
  let calls = 0;
  const ok: any = async () => { calls++; return { ok: true, json: async () => ({ result: { addressMatches: [{ matchedAddress: "X", coordinates: { x: -81.25, y: 41.72 } }] } }) }; };
  const q1 = await z.quoteDeliveryAddress("1 Fixture Way, Painesville", ok);
  const q2 = await z.quoteDeliveryAddress("1 Fixture Way, Painesville", ok);
  assert.equal(q1.zone, "near"); assert.equal(q2.zone, "near"); assert.equal(calls, 1);
  const none: any = async () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) });
  const f = await z.quoteDeliveryAddress("999 Nowhere Zz Rd", none);
  assert.equal(f.ok, false); assert.equal(f.needsConfirm, true); assert.equal(f.reason, "geocode_failed");
  const boom: any = async () => { throw new Error("network"); };
  assert.equal((await z.quoteDeliveryAddress("5 Offline Ct", boom)).reason, "geocode_failed");
});
test("Square ticket: DELIVERY type with address vs Elvi → score", () => {
  const order = { fulfillments: [{ type: "DELIVERY", delivery_details: { recipient: { address: { address_line_1: "123 Sample St", locality: "Painesville" } } } }] };
  const tf = d.ticketFulfillment(order);
  assert.equal(tf.fulfillment, "DELIVERY");
  assert.equal(d.scoreFulfillment({ fulfillment: "DELIVERY", address: "123 Sample St, Painesville, OH" }, tf).score, 100);
  assert.equal(d.scoreFulfillment({ fulfillment: "DELIVERY", address: "125 Sample St" }, tf).addrOk, false);
  const pickup = d.ticketFulfillment({ fulfillments: [{ type: "PICKUP", pickup_details: {} }] });
  const s = d.scoreFulfillment({ fulfillment: "DELIVERY", address: "123 Sample St" }, pickup);
  assert.equal(s.ticketMissedDelivery, true); assert.equal(s.typeOk, false);
  assert.equal(d.scoreFulfillment({ fulfillment: null, address: null }, pickup).score, 100);
});
test("Square ticket: delivery typed only in the notes still counts", () => {
  assert.equal(d.ticketFulfillment({ note: "DELIVERY 9 Note Rd", fulfillments: [{ type: "PICKUP" }] }).fulfillment, "DELIVERY");
});
test("dialog rules: unverified app user is never offered a saved address", () => {
  assert.match(d.deliveryDialogRules({}), /Never mention or guess a saved address/);
  assert.match(d.deliveryDialogRules({ verifiedSavedStreet: "10 Test Ln" }), /¿A la misma dirección, 10 Test Ln\?/);
  assert.equal(d.deliveryPrompt("ask", "es"), "¿Para entrega a domicilio o para recoger hoy?");
  assert.equal(d.deliveryPrompt("ask", "en"), "Delivery or pickup today?");
});
