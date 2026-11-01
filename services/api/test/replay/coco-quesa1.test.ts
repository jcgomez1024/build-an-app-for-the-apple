import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveQuesaAfterSoup, applyQuesaAfterSoup, quesaContextDish, quesaMeatGroups } from "../../src/list-repair.ts";
import { expandMeatAnswer } from "../../src/call-scoring.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAb08bae-coco-quesa1.json", import.meta.url), "utf8"));
const meats = (l: any) => (l.modifiers || []).filter((m: any) => /Carnes/.test(m.step)).map((m: any) => m.option).sort();
test("coco-quesa1: after-call → 1 menudo, 2 QCO bistec+chorizo, 2 QCO buche", () => {
  const c = structuredClone(d.cart); assert.equal(applyQuesaAfterSoup(c, d.turns), true);
  const men = c.filter((l: any) => /menudo/.test(l.itemId)); assert.equal(men.length, 1); assert.equal(men[0].quantity, 1);
  const q = c.filter((l: any) => l.itemId === "sq-quesadilla-HLT6CR"); assert.equal(q.length, 2);
  assert.deepEqual(q.map((l: any) => [l.quantity, meats(l)]), [[2, ["Bistec / Steak", "Chorizo / Mexican Sausage"]], [2, ["Buche / Pork Stomach"]]]);
  assert.ok(q.every((l: any) => l.modifiers.some((m: any) => /QCO/.test(m.option))));
  assert.equal(applyQuesaAfterSoup(c, d.turns), false);
});
test("coco-quesa1: meat groups — 'con' keeps both meats, stutters count once", () => {
  assert.deepEqual(quesaMeatGroups("Me pone dos de bistec con chorizo."), [{ qty: 2, meats: ["Bistec / Steak", "Chorizo / Mexican Sausage"] }]);
  assert.deepEqual(quesaMeatGroups("Y me pone otro dos... Y dos de, dos de, dos de buche, las otras dos de buche."), [{ qty: 2, meats: ["Buche / Pork Stomach"] }]);
});
test("coco-quesa1: pending menudo + quesadilla ask → meat answer expands onto quesadillas", () => {
  const qd = quesaContextDish("Me, me pones menudo grande", ["¿Cuatro quesadillas de cuáles, joven?", "¿De qué las quieres?"], ["Y cuatro ques...", "¿de, de comal?", "Me pone dos de bistec con chorizo."]);
  assert.equal(qd, "cuatro quesadillas de comal");
  const ex = expandMeatAnswer(qd!, "Me pone dos de bistec con chorizo.")!; assert.ok(ex.every((x) => /quesadilla/.test(x) && !/menudo/.test(x)), ex.join("|"));
  assert.equal(quesaContextDish("menudo grande", ["¿Con pata o sin pata?"], ["sin pata"]), null);
  assert.equal(quesaContextDish("dos tacos", ["¿Quesadillas de qué?"], []), null);
});
test("coco-quesa1: no quesadilla context → soup-only cart untouched", () => {
  const c = [{ itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 2, modifiers: [] }];
  assert.equal(applyQuesaAfterSoup(c, [{ speaker: "caller", text: "dos menudos grandes" }, { speaker: "caller", text: "dos de bistec" }]), false);
  assert.equal(c[0].quantity, 2);
});
test("coco-quesa1: live — meat answer after quesadilla ask replaces the menudo bump with quesadillas", () => {
  const history = [{ role: "customer", text: "Y cuatro ques" }, { role: "assistant", text: "¿Cuatro quesadillas de cuáles?" }, { role: "customer", text: "de comal" }];
  const r = liveQuesaAfterSoup({ reply: "Listo, 2 menudos.", actions: [{ type: "update_quantity", itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 2 }] }, { transcript: "Me pone dos de bistec con chorizo.", history, language: "es" });
  assert.equal(r.actions.length, 1); assert.equal(r.actions[0].itemId, "sq-quesadilla-HLT6CR"); assert.equal(r.actions[0].quantity, 2);
  assert.deepEqual(meats(r.actions[0]), ["Bistec / Steak", "Chorizo / Mexican Sausage"]); assert.ok(r.actions[0].modifiers.some((m: any) => /QCO/.test(m.option)));
  const r2 = liveQuesaAfterSoup({ reply: "ok", actions: [{ type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }] }, { transcript: "dos de bistec con chorizo", history, language: "es" });
  assert.deepEqual(meats(r2.actions[0]), ["Bistec / Steak", "Chorizo / Mexican Sausage"]);
  const plain = { reply: "ok", actions: [{ type: "update_quantity", itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 2 }] };
  assert.equal(liveQuesaAfterSoup(plain, { transcript: "dos menudos", history: [], language: "es" }), plain);
});
