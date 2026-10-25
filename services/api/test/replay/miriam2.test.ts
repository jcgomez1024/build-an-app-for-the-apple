// miriam2: CA477ac6 — Sun Oct 25 ~10:24. STT "Una orden de menos dos"; staff "Un menudo, ¿con pata o sin pata?"; caller "Sin pata."
// Correct: 1 Menudo con Tortillas. Never torta; staff Bistec must not land on a phantom torta.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T10:24:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";

test("miriam2: STT menos + staff menudo + Sin pata → SIN menudo, no torta", async () => {
  const run = async (t: string) => {
    // model trap: raw "menos" without alias would invent torta
    if (/menos/i.test(t) && !/menudo/i.test(t))
      return { actions: [{ type: "add_item", itemId: "sq-torta-TO-torta-xyz", quantity: 1, modifiers: [] }], reply: "¿De qué carne para la torta?" };
    if (/bistec/i.test(t))
      return { actions: [{ type: "update_item", itemId: "sq-torta-TO-torta-xyz", modifiers: [{ step: "meat", option: "Bistec / Steak" }] }], reply: "¿Algo más?" };
    if (/menudo/i.test(t))
      return { actions: [], reply: "Menudo: ¿Menudo con Tortillas (4) o Con Pata Menudo 32oz y Tortillas (4)?" };
    return { actions: [], reply: "¿Algo más?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "staff", start: 0, end: 1, text: "¿Qué va a ser? Dígame.", language: "es" },
    { speaker: "caller", start: 2, end: 3, text: "Una orden de menos dos.", language: "es" },
    { speaker: "staff", start: 4, end: 5, text: "Un menudo, ¿qué, con pata o sin pata?", language: "es" },
    { speaker: "caller", start: 6, end: 7, text: "Sin pata.", language: "es" },
    { speaker: "staff", start: 8, end: 9, text: "Sin pata, okey. ¿Qué más va a ser?", language: "es" },
    { speaker: "staff", start: 9.5, end: 10, text: "Bistec.", language: "es" },
    { speaker: "caller", start: 10, end: 11, text: "Nada más.", language: "es" },
    { speaker: "staff", start: 12, end: 13, text: "¿A nombre de quién va a ser su orden?", language: "es" },
    { speaker: "caller", start: 14, end: 15, text: "Miriam.", language: "es" },
  ] as any, run as any);
  assert.ok(!r.cart.some((l: any) => /torta/i.test(String(l.itemId))), `no torta: ${JSON.stringify(r.cart)}`);
  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  assert.ok(menudo.length >= 1, `menudo missing: ${JSON.stringify(r.cart)}`);
  assert.ok(menudo.every((l: any) => l.itemId === SIN), `must be SIN: ${JSON.stringify(menudo)}`);
  assert.ok(!r.cart.some((l: any) => (l.modifiers || []).some((m: any) => /bistec/i.test(String(m.option)))),
    `no stolen bistec: ${JSON.stringify(r.cart)}`);
});
