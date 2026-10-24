// jose1: CA2ee850 — desk Spanish. 6 QCO bistec OK; "deme dos, dos de quesad, dos de pollo" → qty 2 QCO pollo;
// staff "José, dame veinte minutos…" after ¿Tu nombre? is the order name (junk caller ASR).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromStaffAsk, nameFromTranscript, nameFromTranscriptInfo } from "../../src/order-name.ts";
import { shadowOrderFromTurns, listedMeats, splitItems, dishesNamed, rewriteCallerText, kindOfItem, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start = 0, language: "es" | "en" = "es"): CallTurn =>
  ({ speaker, text, start, end: start + 1, language } as any);

test("jose1: ASR 'quesad' → quesadillas; listedMeats keeps dos de pollo", () => {
  assert.match(rewriteCallerText("Ay, deme dos, dos de quesad, dos de pollo."), /quesadillas/i);
  assert.deepEqual(listedMeats("Ay, deme dos, dos de quesad, dos de pollo."), [{ meat: "pollo", another: false, qty: 2 }]);
  assert.ok(dishesNamed(rewriteCallerText("dos de quesad")).has("quesadilla"));
});

test("jose1: staff echo 'José, dame veinte minutos' after ¿Tu nombre? (junk caller)", () => {
  const turns = [
    T("staff", "¿Tu nombre?"),
    T("caller", "O sea. Okay, si me lo hacen menos,"),
    T("staff", "José, dame veinte minutos por lo menos, José, y puede pasar, ¿está bien?"),
  ];
  assert.equal(nameFromStaffAsk(turns), "José");
  assert.equal(nameFromTranscript(turns), "José");
  assert.deepEqual(nameFromTranscriptInfo(turns), { name: "José", thirdPerson: false, source: "staff-ask" });
  // bare "Dame quince…" is not a name
  assert.equal(nameFromStaffAsk([T("staff", "¿Tu nombre?"), T("staff", "Dame quince minutos por favor.")]), null);
});

