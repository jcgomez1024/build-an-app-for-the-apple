// alex1: synthetic. "¿tiene chilaquiles?" asks; "dos huevos" on a dish with eggs is no extra; "Y en otro …," waits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityQuestion, shortAckAfterReadback, sameLineGuard, recordLastAdd } from "../../src/elvi.ts";
const menu: any[] = [{ id: "chq", name: "Chilaquiles con Huevo", priceCents: 799, modifierGroups: [{ id: "X", name: "Extras", options: [{ id: "eh", name: "1 x EXTRA Huevo (+$1.25)" }] }, { id: "C", name: "Carnes / Meats", options: [{ id: "b", name: "Bistec / Steak (+$3.00)" }] }] }];
test("alex1: '¿tiene chilaquiles?' is a question — no ring", () => {
  assert.equal(availabilityQuestion({ transcript: "Disculpa, ¿tiene chilaquiles?", language: "es" } as any)!.actions.length, 0);
  assert.equal(availabilityQuestion({ transcript: "dos chilaquiles", language: "es" } as any), null);
});
test("alex1: a half sentence ('Y en otro no me le puede poner este,') rings nothing", () => {
  assert.equal(shortAckAfterReadback({ transcript: "Y en otro no me le puede poner este,", language: "es" } as any, "Chilaquiles. $7.99. ¿Algo más?")!.actions.length, 0);
});
test("alex1: 'dos huevos' after the dish is no new line and no extra egg; 'otro' + 'en vez de huevos bistec' is a second line", () => {
  recordLastAdd("alx1", [{ type: "add_item", itemId: "chq", quantity: 1, modifiers: [] }]);
  const add = (mods: string[]) => ({ language: "es", reply: "x", actions: [{ type: "add_item", itemId: "chq", quantity: 1, modifiers: mods.map((o) => ({ step: "", option: o })) }] }) as any;
  const base: any = { language: "es", menu, resolverMenu: menu, sessionKey: "alx1" };
  assert.equal(sameLineGuard(add(["1 x EXTRA Huevo (+$1.25)"]), { ...base, transcript: "dos huevos", history: [] }).actions.length, 0);
  const r = sameLineGuard(add(["1 x EXTRA Huevo (+$1.25)", "Bistec / Steak (+$3.00)"]), { ...base, transcript: "en vez de huevos bistec", history: [{ role: "customer", text: "Y en otro no me le puede poner este," }] });
  assert.equal(r.actions[0].type, "add_item"); assert.deepEqual(r.actions[0].modifiers.map((m: any) => m.option), ["Bistec / Steak (+$3.00)"]);
});
import { insteadOfEggs } from "../../src/elvi.ts";
test("alex1: 'en vez de huevos bistec' after 'Y en otro …,' adds a second dish with bistec only", () => {
  recordLastAdd("alx2", [{ type: "add_item", itemId: "chq", quantity: 1, modifiers: [] }]);
  const r: any = insteadOfEggs({ transcript: "en vez de huevos bistec", language: "es", menu, resolverMenu: menu, sessionKey: "alx2", history: [{ role: "customer", text: "Y en otro no me le puede poner este," }] } as any);
  assert.equal(r.actions[0].type, "add_item"); assert.deepEqual(r.actions[0].modifiers.map((m: any) => m.option), ["Bistec / Steak (+$3.00)"]);
});
import { oneOfAskedDish } from "../../src/elvi.ts";
test("alex1: 'deme uno con,' after asking about chilaquiles rings one chilaquiles", () => {
  const r: any = oneOfAskedDish({ transcript: "Ajá Ah, deme uno con,", language: "es", menu, resolverMenu: menu, history: [{ role: "customer", text: "Disculpa, ¿tiene chilaquiles?" }] } as any);
  assert.equal(r.actions[0].itemId, "chq");
  assert.equal(oneOfAskedDish({ transcript: "deme uno de asada", language: "es", menu, resolverMenu: menu, history: [{ role: "customer", text: "¿tiene chilaquiles?" }] } as any), null);
});
