// daniel1 (CA9de2b6): reaffirm "no sin pata" → qty 1 SIN (not qty×4 Con Pata). Keep Tortillas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";

const stub = async (text: string) => {
  if (/menudo/i.test(text) && /pata|papa/i.test(text))
    return { actions: [] as any[], reply: "Menudo: ¿Menudo con Tortillas (4) o Con Pata Menudo 32oz y Tortillas (4)?" };
  // Live miss: model dumps 4× Con Pata + EXTRA on reaffirm
  if (/no,\s*no sin pata|nada más.*sin pata/i.test(text))
    return {
      actions: [{
        type: "add_item",
        itemId: CON,
        quantity: 4,
        modifiers: [{ step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" }],
        readback: "4 con pata",
      }],
      reply: "4 × Menudo Con Pata… extra pata. $103.96. ¿Algo más?",
    };
  return { actions: [] as any[], reply: "?" };
};

const daniel: CallTurn[] = [
  T("staff", "Cocina Elvis.", 0),
  T("caller", "Hola, buenos días. Ah, voy a hacer un pedido.", 2),
  T("staff", "Ah, sí, dígame.", 5),
  T("caller", "Ah, me pone un menudo", 7),
  T("staff", "Sí, un menudo.", 10),
  T("caller", "sin, ah, sí.", 12),
  T("staff", "Sí, dígame.", 14),
  T("caller", "Ah, un menudo sin pata.", 16),
  T("staff", "Ok, un menudo, ¿algo más?", 19),
  T("caller", "Nada más, pero no, no sin pata el menudo, por favor.", 22),
  T("staff", "Ok, ¿al nombre de quién sería?", 25),
  T("caller", "Daniel.", 27),
  T("staff", "Daniel. Entonces te tengo un menudo, Daniel.", 29),
];

test("daniel1: reaffirm sin pata → qty 1 SIN with tortillas; no Con Pata / EXTRA / qty×4", async () => {
  const r = await shadowOrderFromTurns(daniel, stub as any);
  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  assert.equal(menudo.length, 1, `menudo lines: ${JSON.stringify(menudo)}`);
  assert.equal(String(menudo[0].itemId), SIN);
  assert.equal(Number(menudo[0].quantity), 1);
  assert.ok((menudo[0].modifiers || []).some((m: any) => /tortilla/i.test(String(m.option))), "keep tortillas");
  assert.ok(!r.cart.some((l: any) => l.itemId === CON), "no Con Pata");
  assert.ok(!(menudo[0].modifiers || []).some((m: any) => /extra\s*pata|beef\s+feet/i.test(String(m.option))), "no EXTRA pata");
});
