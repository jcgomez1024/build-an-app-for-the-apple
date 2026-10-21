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
