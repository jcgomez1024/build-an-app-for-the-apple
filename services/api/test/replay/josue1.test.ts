// josue1 (CA0ee8b4, Nov 6 ~10:41 AM ET): Spanish desk pickup.
// "cinco tacos de bistec, no, tres de bistec y una costilla" is a same-turn rewrite, not a cancel of bistec.
// Staff "Taqueroso de Comal" plus "Tres de bistec y dos de costilla" + "sí" is 3 TCO bistec + 2 TCO costilla.
// A real "de X no" that is never replaced still drops that meat. Not a one-call special case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { applyAffirmedMeatRecap, applyNegatedMeat, negatedMeats } from "../../src/list-repair.ts";
import { spokenLedger } from "../../src/spoken-ledger.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CA0ee8b4-josue1.json", import.meta.url), "utf8"));
const TACO = "sq-taco-TAR7L5";
const TCO = { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" };
const TST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
const BISTEC = { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" };
const COSTILLA = { step: "(B) T Carnes / Meats Opciones", option: "Costilla / Beef Rib" };
const menu = [
  { id: TACO, name: "Taco", modifierGroups: [
    { name: "(A) T Tortilla Options", options: [{ name: TCO.option }, { name: TST.option }, { name: "(THR) Taco Harina / Flour (+$0.50)" }] },
    { name: "(B) T Carnes / Meats Opciones", options: [{ name: BISTEC.option }, { name: COSTILLA.option }, { name: "Alpastor / Roasted Pork" }, { name: "Tripa / Beef Tripe" }] },
  ] },
];

/** Live miss: the bistec add is held for a tortilla question, the correction is heard as 5 bistec, costilla is dropped. */
function stub() {
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/bistec/.test(t) && /taco/.test(t)) return { actions: [], reply: "Taco: ¿comal o harina?" };
    if (/costilla/.test(t)) return { actions: [{ type: "add_item", itemId: TACO, quantity: 1, modifiers: [TST, COSTILLA] }], reply: "Un taco de costilla. $4.00." };
    return { actions: [], reply: "¿Algo más?" };
  };
  r.menu = () => menu;
  return r;
}

const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
const qtyOf = (ls: any[], re: RegExp) => ls.filter((l) => re.test(opts(l))).reduce((n, l) => n + (Number(l.quantity) || 1), 0);

test("josue1: same-turn 'N de X, no, M de X' is a rewrite; 'de X no' with no replacement still negates", () => {
  assert.deepEqual(negatedMeats("Quiero cinco tacos de bistec, no, tres de bistec y una costilla."), []);
  assert.deepEqual(negatedMeats("cinco de bistec, no, tres de costilla"), ["bistec"]);
  assert.deepEqual(negatedMeats("No, no, no, cuatro, no, de costilla no."), ["costilla"]);
  assert.deepEqual(negatedMeats("pastor no, de bistec"), ["alpastor"]);
  assert.deepEqual(negatedMeats("¿de costilla, no?"), []);
  const cart = [{ itemId: TACO, quantity: 5, modifiers: [TST, BISTEC] }];
  applyNegatedMeat(cart, d.turns, menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 5);
  assert.match(opts(cart[0]), /Bistec/);
  const wiped = [{ itemId: TACO, quantity: 4, modifiers: [TCO, COSTILLA] }];
  applyNegatedMeat(wiped, [{ speaker: "caller", text: "No, no, no, cuatro, no, de costilla no." }, { speaker: "caller", text: "dos de tripa y uno de lengua" }], menu);
  assert.equal(wiped.some((l) => /Costilla/i.test(opts(l))), false);
  assert.ok(wiped.some((l) => /Tripa/i.test(opts(l))));
});

test("josue1: spoken ledger keeps the rewrite and the affirmed 3+2 comal recap", () => {
  const sl = spokenLedger(d.turns);
  assert.ok(sl, "ledger should explain the tacos");
  const lines = sl!.lines.filter((l) => l.itemId === TACO);
  assert.equal(qtyOf(lines, /Bistec/), 3, JSON.stringify(sl!.lines));
  assert.equal(qtyOf(lines, /Costilla/), 2, JSON.stringify(sl!.lines));
  assert.ok(lines.every((l) => /TCO|Comal|Homemade/i.test(opts(l))), JSON.stringify(lines));
  assert.equal(lines.some((l) => /TST|Street/i.test(opts(l))), false);
});

test("josue1: empty cart after a false bistec cancel is rebuilt as 3 TCO bistec + 2 TCO costilla, name Josue, still an order", async () => {
  const empty: any[] = [];
  assert.equal(applyAffirmedMeatRecap(empty, d.turns, menu), true);
  assert.equal(qtyOf(empty, /Bistec/), 3, JSON.stringify(empty));
  assert.equal(qtyOf(empty, /Costilla/), 2, JSON.stringify(empty));
  assert.ok(empty.every((l) => /TCO|Comal|Homemade/i.test(opts(l))), JSON.stringify(empty));

  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const tacos = (r.cart || []).filter((l: any) => l.itemId === TACO);
  const dump = JSON.stringify(r.cart);
  assert.equal(qtyOf(tacos, /Bistec/), 3, dump);
  assert.equal(qtyOf(tacos, /Costilla/), 2, dump);
  assert.ok(tacos.every((l: any) => /TCO|Comal|Homemade/i.test(opts(l))), dump);
  assert.equal(tacos.some((l: any) => /TST|Street/i.test(opts(l))), false, dump);
  assert.equal((r.cart || []).length, 2, dump);
  assert.notEqual(r.noOrder, true);
  assert.equal(r.fulfillment, "PICKUP");
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Josue");
});
