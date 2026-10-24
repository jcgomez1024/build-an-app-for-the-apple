// luis7895: CA12f8c5b6be37a4541e9eb2f24b34ab72 — Sat Oct 24 ~11:xx ET, …7895
// "De Luis." after "¿el nombre de quién sería la orden?" = customer (ticket + name log), NOT pickup-only.
// Cart truth: 2× Menudo con pata.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromAnswer, nameFromTranscriptInfo, thirdPersonName } from "../../src/order-name.js";
import { applySharedAliases } from "../../src/aliases.js";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";

const LUIS7895_TURNS = [
  { speaker: "staff" as const, text: "Cocina Elvis." },
  { speaker: "caller" as const, text: "Buenas, gracias, una orden." },
  { speaker: "staff" as const, text: "Ah, sí, dígame qué le vamos a dar." },
  { speaker: "caller" as const, text: "¿Me puede poner dos menudos?" },
  { speaker: "staff" as const, text: "Ah, claro, con pato o sin pata." },
  { speaker: "caller" as const, text: "Con pata." },
  { speaker: "staff" as const, text: "Dos menudos con pata, muy bien, ¿algo más?" },
  { speaker: "caller" as const, text: "En serio todo." },
  { speaker: "staff" as const, text: "Okay, entonces te tengo dos menudos con pata, ¿el nombre de quién sería la orden?" },
  { speaker: "caller" as const, text: "De Luis." },
  { speaker: "staff" as const, text: "Luis." },
  { speaker: "caller" as const, text: "Sí." },
  { speaker: "staff" as const, text: "Muy bien, entonces dame unos quince minutos, por favor." },
  { speaker: "caller" as const, text: "Está muy bien, gracias." },
  { speaker: "staff" as const, text: "Gracias a ti." },
];

test("luis7895: De Luis after nombre-de-quién ask is customer, not thirdPerson", () => {
  assert.equal(nameFromAnswer("De Luis."), "Luis");
  assert.equal(thirdPersonName("De Luis."), null);
  assert.equal(thirdPersonName("para Luis"), "Luis"); // contrast: still pickup-only
  const info = nameFromTranscriptInfo(LUIS7895_TURNS);
  assert.deepEqual(info, { name: "Luis", thirdPerson: false, source: "staff-ask" });
});

test("luis7895: shadow cart is 2 menudos con pata", async () => {
  const MEN = "sq-menudo-con-pata";
  const seen: string[] = [];
  const run = async (t: string) => {
    const s = applySharedAliases(t, "phone");
    seen.push(s);
    const acts: any[] = [];
    if (/menudo/i.test(s) && /\b(dos|2)\b/i.test(s)) {
      acts.push({ type: "add_item", itemId: MEN, quantity: 2, modifiers: [{ option: "Con Pata" }], readback: "2 menudo con pata" });
    } else if (/menudo/i.test(s)) {
      acts.push({ type: "add_item", itemId: MEN, quantity: 1, modifiers: [{ option: "Con Pata" }], readback: "1 menudo" });
    } else if (/^(con pata|sin pata)\b/i.test(s.trim()) && seen.some((x) => /menudo/i.test(x))) {
      acts.push({ type: "add_item", itemId: MEN, quantity: 2, modifiers: [{ option: /sin/i.test(s) ? "Sin Pata" : "Con Pata" }], readback: "2 menudo" });
    }
    return { actions: acts, reply: acts.length ? "¿Algo más?" : "OK" };
  };
  const r: any = await shadowOrderFromTurns(
    LUIS7895_TURNS.map((t, i) => ({ ...t, start: i, end: i + 1, language: "es" })) as any,
    run as any,
  );
  const q = r.cart.filter((l: any) => /menudo/i.test(l.itemId)).reduce((a: number, l: any) => a + (l.quantity || 1), 0);
  assert.ok(q >= 2, `expected ≥2 menudo qty, got ${q}: ${JSON.stringify(r.cart)} seen=${JSON.stringify(seen)}`);
});

test("luis7895: pendingSpokenQty applies when dos menudos empty then staff-pick qty 1", async () => {
  const MEN = "sq-menudo-con-pata";
  let n = 0;
  const run = async (t: string) => {
    n++;
    // First menudo ask: Elvi questions (empty). Later staff-pick / Con pata: add qty 1.
    if (/^(con pata|sin pata)\b/i.test(t.trim()) || /menudo.*32|32oz|comal tortilla/i.test(t)) {
      return { actions: [{ type: "add_item", itemId: MEN, quantity: 1, modifiers: [{ option: "Con Pata" }], readback: "1 menudo" }], reply: "¿Algo más?" };
    }
    if (/menudo/i.test(t) && /\b(dos|2)\b/i.test(t)) {
      return { actions: [], reply: "¿Con pata o sin pata?" };
    }
    return { actions: [], reply: "OK" };
  };
  const turns = [
    { speaker: "caller" as const, text: "¿Me puede poner dos menudos?", start: 0, end: 1, language: "es" as const },
    { speaker: "staff" as const, text: "¿Con pata o sin pata?", start: 1, end: 2, language: "es" as const },
    { speaker: "caller" as const, text: "Con pata.", start: 2, end: 3, language: "es" as const },
  ];
  const r: any = await shadowOrderFromTurns(turns as any, run as any);
  const q = r.cart.filter((l: any) => /menudo/i.test(l.itemId)).reduce((a: number, l: any) => a + (l.quantity || 1), 0);
  assert.equal(q, 2, `expected qty 2 via pendingSpokenQty, got ${q}: ${JSON.stringify(r.cart)}`);
});
