// miguel2: CA7e1ee4275b712640bd7fba9379ee563f — Sun Oct 25 ~10:31 AM ET
// "Serían dos menudos" + staff "con pata o sin" + "con pata." → 2× catalog Menudo con Pata (NOT SIN+EXTRA).
// EXTRA Pata only if customer asks for *extra* pata on top. Carlos 10/25.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T10:31:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";

test("miguel2: dos menudos + bare con pata → 2× Con Pata SKU, no EXTRA", async () => {
  const run = async () => ({ actions: [], reply: "¿Algo más?" });
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "Serían dos menudos", language: "es" },
    { speaker: "staff", start: 2, end: 3, text: "Okay, con pata o sin.", language: "es" },
    { speaker: "caller", start: 4, end: 5, text: "con pata.", language: "es" },
  ] as any, run as any);
  const men = r.cart.filter((l: any) => /menudo/i.test(l.itemId));
  assert.ok(men.length >= 1, JSON.stringify(r.cart));
  const total = men.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(total, 2, JSON.stringify(r.cart));
  assert.ok(men.every((l: any) => l.itemId === CON), JSON.stringify(r.cart));
  assert.ok(!men.some((l: any) => (l.modifiers || []).some((m: any) => /EXTRA Pata|beef\s+feet/i.test(String(m.option)))),
    `no EXTRA Pata: ${JSON.stringify(r.cart)}`);
  assert.ok(!r.cart.some((l: any) => l.itemId === SIN), "no leftover SIN");
});

test("miguel2: extra pata on top keeps EXTRA modifier", async () => {
  const run = async () => ({ actions: [], reply: "¿Algo más?" });
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "Un menudo con pata y extra pata", language: "es" },
  ] as any, run as any);
  assert.equal(r.cart[0]?.itemId, CON);
  assert.ok((r.cart[0].modifiers || []).some((m: any) => /EXTRA Pata|beef\s+feet/i.test(String(m.option))),
    JSON.stringify(r.cart[0]));
});
