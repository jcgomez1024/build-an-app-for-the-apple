// luke1 (CA661a30f95e19f99b325118a2745a96cb ~8:10 PM ET Oct 25): desk English pickup, returning Luke 74s.
// Square 3K1F7Zn9… $21 Luke = 1 grande burrito chorizo con todo + 1 grande burrito lengua con todo.
// Live miss: chorizo qty 2; lengua + chile relleno + partial toppings; dual-meat twin; phantom horchata aside;
// order_name Muy Mal from "Mi español es muy mal". callers.json Luke untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T20:10:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const {
  nameFromAnswer, nameFromTranscriptInfo, nameFromStaffVocative,
} = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA661a30-turns.json", import.meta.url), "utf8"));
const BUR = "sq-burrito-TGWBEN";
const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";

test("luke1: Muy Mal / mi español junk rejected; staff look → Luke", () => {
  assert.equal(nameFromAnswer("Oh, okay. Mi español es muy mal."), null);
  assert.equal(nameFromAnswer("Mi español es muy mal"), null);
  assert.equal(nameFromAnswer("muy mal"), null);
  assert.equal(nameFromAnswer("Muy Mal"), null);
  assert.equal(nameFromStaffVocative(turns as any), "Luke");
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.equal(info!.name, "Luke");
  assert.notEqual(info!.name, "Muy Mal");
  assert.notEqual(info!.name, "So");
  assert.notEqual(info!.name, "Luis");
});

/** Reproduce live wrongs so end-rebuild must win. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/two|grande burrito|burritos/.test(t) && /chorizo|order/.test(t)) {
    return {
      reply: "2 burritos chorizo.",
      actions: [{
        type: "add_item", itemId: BUR, quantity: 2,
        modifiers: [
          { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" },
          { step: "(B) Burrito Carne Options", option: "Chorizo / Mexican Sausage" },
        ],
      }],
    };
  }
  if (/lengua/.test(t)) {
    return {
      reply: "Burrito lengua chile relleno.",
      actions: [{
        type: "add_item", itemId: BUR, quantity: 1,
        modifiers: [
          { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" },
          { step: "(C) Burrito Options", option: "Queso Fresco / Cheese" },
          { step: "(C) Burrito Options", option: "Cebolla / Onion" },
          { step: "(B) Burrito Carne Options", option: "Lengua / Beef Tongue (+$1.00)" },
          { step: "(B) Burrito Carne Options", option: "Chile Relleno De Queso / Cheese Chile Relleno" },
        ],
      }],
    };
  }
  if (/horchata/.test(t)) {
    return {
      reply: "Horchata.",
      actions: [{ type: "add_item", itemId: HORCH, quantity: 1, modifiers: [] }],
    };
  }
  if (/everything|con todo|yes|yeah/.test(t)) {
    return {
      reply: "Dual meat burritos.",
      actions: [{
        type: "add_item", itemId: BUR, quantity: 2,
        modifiers: [
          { step: "(B) Burrito Carne Options", option: "Chorizo / Mexican Sausage" },
          { step: "(B) Burrito Carne Options", option: "Lengua / Beef Tongue (+$1.00)" },
          { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" },
          { step: "(C) Burrito Options", option: "Queso Fresco / Cheese" },
        ],
      }],
    };
  }
  return { reply: "", actions: [] };
};

test("luke1: 1 chorizo + 1 lengua grande con todo; no phantoms", async () => {
  const r = await shadowOrderFromTurns(turns as any, stubLiveMiss);
  assert.equal(r.fulfillment, "PICKUP");
  assert.ok(!r.cart.some((l: any) => /horchata|orchata/i.test(String(l.itemId))), "no phantom horchata");
  const burs = r.cart.filter((l: any) => l.itemId === BUR);
  assert.equal(burs.length, 2, "two burrito lines: " + burs.map((l: any) => l.quantity + "x").join(","));
  assert.ok(burs.every((l: any) => l.quantity === 1), "singles not qty 2");
  const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => /Chorizo|Lengua|Relleno|Bistec/i.test(o));
  const chorizo = burs.find((l: any) => meatOf(l).some((o: string) => /Chorizo/i.test(o)) && !meatOf(l).some((o: string) => /Lengua/i.test(o)));
  const lengua = burs.find((l: any) => meatOf(l).some((o: string) => /Lengua/i.test(o)) && !meatOf(l).some((o: string) => /Chorizo/i.test(o)));
  assert.ok(chorizo, "chorizo-only line");
  assert.ok(lengua, "lengua-only line");
  assert.ok(!burs.some((l: any) => meatOf(l).some((o: string) => /Chorizo/i.test(o)) && meatOf(l).some((o: string) => /Lengua/i.test(o))), "no dual-meat twin");
  assert.ok(!meatOf(lengua).some((o: string) => /Relleno/i.test(o)), "no chile relleno phantom");
  const fillRe = /arroz|frijol|queso fresco|crema|cebolla|cilantro/i;
  for (const b of [chorizo, lengua]) {
    const opts = (b.modifiers || []).map((m: any) => String(m.option));
    assert.ok(opts.some((o: string) => /Grande/i.test(o)), "grande");
    assert.ok(opts.filter((o: string) => fillRe.test(o)).length >= 4, "con todo fillings: " + opts.join("|"));
  }
  assert.equal(r.cart.length, 2, "exact 2 lines");
});
