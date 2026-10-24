import { strict as assert } from "node:assert";
import { test } from "node:test";
import { nameFromTranscriptInfo, thirdPersonName, markOrderOnlyName, rememberOrderName, rememberHeardNameIfNone, isOrderOnlyName } from "../../src/order-name.js";
import { decideReadback, orderNameAskOnly } from "../../src/name-extract.js";
import { savePickupName, savedCallerName, phoneKey } from "../../src/caller-memory.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Fixture: CAa2b5a38efd2b73dbe8fe1606e3f2fb0e — Thu Oct 22 2026 ~1:43 PM ET, phone …6490.
 * Staff asked "name for the order"; caller said "Shannon". Carlos 10/24: that is the customer/order name (ticket + name log),
 * not auto pickup-only. Pickup-only stays "for/para Shannon" / picking-up phrasing. */
const SHANNON_TURNS = [
  { speaker: "staff" as const, text: "cocina, Eli, buenas tardes." },
  { speaker: "caller" as const, text: "Yes, you have, chili rainos today?" },
  { speaker: "staff" as const, text: "Yes, sir, I have. Sure. The chili rellenos is the cheese, sir, and coming in order two chiles. You like a rice and beans?" },
  { speaker: "caller" as const, text: "can I, can I order some for pickup?" },
  { speaker: "caller" as const, text: "yes, please. flour." },
  { speaker: "staff" as const, text: "Tortillas, corn, or flour?" },
  { speaker: "staff" as const, text: "Okay, anything else, sir?" },
  { speaker: "caller" as const, text: "that's it, I'd like, I would like five orders if that's okay." },
  { speaker: "staff" as const, text: "Oh, how many orders do you want?" },
  { speaker: "caller" as const, text: "Five. Oh, okay." },
  { speaker: "staff" as const, text: "Okay, give me, twenty, twenty minutes is fine. Give me your, give me your name for the order, please." },
  { speaker: "caller" as const, text: "Shannon." },
  { speaker: "staff" as const, text: "Sure. Okay, give me twenty minutes, buddy, please. Thank you." },
  { speaker: "caller" as const, text: "Okay, thank you." },
];

test("shannon1: staff-ask bare 'Shannon' is customer order name (not auto pickupOnly)", () => {
  const info = nameFromTranscriptInfo(SHANNON_TURNS);
  assert.equal(info?.name, "Shannon");
  assert.equal(info?.source, "staff-ask");
  assert.equal(info?.thirdPerson, false); // Carlos 10/24: answering name-for-order = customer
  assert.equal(orderNameAskOnly(SHANNON_TURNS as any, "Shannon"), true);
  const d = decideReadback("+14408976490", { name: "Shannon", role: "self", confidence: 0.95, evidence: "Shannon.", speaker: "caller" }, []);
  assert.equal(d.action, "save"); // or skip if plan refuses — not pickup
  assert.notEqual(d.action, "pickup");
  // Explicit pickup_other (para/for path) still picks up only:
  const d2 = decideReadback("+14408976490", { name: "Shannon", role: "pickup_other", confidence: 0.95, evidence: "for Shannon", speaker: "caller" }, []);
  assert.equal(d2.action, "pickup");
  assert.equal(d2.reason, "pickup-other");
});

test("shannon1: for Shannon / para Shannon never save to contact via remember*", () => {
  assert.equal(thirdPersonName("for Shannon"), "Shannon");
  assert.equal(thirdPersonName("para Shannon"), "Shannon");
  markOrderOnlyName("Shannon");
  assert.equal(isOrderOnlyName("Shannon"), true);
  assert.deepEqual(rememberOrderName("+14408976490", "Shannon"), { saved: false, reason: "third-person" });
  assert.equal(rememberHeardNameIfNone("+14408976490", "Shannon"), false);
});
