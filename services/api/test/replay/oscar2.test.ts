// oscar2: CA62868055ddcda9d75fdb618f10071e2e — Sat Oct 24 ~8:46 PM ET Spanish desk (staff-answered)
// Truth: 4 TCO — 1 cabeza, 1 lengua, 1 tripa, 1 costilla. Staff "¿Y el último?" → "de costilla."
// Live wrong: 4th duplicated cabeza; short meat after último echoed first meat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = [
  { speaker: "staff", text: 'Okay.', start: 0.8, end: 1.08, language: "es" },
  { speaker: "staff", text: 'Cocina, Elvis.', start: 2.441, end: 3.461, language: "es" },
  { speaker: "caller", text: 'Eh, buenas noches.', start: 4.521, end: 5.341, language: "es" },
  { speaker: "staff", text: 'Buenas noches.', start: 6.002, end: 6.642, language: "es" },
  { speaker: "caller", text: '¿Me tienes tacos de tortilla de comal, de maíz?', start: 7.242, end: 11.063, language: "es" },
  { speaker: "staff", text: 'Ah, sí, claro.', start: 11.063, end: 12.243, language: "es" },
  { speaker: "caller", text: '¿Me puede preparar cuatro tacos?', start: 12.943, end: 14.424, language: "es" },
  { speaker: "staff", text: 'Cuatro, claro, de tortilla del pumal, ¿verdad?', start: 15.104, end: 17.965, language: "es" },
  { speaker: "caller", text: 'Sí, por favor.', start: 18.405, end: 19.185, language: "es" },
  { speaker: "staff", text: '¿De qué te los voy a poner?', start: 19.605, end: 20.766, language: "es" },
  { speaker: "caller", text: 'A ver, me pones uno de, uno de cabeza,', start: 21.286, end: 23.706, language: "es" },
  { speaker: "staff", text: 'Uno de cabeza, ajá.', start: 24.687, end: 26.087, language: "es" },
  { speaker: "caller", text: 'uno de lengua,', start: 26.967, end: 27.687, language: "es" },
  { speaker: "staff", text: 'Muy bien, ¿y el otro?', start: 28.508, end: 30.108, language: "es" },
  { speaker: "caller", text: 'uno de tripa,', start: 30.848, end: 31.608, language: "es" },
  { speaker: "staff", text: '¿Y el último?', start: 32.809, end: 33.549, language: "es" },
  { speaker: "caller", text: 'de costilla.', start: 34.289, end: 35.049, language: "es" },
  { speaker: "staff", text: 'Muy bien,', start: 36.33, end: 37.13, language: "es" },
  { speaker: "staff", text: 'okay. Entonces te tengo un taco de, perdón, ¿me dijiste dos de cabeza o uno?', start: 38.11, end: 45.052, language: "es" },
  { speaker: "caller", text: 'Uno de cabeza.', start: 45.732, end: 46.392, language: "es" },
  { speaker: "staff", text: 'Okay, uno de cabeza, un taco de comal de lengua, un taco de comal de tripa, y por último, un taco de comal de costilla.', start: 47.073, end: 54.655, language: "es" },
  { speaker: "caller", text: 'Perfecto.', start: 55.415, end: 55.915, language: "es" },
  { speaker: "staff", text: 'Okay, ¿sería todo?', start: 56.595, end: 57.696, language: "es" },
  { speaker: "caller", text: 'Sí.', start: 58.436, end: 58.536, language: "es" },
  { speaker: "staff", text: '¿Me das tu nombre?', start: 59.557, end: 60.438, language: "es" },
  { speaker: "caller", text: 'Eh, Oscar.', start: 61.118, end: 61.638, language: "es" },
  { speaker: "staff", text: 'Oscar. Muy bien, Oscar, dame unos veinte minutos.', start: 63.182, end: 67.787, language: "es" },
  { speaker: "caller", text: 'Okey, ¿cuánto sería?', start: 68.287, end: 68.948, language: "es" },
  { speaker: "staff", text: 'Seri,', start: 69.89, end: 70.13, language: "es" },
  { speaker: "staff", text: 'serían diecisiete cincuenta.', start: 71.112, end: 72.754, language: "es" },
  { speaker: "caller", text: 'Okey, gracias.', start: 73.454, end: 74.115, language: "es" },
  { speaker: "staff", text: 'Gracias.', start: 74.716, end: 75.217, language: "es" },
] as CallTurn[];

test("oscar2: name Oscar", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Oscar");
});

test("oscar2: 4 TCO cabeza/lengua/tripa/costilla; no duplicate cabeza", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  const cart = r.cart || [];
  const tacos = cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  assert.equal(tacos.length, 4, JSON.stringify(cart));
  assert.ok(tacos.every((l: any) => (l.modifiers || []).some((m: any) => /TCO|comal|homemade/i.test(String(m.option)))), "all TCO");
  const meatQty = (re: RegExp) => tacos.filter((l: any) => (l.modifiers || []).some((m: any) => re.test(String(m.option))))
    .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(meatQty(/cabeza/i), 1, `cabeza: ${JSON.stringify(tacos)}`);
  assert.equal(meatQty(/lengua/i), 1);
  assert.equal(meatQty(/tripa/i), 1);
  assert.equal(meatQty(/costilla/i), 1, `costilla: ${JSON.stringify(tacos)}`);
  assert.equal(cart.length, 4, JSON.stringify(cart));
});
