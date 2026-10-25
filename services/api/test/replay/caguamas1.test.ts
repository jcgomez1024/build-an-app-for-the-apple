// caguamas1 (CAf8bc75): 3 QHR al pastor + horchata + 4 QD REG costilla + 1 QD REG prensado + DELIVERY.
// Caller "de harina" wins over staff comal; street Williams ≠ customerName.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo, nameFromAnswer } from "../../src/order-name.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const REG = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
const QHR = "sq-quesadilla-HLT6CR";
const HORCH = "sq-drink-agua-fresca-horchata-32oz";

/** Miss stub: flour→comal + under-count doradas (the live failure mode). */
const missStub = async (text: string) => {
  if (/pastor|harina|comal/i.test(text))
    return {
      actions: [{
        type: "add_item",
        itemId: QHR,
        quantity: 3,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
          { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" },
        ],
        readback: "3 QCO pastor",
      }],
      reply: "3 comal pastor",
    };
  if (/costilla|dorada|prensado/i.test(text))
    return {
      actions: [{
        type: "add_item",
        itemId: REG,
        quantity: 2,
        modifiers: [
          { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
          { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" },
        ],
        readback: "2 QD costilla",
      }],
      reply: "2 doradas",
    };
  if (/horchata/i.test(text))
    return {
      actions: [{ type: "add_item", itemId: HORCH + "-HL6HPK", quantity: 1, modifiers: [], readback: "horchata" }],
      reply: "horchata",
    };
  return { actions: [] as any[], reply: "?" };
};

const caguamas: CallTurn[] = [
  T("staff", "Sí, dígame.", 0),
  T("caller", "Sí, este, me pone tres quesadillas de pastor y de esta, de harina.", 2),
  T("staff", "Tres quesadillas de al pastor del comal, ¿verdad? ¿O de harina?", 6),
  T("caller", "Sí, de de harina.", 9),
  T("staff", "¿De harina, de al pastor, algo más?", 12),
  T("caller", "Y un agua de, ¿de qué tiene? ¿De horchata o qué tiene?", 14),
  T("staff", "Horchata y Jamaica.", 17),
  T("caller", "De horchata, por favor.", 19),
  T("staff", "Muy bien, ¿y me das tu dirección, por favor?", 21),
  T("caller", "Eh, van a ser más.", 24),
  T("staff", "Ok.", 26),
  T("caller", "Dos quesadillas doradas de costilla.", 28),
  T("staff", "Dos quesadillas doradas de costilla, muy bien. ¿Preparadas o regulares?", 31),
  T("caller", "No, regulares.", 34),
  T("staff", "Muy bien, ¿algo más?", 36),
  T("caller", "¿Sería otra tres pegadillas?", 38),
  T("staff", "¿De qué te las pongo?", 40),
  T("caller", "¿Tiene costilla?", 42),
  T("staff", "Sí.", 44),
  T("caller", "Me pone dos de costilla y chicharrón prensado tiene.", 46),
  T("staff", "Sí.", 49),
  T("caller", "Y una de chicharrón prensado.", 51),
  T("staff", "Regulares también, ¿verdad?", 53),
  T("caller", "Sí.", 55),
  T("staff", "Muy bien.", 56),
  T("caller", "Y un agua de horchata también.", 58),
  T("staff", "¿Algo más?", 60),
  T("caller", "Sí. A a la William 544.", 62),
  T("staff", "Okay, ¿a qué dirección sería la, la entrega? Williams, quinientos cuarenta y cuatro.", 65),
  T("caller", "Sí.", 70),
];

function mods(l: any): string {
  return (l.modifiers || []).map((m: any) => String(m.option)).join(" ");
}

test("caguamas1: 3 QHR pastor + 4 QD costilla + 1 QD prensado + horchata + DELIVERY", async () => {
  const r = await shadowOrderFromTurns(caguamas, missStub as any);
  assert.equal(r.fulfillment, "DELIVERY", `fulfillment: ${r.fulfillment}`);

  const flour = r.cart.filter((l: any) => /HLT6CR|quesadilla/i.test(String(l.itemId)) && !/dorada|t5stuh|zzav3l/i.test(String(l.itemId)));
  assert.ok(flour.length >= 1, `QHR lines: ${JSON.stringify(flour)}`);
  const qhrQty = flour.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qhrQty, 3, `3 QHR: ${JSON.stringify(flour)}`);
  assert.ok(flour.every((l: any) => /Harina|Flour|QHR/i.test(mods(l))), `harina not comal: ${flour.map(mods).join(" | ")}`);
  assert.ok(flour.every((l: any) => /pastor|Alpastor/i.test(mods(l))), `pastor: ${flour.map(mods).join(" | ")}`);

  const qd = r.cart.filter((l: any) => /dorada|t5stuh|zzav3l/i.test(String(l.itemId)));
  const cost = qd.filter((l: any) => /Costilla/i.test(mods(l)));
  const pren = qd.filter((l: any) => /Prensado/i.test(mods(l)));
  const costQty = cost.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const prenQty = pren.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(costQty, 4, `4 QD costilla: ${JSON.stringify(qd)}`);
  assert.equal(prenQty, 1, `1 QD prensado: ${JSON.stringify(qd)}`);
  assert.ok(qd.every((l: any) => l.itemId === REG || /T5STUH|REGULAR/i.test(String(l.itemId) + mods(l))),
    `all REG: ${JSON.stringify(qd)}`);

  const drink = r.cart.filter((l: any) => /horchata/i.test(String(l.itemId)));
  assert.ok(drink.length >= 1, `horchata: ${JSON.stringify(r.cart)}`);
});

test("caguamas1: street Williams ≠ customerName", () => {
  assert.equal(nameFromTranscriptInfo(caguamas as any), null);
  // Bare answer without turns still parses; address phrase does not.
  assert.equal(nameFromAnswer("Williams"), "Williams");
  assert.equal(nameFromAnswer("A a la William 544"), null);
});
