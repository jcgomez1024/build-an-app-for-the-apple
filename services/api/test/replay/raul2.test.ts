// raul2 (CA06ecc4deeeecba592cd882d56494e65b ~7:09 PM ET Oct 25): desk Spanish pickup, 74s.
// Square jUxYCk8Rs5zU6MOGzoOyJIwYpo6YY $24.00 ticket Raúl =
//   3 Taco Comal costilla + 3 Taco Comal bistec (two separate lines).
// Live miss: line1 OK (3 TCO Costilla); line2 has BOTH Costilla and Bistec —
//   costilla from the first line carried onto the next qty/meat change.
// ASR: "otros tres de bizco" → bistec. Related: lalo1 CA72b325 QCO dual-meat strip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T19:09:00-04:00";
const { shadowOrderFromTurns, rewriteCallerText, listedMeats } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA06ecc4-turns.json", import.meta.url), "utf8"));
const TACO = "sq-taco-TAR7L5";
const TCO = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
const costilla = { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" };
const bistec = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };

test("raul2: ASR bizco → bistec; listedMeats sees qty+meat", () => {
  assert.match(rewriteCallerText("Me pone otros tres de bizco."), /bistec/i);
  assert.doesNotMatch(rewriteCallerText("Me pone otros tres de bizco."), /bizco/i);
  const meats = listedMeats(rewriteCallerText("Me pone otros tres de bizco."));
  assert.equal(meats.length, 1);
  assert.equal(meats[0].meat, "bistec");
  assert.equal(meats[0].qty, 3);
});

test("raul2: transcript name Raúl", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.match(info!.name, /^Ra[uú]l$/i);
});

/** Reproduce live wrong: 3 TCO costilla OK, then dual-meat TCO on the bistec turn. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/costilla/.test(t) && /(?:tres|3)/.test(t)) {
    return {
      reply: "Tres de costilla del comal.",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 3,
        modifiers: [TCO, costilla],
        readback: "3 TCO costilla",
      }],
    };
  }
  // "otros tres de bizco/bistec" — model stacked prior costilla onto the new line (live miss)
  if (/(?:bizco|bistec)/.test(t) && /(?:otros|tres|3)/.test(t)) {
    return {
      reply: "Otros tres.",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 3,
        modifiers: [TCO, costilla, bistec],
        readback: "3 TCO costilla+bistec",
      }],
    };
  }
  // Bare meat answer after staff "¿de qué…?" — same dual-meat dump if model re-fires
  if (/^\W*(?:este[,.]?\s*)?bistec\W*$/i.test(t)) {
    return {
      reply: "De bistec.",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 3,
        modifiers: [TCO, costilla, bistec],
        readback: "3 TCO costilla+bistec",
      }],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("raul2: 3 TCO costilla + 3 TCO bistec; no dual-meat carryover", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option))
    .filter((o: string) => /Costilla|Bistec|Pastor|Chorizo|Tripa|Lengua|Cabeza|Buche|Carnitas|Pollo/i.test(o) && !/salsa/i.test(o));
  const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");

  const tacos = r.cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  assert.ok(tacos.length >= 2, "two taco lines: " + JSON.stringify(tacos.map((l: any) => ({ q: l.quantity, m: meatOf(l) }))));
  assert.ok(tacos.every((l: any) => /TCO|Comal|Homemade/i.test(opts(l))), "all comal: " + JSON.stringify(tacos.map(opts)));
  assert.ok(tacos.every((l: any) => meatOf(l).length === 1), "no dual-meat: " + JSON.stringify(tacos.map(meatOf)));

  const cost = tacos.filter((l: any) => meatOf(l).some((m: string) => /Costilla/i.test(m)));
  const bist = tacos.filter((l: any) => meatOf(l).some((m: string) => /Bistec/i.test(m)));
  assert.equal(cost.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 3, "3 costilla");
  assert.equal(bist.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 3, "3 bistec");
  assert.ok(!cost.some((l: any) => meatOf(l).some((m: string) => /Bistec/i.test(m))), "costilla line not mixed");
  assert.ok(!bist.some((l: any) => meatOf(l).some((m: string) => /Costilla/i.test(m))), "bistec line not mixed");
});
