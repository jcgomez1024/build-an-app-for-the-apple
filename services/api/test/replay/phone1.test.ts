// phone1 (Cecilia CA0a9a67, Sat 10:21 AM): online Menudo window starts 11:20 (pickup+prep) but phone
// takes it from category open (Sat 10:00). Doradas still use the displayed Especial window (hours1).
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-24T10:21:00-04:00";
const { itemAvailability, enforceSiteAvailability, unavailableNowReply } = await import("../../src/site-catalog.ts");
const { finalizeTurn } = await import("../../src/elvi.ts");
const { isClosing } = await import("../../src/call-scoring.ts");

const MENUDO_SQ = "NA2WYA64JRUYNKQ5ZEIKTMGZ";
const DORADA_SQ = "DANMDMZDAJYSE6ERXUY5EKGZ";

test("phone1: Menudo at 10:21 Sat is available on phone, not on web", () => {
  assert.equal(itemAvailability(MENUDO_SQ, undefined, { channel: "phone" }).available, true);
  assert.equal(itemAvailability(MENUDO_SQ).available, false, "web still uses 11:20 online window");
});

test("phone1: finalizeTurn does not refuse Menudo at 10:21 Sat", () => {
  const menu: any[] = [{ id: "menudo", name: "Menudo", squareCatalogObjectId: MENUDO_SQ, priceCents: 1600, modifierGroups: [] }];
  const r: any = finalizeTurn(
    { language: "es", reply: "Agregado.", actions: [{ type: "add_item", itemId: "menudo", quantity: 2, modifiers: [] }] } as any,
    "dos órdenes de menudo con pata", menu as any, "es");
  assert.equal(r.actions.filter((a: any) => a.type === "add_item").length, 1);
  assert.doesNotMatch(r.reply || "", /11:20|solo está disponible/i);
});

test("phone1: Dorada still refused after Especial window on phone (hours1)", () => {
  process.env.ELVI_SIMULATED_NOW = "2026-10-23T20:03:00-04:00";
  try {
    assert.equal(itemAvailability(DORADA_SQ, undefined, { channel: "phone" }).available, false);
    const reply = unavailableNowReply({ name: "(QD) Quesadilla Dorada" }, DORADA_SQ, "es", undefined, { channel: "phone" });
    assert.match(String(reply), /7:59/);
  } finally {
    process.env.ELVI_SIMULATED_NOW = "2026-10-24T10:21:00-04:00";
  }
});

test("close1: Ándale, pues / órale is a closing line", () => {
  assert.equal(isClosing("Ándale, pues"), true);
  assert.equal(isClosing("Andale pues"), true);
  assert.equal(isClosing("órale"), true);
  assert.equal(isClosing("Ándale, pues, gracias"), true);
});
