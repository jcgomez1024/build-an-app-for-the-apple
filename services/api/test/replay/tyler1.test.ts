// tyler1 (CA4d1f3074, Nov 5 ~8:19 PM ET): English pickup, Tyler.
// Six small/corn chorizo tacos are street (TST), not homemade comal. A separate "chorizo dorado tacos"
// is one Tacos Dorados con todo, not another soft taco. "Chips and guacamole" + "dip" (staff ASR "deep in chips")
// is guacamole dip con chips, not a phantom Taco Comal. "Two Mexican Cokes" is two Coca Colas even when staff hears "cooks".
// Esquite and the salsa cups the model already rang stay. Not a one-call special case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns, staffPick } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { choseSmallCornStreetTaco, isTacoDoradoPhrase, liveMexicanCoke, liveTacoDorado } from "../../src/list-repair.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CA4d1f3074-tyler1.json", import.meta.url), "utf8"));
const TACO = "sq-taco-TAR7L5";
const DORADOS = "sq-tacos-dorados-tacos-dorados-OHFWF3";
const DIPS = "sq-dips-MAIPCN";
const ESQ = "sq-esquite-elvis-esquite-16oz-SGPEZK";
const COCA = "sq-drink-coca-cola-JJE4KC";
const EXTRAS = "sq-extras-mild-salsa-asada-2oz-T6PGNT";
const TCO = { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" };
const CHO = { step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" };
const TACO_ASK = "Taco: ¿Taco Comal, Taco Harina o Taco Taquero?";

/** Stub repeats the live miss: soft Taco Comal for the street tacos, the dorado, and the dip confirmation. No Coke. */
function stub() {
  let six = false, dorado = false, phantom = false, esq = false, salsa = false;
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/chorizo/.test(t) && /taco/.test(t) && !/dorado/.test(t) && !six) {
      six = true;
      return { actions: [{ type: "add_item", itemId: TACO, quantity: 6, modifiers: [TCO, CHO] }], reply: TACO_ASK };
    }
    if (/dorado/.test(t) && /taco/.test(t) && !dorado) {
      dorado = true;
      return { actions: [{ type: "add_item", itemId: TACO, quantity: 1, modifiers: [TCO, CHO] }], reply: "One taco comal chorizo." };
    }
    if (/\bdip\b/.test(t) && !phantom) {
      phantom = true;
      return { actions: [{ type: "add_item", itemId: TACO, quantity: 1, modifiers: [TCO, CHO] }], reply: "Taco Comal." };
    }
    if (/esquite/.test(t) && !esq) {
      esq = true;
      return { actions: [{ type: "add_item", itemId: ESQ, quantity: 1, modifiers: [{ step: "Esquite Elvis", option: "Esquite 16oz" }] }], reply: "Esquite 16oz." };
    }
    if (/hot sauce|limes/.test(t) && !salsa) {
      salsa = true;
      return { actions: [
        { type: "add_item", itemId: EXTRAS, quantity: 1, modifiers: [{ step: "Extras options", option: "Mild Salsa Asada 2oz" }] },
        { type: "add_item", itemId: EXTRAS, quantity: 1, modifiers: [{ step: "Extras options", option: "Hot Salsa Roja 2oz" }] },
      ], reply: "Hot salsa." };
    }
    return { actions: [], reply: "Anything else?" };
  };
  r.menu = () => [
    { id: TACO, name: "Taco", modifierGroups: [{ name: "(A) T Tortilla Options", options: [{ name: "(TCO) Taco Comal / Homemade (+$1.00)" }, { name: "(TST) Taco Taquero / Street Taco" }, { name: "(THR) Taco Harina / Flour (+$0.50)" }] }, { name: "(B) T Carnes / Meats Opciones", options: [{ name: "Chorizo / Mexican Sausage" }] }] },
    { id: DORADOS, name: "Tacos Dorados", modifierGroups: [{ name: "(A) Nachos Carne Options", options: [{ name: "Chorizo / Mexican Sausage" }] }, { name: "(B) TD Topping Options", options: [{ name: "Lechuga / Lettuce" }, { name: "Pico de Gallo" }] }] },
    { id: DIPS, name: "Dips", modifierGroups: [{ name: "Dips", options: [{ name: "Guacamole Dip con Chips" }] }] },
    { id: ESQ, name: "Esquite", modifierGroups: [] },
    { id: COCA, name: "Coca Cola", modifierGroups: [] },
    { id: EXTRAS, name: "Extras", modifierGroups: [] },
  ];
  return r;
}

