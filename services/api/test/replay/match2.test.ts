// match2: synthetic replay of the 11:41 pattern — split Elvi lines vs duplicate ticket lines + a NO DRINK line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreOrder, consolidate, isNonItemLine } from "../../src/call-accuracy.ts";

const L = (name: string, q: number, choices: string[], unit: number) => ({ baseName: name, name, quantity: q, choices, unitCents: unit, totalCents: unit * q });
const T = "Torta · (TO) Torta", Q = "Quesadilla · (QCO) Quesadilla de Comal / Homemade";
const elvi = [L(T, 1, ["Bistec / Steak"], 475), L(Q, 1, ["Prensado / Spicy Pork"], 500), L(T, 1, ["Bistec / Steak"], 475), L(Q, 3, ["Prensado / Spicy Pork"], 500)];
const ticket = [L(T, 2, ["Bistec / Steak"], 475), L(Q, 1, ["Prensado / Spicy Pork"], 500), L("NO BEBIDA / NO DRINK", 1, [], 0), L(Q, 3, ["Prensado / Spicy Pork"], 500), L(T, 2, ["Bistec / Steak"], 475)];

test("match2: NO DRINK / notes are not items; duplicate lines consolidate", () => {
  assert.equal(isNonItemLine(L("NO BEBIDA / NO DRINK", 1, [], 0)), true);
  assert.equal(isNonItemLine(L("Nota: sin cebolla", 1, [], 0)), true);
  assert.deepEqual(consolidate(ticket).map((l) => [l.name, l.quantity]), [[T, 4], [Q, 4]]);
});
test("match2: each unit matched once — one quantity miss for tortas, nothing for quesadillas, no NO DRINK extra", () => {
  const r = scoreOrder(elvi, ticket);
  assert.deepEqual(r.misses.map((m) => m.kind), ["quantity"]);
  assert.match(r.misses[0].detail, /Torta: ticket 4, Elvi 2/);
  assert.equal(r.score, 76.5); // tortas 53 (item 40 + 2 of 4 exact), quesadillas 100
});
test("match2: same total quantity, different choices → one choices miss, no quantity/missing/extra", () => {
  const r = scoreOrder([L(T, 1, ["Bistec / Steak"], 475), L(T, 1, ["Prensado / Spicy Pork"], 525)], [L(T, 2, ["Bistec / Steak"], 475)]);
  assert.deepEqual(r.misses.map((m) => m.kind), ["choices"]);
});
