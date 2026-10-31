// juan9 (CA170467, Oct 31 6:57 PM ET): "¿A qué nombre sería?" "Juan." saved as "Aac" — "¿a, a cómo" read as spelled A-A-C, and the readback confirm "Así es" read as a name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const N = await import("../../src/order-name.ts");
const L = await import("../../src/list-repair.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const d = JSON.parse(readFileSync(new URL("../fixtures/CA170467-juan9.json", import.meta.url), "utf8"));
test("juan9: the answer to the staff name ask wins; no spelled junk", () => {
  assert.equal(N.spelledNameFromCall(d.turns), null);
  assert.equal(N.nameFromStaffAsk(d.turns), "Juan");
  assert.equal(N.nameFromTranscriptInfo(d.turns)?.name, "Juan");
});
test("juan9: real spelled names still work", () => {
  assert.equal(N.spelledNameFromCall([{ speaker: "caller", text: "J O E L" }] as any), "Joel");
});
test("juan9: correct TCO cart untouched by late tortilla choice", () => {
  const c = structuredClone(d.cart.cart); assert.equal(L.applyLateTortillaChoice(c, d.turns, menu), false); assert.deepEqual(c, d.cart.cart);
});
