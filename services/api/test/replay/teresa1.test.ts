// teresa1: CA4bc4785bb2ac62e72768dc13a2010b77 — Sat Oct 24 ~9:20 PM ET Spanish desk
// Truth: 1 QHR bistec + 1 TCO bistec + 2 QHR bistec + 2 TCO costilla; no Coca.
// Live miss: split "Y dos tacos de," → "de costillas" + staff comal; phantom Coca from "Aquí tengo cocas".
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = [
  { speaker: 'caller', text: 'Ah, sí, buenas noches, ¿puedes darme una orden?', start: 1, end: 5.321, language: 'es' },
  { speaker: 'staff', text: '¿Cocina Elvis?', start: 1.22, end: 2.161, language: 'es' },
  { speaker: 'staff', text: 'Ah, sí, claro, ahorita ya nomás tenemos puro taco', start: 6.222, end: 9.403, language: 'es' },
  { speaker: 'staff', text: 'y quesadilla.', start: 10.864, end: 11.764, language: 'es' },
  { speaker: 'caller', text: 'Ah, ¿qué carne tiene disponible?', start: 13.262, end: 14.702, language: 'es' },
  { speaker: 'staff', text: 'Ah, tenemos todas. Sí, muy bien, una quesadilla de bistec de harina, ¿algo más?', start: 15.946, end: 29.611, language: 'es' },
  { speaker: 'caller', text: 'Me puedes, ah, si me das uno, ah, ¿me da una quesadilla de bistec,', start: 20.043, end: 24.744, language: 'es' },
  { speaker: 'caller', text: 'de harina?', start: 25.664, end: 26.024, language: 'es' },
  { speaker: 'caller', text: 'Ah, ¿y un taco de bistec? Sí.', start: 30.505, end: 36.126, language: 'es' },
  { speaker: 'staff', text: '¿Del comal?', start: 32.752, end: 33.312, language: 'es' },
  { speaker: 'staff', text: '¿Algo más?', start: 37.153, end: 37.774, language: 'es' },
  { speaker: 'caller', text: 'Ah, sí.', start: 38.886, end: 39.766, language: 'es' },
  { speaker: 'staff', text: '¿Qué más le doy?', start: 41.295, end: 41.915, language: 'es' },
  { speaker: 'caller', text: 'Ah, ¿qué carne tienes, perdón?', start: 42.666, end: 44.147, language: 'es' },
  { speaker: 'staff', text: 'Ah, tenemos bistec, cabeza carnita, chorizo, costilla, pollo al pastor, buche, lengua, tripa.', start: 45.817, end: 53.22, language: 'es' },
  { speaker: 'caller', text: 'Le da dos quesadillas de bistec. De harina. Y dos tacos de,', start: 61.292, end: 73.597, language: 'es' },
  { speaker: 'staff', text: '¿Dos ques, del comal o de harina?', start: 67.006, end: 68.726, language: 'es' },
  { speaker: 'staff', text: 'Muy bien, ¿algo más?', start: 73.108, end: 74.209, language: 'es' },
  { speaker: 'caller', text: 'de costillas.', start: 75.818, end: 76.418, language: 'es' },
  { speaker: 'staff', text: 'Muy bien, del comal, ¿verdad?', start: 77.43, end: 78.971, language: 'es' },
  { speaker: 'caller', text: 'Sí. ¿Cocas?', start: 79.999, end: 81.34, language: 'es' },
  { speaker: 'caller', text: 'Aquí tengo cocas. ¿Cocas? Aquí tengo cocas. Son no, ok.', start: 82.801, end: 87.843, language: 'es' },
  { speaker: 'caller', text: 'Sería todo.', start: 89.143, end: 89.643, language: 'es' },
  { speaker: 'staff', text: 'Okay, te vuelvo a repetir tu orden, para asegurarme, una quesadilla de harina de biste, un taco de comal de biste, dos, dos tacos de harina de biste. Y por último, dos tacos del comal de costilla.', start: 90.676, end: 104.943, language: 'es' },
  { speaker: 'caller', text: 'Sí.', start: 107.311, end: 107.411, language: 'es' },
  { speaker: 'staff', text: 'Muy bien, ¿a qué nombre sería la orden?', start: 108.965, end: 111.087, language: 'es' },
  { speaker: 'caller', text: 'Teresa.', start: 112.653, end: 113.013, language: 'es' },
  { speaker: 'staff', text: '¿Perdón?', start: 114.068, end: 114.389, language: 'es' },
  { speaker: 'caller', text: 'Teresa.', start: 115.334, end: 115.674, language: 'es' },
  { speaker: 'staff', text: '¿Teresa?', start: 116.67, end: 117.19, language: 'es' },
  { speaker: 'caller', text: 'Sí.', start: 118.115, end: 118.235, language: 'es' },
  { speaker: 'staff', text: 'Muy bien, este,', start: 119.752, end: 121.173, language: 'es' },
  { speaker: 'staff', text: '¿me puedes dar unos quince minutos?', start: 122.914, end: 125.556, language: 'es' },
  { speaker: 'caller', text: 'Sí, está bien.', start: 126.478, end: 126.998, language: 'es' },
  { speaker: 'staff', text: 'Okay, gracias.', start: 127.757, end: 128.618, language: 'es' },
  { speaker: 'caller', text: 'Sí, igual, adiós.', start: 129.519, end: 130.439, language: 'es' },
  { speaker: 'staff', text: 'Adiós.', start: 131.199, end: 131.5, language: 'es' },
] as CallTurn[];

test("teresa1: name Teresa", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Teresa");
});

test("teresa1: 1+2 QHR bistec, 1 TCO bistec, 2 TCO costilla; no Coca", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  const cart = r.cart || [];
  const mq = (kind: RegExp, meat: RegExp) => cart.filter((l: any) => kind.test(String(l.itemId))
    && (l.modifiers || []).some((m: any) => meat.test(String(m.option))))
    .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const drinks = cart.filter((l: any) => /drink|coca|pepsi|refresco/i.test(String(l.itemId) + String(l.readback || "")));
  assert.equal(mq(/quesadilla/i, /bistec/i), 3, `qhr bistec: ${JSON.stringify(cart)}`);
  assert.equal(mq(/taco/i, /bistec/i), 1, `tco bistec: ${JSON.stringify(cart)}`);
  assert.equal(mq(/taco/i, /costilla/i), 2, `tco costilla: ${JSON.stringify(cart)}`);
  const tacos = cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  assert.ok(tacos.every((l: any) => (l.modifiers || []).some((m: any) => /TCO|comal|homemade/i.test(String(m.option)))), "tacos TCO");
  const qhrs = cart.filter((l: any) => /quesadilla/i.test(String(l.itemId)));
  assert.ok(qhrs.every((l: any) => (l.modifiers || []).some((m: any) => /QHR|harina|flour/i.test(String(m.option)))), "quesadillas QHR");
  assert.equal(drinks.length, 0, `no coca: ${JSON.stringify(drinks)}`);
  assert.equal(cart.length, 4, JSON.stringify(cart));
});

