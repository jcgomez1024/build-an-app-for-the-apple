import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameFromTranscriptInfo, surnameAfterReadback } from "../../src/order-name.ts";
import { cleanFullName, stripNameFillers } from "../../src/caller-memory.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA49ce831-edgar-montes1.json".replace("CA49ce831","CA49ce83"), import.meta.url), "utf8"));
test("edgar-montes1: 'Edgar' → staff 'Edgar' → 'Montes. Eh, sí está bien' = Edgar Montes (never 'Montes Eh')", () => {
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Edgar Montes");
});
test("edgar-montes1 rule: filler tokens never in a name", () => {
  assert.equal(stripNameFillers("Montes Eh"), "Montes"); assert.equal(cleanFullName("Montes Eh"), "Montes"); assert.equal(cleanFullName("Este Pues"), null);
  assert.equal(cleanFullName("Ana López"), "Ana López");
  const T = [{ speaker: "staff", text: "¿A qué nombre?" }, { speaker: "caller", text: "Luis" }, { speaker: "staff", text: "Luis, veinte minutos." }, { speaker: "caller", text: "Sí, gracias." }];
  assert.equal(surnameAfterReadback(T as any, "Luis"), null);
});
