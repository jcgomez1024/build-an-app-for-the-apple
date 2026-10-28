// cad71199 (CAd71199e78df31e6c3bd5d0a14dd961e1 ~7:15 PM ET Oct 28): Lester delivery, staff answered.
// Correct: 2 QD DELUXE preparada bistec+cabeza + 2 gorditas duro (ASR clemoritas); delivery 478 Bank St.
// Live miss: QD stuck REGULAR/DELUXE → QCO; "No, es verdad"+Ajá → Comal on duro; fulfillment null;
// Bank Street/Toledo → enchiladas prompts. Name Lester OK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-28T19:15:00-04:00";
const { shadowOrderFromTurns, DORADA_DELUXE_ID, staffPick, rewriteCallerText } = await import("../../src/call-scoring.ts");
const { addressesIn } = await import("../../src/delivery.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAd71199-turns.json", import.meta.url), "utf8"));
const QCO = "sq-quesadilla-HLT6CR";
const GD = "sq-gordita-M647RE";

/** Stub: reproduces live wrongs — forever REGULAR/DELUXE ask on QD; QCO on tortilla pick; enchiladas on Bank Street. */
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/regular dorada|deluxe preparada/.test(t) && !/bistec|cabeza|duro|gordita|clemor/.test(t)) {
    return {
      reply: "2 × Quesadilla Dorada DELUXE. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 2,
        modifiers: [
          { step: "(QD) Style", option: "(QD) DELUXE Preparada" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
          { step: "(B) Q Carnes / Meats", option: "Cabeza / Beef Head (+$0.50)" },
        ],
        readback: "2 QD deluxe bistec cabeza",
      }],
    };
  }
  if (/quesadilla dorada|dorada|preparad|bistec.*cabeza|cabeza/.test(t) && !/comal|gordita|duro|clemor|bank|toledo|lester/.test(t)) {
    return { reply: "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?", actions: [] };
  }
  if (/quesadilla comal|comal/.test(t) || (/duro|clemor|gordita/.test(t) && /comal|harina|taquera/.test(t))) {
    return {
      reply: "2 × Quesadilla: comal, chicharrón duro. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: QCO, quantity: 2,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
          { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" },
        ],
        readback: "2 QCO duro",
      }],
    };
  }
  if (/bank street|toledo/.test(t)) {
    return { reply: "Enchiladas: ¿Queso, Papas, Frijol o Pollo?", actions: [] };
  }
  if (/gordita|clemor|duro/.test(t)) {
    return {
      reply: "Quesadilla: ¿Quesadilla Comal, Quesadilla Harina o Quesadilla Taquera?",
      actions: [],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("cad71199: clemoritas → gorditas; No es verdad never picks Comal", () => {
  assert.match(rewriteCallerText("dos clemoritas de chicharrón duro"), /gorditas/i);
  const opts = ["Quesadilla Comal", "Quesadilla Harina", "Quesadilla Taquera"];
  assert.equal(staffPick(opts, "No, es verdad."), null);
  assert.equal(staffPick(opts, "es verdad"), null);
});

test("cad71199: 478, Bank Street parses", () => {
  const a = addressesIn("A la 4 78, Bank Street");
  assert.ok(a.length >= 1, JSON.stringify(a));
  assert.match(a[0].street, /478/i);
  assert.match(a[0].street, /Bank/i);
});

test("cad71199: name Lester", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.equal(info?.name, "Lester", JSON.stringify(info));
});

test("cad71199: 2 QD deluxe bistec+cabeza + 2 gorditas duro; DELIVERY; no QCO/enchiladas", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const dump = JSON.stringify(r.cart.map((l: any) => ({
    id: l.itemId, q: l.quantity, mods: (l.modifiers || []).map((m: any) => m.option),
  })));

  assert.equal(r.fulfillment, "DELIVERY", "fulfillment: " + dump);
  assert.ok(r.address && /bank/i.test(String(r.address)), "address: " + r.address);

  assert.ok(!r.cart.some((l: any) => String(l.itemId) === QCO), "no QCO: " + dump);
  assert.ok(!r.cart.some((l: any) => /enchilada/i.test(String(l.itemId))), "no enchiladas: " + dump);

  const qd = r.cart.filter((l: any) => String(l.itemId) === DORADA_DELUXE_ID
    || /deluxe|zzav3l/i.test(String(l.itemId)));
  const qdQty = qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.ok(qdQty >= 2, "2 QD deluxe: " + dump);
  const qdMods = qd.flatMap((l: any) => (l.modifiers || []).map((m: any) => String(m.option)));
  assert.ok(qdMods.some((o: string) => /bistec|steak/i.test(o)), "bistec: " + dump);
  assert.ok(qdMods.some((o: string) => /cabeza/i.test(o)), "cabeza: " + dump);
  assert.ok(qdMods.some((o: string) => /deluxe|preparada/i.test(o)), "deluxe: " + dump);

  const gd = r.cart.filter((l: any) => /^sq-gordita-/i.test(String(l.itemId)));
  const gdQty = gd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.ok(gdQty >= 2, "2 gorditas: " + dump);
  assert.ok(gd.some((l: any) => (l.modifiers || []).some((m: any) => /duro/i.test(String(m.option)))), "duro: " + dump);

  // stray address must not leave open enchiladas ask as last food step
  const bad = (r.steps || []).filter((s: any) => /enchilada/i.test(String(s.reply || "")));
  assert.equal(bad.length, 0, "no enchiladas prompts: " + JSON.stringify(bad.slice(0, 3)));
});
