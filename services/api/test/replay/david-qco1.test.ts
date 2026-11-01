// david-qco1 (CAbd7168, Sun Nov 1 4:38 PM ET): 2 TCO pastor, 2 TCO bistec, 1 TCO cabeza; plate 2: 3 QCO bistec + 4 QCO tripa;
// plate 3: 2 QCO pastor + 1 QCO tripa; + Cebolla y Chiles Asados. Elvi: 2 bistec (stated-total trim), no pastor QCO, no asados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyStatedDishTotal, applyMultiMeatGroup, applyAsadosSide, asadosSideSaid } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAbd7168-david-qco1.json", import.meta.url), "utf8"));
const Q = (n: number, m: string) => ({ itemId: "sq-quesadilla-HLT6CR", quantity: n, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: m }] });
const sig = (c: any[]) => c.filter((l) => /quesadilla/.test(l.itemId)).map((l) => l.quantity + ":" + l.modifiers.find((m: any) => /Carnes/.test(m.step)).option.split(" ")[0]).sort();
test("david-qco1: per-plate counts are not trimmed to one group's 'tres quesadillas'", () => {
  const c = [...structuredClone(d.elviOrder.cart.slice(0, 3)), Q(3, "Bistec / Steak"), Q(4, "Tripa / Beef Tripe (+$0.50)"), Q(2, "Alpastor / Roasted Pork"), Q(1, "Tripa / Beef Tripe (+$0.50)")];
  assert.equal(applyStatedDishTotal(c, d.turns), false); assert.deepEqual(sig(c), ["1:Tripa", "2:Alpastor", "3:Bistec", "4:Tripa"]);
});
test("david-qco1: 'dos de a pastor y una de tripa de comal' restores the missing pastor QCO line", () => {
  const c = structuredClone(d.elviOrder.cart); assert.ok(applyMultiMeatGroup(c, d.turns, []));
  const p = c.find((l: any) => /quesadilla/.test(l.itemId) && l.modifiers.some((m: any) => /Alpastor/.test(m.option)));
  assert.equal(p.quantity, 2); assert.ok(p.modifiers.some((m: any) => /QCO/.test(m.option)));
  assert.equal(c.filter((l: any) => /taco/.test(l.itemId)).length, 3);
});
test("david-qco1: 'cebollita y chilito' + staff 'chile asado' → Cebolla y Chiles Asados extra", () => {
  assert.ok(asadosSideSaid(d.turns));
  const menu = [{ id: "sq-extras-X", modifierGroups: [{ name: "Extras options", options: [{ name: "Cebolla y Chiles Asados" }] }] }];
  const c: any[] = []; assert.ok(applyAsadosSide(c, d.turns, menu)); assert.equal(c[0].modifiers[0].option, "Cebolla y Chiles Asados");
  assert.equal(asadosSideSaid([{ speaker: "caller", text: "con cebolla y cilantro" }, { speaker: "staff", text: "ok" }] as any), false);
});
test("david-qco1: existing pastor line is not duplicated", () => {
  const c = structuredClone(d.elviOrder.cart); applyMultiMeatGroup(c, d.turns, []); const n = c.length;
  assert.equal(applyMultiMeatGroup(c, d.turns, []), false); assert.equal(c.length, n);
});
