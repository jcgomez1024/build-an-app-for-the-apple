import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyMenudoCountSinPata, pongameCount } from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAc47de1-diana-menudo1.json", import.meta.url), "utf8"));
test("diana-menudo1: 'póngame cuatro' + 'sin pata' → 4 regular menudos", () => {
  const c = structuredClone(d.cart); applyMenudoCountSinPata(c, d.turns);
  assert.equal(c.length, 1); assert.equal(c[0].itemId, "sq-menudo-menudo-con-tortillas-4-ZSRUX4"); assert.equal(c[0].quantity, 4);
});
test("diana-menudo1 rule: póngame N only counts with no other dish named", () => {
  assert.equal(pongameCount("uy, póngame cuatro, por favor."), 4);
  assert.equal(pongameCount("póngame dos tacos"), 0);
});
test("diana-menudo1 name: 'soy Diana, la esposa de Pedro' is the caller, not pickup-only", () => {
  const r = nameFromTranscriptInfo(d.turns);
  assert.equal(r?.name, "Diana"); assert.equal(r?.thirdPerson, false);
});
