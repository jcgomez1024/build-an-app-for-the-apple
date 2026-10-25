// david1 (CA775ab720 ~4:57 PM ET Oct 25): desk Spanish, 4-pedido comal quesadilla call.
// Correct: 3 bistec + 3 tripa + 2 pastor + 1 bistec + 2 pastor + 1 tripa = 12 QCO
// + Extras Cebolla y Chiles Asados. No dual-meat singles, no meatless, total 12 not 13.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T16:57:00-04:00";
const { shadowOrderFromTurns, EXTRAS_ID } = await import("../../src/call-scoring.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA775ab720-turns.json", import.meta.url), "utf8"));
const QCO = "sq-quesadilla-HLT6CR";

/** Reproduce live wrongs: duplicate 3-tripa, dual-meat singles, meatless lines, total 13. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  const TORT = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
  // Pedido 1 "tres de bistec" wrongly captured as 3 tripa (live miss)
  if (/primer|tres de bistec|tres de viste/.test(t) || (/bistec|viste/.test(t) && /tres|3/.test(t) && !/pastor|tripa/.test(t))) {
    return {
      reply: "3 quesadillas tripa. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: QCO, quantity: 3,
        modifiers: [TORT, { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe (+$0.50)" }],
        readback: "3 QCO tripa",
      }],
    };
  }
  if (/tripa/.test(t) && /tres|3|son tres/.test(t)) {
    return {
      reply: "3 quesadillas tripa. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: QCO, quantity: 3,
        modifiers: [TORT, { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe (+$0.50)" }],
      }],
    };
  }
  // Invented dual-meat single + meatless
  if (/pastor/.test(t) && /bistec|viste/.test(t)) {
    return {
      reply: "ok",
      actions: [
        {
          type: "add_item", itemId: QCO, quantity: 1,
          modifiers: [TORT,
            { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" },
            { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }],
        },
        { type: "add_item", itemId: QCO, quantity: 1, modifiers: [TORT] },
      ],
    };
  }
  if (/pastor/.test(t) && /tripa/.test(t)) {
    return {
      reply: "ok",
      actions: [
        {
          type: "add_item", itemId: QCO, quantity: 1,
          modifiers: [TORT,
            { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" },
            { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe" }],
        },
        { type: "add_item", itemId: QCO, quantity: 1, modifiers: [TORT] },
      ],
    };
  }
  if (/ceboll|chilit|chiles?\s+asados|asados/.test(t)) {
    // Auditor: wrongly Mild Salsa Asada 2oz + modifier — stub that miss; rebuild must land Extras Cebolla
    return {
      reply: "salsa",
      actions: [{
        type: "add_item", itemId: EXTRAS_ID, quantity: 1,
        modifiers: [{ step: "Extras options", option: "Mild Salsa Asada" }],
      }],
    };
  }
  if (/quesadilla|comal|pedido|orden/.test(t)) {
    return {
      reply: "Quesadilla Comal. ¿Algo más?",
      actions: [{ type: "add_item", itemId: QCO, quantity: 1, modifiers: [TORT] }],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("david1: 12 QCO = 4 bistec + 4 tripa + 4 pastor; Extras Cebolla; no dual-meat/meatless", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
  const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option))
    .filter((o: string) => /Bistec|Tripa|Pastor|Alpastor|Chorizo|Pollo|Prensado/i.test(o) && !/salsa/i.test(o));

  const qcos = r.cart.filter((l: any) => /quesadilla-HLT6CR|quesadilla/i.test(String(l.itemId)) && !/dorada/i.test(String(l.itemId)));
  const qTotal = qcos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qTotal, 12, "12 QCO: " + JSON.stringify(qcos.map((l: any) => ({ q: l.quantity, m: meatOf(l), o: opts(l) }))));

  const countMeat = (re: RegExp) => qcos.reduce((n: number, l: any) => {
    const ms = meatOf(l);
    if (!ms.some((m: string) => re.test(m))) return n;
    // dual-meat line would overcount — assert none below
    return n + (Number(l.quantity) || 1);
  }, 0);
  assert.equal(countMeat(/Bistec/i), 4, "4 bistec");
  assert.equal(countMeat(/Tripa/i), 4, "4 tripa");
  assert.equal(countMeat(/Pastor|Alpastor/i), 4, "4 pastor");

  assert.ok(qcos.every((l: any) => meatOf(l).length === 1), "no dual-meat / no meatless: " + JSON.stringify(qcos.map((l: any) => meatOf(l))));
  assert.ok(qcos.every((l: any) => /QCO|Comal|Homemade/i.test(opts(l))), "all comal");

  const extras = r.cart.filter((l: any) => String(l.itemId) === EXTRAS_ID || /extras-mild-salsa/i.test(String(l.itemId)));
  assert.ok(extras.length >= 1, "extras present: " + JSON.stringify(r.cart.map((l: any) => l.itemId)));
  assert.ok(extras.some((l: any) => /Cebolla y Chiles Asados/i.test(opts(l))), "Cebolla y Chiles Asados: " + extras.map(opts).join(" || "));
  // Should not be bare Mild Salsa Asada without Cebolla option as the cebolla substitute
  assert.ok(!extras.every((l: any) => /^Mild Salsa Asada$/i.test(opts(l).trim()) || opts(l) === "Mild Salsa Asada"),
    "not bare Mild Salsa as cebolla: " + extras.map(opts).join(" || "));
});
