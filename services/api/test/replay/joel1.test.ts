// joel1 (CA8a240fcfedf00772999cb9b73b3b8a19 ~8:04 PM ET Oct 25): desk Spanish+English pickup, 135s.
// Square dBzJUEeU…: 1 torta lengua DELUXE + 1 QCO lengua deluxe + 6 TST lengua + 2 horchata 32oz + side rice + side beans.
// Name Joel (spelled J O E L); Square ticket Joy = ASR noise; staff mis-repeat Joey/Jane. callers.json Naydelin untouched.
// Live miss: torta no DELUXE; 6 TCO≠TST; phantom 2 TST arroz/frijoles + 2 enchiladas frijol; name Joey.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T20:04:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const {
  nameFromTranscriptInfo, nameFromAnswer, nameFromSpelledLetters, nameFromStaffAsk,
} = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA8a240f-turns.json", import.meta.url), "utf8"));
const TOR = "sq-torta-4GNTTE";
const Q = "sq-quesadilla-HLT6CR";
const TACO = "sq-taco-TAR7L5";
const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
const SIDE_RICE = "sq-sides-arroz-rice-26S6E6";
const SIDE_BEANS = "sq-sides-frijoles-beans-FK2O6W";
const ENCH = "sq-enchiladas-orden-de-enchiladas-6-6QOYJ5";

/** Reproduce live wrongs: torta no deluxe; 6 TCO; phantom TST sides + enchiladas; keep QCO/horchata/sides. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/torta|deluxe torta|lengua/.test(t) && /torta/.test(t) && !/quesadilla|taco|horchata|side/.test(t)) {
    return {
      reply: "Torta lengua. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TOR, quantity: 1,
        modifiers: [
          { step: "(A) Torta Options", option: "(TO) Torta" },
          { step: "(B) Torta Carne Options", option: "Lengua / Beef Tongue (+$0.50)" },
        ],
      }],
    };
  }
  if (/quesadilla/.test(t)) {
    return {
      reply: "Quesadilla comal deluxe.",
      actions: [{
        type: "add_item", itemId: Q, quantity: 1,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
          { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue (+$0.50)" },
          { step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" },
        ],
      }],
    };
  }
  if (/seis tacos|tacos de lengua|street|homemade/.test(t)) {
    return {
      reply: "6 taco comal lengua.",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 6,
        modifiers: [
          { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" },
          { step: "(B) T Carnes / Meats Opciones", option: "Lengua / Beef Tongue (+$0.50)" },
        ],
      }],
    };
  }
  if (/horchata/.test(t)) {
    return {
      reply: "2 horchata.",
      actions: [{ type: "add_item", itemId: HORCH, quantity: 2, modifiers: [] }],
    };
  }
  if (/side of rice|side of beans|side of rice and then a side of beans/.test(t)) {
    return {
      reply: "Tacos with rice and beans. Enchiladas?",
      actions: [
        {
          type: "add_item", itemId: TACO, quantity: 2,
          modifiers: [
            { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" },
            { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" },
            { step: "(B) T Carnes / Meats Opciones", option: "Arroz / Rice" },
          ],
        },
        {
          type: "add_item", itemId: ENCH, quantity: 2,
          modifiers: [{ step: "(A) Enchiladas Carne Options (ONLINE)", option: "Frijol / Beans" }],
        },
        { type: "add_item", itemId: SIDE_RICE, quantity: 1, modifiers: [], readback: "side rice" },
        { type: "add_item", itemId: SIDE_BEANS, quantity: 1, modifiers: [], readback: "side beans" },
      ],
    };
  }
  return { reply: "", actions: [] };
};

test("joel1: spelled J O E L → Joel (beats Joey/Jane)", () => {
  assert.equal(nameFromSpelledLetters("J O E L."), "Joel");
  assert.equal(nameFromSpelledLetters("J.O.E.L."), "Joel");
  assert.equal(nameFromAnswer("J O E L."), "Joel");
  assert.equal(nameFromAnswer("Joe."), "Joe");
  assert.equal(nameFromStaffAsk(turns as any), "Joel");
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.equal(info!.name, "Joel");
  assert.notEqual(info!.name, "Joey");
  assert.notEqual(info!.name, "Joy");
  assert.notEqual(info!.name, "Jane");
});

test("joel1: torta DELUXE + QCO deluxe + 6 TST lengua + 2 horchata + sides; no phantoms", async () => {
  const r = await shadowOrderFromTurns(turns as any, stubLiveMiss);
  assert.equal(r.fulfillment, "PICKUP");
  const ids = r.cart.map((l: any) => `${l.quantity}×${l.itemId}`);
  assert.ok(!r.cart.some((l: any) => /enchilada/i.test(String(l.itemId))), "no phantom enchiladas: " + ids.join(","));
  const torta = r.cart.find((l: any) => l.itemId === TOR);
  assert.ok(torta, "torta");
  assert.equal(torta.quantity, 1);
  const tOpts = (torta.modifiers || []).map((m: any) => String(m.option));
  assert.ok(tOpts.some((o) => /lengua/i.test(o)), "torta lengua");
  assert.ok(tOpts.some((o) => /\bDELUXE\b/i.test(o)), "torta DELUXE: " + tOpts.join("|"));
  const qco = r.cart.find((l: any) => l.itemId === Q);
  assert.ok(qco, "quesadilla");
  const qOpts = (qco.modifiers || []).map((m: any) => String(m.option));
  assert.ok(qOpts.some((o) => /\(QCO\)|Comal/i.test(o)), "QCO");
  assert.ok(qOpts.some((o) => /lengua/i.test(o)), "QCO lengua");
  assert.ok(qOpts.some((o) => /\bDELUXE\b/i.test(o)), "QCO DELUXE");
  const tacos = r.cart.filter((l: any) => l.itemId === TACO);
  assert.equal(tacos.length, 1, "one taco line: " + ids.join(","));
  assert.equal(tacos[0].quantity, 6);
  const tacoOpts = (tacos[0].modifiers || []).map((m: any) => String(m.option));
  assert.ok(tacoOpts.some((o) => /\(TST\)|Street|Taquero/i.test(o)), "TST street: " + tacoOpts.join("|"));
  assert.ok(!tacoOpts.some((o) => /\(TCO\)|Comal|Homemade/i.test(o)), "not TCO");
  assert.ok(tacoOpts.some((o) => /lengua/i.test(o)), "taco lengua");
  assert.ok(!tacoOpts.some((o) => /arroz|rice|frijol|bean/i.test(o)), "no rice/beans on tacos");
  const horch = r.cart.find((l: any) => l.itemId === HORCH);
  assert.ok(horch, "horchata");
  assert.equal(horch.quantity, 2);
  assert.ok(r.cart.some((l: any) => l.itemId === SIDE_RICE && l.quantity === 1), "side rice");
  assert.ok(r.cart.some((l: any) => l.itemId === SIDE_BEANS && l.quantity === 1), "side beans");
  assert.equal(r.cart.length, 6, "exact 6 lines: " + ids.join(","));
});
