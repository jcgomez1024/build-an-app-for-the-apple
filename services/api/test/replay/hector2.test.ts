// hector2 (CA17937e, Oct 31 4:28 PM ET): "1 water de Ochata" = 1 horchata; staff "¿Táqueros?" + "Sí" is never the name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const N = await import("../../src/order-name.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const d = JSON.parse(readFileSync(new URL("../fixtures/CA17937e-hector2.json", import.meta.url), "utf8"));
test("hector2: 'water de Ochata' → 1 horchata; tacos untouched", () => {
  const c = structuredClone(d.cart.cart); L.applyAlex3(c, d.turns, menu);
  assert.equal(c.length, 2); assert.deepEqual(c[0], d.cart.cart[0]); assert.match(c[1].itemId, /horchata/); assert.equal(c[1].quantity, 1);
});
test("hector2 live: ASR horchata adds once; not when already in cart", () => {
  const r = L.liveStrongHorchata({ actions: [] }, { transcript: "1 water de Ochata.", cart: [] });
  assert.match(r.actions[0].itemId, /horchata/);
  const r2 = { actions: [] }; assert.equal(L.liveStrongHorchata(r2, { transcript: "agua de ochata", cart: [{ itemId: "sq-drink-agua-fresca-horchata-32oz-HL6HPK" }] }), r2);
});
test("hector2: '¿Táqueros?' + 'Sí' is not a name; food/style words are junk", () => {
  assert.equal(N.nameFromTranscriptInfo(d.turns)?.name ?? null, null); // no name said → caller memory (Héctor) stays
  assert.ok(N.isFillerName("Serían"));
  assert.equal(N.staffProposedName(d.turns), null);
  for (const w of ["Táqueros", "Taqueros", "Comal", "Del Comal", "Harina", "Deluxe", "Regulares"]) assert.ok(N.isFillerName(w), w);
  assert.ok(!N.isFillerName("Héctor"));
});
