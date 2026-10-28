// ca11603f (CA11603f18d854e09a509fae140124d444 ~10:51 AM ET Oct 28): desk Spanish pickup ~92s, Lupita 11:30.
// Auditor: 10 QCO = 3 pastor + 1 prensado+frijoles + 1 asada + 3 prensado + 2 asada.
// Live miss: pastor×6 (re-add on "aparte vienen otras"/"falta otro pedazo"); frijoles on bistec;
// asada qty 1; phantom Side Frijoles; order_name Dígame from staff vocative; Tortillas pack loop on QCO.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-28T10:51:00-04:00";
const { shadowOrderFromTurns, listedMeats } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo, nameFromStaffVocative, nameFromAnswer } = await import("../../src/order-name.ts");
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA11603f-turns.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR";
const SIDE_BEANS = "sq-sides-frijoles-beans-FK2O6W";

const meatOf = (l: any) => (l.modifiers || []).find((m: any) => /Carnes|Meats/i.test(String(m.step)))?.option || "";
const hasFrij = (l: any) => (l.modifiers || []).some((m: any) => /Con Frijoles|With Beans/i.test(String(m.option)));
const isQco = (l: any) => (l.modifiers || []).some((m: any) => /\(QCO\)/i.test(String(m.option)));

/** Stub: returns wrong cart pieces that scoring must correct (double pastor, frijoles on bistec, qty1 asada, side beans). */
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/aparte vienen otras|falta.*otro pedazo/.test(t)) {
    // live bug: model re-adds 3 pastor on continuation cues
    return {
      reply: "Ok. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: Q, quantity: 3,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" },
        ],
        readback: "3 QCO pastor (phantom re-add)",
      }],
    };
  }
  if (/tres quesadillas.*pastor|al pastor.*comal/.test(t)) {
    return {
      reply: "3 al pastor comal. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: Q, quantity: 3,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" },
        ],
        readback: "3 QCO al pastor",
      }],
    };
  }
  if (/prensado.*frijoles|frijoles.*asada|dos mas quesadillas/.test(t)) {
    // live bug: frijoles on bistec, prensado plain
    return {
      reply: "Prensado y asada. ¿Algo más?",
      actions: [
        {
          type: "add_item", itemId: Q, quantity: 1,
          modifiers: [
            { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
            { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" },
          ],
          readback: "1 QCO prensado plain (bug)",
        },
        {
          type: "add_item", itemId: Q, quantity: 1,
          modifiers: [
            { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
            { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" },
            { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
          ],
          readback: "1 QCO bistec+frijoles (bug)",
        },
        // phantom side
        { type: "add_item", itemId: SIDE_BEANS, quantity: 1, modifiers: [], readback: "side beans (phantom)" },
      ],
    };
  }
  if (/tres de chicharron prensado|tres de.*prensado/.test(t)) {
    return {
      reply: "3 prensado. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: Q, quantity: 3,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" },
        ],
        readback: "3 QCO prensado",
      }],
    };
  }
  if (/dos del|dos.*asada|asada.*comal igual/.test(t)) {
    // live bug: qty 1
    return {
      reply: "1 asada. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: Q, quantity: 1,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "1 QCO asada (bug qty)",
      }],
    };
  }
  if (/bye|gracias|seria todo/.test(t)) {
    // live bug: Tortillas pack loop after QCO settled
    return {
      reply: "Tortillas: ¿6 x Tortilla Taquera, 6 x Tortilla de Harina o 6 x Tortilla Comal?",
      actions: [],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("ca11603f: Dígame vocative blocked; A Lupita from staff ask", () => {
  assert.equal(nameFromAnswer("A Lupita"), "Lupita");
  assert.equal(nameFromAnswer("A Lupita, y si puedo pasar por ellas a las once y media."), "Lupita");
  const voc = nameFromStaffVocative(turns as any);
  assert.ok(!voc || !/d[ií]game/i.test(voc), "vocative must not be Dígame, got: " + voc);
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "expected name info");
  assert.equal(info!.name, "Lupita");
  assert.equal(info!.source, "staff-ask");
});

test("ca11603f: listedMeats gets qty 2 from 'dos del, eh, asada'", () => {
  const meats = listedMeats("Y ya esta es otra orden, son dos del, eh, asada, al comal igual.");
  const asada = meats.find((m) => /asada|bistec|steak/i.test(m.meat));
  assert.ok(asada, "asada listed: " + JSON.stringify(meats));
  assert.equal(asada!.qty, 2);
});

test("ca11603f: 10 QCO split — frijoles on prensado, no phantom side, pastor×3, asada×3 total", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const dump = JSON.stringify(r.cart.map((l: any) => ({
    id: l.itemId, q: l.quantity, meat: meatOf(l), frij: hasFrij(l), qco: isQco(l),
  })));

  assert.ok(!r.cart.some((l: any) => /sides-frijoles|FK2O6W/i.test(String(l.itemId))), "no Side Frijoles: " + dump);

  const qcos = r.cart.filter((l: any) => /^sq-quesadilla-/i.test(String(l.itemId)));
  const total = qcos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(total, 10, "10 QCO total: " + dump);
  assert.ok(qcos.every(isQco), "all QCO: " + dump);

  const pastorQty = qcos.filter((l: any) => /pastor/i.test(meatOf(l))).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(pastorQty, 3, "pastor×3 not 6: " + dump);

  const prensFrij = qcos.filter((l: any) => /prensado/i.test(meatOf(l)) && hasFrij(l));
  assert.equal(prensFrij.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, "1 prensado+frijoles: " + dump);

  const prensPlain = qcos.filter((l: any) => /prensado/i.test(meatOf(l)) && !hasFrij(l));
  assert.equal(prensPlain.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 3, "3 plain prensado: " + dump);

  const bistecFrij = qcos.filter((l: any) => /bistec|steak/i.test(meatOf(l)) && hasFrij(l));
  assert.equal(bistecFrij.length, 0, "no frijoles on bistec: " + dump);

  const asadaQty = qcos.filter((l: any) => /bistec|steak|asada/i.test(meatOf(l))).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(asadaQty, 3, "asada total 1+2=3: " + dump);

  // Tortillas pack loop must not invent pack SKUs after QCO settled
  assert.ok(!r.cart.some((l: any) => /tortillas?-?\d|x-tortilla/i.test(String(l.itemId))), "no tortilla pack SKU: " + dump);
});
