// andres-qco1 (CA27a1f0, Sun Nov 1 5:34 PM ET): 2 QCO bistec, 3 QCO bistec con chorizo (combinadas), 2 QCO tripa, 2 TST bistec,
// 2 TST costilla, 2 TST lengua, 2 TST buche, 6 Cebolla y Chiles Asados. Elvi: taco meats copied as QD/QCO (stale quesadilla ask +
// blob-wide comal count), QCO bistec dropped ("cebolla asada, no" read as negated asada), combinadas/tripa/TST bistec/asados missed.
// Not a regression from today's rules (same phantoms at 0c942e1~1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { negatedMeats } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA27a1f0-andres-qco1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const Q = (n: number, m: string) => ({ type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: n, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: m }] });
const T = (n: number, m: string) => ({ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: n, modifiers: [{ step: "(A) Taco Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) Carnes / Meats", option: m }] });
// Elvi's recorded live adds (see fixture steps), replayed deterministically
const run: any = async (text: string) => { const p = text.toLowerCase();
  if (/hechas a mano de bistec/.test(p)) return { actions: [Q(2, "Bistec / Steak")], reply: "ok" };
  if (/taquera, pues, dos de costilla/.test(p)) return { actions: [T(2, "Costilla / Beef Rib")], reply: "ok" };
  if (/no verdad\? lengua dos de lengua/.test(p)) return { actions: [T(2, "Lengua / Beef Tongue (+$0.50)")], reply: "ok" };
  if (/dos tacos de buche, taquera/.test(p)) return { actions: [T(2, "Buche / Pork Stomach (+$0.50)")], reply: "ok" };
  return { actions: [], reply: "?" }; };
run.menu = () => M;
const sig = (c: any[]) => c.map((l) => `${l.quantity} ${/taco/.test(l.itemId) ? "TST" : /dorada/.test(l.itemId) ? "QD" : /quesadilla/.test(l.itemId) ? "QCO" : "X"} ${l.modifiers.map((m: any) => m.option.split(" ")[0]).filter((o: string) => !/^\(/.test(o)).join("+")}`).sort();
test("andres-qco1: full order, no taco meats copied as quesadillas", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, run);
  assert.deepEqual(sig(r.cart), ["2 QCO Bistec", "2 QCO Tripa", "2 TST Bistec", "2 TST Buche", "2 TST Costilla", "2 TST Lengua", "3 QCO Bistec+Chorizo", "6 X Cebolla"].sort());
});
test("andres-qco1: 'chiles y cebolla asada, no, porfa' never negates asada/bistec", () => {
  assert.deepEqual(negatedMeats("seis paquetitos de chiles y cebolla asada, no, porfa"), []);
  assert.deepEqual(negatedMeats("no, de asada no"), ["bistec"]);
});
