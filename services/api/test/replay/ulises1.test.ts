import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyVerduraAparte } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA48f268-ulises1.json", import.meta.url), "utf8"));
test("ulises1: 'me pones verdura… aparte' → 2 tortas al pastor carry 'verdura aparte'", () => {
  const c = structuredClone(d.cart.cart); assert.equal(applyVerduraAparte(c, d.turns), true);
  assert.equal(c.length, 1); assert.equal(c[0].quantity, 2); assert.deepEqual(c[0].elviNotes, ["verdura aparte"]);
  assert.ok(!c[0].modifiers.some((m: any) => /DELUXE/.test(m.option)));
  assert.equal(applyVerduraAparte(c, d.turns), false);
});
test("ulises1 rule: no aparte → no note; 'aparte una horchata' is not verdura", () => {
  const c = [{ itemId: "sq-torta-4GNTTE", quantity: 1, modifiers: [] }];
  assert.equal(applyVerduraAparte(c, [{ speaker: "caller", text: "una torta con verdura" }, { speaker: "caller", text: "y aparte una horchata" }] as any), false);
});
