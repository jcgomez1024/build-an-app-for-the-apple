// carolina2 (CA87e60a1, Fri Nov 6 2026 ~12:39 PM ET, Carolina, Spanish pickup).
// "tres tacos al vapor de papa" was rung as 3 órdenes. After staff says each orden has five,
// "una orden, nada más" / staff "una orden de tacos al vapor" is 1 orden de papa.
// Not carolina1 (a different call). Not a SID special case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyVaporOrders, vaporOrderCount, VAPOR_ID } from "../../src/readback-pass.ts";
import { preTurn } from "../../src/pre-turn.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA87e60a1-carolina2.json", import.meta.url), "utf8")).turns;
const PAPA = { step: "(A) Tacos al Vapor Carne Options (ONLINE)", option: "Papas / Potatoes" };
const miss = async (t: string) => /tres tacos al vapor/i.test(t)
  ? { reply: "Tres órdenes de tacos al vapor de papa.", actions: [{ type: "add_item", itemId: VAPOR_ID, quantity: 3, modifiers: [PAPA] }] }
  : { reply: /una orden/i.test(t) ? "¿Una orden de qué? Por ejemplo enchiladas, tacos dorados o tacos al vapor." : "¿Algo más?", actions: [] };

test("carolina2: piece count is not the sellable orden; una orden / staff readback is 1", () => {
  assert.equal(vaporOrderCount(turns), 1);
  assert.equal(vaporOrderCount([{ speaker: "caller", text: "dos órdenes de tacos al vapor. En una orden me pone uno de papa." }] as any), 2);
  const bare = preTurn("k", "Una orden", [], "es", { history: [{ role: "customer", text: "tres tacos al vapor de papa" }], cart: [{ itemId: VAPOR_ID, quantity: 3, modifiers: [PAPA] }] });
  assert.match(bare.reply || "", /una orden de tacos al vapor/i);
  assert.equal(bare.updates?.[0]?.quantity, 1);
  assert.equal(preTurn("k2", "Una orden", [], "es").reply, "¿Una orden de qué? Por ejemplo enchiladas, tacos dorados o tacos al vapor.");
});

test("carolina2: 1 orden de tacos al vapor de papa, Carolina", async () => {
  const r: any = await shadowOrderFromTurns(turns, miss as any);
  const v = r.cart.filter((l: any) => l.itemId === VAPOR_ID);
  const dump = JSON.stringify(r.cart.map((l: any) => ({ id: l.itemId, q: l.quantity, m: (l.modifiers || []).map((m: any) => m.option) })));
  assert.equal(v.length, 1, dump);
  assert.equal(v[0].quantity, 1, dump);
  assert.match((v[0].modifiers || []).map((m: any) => m.option).join(" | "), /Papas/, dump);
  assert.equal(r.cart.filter((l: any) => /^sq-taco-/.test(String(l.itemId))).length, 0, dump);
  assert.equal(nameFromTranscriptInfo(turns)?.name, "Carolina");
});

test("carolina2: staff readback alone rewrites 3 órdenes to 1 de papa", () => {
  const c: any[] = [{ itemId: VAPOR_ID, quantity: 3, modifiers: [PAPA] }];
  applyVaporOrders(c, [
    { speaker: "caller", text: "tres tacos al vapor de papa" },
    { speaker: "staff", text: "Carolina, entonces tengo una orden de tacos al vapor." },
  ] as any);
  assert.equal(c.length, 1);
  assert.equal(c[0].quantity, 1);
  assert.match(c[0].modifiers[0].option, /Papas/);
});
