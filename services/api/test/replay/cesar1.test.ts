// cesar1 (CAac3c079, Nov 6 ~3:54 PM ET, pickup): 2 gorditas de chicharrón prensado and
// 2 street tacos with BOTH bistec and chorizo. The miss split "dos tacos de bistec chorizo"
// into 1 steak + 1 chorizo, then a staff readback of both dishes copied the gordita's prensado
// onto the tacos. "bistec y chorizo" with no count on the second meat is both meats on each taco.
// A counted split ("dos de bistec y dos de chorizo") stays two lines. Not a one-call special case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { applyCompanionMeats, companionMeatOrders } from "../../src/list-repair.ts";
import { spokenLedger } from "../../src/spoken-ledger.ts";
import { clearOrderContext, orderContextTurn } from "../../src/order-context.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CAac3c079-cesar1.json", import.meta.url), "utf8"));
const GORDITA = "sq-gordita-M647RE";
const TACO = "sq-taco-TAR7L5";
const GD = { step: "(A) Gordita Options", option: "(GD) Gordita" };
const PRENSADO_G = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
const TST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
const BISTEC = { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" };
const CHORIZO = { step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" };
const PRENSADO_T = { step: "(B) T Carnes / Meats Opciones", option: "Prensado / Spicy Pork" };

const MENU = [
  { id: GORDITA, name: "Gordita", modifierGroups: [
    { name: "(A) Gordita Options", minSelections: 1, options: [{ name: GD.option }] },
    { name: "(B) Q Carnes / Meats", minSelections: 1, maxSelections: 2, options: [{ name: PRENSADO_G.option }, { name: "Duro / Pork Rinds" }] },
  ] },
  { id: TACO, name: "Taco", modifierGroups: [
    { name: "(A) T Tortilla Options", minSelections: 1, options: [{ name: "(TCO) Taco Comal / Homemade (+$1.00)" }, { name: TST.option }, { name: "(THR) Taco Harina / Flour (+$0.50)" }] },
    { name: "(B) T Carnes / Meats Opciones", minSelections: 1, maxSelections: 2, options: [{ name: BISTEC.option }, { name: CHORIZO.option }, { name: PRENSADO_T.option }] },
  ] },
];

/** Live miss: dual meats become 1+1, and the readback later copies prensado onto the tacos. */
function stub() {
  let gordita = false, tacos = false, shell = false;
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/gorditas?/.test(t) && /prensado|chicharr/.test(t) && !gordita) {
      gordita = true;
      return { actions: [{ type: "add_item", itemId: GORDITA, quantity: 2, modifiers: [GD, PRENSADO_G] }], reply: "Dos gorditas de chicharrón prensado. ¿Algo más?" };
    }
    if (/tacos?/.test(t) && /bistec/.test(t) && /chorizo/.test(t) && !tacos) {
      tacos = true;
      return { actions: [], reply: "Taco: ya tengo 1 bistec y 1 chorizo. ¿Taco Comal, Taco Harina o Taco Taquero?" };
    }
    if (/taquer|normales/.test(t) && !shell) {
      shell = true;
      return {
        actions: [
          { type: "add_item", itemId: TACO, quantity: 1, modifiers: [TST, BISTEC] },
          { type: "add_item", itemId: TACO, quantity: 1, modifiers: [TST, CHORIZO] },
        ],
        reply: "2 tacos taqueros: 1 bistec, 1 chorizo. ¿Algo más?",
      };
    }
    return { actions: [], reply: "¿Algo más?" };
  };
  r.menu = () => MENU;
  return r;
}

const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
const qty = (ls: any[], id: string, re: RegExp) => ls.filter((l) => l.itemId === id && re.test(opts(l))).reduce((n, l) => n + (Number(l.quantity) || 1), 0);

test("cesar1: uncounted 'bistec y chorizo' is both meats; a counted split is not", () => {
  assert.deepEqual(companionMeatOrders("Y dos tacos de bistec chorizo.").map((o) => o.meats), [["bistec", "chorizo"]]);
  assert.deepEqual(companionMeatOrders("dos tacos taqueros de bistec y chorizo").map((o) => [o.qty, o.meats.join("+")]), [[2, "bistec+chorizo"]]);
  assert.deepEqual(companionMeatOrders("tres quesadillas de bistec con chorizo").map((o) => o.qty), [3]);
  assert.equal(companionMeatOrders("dos de bistec y dos de chorizo").length, 0);
  assert.equal(companionMeatOrders("uno de bistec y uno de chorizo").length, 0);
  assert.equal(companionMeatOrders("cinco tacos de bistec, no, tres de bistec y una costilla.").length, 0);
});

