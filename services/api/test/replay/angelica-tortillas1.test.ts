import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const ld = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const ops = (l: any) => (l.modifiers || []).map((m: any) => m.option);
const d = ld("CA9a517b-angelica-tortillas1");
test("angelica-tortillas1: 3 dup comal packs + taquera → 1 line of 2 dozen comal", () => {
  const c = structuredClone(d.cart); L.applyTortillaPackDedupe(c, d.turns);
  assert.equal(c.length, 1); assert.equal(c[0].itemId, "sq-tortillas-12-x-tortilla-comal-handmade-VGID3H"); assert.equal(c[0].quantity, 2);
});
