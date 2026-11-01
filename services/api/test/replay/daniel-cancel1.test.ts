import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isCancelOrderCall, liveCancelOrder } from "../../src/readback-pass.ts";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA175d96-daniel-cancel1.json", import.meta.url), "utf8"));
const T = (...xs: string[]) => xs.map((text) => ({ speaker: "caller", text }));
test("daniel-cancel1: 'cancelar el pedido de Daniel, los dos menudos' → empty cart, not auto-accepted, cancellation", async () => {
  assert.equal(isCancelOrderCall(d.turns), true);
  const r: any = await shadowOrderFromTurns(d.turns, (() => { throw new Error("no model call on a cancellation"); }) as any);
  assert.deepEqual(r.cart, []); assert.equal(r.autoAccepted, false); assert.equal(r.cancelCall, true); assert.equal(r.statusCall, true); assert.equal(r.noOrder, true);
});
test("daniel-cancel1: other cancel phrasings", () => {
  for (const t of ["I need to cancel my order", "quiero cancelar la orden que hice", "cancela mi pedido por favor", "ya no quiero el pedido"]) assert.equal(isCancelOrderCall(T(t)), true, t);
});
test("daniel-cancel1: cancel + new order, or no cancel → not a cancellation", () => {
  assert.equal(isCancelOrderCall(T("cancela el pedido y mejor quiero dos tacos de pastor")), false);
  assert.equal(isCancelOrderCall(T("dos menudos para llevar")), false);
  assert.equal(isCancelOrderCall(T("sin cebolla, cancela la cebolla")), false);
});
test("daniel-cancel1 live: no adds and no 'qué le gustaría ordenar' after a cancel", () => {
  const r = liveCancelOrder({ reply: "No tengo nada en el carrito. ¿Qué le gustaría ordenar?", actions: [{ type: "add_item", itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 2 }] },
    { transcript: "Sí, muchas", history: [{ role: "customer", text: "quisiera cancelar el pedido de Daniel, los dos menudos" }], language: "es" });
  assert.equal(r.actions.length, 0); assert.match(r.reply, /cancelado/);
  const r2 = liveCancelOrder({ reply: "¿Algo más?", actions: [{ type: "add_item", itemId: "x", quantity: 1 }] }, { transcript: "dos menudos", history: [], language: "es" });
  assert.equal(r2.actions.length, 1);
});
