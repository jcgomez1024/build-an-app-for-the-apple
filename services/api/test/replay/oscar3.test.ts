// oscar3 (CA041f564 ~12:06 PM ET): staff ¿Un menudo? + Sí → 1 Menudo SIN pata corn tortillas;
// STT "preparar un menú" must NOT menu-pitch; "pues, pobre, pues" never customerName (name Oscar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, prepMergedCallerTurns, type CallTurn } from "../../src/call-scoring.ts";
import { nameFromAnswer, nameFromTranscriptInfo } from "../../src/order-name.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const stub = async (text: string) => {
  if (/\bmen[uú]\b/iu.test(text) && !/\bmenudo\b/iu.test(text))
    return { actions: [], reply: "Lo más popular: Quesadilla…" };
  if (/\bmenudo\b/iu.test(text))
    return { actions: [{ type: "add_item", itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 1, modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }], readback: "menudo" }], reply: "?" };
  return { actions: [], reply: "?" };
};

const oscarTurns: CallTurn[] = [
  T("staff", "¿Cocinaris?", 1),
  T("caller", "Bueno, si no puedo preparar un menú.", 3),
  T("staff", "¿Chívano?", 4),
  T("staff", "¿Un menudo?", 6),
  T("caller", "Sí.", 7),
  T("staff", "Claro que sí, algo más, amigazo.", 8),
  T("caller", "No, nada más, no, nada más que nos empatas, pues. Es Oscar.", 11),
  T("staff", "Oh, perdón.", 12),
  T("staff", "Ah, sin pata, o que eso es lo que te iba a preguntar, sin pata, un menudo. ¿Me das tu nombre para tu orden?", 14),
  T("staff", "Oscar, muy bien, Oscar, danos unos quince, veinte minutos, por favor, sale y te tenemos tu orden.", 21),
  T("caller", "pues, pobre, pues.", 26),
  T("staff", "Gracias.", 26.9),
];

test("oscar3: menú→menudo rewrite in ordering context", () => {
  const merged = [
    { speaker: "caller", text: "Bueno, si no puedo preparar un menú." },
    { speaker: "staff", text: "¿Un menudo?" },
  ];
  prepMergedCallerTurns(merged as any);
  assert.match(merged[0].text, /menudo/i);
  assert.doesNotMatch(merged[0].text, /(?<![\p{L}])men[uú](?![\p{L}])/iu);
});

test("oscar3: pobre/pues goodbye never a name", () => {
  assert.equal(nameFromAnswer("pues, pobre, pues."), null);
  assert.equal(nameFromAnswer("pues, pobre, pues"), null);
  const info = nameFromTranscriptInfo(oscarTurns as any);
  assert.ok(info);
  assert.equal(info!.name, "Oscar");
});

test("oscar3: staff ¿Un menudo? + Sí → 1 Menudo SIN; no empty cart", async () => {
  const r: any = await shadowOrderFromTurns(oscarTurns.map((t) => ({ ...t })), stub as any);
  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  const qty = menudo.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qty, 1, JSON.stringify(r.cart));
  assert.ok(menudo.every((l: any) => /menudo-con-tortillas|ZSRUX4/i.test(String(l.itemId)) && !/con-pata|JOVEZG/i.test(String(l.itemId))),
    "SIN pata SKU: " + JSON.stringify(r.cart));
  assert.ok(!r.steps.some((s: any) => /Lo más popular/i.test(String(s.reply || ""))),
    "no menu pitch: " + JSON.stringify(r.steps.filter((s: any) => s.reply)));
});
