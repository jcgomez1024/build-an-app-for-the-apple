// mau1 (CAc68af8803030b9ac7ac2907b7b4108bc ~6:37 PM ET Oct 25): desk Spanish, no order.
// Caller asked if delivery available, chatted, hung up. No ticket.
// Live miss: saved name "Yo Que Mau" from "Soy yo, que Mau"; locked DELIVERY; savedToMemory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T18:37:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromAnswer, nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAc68af8-turns.json", import.meta.url), "utf8"));

test("mau1: yo/que/soy fillers strip → Mau only", () => {
  assert.equal(nameFromAnswer("Soy yo, que Mau."), "Mau");
  assert.equal(nameFromAnswer("Es que Mau"), "Mau");
  assert.equal(nameFromAnswer("El que Mau"), "Mau");
  assert.equal(nameFromAnswer("Que no, que Mau."), "Mau");
  assert.equal(nameFromAnswer("Yo Que Mau"), "Mau");
  assert.equal(nameFromAnswer("Dale"), null);
  assert.equal(nameFromAnswer("Vámonos"), null);
  assert.equal(nameFromAnswer("Ujú"), null);
});

test("mau1: transcript volunteer name is Mau", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.equal(info!.name, "Mau");
  assert.equal(info!.source, "volunteer");
});

test("mau1: empty cart + no locked fulfillment (no order)", async () => {
  const stub = async () => ({ reply: "", actions: [] });
  const r = await shadowOrderFromTurns(turns as any, stub);
  assert.equal(r.cart.length, 0, JSON.stringify(r.cart));
  assert.equal(r.fulfillment, null, "must not lock DELIVERY/PICKUP without an order");
});
