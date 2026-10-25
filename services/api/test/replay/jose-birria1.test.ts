// joseBirria1 (CA13b893): 1 Birria 1lb (consomé+comal) + 4 Tortillas EXTRAS comal.
// STT "tortillas estas" → extras; stop Consomé/SOLO birria variant Q after resolved / moved on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
const TOR_X = "sq-tortillas-extras-1-x-tortilla-comal-ADELFI";

const stub = async (text: string) => {
  // Mirror the live miss: ordering birria without variant → Consomé Q (must be cleared by capture)
  if (/\bbirrias?\b/iu.test(text) && !/consome|consomé|solo/i.test(text)) {
    return {
      actions: [],
      reply: "Birria de Chivo / Goat Birria: ¿1 lb of Birria de Chivo/Goat con Consome/Broth y Tortillas de Comal, 1 lb of Birria de Chivo/Goat con SOLO/ONLY Tortillas de Comal, 1 lb of Birria de Chivo/Goat con SOLO/ONLY Consome/Broth, SOLO/ONLY 1 lb of Birria de Chivo/Goat o SOLO/ONLY 16oz de Consome/Broth de Birria?",
    };
  }
  return { actions: [], reply: "?" };
};

const joseTurns: CallTurn[] = [
  T("staff", "¿Cocina Elvis?", 0),
  T("caller", "No, hola, buenas tardes, ¿en todo tienes birria?", 2),
  T("staff", "Ah, sí, claro.", 5),
  T("caller", "¿Me puedes poner una orden, por favor?", 7),
  T("staff", "Una orden de birria, claro. ¿Algo más?", 10),
  T("caller", "Sí, po, eh, sería todo. Oh, ¿me me puedes poner, me puedes poner cuatro tortillas estas, por favor?", 13),
  T("staff", "¿A qué nombre?", 18),
  T("staff", "Claro.", 19),
  T("caller", "Hey, este, y a nombre de José.", 20),
  T("staff", "¿Al nombre de José?", 23),
  T("caller", "Sí.", 25),
  T("staff", "Okay, te tengo cuatro tortillas extras y una birria, José.", 27),
  T("caller", "Sí, por favor.", 30),
  T("staff", "Dame unos veinticinco minutos.", 32),
  T("caller", "Sí, está bien, gracias.", 34),
  T("staff", "Gracias a ti.", 36),
];

test("joseBirria1: 1 birria + 4 tortillas extras comal; no stuck birria variant Q", async () => {
  const r = await shadowOrderFromTurns(joseTurns, stub as any);
  const ids = r.cart.map((l: any) => String(l.itemId));
  assert.ok(ids.some((id: string) => /birria/i.test(id) && /NHFHDD/i.test(id)), `expected birria NHFHDD, got ${ids.join(",")}`);
  const tor = r.cart.find((l: any) => /tortillas-extras|extras-1-x-tortilla/i.test(String(l.itemId)));
  assert.ok(tor, `expected tortillas extras, got ${ids.join(",")}`);
  assert.equal(Number(tor.quantity), 4, `extras qty 4, got ${tor.quantity}`);
  assert.ok(/ADELFI/i.test(String(tor.itemId)), `expected ADELFI SKU, got ${tor.itemId}`);
  // No open Consomé/SOLO Q left in steps after tortillas/name
  const lateAsks = (r.steps || []).filter((s: any) =>
    /birria/i.test(String(s.reply || "")) && /Consome|SOLO\/ONLY Tortillas/i.test(String(s.reply || ""))
    && /tortillas|nombre|José/i.test(String(s.heard || "")));
  assert.equal(lateAsks.length, 0, `stuck birria Q after move-on: ${JSON.stringify(lateAsks)}`);
  assert.equal(r.cart.filter((l: any) => /birria/i.test(String(l.itemId))).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1);
});
