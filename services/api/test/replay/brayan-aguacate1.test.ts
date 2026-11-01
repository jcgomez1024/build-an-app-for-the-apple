import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyAguacateFull, liveAguacateFull, aguacateSaid, AGUACATE_FULL_VAR } from "../../src/list-repair.ts";
import { nameFromTranscriptInfo, snapToKnownName } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA1c9adf-brayan-aguacate1.json", import.meta.url), "utf8"));
const AG = { id: "sq-extras-aguacate-full-QGR5AQ", name: "Aguacate FULL", squareVariationId: AGUACATE_FULL_VAR, priceCents: 400 };
const menu = [AG, { id: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", name: "Menudo" }];
test("brayan-aguacate1: standalone 'un aguacate' rings Aguacate FULL after the call, menudos kept", () => {
  const c = structuredClone(d.cart); assert.equal(applyAguacateFull(c, d.turns, menu), true);
  assert.equal(c.length, 3); const a = c.find((l: any) => l.itemId === AG.id); assert.equal(a.quantity, 1);
  assert.equal(applyAguacateFull(c, d.turns, menu), false);
});
test("brayan-aguacate1: live 'un aguacate' adds Aguacate FULL and never says it's off the menu", () => {
  const r = liveAguacateFull({ reply: "Perdón, no tenemos aguacate en el menú. Lo más popular es Quesadilla.", actions: [] }, { transcript: "un aguacate", language: "es", menu, cart: [] });
  assert.deepEqual(r.actions, [{ type: "add_item", itemId: AG.id, quantity: 1, modifiers: [] }]);
  assert.doesNotMatch(r.reply, /no tenemos/); assert.match(r.reply, /aguacate entero/);
});
test("brayan-aguacate1: topping 'con aguacate' / guacamole is not a whole avocado", () => {
  assert.equal(aguacateSaid("un burrito con aguacate"), null);
  assert.equal(aguacateSaid("tacos sin aguacate"), null);
  assert.equal(aguacateSaid("un guacamole"), null);
  assert.equal(aguacateSaid("dos aguacates enteros"), 2);
  assert.equal(aguacateSaid("y un aguacate entero"), 1);
  const r = { reply: "Listo.", actions: [] };
  assert.equal(liveAguacateFull(r, { transcript: "un burrito de bistec con aguacate", menu, cart: [] }), r);
});
test("brayan-aguacate1: 'Abra ya, por favor' is not a name; staff 'Brian' snaps to saved Bryan", () => {
  const n = nameFromTranscriptInfo(d.turns as any)?.name;
  assert.doesNotMatch(String(n), /Abra|Ya/);
  assert.equal(snapToKnownName(n, ["Bryan"], d.turns), "Bryan");
});
