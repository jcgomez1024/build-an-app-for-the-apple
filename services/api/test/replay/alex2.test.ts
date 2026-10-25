// alex2 (CA2389fc ~11:46 ET): 2 QD aceite deluxe bistec + 3 gorditas prensado.
// "¿Tienes de chicharrón prensado?" is availability — must NOT add Gordita or QD REGULAR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
import { availabilityQuestion } from "../../src/elvi.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const stub = async () => ({ actions: [] as any[], reply: "?" });

const alexTurns: CallTurn[] = [
  T("staff", "Cocina Elvis.", 0),
  T("caller", "buenas tardes. Buenos días, quiero hacer una orden.", 3),
  T("staff", "Ah, sí, dígame.", 6),
  T("caller", "Me pones dos quesadillas de aceite", 9),
  T("staff", "Muy bien, dos quesadillas de aceite, ¿de qué?", 13),
  T("caller", "de bistec preparadas, por favor.", 17),
  T("staff", "Muy bien, ¿preparadas?", 18),
  T("caller", "Sí.", 21),
  T("staff", "¿Algo más?", 21.8),
  T("caller", "Y aparte sería otra orden.", 23),
  T("staff", "Okey, otra orden de qué te las pongo.", 25),
  T("caller", "Este, ¿tienes, vendes también gorditas?", 29),
  T("staff", "Sí.", 33),
  T("caller", "Este, ¿están grandes o están más o menos pequeñas o qué?", 35),
  T("caller", "¿Me podrías poner unas tres, por favor?", 43),
  T("staff", "¿Tres de qué?", 45),
  T("caller", "¿Tienes de chicharrón prensado?", 48),
  T("staff", "Sí.", 50),
  T("caller", "Me pones las tres de chicharrón prensado.", 51),
  T("staff", "Muy bien, ¿algo más?", 54),
  T("caller", "Nada más.", 57),
  T("staff", "Okay, ¿a qué nombre sería la orden?", 58),
  T("caller", "Alex.", 61),
  T("staff", "Alex, muy bien, Alex. Dame unos veinte minutos.", 63),
  T("caller", "Okay, está bien.", 69),
];

test("alex2: ¿Tienes de chicharrón prensado? is availability — no ring", () => {
  const r = availabilityQuestion({ transcript: "¿Tienes de chicharrón prensado?", language: "es" } as any);
  assert.ok(r);
  assert.equal(r!.actions.length, 0);
});

test("alex2: cart is 2 QD deluxe bistec + 3 gorditas prensado only", async () => {
  const r: any = await shadowOrderFromTurns(alexTurns.map((t) => ({ ...t })), stub as any);
  const lines = r.cart.map((l: any) => ({
    q: l.quantity,
    id: String(l.itemId),
    meats: (l.modifiers || []).map((m: any) => m.option).filter((o: string) => /bistec|prensado|chorizo|pollo|deluxe|regular|gordita/i.test(o)),
  }));
  const qd = r.cart.filter((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
  const gd = r.cart.filter((l: any) => /gordita/i.test(String(l.itemId)));
  const qdN = qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const gdN = gd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qdN, 2, JSON.stringify(lines));
  assert.equal(gdN, 3, JSON.stringify(lines));
  assert.ok(qd.every((l: any) =>
    (l.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(m.option))
    && (l.modifiers || []).some((m: any) => /Bistec/i.test(m.option))), JSON.stringify(lines));
  assert.ok(!r.cart.some((l: any) => /REGULAR Dorada/i.test((l.modifiers || []).map((m: any) => m.option).join(" "))),
    "no phantom QD REGULAR: " + JSON.stringify(lines));
  assert.ok(gd.every((l: any) => (l.modifiers || []).some((m: any) => /Prensado/i.test(m.option))), JSON.stringify(lines));
});
