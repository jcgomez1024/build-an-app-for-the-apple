import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { makeItN, applyMakeItNMerge } from "../../src/modifier-turns.js";
import { dropDeclinedAsk, isAvailabilityAsk } from "../../src/list-repair.js";
import { detectAddress, spanishHouseNumber } from "../../src/delivery.js";
import { nameFromTranscriptInfo, nameFromAnswer } from "../../src/order-name.js";

// jonathan2 (CA11d424f, Nov 5 ~6:20 PM ET, delivery): 3 QCO duro + coke bottle + 501 West Walnut.
// Live miss: two qty-1 QCO duro, a Tacos Dorados line from "¿tiene tacos dorados de cueritos?" / "quería eso",
// delivery with no address. Stub = that miss. No phone or caller hardcoding.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA11d424f-jonathan2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR";
const TD = "sq-tacos-dorados-tacos-dorados-OHFWF3";
const COKE = "sq-drink-coca-cola-JJE4KC";
const DURO = { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" };
const QCO = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
const qco = () => ({ type: "add_item", itemId: Q, quantity: 1, modifiers: [QCO, DURO] });
const dorado = () => ({ type: "add_item", itemId: TD, quantity: 1, modifiers: [DURO] });

const stub = () => {
  let qLines = 0;
  const r: any = async (t: string) => {
    // "quería eso" after the declined dorados ask — live model rang Tacos Dorados plus the coke
    if (/eso/i.test(t) && /coca|coke|botella/i.test(t)) return { actions: [dorado(), { type: "add_item", itemId: COKE, quantity: 1, modifiers: [] }], reply: "Tacos dorados y una coca." };
    if (/tacos?\s+dorados|cueritos?/i.test(t)) return { actions: [dorado()], reply: "Tacos dorados de duro." };
    if (/coca|coke|botella/i.test(t)) return { actions: [{ type: "add_item", itemId: COKE, quantity: 1, modifiers: [] }], reply: "Coca de botella." };
    if (/quesadilla|prensado|prestado/i.test(t) && !/dorados|cuerito/i.test(t)) {
      qLines++;
      // live miss: the two spoken quesadillas landed as two qty-1 lines, and the later "las tres" did not replace them
      if (qLines === 1) return { actions: [qco(), qco()], reply: "Dos quesadillas de comal de duro." };
    }
    if (/\bde duro\b|hecha/i.test(t) && qLines === 0) return { actions: [qco()], reply: "Quesadilla comal de duro." };
    return { actions: [], reply: "Muy bien." };
  };
  r.menu = () => M;
  return r;
};

test("jonathan2: 3 QCO duro, coke bottle, delivery 501 West Walnut, Jonathan, no tacos dorados", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart;
  const q = c.filter((l: any) => l.itemId === Q);
  const qQty = q.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(q.length, 1, JSON.stringify(c));
  assert.equal(qQty, 3, JSON.stringify(q));
  assert.ok(q.every((l: any) => /QCO|Comal/i.test(JSON.stringify(l.modifiers)) && /Duro/i.test(JSON.stringify(l.modifiers))));
  assert.equal(c.some((l: any) => /tacos-dorados|dorados/i.test(String(l.itemId))), false, JSON.stringify(c));
  const coke = c.filter((l: any) => /coca/i.test(String(l.itemId)));
  assert.equal(coke.length, 1, JSON.stringify(c));
  assert.equal(coke[0].quantity, 1);
  assert.equal(r.fulfillment, "DELIVERY");
  assert.match(String(r.address || ""), /501/, String(r.address));
  assert.match(String(r.address || ""), /west/i);
  assert.match(String(r.address || ""), /walnut/i);
  const info = nameFromTranscriptInfo(d.turns);
  assert.match(info?.name || "", /^Jonathan$/i, JSON.stringify(info));
});

test("jonathan2 helpers: make-it-N, declined ask, confirmed street", () => {
  assert.deepEqual(makeItN("Mm, ¿me puedes poner mejor las tres?"), { n: 3, tail: "" });
  assert.deepEqual(makeItN("mejor que sean tres"), { n: 3, tail: "" });
  assert.equal(makeItN("can you just make it four regular quesadillas")?.n, 4);
  const cart: any[] = [qco(), qco()];
  applyMakeItNMerge(cart, [
    { speaker: "caller", text: "¿me puedes poner mejor las tres?" },
    { speaker: "staff", text: "Vamos a poner tres quesadillas de duro." },
  ] as any);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
  const one: any[] = [{ ...qco(), quantity: 2 }];
  applyMakeItNMerge(one, [{ speaker: "caller", text: "mejor las tres quesadillas" }] as any);
  assert.equal(one[0].quantity, 3);
  assert.equal(isAvailabilityAsk("Una pregunta, ¿tiene tacos dorados de cueritos?"), true);
  assert.equal(isAvailabilityAsk("Quería eso y una coca de botella."), false);
  const kept = [qco(), dorado()];
  assert.equal(dropDeclinedAsk(kept, d.turns), true);
  assert.equal(kept.some((l) => /dorados/i.test(l.itemId)), false);
  assert.equal(kept.length, 1);
  assert.equal(spanishHouseNumber("quinientos uno"), 501);
  assert.equal(spanishHouseNumber("quinientos cuarenta y cuatro"), 544);
  assert.equal(spanishHouseNumber("tres"), null);
  const addr = detectAddress(d.turns);
  assert.match(addr.address?.street || "", /501/);
  assert.match(addr.address?.street || "", /West Walnut/i);
  assert.equal(addr.confirmed, true);
  assert.equal(nameFromAnswer("Jonathan, Jonathan."), "Jonathan");
});
