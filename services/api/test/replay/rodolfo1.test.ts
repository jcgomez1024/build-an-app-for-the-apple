// rodolfo1: CA246414739cfb390373cda778ae4e5300 — Sat Oct 24 ~6:59 PM ET delivery +14403430102
// Truth: 2 gorditas bistec + 7 TST bistec + horchata 32oz + DELIVERY.
// Live: tacos 7+7+4=18; delivery missing; name junk "Sé Apple"/"Sé" from end ASR.
// callers.json already Rodolfo (staff) — block phrase-as-name; keep Rodolfo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromAnswer, nameFromStaffAsk, nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = [
  { speaker: "staff", text: "Cocina Elvis.", start: 0, end: 1, language: "es" },
  { speaker: "caller", text: "Sí, buenas tardes. Quería hacer una orden.", start: 1, end: 3, language: "es" },
  { speaker: "staff", text: "Ah, sí, dígame.", start: 3, end: 4, language: "es" },
  { speaker: "caller", text: "Ah, sí, sí podría hacer delivery. Ah, si me puede poner dos gorditas de bistec, por favor.", start: 4, end: 8, language: "es" },
  { speaker: "staff", text: "Dos gorditas de biste, ¿de biste? ¿Algo más?", start: 8, end: 10, language: "es" },
  { speaker: "caller", text: "Y me pone siete tacos de tortilla taquera", start: 10, end: 12, language: "es" },
  { speaker: "staff", text: "Muy bien, ¿de qué te los voy a poner?", start: 12, end: 13, language: "es" },
  { speaker: "caller", text: "de bistec también.", start: 13, end: 14, language: "es" },
  { speaker: "staff", text: "Muy bien, ¿algo más?", start: 14, end: 15, language: "es" },
  { speaker: "caller", text: "Oh, y tiene aguas", start: 15, end: 16, language: "es" },
  { speaker: "staff", text: "Ah, claro.", start: 16, end: 17, language: "es" },
  { speaker: "caller", text: "de horchata, por favor, me pone una, si tiene una de horchata, por favor. Ah, sería todo.", start: 17, end: 20, language: "es" },
  { speaker: "staff", text: "Una de horchata, claro, ¿algo más? Entonces te tengo dos gorditas de biste, siete tacos taqueros de biste y el agua de horchata, y va a ser para entrega. Muy bien, ¿me puedes dar tu dirección? Por favor. 197 West Jackson,", start: 20, end: 28, language: "es" },
  { speaker: "caller", text: "Oh, sería 197 West Jackson Street.", start: 28, end: 30, language: "es" },
  { speaker: "staff", text: "¿A qué nombre sería la orden, por favor?", start: 32, end: 34, language: "es" },
  { speaker: "caller", text: "Ah, Rodolfo.", start: 34, end: 35, language: "es" },
  { speaker: "staff", text: "Rodolfo, muy bien, Rodolfo, ¿me puedes dar tu número de teléfono? Ujú. 3 43 0 1 0 2. Muy bien, Rodolfo, entonces sería una orden para Rodolfo, entrega al 197 West Jackson Street,", start: 35, end: 42, language: "es" },
  { speaker: "caller", text: "Ah, es 4 40 3 43 0 1 0 2.", start: 42, end: 44, language: "es" },
  { speaker: "staff", text: "Y el agua de horchata.", start: 44, end: 45, language: "es" },
  { speaker: "caller", text: "Sí, sí sé Apple.", start: 45, end: 46, language: "es" },
  { speaker: "staff", text: "Muy bien. Rodolfo, dame unos veinticinco minutos.", start: 46, end: 48, language: "es" },
  { speaker: "caller", text: "Muchas gracias.", start: 48, end: 49, language: "es" },
] as CallTurn[];

test("rodolfo1: Sé Apple / Sé blocked as name", () => {
  assert.equal(nameFromAnswer("Sí, sí sé Apple."), null);
  assert.equal(nameFromAnswer("Sé"), null);
  assert.equal(nameFromAnswer("Sé Apple"), null);
  assert.equal(nameFromStaffAsk(turns as any), "Rodolfo");
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Rodolfo");
});

test("rodolfo1: 2 gorditas + 7 TST + horchata + DELIVERY (stub)", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  assert.equal(r.fulfillment, "DELIVERY");
  const gord = (r.cart || []).filter((l: any) => /gordita/i.test(String(l.itemId)));
  assert.ok(gord.length >= 1);
  assert.equal(gord.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2);
  const tacos = (r.cart || []).filter((l: any) => /taco/i.test(String(l.itemId)));
  const tacoQty = tacos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(tacoQty, 7, `tacos qty ${tacoQty}: ${JSON.stringify(tacos)}`);
  assert.ok((r.cart || []).some((l: any) => /horchata/i.test(String(l.itemId))));
});
