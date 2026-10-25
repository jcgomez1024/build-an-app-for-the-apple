// miguelPickup1 (CAa4bd2b371d454d80d7d1c7cd87b66dc8 ~2:01 PM ET Oct 25): desk Spanish pickup.
// Square HWPdbOEPyEpg5Hgjd2EeeXTw4PaZY $36.00 = 4 QCO bistec + 4 QCO chorizo (cart OK).
// Live name miss: order_name Juan from staff vocative "Sí, dígame, Juan." with pickupOnly false /
// savedToMemory true. Staff asked "¿…la va a recoger?" and caller said Miguel ×3; Square ticket Miguel.
// Correct: ticket/order name Miguel, pickupOnly true, savedToMemory false (not caller identity).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T14:01:00-04:00";
const {
  nameFromStaffAsk,
  nameFromStaffVocative,
  nameFromTranscriptInfo,
  nameFromAnswer,
  thirdPersonName,
  isPickupWhoAsk,
  rememberOrderName,
  markOrderOnlyName,
  isOrderOnlyName,
} = await import("../../src/order-name.ts");
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

const QCO = "sq-quesadilla-HLT6CR";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CAa4bd2b-turns.json", import.meta.url), "utf8"));

test("miguelPickup1: staff 'la va a recoger' is a pickup-who ask", () => {
  assert.equal(isPickupWhoAsk("¿A qué no me ponemos la orden que la va a recoger?"), true);
  assert.equal(isPickupWhoAsk("¿Quién la va a recoger?"), true);
  assert.equal(isPickupWhoAsk("Who's picking up?"), true);
  assert.equal(isPickupWhoAsk("¿A nombre de quién?"), false);
  assert.equal(isPickupWhoAsk("Sí, dígame, Juan."), false);
});

test("miguelPickup1: vocative Juan loses to Miguel after pickup-who ask; pickupOnly", () => {
  assert.equal(nameFromStaffVocative(turns as any), "Juan");
  assert.equal(nameFromStaffAsk(turns as any), "Miguel");
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "info");
  assert.equal(info!.name, "Miguel");
  assert.equal(info!.thirdPerson, true);
  assert.equal(info!.source, "staff-ask");
  // Must not save Miguel as caller identity
  markOrderOnlyName("Miguel");
  assert.equal(isOrderOnlyName("Miguel"), true);
  assert.deepEqual(rememberOrderName("+14404943865", "Miguel"), { saved: false, reason: "third-person" });
});

test("miguelPickup1: bare Miguel after pickup-who is not thirdPerson phrasing alone (ask marks it)", () => {
  assert.equal(thirdPersonName("Miguel."), null);
  assert.equal(nameFromAnswer("Miguel."), "Miguel");
  // Contrast: inline "la va a recoger Luis" still third-person from phrase
  assert.equal(thirdPersonName("la va a recoger Luis"), "Luis");
});

test("miguelPickup1: cart stays 4 QCO bistec + 4 QCO chorizo (no cart change)", async () => {
  const stub = async (text: string) => {
    if (/bistec/i.test(text))
      return {
        actions: [{
          type: "add_item", itemId: QCO, quantity: 4,
          modifiers: [
            { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
            { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
          ],
          readback: "4 QCO bistec",
        }],
        reply: "4 QCO bistec",
      };
    if (/chorizo/i.test(text))
      return {
        actions: [{
          type: "add_item", itemId: QCO, quantity: 4,
          modifiers: [
            { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
            { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" },
          ],
          readback: "4 QCO chorizo",
        }],
        reply: "4 QCO chorizo",
      };
    return { actions: [], reply: "?" };
  };
  const r: any = await shadowOrderFromTurns(turns.map((t: any) => ({ ...t })), stub as any);
  const qco = r.cart.filter((l: any) => String(l.itemId) === QCO || /quesadilla/i.test(String(l.itemId)));
  const bistec = qco.filter((l: any) => (l.modifiers || []).some((m: any) => /Bistec/i.test(m.option)))
    .reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  const chorizo = qco.filter((l: any) => (l.modifiers || []).some((m: any) => /Chorizo/i.test(m.option)))
    .reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  assert.equal(bistec, 4, JSON.stringify(r.cart));
  assert.equal(chorizo, 4, JSON.stringify(r.cart));
});
