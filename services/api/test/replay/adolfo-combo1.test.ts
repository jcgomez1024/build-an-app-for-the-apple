import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const ld = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const ops = (l: any) => (l.modifiers || []).map((m: any) => m.option);
const d = ld("CAb98bde-adolfo-combo1");
test("adolfo-combo1: 2 QCO bistec + staff combo con arroz y frijol → one COMBO", () => {
  const c = structuredClone(d.cart); L.applyQuesadillaCombo(c, d.turns);
  assert.equal(c.length, 1); assert.equal(c[0].itemId, "sq-combo-quesadillas-BATSPB"); assert.equal(c[0].quantity, 1);
  assert.deepEqual(ops(c[0]), ["(QCO) 2 x Comal / Homemade (+$2.00)", "1 x Bistec / Steak", "1 x Bistec / Steak", "Arroz - Rice and Frijoles Refritos - Refried Beans"]);
});
