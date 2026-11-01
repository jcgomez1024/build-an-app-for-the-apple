import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isExistingOrderCall, liveExistingOrder } from "../../src/readback-pass.ts";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAb6491f-juan-followup1.json", import.meta.url), "utf8"));
test("juan-followup1: 'he cargado un menudo, pero no me preguntaron mi dirección' = existing-order call, empty cart", async () => {
  assert.equal(isExistingOrderCall(d.turns), true);
  const r: any = await shadowOrderFromTurns(d.turns, (async () => ({ reply: "¿Algo más?", actions: [] })) as any);
  assert.equal(r.cart.length, 0); assert.equal(r.autoAccepted, false); assert.equal(r.existingOrderCall, true);
});
test("juan-followup1 rule: a real new order is not an existing-order call", () => {
  assert.equal(isExistingOrderCall([{ speaker: "caller", text: "me puede poner un menudo" }, { speaker: "caller", text: "Juan" }] as any), false);
  assert.equal(isExistingOrderCall([{ speaker: "caller", text: "ya pedí hace rato" }, { speaker: "caller", text: "y quiero hacer otro pedido, dos tacos" }] as any), false);
  assert.equal(isExistingOrderCall([{ speaker: "caller", text: "Hola, ¿mi pedido ya está?" }] as any), true);
});
test("juan-followup1 live: complaint never gets '¿Algo más?' or an add", () => {
  const r = liveExistingOrder({ reply: "¿Algo más?", actions: [{ type: "add_item", itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 1 }] },
    { transcript: "pero no me preguntaron mi dirección", history: [{ role: "customer", text: "Oiga, disculpe, es que ahorita he cargado un menudo," }], cart: [], language: "es" });
  assert.equal(r.actions.length, 0); assert.doesNotMatch(r.reply, /Algo más/);
});
