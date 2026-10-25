// freddy1: CA710ac649668638f9e679218b50cd05f5 — Sat Oct 24 ~7:59 PM ET Spanish desk
// Truth: 5 QD DELUXE Preparada NO crema (2 tripa, 1 bistec, 1 prensado, 1 bistec+chorizo) + 5 TCO tripa.
// Live wrongs: missed deluxe; tripa QD qty 5; phantoms from bistec→tripa taco self-correction; name Tripa not Freddy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, DORADA_DELUXE_ID, DORADA_REG_ID, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = [
  { speaker: "staff", text: '¿Por qué nadie?', start: 1.4, end: 1.9, language: "es" },
  { speaker: "caller", text: 'Oh, buenas noches, ¿eres una orden?', start: 3.9, end: 4.4, language: "es" },
  { speaker: "staff", text: 'Ah, ¿si me permite poquito?', start: 6.6, end: 7.1, language: "es" },
  { speaker: "caller", text: 'Sí, está bien.', start: 8.8, end: 9.3, language: "es" },
  { speaker: "caller", text: 'A ver, ¿cómo? ¿Es que tenemos la fiesta o algo?', start: 15.5, end: 16.0, language: "es" },
  { speaker: "caller", text: 'Is that the little house you see?', start: 19.2, end: 19.7, language: "en" },
  { speaker: "staff", text: 'Ahora sí, dígame.', start: 106.3, end: 106.8, language: "es" },
  { speaker: "caller", text: 'Van a ser tres quesadillas doradas,', start: 109.6, end: 110.1, language: "es" },
  { speaker: "staff", text: '¿De qué?', start: 112.3, end: 112.8, language: "es" },
  { speaker: "caller", text: 'dos de tripa', start: 114.2, end: 114.7, language: "es" },
  { speaker: "caller", text: 'y una de bistec.', start: 115.8, end: 116.3, language: "es" },
  { speaker: "staff", text: 'Dos de tripa y una de bistec.', start: 117.8, end: 118.3, language: "es" },
  { speaker: "staff", text: 'Muy bien, ¿algo más?', start: 120.8, end: 121.3, language: "es" },
  { speaker: "caller", text: 'Eh, van a ser preparadas, pero sin crema. Sí.', start: 122.6, end: 123.1, language: "es" },
  { speaker: "staff", text: 'Okay, muy bien. Thank you. Preparada sin crema. Muy bien, ¿algo más?', start: 125.6, end: 126.1, language: "es" },
  { speaker: "caller", text: 'Eh.', start: 131.7, end: 132.2, language: "es" },
  { speaker: "caller", text: 'Sí, van a ser otra orden, la otra orden van a ser dos quesadillas doradas,', start: 133.5, end: 134.0, language: "es" },
  { speaker: "caller", text: 'una de,', start: 139.0, end: 139.5, language: "es" },
  { speaker: "caller", text: 'una de prensados,', start: 142.8, end: 143.3, language: "es" },
  { speaker: "staff", text: 'También preparada, ¿verdad?', start: 145.0, end: 145.5, language: "es" },
  { speaker: "caller", text: 'y una de bistec con chorizo. Sí, también.', start: 148.8, end: 149.3, language: "es" },
  { speaker: "staff", text: 'Preparadas también, ¿verdad?', start: 151.3, end: 151.8, language: "es" },
  { speaker: "staff", text: 'Una de bistec con chorizo. Muy bien, ¿algo más?', start: 154.8, end: 155.3, language: "es" },
  { speaker: "caller", text: 'Esa también sin crema.', start: 159.3, end: 159.8, language: "es" },
  { speaker: "staff", text: 'No crema. Muy bien, ¿algo más?', start: 162.3, end: 162.8, language: "es" },
  { speaker: "caller", text: 'No, sería todo.', start: 165.5, end: 166.0, language: "es" },
  { speaker: "staff", text: 'Muy bien, entonces te tengo', start: 167.4, end: 167.9, language: "es" },
  { speaker: "staff", text: 'dos quesadillas doradas', start: 169.9, end: 170.4, language: "es" },
  { speaker: "staff", text: 'preparadas, no crema. De tripa, y luego una quesadilla dorada preparada de bistec, no crema.', start: 172.8, end: 173.3, language: "es" },
  { speaker: "staff", text: 'Y luego una quesadilla dorada preparada de prensado, no, esa va, si va a tener crema, pero la última que es de bistec con chorizo, no crema.', start: 180.5, end: 181.0, language: "es" },
  { speaker: "caller", text: 'Nada, nada con crema, las cinco sin crema.', start: 191.1, end: 191.6, language: "es" },
  { speaker: "staff", text: '¿O no crema entonces? Muy bien, entonces deja que le digo en todas no crema. No crema. Ok, ya estamos bien, dame tu nombre.', start: 194.4, end: 194.9, language: "es" },
  { speaker: "caller", text: 'Eh, en las cinco, en las cinco no crema.', start: 196.4, end: 196.9, language: "es" },
  { speaker: "caller", text: 'Eh, todas van a ir deluxe, pero sin crema.', start: 203.7, end: 204.2, language: "es" },
  { speaker: "caller", text: 'Freddy, y van a, va a ser otra orden de cinco taquitos, de', start: 209.8, end: 210.3, language: "es" },
  { speaker: "caller", text: 'cinco tacos de bistec de,', start: 214.9, end: 215.4, language: "es" },
  { speaker: "caller", text: 'de tripa.', start: 217.4, end: 217.9, language: "es" },
  { speaker: "staff", text: '¿De qué?', start: 217.8, end: 218.3, language: "es" },
  { speaker: "caller", text: 'Cinco tacos de tripa.', start: 218.9, end: 219.4, language: "es" },
  { speaker: "caller", text: 'Bien dorada.', start: 222.1, end: 222.6, language: "es" },
  { speaker: "staff", text: 'Muy bien, ¿de taquero?', start: 224.0, end: 224.5, language: "es" },
  { speaker: "caller", text: 'De comal.', start: 226.8, end: 227.3, language: "es" },
  { speaker: "staff", text: 'Muy bien, entonces cinco tacos taqueros de Comal.', start: 228.1, end: 228.6, language: "es" },
  { speaker: "caller", text: 'No, cinco tacos de comal,', start: 232.3, end: 232.8, language: "es" },
  { speaker: "caller", text: 'de bistec.', start: 234.5, end: 235.0, language: "es" },
  { speaker: "staff", text: 'Sí, taque, ok. De Vist,', start: 234.6, end: 235.1, language: "es" },
  { speaker: "caller", text: 'De tripa, de tripa, sí, de tripa.', start: 237.5, end: 238.0, language: "es" },
  { speaker: "caller", text: 'De tripa, los cinco tacos de tripa.', start: 241.1, end: 241.6, language: "es" },
  { speaker: "staff", text: 'Ok, entonces tengo cinco ta, cinco del comal de tripa.', start: 243.6, end: 244.1, language: "es" },
  { speaker: "caller", text: 'Sí.', start: 248.1, end: 248.6, language: "es" },
  { speaker: "staff", text: 'Muy bien,', start: 249.4, end: 249.9, language: "es" },
  { speaker: "staff", text: 'dame unos treinta minutos.', start: 250.8, end: 251.3, language: "es" },
  { speaker: "caller", text: 'Okay.', start: 253.9, end: 254.4, language: "es" },
  { speaker: "staff", text: 'Ok, gracias.', start: 255.2, end: 255.7, language: "es" },
] as CallTurn[];

