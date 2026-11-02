import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { confirmedReadback, parseReadback } from "../../src/readback-rebuild.js";

// carlos3 (CAf907ff): caller confirmed staff readback "tres tacos de comal de biste, dos tacos taqueros de chorizo,
// dos quesadillas de harina de biste, una quesadilla de harina de chorizo, las tres quesadillas de comal de tripa".
const d = JSON.parse(readFileSync(new URL("../fixtures/CAf907ff-carlos3.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const it = (id: string, n: number, mods: any[]) => ({ type: "add_item", itemId: id, quantity: n, modifiers: mods });
const T = (n: number, s: string, m: string) => it("sq-taco-TAR7L5", n, [{ step: "(A) T Tortilla Options", option: s }, { step: "(B) T Carnes / Meats Opciones", option: m }]);
const Q = (n: number, s: string, m: string) => it("sq-quesadilla-HLT6CR", n, [{ step: "(A) Q Tortilla Options", option: s }, { step: "(B) Q Carnes / Meats", option: m }]);
const TST = "(TST) Taco Taquero / Street Taco", TCO = "(TCO) Taco Comal / Homemade (+$1.00)", QHR = "(QHR) Quesadilla Harina / Flour (+$0.75)", QCO = "(QCO) Quesadilla Comal / Homemade (+$1.00)";
const BI = "Bistec / Steak", CH = "Chorizo / Mexican Sausage", TR = "Tripa / Beef Tripe (+$0.50)";
const live = (dup: boolean) => { const r: any = async (t: string) => { const p = t.toLowerCase(); const a: any[] = [];
  if (/dos tacos taqueros de chorizo/.test(p)) a.push(T(2, TST, CH));
  if (/tres tacos al comal de bistec/.test(p)) a.push(T(3, TCO, BI));
  if (/tres quesadillas de harina/.test(p)) a.push(Q(2, QHR, BI), Q(1, QHR, CH));
  else if (dup && /serían dos de bistec/.test(p)) a.push(Q(2, QCO, BI), Q(1, QCO, CH), Q(2, QCO, BI), Q(1, QCO, CH));
  if (/quesadillas al comal de tripa/.test(p)) a.push(Q(3, QCO, TR));
  return { actions: a, reply: "ok" }; }; r.menu = () => M; return r; };
const sig = (cart: any[]) => cart.map((l) => `${l.quantity} ${l.itemId} ${l.modifiers.map((m: any) => m.option).sort().join("+")}`).sort();
const W = (n: number, id: string, ...o: string[]) => `${n} ${id} ${o.sort().join("+")}`;
const want = [W(2, "sq-quesadilla-HLT6CR", BI, QHR), W(1, "sq-quesadilla-HLT6CR", CH, QHR), W(3, "sq-quesadilla-HLT6CR", QCO, TR), W(3, "sq-taco-TAR7L5", BI, TCO), W(2, "sq-taco-TAR7L5", CH, TST)].sort();

test("carlos3: confirmed staff readback parsed per item (tortilla + meat + count)", () => {
  const rb = confirmedReadback(d.turns)!; assert.equal(rb.length, 5);
  assert.deepEqual(rb.map((r) => `${r.qty} ${r.kind} ${r.style.source}`), ["3 taco ^\\(TCO\\)", "2 taco ^\\(TST\\)", "2 quesadilla ^\\(QHR\\)", "1 quesadilla ^\\(QHR\\)", "3 quesadilla ^\\(QCO\\)"]);
});
for (const dup of [true, false]) test(`carlos3: after-call cart = confirmed readback (live dup restatement=${dup})`, async () => {
  const r: any = await shadowOrderFromTurns(d.turns, live(dup));
  assert.deepEqual(sig(r.cart), want);
  for (const l of r.cart) if (/Chorizo/.test(JSON.stringify(l)) && /taco/.test(l.itemId)) assert.doesNotMatch(JSON.stringify(l), /TCO/);
});
test("carlos3: unconfirmed or partial readback is not trusted", () => {
  const turns = d.turns.map((t: any) => (/^Sí, cierto/.test(t.text) ? { ...t, text: "No, espérame." } : t));
  assert.equal(confirmedReadback(turns), null);
  assert.equal(parseReadback("dos tacos de chorizo, tres quesadillas de harina de bistec"), null); // taco tortilla unspecified
});
