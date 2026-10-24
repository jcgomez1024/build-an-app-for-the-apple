// quesitorta1 / intro1 / asados1 / multi3 — Suleika CA802db3 + Enrique CA00cedc (10/24 morning)
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-24T10:33:00-04:00";
const { applySharedAliases } = await import("../../src/aliases.ts");
const { cleanPhrase, dishesNamed, EXTRAS_ID, isOrderIntro } = await import("../../src/call-scoring.ts");
const { itemAvailability } = await import("../../src/site-catalog.ts");

test("quesitorta1: quesitortas → queso tortas alias", () => {
  assert.match(applySharedAliases("cuatro quesitortas de bistec con frijol", "phone"), /queso tortas/i);
  assert.match(cleanPhrase("Am, ¿me podrá dar cuatro quesitortas de bistec con frijol?"), /queso tortas/i);
  assert.ok(dishesNamed(cleanPhrase("cuatro quesitortas de bistec")).has("queso torta"));
});

test("intro1: para hacer un pedido is order-intro (not a dish / not dorada)", () => {
  for (const s of [
    "para hacer un pedido, por favor.",
    "Hola, buenos días, para hacer un pedido, por favor.",
    "para hacer",
    "quiero hacer un pedido",
  ]) {
    assert.equal(isOrderIntro(s), true, s);
    assert.equal(dishesNamed(s).size, 0, s);
  }
  assert.equal(isOrderIntro("va a ser un menudo con pata"), false);
});

test("phone1b: Dorada available Sat 10:33 on phone; web still gated", () => {
  assert.equal(itemAvailability("DANMDMZDAJYSE6ERXUY5EKGZ", undefined, { channel: "phone" }).available, true);
  assert.equal(itemAvailability("DANMDMZDAJYSE6ERXUY5EKGZ").available, false);
});

test("dishesNamed: menudo and mole are dishes (multi3)", () => {
  assert.ok(dishesNamed("va a ser un menudo con pata").has("menudo"));
  assert.ok(dishesNamed("también va a ser un mole entonces").has("mole"));
});

test("asados1: EXTRAS_ID constant still points at Extras", () => {
  assert.match(EXTRAS_ID, /extras/i);
});

test("quesitorta1: dishesNamed is only queso torta (not also torta)", () => {
  const s = dishesNamed(cleanPhrase("cuatro quesitortas de bistec con frijol"));
  assert.deepEqual([...s], ["queso torta"]);
});
