// alvaro1 (CA756fa8, Nov 6 ~11:15 AM ET): Spanish pickup, Álvaro.
// "¿Si tienes pozole?" does not add. Later "un pozole rojo" is one Pozole Rojo.
// "unas tostadas, agrega unas" abandoned for enchiladas stays off the ticket.
// Enchiladas rojas de frijol con todo = Frijol + the $0 toppings, not ***EXTRA Hot Salsa Roja.
// Gordita de chicharrón, then "sí, de prensado" / staff "¿prensado?" / recap "gordita de prensado" commits Prensado.
// The heard name is saveable once the recording still has the 10-digit From. Not a one-call special case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { planCallerName } from "../../src/caller-memory.ts";
import { recordingCallerPhone } from "../../src/twilio.ts";
import { fixEnchiladaSpoken } from "../../src/standard-toppings.ts";
import { gorditaChicharronMeat } from "../../src/list-repair.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CA756fa8-alvaro1.json", import.meta.url), "utf8"));
const ENCH = "sq-enchiladas-orden-de-enchiladas-6-6QOYJ5";
const POZ = "sq-pozole-rojo-red-pozole-DQ7X4J";
const GORD = "sq-gordita-M647RE";
const TOST = "sq-tostada-T0ST4D";
const FRIJOL = { step: "(A) Enchiladas Carne Options (ONLINE)", option: "Frijol / Beans" };
const EXTRA = { step: "(C) EXTRAS", option: "***EXTRA Hot Salsa Roja 2oz (+$0.75)" };
const TOPS = ["Lechuga / Lettuce", "Cebolla / Onion", "Jitomate / Tomato", "Crema / Sour Cream", "Queso Fresco / Fresco Cheese"];
const menu = [
  { id: ENCH, name: "Enchiladas", modifierGroups: [
    { name: "(A) Enchiladas Carne Options (ONLINE)", options: [{ name: "Frijol / Beans", priceDeltaCents: 0 }, { name: "Pollo / Chicken", priceDeltaCents: 0 }] },
    { name: "(D) Toppings", options: TOPS.map((name) => ({ name, priceDeltaCents: 0 })) },
    { name: "(C) EXTRAS", options: [{ name: "***EXTRA Hot Salsa Roja 2oz (+$0.75)", priceDeltaCents: 75 }, { name: "***EXTRA SIDE Crema / Sour Cream", priceDeltaCents: 75 }] },
  ] },
  { id: POZ, name: "Pozole Rojo", modifierGroups: [] },
  { id: GORD, name: "Gordita", modifierGroups: [
    { name: "(A) Gordita Options", options: [{ name: "(GD) Gordita", priceDeltaCents: 0 }] },
    { name: "(B) Q Carnes / Meats", options: [{ name: "Prensado / Spicy Pork", priceDeltaCents: 50 }, { name: "Duro / Pork Rinds", priceDeltaCents: 0 }] },
  ] },
  { id: TOST, name: "Tostada", modifierGroups: [] },
];

/** Live miss: paid salsa on the enchiladas, the abandoned tostada, pozole once, gordita never committed. */
function stub() {
  let ench = false, poz = false, tost = false;
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/tostadas/.test(t) && !tost) {
      tost = true;
      return { actions: [{ type: "add_item", itemId: TOST, quantity: 1, modifiers: [] }], reply: "¿De qué las tostadas?" };
    }
    if (/enchiladas/.test(t) && !ench) {
      ench = true;
      return { actions: [{ type: "add_item", itemId: ENCH, quantity: 1, modifiers: [FRIJOL, EXTRA] }], reply: "Enchiladas de frijol." };
    }
    if (/pozole/.test(t) && !/tienes|tiene\b/.test(t) && !poz) {
      poz = true;
      return { actions: [{ type: "add_item", itemId: POZ, quantity: 1, modifiers: [] }], reply: "Pozole rojo." };
    }
    return { actions: [], reply: "¿Algo más?" };
  };
  r.menu = () => menu;
  return r;
}

const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");

test("alvaro1: enchiladas rojas con todo is not a paid salsa", () => {
  const [a]: any = fixEnchiladaSpoken([{ type: "add_item", itemId: ENCH, modifiers: [FRIJOL, EXTRA] }], menu, "unas enchiladas rojas de frijol con todo");
  assert.match(opts(a), /Frijol/);
  for (const top of TOPS) assert.match(opts(a), new RegExp(top.split(" / ")[0]));
  assert.equal(/EXTRA Hot Salsa|Salsa Roja/.test(opts(a)), false);
  const [kept]: any = fixEnchiladaSpoken([{ type: "add_item", itemId: ENCH, modifiers: [FRIJOL, EXTRA] }], menu, "enchiladas de frijol y una salsa roja aparte");
  assert.match(opts(kept), /EXTRA Hot Salsa/);
});

test("alvaro1: gordita chicharrón answer is prensado, not a quesadilla", () => {
  assert.equal(gorditaChicharronMeat(d.turns), "prensado");
  assert.equal(gorditaChicharronMeat([{ speaker: "caller", text: "dos quesadillas de chicharrón prensado" }]), null);
  assert.equal(gorditaChicharronMeat([{ speaker: "caller", text: "¿si tienes pozole rojo?" }]), null);
});

test("alvaro1: 1 enchilada frijol con todo, 1 pozole rojo, 1 gordita prensado, Álvaro, no tostadas", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart;
  const dump = JSON.stringify(c.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l) })));
  const ench = c.filter((l: any) => l.itemId === ENCH);
  assert.equal(ench.length, 1, dump);
  assert.equal(ench[0].quantity, 1);
  assert.match(opts(ench[0]), /Frijol/);
  for (const top of TOPS) assert.match(opts(ench[0]), new RegExp(top.split(" / ")[0]), dump);
  assert.equal(/EXTRA|Hot Salsa|Salsa Roja/.test(opts(ench[0])), false, dump);
  const poz = c.filter((l: any) => /pozole/i.test(String(l.itemId)));
  assert.equal(poz.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, dump);
  const gord = c.filter((l: any) => /gordita/i.test(String(l.itemId)));
  assert.equal(gord.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, dump);
  assert.match(opts(gord[0]), /Prensado/);
  assert.equal(/Duro|Pork Rinds/.test(opts(gord[0])), false, dump);
  assert.equal(c.some((l: any) => /tostad/i.test(String(l.itemId))), false, dump);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Álvaro");
});

test("alvaro1: a resumed recording keeps the 10-digit From so the name is saveable", () => {
  const sid = "CA756fa8b75aaf06d5cec92ca700af195b";
  const log = [
    JSON.stringify({ event: "incoming", callSid: sid, caller: "+14402315057" }),
    JSON.stringify({ event: "recording_resumed", callSid: sid }),
  ].join("\n");
  const phone = recordingCallerPhone({ callSid: sid, body: { CallSid: sid, RecordingSid: "RE123" }, memory: "", logText: log });
  assert.equal(phone.replace(/\D/g, "").slice(-10), "4402315057");
  assert.equal(recordingCallerPhone({ callSid: sid, body: { CallSid: sid, _caller: "+14402315057" }, memory: "", logText: "" }).replace(/\D/g, "").slice(-10), "4402315057");
  assert.notEqual(planCallerName(phone, "Álvaro", "elvi").reason, "no-number");
  assert.equal(planCallerName("", "Álvaro", "elvi").reason, "no-number");
  assert.equal(planCallerName("123", "Doritas", "elvi").reason, "no-number");
});
