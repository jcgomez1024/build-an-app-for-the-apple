// adriana1 (CAa1999d): Sun Oct 25 ~12:23 ET desk pickup.
// Square VLSRkhkl… $49 = 2 Menudo con Tortillas + 1 Mole Tradicional Platillo Solo Arroz.
// Live miss: mole qty 4; model Con Pata on "sin pata"; phantom bistec torta from staff "¿Cerdos también?"/"Sí, claro".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T12:23:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
const MOLE = "sq-mole-tradicional-platillo-4THFAW";
const TORTA = "sq-torta-4GNTTE";

const turns = JSON.parse(readFileSync("/tmp/CAa1999d-turns.json", "utf8"));

test("adriana1: 2 SIN menudo + 1 mole Solo Arroz; no Con Pata; no torta; mole not qty 4", async () => {
  const run = async (text: string) => {
    // Live miss shapes: Con Pata on menudo, mole qty 4, phantom torta after cerdos / order-open
    if (/menudo/i.test(text))
      return {
        actions: [{
          type: "add_item", itemId: CON, quantity: 2,
          modifiers: [{ step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" }],
          readback: "2 con pata",
        }],
        reply: "2 × Menudo Con Pata… ¿Algo más?",
      };
    if (/mole|platillo/i.test(text))
      return {
        actions: [{
          type: "add_item", itemId: MOLE, quantity: 4,
          modifiers: [
            { step: "(A) Mole Sides", option: "Solo Arroz / Rice" },
            { step: "(B) Mole Tortillas", option: "3 x (Corn) Corn Tortilla" },
          ],
          readback: "4 mole",
        }],
        reply: "4 mole",
      };
    if (/cerdos|orden|buenas/i.test(text) && !/menudo|mole|platillo/i.test(text))
      return {
        actions: [{
          type: "add_item", itemId: TORTA, quantity: 1,
          modifiers: [{ step: "(B) Carnes", option: "Bistec / Steak" }],
          readback: "torta bistec",
        }],
        reply: "Torta bistec",
      };
    return { actions: [], reply: "?" };
  };

  const r: any = await shadowOrderFromTurns(turns as any, run as any);

  assert.ok(!r.cart.some((l: any) => /torta/i.test(String(l.itemId))),
    "no phantom torta from cerdos: " + JSON.stringify(r.cart));

  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  const menudoQty = menudo.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(menudoQty, 2, "2 menudo: " + JSON.stringify(r.cart));
  assert.ok(menudo.every((l: any) => l.itemId === SIN), "SIN (Tortillas) not Con Pata: " + JSON.stringify(menudo));
  assert.ok(!menudo.some((l: any) => (l.modifiers || []).some((m: any) => /extra\s*pata|con\s+pata|beef\s+feet/i.test(String(m.option)))),
    "no EXTRA Pata: " + JSON.stringify(menudo));

  const mole = r.cart.filter((l: any) => /mole/i.test(String(l.itemId)));
  const moleQty = mole.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(moleQty, 1, "mole qty 1 not 4: " + JSON.stringify(r.cart));
  assert.ok(mole.every((l: any) => (l.modifiers || []).some((m: any) => /Solo Arroz/i.test(String(m.option || "")))),
    "Solo Arroz: " + JSON.stringify(mole));
});
