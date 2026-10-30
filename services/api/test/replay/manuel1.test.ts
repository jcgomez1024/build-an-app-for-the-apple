// manuel1 (CAe49b30, Oct 30 2:02 PM ET, Manuel, Spanish pickup, 87 s): 1377f58 status classifier fired on "Ahí va todo, ¿verdad?"
// → empty cart, ticket stuck "listening". Correct: 1 Orden de Enchiladas, all 6 prensado (no chorizo), + 2 QD REGULAR duro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { isStatusFollowUpCall } from "../../src/readback-pass.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const load = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const turns = load("CAe49b30-turns.json");
const empty = async () => ({ reply: "ok", actions: [] });
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
  assert.deepEqual(en[0].modifiers.map((m: any) => m.option), ["Prensado / Pork"]);
  assert.deepEqual(en[0].elviNotes, ["enchiladas: 6 prensado"]);
  const qd = r.cart.filter((l: any) => /^sq-qd-/.test(l.itemId));
  assert.equal(qd.length, 1); assert.equal(qd[0].quantity, 2);
  assert.ok(qd[0].modifiers.some((m: any) => /REGULAR/.test(m.option)));
  assert.ok(qd[0].modifiers.some((m: any) => /^Duro/.test(m.option)));
  assert.equal(r.cart.length, 2);
});
test("manuel1: name Manuel", () => { assert.equal(nameFromTranscriptInfo(structuredClone(turns))?.name, "Manuel"); });
