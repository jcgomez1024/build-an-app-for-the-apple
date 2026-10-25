// maria1 (CA403f137 ~4:55 PM ET Oct 25): desk Spanish.
// Square: QD REG prensado+frijoles + QD REG picadillo+frijoles + Sopesaso bistec+chorizo + 2 TST bistec.
// Live miss: second QD (picadillo) dropped; 2 bistec rang TCO not TST after "Sí, Taqueros".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T16:55:00-04:00";
const { shadowOrderFromTurns, DORADA_REG_ID } = await import("../../src/call-scoring.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA403f137-turns.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR";
const TACO = "sq-taco-TAR7L5";
const SOPE = "sq-sopesaso-elvis";

/** Reproduce live wrongs: 1 QD prensado only (no picadillo), sopesaso OK, 2× TCO bistec. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/prensado/.test(t) && (/aceite|dorad|quesadilla|regular|frijol/.test(t))) {
    return {
      reply: "QD regular prensado con frijoles. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: DORADA_REG_ID, quantity: 1,
        modifiers: [
          { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
          { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork (+$0.50)" },
          { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" },
        ],
        readback: "1 QD regular prensado",
      }],
    };
  }
  // Live miss: model skipped / returned [] on "otra … picadillo"
  if (/picadillo/.test(t)) return { reply: "¿Algo más?", actions: [] };
  if (/sopes|chorizo/.test(t) && /bistec|viste/.test(t)) {
    return {
      reply: "Sopesaso bistec chorizo. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: SOPE, quantity: 1,
        modifiers: [
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
          { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" },
        ],
        readback: "1 sopesaso",
      }],
    };
  }
  if (/tacos?/.test(t) || /bistec|viste/.test(t)) {
    return {
      reply: "¿Taco Comal, Taco Harina o Taco Taquero?",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 2,
        modifiers: [
          { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "2 TCO bistec",
      }],
    };
  }
  if (/comal|taquer|harina/.test(t)) {
    return {
      reply: "Taco comal. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 2,
        modifiers: [
          { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
      }],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("maria1: 2× QD REG (prensado + picadillo w/ beans) + sopesaso + 2 TST bistec (not TCO)", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
  const qd = r.cart.filter((l: any) => /dorada|t5stuh|zzav3l/i.test(String(l.itemId)));
  assert.equal(qd.length, 2, "2 QD lines: " + JSON.stringify(r.cart.map((l: any) => ({ id: l.itemId, q: l.quantity, o: opts(l) }))));
  const pren = qd.find((l: any) => /Prensado/i.test(opts(l)));
  const pica = qd.find((l: any) => /Picadillo/i.test(opts(l)));
  assert.ok(pren, "prensado QD: " + JSON.stringify(qd.map(opts)));
  assert.ok(pica, "picadillo QD: " + JSON.stringify(qd.map(opts)));
  assert.match(opts(pren), /Frijoles|Beans/i, "prensado beans: " + opts(pren));
  assert.match(opts(pica), /Frijoles|Beans/i, "picadillo beans: " + opts(pica));
  assert.ok(qd.every((l: any) => String(l.itemId) === DORADA_REG_ID || /t5stuh|regular/i.test(String(l.itemId))), "both REG");

  const sope = r.cart.find((l: any) => /sopesaso/i.test(String(l.itemId)));
  assert.ok(sope, "sopesaso present");
  assert.match(opts(sope), /Bistec/i);
  assert.match(opts(sope), /Chorizo/i);

  const tacos = r.cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  assert.ok(tacos.length >= 1, "tacos present");
  const tq = tacos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(tq, 2, "2 tacos: " + JSON.stringify(tacos.map((l: any) => ({ q: l.quantity, o: opts(l) }))));
  assert.ok(tacos.every((l: any) => /TST|Taquero|Street/i.test(opts(l))), "TST not TCO: " + tacos.map(opts).join(" || "));
  assert.ok(tacos.every((l: any) => !/\(TCO\)|Taco Comal/i.test(opts(l))), "no TCO: " + tacos.map(opts).join(" || "));
  assert.ok(tacos.every((l: any) => /Bistec/i.test(opts(l))), "bistec tacos");

  assert.ok(!r.cart.some((l: any) => String(l.itemId) === Q && !/dorada/i.test(String(l.itemId))), "no stray QCO");
});
