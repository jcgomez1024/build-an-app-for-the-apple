// namecheck1: synthetic names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heardName, ticketName, compareNames, displayName, nameStats } from "../../src/name-accuracy.ts";

test("namecheck1: heard name — staff ask, self-intro, accents kept", () => {
  assert.equal(heardName([{ speaker: "staff", text: "¿A nombre de quién?" }, { speaker: "caller", text: "a nombre de josé" }]), "José");
  assert.equal(heardName([{ speaker: "caller", text: "Hi, this is Zander, I want two tacos" }]), "Zander");
  assert.equal(heardName([{ speaker: "caller", text: "Hola, habla Ramón" }]), "Ramón");
  assert.equal(heardName([{ speaker: "caller", text: "this is for pickup" }]), null);
  assert.equal(displayName("maría  JOSÉ"), "María José");
});
test("namecheck1: ticket name from recipient / ticket name / short note", () => {
  assert.equal(ticketName({ fulfillments: [{ pickup_details: { recipient: { display_name: "ZANDER Q" } } }] }), "Zander Q");
  assert.equal(ticketName({ ticket_name: "To go Ramon" }), "Ramon");
  assert.equal(ticketName({ note: "Zed" }), "Zed");
  assert.equal(ticketName({ note: "no onions please and extra salsa on the side" }), null);
});
test("namecheck1: match / close / missing / mismatch / no ticket name", () => {
  assert.equal(compareNames("Ramón", "Ramon"), "match");
  assert.equal(compareNames("Zander", "Zander Q"), "match");
  assert.equal(compareNames("Jonathon", "Jonathan"), "close");
  assert.equal(compareNames("Yesica", "Jessica"), "close");
  assert.equal(compareNames(null, "Zed"), "missing");
  assert.equal(compareNames("Zed", "Ulma"), "mismatch");
  assert.equal(compareNames("Zed", null), null);
});
test("namecheck1: weekly name stats are separate from the item score", () => {
  const s = nameStats([{ at: "2026-01-05T15:00:00Z", nameCheck: { heard: "Zed", result: "match" } }, { at: "2026-01-06T15:00:00Z", nameCheck: { heard: null, result: "missing" } }, { at: "2026-01-06T16:00:00Z", nameCheck: { heard: "Ula", result: null } }]);
  assert.deepEqual(s.map((x) => [x.calls, x.heard, x.compared, x.match, x.missing, x.accuracy]), [[3, 2, 2, 1, 1, 50]]);
});
