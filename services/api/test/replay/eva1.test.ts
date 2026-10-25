// eva1 (CA4f480f): 1 menudo CON pata + 3 QD Deluxe (duro/prensado/nopales).
// Aceite + preparadas → DELUXE not REG. Ujú / Ahí va are NOT names (staff Eva).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromAnswer, nameFromTranscriptInfo } from "../../src/order-name.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
const DELUXE = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const REG = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";

const stub = async (text: string) => {
  if (/menudo/i.test(text) && /pata|papa/i.test(text))
    return { actions: [] as any[], reply: "Menudo: ¿Menudo con Tortillas (4) o Con Pata Menudo 32oz y Tortillas (4)?" };
  if (/quesadilla|QD|aceite|dorada/i.test(text))
    return { actions: [] as any[], reply: "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?" };
  return { actions: [] as any[], reply: "?" };
};

const eva: CallTurn[] = [
  T("staff", "Buenos días.", 0),
  T("caller", "Sí, buenos días. ¿Sí hay menudo todavía?", 2),
  T("staff", "Sí, claro. ¿Qué le vamos a dar?", 5),
  T("caller", "Ah, me preparas un menudo con pata, por favor.", 8),
  T("staff", "Un menudo con patas, claro, ¿algo más?", 12),
  T("caller", "Y, y tres, tres quesadillas en aceite, por favor.", 15),
  T("staff", "Ah, ¿de qué se las voy a dar las quesadillas?", 18),
  T("caller", "Mm, de, una de chicharrón del duro,", 21),
  T("staff", "Muy bien.", 23),
  T("caller", "y, y una de prensado, y una de papas con opales.", 25),
  T("staff", "Las quesadillas van a ser regulares o preparadas. Okay.", 28),
  T("caller", "Como regulares, ¿eh? Preparadas, sí, está bien.", 31),
  T("staff", "¿Preparadas?", 34),
  T("caller", "Sí.", 35),
  T("staff", "Muy bien, ¿algo más?", 36),
  T("caller", "Será nada más.", 38),
  T("staff", "Okay, ¿a qué nombre sería la orden?", 40),
  T("caller", "Ahí va.", 42),
  T("staff", "Eva, muy bien, Eva.", 43),
  T("caller", "Ujú.", 45),
  T("staff", "Dame unos veinte minutos, por favor.", 46),
  T("caller", "Sí, me voy a tardar un ratito, ¿sí? ¿Está bien?", 48),
];

test("eva1: 1 menudo CON + 3 QD Deluxe (duro/prensado/nopales); no REG", async () => {
  const r = await shadowOrderFromTurns(eva, stub as any);
  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  assert.equal(menudo.length, 1, `menudo lines: ${JSON.stringify(menudo)}`);
  assert.equal(String(menudo[0].itemId), CON);
  assert.equal(Number(menudo[0].quantity), 1);
  const qd = r.cart.filter((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
  assert.equal(qd.length, 3, `expected 3 QD, got ${qd.length}: ${JSON.stringify(qd)}`);
  assert.ok(qd.every((l: any) => l.itemId === DELUXE || /ZZAV3L/i.test(String(l.itemId))), `all DELUXE: ${JSON.stringify(qd)}`);
  assert.ok(!r.cart.some((l: any) => l.itemId === REG || /T5STUH/i.test(String(l.itemId))), "no REG lines");
  const meats = qd.map((l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" ")).join(" | ");
  assert.match(meats, /Duro/i);
  assert.match(meats, /Prensado/i);
  assert.match(meats, /Nopales/i);
});

test("eva1: Ujú / Ahí va not names; staff Eva wins", () => {
  assert.equal(nameFromAnswer("Ujú"), null);
  assert.equal(nameFromAnswer("Ahí va"), null);
  assert.equal(nameFromTranscriptInfo(eva as any)?.name, "Eva");
});
