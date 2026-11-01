import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameFromTranscriptInfo, snapToKnownName } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAb6b193-saul-becerra1.json", import.meta.url), "utf8"));
test("saul-becerra1: stated + staff-confirmed 'Saúl Becerra' beats saved 'Raúl'", () => {
  const h = nameFromTranscriptInfo(d.turns)?.name;
  assert.equal(h, "Saúl Becerra");
  assert.equal(snapToKnownName(h, ["Raúl"], d.turns), "Saúl Becerra");
});
test("saul-becerra1 rule: no staff echo → giancarlo1 sounds-like snap still applies", () => {
  const t = [{ speaker: "caller", text: "Saúl" }, { speaker: "staff", text: "Muy bien." }];
  assert.equal(snapToKnownName("Saúl", ["Raúl"], t), "Raúl");
  assert.equal(snapToKnownName("Saúl", ["Raúl"]), "Raúl");
});
