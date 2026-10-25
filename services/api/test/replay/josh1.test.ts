// josh1 (CAaaa9a26dbc8636f00660e80eff4f1d75 ~6:54 PM ET Oct 25): English pickup.
// Auditor: "dosa/dos/two comal quesadillas, steak and rice" → qty 2 QCO bistec + Con Arroz.
// Live miss: qty 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T18:54:00-04:00";
const { shadowOrderFromTurns, spokenCount, rewriteCallerText } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAaaa9a2-turns.json", import.meta.url), "utf8"));
const QCO = "sq-quesadilla-HLT6CR";

const stubLiveMiss = async (text: string) => {
  if (/quesadilla|comal|steak|rice|dosa|dos/i.test(text)) {
    return {
      reply: "1 comal quesadilla steak rice",
      actions: [{
        type: "add_item", itemId: QCO, quantity: 1,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
          { step: "(C) Con / With", option: "**Con Arroz / With Rice (+$0.50)" },
        ],
      }],
    };
  }
  return { reply: "", actions: [] };
};

test("josh1: dosa ASR → dos / spokenCount 2", () => {
  assert.equal(spokenCount("dosa"), 2);
  assert.match(rewriteCallerText("gonna get dosa, comal, quesadillas"), /\bdos\b/i);
});

test("josh1: name Josh", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info);
  assert.match(info!.name, /^Josh$/i);
});

test("josh1: 2× QCO bistec con arroz (not qty 1)", async () => {
  const r = await shadowOrderFromTurns(turns as any, stubLiveMiss);
  const q = r.cart.filter((l: any) => /quesadilla/i.test(l.itemId) && !/dorada/i.test(l.itemId));
  const qty = q.reduce((a: number, l: any) => a + (l.quantity || 1), 0);
  assert.equal(qty, 2, "qty 2: " + JSON.stringify(r.cart));
  assert.ok(q.every((l: any) => (l.modifiers || []).some((m: any) => /bistec|steak/i.test(String(m.option)))), "bistec");
  assert.ok(q.every((l: any) => (l.modifiers || []).some((m: any) => /arroz|rice/i.test(String(m.option)))), "con arroz");
  assert.ok(q.every((l: any) => (l.modifiers || []).some((m: any) => /QCO|comal|homemade/i.test(String(m.option)))), "comal");
});
