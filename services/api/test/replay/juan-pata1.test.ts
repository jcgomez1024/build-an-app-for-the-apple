import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyMenudoPata } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA39b59a-juan-pata1.json", import.meta.url), "utf8"));
test("juan-pata1: 'un menudo con todo' + staff '¿Con pata?' + 'sí' → Menudo con Pata", () => {
  const c = structuredClone(d.cart.cart); assert.equal(applyMenudoPata(c, d.turns), true);
  const m = c.filter((l: any) => /menudo/.test(l.itemId)); assert.equal(m.length, 1); assert.equal(m[0].itemId, "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG"); assert.equal(m[0].quantity, 1);
  assert.ok(c.some((l: any) => /horchata/.test(l.itemId)));
});
test("juan-pata1 rule: '¿Con pata?' + 'no, normal' stays regular", () => {
  const c = [{ itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 1, modifiers: [] }];
  assert.equal(applyMenudoPata(c, [{ speaker: "caller", text: "un menudo" }, { speaker: "staff", text: "¿Con pata?" }, { speaker: "caller", text: "No, normal." }] as any), false);
  assert.equal(c[0].itemId, "sq-menudo-menudo-con-tortillas-4-ZSRUX4");
});
