// carlos1: CA7fbad626 — 2 TST bistec + 1 TST chorizo + 2 TCO bistec + 2 QCO tripa; name Carlos (not Muchas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromAnswer, nameFromStaffAsk, nameFromTranscript } from "../../src/order-name.ts";
import { shadowOrderFromTurns, listedMeats, rewriteCallerText, kindOfItem, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start = 0): CallTurn =>
  ({ speaker, text, start, end: start + 1, language: "es" } as any);

test("carlos1: gratitude leftovers never become a name", () => {
  assert.equal(nameFromAnswer("Okay, muchas gracias."), null);
  assert.equal(nameFromAnswer("muchas gracias"), null);
  assert.equal(nameFromAnswer("Muchas"), null);
  assert.equal(nameFromAnswer("A nombre de Carlos, por favor."), "Carlos");
});

test("carlos1: A nombre de Carlos beats later Okay muchas gracias", () => {
  const turns = [
    T("staff", "Muy, muy bien. ¿A qué nombre va a ser la orden?"),
    T("caller", "A nombre de Carlos, por favor."),
    T("staff", "¿Carlos?"),
    T("caller", "Sí."),
    T("staff", "Muy bien, Carlos, dame unos quince minutos, por favor."),
    T("caller", "Okay, muchas gracias."),
  ];
  assert.equal(nameFromStaffAsk(turns), "Carlos");
  assert.equal(nameFromTranscript(turns), "Carlos");
});

test("carlos1: rewrite 'tres, no, dos tacos'", () => {
  assert.match(rewriteCallerText("Y serían otros tres, no, dos tacos de bistec al comal, por favor."), /dos tacos de bistec/i);
  assert.doesNotMatch(rewriteCallerText("Y serían otros tres, no, dos tacos de bistec al comal, por favor."), /\btres\b/i);
});

