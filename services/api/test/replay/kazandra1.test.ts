// kazandra1: CAe2b841 — Sun Oct 25 ~10:08. "dos menudo, uno con pata y uno sin pata".
// Correct: 1 Menudo con Tortillas + 1 Con Pata Menudo (not 2× either).
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T10:08:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";

test("kazandra1: dos menudo uno con / uno sin → 1 CON + 1 SIN", async () => {
  const run = async (t: string) => {
    if (/menudo/i.test(t))
      return { actions: [], reply: "Menudo: ¿Menudo con Tortillas (4) o Con Pata Menudo 32oz y Tortillas (4)?" };
    return { actions: [], reply: "¿Algo más?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "staff", start: 0, end: 1, text: "Sí, buenos días.", language: "es" },
    { speaker: "caller", start: 2, end: 3, text: "Hola, Don, ¿cómo está?", language: "es" },
    { speaker: "staff", start: 4, end: 5, text: "Sí, bien, buenos días.", language: "es" },
    { speaker: "caller", start: 6, end: 7, text: "¿Puedo hacer una orden?", language: "es" },
    { speaker: "staff", start: 8, end: 9, text: "A ver, dígame.", language: "es" },
    { speaker: "caller", start: 10, end: 11, text: "Nomás quiero dos menudo, uno con pata y uno sin pata.", language: "es" },
    { speaker: "staff", start: 12, end: 13, text: "¿Qué más, señora?", language: "es" },
    { speaker: "caller", start: 14, end: 15, text: "Ahí sería todo.", language: "es" },
  ] as any, run as any);
  const sin = r.cart.filter((l: any) => l.itemId === SIN);
  const con = r.cart.filter((l: any) => l.itemId === CON);
  const sinQty = sin.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  const conQty = con.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  assert.equal(sinQty, 1, `SIN qty: ${JSON.stringify(r.cart)}`);
  assert.equal(conQty, 1, `CON qty: ${JSON.stringify(r.cart)}`);
  for (const l of sin) {
    assert.ok(!(l.modifiers || []).some((m: any) => /pata|beef feet/i.test(String(m.option))),
      `SIN must not have EXTRA Pata: ${JSON.stringify(l)}`);
  }
});
