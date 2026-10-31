import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameFromTranscriptInfo, nameFromSpelledLetters } from "../../src/order-name.js";
import { toPosLine } from "../../src/pos-catalog.js";

const fx = JSON.parse(readFileSync(new URL("../fixtures/CAb35dd6-gustavo1.json", import.meta.url), "utf8"));

test("gustavo1: 'y y y me pone' is not a spelled name; staff-confirmed 'a nombre de Gustavo' wins", () => {
  assert.equal(nameFromTranscriptInfo(fx.turns)?.name, "Gustavo");
  assert.equal(nameFromSpelledLetters("y y y"), null);
  assert.equal(nameFromSpelledLetters("a a a"), null);
  assert.equal(nameFromSpelledLetters("M M M"), null);
  assert.equal(nameFromSpelledLetters("J O S E"), "Jose");
});

test("gustavo1: 12 x Tortilla Comal keeps its own POS variation (not the 6-pack)", () => {
  const l = toPosLine({ variationId: "VGID3HJ6257CRFOGZIXIT4J4", name: "Tortillas (ONLINE) 12 x Tortilla Comal / Handmade", quantity: 1, choices: [], unitCents: 1200, totalCents: 1200 }, fx.posCatalog);
  assert.equal(l.name, "Tortillas (ONLINE) · 12 x Tortilla Comal / Handmade");
  assert.equal(l.totalCents, 1200);
  const six = toPosLine({ variationId: "YQG6N4IMYJQQR6B2YELPK6RD", name: "x", quantity: 2, choices: [], unitCents: 700, totalCents: 1400 }, fx.posCatalog);
  assert.equal(six.name, "Tortillas (ONLINE) · 6 x Tortilla Comal / Handmade");
});
