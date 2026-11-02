import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameFromTranscriptInfo } from "../../src/order-name.js";

// horacio1 (CAfd40d3): name ask answered with chatter; staff "Ok, Horacio, está bien." — saved "Está" live.
const d = JSON.parse(readFileSync(new URL("../fixtures/CAfd40d3-horacio1.json", import.meta.url), "utf8"));
test("horacio1: staff vocative 'Ok, Horacio' is the name; 'Está' never is", () => {
  const r = nameFromTranscriptInfo(d.turns);
  assert.equal(r?.name, "Horacio");
  assert.doesNotMatch(String(r?.name), /^est[aá]$/i);
});
test("horacio1: 'está / esta / está bien' never become names", () => {
  for (const a of ["Está bien.", "Esta.", "Sí, está bien.", "Ahorita."]) {
    const r = nameFromTranscriptInfo([{ speaker: "staff", text: "¿A qué nombre sería la orden?" }, { speaker: "caller", text: a }] as any);
    assert.doesNotMatch(String(r?.name ?? ""), /^(?:est[aá]|bien|ahorita)\b/i, a);
  }
});
