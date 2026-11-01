import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { liveEtaAddressQty } from "../../src/eta-qty.ts";
import { orCorrections } from "../../src/or-count.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA4d4c38-stephanie1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const it = (id: string, n: number, mods: any[]) => ({ type: "add_item", itemId: id, quantity: n, modifiers: mods });
const B = () => it("sq-burrito-TGWBEN", 1, [{ step: "(A) Burrito Size", option: "Regular '10" }, { step: "(B) Burrito Carne Options", option: "Alpastor / Roasted Pork" }]);
const T = (n: number) => it("sq-taco-TAR7L5", n, [{ step: "(B) T Carnes / Meats Opciones", option: "Alpastor / Roasted Pork" }, { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" }]);
const Q = (m: string) => it("sq-quesadilla-HLT6CR", 1, [{ step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { step: "(B) Q Carnes / Meats", option: m }]);
const key = (l: any) => `${l.quantity} ${l.itemId} ${(l.modifiers || []).map((m: any) => m.option).join("|")}`;

test("stephanie1: replay rings burrito, 8 TCO al pastor, QHR chorizo + QHR bistec", async () => {
  const run: any = async (t: string) => { const p = t.toLowerCase();
    if (/burrito/.test(p)) return { actions: [B()], reply: "x" };
    if (/eight tacos/.test(p)) return { actions: [T(6)], reply: "x" };
    if (/quesadilla of chorizo/.test(p)) return { actions: [Q("Chorizo / Mexican Sausage")], reply: "x" };
    return { actions: [], reply: "?" }; };
  run.menu = () => M;
  const r: any = await shadowOrderFromTurns(d.turns, run);
  assert.deepEqual(r.cart.map(key), [
    "1 sq-burrito-TGWBEN Regular '10|Alpastor / Roasted Pork",
    "8 sq-taco-TAR7L5 Alpastor / Roasted Pork|(TCO) Taco Comal / Homemade (+$1.00)",
    "1 sq-quesadilla-HLT6CR (QHR) Quesadilla Harina / Flour (+$0.75)|Chorizo / Mexican Sausage",
    "1 sq-quesadilla-HLT6CR (QHR) Quesadilla Harina / Flour (+$0.75)|Bistec / Steak"]);
});
test("stephanie1: 'N X, or M X' — last number wins; different dishes / no 'or' untouched", () => {
  assert.deepEqual(orCorrections(["And then can I do six tacos, or eight tacos El Pastor"]), [{ kind: "taco", from: 6, to: 8 }]);
  assert.deepEqual(orCorrections(["dos tacos o tres tacos de pastor"]), [{ kind: "taco", from: 2, to: 3 }]);
  assert.deepEqual(orCorrections(["six tacos or two quesadillas"]), []);
  assert.deepEqual(orCorrections(["six tacos and eight tacos"]), []);
});
test("stephanie1 live: staff-pick add at the first number takes the corrected count; readback rebuilt", () => {
  const out = liveEtaAddressQty({ actions: [T(6)], reply: "6 × Taco: comal, al pastor. $24.00. Anything else?" },
    { transcript: "Taco Comal", language: "en", menu: M, history: [{ role: "customer", text: "And then can I do six tacos, or eight tacos El Pastor" }, { role: "assistant", text: "Taco: Taco Comal, Taco Harina or Taco Taquero?" }] });
  assert.equal(out.actions[0].quantity, 8); assert.doesNotMatch(out.reply, /\b6 ×/);
});
test("stephanie1 live: enumerated quesadilla meats each get a line", () => {
  const out = liveEtaAddressQty({ actions: [Q("Chorizo / Mexican Sausage")], reply: "Quesadilla: flour, mexican sausage. $4.25. Anything else?" },
    { transcript: "one quesadilla of chorizo, and then another quesadilla of biste, ar- harina tortilla", language: "en", menu: M, history: [] });
  assert.deepEqual(out.actions.map((a: any) => a.modifiers[1].option), ["Chorizo / Mexican Sausage", "Bistec / Steak"]);
  assert.equal(out.actions[1].modifiers[0].option, "(QHR) Quesadilla Harina / Flour (+$0.75)");
});
