import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameFromTranscriptInfo, firstQueSurname } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA000285-juan-maldonado1.json", import.meta.url), "utf8"));
test("juan-maldonado1: 'One.' → staff 'Juan qué.' → 'Maldonado.' = Juan Maldonado", () => {
  assert.equal(firstQueSurname(d.turns), "Juan Maldonado"); assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Juan Maldonado");
});
test("juan-maldonado1 rule: '¿Y qué?' / '¿De qué?' are not a first name", () => {
  assert.equal(firstQueSurname([{ speaker: "staff", text: "¿De qué?" }, { speaker: "caller", text: "Bistec" }] as any), null);
  assert.equal(firstQueSurname([{ speaker: "staff", text: "Y qué." }, { speaker: "caller", text: "Nada" }] as any), null);
});
