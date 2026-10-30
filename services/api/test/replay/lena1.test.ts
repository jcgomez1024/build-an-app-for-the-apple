// lena1 (CA7629f001, Oct 30 6:34 PM ET, Lena, English pickup, two orders, 143 s). Order 1: 2 flour steak quesadillas + guac 2oz.
// Order 2: "one chorizo steak quesadilla, flour … no, one chorizo and then one steak one" + 2 sour creams + extra limes, only
// cilantro (staff: cilantro and onions). Live: "another order" re-added order 1, a dual-meat line, no sides/note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { noEchoReAdd } from "../../src/elvi.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA7629f001-turns.json", import.meta.url), "utf8"));
const menu = JSON.parse(readFileSync(new URL("../fixtures/CA7629f001-menu.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR", X = "sq-extras-mild-salsa-asada-2oz-T6PGNT";
const FL = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
const ST = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, CH = { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" };
const add = (quantity: number, ...m: any[]) => ({ type: "add_item", itemId: Q, quantity, modifiers: [FL, ...m] });
// replays the live mis-steps: echo re-adds of order 1 on "another order"/"The two", then a dual-meat line
const raw = async (t: string) => {
  if (/two flour steak/i.test(t)) return { reply: "2 × Quesadilla: flour, steak. Anything else?", actions: [add(2, ST)] };
  if (/guacamole/i.test(t)) return { reply: "Guacamole 2oz. Anything else?", actions: [{ type: "add_item", itemId: X, quantity: 1, modifiers: [{ step: "Extras options", option: "Guacamole Salsa 2oz" }] }] };
  if (/another order|^the two/i.test(t)) return { reply: "2 × Quesadilla: flour, steak. Anything else?", actions: [add(2, ST)] };
  if (/chorizo steak/i.test(t)) return { reply: "Quesadilla: flour, steak and chorizo. Anything else?", actions: [add(1, ST, CH)] };
  return { reply: "Okay.", actions: [] };
};
let hist: any[] = [];
const run = Object.assign(async (t: string, language: any) => { const r: any = noEchoReAdd(await raw(t), { transcript: t, language, menu, history: hist }); hist = [...hist, { role: "assistant", text: r.reply }]; return r; }, { menu: () => menu });
const opts = (l: any) => l.modifiers.map((m: any) => m.option);

test("lena1: order 1 = 2 flour steak + guac; order 2 = 1 flour chorizo + 1 flour steak, 2 sour cream, lime, cilantro y cebolla", async () => {
  hist = [];
  const r: any = await shadowOrderFromTurns(structuredClone(turns), run as any);
  const qs = r.cart.filter((l: any) => l.itemId === Q);
  assert.equal(qs.length, 3, JSON.stringify(qs));
  assert.equal(qs[0].quantity, 2); assert.deepEqual(opts(qs[0]).filter((o: string) => /Steak|Chorizo/.test(o)), ["Bistec / Steak"]); assert.equal(qs[0].person, undefined);
  const o2 = qs.slice(1);
  assert.deepEqual(o2.map((l: any) => [l.quantity, opts(l).filter((o: string) => /Steak|Chorizo/.test(o)).join("+")]), [[1, "Chorizo / Mexican Sausage"], [1, "Bistec / Steak"]]);
  for (const l of o2) { assert.ok(opts(l).includes(FL.option)); assert.ok(l.person); assert.deepEqual(l.elviNotes, ["solo cilantro y cebolla"]); }
  assert.equal(new Set(o2.map((l: any) => l.person)).size, 1);
  const side = (re: RegExp) => r.cart.filter((l: any) => l.itemId === X && re.test(opts(l).join()));
  assert.equal(side(/Sour Cream/)[0]?.quantity, 2); assert.equal(side(/Sour Cream/)[0].person, o2[0].person);
  assert.equal(side(/Lime/).length, 1); assert.equal(side(/Guacamole/).length, 1);
});

test("lena1: echo re-add guard keeps named or 'same again' adds", () => {
  const h = [{ role: "assistant", text: "2 × Quesadilla: flour, steak. Anything else?" }];
  const go = (t: string) => noEchoReAdd({ reply: "r", actions: [add(2, ST)] }, { transcript: t, language: "en", menu, history: h }).actions.length;
  assert.equal(go("And then, can I place another order?"), 0);
  assert.equal(go("The two."), 0);
  assert.equal(go("two more steak ones"), 1);
  assert.equal(go("same again please"), 1);
  assert.equal(noEchoReAdd({ reply: "r", actions: [add(2, ST)] }, { transcript: "two", language: "en", menu, history: [{ role: "assistant", text: "How many steak quesadillas?" }] }).actions.length, 1);
});
