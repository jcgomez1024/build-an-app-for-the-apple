// oscar2 (CAc49c8f053775f2a0060e11371d4ee358, Oct 30 7:51 PM ET, Oscar Martínez, staff-answered Spanish pickup): 4 tacos de comal =
// 2 tripa + 1 lengua + 1 cabeza. Staff guessed costilla, caller "No, no, no… de costilla no"; Elvi rang 4 costilla + 2 tripa + 1 cabeza
// + a phantom cabeza Tacos Dorados, missed lengua, and saved "Martínez" after staff asked for the apellido.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyNegatedMeat, dropUnsaidDorados, negatedMeats, noNegatedMeat, applyStaffReadback, fillMeatlessFromCaller } from "../../src/list-repair.ts";
import { nameFromTranscriptInfo, withSurname } from "../../src/order-name.ts";
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const turns = fx("CAc49c8f0-turns.json"), menu = fx("CA4bdd506-menu.json");
const sig = (cart: any[]) => cart.map((l) => `${l.quantity} ${String(l.itemId).replace(/^sq-([a-z-]+?)-[A-Z0-9]+$/, "$1")} ${(l.modifiers || []).map((m: any) => String(m.option).replace(/ \(\+\$[\d.]+\)/, "").split(" / ")[0]).filter((o: string) => !/Salsa/.test(o)).sort().join("|")}`).sort();

test("negatedMeats: 'de X no', 'no, de X no', 'X no' negate; '¿de X, no?' and 'no más' don't", () => {
  assert.deepEqual(negatedMeats("No, no, no, cuatro, no, de costilla no."), ["costilla"]);
  assert.deepEqual(negatedMeats("pastor no, de bistec"), ["alpastor"]);
  assert.deepEqual(negatedMeats("no de lengua, de cabeza"), ["lengua"]);
  assert.deepEqual(negatedMeats("¿de costilla, no?"), []);
  assert.deepEqual(negatedMeats("no, no más, gracias"), []);
});
test("oscar2 post-call: 4 comal tacos = 2 tripa + 1 lengua + 1 cabeza; no costilla, no phantom Tacos Dorados", () => {
  const cart = fx("CAc49c8f0-cart.json");
  applyStaffReadback(cart, turns, menu); fillMeatlessFromCaller(cart, turns, menu); applyNegatedMeat(cart, turns, menu); dropUnsaidDorados(cart, turns);
  assert.deepEqual(sig(cart), ["1 taco (TCO) Taco Comal|Cabeza", "1 taco (TCO) Taco Comal|Lengua", "2 taco (TCO) Taco Comal|Tripa"]);
});
test("oscar2 live: an add carrying the meat the caller just negated drops that meat", () => {
  const r = { reply: "x", actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 4, modifiers: [{ step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "(B) T Carnes / Meats Opciones", option: "Costilla / Beef Rib" }] }] };
  const o = noNegatedMeat(r, { transcript: "No, no, no, cuatro, no, de costilla no." });
  assert.deepEqual(o.actions[0].modifiers.map((m: any) => m.option), ["(TCO) Taco Comal / Homemade (+$1.00)"]);
  assert.equal(noNegatedMeat(r, { transcript: "cuatro de costilla" }), r);
});
test("oscar2 name: surname after the apellido ask joins the first name → 'Oscar Martínez'", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Oscar Martínez");
  assert.equal(withSurname(turns as any, "Martínez"), "Oscar Martínez");
  assert.equal(withSurname([{ speaker: "staff", text: "¿A qué nombre?" }, { speaker: "caller", text: "Ana." }] as any, "Ana"), "Ana");
});
