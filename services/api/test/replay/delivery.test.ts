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
test("zones (fees2): distance only — <=4 mi $5/40, >4-10 mi $8/50, >10 out; city irrelevant; no service fee", () => {
  const near = z.quoteFor(2.0, "Painesville city");
  assert.equal(near.feeCents, 500); assert.equal(near.serviceCents, 0); assert.equal(near.etaMinutes, 40); assert.equal(near.city, "Painesville"); assert.equal(near.breakdown, "Envío $5");
  assert.equal(near.message.es, "La entrega (Painesville) cuesta $5 y llega en unos 40 minutos. El mínimo para entrega es $10.");
  const twp = z.quoteFor(1.5, "Painesville township"); assert.equal(twp.feeCents, 500); assert.equal(twp.city, "Painesville Twp");
  const mentor = z.quoteFor(3.0, "Mentor city"); assert.equal(mentor.feeCents, 500); assert.equal(mentor.breakdown, "Envío $5");
  assert.doesNotMatch(mentor.message.es, /servicio|confirma/);
  assert.equal(z.quoteFor(4.0, "Mentor city").feeCents, 500);
  const f1 = z.quoteFor(4.01, "Painesville city"); assert.equal(f1.feeCents, 800); assert.equal(f1.etaMinutes, 50); assert.equal(f1.breakdown, "Envío $8");
  assert.equal(z.quoteFor(10.0, "Mentor city").feeCents, 800);
  const out = z.quoteFor(10.4, "Madison township");
  assert.equal(out.ok, false); assert.equal(out.reason, "out_of_range"); assert.match(out.message.es, /fuera del área de entrega/);
  const unk = z.quoteFor(2.0, null); assert.equal(unk.ok, true); assert.equal(unk.feeCents, 500); // city unknown no longer matters
  assert.equal(near.minimumCents, 1000);
});
test("fees1: distance is straight-line (haversine) from the store", () => {
  const o = z.loadDeliveryConfig().origin;
  assert.ok(Math.abs(z.milesBetween(o, { lat: o.lat + 1, lng: o.lng }) - 69.09) < 0.1); // 1° latitude ≈ 69.09 mi great-circle
  assert.ok(Math.abs(z.milesBetween(o, { lat: o.lat, lng: o.lng - 0.1163 }) - 6.0) < 0.05);
});
test("fees2: geocoded fixtures — Painesville $5, Mentor ~6 mi $8, <4 mi twp $5, >10 mi out", async () => {
  const at = (name: string, x: number, y: number): any => async () => ({ ok: true, json: async () => ({ result: { addressMatches: [{ matchedAddress: "F", coordinates: { x, y }, geographies: { "Incorporated Places": [{ NAME: name }] } }] } }) });
  const o = z.loadDeliveryConfig().origin;
  assert.equal((await z.quoteDeliveryAddress("10 Fees Fixture St, Painesville", at("Painesville city", o.lng - 0.01, o.lat + 0.005))).feeCents, 500);
  const m = await z.quoteDeliveryAddress("11 Fees Fixture Ave, Mentor", at("Mentor city", o.lng - 0.1163, o.lat));
  assert.equal(m.miles, 6); assert.equal(m.feeCents, 800); assert.equal(m.breakdown, "Envío $8");
  const c = await z.quoteDeliveryAddress("12 Fees Fixture Rd, Concord", at("Concord township", o.lng + 0.02, o.lat - 0.03));
  assert.ok(c.miles! < 4); assert.equal(c.feeCents, 500);
  const far = await z.quoteDeliveryAddress("13 Fees Fixture Ln, Madison", at("Madison township", o.lng + 0.215, o.lat));
  assert.ok(far.miles! > 10); assert.equal(far.ok, false); assert.equal(far.reason, "out_of_range");
});
test("geocode: city from Census place, cached; failure / ambiguity asks to confirm (never guesses)", async () => {
  let calls = 0;
  const geo = (name: string | null, x = -81.25, y = 41.72): any => async () => { calls++; return { ok: true, json: async () => ({ result: { addressMatches: [{ matchedAddress: "X", coordinates: { x, y }, geographies: name ? { "Incorporated Places": [{ NAME: name }] } : {} }] } }) }; };
  const q1 = await z.quoteDeliveryAddress("1 Fixture Way, Painesville", geo("Painesville city"));
  const q2 = await z.quoteDeliveryAddress("1 Fixture Way, Painesville", geo("Painesville city"));
  assert.equal(q1.zone, "near"); assert.equal(q2.city, "Painesville"); assert.equal(calls, 1);
  assert.equal((await z.quoteDeliveryAddress("2 Fixture Rd, Mentor", geo("Mentor city"))).feeCents, 500); // ~0.4 mi → $5
  const twp: any = async () => ({ ok: true, json: async () => ({ result: { addressMatches: [{ matchedAddress: "T", coordinates: { x: -81.25, y: 41.72 }, geographies: { "County Subdivisions": [{ NAME: "Painesville township" }] } }] } }) });
  const t = await z.quoteDeliveryAddress("3 Township Ln", twp);
  assert.equal(t.feeCents, 500); assert.equal(t.city, "Painesville Twp");
  assert.equal((await z.quoteDeliveryAddress("4 Noplace Ct", geo(null))).feeCents, 500); // no city but geocoded → distance decides
  const two: any = async () => ({ ok: true, json: async () => ({ result: { addressMatches: [
    { coordinates: { x: -81.25, y: 41.72 }, geographies: { "Incorporated Places": [{ NAME: "Painesville city" }] } },
    { coordinates: { x: -81.3, y: 41.7 }, geographies: { "Incorporated Places": [{ NAME: "Mentor city" }] } }] } }) });
  assert.equal((await z.quoteDeliveryAddress("5 Twin St", two)).reason, "place_unknown");
  const none: any = async () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) });
  const f = await z.quoteDeliveryAddress("999 Nowhere Zz Rd", none);
  assert.equal(f.ok, false); assert.equal(f.needsConfirm, true); assert.equal(f.reason, "geocode_failed");
  const boom: any = async () => { throw new Error("network"); };
  assert.equal((await z.quoteDeliveryAddress("5 Offline Ct", boom)).reason, "geocode_failed");
});
test("delivery minimum: $10 food subtotal before the fee", async () => {
  const sq = await import("../../src/square.ts");
  const menu: any = [{ id: "a", priceCents: 450 }, { id: "b", priceCents: 1299 }];
  assert.equal(sq.cartSubtotalCents([{ id: "a", quantity: 2 }] as any, menu), 900);
  assert.equal(sq.cartSubtotalCents([{ id: "a", quantity: 2, modifiers: [{ priceDeltaCents: 100 }] }] as any, menu), 1100);
  assert.equal(sq.cartSubtotalCents([{ id: "b", quantity: 1 }] as any, menu), 1299);
  assert.equal(z.deliveryMinimumCents(), 1000);
  assert.match(d.deliveryDialogRules({}), /at least \$10 before the delivery fee/);
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