test("jose1: shadow — 6 QCO bistec + 2 QCO pollo; model qty 1 forced to 2", async () => {
  const QCO = "sq-quesadilla-HLT6CR";
  const qco = (meat: string, q: number) => ({
    type: "add_item", itemId: QCO, quantity: q,
    modifiers: [
      { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
      { step: "(B) Q Carnes / Meats", option: meat },
    ],
  });
  const run = async (text: string) => {
    const t = text.toLowerCase();
    if (/pollo/.test(t)) return { reply: "Listo. ¿Algo más?", actions: [qco("Pollo / Chicken", 1)] }; // buggy model
    if (/quesad|bistec|vit/.test(t) && /seis|6/.test(t)) return { reply: "Listo. ¿Algo más?", actions: [qco("Bistec / Steak", 6)] };
    if (/ma[ií]z|comal/.test(t)) return { reply: "¿De qué carne?", actions: [] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const turns: CallTurn[] = [
    T("staff", "Cocina, Eddy, buenas tardes.", 0),
    T("caller", "Buenas tardes, por favor, seis quesadillas de de Vité.", 1),
    T("staff", "Sí, dígame. Tres quesadillas de bistec, ¿de qué tortilla? ¿De maíz en el comal, de harina del comal o doradas?", 2),
    T("caller", "De maíz.", 3),
    T("staff", "En el comal.", 4),
    T("caller", "Seis. Sí, seis. Perdón.", 5),
    T("staff", "Permíteme. ¿Seis, joven?", 6),
    T("staff", "¿Seis?", 7),
    T("caller", "Sí,", 8),
    T("staff", "Todas de bistec, ¿qué más?", 9),
    T("caller", "de Vité.", 10),
    T("caller", "No, nada.", 11),
    T("staff", "¿Tu nombre?", 12),
    T("caller", "O sea. Okay, si me lo hacen menos,", 13),
    T("staff", "José, dame veinte minutos por lo menos, José, y puede pasar, ¿está bien?", 14),
    T("staff", "Gracias.", 15),
    T("caller", "solo voy a agradecer, solo voy a trabajar.", 16),
    T("caller", "Ay, deme dos, dos de quesad, dos de pollo.", 17),
  ];
  const r: any = await shadowOrderFromTurns(turns, run as any);
  const pollo = r.cart.filter((l: any) => /pollo/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")));
  const bistec = r.cart.filter((l: any) => /bistec/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")));
  const polloQty = pollo.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const bistecQty = bistec.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.ok(bistecQty >= 6, `expected ≥6 bistec, got ${bistecQty}: ${JSON.stringify(r.cart)}`);
  assert.equal(polloQty, 2, `expected 2 pollo, got ${polloQty}: ${JSON.stringify(r.cart)}`);
  assert.ok(pollo.every((l: any) => kindOfItem(l.itemId) === "quesadilla"), "pollo lines are quesadillas");
});

test("jose1: empty model on pollo turn invents 2 QCO pollo via meat-listed", async () => {
  const QCO = "sq-quesadilla-HLT6CR";
  const qco = (meat: string, q: number) => ({
    type: "add_item", itemId: QCO, quantity: q,
    modifiers: [
      { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
      { step: "(B) Q Carnes / Meats", option: meat },
    ],
  });
  const run = async (text: string) => {
    const t = text.toLowerCase();
    if (/pollo/.test(t)) {
      // invent path sends "2 una quesadilla de comal de pollo" — respond with correct add
      const m = t.match(/\b(\d+)\b/);
      const q = m ? Number(m[1]) : 1;
      return { reply: "Listo. ¿Algo más?", actions: [qco("Pollo / Chicken", q || 1)] };
    }
    if (/quesad|bistec|vit/.test(t) && /seis|6/.test(t)) return { reply: "Listo. ¿Algo más?", actions: [qco("Bistec / Steak", 6)] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const turns: CallTurn[] = [
    T("caller", "seis quesadillas de bistec de maíz en el comal", 0),
    T("staff", "¿Algo más?", 1),
    T("caller", "Ay, deme dos, dos de quesad, dos de pollo.", 2),
  ];
  const r: any = await shadowOrderFromTurns(turns, run as any);
  const polloQty = r.cart.filter((l: any) => /pollo/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")))
    .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(polloQty, 2, `expected 2 pollo via invent, got ${polloQty}: ${JSON.stringify(r.cart)}`);
});

test("jose1: splitItems keeps deme + dish + dos de pollo as one piece", () => {
  const t = rewriteCallerText("Ay, deme dos, dos de quesad, dos de pollo.");
  const parts = splitItems(t);
  assert.equal(parts.length, 1, JSON.stringify(parts));
  assert.match(parts[0], /deme dos/i);
  assert.match(parts[0], /quesadillas/i);
  assert.match(parts[0], /dos de pollo/i);
});

test("jose1: junk turns do not add extra quesadillas after cart has QCO bistec", async () => {
  const QCO = "sq-quesadilla-HLT6CR";
  const qco = (meat: string, q: number) => ({
    type: "add_item", itemId: QCO, quantity: q,
    modifiers: [
      { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
      { step: "(B) Q Carnes / Meats", option: meat },
    ],
  });
  const run = async (text: string) => {
    const t = text.toLowerCase();
    if (/pollo/.test(t) && /quesadilla|comal/.test(t)) return { reply: "Listo.", actions: [qco("Pollo / Chicken", 2)] };
    if (/bistec|quesadilla/.test(t) && /seis|6/.test(t)) return { reply: "Listo.", actions: [qco("Bistec / Steak", 6)] };
    // junk turns: model wrongly tries to add
    if (/perd[oó]n|menos|agradecer|nada/.test(t)) return { reply: "¿Algo más?", actions: [qco("Bistec / Steak", 1)] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const turns: CallTurn[] = [
    T("caller", "seis quesadillas de bistec de maíz en el comal", 0),
    T("staff", "¿Algo más?", 1),
    T("caller", "Seis. Sí, seis. Perdón.", 2),
    T("staff", "Todas de bistec, ¿qué más?", 3),
    T("caller", "nada", 4),
    T("staff", "¿Tu nombre?", 5),
    T("caller", "O sea. Okay, si me lo hacen menos,", 6),
    T("staff", "José, dame veinte minutos por lo menos, José, y puede pasar, ¿está bien?", 7),
    T("caller", "Ay, deme dos, dos de quesad, dos de pollo.", 8),
  ];
  const r: any = await shadowOrderFromTurns(turns, run as any);
  const qty = r.cart.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const pollo = r.cart.filter((l: any) => /pollo/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")))
    .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qty, 8, `expected 8 lines qty, got ${qty}: ${JSON.stringify(r.cart)}`);
  assert.equal(pollo, 2);
});
