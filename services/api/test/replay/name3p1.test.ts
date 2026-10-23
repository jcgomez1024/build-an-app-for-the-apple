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
import { thirdPersonName, nameFromTranscriptInfo, markOrderOnlyName, isOrderOnlyName, rememberOrderName } from "../../src/order-name.js";
test("name3p2: third-person name is order-only", () => {
  assert.equal(thirdPersonName("es para mi compañera, se llama Zuleima"), "Zuleima");
  assert.equal(thirdPersonName("me llamo Zuleima"), null);
  const t = [{ speaker: "staff" as const, text: "¿A nombre de quién?" }, { speaker: "caller" as const, text: "es para una señora del trabajo, se llama Zuleima." }];
  assert.deepEqual(nameFromTranscriptInfo(t), { name: "Zuleima", thirdPerson: true });
  assert.deepEqual(nameFromTranscriptInfo([{ speaker: "staff", text: "¿A nombre de quién?" }, { speaker: "caller", text: "Testo" }]), { name: "Testo", thirdPerson: false });
  markOrderOnlyName("Quirina");
  assert.equal(isOrderOnlyName("quirina"), true);
  assert.equal(isOrderOnlyName("Quirina", Date.now() + 31 * 60_000), false);
  assert.deepEqual(rememberOrderName("+15550000000", "Quirina"), { saved: false, reason: "third-person" });
});
