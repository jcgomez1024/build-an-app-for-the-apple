// luisSopes1: CAf91320271f6e47b03da6ac1499dd0bc8 — Sat Oct 24 ~7:35 PM ET Spanish desk
// Truth Square XaRHVpCCOqIJzVhqat3K584C4wAZY $75.75: 3 Sopesaso bistec + 3 QHR Regular bistec+chorizo + 3 QD Regular costilla.
// Live wrongs: QHR qty 2 Deluxe (sope lechuga/crema talk bled onto flour); phantom meatless 2nd sopesaso from "sí, son tres sopes".
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, DORADA_REG_ID, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = [
  { speaker: "caller", text: "Eh, quiero hacer un pedido.", start: 1.901, end: 3.101, language: "es" },
  { speaker: "staff", text: "¿Sí me permite un poquito?", start: 4.282, end: 5.282, language: "es" },
  { speaker: "caller", text: "Sí.", start: 5.982, end: 6.082, language: "es" },
  { speaker: "staff", text: "Okay.", start: 6.983, end: 7.203, language: "es" },
  { speaker: "staff", text: "Sí, tres", start: 70.227, end: 74.588, language: "es" },
  { speaker: "caller", text: "Quiero tres sopes de bistec.", start: 72.265, end: 73.666, language: "es" },
  { speaker: "staff", text: "sopes de bistec.", start: 75.709, end: 76.489, language: "es" },
  { speaker: "caller", text: "Sí. Y tres quesadillas de harina, bistec con chorizo.", start: 77.307, end: 82.229, language: "es" },
  { speaker: "staff", text: "Muy bien.", start: 78.39, end: 78.73, language: "es" },
  { speaker: "staff", text: "Muy bien.", start: 83.152, end: 83.832, language: "es" },
  { speaker: "staff", text: "Lechuga, frijoles y crema y queso fresco está bien para los tres sopesazos de bistec.", start: 85.613, end: 91.175, language: "es" },
  { speaker: "caller", text: "Y sin crema.", start: 92.654, end: 93.314, language: "es" },
  { speaker: "staff", text: "Sin crema, ok, muy bien. Y me dijo tres quesadillas de,", start: 94.116, end: 97.598, language: "es" },
  { speaker: "staff", text: "de bistec con chorizo, ¿de qué? ¿De, del comal o de harina?", start: 98.838, end: 102.48, language: "es" },
  { speaker: "caller", text: "De harina.", start: 103.538, end: 103.898, language: "es" },
  { speaker: "staff", text: "Muy bien, ¿algo más?", start: 104.62, end: 105.661, language: "es" },
  { speaker: "caller", text: "Y,", start: 108.18, end: 108.2, language: "es" },
  { speaker: "caller", text: "y también quiero", start: 110.241, end: 111.161, language: "es" },
  { speaker: "caller", text: "tres quesadillas en aceite", start: 112.342, end: 114.043, language: "es" },
  { speaker: "staff", text: "Sí, dígame.", start: 115.004, end: 115.904, language: "es" },
  { speaker: "caller", text: "de costilla.", start: 115.663, end: 116.384, language: "es" },
  { speaker: "staff", text: "Muy bien, ¿cuántas?", start: 117.185, end: 117.965, language: "es" },
  { speaker: "caller", text: "Tres sencillas.", start: 119.285, end: 120.245, language: "es" },
  { speaker: "staff", text: "Tres de costilla, ¿preparadas o regulares?", start: 121.026, end: 123.327, language: "es" },
  { speaker: "caller", text: "Regulares.", start: 123.907, end: 124.447, language: "es" },
  { speaker: "staff", text: "Muy bien, ¿algo más?", start: 125.067, end: 126.008, language: "es" },
  { speaker: "caller", text: "No, es todo.", start: 127.088, end: 127.729, language: "es" },
  { speaker: "staff", text: "Entonces le tengo un sopesazo de bistec, frijoles, lechuga y queso fresco, y luego tres quesadillas de harina de bistec con chorizo, y por último las tres quesadillas doradas de costilla.", start: 128.248, end: 138.532, language: "es" },
  { speaker: "caller", text: "Sí, son tres sopes.", start: 139.474, end: 140.394, language: "es" },
  { speaker: "staff", text: "Sí, son tres sopes, los tres sopes son de bistec.", start: 142.053, end: 144.914, language: "es" },
  { speaker: "caller", text: "Sí, está bien.", start: 143.736, end: 144.316, language: "es" },
  { speaker: "caller", text: "Sí.", start: 145.756, end: 145.877, language: "es" },
  { speaker: "staff", text: "Muy bien, este, ¿me das tu nombre, por favor, para la orden?", start: 145.974, end: 149.155, language: "es" },
  { speaker: "caller", text: "Luis.", start: 149.758, end: 150.078, language: "es" },
  { speaker: "staff", text: "Luis. Ok, Luis, este, ¿me puedes dar unos 25 minutos, por favor?", start: 151.036, end: 156.798, language: "es" },
  { speaker: "caller", text: "Okay.", start: 157.588, end: 158.109, language: "es" },
  { speaker: "staff", text: "Ok, muchas gracias.", start: 158.959, end: 160.199, language: "es" },
  { speaker: "caller", text: "Sí.", start: 160.354, end: 160.495, language: "es" },
] as CallTurn[];

test("luisSopes1: name Luis", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Luis");
});

test("luisSopes1: 3 sopesaso bistec + 3 QHR Regular bistec+chorizo + 3 QD Regular costilla; no phantom sope", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  const cart = r.cart || [];
  const sopes = cart.filter((l: any) => /sopes[ae]so/i.test(String(l.itemId)));
  assert.equal(sopes.length, 1, `sope lines: ${JSON.stringify(sopes)}`);
  assert.equal(sopes[0].quantity || 1, 3);
  assert.ok((sopes[0].modifiers || []).some((m: any) => /bistec|steak/i.test(String(m.option))), JSON.stringify(sopes[0]));
  assert.ok(!(sopes[0].modifiers || []).some((m: any) => /sope elvis/i.test(String(m.option))), "not small Sope Elvis");
  assert.ok(!(sopes[0].modifiers || []).some((m: any) => /crema|sour cream/i.test(String(m.option))), "no crema on sope");

  const qhr = cart.filter((l: any) => /quesadilla/i.test(String(l.itemId)) && !/dorada|zzav3l|t5stuh/i.test(String(l.itemId))
    && (l.modifiers || []).some((m: any) => /QHR|harina|flour/i.test(String(m.option))));
  assert.equal(qhr.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 3, `QHR: ${JSON.stringify(qhr)}`);
  assert.ok(qhr.some((l: any) => (l.modifiers || []).some((m: any) => /bistec|steak/i.test(String(m.option)))));
  assert.ok(qhr.some((l: any) => (l.modifiers || []).some((m: any) => /chorizo/i.test(String(m.option)))));
  assert.equal(qhr.filter((l: any) => (l.modifiers || []).some((m: any) => /\bDELUXE\b/i.test(String(m.option)))).length, 0, "QHR must be Regular not Deluxe");

  const qd = cart.filter((l: any) => String(l.itemId) === DORADA_REG_ID);
  assert.equal(qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 3, `QD: ${JSON.stringify(qd)}`);
  assert.ok(qd.every((l: any) => (l.modifiers || []).some((m: any) => /costilla/i.test(String(m.option)))));
  assert.equal(cart.filter((l: any) => /zzav3l|DELUXE Preparada/i.test(String(l.itemId) + JSON.stringify(l.modifiers))).length, 0);
  assert.equal(cart.length, 3, JSON.stringify(cart));
});