test("cesar1: spoken ledger keeps prensado on the gorditas and both meats on the street tacos", () => {
  const beforeYes = d.turns.slice(0, d.turns.findIndex((t: { text: string }) => t.text === "Sí."));
  const early = spokenLedger(beforeYes);
  assert.ok(early, "the order is complete before the readback yes");
  assert.equal(early!.lines.filter((l) => l.itemId === TACO && /Prensado/i.test(opts(l))).length, 0, JSON.stringify(early!.lines));
  assert.match(opts(early!.lines.find((l) => l.itemId === TACO)!), /Bistec/);
  assert.match(opts(early!.lines.find((l) => l.itemId === TACO)!), /Chorizo/);
  const sl = spokenLedger(d.turns);
  assert.ok(sl, "ledger should explain both dishes");
  const lines = sl!.lines;
  assert.equal(qty(lines, GORDITA, /Prensado/), 2, JSON.stringify(lines));
  const tacos = lines.filter((l) => l.itemId === TACO);
  assert.equal(tacos.reduce((n, l) => n + l.quantity, 0), 2, JSON.stringify(lines));
  assert.equal(tacos.length, 1, JSON.stringify(lines));
  assert.match(opts(tacos[0]), /Bistec/);
  assert.match(opts(tacos[0]), /Chorizo/);
  assert.match(opts(tacos[0]), /TST|Taquero|Street/);
  assert.equal(tacos.some((l) => /Prensado/i.test(opts(l))), false, JSON.stringify(lines));
  const affirmed = spokenLedger([...d.turns, { speaker: "staff", text: "Dos gorditas de prensado y dos tacos taqueros de bistec y chorizo." }, { speaker: "caller", text: "Sí." }]);
  const again = (affirmed?.lines || []).filter((l) => l.itemId === TACO);
  assert.equal(again.some((l) => /Prensado/i.test(opts(l))), false, JSON.stringify(affirmed?.lines));
  assert.equal(again.reduce((n, l) => n + l.quantity, 0), 2);
});

test("cesar1: 'dos tacos de bistec chorizo' is not a 1-and-1 pending split", () => {
  clearOrderContext("cesar1-both");
  clearOrderContext("cesar1-y");
  clearOrderContext("cesar1-split");
  assert.equal(orderContextTurn("cesar1-both", "Y dos tacos de bistec chorizo.", MENU as any, "es"), null);
  assert.equal(orderContextTurn("cesar1-y", "dos tacos de bistec y chorizo", MENU as any, "es"), null);
  const split = orderContextTurn("cesar1-split", "cuatro tacos dos de bistec y dos de chorizo", MENU as any, "es");
  assert.ok(split && split.pending, JSON.stringify(split));
  assert.match(split!.reply, /2/);
  assert.doesNotMatch(split!.reply, /1 bistec y 1 chorizo/);
  clearOrderContext("cesar1-split");
});

test("cesar1: a carried prensado taco and a 1+1 split repair to 2 tacos with both meats", () => {
  const cart: any[] = [
    { itemId: GORDITA, quantity: 2, modifiers: [GD, PRENSADO_G] },
    { itemId: TACO, quantity: 2, modifiers: [TST, PRENSADO_T] },
    { itemId: TACO, quantity: 2, modifiers: [TST, BISTEC] },
  ];
  assert.equal(applyCompanionMeats(cart, d.turns, MENU), true);
  assert.equal(qty(cart, GORDITA, /Prensado/), 2, JSON.stringify(cart));
  const tacos = cart.filter((l) => l.itemId === TACO);
  assert.equal(tacos.length, 1, JSON.stringify(cart));
  assert.equal(tacos[0].quantity, 2);
  assert.match(opts(tacos[0]), /Bistec/);
  assert.match(opts(tacos[0]), /Chorizo/);
  assert.match(opts(tacos[0]), /TST|Street/);
  assert.doesNotMatch(opts(tacos[0]), /Prensado/);
  const split: any[] = [
    { itemId: "sq-quesadilla-HLT6CR", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyCompanionMeats(split, [{ speaker: "caller", text: "cuatro quesadillas, dos de bistec y dos de chorizo" }], MENU);
  assert.equal(split.length, 2);
  assert.equal(split[0].quantity, 2);
  assert.equal(split[1].quantity, 2);
});

test("cesar1: 2 gorditas prensado and 2 street tacos with bistec and chorizo, name César", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart || [];
  const dump = JSON.stringify(c.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l) })));
  assert.equal(qty(c, GORDITA, /Prensado/), 2, dump);
  const tacos = c.filter((l: any) => l.itemId === TACO);
  assert.equal(tacos.length, 1, dump);
  assert.equal(tacos[0].quantity, 2, dump);
  assert.match(opts(tacos[0]), /Bistec/, dump);
  assert.match(opts(tacos[0]), /Chorizo/, dump);
  assert.match(opts(tacos[0]), /TST|Taquero|Street/, dump);
  assert.equal(c.some((l: any) => l.itemId === TACO && /Prensado/i.test(opts(l))), false, dump);
  assert.equal(c.some((l: any) => l.itemId === TACO && /Bistec/.test(opts(l)) && !/Chorizo/.test(opts(l))), false, dump);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "César");
  assert.notEqual(nameFromTranscriptInfo(d.turns)?.name, "De César");
  assert.equal(r.fulfillment, "PICKUP");
});
