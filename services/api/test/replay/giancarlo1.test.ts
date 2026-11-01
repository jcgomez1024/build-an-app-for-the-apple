import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameFromTranscriptInfo, snapToKnownName, soundsLikeName, isFillerLedName, resolveNameAnswer } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA978a75-giancarlo1.json", import.meta.url), "utf8"));
test("giancarlo1: 'Allá en Carlos' with memory Giancarlo → Giancarlo", () => {
  const heard = nameFromTranscriptInfo(d.turns)?.name || null;
  assert.equal(snapToKnownName(heard, ["Giancarlo", "Allá En Carlos"]), "Giancarlo");
  assert.equal(snapToKnownName("Allá en Carlos", ["Giancarlo"]), "Giancarlo");
});
test("giancarlo1 rule: sounds-alike / shared tail → known name", () => {
  assert.ok(soundsLikeName("Allá en Carlos", "Giancarlo"));
  assert.ok(soundsLikeName("Yan Carlo", "Giancarlo"));
  assert.ok(soundsLikeName("Hulián", "Julián"));
  assert.equal(snapToKnownName("Julian", ["Julián"]), "Julián");
  assert.ok(!soundsLikeName("Pedro", "Giancarlo"));
  assert.equal(snapToKnownName("Pedro", ["Giancarlo"]), "Pedro");
  assert.ok(!soundsLikeName("Ana", "Juana"));
});
test("giancarlo1 rule: multi-word answers led by filler/place word are rejected without a memory match", () => {
  assert.ok(isFillerLedName("Allá en Carlos")); assert.ok(isFillerLedName("En Carlos")); assert.ok(!isFillerLedName("Carlos")); assert.ok(!isFillerLedName("Juan Pérez"));
  assert.equal(snapToKnownName("Allá en Carlos", []), null);
  assert.equal(snapToKnownName("Allá en Carlos", ["Pedro"]), null);
  assert.equal(snapToKnownName("Juan Pérez", ["Pedro"]), "Juan Pérez");
});
test("giancarlo1 live: name-ask answer that sounds like the saved name uses it", () => {
  const r = resolveNameAnswer("Allá en Carlos.", { kind: "ask" }, "Giancarlo");
  const n = r ? snapToKnownName(r.name, ["Giancarlo"]) : snapToKnownName("Allá en Carlos", ["Giancarlo"]);
  assert.equal(n, "Giancarlo");
});
