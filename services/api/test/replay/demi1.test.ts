// demi1 (CAc17d837, Nov 6 ~3:33 PM ET): not an order. "Hi, this is Demi with the, Dollar General stores."
// then "looking to speak with the restaurant in charge." Live miss: Pozole Rojo add + customerName "Demi With", auto-accepted.
// "with the …" is an affiliation, not a surname, and a person-in-charge request is not food.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { isPersonInChargeCall, isAffiliationIntro, nonOrderCallerTurn } from "../../src/readback-pass.ts";
import { noPhantomDish } from "../../src/elvi.ts";
import { heardName } from "../../src/name-accuracy.ts";
import { callerIdentityName } from "../../src/order-name.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CAc17d837-demi1.json", import.meta.url), "utf8"));
const POZOLE = "sq-pozole-rojo-red-pozole-DQ7X4J";
const menu = [{ id: POZOLE, name: "Pozole Rojo / Red Pozole", nameEs: "Pozole Rojo", aliases: ["pozole", "posole", "pozole rojo", "red pozole", "Rojo de Puerco / Red with Pork"], priceCents: 1499 }];
const miss = async (t: string) => /this is Demi/i.test(t)
  ? { reply: "Pozole Rojo. $14.99. Anything else?", actions: [{ type: "add_item", itemId: POZOLE, quantity: 1, modifiers: [] }, { type: "set_customer", name: "Demi With" }] }
  : { reply: "I'm just the order taker.", actions: [] };
miss.menu = () => menu;

test("demi1: affiliation intro and a person-in-charge ask are not a dish or a surname", () => {
  const intro = d.turns[1].text;
  assert.equal(isAffiliationIntro(intro), true);
  assert.equal(nonOrderCallerTurn(intro), true);
  assert.equal(isPersonInChargeCall(d.turns), true);
  assert.equal(heardName(d.turns), null);
  assert.equal(callerIdentityName(d.turns), null);
  assert.equal(heardName([{ speaker: "caller", text: "Hi, this is Zander, I want two tacos" }]), "Zander");
  const r = noPhantomDish(
    { reply: "Pozole Rojo. $14.99. Anything else?", actions: [{ type: "add_item", itemId: POZOLE, quantity: 1, modifiers: [] }] },
    { transcript: intro, language: "en", menu, history: [{ role: "assistant", text: "cocina Elvis, buenas tardes." }] },
  );
  assert.equal(r.actions.length, 0);
});

test("demi1: replay of the live miss is an empty cart, not auto-accepted, name is not Demi With", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, miss as any);
  assert.deepEqual(r.cart, []);
  assert.equal(r.autoAccepted, false);
  assert.equal(r.noOrder, true);
  assert.notEqual(r.customerName, "Demi With");
  assert.equal(heardName(d.turns), null);
});
