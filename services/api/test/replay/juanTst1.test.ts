// juanTst1: CAec1c4cd1f85fdc638a4030cdb2a58d1c — Sat Oct 24 ~8:21 PM ET Spanish desk
// Truth: 4 TST lengua, 5 TST bistec, 4 TST cabeza, 4 TST tripa, 3 TST chorizo, 2 large horchatas.
// Live wrongs: lengua qty 1; missed 5 bistec (ASR viste); chorizo 4; 1 horchata; phantom 2 Sope Elvis from "normales".
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = [
  { speaker: "caller", text: 'Bueno, este, ¿quién quién tiene tacos?', start: 0.4, end: 0.9, language: "es" },
  { speaker: "staff", text: 'Cocina Elvis.', start: 2.4, end: 2.9, language: "es" },
  { speaker: "staff", text: 'Ah, tenemos tacos de', start: 8.3, end: 8.8, language: "es" },
  { speaker: "staff", text: 'bistec, cabeza, carnita, chorizo, costilla, pollo al pastor, buche, lengua, tripa.', start: 13.0, end: 13.5, language: "es" },
  { speaker: "caller", text: 'Okay, me da cuatro de lengua,', start: 20.1, end: 20.6, language: "es" },
  { speaker: "staff", text: 'Cuatro del co, del comal, ¿verdad?', start: 23.8, end: 24.3, language: "es" },
  { speaker: "caller", text: 'cuatro de vi,', start: 24.5, end: 25.0, language: "es" },
  { speaker: "caller", text: 'no, normales,', start: 28.0, end: 28.5, language: "en" },
  { speaker: "staff", text: '¿Taquero?', start: 29.5, end: 30.0, language: "es" },
  { speaker: "caller", text: 'taqueros, sí. Cuatro de viste, cinco de viste,', start: 30.9, end: 31.4, language: "es" },
  { speaker: "staff", text: 'Muy bien, cuatro de lengua, ajá.', start: 32.1, end: 32.6, language: "es" },
  { speaker: "staff", text: 'Cinco de bistec, claro.', start: 38.7, end: 39.2, language: "es" },
  { speaker: "caller", text: 'cuatro de cabeza,', start: 41.4, end: 41.9, language: "es" },
  { speaker: "staff", text: 'Cuatro de cabeza, claro.', start: 43.4, end: 43.9, language: "es" },
  { speaker: "caller", text: 'y cua y cuatro de tripas.', start: 45.3, end: 45.8, language: "es" },
  { speaker: "staff", text: 'Y cuatro de tripa. Claro, ¿algo más?', start: 47.9, end: 48.4, language: "es" },
  { speaker: "caller", text: 'Y dos sabos de horchata grandes, por favor.', start: 51.5, end: 52.0, language: "es" },
  { speaker: "staff", text: 'Dos horchatas, claro, ¿algo más?', start: 54.0, end: 54.5, language: "es" },
  { speaker: "caller", text: 'Era todo.', start: 57.6, end: 58.1, language: "en" },
  { speaker: "staff", text: 'Muy bien, entonces ya tengo cuatro tacos taqueros de lengua, cinco tacos,', start: 59.2, end: 59.7, language: "es" },
  { speaker: "staff", text: 'ah, taqueros de bistec, cuatro taqueros de cabeza y cuatro taqueros de tripa, y, perdón, sí.', start: 65.0, end: 65.5, language: "es" },
  { speaker: "caller", text: 'Y té,', start: 73.6, end: 74.1, language: "es" },
  { speaker: "caller", text: 'y té de chorizo.', start: 74.9, end: 75.4, language: "es" },
  { speaker: "staff", text: 'Okay.', start: 77.5, end: 78.0, language: "es" },
  { speaker: "staff", text: '¿Y tres de chorizo le agregó?', start: 79.0, end: 79.5, language: "es" },
  { speaker: "caller", text: 'Sí, por favor.', start: 81.4, end: 81.9, language: "es" },
  { speaker: "staff", text: 'Muy bien.', start: 82.5, end: 83.0, language: "es" },
  { speaker: "staff", text: 'Okay, está muy bien. Este, ¿al nombre de quién sería?', start: 84.0, end: 84.5, language: "es" },
  { speaker: "caller", text: 'Juan, Juan. Okay. Igualmente, gracias.', start: 88.4, end: 88.9, language: "es" },
  { speaker: "staff", text: 'Juan, y le tengo las dos aguas de horchata.', start: 89.4, end: 89.9, language: "es" },
  { speaker: "staff", text: 'Muy bien, Juan, este, deme unos', start: 93.0, end: 93.5, language: "es" },
  { speaker: "staff", text: 'veinte minutos.', start: 97.6, end: 98.1, language: "es" },
] as CallTurn[];

test("juanTst1: name Juan", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Juan");
});

test("juanTst1: 4+5+4+4+3 TST + 2 horchata; no sopes", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  const cart = r.cart || [];
  const tacos = cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  const meatQty = (re: RegExp) => tacos.filter((l: any) => (l.modifiers || []).some((m: any) => re.test(String(m.option))))
    .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(meatQty(/lengua/i), 4, `lengua: ${JSON.stringify(tacos)}`);
  assert.equal(meatQty(/bistec|steak/i), 5, `bistec: ${JSON.stringify(tacos)}`);
  assert.equal(meatQty(/cabeza/i), 4);
  assert.equal(meatQty(/tripa/i), 4);
  assert.equal(meatQty(/chorizo/i), 3);
  assert.ok(tacos.every((l: any) => (l.modifiers || []).some((m: any) => /TST|taquer|street/i.test(String(m.option)))), "all TST");
  const horch = cart.filter((l: any) => /horchata/i.test(String(l.itemId)));
  assert.equal(horch.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2, `horchata: ${JSON.stringify(horch)}`);
  assert.equal(cart.filter((l: any) => /sopes[ae]so/i.test(String(l.itemId))).length, 0, "no phantom sopes");
  assert.equal(cart.length, 6, JSON.stringify(cart));
});
