// arturo1 (CAf5008b ~3:58 PM ET Oct 25): desk Spanish pickup.
// Square 7WcYGW… $12 = 2× QD REGULAR Dorada (prensado + duro). Name Arturo OK.
// Live miss: empty cart — avail "¿son de tortilla amarilla o blanca?" created pending taco
// that blocked both fully-specified doradas ("Missing required choices for: 1 taco").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T15:58:00-04:00";
const { shadowOrderFromTurns, DORADA_REG_ID, DORADA_DELUXE_ID } = await import("../../src/call-scoring.ts");
const { nameFromAnswer, nameFromTranscript } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAf5008b-turns.json", import.meta.url), "utf8"));

test("arturo1: name is Arturo", () => {
  assert.equal(nameFromAnswer("Arturo."), "Arturo");
  const n = nameFromTranscript(turns as any);
  assert.ok(n && /^arturo$/i.test(n), "name Arturo: " + n);
});

/** Reproduce live wrongs: avail Q opens taco; later dorada turns get Missing required. */
const stubLiveMiss = async (text: string) => {
  if (/taco|tortilla\s+amarilla|amarilla o blanca/i.test(text) && !/quesadilla|dorad|aceite|prensado|duro/i.test(text))
    return { reply: "Taco: ¿Taco Comal, Taco Harina o Taco Taquero? ¿Y Bistec, Cabeza, Carnitas o Chorizo?", actions: [] };
  if (/dorad|aceite|quesadilla/i.test(text) && !/prensado|duro|regular/i.test(text))
    return { reply: "REGULAR Dorada: ¿Qué carne quieres?", actions: [] };
  if (/prensado|duro/i.test(text))
    return { reply: "¿Chicharrón del duro en chile verde o prensado en chile rojo?", actions: [] };
  if (/regular/i.test(text))
    return { reply: "Missing required choices for: 1 taco.", actions: [] };
  return { reply: "Missing required choices for: 1 taco.", actions: [] };
};

test("arturo1: avail tortilla Q does not create taco; cart is 2× QD REGULAR (prensado + duro)", async () => {
  const seen: string[] = [];
  const run = async (text: string) => { seen.push(text); return stubLiveMiss(text); };
  const r: any = await shadowOrderFromTurns(turns as any, run as any);
  assert.ok(!r.cart.some((l: any) => /taco/i.test(String(l.itemId))), "no phantom taco: " + JSON.stringify(r.cart));
  const qd = r.cart.filter((l: any) => l.itemId === DORADA_REG_ID || l.itemId === DORADA_DELUXE_ID);
  assert.equal(qd.length, 2, "2 QD lines: " + JSON.stringify(qd.map((l: any) => ({ id: l.itemId, m: (l.modifiers||[]).map((x:any)=>x.option) }))));
  assert.ok(qd.every((l: any) => l.itemId === DORADA_REG_ID), "both REGULAR");
  const meats = qd.map((l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" ")).join(" || ");
  assert.match(meats, /Prensado/i, meats);
  assert.match(meats, /Duro/i, meats);
  assert.ok(!seen.some((s) => /amarilla o blanca/i.test(s) && !/quesadilla|dorad|aceite/i.test(s)),
    "avail Q must not be sent as order: " + seen.join(" | "));
});

test("arturo1: synthetic avail-only tortilla Q never opens a taco when followed by doradas", async () => {
  const T = (speaker: "caller" | "staff", text: string, start: number): any =>
    ({ speaker, start, end: start + 1, text, language: "es" });
  const seen: string[] = [];
  const run = async (text: string) => {
    seen.push(text);
    if (/prensado/i.test(text))
      return { reply: "ok", actions: [{ type: "add_item", itemId: DORADA_REG_ID, quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" }] }] };
    if (/duro/i.test(text))
      return { reply: "ok", actions: [{ type: "add_item", itemId: DORADA_REG_ID, quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" }] }] };
    if (/dorad|aceite|quesadilla/i.test(text))
      return { reply: "REGULAR Dorada: ¿Qué carne quieres?", actions: [] };
    if (/taco|amarilla/i.test(text))
      return { reply: "Taco: ¿Taco Comal…?", actions: [{ type: "add_item", itemId: "sq-taco-X", quantity: 1, modifiers: [] }] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const syn = [
    T("caller", "Hola, para los tacos, normalmente, ¿son de tortilla amarilla o blanca?", 0),
    T("staff", "Amarilla.", 2),
    T("caller", "okay, ¿me das dos quesadillas doradas en aceite?", 4),
    T("staff", "De qué se las voy a poner.", 6),
    T("caller", "una de chicharrón prensado", 8),
    T("caller", "y la otra de chicharrón duro", 10),
    T("staff", "¿Preparadas o regulares?", 12),
    T("caller", "Regulares", 14),
    T("staff", "Una dorada de prensado y una de duro. ¿Algo más?", 16),
    T("caller", "Sería todo, gracias.", 18),
    T("staff", "¿A qué nombre?", 20),
    T("caller", "Arturo.", 22),
  ];
  const r: any = await shadowOrderFromTurns(syn, run as any);
  assert.ok(!r.cart.some((l: any) => /taco/i.test(String(l.itemId))), "no taco from avail: " + JSON.stringify(r.cart));
  assert.ok(!seen.some((s) => /amarilla o blanca/i.test(s)), "avail not ordered: " + seen.join(" | "));
  const qd = r.cart.filter((l: any) => l.itemId === DORADA_REG_ID);
  assert.ok(qd.length >= 2 || r.cart.length >= 2, "doradas landed: " + JSON.stringify(r.cart));
});
