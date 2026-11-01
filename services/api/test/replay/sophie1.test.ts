import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyBurritoFillings, applyQdConTodo, applyQuesadillaMasa, normalizeFriedQuesadilla } from "../../src/list-repair.ts";
import { cleanFirstName } from "../../src/caller-memory.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA65a540-sophie1.json", import.meta.url), "utf8"));
const fresh = () => JSON.parse(JSON.stringify(d.cart));
const opts = (l: any) => (l.modifiers || []).map((m: any) => m.option);
test("sophie1: burrito con arroz y frijoles = fillings; crema+queso yes, no cilantro/cebolla, medium salsa; rice side dropped", () => {
  const c = fresh(); assert.ok(applyBurritoFillings(c, d.turns));
  const b = c.find((l: any) => /^sq-burrito-/.test(l.itemId)); const o = opts(b);
  for (const x of ["Bistec / Steak", "Arroz / Rice", "Frijoles Refritos / Refried Beans", "Crema / Sour Cream", "Queso Fresco / Cheese", "Medium Salsa Verde"]) assert.ok(o.includes(x), x);
  assert.ok(!o.includes("Cilantro") && !o.includes("Cebolla / Onion"));
  assert.ok(!c.some((l: any) => l.itemId === "sq-sides-arroz-rice-26S6E6"));
});
test("sophie1: real rice side kept; plain burrito untouched", () => {
  const c = [{ itemId: "sq-burrito-TGWBEN", quantity: 1, modifiers: [{ step: "(B) Burrito Carne Options", option: "Bistec / Steak" }] }, { itemId: "sq-sides-arroz-rice-26S6E6", quantity: 1, modifiers: [] }];
  applyBurritoFillings(c, [{ speaker: "caller", text: "un burrito de bistec con arroz y frijoles" }, { speaker: "caller", text: "y una orden de arroz aparte" }] as any);
  assert.equal(c.length, 2);
  const c2 = [{ itemId: "sq-burrito-TGWBEN", quantity: 1, modifiers: [{ step: "(C) Burrito Options", option: "Cilantro" }] }];
  assert.equal(applyBurritoFillings(c2, [{ speaker: "caller", text: "un burrito de asada" }] as any), false);
});
test("sophie1: dorada 'con todo' → DELUXE; 'regular' stays", () => {
  const c = fresh(); assert.ok(applyQdConTodo(c, d.turns));
  assert.ok(c.some((l: any) => /deluxe-preparada/.test(l.itemId) && opts(l).includes("Chorizo / Mexican Sausage")));
  const c2 = fresh(); assert.equal(applyQdConTodo(c2, [{ speaker: "caller", text: "una quesadilla dorada regular de chorizo con todo" }] as any), false);
});
test("sophie1: 'quesadilla de masa' + later 'chorizo' → comal chorizo quesadilla once", () => {
  const c = fresh(); assert.ok(applyQuesadillaMasa(c, d.turns));
  const q = c.filter((l: any) => l.itemId === "sq-quesadilla-HLT6CR"); assert.equal(q.length, 1);
  assert.ok(opts(q[0]).some((o: string) => /\(QCO\)/.test(o)) && opts(q[0]).includes("Chorizo / Mexican Sausage"));
  assert.equal(applyQuesadillaMasa(c, d.turns), false);
  assert.match(normalizeFriedQuesadilla("una quesadilla de masa de chorizo"), /quesadilla de comal/);
});
test("sophie1: vocatives are not names; 'Sophie. Sophie, sí.' is", () => {
  for (const v of ["Mister", "Miss", "Señor", "Señora", "Señorita", "Joven", "Jefe", "Amigo", "Sir"]) assert.equal(cleanFirstName(v), null, v);
  assert.equal(cleanFirstName("Sophie"), "Sophie");
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Sophie");
});