const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
const qty = (ls: any[]) => ls.reduce((n, l) => n + (Number(l.quantity) || 1), 0);

test("tyler1: corn / the small one is street taco, not comal; quesadilla corn stays comal", () => {
  const tacoOpts = ["Taco Comal", "Taco Harina", "Taco Taquero"];
  assert.equal(staffPick(tacoOpts, "Corn. Corn."), "Taco Taquero");
  assert.equal(staffPick(tacoOpts, "the small one."), "Taco Taquero");
  assert.equal(staffPick(tacoOpts, "Homemade or corn, the more small one"), null);
  assert.equal(staffPick(tacoOpts, "Taco normal, taquero."), "Taco Taquero");
  assert.equal(staffPick(["Quesadilla Comal", "Quesadilla Harina", "Quesadilla Taquera"], "Corn is okay, corn."), "Quesadilla Comal");
  assert.equal(choseSmallCornStreetTaco(d.turns), true);
  assert.equal(isTacoDoradoPhrase("can I please get, the chorizo dorado tacos?"), true);
  assert.equal(isTacoDoradoPhrase("dos quesadillas doradas de bistec"), false);
});

test("tyler1: live taco dorado is not a soft taco; two Mexican Cokes are two Coca Colas", () => {
  const swapped: any = liveTacoDorado(
    { reply: "Taco comal.", actions: [{ type: "add_item", itemId: TACO, quantity: 1, modifiers: [TCO, CHO] }] },
    { transcript: "can I please get, the chorizo dorado tacos?", language: "en", cart: [] },
  );
  assert.equal(swapped.actions[0].itemId, DORADOS);
  assert.match(opts(swapped.actions[0]), /Chorizo/);
  assert.equal(liveTacoDorado({ reply: "x", actions: [{ type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [] }] }, { transcript: "dos quesadillas doradas", cart: [] }).actions[0].itemId, "sq-quesadilla-HLT6CR");
  const coke: any = liveMexicanCoke({ reply: "Anything else?", actions: [] }, { transcript: "And then two Mexican Cokes.", language: "en", cart: [] });
  assert.equal(coke.actions[0].itemId, COCA);
  assert.equal(coke.actions[0].quantity, 2);
  assert.match(coke.actions[0].readback, /glass/i);
  assert.equal(liveMexicanCoke({ reply: "x", actions: [] }, { transcript: "Two Mexican cooks?", cart: [] }).actions.length, 0);
});

test("tyler1: 6 TST chorizo + 1 tacos dorados con todo + guacamole dip + esquite + 2 Coca Cola, Tyler", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart;
  const dump = JSON.stringify(c.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l) })));
  const soft = c.filter((l: any) => l.itemId === TACO);
  assert.equal(qty(soft), 6, dump);
  assert.ok(soft.every((l: any) => /\(TST\)|Taco Taquero|Street Taco/i.test(opts(l)) && /Chorizo/i.test(opts(l))), dump);
  assert.equal(soft.some((l: any) => /\(TCO\)|Homemade/i.test(opts(l))), false, dump);
  const dor = c.filter((l: any) => l.itemId === DORADOS);
  assert.equal(qty(dor), 1, dump);
  assert.match(opts(dor[0]), /Chorizo/);
  assert.match(opts(dor[0]), /Lechuga/);
  assert.match(opts(dor[0]), /Pico de Gallo/);
  const dip = c.filter((l: any) => l.itemId === DIPS);
  assert.equal(qty(dip), 1, dump);
  assert.match(opts(dip[0]), /Guacamole Dip con Chips/);
  const esq = c.filter((l: any) => l.itemId === ESQ);
  assert.equal(qty(esq), 1, dump);
  const coke = c.filter((l: any) => /coca/i.test(String(l.itemId)));
  assert.equal(qty(coke), 2, dump);
  assert.match(String(coke[0].readback || ""), /glass/i);
  assert.equal(c.some((l: any) => /quesadilla-dorada|qd-deluxe|qd-regular/i.test(String(l.itemId))), false, dump);
  assert.ok(c.some((l: any) => /Hot Salsa Roja/i.test(opts(l))), dump);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Tyler");
  assert.equal(r.fulfillment, "PICKUP");
});
