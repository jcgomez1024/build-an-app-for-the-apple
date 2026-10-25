// kevin1 (CA58ec0f1921ec3bbad826fec683db025f ~7:41 PM ET Oct 25): desk Spanish pickup, 125s.
// Square: 1 QTO lengua + 1 QHR bistec + 1 coca lata + 1 QST lengua. Name Kevin OK.
// Live miss: TST lengua + QHR lengua; missed QTO+coca; taco where QST; flour meat lengua≠bistec;
//   kept re-asking meat after Vitéz/bistec; aceite-out should switch to flour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T19:41:00-04:00";
const { shadowOrderFromTurns, rewriteCallerText } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA58ec0f-turns.json", import.meta.url), "utf8"));
const TOR = "sq-torta-4GNTTE";
const Q = "sq-quesadilla-HLT6CR";
const COCA = "sq-drink-coca-cola-JJE4KC";
const TACO = "sq-taco-TAR7L5";

/** Reproduce live wrongs: street taco lengua + flour QD lengua; no QTO/coca/QST. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/quesitort|quesitota|torta|lengua/.test(t) && !/harina|flour|taquer|coca|lata/.test(t)) {
    return {
      reply: "Taco. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 1,
        modifiers: [
          { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" },
          { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue" },
        ],
      }],
    };
  }
  if (/harina|flour|quesadilla|vit|bistec/.test(t)) {
    return {
      reply: "Quesadilla de harina. ¿De qué carne?",
      actions: [{
        type: "add_item", itemId: Q, quantity: 1,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" },
          { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue" },
        ],
      }],
    };
  }
  return { reply: "", actions: [] };
};

test("kevin1: ASR Vitéz/quesitota/sopa de lata", () => {
  assert.match(rewriteCallerText("Una quesadilla de Vitéz, pero de comal."), /bistec/i);
  assert.match(rewriteCallerText("una quesitota de lengua"), /quesitorta/i);
  assert.match(rewriteCallerText("Y una sopa de lata."), /coca de lata/i);
});

test("kevin1: name Kevin", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.match(info!.name, /^Kevin$/i);
});

test("kevin1: QTO lengua + QHR bistec + coca + QST lengua; no TST", async () => {
  const r = await shadowOrderFromTurns(turns as any, stubLiveMiss);
  const ids = r.cart.map((l: any) => `${l.quantity}×${l.itemId}`);
  assert.equal(r.fulfillment, "PICKUP");

  const qto = r.cart.filter((l: any) => /^sq-torta-/i.test(l.itemId));
  assert.equal(qto.length, 1, "one torta/QTO: " + ids.join(","));
  assert.ok((qto[0].modifiers || []).some((m: any) => /\(QTO\)/i.test(String(m.option))), "QTO");
  assert.ok((qto[0].modifiers || []).some((m: any) => /lengua/i.test(String(m.option))), "QTO lengua");

  const qds = r.cart.filter((l: any) => l.itemId === Q);
  assert.equal(qds.length, 2, "QHR + QST: " + ids.join(","));
  const qhr = qds.find((l: any) => (l.modifiers || []).some((m: any) => /\(QHR\)/i.test(String(m.option))));
  const qst = qds.find((l: any) => (l.modifiers || []).some((m: any) => /\(QST\)/i.test(String(m.option))));
  assert.ok(qhr, "QHR present");
  assert.ok(qst, "QST present");
  assert.ok((qhr.modifiers || []).some((m: any) => /bistec|steak/i.test(String(m.option))), "QHR bistec only");
  assert.ok(!(qhr.modifiers || []).some((m: any) => /lengua/i.test(String(m.option))), "QHR not lengua");
  assert.ok((qst.modifiers || []).some((m: any) => /lengua/i.test(String(m.option))), "QST lengua");

  assert.ok(r.cart.some((l: any) => l.itemId === COCA), "coca lata: " + ids.join(","));
  assert.ok(!r.cart.some((l: any) => /taco/i.test(String(l.itemId))), "no street taco TST: " + ids.join(","));
});
