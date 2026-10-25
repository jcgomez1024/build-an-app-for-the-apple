// monica1: CA1dadc6 — Sun Oct 25 ~10:06. "quisiera encargar un menudo" (no pata).
// Standing rule: bare menudo → Menudo con Tortillas (SIN). Never Con Pata.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T10:06:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";

test("monica1: encargar un menudo (no pata) → SIN; no Con Pata", async () => {
  const run = async (t: string) => {
    if (/menudo/i.test(t))
      return { actions: [], reply: "Menudo: ¿Menudo con Tortillas (4) o Con Pata Menudo 32oz y Tortillas (4)?" };
    return { actions: [], reply: "¿Algo más?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "staff", start: 0, end: 1, text: "Sí, buenos días.", language: "es" },
    { speaker: "caller", start: 2, end: 3, text: "Um, bueno, si quisiera, um, encargar un menudo.", language: "es" },
    { speaker: "staff", start: 4, end: 5, text: "¿Algo más?", language: "es" },
    { speaker: "caller", start: 6, end: 7, text: "No, es todo.", language: "es" },
    { speaker: "staff", start: 8, end: 9, text: "Nombre.", language: "es" },
    { speaker: "caller", start: 10, end: 11, text: "De Mónica.", language: "es" },
  ] as any, run as any);
  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  assert.equal(menudo.length, 1, `expected 1 menudo: ${JSON.stringify(r.cart)}`);
  assert.equal(menudo[0].itemId, SIN);
  assert.ok(!r.cart.some((l: any) => l.itemId === CON), "must not be Con Pata");
});
