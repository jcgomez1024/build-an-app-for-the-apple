import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const ld = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const ops = (l: any) => (l.modifiers || []).map((m: any) => m.option);
const d = ld("CA35a924-kevin-combo1");
test("kevin-combo1: 'dos quesadilla combo' uno de bistec y uno de chorizo → combo only, item #2 chorizo", () => {
  const c = structuredClone(d.cart); L.applyQuesadillaCombo(c, d.turns);
  assert.equal(c.length, 1); assert.equal(c[0].itemId, "sq-combo-quesadillas-BATSPB");
  assert.ok(ops(c[0]).includes("1 x Bistec / Steak")); assert.ok(ops(c[0]).includes("1 x Chorizo / Mexican Sausage"));
});
test("kevin-combo1: plain quesadilla order is not turned into a combo", () => {
  const turns = [{ speaker: "caller", text: "Me da una quesadilla de bistec de harina" }];
  const c = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [] }];
  assert.equal(L.applyQuesadillaCombo(c, turns as any), false); assert.equal(c.length, 1);
});
