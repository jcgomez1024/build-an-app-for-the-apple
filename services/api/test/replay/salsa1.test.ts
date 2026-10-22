// salsa1 + choice1: synthetic, no PII.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreOrder, callerNamedSalsa } from "../../src/call-accuracy.ts";
const L = (choices: string[]) => ({ baseName: "Plate X", name: "Plate X", quantity: 2, choices, unitCents: 1500, totalCents: 3000 }) as any;
test("salsa1: Elvi's default included salsa vs a ticket with no salsa is not a miss when nobody named a salsa", () => {
  const r = scoreOrder([L(["Rice and Beans", "Mild Salsa Asada"])], [L(["Rice and Beans"])], { salsaNamed: false });
  assert.equal(r.score, 100);
});
test("salsa1: when the caller named a salsa, salsa is scored on both sides", () => {
  assert.ok(scoreOrder([L(["Rice and Beans", "Mild Salsa Asada"])], [L(["Rice and Beans", "Salsa Verde"])], { salsaNamed: true }).score < 100);
  assert.ok(scoreOrder([L(["Rice and Beans"])], [L(["Rice and Beans", "Mild Salsa Asada"])], { salsaNamed: true }).score < 100);
  assert.equal(scoreOrder([L(["Rice and Beans", "Mild Salsa Asada"])], [L(["Rice and Beans", "Mild Salsa Asada"])], { salsaNamed: true }).score, 100);
});
test("salsa1: callerNamedSalsa only counts the caller", () => {
  assert.equal(callerNamedSalsa([{ speaker: "caller", text: "with the green salsa please" }]), true);
  assert.equal(callerNamedSalsa([{ speaker: "caller", text: "hot sauce on the side" }]), true);
  assert.equal(callerNamedSalsa([{ speaker: "staff", text: "salsa roja o verde?" }, { speaker: "caller", text: "two plates" }]), false);
});
test("choice1: POS '2 CHEESE' and online 'CHEESE / QUESO' are the same option; different options still differ", () => {
  assert.equal(scoreOrder([L(["CHEESE / QUESO", "Rice and Beans"])], [L(["2 CHEESE", "Rice and Beans"])]).score, 100);
  assert.ok(scoreOrder([L(["Solo Beans / Only Beans"])], [L(["Beans / Pinto Beans"])]).score < 100);
});
