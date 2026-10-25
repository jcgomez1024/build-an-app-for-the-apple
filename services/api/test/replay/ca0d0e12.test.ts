// ca0d0e12 (CA0d0e12096b83f09291bd4d010a798638 ~1:08 PM ET Oct 25): desk Spanish delivery.
// Square ~$91.25 + $5 fee = 3 CON PATA + 3 QD Deluxe prensado + 2 QCO bistec + 2 QCO duro.
// Live miss: QD×2 (missed póngame tres); missed QCO duro; phantom torta from avail; no delivery; name Mmm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T13:08:00-04:00";
const { shadowOrderFromTurns, DORADA_DELUXE_ID } = await import("../../src/call-scoring.ts");
const { nameFromTranscript, nameFromAnswer } = await import("../../src/order-name.ts");
const { availabilityQuestion } = await import("../../src/elvi.ts");
const { fulfillmentIn, detectFulfillment } = await import("../../src/delivery.ts");

const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
const QCO = "sq-quesadilla-HLT6CR";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA0d0e12-turns.json", import.meta.url), "utf8"));

test("ca0d0e12: Mmm / nena are never order names", () => {
  assert.equal(nameFromAnswer("Mmm"), null);
  assert.equal(nameFromAnswer("mmm"), null);
  assert.equal(nameFromAnswer("nena"), null);
  const n = nameFromTranscript(turns as any);
  assert.ok(!n || !/^(mmm+|mm+|nena)$/i.test(n), "name not Mmm/nena: " + n);
});

test("ca0d0e12: si tiene torta de milanesa is availability — no ring", () => {
  const r = availabilityQuestion({ transcript: "Ah, me pone un, si tiene torta de milanesa.", language: "es" } as any);
  assert.ok(r, "AVAIL_Q should match");
  assert.equal(r!.actions.length, 0);
});

test("ca0d0e12: ¿Me lo trae? is DELIVERY", () => {
  assert.equal(fulfillmentIn("¿Me lo trae, por favor?"), "DELIVERY");
  const d = detectFulfillment([
    { speaker: "staff", text: "¿Vas a venir o te lo voy a llevar?" },
    { speaker: "caller", text: "¿Me lo trae, por favor?" },
  ]);
  assert.equal(d.fulfillment, "DELIVERY");
});

const stubLiveMiss = async (text: string) => {
  // Reproduce live wrongs: QD×2, phantom torta, no duro, no delivery action
  if (/torta/i.test(text))
    return {
      actions: [{
        type: "add_item",
        itemId: "sq-torta-prensado-milanesa-pollo-PHANTOM",
        quantity: 1,
        modifiers: [],
        readback: "torta milanesa",
      }],
      reply: "torta",
    };
  if (/menudo|pata/i.test(text) && !/quesadilla|torta|taco/i.test(text))
    return {
      actions: [{
        type: "add_item", itemId: CON, quantity: 3,
        modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }],
        readback: "3 menudo con pata",
      }],
      reply: "3 Con Pata",
    };
  if (/quesadilla|aceite|prensado|preparad/i.test(text) && !/bistec|comal|duro|charr/i.test(text))
    return {
      actions: [{
        type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 2,
        modifiers: [
          { step: "(QD) Style", option: "(QD) DELUXE Preparada" },
          { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" },
        ],
        readback: "2 QD deluxe prensado",
      }],
      reply: "2 Deluxe",
    };
  if (/bistec|comal|duro|charr|prensado/i.test(text))
    return {
      actions: [{
        type: "add_item", itemId: QCO, quantity: 2,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "2 QCO bistec",
      }],
      reply: "2 QCO",
    };
  return { actions: [], reply: "?" };
};

test("ca0d0e12: 3 CON + 3 QD Deluxe prensado + 2 QCO bistec + 2 QCO duro; no torta; DELIVERY", async () => {
  const r: any = await shadowOrderFromTurns(turns.map((t: any) => ({ ...t })), stubLiveMiss as any);
  const lines = r.cart.map((l: any) => ({
    q: l.quantity,
    id: String(l.itemId),
    mods: (l.modifiers || []).map((m: any) => m.option),
  }));
  const con = r.cart.filter((l: any) => String(l.itemId) === CON);
  const conQty = con.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  assert.equal(conQty, 3, `CON qty: ${JSON.stringify(lines)}`);

  const qd = r.cart.filter((l: any) => /dorada|zzav3l/i.test(String(l.itemId)));
  const qdN = qd.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  assert.equal(qdN, 3, `QD qty: ${JSON.stringify(lines)}`);
  assert.ok(qd.every((l: any) =>
    (l.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(m.option))
    && (l.modifiers || []).some((m: any) => /Prensado/i.test(m.option))), JSON.stringify(lines));

  const qco = r.cart.filter((l: any) => String(l.itemId) === QCO || (/quesadilla/i.test(String(l.itemId)) && !/dorada|zzav3l|t5stuh/i.test(String(l.itemId))));
  const bistec = qco.filter((l: any) => (l.modifiers || []).some((m: any) => /Bistec/i.test(m.option)));
  const duro = qco.filter((l: any) => (l.modifiers || []).some((m: any) => /Duro|Pork Rinds/i.test(m.option)));
  const bN = bistec.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  const dN = duro.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  assert.equal(bN, 2, `QCO bistec: ${JSON.stringify(lines)}`);
  assert.equal(dN, 2, `QCO duro: ${JSON.stringify(lines)}`);

  assert.ok(!r.cart.some((l: any) => /torta/i.test(String(l.itemId))), "no phantom torta: " + JSON.stringify(lines));
  assert.equal(r.fulfillment, "DELIVERY", "fulfillment DELIVERY from ¿me lo trae?");
});
