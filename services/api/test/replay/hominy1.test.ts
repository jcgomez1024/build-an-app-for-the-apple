// hominy1 (CAa025cf, Oct 31 10:21 AM ET) + dayana2 (CAa2bf38, 10:23 AM ET).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { applyMenudoHominy, dropQdRegularTwin, liveHominyQd } = await import("../../src/list-repair.ts");
const { nameFromTranscriptInfo, isNumberName } = await import("../../src/order-name.ts");
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
test("hominy1: 'menudo con maíz de pozole' → menudo + hominy note, no Pozole Rojo", () => {
  const { turns, cart } = fx("CAa025cf-hominy1.json"); applyMenudoHominy(cart, turns);
  assert.deepEqual(cart.map((l: any) => l.itemId), ["sq-menudo-menudo-con-tortillas-4-ZSRUX4"]);
  assert.ok(cart[0].elviNotes.some((n: string) => /maíz de pozole/.test(n)));
});
test("hominy1: a real pozole order stays", () => {
  const cart = [{ itemId: "sq-menudo-x", modifiers: [] }, { itemId: "sq-pozole-rojo-red-pozole-DQ7X4J", modifiers: [] }];
  applyMenudoHominy(cart, [{ speaker: "caller", text: "Un menudo con maíz y un pozole rojo" }]); assert.equal(cart.length, 2);
});
test("dayana2: REGULAR QD twin of the DELUXE bistec pair dropped; QCO + drinks kept", () => {
  const { turns, cart } = fx("CAa2bf38-dayana2.json"); dropQdRegularTwin(cart, turns);
  assert.ok(!cart.some((l: any) => /qd-regular/.test(l.itemId))); assert.equal(cart.length, 4);
  const c2 = [{ itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }, { itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  dropQdRegularTwin(c2, [{ speaker: "caller", text: "dos preparadas y dos normales de bistec" }]); assert.equal(c2.length, 2);
});
test("dayana2: caller's own 'Dayana' beats staff's 'Diana'; Disculpe(me) is junk", () => {
  assert.equal(nameFromTranscriptInfo(fx("CAa2bf38-dayana2.json").turns)?.name, "Dayana");
  for (const n of ["Disculpe", "Discúlpeme", "Disculpeme"]) assert.ok(isNumberName(n), n);
});
test("live: no Pozole add on 'menudo con maíz de pozole'; no REGULAR QD twin", () => {
  const r = liveHominyQd({ actions: [{ type: "add_item", itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4" }, { type: "add_item", itemId: "sq-pozole-rojo-red-pozole-DQ7X4J" }] }, { transcript: "un menudo con maíz de pozole para recoger", cart: [] });
  assert.equal(r.actions.length, 1);
  const r2 = liveHominyQd({ actions: [{ type: "add_item", itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }] },
    { transcript: "Dos.", cart: [{ itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }] });
  assert.equal(r2.actions.length, 0);
});
