// josePickup1 (CAfa0e72): "sería nombre de José" = pickupOnly (not savedToMemory customer).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { thirdPersonName, nameFromAnswer, nameFromTranscriptInfo } from "../../src/order-name.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const stub = async (text: string) => {
  if (/\btortas?\b/iu.test(text) && /\bcarnitas\b/iu.test(text))
    return {
      actions: [{
        type: "add_item", itemId: "sq-torta-4GNTTE", quantity: 4,
        modifiers: [
          { step: "(A) Torta Options", option: "(TO) Torta" },
          { step: "(B) Torta Carne Options", option: "Carnitas / Pulled Pork (+$0.50)" },
        ],
        readback: "4 tortas carnitas",
      }],
      reply: "?",
    };
  return { actions: [], reply: "?" };
};

const joseTurns: CallTurn[] = [
  T("staff", "Pues sí, Nayeli, buenas tardes.", 0),
  T("caller", "Hola, buenas tardes. Quisiera hacer un pedido, por favor.", 2),
  T("staff", "A ver, dime.", 5),
  T("caller", "Serían cuatro tortas de,", 7),
  T("caller", "de carnitas, por favor.", 9),
  T("staff", "Okay, cuatro tortas de carnitas, ¿qué más, señorita?", 12),
  T("caller", "Sí.", 15),
  T("caller", "Sería todo, por favor.", 16),
  T("staff", "¿Nombre?", 18),
  T("caller", "Eh, sería nombre de José.", 19),
  T("staff", "José, nomás dile que me dé unos veinte, veinticinco si me hace el favor, ¿sí?", 21),
  T("caller", "Okey, está muy bien. Gracias.", 25),
];

test("josePickup1: sería nombre de José is third-person / pickup", () => {
  assert.equal(thirdPersonName("Eh, sería nombre de José."), "José");
  assert.equal(nameFromAnswer("Eh, sería nombre de José."), "José");
  // contrast: a nombre de = self (not thirdPerson)
  assert.equal(thirdPersonName("A nombre de José."), null);
  const info = nameFromTranscriptInfo(joseTurns as any);
  assert.ok(info);
  assert.equal(info!.name, "José");
  assert.equal(info!.thirdPerson, true);
});

test("josePickup1: 4 tortas carnitas cart", async () => {
  const r: any = await shadowOrderFromTurns(joseTurns.map((t) => ({ ...t })), stub as any);
  const tortas = r.cart.filter((l: any) => /torta/i.test(String(l.itemId)));
  const qty = tortas.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qty, 4, JSON.stringify(r.cart));
});
