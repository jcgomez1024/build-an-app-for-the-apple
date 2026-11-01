import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyQdGroups, qdGroups } from "../../src/list-repair.ts";
import { qdStyleAnswer } from "../../src/call-scoring.ts";
import { toPosLines } from "../../src/pos-catalog.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA7a1136-gustavo-qd1.json", import.meta.url), "utf8"));
const cat = JSON.parse(readFileSync(new URL("../../data/logs/pos-catalog.json", import.meta.url), "utf8"));
const meat = (l: any) => l.modifiers.find((m: any) => /Carnes/.test(m.step))?.option;
test("gustavo-qd1: three dorada groups rebuilt per group (qty/meat/deluxe/sin lechuga); comal QCO dropped; tacos kept", () => {
  const c = JSON.parse(JSON.stringify(d.cart)); assert.ok(applyQdGroups(c, d.turns));
  const qd = c.filter((l: any) => /^sq-qd-/.test(l.itemId));
  assert.ok(qd.every((l: any) => /deluxe/.test(l.itemId)));
  assert.deepEqual(qd.map((l: any) => [l.quantity, meat(l), !!(l.elviNotes || []).includes("no lechuga")]),
    [[3, "Bistec / Steak", true], [1, "Cabeza / Beef Head", false], [1, "Bistec / Steak", false], [2, "Bistec / Steak", false]]);
  assert.ok(!c.some((l: any) => l.itemId === "sq-quesadilla-HLT6CR"));
  assert.equal(c.find((l: any) => l.itemId === "sq-taco-TAR7L5").quantity, 2);
  assert.equal(applyQdGroups(c, d.turns), false, "idempotent");
  const pos = toPosLines(c.map((l: any) => ({ ...l, choices: [] })), cat);
  assert.ok(pos.length >= 5);
});
test("gustavo-qd1: regular groups stay regular; a single matching group is left alone", () => {
  const t = [{ speaker: "caller", text: "Dos quesadillas en aceite de pollo" }, { speaker: "staff", text: "¿Las quieres deluxe preparadas?" }, { speaker: "caller", text: "No, normales." }] as any;
  assert.equal(qdGroups(t)[0].deluxe, false);
  const c = [{ itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: 2, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: qdGroups(t)[0].meats[0].meat }] }];
  assert.equal(applyQdGroups(c, t), false);
});
test("gustavo-qd1: live REGULAR/DELUXE ask answered 'sí' after staff 'deluxe preparadas?' (or a repeated ask) → DELUXE", () => {
  const ask = "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?";
  assert.match(qdStyleAnswer("Ah, sí, pero sin lechuga", [{ role: "assistant", text: ask }], "me, te gustarían deluxe preparadas?")!, /DELUXE Preparada$/);
  assert.match(qdStyleAnswer("Sí, las tres", [{ role: "assistant", text: ask }, { role: "customer", text: "x" }, { role: "assistant", text: ask }], "¿Las tres?")!, /DELUXE/);
  assert.equal(qdStyleAnswer("Sí, las tres", [{ role: "assistant", text: ask }], "¿Las tres?"), null);
  assert.equal(qdStyleAnswer("No, normales", [{ role: "assistant", text: ask }], "¿deluxe preparadas?"), null);
  assert.equal(qdStyleAnswer("Sí", [{ role: "assistant", text: "¿Algo más?" }], "¿deluxe?"), null);
});
