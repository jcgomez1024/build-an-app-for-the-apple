import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const ld = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const ops = (l: any) => (l.modifiers || []).map((m: any) => m.option);
const d = ld("CA921e7c-nena1");
test("nena1: cuatro tortas de milanesa → qty 4, stray Duro dropped, menudo untouched", () => {
  const c = structuredClone(d.cart); L.applyTortaSaid(c, d.turns);
  const t = c.find((l: any) => l.itemId === "sq-torta-4GNTTE"); assert.equal(t.quantity, 4);
  assert.ok(!ops(t).some((o: string) => /Duro/.test(o))); assert.ok(ops(t).some((o: string) => /Milanesa/.test(o)));
  assert.equal(c.find((l: any) => /menudo/.test(l.itemId)).quantity, 3);
});
test("nena1: goodbye 'Ándele' is not a name", () => {
  assert.notEqual(nameFromTranscriptInfo(d.turns as any)?.name, "Ándele");
});
