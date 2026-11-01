import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCoctelPulpo, coctelPulpoSaid, COCTEL_IDS } from "../../src/list-repair.ts";
import { nameFromTranscriptInfo, thirdPartyNames } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA2b1d41-juan-coctel1.json", import.meta.url), "utf8"));
test("juan-coctel1: 'coctel de camarón con pulpo' (staff 'Con pulpo claro') → Coctel con Pulpo; ceviche de pescado kept", () => {
  const c = JSON.parse(JSON.stringify(d.cart)); assert.ok(applyCoctelPulpo(c, d.turns));
  assert.equal(c[0].itemId, COCTEL_IDS.pulpo); assert.match(c[1].itemId, /ceviche-de-pescado/);
  assert.equal(applyCoctelPulpo(c, d.turns), false);
  assert.equal(coctelPulpoSaid([{ speaker: "caller", text: "un coctel de camarón, sin pulpo" }] as any), false);
  assert.equal(coctelPulpoSaid([{ speaker: "caller", text: "un coctel de camarón" }, { speaker: "staff", text: "Con pulpo, ¿verdad?" }] as any), true);
  assert.equal(coctelPulpoSaid([{ speaker: "caller", text: "un coctel de camarón" }] as any), false);
});
test("juan-coctel1: the delivery driver ('este es Carlos el que anda entregando') is never the name; 'es para Juan' wins", () => {
  assert.deepEqual(thirdPartyNames(d.turns), ["carlos"]);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Juan");
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "¿Su nombre?" }, { speaker: "caller", text: "Pedro, y el repartidor Luis ya sabe" }] as any)?.name, "Pedro");
  assert.equal(nameFromTranscriptInfo([{ speaker: "caller", text: "Dígale que este es Carlos el que anda entregando." }] as any), null);
});
