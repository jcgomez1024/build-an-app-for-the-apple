// miriam1: CA010de0a7ec5bcdfb1f38a15e659d2e64 — Sat Oct 24 ~6:57 PM ET Spanish pickup
// Truth Square VT0areSAuKGG8h4ATGlIW9Eoj3DZY: 2 QD Regular bistec + 1 QD Regular picadillo
//   + 2 Gorditas bistec; salsa roja y verde preference.
// Live wrongs: 2× phantom Huarache Elvis bistec + 3× QCO bistec; missed gorditas.
// Cause: Elvi on Huarache prompt at order-open; staff-pick Comal; picadillo dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, rewriteCallerText, DORADA_REG_ID, type CallTurn } from "../../src/call-scoring.ts";

const turns = [
  { speaker: "staff", text: "Cocina Elvis, hola.", start: 0, end: 1, language: "es" },
  { speaker: "caller", text: "Hola.", start: 1, end: 2, language: "es" },
  { speaker: "caller", text: "¿Por, puedo hacer una orden?", start: 2, end: 3, language: "es" },
  { speaker: "staff", text: "Ah, claro, sí, dígame.", start: 3, end: 4, language: "es" },
  { speaker: "caller", text: "Tiene quesadillas doradas.", start: 4, end: 5, language: "es" },
  { speaker: "staff", text: "Sí.", start: 5, end: 6, language: "es" },
  { speaker: "caller", text: "Sí, quiero, por favor, tres.", start: 6, end: 7, language: "es" },
  { speaker: "staff", text: "Ah, ¿las quieres preparadas o regulares?", start: 7, end: 8, language: "es" },
  { speaker: "caller", text: "Regular.", start: 8, end: 9, language: "es" },
  { speaker: "staff", text: "Regular, ok, ¿de qué te las voy a dar? Las tres.", start: 9, end: 10, language: "es" },
  { speaker: "caller", text: "Ah, va a ser una de bistec.", start: 10, end: 11, language: "es" },
  { speaker: "staff", text: "Muy bien, una de bistec, ¿y la segunda?", start: 11, end: 12, language: "es" },
  { speaker: "caller", text: "Que sean dos de bistec.", start: 12, end: 13, language: "es" },
  { speaker: "staff", text: "Muy bien, dos de bistec.", start: 13, end: 14, language: "es" },
  { speaker: "caller", text: "Y, y una de picadillo.", start: 14, end: 15, language: "es" },
  { speaker: "caller", text: "Okay. So, le dije tres quesadillas, ¿verdad? También quiero dos gorditas.", start: 20, end: 22, language: "es" },
  { speaker: "staff", text: "Muy bien, dos burritas, ¿de qué?", start: 22, end: 23, language: "es" },
  { speaker: "caller", text: "¿También debiste?", start: 23, end: 24, language: "es" },
  { speaker: "staff", text: "Muy bien, ¿algo más?", start: 24, end: 25, language: "es" },
  { speaker: "caller", text: "Yo creo que sería todo. ¿Me puede poner salsa roja? Sí, salsa roja y verde, por favor.", start: 25, end: 27, language: "es" },
  { speaker: "staff", text: "asada, salsa asada y verde, tu preferencia. Okey, entonces tengo, ten, voy a repetir. Nuevamente la orden, son dos quesadillas doradas de bistec", start: 27, end: 32, language: "es" },
  { speaker: "caller", text: "Sí, por favor.", start: 32, end: 33, language: "es" },
  { speaker: "staff", text: "y luego una quesadilla dorada de picadillo,", start: 33, end: 35, language: "es" },
  { speaker: "caller", text: "Sí.", start: 35, end: 36, language: "es" },
  { speaker: "staff", text: "dos gorditas de bistec y de preferencia quieres salsa verde y roja, ¿correcto Miriam?", start: 36, end: 40, language: "es" },
  { speaker: "caller", text: "Sí, sí, sería todo.", start: 40, end: 41, language: "es" },
] as CallTurn[];

test("miriam1: debiste → de bistec", () => {
  assert.match(rewriteCallerText("¿También debiste?"), /de bistec/i);
});

test("miriam1: 2 QD Regular bistec + 1 picadillo + 2 gorditas; no huarache/QCO", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  const cart = r.cart || [];
  assert.equal(cart.filter((l: any) => /huarache/i.test(String(l.itemId))).length, 0);
  const qd = cart.filter((l: any) => String(l.itemId) === DORADA_REG_ID);
  const bistec = qd.find((l: any) => (l.modifiers || []).some((m: any) => /bistec|steak/i.test(String(m.option))));
  const pic = qd.find((l: any) => (l.modifiers || []).some((m: any) => /picadillo/i.test(String(m.option))));
  assert.ok(bistec, `bistec QD: ${JSON.stringify(cart)}`);
  assert.equal(bistec.quantity || 1, 2);
  assert.ok(pic, `picadillo QD: ${JSON.stringify(cart)}`);
  assert.equal(pic.quantity || 1, 1);
  const gord = cart.filter((l: any) => /gordita/i.test(String(l.itemId)));
  assert.equal(gord.length, 1);
  assert.equal(gord[0].quantity || 1, 2);
  assert.match((gord[0].modifiers || []).map((m: any) => m.option).join(" "), /bistec|steak/i);
  const qco = cart.filter((l: any) => /quesadilla/i.test(String(l.itemId)) && !/dorada|t5stuh|zzav3l/i.test(String(l.itemId)));
  assert.equal(qco.length, 0, `no QCO: ${JSON.stringify(qco)}`);
});
