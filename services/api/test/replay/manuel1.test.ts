// manuel1 (CAe49b30, Oct 30 2:02 PM ET, Manuel, Spanish pickup, 87 s): 1377f58 status classifier fired on "Ahí va todo, ¿verdad?"
// → empty cart, ticket stuck "listening". Correct: 1 Orden de Enchiladas, all 6 prensado (no chorizo), + 2 QD REGULAR duro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyEnchiladaOrder, isStatusFollowUpCall } from "../../src/readback-pass.ts";
import { applyEnchiladaConTodo, callerAcceptedConTodo } from "../../src/list-repair.ts";
import { ENCHILADA_CON_TODO, posEnchiladaConTodo } from "../../src/standard-toppings.ts";
import { cachedPosCatalog, compactCatalog, rememberPosCatalog } from "../../src/pos-catalog.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const load = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const turns = load("CAe49b30-turns.json");
const empty = async () => ({ reply: "ok", actions: [] });
const low = (s: string) => s.toLowerCase();
const isTop = (o: string) => ENCHILADA_CON_TODO.some((r) => r.key.test(low(o))) && !/\bsalsa\b/.test(low(o));
const TOP_CAT = compactCatalog([
  { type: "ITEM", id: "ENCH-POS", item_data: { name: "Enchiladas", modifier_list_info: [{ modifier_list_id: "F", enabled: true }], variations: [{ id: "V1", item_variation_data: { name: "Orden de Enchiladas (6)", price_money: { amount: 1499 } } }] } },
  { type: "MODIFIER_LIST", id: "F", modifier_list_data: { name: "(F) Enchiladas Mas Opciones", modifiers: ENCHILADA_CON_TODO.map((r, i) => ({ id: `T${i}`, modifier_data: { name: r.name, price_money: { amount: 0 } } })) } },
]);
test("manuel1: ordering call is never a status call", () => {
  assert.equal(isStatusFollowUpCall(structuredClone(turns)), false);
  assert.equal(isStatusFollowUpCall(load("CA12e9407-turns.json")), true); // Marina stays a status call
  assert.equal(isStatusFollowUpCall([{ speaker: "caller", text: "Quisiera una orden para llevar, ¿ya va pa allá?" }] as any), false);
});
test("manuel1: enchiladas all prensado after chorizo unavailable + 2 QD regular duro", async () => {
  const r: any = await shadowOrderFromTurns(structuredClone(turns), empty as any);
  assert.ok(!r.statusCall);
  const en = r.cart.filter((l: any) => l.itemId === "sq-enchiladas-orden-de-enchiladas-6-6QOYJ5");
  assert.equal(en.length, 1); assert.equal(en[0].quantity, 1);
  const options = en[0].modifiers.map((m: any) => String(m.option));
  // Filling stays all prensado. Staff "con todo" was accepted, so the five free toppings
  // are separate modifiers when the POS catalog has them, and are not invented when it does not.
  assert.deepEqual(options.filter((o: string) => !isTop(o)), ["Prensado / Pork"]);
  const tops = options.filter(isTop);
  if (posEnchiladaConTodo(cachedPosCatalog())) {
    assert.equal(tops.length, ENCHILADA_CON_TODO.length, tops.join(" | "));
    for (const rule of ENCHILADA_CON_TODO) assert.ok(tops.some((o: string) => rule.key.test(low(o))), rule.name);
  } else assert.deepEqual(tops, []);
  assert.equal(options.some((o: string) => /\bsalsa\b/i.test(o)), false);
  assert.deepEqual(en[0].elviNotes, ["enchiladas: 6 prensado"]);
  const qd = r.cart.filter((l: any) => /^sq-qd-/.test(l.itemId));
  assert.equal(qd.length, 1); assert.equal(qd[0].quantity, 2);
  assert.ok(qd[0].modifiers.some((m: any) => /REGULAR/.test(m.option)));
  assert.ok(qd[0].modifiers.some((m: any) => /^Duro/.test(m.option)));
  assert.equal(r.cart.length, 2);
});
test("manuel1: name Manuel", () => { assert.equal(nameFromTranscriptInfo(structuredClone(turns))?.name, "Manuel"); });
test("manuel1: caller accepted the prensado con todo recap; a refused con todo adds no toppings", () => {
  assert.equal(callerAcceptedConTodo(turns), true);
  assert.equal(callerAcceptedConTodo([
    { speaker: "caller", text: "una orden de enchiladas, las seis de prensado" },
    { speaker: "staff", text: "Claro, con todo, ¿verdad?" },
    { speaker: "caller", text: "No." },
  ]), false);
  assert.equal(callerAcceptedConTodo([{ speaker: "caller", text: "Ahí va todo, ¿verdad?" }]), false);
  rememberPosCatalog(TOP_CAT);
  try {
    const yes: any[] = [];
    applyEnchiladaOrder(yes, turns);
    applyEnchiladaConTodo(yes, turns, []);
    const yOpts = yes[0].modifiers.map((m: any) => String(m.option));
    assert.deepEqual(yOpts.filter((o: string) => !isTop(o)), ["Prensado / Pork"]);
    assert.equal(yOpts.filter(isTop).length, ENCHILADA_CON_TODO.length);
    const no: any[] = [];
    const refused = [
      { speaker: "caller", text: "una orden de enchiladas, las seis de prensado" },
      { speaker: "staff", text: "Claro, con todo, ¿verdad?" },
      { speaker: "caller", text: "No." },
    ];
    applyEnchiladaOrder(no, refused as any);
    applyEnchiladaConTodo(no, refused as any, []);
    assert.deepEqual(no[0].modifiers.map((m: any) => m.option), ["Prensado / Pork"]);
  } finally { rememberPosCatalog(null); }
});
