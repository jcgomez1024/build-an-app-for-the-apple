// nayeli1 (CAf360d9): two pickups todo aparte — Verónica: menudo REG + QD deluxe bistec + picadillo;
// María: QD deluxe picadillo + pollo (meat filled, never empty). APARTE on QD deluxe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const DELUXE = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const MENUDO = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";

/** Miss stub: meatless deluxe dumps (the live failure mode). */
const missStub = async (text: string) => {
  if (/menudo/i.test(text))
    return {
      actions: [{ type: "add_item", itemId: MENUDO, quantity: 1, modifiers: [], readback: "menudo" }],
      reply: "Menudo. ¿Algo más?",
    };
  if (/preparad|dorad|quesadilla|aceite/i.test(text))
    return {
      actions: [{
        type: "add_item",
        itemId: DELUXE,
        quantity: 2,
        modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }],
        readback: "2 deluxe",
      }],
      reply: "2 deluxe. ¿Algo más?",
    };
  return { actions: [] as any[], reply: "?" };
};

const nayeli: CallTurn[] = [
  T("staff", "Ok, Nayeli, sí, dime.", 0),
  T("caller", "Quiero un menudo.", 2),
  T("staff", "Okay, ¿algo más?", 5),
  T("caller", "Y quiero dos quesadillas preparadas.", 7),
  T("staff", "¿De qué?", 10),
  T("caller", "¿Me pones una de bistec y una de picadillo?", 12),
  T("staff", "Muy bien, una de bistec y una de picadillo. ¿Algo más?", 15),
  T("caller", "¿Me puedes poner la verdura aparte?", 18),
  T("staff", "Sí, ¿todo aparte?", 21),
  T("caller", "Sí, por favor.", 23),
  T("staff", "Okay, ¿algo más?", 25),
  T("caller", "Y aparte, ¿me haces otro orden, dos quesadillas también doradas preparadas?", 27),
  T("staff", "En esa misma orden, ¿verdad?", 31),
  T("caller", "Aparte.", 33),
  T("staff", "Okay, esta orden para quién va a ser.", 35),
  T("caller", "Para Verónica.", 38),
  T("staff", "Verónica, okay. Muy bien, y luego la otra va.", 40),
  T("caller", "Y en la otra me pones dos quesadillas doradas también preparadas, una de picadillo y una de pollo. Mm, también el pollo a la verdura aparte.", 44),
  T("staff", "Muy bien, ¿algo más? Okey, todo aparte.", 50),
  T("caller", "Sí, por favor. Ah, no, ya es todo.", 53),
  T("staff", "¿A qué nombre sería? También a Ver, te voy a poner Veronique, María, muy bien.", 56),
  T("caller", "María.", 60),
  T("staff", "Okey, está muy bien.", 62),
];

function meatOf(l: any): string {
  return (l.modifiers || []).map((m: any) => String(m.option)).join(" ");
}
function hasAparte(l: any): boolean {
  return (l.modifiers || []).some((m: any) => /aparte/i.test(String(m.option)));
}

test("nayeli1: Verónica menudo+bistec+picadillo; María picadillo+pollo; APARTE; no meatless", async () => {
  const r = await shadowOrderFromTurns(nayeli, missStub as any);
  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  assert.equal(menudo.length, 1, `menudo: ${JSON.stringify(menudo)}`);
  assert.equal(String(menudo[0].person), "Verónica");

  const qd = r.cart.filter((l: any) => /dorada|zzav3l/i.test(String(l.itemId)));
  assert.equal(qd.length, 4, `expected 4 QD lines, got ${qd.length}: ${JSON.stringify(qd)}`);
  assert.ok(qd.every((l: any) => l.itemId === DELUXE || /ZZAV3L/i.test(String(l.itemId))), "all DELUXE");
  assert.ok(qd.every((l: any) => /Carnes|Bistec|Picadillo|Pollo|Steak|Chicken|Ground/i.test(meatOf(l))),
    `every QD has meat: ${qd.map(meatOf).join(" | ")}`);
  assert.ok(qd.every(hasAparte), `every QD APARTE: ${JSON.stringify(qd)}`);

  const ver = qd.filter((l: any) => l.person === "Verónica");
  const mar = qd.filter((l: any) => l.person === "María");
  assert.equal(ver.length, 2, `Verónica QD: ${JSON.stringify(ver)}`);
  assert.equal(mar.length, 2, `María QD: ${JSON.stringify(mar)}`);
  assert.match(ver.map(meatOf).join(" | "), /Bistec/i);
  assert.match(ver.map(meatOf).join(" | "), /Picadillo/i);
  assert.match(mar.map(meatOf).join(" | "), /Picadillo/i);
  assert.match(mar.map(meatOf).join(" | "), /Pollo|Chicken/i);
});

test("nayeli1: ticket name María (staff-ask); Verónica is pickup person stamp", () => {
  assert.equal(nameFromTranscriptInfo(nayeli as any)?.name, "María");
});
