// miguel1: CA1157d44a708288e4b21099ce3849e93d — Sun Oct 25 ~9:16 AM ET, desk Spanish ~20s
// Caller: "quería hacer un pedido de tres menudos sin patas" + "Nada más". Name Miguel OK.
// Square 5HHTXsjWvWfgUjXPCRM2O55e0nDZY = 3× Menudo 32oz con Tortillas $48.
// Miss: 1× Con Pata; phantom Taco Comal/Harina/Taquero prompts + staff-pick Taco Comal.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T09:16:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";

test("miguel1: tres menudos sin patas → 3× sin-pata SKU, no taco staff-pick", async () => {
  const run = async (t: string) => {
    if (/menudo/i.test(t)) return { actions: [], reply: "¿Taco Comal, Taco Harina o Taco Taquero?" };
    return { actions: [], reply: "¿Algo más?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "Este, quería hacer un pedido de tres menudos sin patas.", language: "es" },
    { speaker: "staff", start: 2, end: 3, text: "¿Qué más, joven?", language: "es" },
    { speaker: "caller", start: 4, end: 5, text: "Nada más.", language: "es" },
    { speaker: "staff", start: 6, end: 7, text: "¿Tu nombre?", language: "es" },
    { speaker: "caller", start: 8, end: 9, text: "Miguel.", language: "es" },
  ] as any, run as any);
  assert.equal(r.cart.length, 1, JSON.stringify(r.cart));
  assert.equal(r.cart[0].itemId, SIN);
  assert.equal(r.cart[0].quantity, 3);
  assert.ok(!r.cart.some((l: any) => l.itemId === CON), "must not be Con Pata");
  assert.ok(!r.steps.some((s: any) => s.source === "staff-pick"), `no staff-pick: ${JSON.stringify(r.steps)}`);
  assert.doesNotMatch(String(r.steps[0]?.reply || ""), /Taco Comal/i);
});

test("miguel1: singular sin pata still swaps to sin-pata SKU", async () => {
  const run = async () => ({ actions: [], reply: "¿Algo más?" });
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "Un menudo sin pata", language: "es" },
  ] as any, run as any);
  assert.equal(r.cart[0]?.itemId, SIN);
  assert.equal(r.cart[0]?.quantity, 1);
});
