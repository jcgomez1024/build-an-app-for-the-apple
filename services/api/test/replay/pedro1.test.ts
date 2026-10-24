// pedro1: CA558b65afd904d8eafe161131e5200745 — Sat Oct 24 ~7:14 PM ET Spanish desk
// Truth Square: 1 Pozole Rojo de puerco only. Beef pozole + mangonadas → no (we don't sell).
// Live wrong: 4× Pozole Rojo — every confirm/repeat re-added. Name Pedro OK ("De Pedro").
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = [
  { speaker: "staff", text: "¿Posina Elvis?", start: 0.64, end: 1.62, language: "es" },
  { speaker: "caller", text: "Ah, buenas tardes, ¿puedo poner una orden? Ah, ¿puedes ir a un pozole? Ah,", start: 3.061, end: 12.124, language: "es" },
  { speaker: "staff", text: "Ah, sí, claro, dígame.", start: 6.021, end: 7.261, language: "es" },
  { speaker: "staff", text: "Ah, tenemos pozole rojo de puerco.", start: 11.622, end: 13.742, language: "es" },
  { speaker: "caller", text: "no tienen de vaca.", start: 16.265, end: 17.145, language: "es" },
  { speaker: "staff", text: "No, de vaca no, puro de puerco.", start: 18.883, end: 21.263, language: "es" },
  { speaker: "caller", text: "No, es una orden de pozole, por favor.", start: 25.588, end: 27.948, language: "es" },
  { speaker: "staff", text: "Sí, sí te voy a dar el pozole de puerco. Sí, o te lo doy de chivo.", start: 29.924, end: 42.346, language: "es" },
  { speaker: "caller", text: "Sí, sí, del pozole rojo.", start: 36.131, end: 37.171, language: "es" },
  { speaker: "staff", text: "Ya, ya.", start: 46.367, end: 46.847, language: "es" },
  { speaker: "caller", text: "Y una, que si quieres pozole chivo, ¿no?", start: 48.755, end: 51.656, language: "es" },
  { speaker: "caller", text: "Sí, el pozole rojo, por favor, y, y dos mangoneadas, ¿no?", start: 53.476, end: 57.138, language: "es" },
  { speaker: "staff", text: "No, pues aquí no venden mangonadas, aquí no estamos en la Michoacana o en la visita.", start: 58.709, end: 62.971, language: "en" },
  { speaker: "caller", text: "El pozole está bien.", start: 66.984, end: 67.864, language: "es" },
  { speaker: "staff", text: "Okay, ¿a nombre de quién sería?", start: 69.172, end: 71.293, language: "es" },
  { speaker: "caller", text: "De Pedro.", start: 72.827, end: 73.287, language: "es" },
  { speaker: "staff", text: "De Pedro.", start: 74.914, end: 75.774, language: "es" },
  { speaker: "staff", text: "¿Pedro Picapiedra o qué?", start: 77.115, end: 78.635, language: "es" },
  { speaker: "staff", text: "Pedro Picapiedra, okay, Pedro Picapiedra, dame unos quince minutos.", start: 85.157, end: 90.158, language: "es" },
  { speaker: "caller", text: "Okay, está bien.", start: 91.297, end: 92.058, language: "es" },
  { speaker: "staff", text: "Okay, bye.", start: 92.939, end: 94.58, language: "es" },
] as CallTurn[];

test("pedro1: name Pedro", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Pedro");
});

test("pedro1: exactly 1 Pozole Rojo; no mangonada invent", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  const cart = r.cart || [];
  const poz = cart.filter((l: any) => /pozole/i.test(String(l.itemId)));
  assert.equal(poz.length, 1, JSON.stringify(cart));
  assert.equal(poz[0].quantity || 1, 1);
  assert.match(String(poz[0].itemId), /rojo|DQ7X4J/i);
  assert.equal(cart.filter((l: any) => /mangon|michoacana|drink|agua|refresco/i.test(String(l.itemId))).length, 0);
  assert.equal(cart.length, 1, JSON.stringify(cart));
});