test("carlos1: al revés drops mistaken tripa; keeps 2 bistec + 1 chorizo taqueros", async () => {
  const TST = "sq-taco-street-XXX";
  const TCO = "sq-taco-comal-XXX";
  const QCO = "sq-quesadilla-HLT6CR";
  const meat = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
  const tort = (opt: string) => ({ step: "(A) Tortilla", option: opt });
  const add = (id: string, q: number, mods: any[]) => ({ type: "add_item", itemId: id, quantity: q, modifiers: mods });
  let n = 0;
  const run = async (text: string) => {
    const t = text.toLowerCase();
    n++;
    if (/tripa/.test(t) && /taco/.test(t) && !/al\s+rev[eé]s/.test(t))
      return { reply: "2 tacos de tripa.", actions: [add(TST, 2, [tort("(TST) Taquero / Street"), meat("Tripa / Beef Tripe")])] };
    if (/bistec/.test(t) && /chorizo/.test(t))
      return {
        reply: "3 tacos taqueros: 2 bistec, 1 chorizo.",
        actions: [
          add(TST, 2, [tort("(TST) Taquero / Street"), meat("Bistec / Steak")]),
          add(TST, 1, [tort("(TST) Taquero / Street"), meat("Chorizo / Mexican Sausage")]),
        ],
      };
    if (/comal/.test(t) && /bistec/.test(t) && /taco/.test(t))
      return { reply: "2 tacos comal bistec.", actions: [add(TCO, 2, [tort("(TCO) Comal"), meat("Bistec / Steak")])] };
    if (/quesadilla/.test(t) && /tripa/.test(t))
      return {
        reply: "2 quesadillas comal tripa.",
        actions: [add(QCO, 2, [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, meat("Tripa / Beef Tripe")])],
      };
    if (/taquero|tres tacos/.test(t)) return { reply: "¿De qué carne?", actions: [] };
    return { reply: "¿Algo más?", actions: [] };
  };
  // Patch kindOfItem via item ids containing taco/quesadilla — kindOfItem reads id strings
  const turns: CallTurn[] = [
    T("staff", "Ah, claro, dígame.", 0),
    T("caller", "Ah, serían tres tacos taqueros,", 1),
    T("staff", "Tres tacos taqueros, claro.", 2),
    T("caller", "dos de bistec y uno de chorizo, por favor.", 3),
    T("staff", "Muy bien, tres tacos taqueros.", 4),
    T("caller", "Ah, y también serían otros dos tacos de tripa.", 5),
    T("caller", "No, al revés, dos de bistec y uno de chorizo, perdón.", 6),
    T("staff", "Y uno de chorizo. Ajá, ¿algo más?", 7),
    T("caller", "Y serían otros tres, no, dos tacos de bistec al comal, por favor.", 8),
    T("staff", "Muy bien.", 9),
    T("caller", "Y dos quesadillas de tripa al comal también, por favor.", 10),
    T("staff", "Dos quesadillas del comal de tripa.", 11),
    T("caller", "Sí.", 12),
    T("staff", "¿Algo más?", 13),
    T("caller", "No, sería todo.", 14),
  ];
  // Use real taco/quesadilla ids so kindOfItem works
  const realRun = async (text: string, _lang?: any, _hist?: any) => {
    const r = await run(text);
    for (const a of r.actions as any[]) {
      if (/street|taquero/i.test(JSON.stringify(a.modifiers)) || /taco/.test(text) && !/comal|quesadilla/.test(text)) {
        if (String(a.itemId).includes("street")) a.itemId = "sq-taco-taquero-TEST";
      }
      if (String(a.itemId).includes("comal") && /taco/i.test(String(a.itemId))) a.itemId = "sq-taco-comal-TEST";
      if (String(a.itemId).includes("quesadilla")) a.itemId = "sq-quesadilla-HLT6CR";
    }
    return r;
  };
  // Simpler: hardcode ids that kindOfItem recognizes
  const run2 = async (text: string) => {
    const t = text.toLowerCase();
    const tst = (meatOpt: string, q: number) =>
      add("sq-taco-X", q, [{ step: "(A)", option: "(TST) Tortilla Taquera / Street Taco" }, meat(meatOpt)]);
    const tco = (meatOpt: string, q: number) =>
      add("sq-taco-X", q, [{ step: "(A)", option: "(TCO) Tortilla Comal / Homemade" }, meat(meatOpt)]);
    const qco = (meatOpt: string, q: number) =>
      add("sq-quesadilla-HLT6CR", q, [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, meat(meatOpt)]);
    if (/al\s+rev[eé]s/.test(t))
      return { reply: "3 taqueros.", actions: [tst("Bistec / Steak", 2), tst("Chorizo / Mexican Sausage", 1)] };
    if (/tripa/.test(t) && /taco/.test(t)) return { reply: "2 tripa.", actions: [tst("Tripa / Beef Tripe", 2)] };
    if (/bistec/.test(t) && /chorizo/.test(t)) return { reply: "3.", actions: [tst("Bistec / Steak", 2), tst("Chorizo / Mexican Sausage", 1)] };
    if (/comal/.test(t) && /taco/.test(t) && /bistec/.test(t)) return { reply: "2 tco.", actions: [tco("Bistec / Steak", 2)] };
    if (/quesadilla/.test(t) && /tripa/.test(t)) return { reply: "2 qco.", actions: [qco("Tripa / Beef Tripe", 2)] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const r: any = await shadowOrderFromTurns(turns, run2 as any);
  const lines = r.cart.map((l: any) => ({
    kind: kindOfItem(l.itemId),
    q: l.quantity,
    mods: (l.modifiers || []).map((m: any) => m.option).join(", "),
  }));
  const qty = (pred: (l: any) => boolean) =>
    r.cart.filter(pred).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const has = (re: RegExp) => (l: any) => re.test((l.modifiers || []).map((m: any) => m.option).join(" "));
  const isTst = (l: any) => /TST|Taquera|Street/i.test((l.modifiers || []).map((m: any) => m.option).join(" "));
  const isTco = (l: any) => /TCO|Comal/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")) && kindOfItem(l.itemId) === "taco";
  const isQco = (l: any) => kindOfItem(l.itemId) === "quesadilla";
  assert.equal(qty((l: any) => isTst(l) && has(/bistec/i)(l)), 2, `TST bistec: ${JSON.stringify(lines)}`);
  assert.equal(qty((l: any) => isTst(l) && has(/chorizo/i)(l)), 1, `TST chorizo: ${JSON.stringify(lines)}`);
  assert.equal(qty((l: any) => isTst(l) && has(/tripa/i)(l)), 0, `no TST tripa: ${JSON.stringify(lines)}`);
  assert.equal(qty((l: any) => isTco(l) && has(/bistec/i)(l)), 2, `TCO bistec: ${JSON.stringify(lines)}`);
  assert.equal(qty((l: any) => isQco(l) && has(/tripa/i)(l) && !has(/bistec/i)(l)), 2, `QCO tripa only: ${JSON.stringify(lines)}`);
});