test("freddy1: name Freddy not Tripa", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Freddy");
});

test("freddy1: 5 QD deluxe no-crema + 5 TCO tripa; no phantoms", async () => {
  const r: any = await shadowOrderFromTurns(turns, async () => ({ actions: [], reply: "?" }));
  const cart = r.cart || [];
  const qd = cart.filter((l: any) => String(l.itemId) === DORADA_DELUXE_ID);
  const qdQty = qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qdQty, 5, `QD deluxe qty: ${JSON.stringify(qd)}`);
  assert.equal(cart.filter((l: any) => String(l.itemId) === DORADA_REG_ID).length, 0, "no regular Dorada");
  const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => /bistec|tripa|prensado|chorizo|lengua|cabeza|pastor/i.test(o));
  const has = (re: RegExp, q = 1) => qd.some((l: any) => (Number(l.quantity) || 1) === q && meatOf(l).some((o: string) => re.test(o))
    && (re.source.includes("chorizo") ? meatOf(l).some((o: string) => /bistec/i.test(o)) : true));
  assert.ok(qd.some((l: any) => (Number(l.quantity) || 1) === 2 && meatOf(l).some((o: string) => /tripa/i.test(o))), "2 tripa");
  assert.ok(qd.some((l: any) => (Number(l.quantity) || 1) === 1 && meatOf(l).length === 1 && meatOf(l).some((o: string) => /bistec/i.test(o))), "1 bistec alone");
  assert.ok(qd.some((l: any) => (Number(l.quantity) || 1) === 1 && meatOf(l).some((o: string) => /prensado/i.test(o))), "1 prensado");
  assert.ok(qd.some((l: any) => (Number(l.quantity) || 1) === 1 && meatOf(l).some((o: string) => /bistec/i.test(o)) && meatOf(l).some((o: string) => /chorizo/i.test(o))), "1 bistec+chorizo");
  assert.ok(qd.every((l: any) => (l.elviNotes || []).some((n: string) => /no crema/i.test(n))), "no crema notes");
  const tco = cart.filter((l: any) => /taco/i.test(String(l.itemId))
    && (l.modifiers || []).some((m: any) => /TCO|comal|homemade/i.test(String(m.option)))
    && (l.modifiers || []).some((m: any) => /tripa/i.test(String(m.option))));
  assert.equal(tco.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 5, `TCO tripa: ${JSON.stringify(tco)}`);
  assert.equal(cart.filter((l: any) => /taco/i.test(String(l.itemId)) && (l.modifiers || []).some((m: any) => /TST|taquer|street/i.test(String(m.option)))).length, 0, "no TST phantoms");
  assert.equal(cart.filter((l: any) => /taco/i.test(String(l.itemId)) && (l.modifiers || []).some((m: any) => /bistec/i.test(String(m.option)))).length, 0, "no taco bistec phantom");
  assert.equal(cart.length, 5, JSON.stringify(cart));
});
