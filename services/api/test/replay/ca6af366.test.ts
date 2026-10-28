// ca6af366 (CA6af366b27b2bb80685225560ebb502f6 ~1:12 PM ET Oct 28): desk Spanish pickup, Francisco.
// Auditor: 6 gorditas de comal = 2 prensado CON queso (QGD) + 2 bistec SIN queso + 2 nopales+papas SIN queso;
// plus 3 QCO maíz = 2 bistec + 1 deshebrada. Name Francisco OK.
// Live miss: QGD carried onto bistec/nopales; nopales qty 1; deshebrada missing from final cart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-28T13:12:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA6af366-turns.json", import.meta.url), "utf8"));
const GD = "sq-gordita-M647RE";
const Q = "sq-quesadilla-HLT6CR";

const meatOf = (l: any) => (l.modifiers || []).find((m: any) => /Carnes|Meats/i.test(String(m.step)))?.option || "";
const isQgd = (l: any) => (l.modifiers || []).some((m: any) => /\(QGD\)/i.test(String(m.option)));
const isGd = (l: any) => (l.modifiers || []).some((m: any) => /\(GD\)\s*Gordita/i.test(String(m.option)) && !/\(QGD\)/i.test(String(m.option)));
const isQco = (l: any) => (l.modifiers || []).some((m: any) => /\(QCO\)/i.test(String(m.option)));

/** Stub: reproduces live wrongs — QGD on all gorditas, nopales qty 1, deshebrada add then dropped by buggy path. */
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/seis gorditas|van a ser seis/.test(t)) {
    return { reply: "Gordita: ¿de qué?", actions: [] };
  }
  if (/prensado/.test(t) && /dos|2/.test(t)) {
    return {
      reply: "2 prensado. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: GD, quantity: 2,
        modifiers: [
          { step: "(A) Gordita Options", option: "(QGD) Queso Gordita (+$0.50)" },
          { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" },
        ],
        readback: "2 QGD prensado",
      }],
    };
  }
  if (/con queso/.test(t) && !/sin queso/.test(t)) {
    return { reply: "Con queso. ¿Algo más?", actions: [] };
  }
  if (/dos de bistec|bistec.*sin queso|esas sin queso/.test(t)) {
    // live bug: keep QGD and dual-meat merge
    return {
      reply: "6 × Gordita queso. ¿Algo más?",
      actions: [{
        type: "update_item", itemId: GD,
        modifiers: [
          { step: "(A) Gordita Options", option: "(QGD) Queso Gordita (+$0.50)" },
          { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
      }],
    };
  }
  if (/nopales|papas con nopales/.test(t)) {
    return {
      reply: "Nopales. ¿Algo más?",
      actions: [{
        type: "update_item", itemId: GD,
        modifiers: [
          { step: "(A) Gordita Options", option: "(QGD) Queso Gordita (+$0.50)" },
          { step: "(B) Q Carnes / Meats", option: "Nopales con Papas / Cacti with Potatoes" },
        ],
      }],
    };
  }
  if (/dos tambien/.test(t)) {
    // live bug: no qty bump
    return { reply: "Muy bien. ¿Algo más?", actions: [] };
  }
  if (/sin queso esas|no,?\s*sin queso/.test(t)) {
    // live bug: not applied (still QGD)
    return { reply: "Ok. ¿Algo más?", actions: [] };
  }
  if (/tres quesadillas|tortilla de (?:maiz|comal)|quesadillas de tortilla/.test(t)) {
    return { reply: "Comal. ¿De qué?", actions: [] };
  }
  if (/dos de bistec|van a ser dos de bistec|2 quesadilla.*bistec/.test(t) && /quesadilla|bistec/.test(t)) {
    return {
      reply: "2 QCO bistec. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: Q, quantity: 2,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "2 QCO bistec",
      }],
    };
  }
  if (/deshebrada/.test(t)) {
    // live: add_item logged but final cart dropped it
    return {
      reply: "1 QCO deshebrada. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: Q, quantity: 1,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: "Deshebrada / Shredded Beef with Potatoes" },
        ],
        readback: "1 QCO deshebrada",
      }],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("ca6af366: name Francisco OK", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.equal(info!.name, "Francisco");
});

test("ca6af366: 2 QGD prensado + 2 GD bistec + 2 GD nopales + 2 QCO bistec + 1 QCO deshebrada", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const dump = JSON.stringify(r.cart.map((l: any) => ({
    id: l.itemId, q: l.quantity, meat: meatOf(l), qgd: isQgd(l), gd: isGd(l), qco: isQco(l), notes: l.elviNotes,
  })));

  const gds = r.cart.filter((l: any) => /^sq-gordita-/i.test(String(l.itemId)));
  const qcos = r.cart.filter((l: any) => /^sq-quesadilla-/i.test(String(l.itemId)));

  const gdTotal = gds.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(gdTotal, 6, "6 gorditas: " + dump);

  const prens = gds.filter((l: any) => /prensado/i.test(meatOf(l)));
  assert.equal(prens.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2, "2 prensado: " + dump);
  assert.ok(prens.every(isQgd), "prensado CON queso (QGD): " + dump);

  const bistecGd = gds.filter((l: any) => /bistec|steak/i.test(meatOf(l)));
  assert.equal(bistecGd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2, "2 bistec gordita: " + dump);
  assert.ok(bistecGd.every((l: any) => !isQgd(l)), "bistec SIN queso (not QGD): " + dump);

  const nopales = gds.filter((l: any) => /nopales/i.test(meatOf(l)));
  assert.equal(nopales.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2, "2 nopales: " + dump);
  assert.ok(nopales.every((l: any) => !isQgd(l)), "nopales SIN queso: " + dump);

  const qcoTotal = qcos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qcoTotal, 3, "3 QCO: " + dump);
  assert.ok(qcos.every(isQco), "all QCO: " + dump);

  const qcoBist = qcos.filter((l: any) => /bistec|steak/i.test(meatOf(l)));
  assert.equal(qcoBist.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2, "2 QCO bistec: " + dump);

  const desh = qcos.filter((l: any) => /deshebrada/i.test(meatOf(l)));
  assert.equal(desh.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, "1 QCO deshebrada (not dropped): " + dump);

  assert.ok(!r.cart.some((l: any) => /sides-|FK2O6W|frijoles-beans/i.test(String(l.itemId))), "no phantom sides: " + dump);
});
