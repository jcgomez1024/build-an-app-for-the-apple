// fix1136: anonymized replay of a real pickup call (2026-10-20 ~11:36 ET). No phone, name or address.
// Square ticket: 2 × Quesadilla de Comal bistec, 2 × Quesadilla de Comal chorizo, 2 × Torta bistec, 2 × (QD) REGULAR Dorada prensado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, expandMeatAnswer, isCountOnly, STAFF_VOICE, cleanPhrase, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn => ({ speaker, start, end: start + 1, text, language: "es" });
const TURNS: CallTurn[] = [
  T("staff", "Sí, buenos días.", 2), T("caller", "Sí, buenos días, ¿puedo hacer una orden?", 3), T("staff", "Claro, joven, ¿qué le vamos a poner?", 4),
  T("caller", "Me pone cuatro quesadillas de comal,", 7), T("staff", "¿De qué van a hacer, hermano?", 10), T("caller", "dos de chorizo y dos de bistec,", 11),
  T("staff", "¿Qué más, joven?", 14), T("caller", "dos tortas de bistec.", 19), T("caller", "¿Cuántas quesadillas quería, güero?", 28),
  T("caller", "Dos, y dos, dos quesadillas doradas,", 30), T("staff", "¿De qué?", 34), T("caller", "de chicharrón prensado.", 35),
  T("staff", "¿Qué más, joven?", 38), T("caller", "Sería todo.", 39), T("staff", "¿Me das tu nombre para la orden?", 41), T("caller", "Fulano. Sí, está bien, gracias.", 43),
];
const N: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4 };
const meatOf = (t: string) => (/chorizo/i.test(t) ? "Chorizo / Mexican Sausage" : /bistec/i.test(t) ? "Bistec / Steak" : /prensado/i.test(t) ? "Prensado / Spicy Pork (+$0.50)" : null);
/** Stub Elvi with the real call's failure modes: an open meat question keeps qty 1; a turn that isn't a dish re-adds the last one. */
function stubElvi() {
  let pending: any = null, last: any = null;
  return async (text: string) => {
    const q = N[(text.toLowerCase().match(/^(un|una|dos|tres|cuatro)\b/) || [])[1]] || 1;
    const meat = meatOf(text);
    const qd = /\bqd\b/i.test(text), torta = /torta/i.test(text), ques = /quesadilla/i.test(text);
    if (!qd && !torta && !ques) { if (/puedo hacer una orden/i.test(text)) { pending = { itemId: "sq-torta-4GNTTE", quantity: 1 }; return { reply: "Torta: ¿Bistec, Cabeza, Carnitas o Chorizo?", actions: [] }; } return { reply: "¿Algo más?", actions: last ? [last] : [] }; }
    const itemId = qd ? "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH" : torta ? "sq-torta-4GNTTE" : "sq-quesadilla-HLT6CR";
    if (!meat) { pending = { itemId, quantity: q }; return { reply: "¿Qué carne quieres?", actions: [] }; }
    const quantity = pending ? 1 : q; pending = null;
    last = { type: "add_item", itemId, quantity, modifiers: [{ step: "meat", option: meat }, ...(ques && /comal/i.test(text) ? [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" }] : [])] };
    return { reply: "¿Algo más?", actions: [last] };
  };
}
test("fix1136 helpers: meat answer expands with the dish; counts-only and staff bleed are not orders", () => {
  assert.deepEqual(expandMeatAnswer("Me pone cuatro quesadillas de comal,", "dos de chorizo y dos de bistec,"), ["dos quesadillas de comal de chorizo", "dos quesadillas de comal de bistec"]);
  assert.deepEqual(expandMeatAnswer("dos QD REGULAR Dorada,", "de chicharrón prensado."), ["dos QD REGULAR Dorada de chicharrón prensado"]);
  assert.equal(expandMeatAnswer("dos tacos", "Sí, está bien"), null);
  assert.equal(isCountOnly("Dos, y dos"), true); assert.equal(isCountOnly("dos tortas"), false);
  assert.ok(STAFF_VOICE.test("¿Cuántas quesadillas quería, güero?")); assert.ok(!STAFF_VOICE.test("¿Me da dos tacos?"));
  assert.match(cleanPhrase("dos quesadillas doradas"), /QD REGULAR Dorada/); assert.match(cleanPhrase("dos quesadillas doradas deluxe"), /QD DELUXE Dorada/);
});
test("fix1136 replay: 2 comal chorizo, 2 comal bistec, 2 tortas bistec, 2 QD prensado — no phantom torta, no doubles", async () => {
  const r: any = await shadowOrderFromTurns(TURNS.map((t) => ({ ...t })), stubElvi() as any);
  const got = r.cart.map((l: any) => `${l.quantity}×${l.itemId}:${(l.modifiers || []).map((m: any) => m.option).join("+")}`);
  assert.deepEqual(got, [
    "2×sq-quesadilla-HLT6CR:Chorizo / Mexican Sausage+(QCO) Quesadilla de Comal / Homemade",
    "2×sq-quesadilla-HLT6CR:Bistec / Steak+(QCO) Quesadilla de Comal / Homemade",
    "2×sq-torta-4GNTTE:Bistec / Steak",
    "2×sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH:Prensado / Spicy Pork (+$0.50)",
  ]);
});
test("fix1136 scoring: online QD item (variation folded into the name) matches the POS item + variation", async () => {
  const { scoreOrder } = await import("../../src/call-accuracy.ts");
  const elvi = [{ baseName: "(QD) Quesadilla Dorada (QD) REGULAR Dorada", variationId: "A", name: "REGULAR Dorada", quantity: 2, choices: ["Prensado / Spicy Pork (+$0.50)"], unitCents: 625, totalCents: 1250 }];
  const ticket = [{ baseName: "(QD) Quesadilla Dorada", variationId: "B", name: "(QD) Quesadilla Dorada · (QD) REGULAR Dorada", quantity: 2, choices: ["(QD) REGULAR Dorada", "Prensado / Spicy Pork"], unitCents: 625, totalCents: 1250 }];
  const r = scoreOrder(elvi as any, ticket as any);
  assert.ok(r.pairs.length === 1 && r.pairs[0].points >= 80, JSON.stringify(r));
});
