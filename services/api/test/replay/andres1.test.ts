// andres1 (CAd21803): 3 QD Deluxe bistec + 1 chorizo Deluxe + Side arroz stays (26S6E6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const ARROZ = "sq-sides-arroz-rice-26S6E6";
const DELUXE = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";

const stub = async (text: string) => {
  if (/quesadilla|aceite|dorada|preparad/i.test(text))
    return { actions: [] as any[], reply: "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?" };
  if (/arroz/i.test(text) && !/quesadilla|dorada|mole/i.test(text))
    return {
      actions: [{ type: "add_item", itemId: ARROZ, quantity: 1, modifiers: [], readback: "side rice" }],
      reply: "Sides Arroz. $4.00. ¿Algo más?",
    };
  return { actions: [] as any[], reply: "?" };
};

const andres: CallTurn[] = [
  T("staff", "Cocina Elvis, buenos días.", 0),
  T("caller", "Buenos días, quisiera hacer una orden.", 2),
  T("staff", "A ver, dime.", 5),
  T("caller", "Van a ser, ¿cuántos? Tres, tres quesadillas en aceite de bistec.", 7),
  T("staff", "¿Preparadas o normales?", 11),
  T("caller", "Preparadas.", 13),
  T("staff", "¿Qué más?", 15),
  T("caller", "Y una de chorizo.", 17),
  T("staff", "¿También dorada? ¿También preparada?", 19),
  T("caller", "Sí, por favor.", 21),
  T("staff", "¿Qué más?", 23),
  T("caller", "Y una orden de arroz.", 25),
  T("staff", "Un sal de arroz. ¿Qué más, joven?", 27),
  T("caller", "Sería todo.", 29),
  T("staff", "¿Tu nombre?", 31),
  T("caller", "Andrés, Andrés.", 33),
  T("staff", "Okay, Andrés, dame veinticinco minutos.", 35),
];

test("andres1: 3+1 QD Deluxe + arroz side stays", async () => {
  const r = await shadowOrderFromTurns(andres, stub as any);
  const arroz = r.cart.filter((l: any) => /arroz|26S6E6/i.test(String(l.itemId)));
  assert.equal(arroz.length, 1, `arroz must stay: ${JSON.stringify(r.cart)}`);
  assert.equal(String(arroz[0].itemId), ARROZ);
  const qd = r.cart.filter((l: any) => /dorada|zzav3l/i.test(String(l.itemId)));
  const qdQty = qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.ok(qdQty >= 4, `expected ≥4 QD deluxe, got ${qdQty}: ${JSON.stringify(qd)}`);
  assert.ok(qd.every((l: any) => /ZZAV3L|DELUXE|deluxe/i.test(String(l.itemId) + (l.modifiers || []).map((m: any) => m.option).join(" "))),
    `all deluxe: ${JSON.stringify(qd)}`);
});
