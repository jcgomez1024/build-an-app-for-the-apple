// acevedo1 (CA99d48f, Oct 31 1:46 PM ET): staff "¿Acevedo?" → "Sí" = name; "Okay, permíteme." never a name; "127 calle Amor".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const N = await import("../../src/order-name.ts");
const D = await import("../../src/delivery.ts");
const d = JSON.parse(readFileSync(new URL("../fixtures/CA99d48f-acevedo1.json", import.meta.url), "utf8"));
test("acevedo1: staff-proposed '¿Acevedo?' + yes beats the filler vocative", () => {
  assert.equal(N.nameFromTranscriptInfo(d.turns)?.name, "Acevedo");
});
test("acevedo1: filler variants are never names", () => {
  for (const w of ["Permíteme", "Permiteme", "permítame", "Permitame", "PERMITEME", "Permitime", "Espérame"]) assert.ok(N.isFillerName(w), w);
  assert.ok(!N.isFillerName("Acevedo"));
  assert.equal(N.nameFromTranscriptInfo([{ speaker: "staff", text: "Okay, permíteme." }, { speaker: "caller", text: "Sí." }] as any)?.name ?? null, null);
});
test("acevedo1 general: '¿Comal?' + sí is not a name; no yes → no name", () => {
  assert.equal(N.staffProposedName([{ speaker: "staff", text: "¿Comal?" }, { speaker: "caller", text: "Sí." }] as any), null);
  assert.equal(N.staffProposedName([{ speaker: "staff", text: "¿Acevedo?" }, { speaker: "caller", text: "No, soy Juan." }] as any), null);
});
test("acevedo1 address: '127 calle Amor' → 127 Amor St (never '127 Calle St'), still unconfirmed", () => {
  const a = D.detectAddress(d.turns); assert.equal(a.address?.street, "127 Amor St"); assert.equal(a.confirmed, false);
  assert.equal(D.addressesIn("vivo en la 45 avenida Jackson")[0]?.street, "45 Jackson Ave");
});
