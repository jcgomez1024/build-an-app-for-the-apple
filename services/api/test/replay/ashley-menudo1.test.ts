import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyMenudoCountSinPata, liveMenudoCountSinPata } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAe86b1c-ashley-menudo1.json", import.meta.url), "utf8"));
const REG = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
test("ashley-menudo1: 'tres menudos' + 'sin pata' → 3 regular menudos, tortillas kept", () => {
  const c = structuredClone(d.cart.cart); assert.equal(applyMenudoCountSinPata(c, d.turns), true);
  const m = c.filter((l: any) => /menudo/.test(l.itemId)); assert.equal(m.length, 1); assert.equal(m[0].itemId, REG); assert.equal(m[0].quantity, 3);
  assert.ok(c.some((l: any) => /sq-tortillas-12/.test(l.itemId)));
});
test("ashley-menudo1 rule: sin pata turns a con-pata line regular", () => {
  const c: any[] = [{ itemId: "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG", quantity: 2, modifiers: [] }];
  applyMenudoCountSinPata(c, [{ speaker: "caller", text: "dos menudos sin pata" }] as any); assert.equal(c[0].itemId, REG); assert.equal(c[0].quantity, 2);
});
test("ashley-menudo1 live: '(4)' is never the quantity and 'sin pata' never reads 'extra pata'", () => {
  const r = liveMenudoCountSinPata({ reply: "4 × Menudo con Tortillas (4): comal, extra pata. $75.96. ¿Algo más?", actions: [{ type: "add_item", itemId: REG, quantity: 4, modifiers: [] }] },
    { transcript: "Una libra de tortillas Sin pata Una 12 x Tortilla Comal", history: [{ role: "customer", text: "¿Tienes menudos y media kilo de tortillas, sí?" }], language: "es" });
  assert.equal(r.actions[0].quantity, 1); assert.doesNotMatch(r.reply, /pata|4 ×/);
  const r3 = liveMenudoCountSinPata({ reply: "", actions: [{ type: "add_item", itemId: REG, quantity: 4 }] }, { transcript: "tres menudos sin pata", history: [] });
  assert.equal(r3.actions[0].quantity, 3);
});
