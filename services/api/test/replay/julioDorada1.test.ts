// julioDorada1: CA35544a85732b33f57d6003d972241889 — Sat Oct 24 ~7:03 PM ET pickup Julio
// Truth: 4 QD Regular (2 bistec, 1 chicharrón prensado, 1 nopales con papas) + 2 extra salsa asada.
// Live: 2 Tortas (bistec, nopales). "Cuatro doradas"→QD; don't reject "tres de bistec"; include prensado + salsas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, rewriteCallerText, DORADA_REG_ID, EXTRAS_ID, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = [
  { speaker: "staff", text: "Buenas noches.", start: 0, end: 1, language: "es" },
  { speaker: "caller", text: "Sí, buenas noches. Eh, si quisiera ordenar, este, cuatro doradas, por favor.", start: 1, end: 4, language: "es" },
  { speaker: "staff", text: "¿Te quedas en las vievas?", start: 4, end: 5, language: "es" },
  { speaker: "caller", text: "Este, tres de", start: 5, end: 6, language: "es" },
  { speaker: "caller", text: "de bistec y una de,", start: 6, end: 7, language: "es" },
  { speaker: "caller", text: "o, action, de hecho, a dos de bistec,", start: 7, end: 8, language: "es" },
  { speaker: "caller", text: "una de,", start: 8, end: 9, language: "es" },
  { speaker: "staff", text: "Ajá.", start: 9, end: 10, language: "es" },
  { speaker: "caller", text: "de chicharrón prensado y otra de nopales con papas.", start: 10, end: 12, language: "es" },
  { speaker: "staff", text: "¿Las quieres preparadas o regulares?", start: 12, end: 13, language: "es" },
  { speaker: "caller", text: "Regulares.", start: 13, end: 14, language: "es" },
  { speaker: "staff", text: "Entonces te tengo dos quesadillas doradas de bistec, una quesadilla dorada de prensado y una quesadilla dorada no, de nopales con papas, Julio.", start: 14, end: 18, language: "es" },
  { speaker: "caller", text: "Sí, y este, y dos salsas grandes de la salsa dorada, por favor.", start: 18, end: 20, language: "es" },
  { speaker: "staff", text: "Asada.", start: 20, end: 21, language: "es" },
  { speaker: "caller", text: "Ajá, sí, dos extras.", start: 21, end: 22, language: "es" },
  { speaker: "staff", text: "Okay, muy bien, salsa asada. Muy bien. ¿Algo más, Julio?", start: 22, end: 24, language: "es" },
  { speaker: "caller", text: "Ah, esto es todo.", start: 24, end: 25, language: "es" },
  { speaker: "staff", text: "Ok, Julio, dame unos veinticinco minutos.", start: 25, end: 27, language: "es" },
  { speaker: "caller", text: "Sí, está bien, gracias.", start: 27, end: 28, language: "es" },
] as CallTurn[];

test("julioDorada1: cuatro doradas → quesadillas doradas; salsa dorada → asada", () => {
  assert.match(rewriteCallerText("cuatro doradas, por favor"), /quesadillas doradas/i);
  assert.match(rewriteCallerText("dos salsas grandes de la salsa dorada"), /salsa asada/i);
});

test("julioDorada1: name Julio", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Julio");
});

test("julioDorada1: 2+1+1 QD Regular + 2 salsa asada extras; no tortas", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  const cart = r.cart || [];
  assert.equal(cart.filter((l: any) => /torta/i.test(String(l.itemId))).length, 0, JSON.stringify(cart));
  const qd = cart.filter((l: any) => String(l.itemId) === DORADA_REG_ID);
  const qty = (meat: RegExp) => qd.filter((l: any) => (l.modifiers || []).some((m: any) => meat.test(String(m.option))))
    .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qty(/bistec|steak/i), 2, JSON.stringify(cart));
  assert.equal(qty(/prensado/i), 1, JSON.stringify(cart));
  assert.equal(qty(/nopales/i), 1, JSON.stringify(cart));
  const ex = cart.filter((l: any) => String(l.itemId) === EXTRAS_ID);
  assert.ok(ex.length >= 1);
  assert.equal(ex.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2);
});
