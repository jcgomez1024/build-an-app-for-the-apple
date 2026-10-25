// bryan1: CA7212c1 — Sun Oct 25. "un menudo y una orden de birria" (no pata mentioned).
// Standing Monica/Carlos rule: vague menudo → Menudo con Tortillas (SIN). Never Con Pata ask-loop.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T09:40:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";

test("bryan1: bare menudo + birria → SIN menudo, birria; no Con Pata, no pata-Q loop", async () => {
  const run = async (t: string) => {
    if (/menudo/i.test(t))
      return { actions: [], reply: "Menudo: ¿Menudo con Tortillas (4) o Con Pata Menudo 32oz y Tortillas (4)?" };
    if (/birria/i.test(t)) return { actions: [], reply: "¿Algo más?" };
    return { actions: [], reply: "¿Algo más?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "staff", start: 0, end: 1, text: "Buenos días.", language: "es" },
    { speaker: "caller", start: 2, end: 3, text: "Sí, buenos días.", language: "es" },
    { speaker: "staff", start: 4, end: 5, text: "Sí, dígame.", language: "es" },
    { speaker: "caller", start: 6, end: 7, text: "¿Me puedes poner un menudo y una orden de birria, por favor?", language: "es" },
    { speaker: "staff", start: 8, end: 9, text: "¿Qué más, mano?", language: "es" },
    { speaker: "caller", start: 10, end: 11, text: "Nada más.", language: "es" },
    { speaker: "staff", start: 12, end: 13, text: "Brian.", language: "es" },
    { speaker: "caller", start: 14, end: 15, text: "Sí, para Brian.", language: "es" },
  ] as any, run as any);
  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  const birria = r.cart.filter((l: any) => /birria/i.test(String(l.itemId)));
  assert.ok(menudo.length >= 1, `menudo missing: ${JSON.stringify(r.cart)}`);
  assert.ok(menudo.every((l: any) => l.itemId === SIN), `must be SIN not CON: ${JSON.stringify(menudo)}`);
  assert.ok(!r.cart.some((l: any) => l.itemId === CON), "must not be Con Pata");
  assert.ok(birria.length >= 1 || r.cart.some((l: any) => /birria/i.test(String(l.itemId))), `birria missing: ${JSON.stringify(r.cart)}`);
  const pataAsks = r.steps.filter((s: any) => /Con\s+Pata/i.test(String(s.reply || "")));
  assert.equal(pataAsks.length, 0, `no open pata Q: ${JSON.stringify(pataAsks)}`);
});

test("bryan1: explicit con pata still rings Con Pata", async () => {
  const run = async () => ({ actions: [], reply: "¿Algo más?" });
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "Un menudo con pata", language: "es" },
  ] as any, run as any);
  assert.equal(r.cart[0]?.itemId, CON);
});
