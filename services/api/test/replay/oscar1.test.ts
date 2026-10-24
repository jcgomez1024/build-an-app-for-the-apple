// oscar1: CAb88703e2c21e7970604766307cd81fe8 — Sat Oct 24 ~7:16 PM ET Spanish desk
// Truth: 2 QCO bistec + 1 QCO lengua + 1 QD Regular prensado + 1 QD Regular al pastor + 1 QD Regular bistec.
// Live wrongs: lengua→prensado+bistec; prensado Deluxe not Regular; phantom QD prensado+lengua; 2 pastor not 1 pastor+1 bistec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, rewriteCallerText, listedMeats, DORADA_REG_ID, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = [
  { speaker: "staff", text: "Cocina el vi.", start: 1.1, end: 1.681, language: "es" },
  { speaker: "caller", text: "Sí, bueno, si es.", start: 4.641, end: 5.201, language: "es" },
  { speaker: "staff", text: "Buenas noches.", start: 5.902, end: 6.663, language: "es" },
  { speaker: "caller", text: "Ah, ¿me puede poner dos quesadillas de bistec de comal?", start: 8.042, end: 11.122, language: "es" },
  { speaker: "staff", text: "Muy bien, ¿algo más?", start: 11.925, end: 12.925, language: "es" },
  { speaker: "caller", text: "Una quesadilla de de lengua de comal.", start: 13.943, end: 15.623, language: "es" },
  { speaker: "staff", text: "Muy bien, ¿algo más?", start: 16.527, end: 17.847, language: "es" },
  { speaker: "caller", text: "Una quesadilla de prensado, dorada.", start: 20.064, end: 23.125, language: "es" },
  { speaker: "staff", text: "Muy bien, de prensado dorada, claro.", start: 22.909, end: 25.631, language: "es" },
  { speaker: "caller", text: "Sí.", start: 25.845, end: 25.946, language: "es" },
  { speaker: "staff", text: "Muy bien, ¿algo más?", start: 27.171, end: 28.032, language: "es" },
  { speaker: "caller", text: "Una de pastor doradas.", start: 29.746, end: 30.927, language: "es" },
  { speaker: "staff", text: "Una de al pastor, ¿la quieres preparada o regular? Discúlpame porque, muy bien, ¿algo más?", start: 31.793, end: 37.135, language: "es" },
  { speaker: "caller", text: "No, regular.", start: 34.947, end: 35.508, language: "en" },
  { speaker: "caller", text: "Y una de bistec también dorada.", start: 38.268, end: 39.568, language: "es" },
  { speaker: "staff", text: "Ok, ¿algo más?", start: 40.477, end: 41.557, language: "es" },
  { speaker: "caller", text: "Sería todo.", start: 42.209, end: 42.669, language: "es" },
  { speaker: "staff", text: "Entonces te tengo una que sería dorada de biste, una que sería dorada de al pastor, una que sería dorada de prensado, una que sería de comal de lengua y dos que serían de comal de biste, ¿correcto?", start: 43.378, end: 54.863, language: "es" },
  { speaker: "caller", text: "Sí.", start: 54.692, end: 54.792, language: "es" },
  { speaker: "staff", text: "¿A qué nombre sería la orden?", start: 55.843, end: 57.023, language: "es" },
  { speaker: "caller", text: "Oscar.", start: 57.773, end: 58.113, language: "es" },
  { speaker: "staff", text: "Oscar, ok, Oscar, dame unos,", start: 58.945, end: 61.908, language: "es" },
  { speaker: "staff", text: "mmm, unos veinte minutos.", start: 63.21, end: 65.072, language: "es" },
  { speaker: "caller", text: "¿Ya está bien?", start: 66.077, end: 66.457, language: "es" },
  { speaker: "staff", text: "Ok, gracias.", start: 67.154, end: 68.296, language: "es" },
  { speaker: "caller", text: "Sí, gracias.", start: 68.118, end: 68.999, language: "es" },
] as CallTurn[];

test("oscar1: una de X doradas → quesadilla dorada; de de → de", () => {
  assert.match(rewriteCallerText("Una de pastor doradas."), /quesadillas? doradas de pastor/i);
  assert.match(rewriteCallerText("Y una de bistec también dorada."), /quesadillas? doradas de bistec/i);
  assert.match(rewriteCallerText("Una quesadilla de de lengua de comal."), /de lengua/i);
  assert.doesNotMatch(rewriteCallerText("Una quesadilla de de lengua de comal."), /\bde de\b/i);
  assert.deepEqual(listedMeats(rewriteCallerText("Una de pastor doradas.")).map((x) => x.meat), ["pastor"]);
});

test("oscar1: name Oscar", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Oscar");
});

test("oscar1: 2 QCO bistec + 1 QCO lengua + 3 QD Regular (prensado/pastor/bistec)", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  const cart = r.cart || [];
  const qco = cart.filter((l: any) => /quesadilla/i.test(String(l.itemId)) && !/dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
  const meatQty = (lines: any[], re: RegExp) => lines.filter((l) => (l.modifiers || []).some((m: any) => re.test(String(m.option))))
    .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(meatQty(qco, /bistec|steak/i), 2, `QCO bistec: ${JSON.stringify(cart)}`);
  assert.equal(meatQty(qco, /lengua/i), 1, `QCO lengua: ${JSON.stringify(cart)}`);
  assert.equal(qco.length, 2, `QCO lines: ${JSON.stringify(qco)}`);
  const qd = cart.filter((l: any) => String(l.itemId) === DORADA_REG_ID);
  assert.equal(meatQty(qd, /prensado/i), 1, JSON.stringify(cart));
  assert.equal(meatQty(qd, /pastor/i), 1, JSON.stringify(cart));
  assert.equal(meatQty(qd, /bistec|steak/i), 1, JSON.stringify(cart));
  assert.equal(qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 3);
  const deluxe = cart.filter((l: any) => /zzav3l|deluxe/i.test(String(l.itemId)));
  assert.equal(deluxe.length, 0, `no Deluxe: ${JSON.stringify(deluxe)}`);
});
