import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const ld = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const ops = (l: any) => (l.modifiers || []).map((m: any) => m.option);
const d = ld("CA955dd7-edgar-mix1");
test("edgar-mix1: uno de X, uno de Y → one taco per meat, no blank tacos, burrito dup collapsed", () => {
  const c = structuredClone(d.cart); L.applyTacoMeatList(c, d.turns);
  const tacos = c.filter((l: any) => /^sq-taco-/.test(l.itemId));
  assert.equal(tacos.length, 5); assert.ok(tacos.every((l: any) => ops(l).filter((o: string) => /Bistec|[Pp]astor|Picadillo|Deshebrada|Lengua/.test(o)).length === 1));
  const b = c.filter((l: any) => /^sq-burrito-/.test(l.itemId)); assert.equal(b.length, 2);
});
