// jorge1: CA7ea9674c76826373bdbd112ddb210c17 — Sat Oct 24 ~6:48 PM ET
// Desk-answered Spanish callback (related CAc56af711 ~6:46 was pozole Q only).
// Truth Square NljU303h0uYJvSm5aiMAPamk8BaZY $27.50 name Jorge:
//   1 Pozole Rojo de puerco + 2 QD Regular (dorada) chicharrón prensado; pickup ~20 min.
// Live wrongs: 2× Pozole Rojo (duplicate); 2× QCO prensado (missed dorada/regular after reject-comal).
// NAME: 'A nombre de Jorge. Jorge va a pasar por ellos.' = pickup/ticket only, NOT caller identity.
// Junk 'Ey Cuánto Sería' from 'Okey, ¿cuánto sería?' must NOT save as caller identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, listedMeats, rewriteCallerText, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromAnswer, nameFromTranscriptInfo, thirdPersonName } from "../../src/order-name.ts";

/** Live desk turns from recording RE87e81f050b8d2753fefa56a7f948ab1e. */
const turns = [
  { speaker: "staff", text: 'Cocina Elvis.', start: 0.6, end: 1.54, language: "es" },
  { speaker: "caller", text: '¿Te pueden cargar un pozole rojo, por favor?', start: 3.24, end: 5.781, language: "es" },
  { speaker: "staff", text: 'Claro, ¿algo más?', start: 6.421, end: 7.722, language: "es" },
  { speaker: "caller", text: 'Y', start: 8.921, end: 8.941, language: "es" },
  { speaker: "caller", text: 'dos quesadillas de chicharrón prensado.', start: 10.241, end: 12.222, language: "es" },
  { speaker: "staff", text: 'Dos quesadillas de chicharrón prensado del comal, ¿verdad?', start: 13.463, end: 16.504, language: "es" },
  { speaker: "caller", text: 'No, tiene fritas en aceite.', start: 17.523, end: 19.543, language: "es" },
  { speaker: "staff", text: 'Ah, sí, claro.', start: 20.124, end: 20.865, language: "es" },
  { speaker: "caller", text: 'Ok, dos, por favor.', start: 21.923, end: 23.043, language: "es" },
  { speaker: "staff", text: 'Ah, ¿las quieres preparadas o regulares?', start: 23.865, end: 25.866, language: "es" },
  { speaker: "caller", text: 'No, regulares.', start: 26.844, end: 27.604, language: "es" },
  { speaker: "staff", text: 'Muy bien, ¿algo más?', start: 28.286, end: 29.287, language: "es" },
  { speaker: "caller", text: 'Es todo.', start: 30.464, end: 31.065, language: "es" },
  { speaker: "staff", text: 'Entonces, te tengo dos quesadillas preparadas', start: 31.987, end: 34.488, language: "es" },
  { speaker: "staff", text: 'doradas de prensado y un pozole rojo.', start: 35.568, end: 38.929, language: "es" },
  { speaker: "caller", text: 'Sí, ¿cómo en cuánto tiempo, más o menos?', start: 40.266, end: 42.326, language: "es" },
  { speaker: "staff", text: 'Dame unos veinte minutos, ¿a qué nombre sería la orden?', start: 42.95, end: 46.45, language: "es" },
  { speaker: "caller", text: 'A nombre de Jorge. Jorge va a pasar por ellos.', start: 47.467, end: 49.547, language: "es" },
  { speaker: "staff", text: '¿Jorge?', start: 50.251, end: 50.671, language: "es" },
  { speaker: "caller", text: 'Ajá.', start: 51.748, end: 51.888, language: "es" },
  { speaker: "staff", text: 'Muy bien. Eh, dame unos, sí, unos veinte minutos, por favor.', start: 53.072, end: 57.133, language: "es" },
  { speaker: "caller", text: 'Okey, ¿cuánto sería?', start: 58.01, end: 58.91, language: "es" },
  { speaker: "staff", text: 'Ah, serían 27:50. Oh, sí, entonces, sí, está bien.', start: 59.614, end: 70.438, language: "es" },
  { speaker: "caller", text: 'Okey, eh, yo creo que como en 25 minutos hablaría por ella, ¿está bien?', start: 62.933, end: 68.176, language: "es" },
  { speaker: "caller", text: 'Sí, okey, muchas gracias, mi amiga.', start: 71.538, end: 73.459, language: "es" },
  { speaker: "staff", text: 'A ti.', start: 73.619, end: 73.899, language: "es" },
] as CallTurn[];

test("jorge1: chicharrón prensado → listedMeats prensado", () => {
  const t = rewriteCallerText("dos quesadillas de chicharrón prensado.");
  assert.match(t, /prensado/i);
  assert.doesNotMatch(t, /chicharr/i);
  assert.deepEqual(listedMeats(t).map((x) => x.meat), ["prensado"]);
});

test("jorge1: phrase-as-name blocked; Jorge is third-person pickup", () => {
  assert.equal(nameFromAnswer("Okey, ¿cuánto sería?"), null);
  assert.equal(nameFromAnswer("A nombre de Jorge. Jorge va a pasar por ellos."), "Jorge");
  assert.equal(thirdPersonName("A nombre de Jorge. Jorge va a pasar por ellos."), "Jorge");
  const info = nameFromTranscriptInfo(turns as any);
  assert.equal(info?.name, "Jorge");
  assert.equal(info?.thirdPerson, true);
});

test("jorge1: 1 pozole rojo + 2 QD Regular prensado (stub)", async () => {
  const run = async () => ({ actions: [], reply: "?" });
  const r: any = await shadowOrderFromTurns(turns, run as any);
  const poz = (r.cart || []).filter((l: any) => /pozole/i.test(String(l.itemId)));
  assert.equal(poz.length, 1, `pozole lines: ${JSON.stringify(r.cart)}`);
  assert.equal(poz[0].quantity || 1, 1);
  const qd = (r.cart || []).filter((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
  assert.equal(qd.length, 1, `QD lines: ${JSON.stringify(r.cart)}`);
  assert.equal(qd[0].quantity || 1, 2);
  assert.match(String(qd[0].itemId), /regular|t5stuh/i);
  const mods = (qd[0].modifiers || []).map((m: any) => String(m.option)).join(" ");
  assert.match(mods, /prensado/i);
  assert.match(mods, /REGULAR Dorada/i);
  const qco = (r.cart || []).filter((l: any) => /quesadilla/i.test(String(l.itemId)) && !/dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
  assert.equal(qco.length, 0, `no QCO left: ${JSON.stringify(qco)}`);
});

