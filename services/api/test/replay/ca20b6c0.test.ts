// ca20b6c0 (CA20b6c02bcfb35fa3d5fab67e8bcf374e ~4:25 PM ET Oct 28): desk Spanish pickup, Carlos.
// Auditor: 1 torta lengua (normal) + 1 QCO maíz costilla. Name Carlos (orden para Carlos / pickupOnly).
// Live miss: add_item torta logged then final cart EMPTY; costilla not recognized (kept asking
// Bistec/Cabeza/Carnitas/Chorizo); order_name Carlos missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-28T16:25:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo, thirdPersonName, nameFromAnswer } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA20b6c0-turns.json", import.meta.url), "utf8"));
const TOR = "sq-torta-4GNTTE";
const Q = "sq-quesadilla-HLT6CR";

const meatOf = (l: any) => (l.modifiers || []).find((m: any) => /Carnes|Meats|Carne/i.test(String(m.step)))?.option || "";
const isQco = (l: any) => (l.modifiers || []).some((m: any) => /\(QCO\)/i.test(String(m.option)));

/** Stub: reproduces live wrongs — torta add_item then cart wiped; costilla ignored with short meat re-ask. */
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/torta.*lengua|lengua.*torta|una torta de lengua/.test(t)) {
    // live: add_item logged ("Torta: lengua…") but never reached final cart
    return {
      reply: "Torta: lengua, salsa asada. $5.25. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TOR, quantity: 1,
        modifiers: [
          { step: "(A) Torta Options", option: "(TO) Torta" },
          { step: "(B) Torta Carne Options", option: "Lengua / Beef Tongue (+$0.50)" },
        ],
        readback: "1 torta lengua",
      }],
    };
  }
  if (/normal/.test(t) && !/quesadilla|costilla/.test(t)) {
    return { reply: "Normal. ¿Algo más?", actions: [] };
  }
  if (/quesadilla|costilla|maiz|comal/.test(t)) {
    // live bug: costilla not in short meat list → re-ask forever
    return {
      reply: "Quesadilla: ¿Bistec, Cabeza, Carnitas o Chorizo?",
      actions: [],
    };
  }
  if (/es todo|asi esta bien|gracias/.test(t)) {
    return {
      reply: "Quesadilla: ¿Bistec, Cabeza, Carnitas o Chorizo?",
      actions: [],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("ca20b6c0: orden para Carlos → name Carlos pickupOnly", () => {
  assert.equal(thirdPersonName("Buenas tardes, ¿puedo aportar una orden para Carlos?"), "Carlos");
  assert.equal(nameFromAnswer("Buenas tardes, ¿puedo aportar una orden para Carlos?"), "Carlos");
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.equal(info!.name, "Carlos");
  assert.equal(info!.thirdPerson, true, "pickupOnly / for-X class");
  assert.equal(info!.source, "volunteer");
});

test("ca20b6c0: 1 torta lengua + 1 QCO costilla (cart not empty)", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const dump = JSON.stringify(r.cart.map((l: any) => ({
    id: l.itemId, q: l.quantity, meat: meatOf(l), qco: isQco(l),
  })));

  assert.ok(r.cart.length > 0, "cart must NOT be empty: " + dump);

  const tortas = r.cart.filter((l: any) => /^sq-torta-/i.test(String(l.itemId)));
  assert.equal(tortas.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, "1 torta: " + dump);
  assert.ok(tortas.every((l: any) => /lengua/i.test(meatOf(l))), "torta lengua: " + dump);

  const qcos = r.cart.filter((l: any) => /^sq-quesadilla-/i.test(String(l.itemId)));
  assert.equal(qcos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, "1 QCO: " + dump);
  assert.ok(qcos.every(isQco), "QCO style: " + dump);
  assert.ok(qcos.every((l: any) => /costilla/i.test(meatOf(l))), "costilla filling accepted (no short-list re-ask): " + dump);

  assert.equal(r.fulfillment, "PICKUP", "pickup: " + dump);
  assert.ok(!r.cart.some((l: any) => /sides-|FK2O6W|frijoles-beans/i.test(String(l.itemId))), "no phantom sides: " + dump);
});
