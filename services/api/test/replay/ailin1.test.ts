// ailin1 (CAb7b203): 4+2+2 QD deluxe APARTE (prensado/picadillo/nopales) + 2 QCO bistec sin verdura.
// Not tacos; no qty double from staff readback echo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const stub = async () => ({ actions: [] as any[], reply: "?" });

const ailinTurns: CallTurn[] = [
  T("staff", "Cocina Elvis.", 0),
  T("caller", "Hola, buenos días. Eh, ¿te puedo hacer un pedido?", 2),
  T("staff", "Claro, ¿qué vas a querer?", 5),
  T("caller", "Mira, van a ser ocho quesadillas, eh, de,", 7),
  T("caller", "en aceite. Sí venden de aceite, ¿verdad? Sí. Eh, van a ser,", 9),
  T("staff", "Claro,", 11),
  T("staff", "¿de qué te las voy a poner?", 12),
  T("caller", "ponme cuatro de prensado.", 14),
  T("staff", "¿Van a ser preparadas o regulares?", 16),
  T("caller", "Eh, las quiero preparadas, pero quiero todo aparte, o sea, la verdura aparte, por favor.", 18),
  T("staff", "Muy bien,", 21),
  T("staff", "muy bien, entonces, mira, te puse cuatro de prensado aparte,", 22),
  T("caller", "Sí.", 24),
  T("staff", "ah, bueno, aparte la verdura, preparadas,", 25),
  T("caller", "Ajá, y,", 27),
  T("caller", "sí.", 28),
  T("staff", "doradas. ¿Algo más?", 29),
  T("caller", "Eh, ¿de qué Ica tienes? ¿De qué guisado tienes?", 31),
  T("staff", "Mira, tengo de los guisados, tengo de prensado duro de cebrada, picadillo, nopales con papas, papas Con rajas, huevo con chile, frijoles,", 34),
  T("caller", "Okay, eh, ¿las quieres de picadillo o de pollo?", 38),
  T("caller", "Sí, de picadillo. Eh, y dos de picadillo, me pones otras dos de picadillo y dijis, y dos de papa con", 40),
  T("caller", "nopales.", 43),
  T("staff", "dos de picadillo preparadas con todo aparte, y dos de", 44),
  T("staff", "papas con nopales o papas con rajas.", 46),
  T("caller", "Papas con nopales. Sí. Y me pones dos de comal,", 48),
  T("staff", "Papas con nopales también preparadas y todo aparte también. Muy bien, ¿algo más?", 50),
  T("staff", "Dos de comal, ¿de qué te las pongo?", 53),
  T("caller", "dos de comal, no en aceite,", 55),
  T("caller", "ajá, de, de bistec. Eh, nada más, es tortilla de masa, ¿verdad? Nada más que de comal sin aceite. Okay.", 57),
  T("staff", "De biste, muy bien, ¿algo más?", 61),
  T("caller", "Nada más. Y eso también sin, eso sin verdura, sin verdura, sin nada.", 64),
  T("staff", "Okay, mira, te tengo dos quesadillas del comal de biste, dos quesadillas preparadas todo aparte de nopales con papas, dos quesadillas doradas preparadas todo aparte de picadillo, y por último te tengo cuatro quesadillas doradas preparadas todo aparte de prensado.", 68),
  T("caller", "Sí.", 75),
  T("staff", "Okay, ¿a qué nombre sería la orden?", 76),
  T("caller", "Aileen, soy Aileen.", 78),
  T("staff", "Ailín, muy bien, dame,", 80),
  T("staff", "ah, dame unos veinticinco minutos.", 81),
  T("caller", "Okey, está muy bien, es como que ahorita ya casi llego, pero como quiera ahí me espero.", 83),
];

test("ailin1: 4+2+2 QD deluxe APARTE + 2 QCO bistec sin verdura; no tacos", async () => {
  const r: any = await shadowOrderFromTurns(ailinTurns.map((t) => ({ ...t })), stub as any);
  const lines = r.cart.map((l: any) => ({
    q: l.quantity,
    id: String(l.itemId).slice(0, 40),
    mods: (l.modifiers || []).map((m: any) => m.option),
    notes: l.elviNotes,
  }));
  const qd = r.cart.filter((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
  const qco = r.cart.filter((l: any) => /quesadilla/i.test(String(l.itemId)) && !/dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
  const tacos = r.cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  const qdN = qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const qcoN = qco.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qdN, 8, "8 QD: " + JSON.stringify(lines));
  assert.equal(qcoN, 2, "2 QCO: " + JSON.stringify(lines));
  assert.equal(tacos.length, 0, "no tacos: " + JSON.stringify(lines));
  const pren = qd.filter((l: any) => (l.modifiers || []).some((m: any) => /Prensado/i.test(m.option)));
  const pica = qd.filter((l: any) => (l.modifiers || []).some((m: any) => /Picadillo/i.test(m.option)));
  const nopa = qd.filter((l: any) => (l.modifiers || []).some((m: any) => /Nopales/i.test(m.option)));
  assert.equal(pren.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 4, JSON.stringify(lines));
  assert.equal(pica.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2, JSON.stringify(lines));
  assert.equal(nopa.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2, JSON.stringify(lines));
  assert.ok(qd.every((l: any) =>
    (l.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(m.option))
    && (l.modifiers || []).some((m: any) => /APARTE|EVERTHING ON SIDE/i.test(m.option))),
    "all QD deluxe APARTE: " + JSON.stringify(lines));
  assert.ok(qco.every((l: any) =>
    (l.modifiers || []).some((m: any) => /Bistec/i.test(m.option))
    && (l.modifiers || []).some((m: any) => /comal|QCO|Homemade/i.test(m.option))),
    "QCO bistec: " + JSON.stringify(lines));
  assert.ok(qco.every((l: any) => (l.elviNotes || []).some((n: string) => /sin verdura/i.test(n))),
    "sin verdura notes: " + JSON.stringify(lines));
});
