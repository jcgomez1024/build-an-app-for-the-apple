// rodrigo1 (CA99492106 ~3:51 PM ET Oct 25): desk Spanish pickup.
// Square FDybJp… $21.75 = Nachos Elvis pollo + frijoles/pinto + lechuga + crema + pico + queso fresco + queso dip
// + ONE QD DELUXE Preparada buche. Name Rodrigo OK.
// Live miss: incomplete nachos (Pico+Frijoles Refritos); phantom QCO buche; Con Frijoles+APARTE on dorada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T15:51:00-04:00";
const { shadowOrderFromTurns, DORADA_DELUXE_ID, DORADA_REG_ID } = await import("../../src/call-scoring.ts");
const { nameFromAnswer, nameFromTranscript } = await import("../../src/order-name.ts");

const NACHOS = "sq-nachos-elvis-ZMX4IH";
const Q = "sq-quesadilla-HLT6CR";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA99492106-turns.json", import.meta.url), "utf8"));

test("rodrigo1: name is Rodrigo", () => {
  assert.equal(nameFromAnswer("De Rodrigo."), "Rodrigo");
  const n = nameFromTranscript(turns as any);
  assert.ok(n && /^rodrigo$/i.test(n), "name Rodrigo: " + n);
});

/** Reproduce live wrongs so end-rebuild / mid fixes must win. */
const stubLiveMiss = async (text: string) => {
  if (/nachos/i.test(text) && /pollo/i.test(text))
    return { reply: "Nachos Elvis: ¿Frijoles, Lechuga, Pico de Gallo o Crema?", actions: [] };
  if (/Frijoles, Lechuga, Pico de Gallo, Crema/i.test(text))
    return {
      reply: "Nachos Elvis: pico de gallo, frijoles refritos. $14.99. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: NACHOS, quantity: 1,
        modifiers: [
          { step: "(B) Nachos Options", option: "Pico de Gallo" },
          { step: "(A) Nachos Carne Options", option: "Frijoles Refritos / Refried Beans" },
        ],
      }],
    };
  if (/quesadilla/i.test(text) && /buche/i.test(text) && !/dorad/i.test(text))
    return { reply: "Quesadilla: ¿Quesadilla Comal, Quesadilla Harina o Quesadilla Taquera?", actions: [] };
  if (/Quesadilla Comal|Comal/i.test(text) && !/dorad|aceite/i.test(text))
    return {
      reply: "Quesadilla: comal, buche, salsa asada. $5.00. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: Q, quantity: 1,
        modifiers: [
          { step: "(B) Q Carnes / Meats", option: "Buche / Pork Stomach (+$0.50)" },
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
        ],
      }],
    };
  if (/dorad/i.test(text))
    return {
      reply: "Quesadilla: comal, buche y frijoles. $6.25. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 1,
        modifiers: [
          { step: "(QD) Style", option: "(QD) DELUXE Preparada" },
          { step: "(B) Q Carnes / Meats", option: "Buche / Pork Stomach (+$0.50)" },
          { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" },
          { step: "(C) QA Dorada Extras", option: "DELUXE ***APARTE / EVERTHING ON SIDE*** (+$1.50)" },
        ],
      }],
    };
  return { reply: "¿Algo más?", actions: [] };
};

test("rodrigo1: Nachos Elvis full toppings (pinto not refritos) + 1 QD DELUXE buche, no QCO/APARTE/Con Frijoles", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
  const nacho = r.cart.find((l: any) => /nachos/i.test(String(l.itemId)));
  assert.ok(nacho, "nachos present: " + JSON.stringify(r.cart.map((l: any) => l.itemId)));
  assert.match(opts(nacho), /Pollo/i, "pollo meat: " + opts(nacho));
  assert.match(opts(nacho), /Frijoles \/ Pinto Beans/i, "pinto beans: " + opts(nacho));
  assert.doesNotMatch(opts(nacho), /Frijoles Refritos/i, "not refritos carne: " + opts(nacho));
  assert.match(opts(nacho), /Lechuga/i);
  assert.match(opts(nacho), /Crema/i);
  assert.match(opts(nacho), /Pico de Gallo/i);
  assert.match(opts(nacho), /Queso Fresco/i);
  assert.match(opts(nacho), /Queso Dip/i);
  const qd = r.cart.filter((l: any) => l.itemId === DORADA_DELUXE_ID || l.itemId === DORADA_REG_ID);
  assert.equal(qd.length, 1, "exactly one QD: " + JSON.stringify(qd.map((l: any) => l.itemId + ":" + opts(l))));
  assert.equal(qd[0].itemId, DORADA_DELUXE_ID);
  assert.match(opts(qd[0]), /Buche/i);
  assert.match(opts(qd[0]), /DELUXE Preparada/i);
  assert.doesNotMatch(opts(qd[0]), /APARTE/i, "no APARTE: " + opts(qd[0]));
  assert.doesNotMatch(opts(qd[0]), /Con Frijoles/i, "no Con Frijoles: " + opts(qd[0]));
  assert.ok(!r.cart.some((l: any) => /quesadilla/i.test(String(l.itemId)) && l.itemId !== DORADA_DELUXE_ID && l.itemId !== DORADA_REG_ID),
    "no phantom QCO: " + JSON.stringify(r.cart.map((l: any) => l.itemId)));
});
