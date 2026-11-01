import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyMenudoPata, menudoSplitText, liveMenudoSplit } from "../../src/list-repair.ts";
import { nameFromAnswer, nameFromTranscriptInfo, dropNombrePrefix } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA2adaa5-felipe-pata1.json", import.meta.url), "utf8"));
test("felipe-pata1: 'dos menudos, uno con pata y el otro normal' → 1 con pata + 1 regular (not 4)", () => {
  assert.deepEqual(menudoSplitText("serían dos menudos, sería uno con pata y el otro normal"), { con: 1, reg: 1 });
  const c = structuredClone(d.cart.cart); assert.equal(applyMenudoPata(c, d.turns), true);
  assert.equal(c.length, 2); assert.deepEqual(c.map((l: any) => [l.itemId, l.quantity]), [["sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG", 1], ["sq-menudo-menudo-con-tortillas-4-ZSRUX4", 1]]);
  assert.ok(!c[1].modifiers.some((m: any) => /Con Pata/.test(m.option)));
  assert.equal(applyMenudoPata(c, d.turns), false);
  assert.deepEqual(menudoSplitText("tres menudos, uno sin pata y los otros con pata"), { con: 2, reg: 1 });
});
test("felipe-pata1 live: split replaces Elvi's menudo adds", () => {
  const r = liveMenudoSplit({ reply: "x", actions: [{ type: "add_item", itemId: "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG", quantity: 2, modifiers: [] }] }, { transcript: "Ah, serían dos menudos, sería uno con pata y el otro normal.", cart: [] });
  assert.deepEqual(r.actions.map((a: any) => [a.type, a.itemId, a.quantity]), [["add_item", "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG", 1], ["add_item", "sq-menudo-menudo-con-tortillas-4-ZSRUX4", 1]]);
});
test("felipe-pata1 name: 'nombre de Felipe' → Felipe, live and after-call", () => {
  assert.equal(nameFromAnswer("Ah, nombre de Felipe."), "Felipe"); assert.equal(nameFromAnswer("A nombre de Ana López"), "Ana López");
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Felipe"); assert.equal(dropNombrePrefix("Nombre De Felipe"), "Felipe"); assert.equal(dropNombrePrefix("Nombre", d.turns), "Felipe");
});
