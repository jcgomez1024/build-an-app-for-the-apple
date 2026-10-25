// edgar1 (CAe6bd82f414354649a762ff25d0ed2481 ~1:28 PM ET Oct 25): desk Spanish pickup.
// Square $44.75 Edgar = 1 burrito grande bistec DELUXE + 1 burrito Regular chorizo DELUXE
// + 2 TCO tripa + 1 QD Deluxe prensado + 1 QHR lengua + 1 QHR costilla.
// Live miss: burritos missing DELUXE; phantom 2nd grande; QD meatless; phantom QD REG + QCO instead of QHR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T13:28:00-04:00";
const { shadowOrderFromTurns, DORADA_DELUXE_ID, DORADA_REG_ID } = await import("../../src/call-scoring.ts");
const { nameFromTranscript, nameFromAnswer } = await import("../../src/order-name.ts");

const BUR = "sq-burrito-TGWBEN";
const TCO = "sq-taco-comal-homemade-corn-tortilla-taco-comal-U6KZVH";
const Q = "sq-quesadilla-HLT6CR";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CAe6bd82-turns.json", import.meta.url), "utf8"));

test("edgar1: name is Edgar", () => {
  assert.equal(nameFromAnswer("Edgar"), "Edgar");
  const n = nameFromTranscript(turns as any);
  assert.ok(n && /^edgar$/i.test(n), "name Edgar: " + n);
});

