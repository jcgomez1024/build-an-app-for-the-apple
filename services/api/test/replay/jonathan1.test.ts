import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { applyGorditaQueso, dropUnsaidQuesoBirrias, dropGorditaReaddTwin } from "../../src/gordita-queso.js";

// jonathan1 (CA855f43): 1 gordita duro con queso, 1 gordita bistec sin queso (said twice), 1 Coca de vidrio. After-call had an extra duro
// gordita (ledger re-add), 3 × Queso Birrias (the duro's "con queso" read as QB) and the bistec as QGD. Stub = the live model's actions.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA855f43-jonathan1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const G = "sq-gordita-M647RE", QB = "sq-queso-birrias-qst-3-x-queso-birrias-taquera-street-con-consome-broth-VUBNR7";
const g = (meat: string, q: boolean, type = "add_item") => ({ type, itemId: G, quantity: 1, modifiers: [{ step: "(A) Gordita Options", option: q ? "(QGD) Queso Gordita (+$0.50)" : "(GD) Gordita" }, { step: "(B) Q Carnes / Meats", option: meat }] });
const stub = () => { const r: any = async (t: string) => {
  if (/gordita de chicharr/i.test(t)) return { actions: [], reply: "¿Chicharrón del duro en chile verde o prensado en chile rojo?" };
  if (/^\s*duro\W*$/i.test(t)) return { actions: [g("Duro / Pork Rinds", false)], reply: "Gordita: chicharrón duro. ¿Algo más?" };
  if (/^\s*Con queso\W*$/.test(t)) return { actions: [g("Duro / Pork Rinds", true, "update_item")], reply: "Gordita: duro y queso. ¿Algo más?" };
  if (/bistec sin queso/i.test(t)) return { actions: [g("Bistec / Steak", true)], reply: "Gordita: queso gordita, bistec. ¿Algo más?" };
  if (/^\s*sin queso\W*$/i.test(t)) return { actions: [{ ...g("Bistec / Steak", true, "update_item"), modifiers: [...g("Bistec / Steak", true).modifiers, { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" }] }], reply: "Gordita: bistec y chicharrón duro. ¿Algo más?" };
  if (/^\s*con queso\W*$/.test(t)) return { actions: [], reply: "Queso Birrias: ¿3 x Queso Birrias Taquera / Street con Consome/Broth, 3 x Queso Birrias Harina / Flour con Consome/Broth o 3 x Queso Birrias Comal / Homemade con Consome/Broth?" };
  if (/3 x Queso Birrias/i.test(t)) return { actions: [{ type: "add_item", itemId: QB, quantity: 3, modifiers: [] }], reply: "3 × Queso Birrias. ¿Algo más?" };
  if (/coca/i.test(t)) return { actions: [{ type: "add_item", itemId: "sq-drink-coca-cola-JJE4KC", quantity: 1, modifiers: [] }], reply: "Coca Cola. ¿Algo más?" };
  return { actions: [], reply: "Muy bien." }; };
r.menu = () => M; return r; };

test("jonathan1: duro QGD + bistec GD + coke; no Queso Birrias, no duro twin", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const gs = r.cart.filter((l: any) => l.itemId === G);
  assert.equal(gs.length, 2, JSON.stringify(r.cart));
  const duro = gs.find((l: any) => /Duro/.test(JSON.stringify(l.modifiers))), bis = gs.find((l: any) => /Bistec/.test(JSON.stringify(l.modifiers)));
  assert.match(JSON.stringify(duro.modifiers), /QGD/); assert.match(JSON.stringify(bis.modifiers), /\(GD\) Gordita/);
  assert.equal(r.cart.filter((l: any) => /queso-birrias/.test(l.itemId)).length, 0);
  assert.equal(r.cart.filter((l: any) => /coca-cola/.test(l.itemId)).length, 1);
});
test("jonathan1: helpers — QB stays when birria said; 'dos de duro' keeps the twin; shared modifier objects", () => {
  const qb: any[] = [{ itemId: QB, quantity: 3, modifiers: [] }];
  dropUnsaidQuesoBirrias(qb, [{ speaker: "caller", text: "unas quesabirrias" }]); assert.equal(qb.length, 1);
  const mk = () => ({ itemId: G, quantity: 1, modifiers: [{ step: "(A) Gordita Options", option: "(GD) Gordita" }, { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" }] });
  const c: any[] = [mk(), { ...mk(), readback: "1 gordita Duro" }];
  dropGorditaReaddTwin(c, [{ speaker: "caller", text: "dos gorditas de duro" }]); assert.equal(c.length, 2);
  dropGorditaReaddTwin(c, [{ speaker: "caller", text: "una de duro" }]); assert.equal(c.length, 1);
  const A = { step: "(A) Gordita Options", option: "(QGD) Queso Gordita (+$0.50)" };
  const s: any[] = [{ itemId: G, quantity: 1, modifiers: [A, { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" }] }, { itemId: G, quantity: 1, modifiers: [A, { step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] }];
  applyGorditaQueso(s, [{ speaker: "caller", text: "una de duro con queso" }, { speaker: "caller", text: "y una de pollo sin queso" }]);
  assert.match(JSON.stringify(s[0]), /QGD/); assert.match(JSON.stringify(s[1]), /\(GD\)/);
});
