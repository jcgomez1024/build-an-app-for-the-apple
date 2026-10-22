// fix1036: anonymized replay of the first real order call (2026-10-20 10:36 ET). No phone, name or address.
// Square ticket: 3 × Quesadilla de Comal bistec, 4 × Taco Taquero bistec, 2 Cokes, Delivery Fee · Delivery 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, orderResidue, cleanPhrase, type CallTurn } from "../../src/call-scoring.ts";
import { applySharedAliases } from "../../src/aliases.ts";
import { deliveryFeeLine, scoreOrder } from "../../src/call-accuracy.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn => ({ speaker, start, end: start + 1, text, language: "es" });
const TURNS: CallTurn[] = [
  T("staff", "Sí, bueno.", 2), T("caller", "Sí, buenos días.", 4), T("staff", "Sí, dígame, buenos días.", 6),
  T("caller", "Oh, sí, se podría hacer para un pedido a domicilio.", 9), T("staff", "Ah, ¿quién eres?", 14),
  T("caller", "Oh, lo de", 16), T("caller", "los apartamentos, ya.", 18), T("staff", "Los de la esquina, ¿verdad?", 21), T("caller", "Sí.", 24),
  T("staff", "¿Cómo te llamas?", 26), T("caller", "Fulana. Entonces serían tres quesadillas de bistec o de maíz.", 29),
  T("staff", "¿De maíz en el comal o doradas o de harina?", 38), T("staff", "¿En el comal?", 43), T("caller", "Sí.", 44), T("staff", "¿Qué más?", 45),
  T("caller", "Y me pones cuatro tacos, pero del chiquito, taquero.", 48), T("staff", "¿Y el taquero? Okay, ¿de qué?", 51), T("caller", "¿De bistec también?", 54),
  T("staff", "Okay, ¿qué más?", 56), T("caller", "Oh, y me pone dos, yo creo, con la taparrosca.", 60), T("staff", "¿De cuáles quieres?", 64),
  T("caller", "Oh, coca está bien.", 66), T("staff", "Tengo coca. Mhm.", 69), T("caller", "Sí, coca, sí. No, creo que sería todo.", 71),
  T("staff", "¿Algo más?", 73), T("staff", "Van a ser, señorita, delivery, tus quesadillas y tus tacos y tus dos cocas van a ser 38 dólares, ¿okay?", 96),
  T("caller", "Okay.", 102), T("staff", "Dame por lo menos unos 20 si me haces favor, ¿sí?", 103), T("caller", "Sí, está bien.", 105), T("staff", "Gracias.", 106),
];
const N: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4 };
/** Stub Elvi with the real call's failure mode: a turn with no dish re-adds the last dish from history. */
function stubElvi() {
  let pendingTaco: number | null = null; let last: any = null;
  return async (text: string) => {
    const q = N[(text.toLowerCase().match(/\b(un|una|uno|dos|tres|cuatro)\b/) || [])[1]] || 1;
    if (/quesadilla/i.test(text)) { last = { type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: q, modifiers: [{ step: "(A) Q Tortilla Options", option: /comal/i.test(text) ? "(QCO) Quesadilla de Comal / Homemade" : "(QST) Quesadilla Taquera / Street Quesadilla" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }; return { reply: "¿Algo más?", actions: [last] }; }
    if (/taco/i.test(text) && !/bistec/i.test(text)) { pendingTaco = q; return { reply: "Taco: ¿Bistec, Cabeza, Carnitas o Chorizo?", actions: [] }; }
    if (pendingTaco && /bistec/i.test(text)) { last = { type: "add_item", itemId: "sq-taco-TAR7L5", quantity: pendingTaco, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }; pendingTaco = null; return { reply: "¿Algo más?", actions: [last] }; }
    if (/coca cola/i.test(text)) { last = { type: "add_item", itemId: "sq-drink-coca-cola-JJE4KC", quantity: q }; return { reply: "Coca Cola. ¿Algo más?", actions: [last] }; }
    if (/__|pedido|domicilio/.test(text)) return { reply: "¿REGULAR Dorada o DELUXE Preparada?", actions: [] };
    return { reply: "¿Algo más?", actions: last ? [last] : [] }; // the duplicate bug
  };
}
test("fix1036 aliases: de maíz → comal (quesadillas), taparrosca/cocas/cokes → coca cola, no Pepsi", () => {
  assert.match(applySharedAliases("tres quesadillas de bistec o de maíz", "phone"), /quesadillas de bistec de comal$/);
  assert.match(applySharedAliases("tres quesadillas de bistec o de maíz", "app"), /de comal/);
  assert.doesNotMatch(applySharedAliases("quesadillas doradas de maíz", "phone"), /comal/);
  assert.equal(cleanPhrase("Oh, y me pone dos, yo creo, con la taparrosca").replace(/^oh,?\s*/i, ""), "y me pone dos coca cola");
  assert.equal(applySharedAliases("dos cocas", "app"), "dos coca cola");
  assert.equal(applySharedAliases("two cokes", "phone"), "two coca cola");
  assert.doesNotMatch(applySharedAliases("una diet coke", "phone"), /coca cola/);
});
test("fix1036 residue: filler / repeat-of-last-item turns order nothing", () => {
  assert.equal(orderResidue("Sí, coca, sí. No, creo que", "sq-drink-coca-cola-JJE4KC"), "");
  assert.equal(orderResidue("Oh, coca está bien.", "sq-drink-coca-cola-JJE4KC"), "");
  assert.equal(orderResidue("Sí, está bien.", null), "");
  assert.notEqual(orderResidue("¿De bistec también?", "sq-quesadilla-HLT6CR"), "");
  assert.notEqual(orderResidue("otra coca", "sq-drink-coca-cola-JJE4KC"), "");
});
test("fix1036 replay: 10:36 call → 3 comal quesadillas, 4 street tacos, 2 Cokes, delivery; no doubles", async () => {
  const r: any = await shadowOrderFromTurns(TURNS.map((t) => ({ ...t })), stubElvi() as any);
  const got = r.cart.map((l: any) => `${l.quantity}×${l.itemId}:${(l.modifiers || []).map((m: any) => m.option).join("+")}`);
  assert.deepEqual(got, [
    "3×sq-quesadilla-HLT6CR:(QCO) Quesadilla de Comal / Homemade+Bistec / Steak",
    "4×sq-taco-TAR7L5:(TST) Taco Taquero / Street Taco+Bistec / Steak",
    "2×sq-drink-coca-cola-JJE4KC:",
  ]);
  assert.equal(r.fulfillment, "DELIVERY");
});
test("fix1036 comal confirm: staff '¿En el comal?' + caller 'Sí' switches the last quesadilla to comal", async () => {
  const r: any = await shadowOrderFromTurns([T("caller", "tres quesadillas de bistec", 0), T("staff", "¿En el comal?", 2), T("caller", "Sí.", 3)], stubElvi() as any);
  assert.equal(r.cart[0].modifiers[0].option, "(QCO) Quesadilla de Comal / Homemade");
});
test("fix1036 delivery fee line matches the POS 'Delivery Fee · Delivery 1'", () => {
  const ticket = [{ baseName: "Delivery Fee", name: "Delivery Fee · Delivery 1", quantity: 1, choices: ["Delivery 1"], unitCents: 500, totalCents: 500 }];
  // fee1: the fee is not an item — a missing or extra fee line doesn't move the item score (delivery yes/no is checked separately)
  const taco = { baseName: "Taco", name: "Taco", quantity: 1, choices: [], unitCents: 300, totalCents: 300 };
  assert.equal(scoreOrder([taco, deliveryFeeLine(null)], [taco, ...ticket]).score, 100);
  assert.equal(scoreOrder([taco], [taco, ...ticket]).score, 100);
  assert.equal(deliveryFeeLine(800).name, "Delivery Fee · Delivery 2");
});
