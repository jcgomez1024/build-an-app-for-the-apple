// fix_uriel: synthetic. Vague "can I order" never guesses a dish; a follow-up answer keeps its own count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderIntentOnly, spokenQtyFor } from "../../src/elvi.ts";
test("fix_uriel: '¿puedo hacer una orden?' → invite, no dish question", () => {
  for (const t of ["Bueno, ya, ¿puedo hacer una orden?", "can I place an order", "quiero ordenar para llevar"]) assert.ok(orderIntentOnly({ transcript: t, language: "es" } as any), t);
  assert.equal(orderIntentOnly({ transcript: "quiero dos tortas", language: "es" } as any), null);
});
test("fix_uriel: 'me pone dos tortas de bistec' keeps 2 when answering a torta question", () => {
  assert.equal(spokenQtyFor("Me pone dos tortas de bistec", [{ name: "Torta" }]), 2);
  assert.equal(spokenQtyFor("otras dos tortas", [{ name: "Torta" }]), 2);
  assert.equal(spokenQtyFor("de bistec", [{ name: "Torta" }]), null);
});
import { splitDishClauses, shortAckAfterReadback } from "../../src/elvi.ts";
import { clauseFor } from "../../src/site-catalog.ts";
test("fix_uriel: each dish keeps only its own clause's meats; a taken-back clause is dropped (its tortilla kept)", () => {
  const t = "Me pone otras dos tortas aparte de de bistec y otra quesadilla de bistec de comal de, no, perdón, y otra quesadilla de prensado, ajá.";
  assert.deepEqual(splitDishClauses(t), ["me pone otras dos tortas aparte de de bistec", "otra quesadilla de prensado de comal"]);
  const m = [{ name: "Torta" }, { name: "Quesadilla" }];
  assert.equal(clauseFor("dos tortas de bistec y una quesadilla de prensado", m[0], m), "dos tortas de bistec");
  assert.deepEqual(splitDishClauses("dos tacos de asada"), []);
});
test("fix_uriel: 'Ajá, aparte' / 'de prensado' after a read-back adds nothing; a name or new dish still goes through", () => {
  const R = "2 × Torta: bistec. $9.50. ¿Algo más?";
  for (const t of ["Ajá, aparte.", "Ajá.", "Sigue todo.", "Ajá, de prensado."]) assert.ok(shortAckAfterReadback({ transcript: t, language: "es" } as any, R), t);
  for (const t of ["Zed.", "y tres quesadillas", "otra"]) assert.equal(shortAckAfterReadback({ transcript: t, language: "es" } as any, R), null, t);
});
test("fix_uriel: counting without a dish ('y me pone dos, tres') asks, adds nothing", () => {
  const r: any = shortAckAfterReadback({ transcript: "Y me pone dos, tres", language: "es" } as any, "Quesadilla. $5.00. ¿Algo más?");
  assert.equal(r.actions.length, 0); assert.match(r.reply, /De qué/);
});