/** Reproduce live wrongs so end-rebuild must win. */
const stubLiveMiss = async (text: string) => {
  if (/burrito/i.test(text) && /bistec/i.test(text))
    return {
      actions: [{
        type: "add_item", itemId: BUR, quantity: 1,
        modifiers: [
          { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" },
          { step: "(B) Burrito Carne Options", option: "Bistec / Steak" },
        ],
        readback: "burrito grande bistec",
      }],
      reply: "Burrito grande",
    };
  if (/burrito/i.test(text) && /chorizo/i.test(text))
    return {
      actions: [{
        type: "add_item", itemId: BUR, quantity: 1,
        modifiers: [
          { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" },
          { step: "(B) Burrito Carne Options", option: "Chorizo / Mexican Sausage" },
          { step: "(B) Burrito Carne Options", option: "Bistec / Steak" },
        ],
        readback: "burrito grande chorizo bistec",
      }],
      reply: "Burrito",
    };
  if (/^\W*(?:chico|regular)\W*$/iu.test(text))
    return {
      actions: [{
        type: "add_item", itemId: BUR, quantity: 1,
        modifiers: [
          { step: "(A) Burrito Size", option: "Regular '10" },
          { step: "(B) Burrito Carne Options", option: "Chorizo / Mexican Sausage" },
        ],
        readback: "burrito chico chorizo",
      }],
      reply: "Chico",
    };
  if (/taco|tripa/i.test(text) && !/quesadilla|burrito/i.test(text))
    return {
      actions: [{
        type: "add_item", itemId: TCO, quantity: 2,
        modifiers: [
          { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe" },
        ],
        readback: "2 taco comal tripa",
      }],
      reply: "2 TCO tripa",
    };
  if (/aceite|dorad|prensado|preparad/i.test(text) && !/costilla|lengua|harina|burrito|taco/i.test(text))
    return {
      actions: [{
        type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 1,
        modifiers: [
          { step: "(QD) Style", option: "(QD) DELUXE Preparada" },
          // live miss: meatless
        ],
        readback: "QD deluxe",
      }],
      reply: "Deluxe",
    };
  if (/costilla|lengua|harina|quesadillas?/i.test(text))
    return {
      actions: [
        {
          type: "add_item", itemId: DORADA_REG_ID, quantity: 1,
          modifiers: [
            { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
            { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" },
          ],
          readback: "QD REG costilla",
        },
        {
          type: "add_item", itemId: DORADA_REG_ID, quantity: 1,
          modifiers: [
            { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
            { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue" },
          ],
          readback: "QD REG lengua",
        },
        {
          type: "add_item", itemId: Q, quantity: 1,
          modifiers: [
            { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
            { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" },
          ],
          readback: "QCO costilla",
        },
        {
          type: "add_item", itemId: Q, quantity: 1,
          modifiers: [
            { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
            { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue" },
          ],
          readback: "QCO lengua",
        },
      ],
      reply: "quesadillas",
    };
  return { actions: [], reply: "?" };
};

test("edgar1: burrito grande bistec DELUXE + Regular chorizo DELUXE + 2 TCO tripa + QD Deluxe prensado + QHR lengua + QHR costilla", async () => {
  const r: any = await shadowOrderFromTurns(turns.map((t: any) => ({ ...t })), stubLiveMiss as any);
  const lines = r.cart.map((l: any) => ({
    q: l.quantity,
    id: String(l.itemId),
    mods: (l.modifiers || []).map((m: any) => m.option),
  }));

  const burs = r.cart.filter((l: any) => String(l.itemId) === BUR || /burrito/i.test(String(l.itemId)));
  assert.equal(burs.length, 2, `exactly 2 burritos (no phantom grande): ${JSON.stringify(lines)}`);

  const grande = burs.find((l: any) => (l.modifiers || []).some((m: any) => /Grande/i.test(m.option)));
  const chico = burs.find((l: any) => (l.modifiers || []).some((m: any) => /Regular/i.test(m.option)));
  assert.ok(grande, "grande burrito: " + JSON.stringify(lines));
  assert.ok(chico, "regular/chico burrito: " + JSON.stringify(lines));
  assert.ok((grande.modifiers || []).some((m: any) => /Bistec/i.test(m.option)), "grande = bistec");
  assert.ok((chico.modifiers || []).some((m: any) => /Chorizo/i.test(m.option)), "chico = chorizo");
  assert.ok((grande.modifiers || []).some((m: any) => /DELUXE/i.test(m.option)), "grande DELUXE");
  assert.ok((chico.modifiers || []).some((m: any) => /DELUXE/i.test(m.option)), "chico DELUXE");
  // no phantom mixed-meat grande
  assert.ok(!(grande.modifiers || []).some((m: any) => /Chorizo/i.test(m.option)), "grande not chorizo");
  assert.ok(!(chico.modifiers || []).some((m: any) => /Bistec/i.test(m.option)), "chico not bistec");

  const tco = r.cart.filter((l: any) => String(l.itemId) === TCO || (/taco/i.test(String(l.itemId)) && /comal|TCO|homemade/i.test(String(l.itemId) + (l.modifiers || []).map((m: any) => m.option).join(" "))));
  const tripaN = tco.filter((l: any) => (l.modifiers || []).some((m: any) => /Tripa/i.test(m.option)))
    .reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  assert.equal(tripaN, 2, `2 TCO tripa: ${JSON.stringify(lines)}`);

  const qd = r.cart.filter((l: any) => /dorada|zzav3l/i.test(String(l.itemId)));
  const qdN = qd.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  assert.equal(qdN, 1, `exactly 1 QD (no phantom REG): ${JSON.stringify(lines)}`);
  assert.ok(qd.every((l: any) =>
    (l.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(m.option))
    && (l.modifiers || []).some((m: any) => /Prensado/i.test(m.option))), "QD Deluxe prensado: " + JSON.stringify(lines));

  const qhr = r.cart.filter((l: any) =>
    (/quesadilla/i.test(String(l.itemId)) && !/dorada|zzav3l|t5stuh/i.test(String(l.itemId)))
    && (l.modifiers || []).some((m: any) => /QHR|Harina|Flour/i.test(m.option)));
  const lengua = qhr.filter((l: any) => (l.modifiers || []).some((m: any) => /Lengua/i.test(m.option)));
  const costilla = qhr.filter((l: any) => (l.modifiers || []).some((m: any) => /Costilla/i.test(m.option)));
  assert.equal(lengua.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0), 1, "1 QHR lengua: " + JSON.stringify(lines));
  assert.equal(costilla.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0), 1, "1 QHR costilla: " + JSON.stringify(lines));

  assert.ok(!r.cart.some((l: any) =>
    (/quesadilla/i.test(String(l.itemId)) && !/dorada|zzav3l|t5stuh/i.test(String(l.itemId)))
    && (l.modifiers || []).some((m: any) => /QCO|Comal|Homemade/i.test(m.option))
    && (l.modifiers || []).some((m: any) => /Lengua|Costilla/i.test(m.option))),
    "no QCO comal for lengua/costilla: " + JSON.stringify(lines));
  assert.ok(!r.cart.some((l: any) =>
    String(l.itemId) === DORADA_REG_ID || (/t5stuh/i.test(String(l.itemId)))),
    "no phantom QD REGULAR: " + JSON.stringify(lines));
});
