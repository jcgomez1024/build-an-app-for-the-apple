import { strict as assert } from "node:assert";
import { test } from "node:test";
import { nameFromAnswer, nameFromTranscript } from "../../src/order-name.js";
test("name3p1: third-person 'se llama' in a long answer", () => {
  assert.equal(nameFromAnswer("Sí, el nombre sería para, es una señora que trabaja conmigo, se llama Zuleima."), "Zuleima");
  assert.equal(nameFromAnswer("it's for my coworker, her name is Testa"), "Testa");
  assert.equal(nameFromAnswer("Ana"), "Ana");
  assert.equal(nameFromAnswer("¿cómo se llama?"), null);
});
test("name3p1: staff ask merged into caller turn", () => {
  const turns = [
    { speaker: "caller" as const, text: "mi número es 5 5 5" },
    { speaker: "caller" as const, text: "0, ¿tu nombre? Sí, es para una señora del trabajo, se llama Zuleima." },
    { speaker: "caller" as const, text: "Okay, ¿en cuánto tiempo?" },
  ];
  assert.equal(nameFromTranscript(turns), "Zuleima");
});
