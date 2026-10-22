import test from "node:test"; import assert from "node:assert/strict";
import { linkedTickets, mentionsOtherOrders } from "../../src/call-accuracy.ts";
import { personSwitch } from "../../src/call-scoring.ts";
import { PHONE_OK } from "../../src/customer-guard.ts";
// synthetic Square-shaped orders (no real data)
const ord = (id: string, rc: string, at: string, lines: Array<[string, number]>) => ({ id, created_at: at, state: "COMPLETED", source: { name: "Point of Sale" }, tenders: [{ id: rc + "xxxxxxxxxxxxxxxx" }], total_money: { amount: 1000 },
  line_items: lines.map(([name, q]) => ({ name, quantity: String(q), base_price_money: { amount: 300 }, total_money: { amount: 300 * q }, modifiers: [] })) });
const L = (name: string, q: number) => ({ itemId: name, name, baseName: name, quantity: q, choices: [], totalCents: 300 * q } as any);
test("person switches", () => {
  assert.equal(personSwitch("y para Juana dos tacos de pastor"), "Juana");
  assert.equal(personSwitch("en la de ella una quesadilla"), "ella");
  assert.equal(personSwitch("y en mi orden un burrito"), "me");
  assert.equal(personSwitch("tres tacos de asada"), null);
  assert.equal(personSwitch("para llevar"), null);
});
test("multi-order cues", () => {
  assert.ok(mentionsOtherOrders([{ speaker: "caller", text: "van a ser dos órdenes" }]));
  assert.ok(mentionsOtherOrders([{ speaker: "caller", text: "y para Juana una torta" }]));
  assert.ok(!mentionsOtherOrders([{ speaker: "caller", text: "tres tacos para llevar" }]));
});
const call = { at: "2026-01-05T18:00:00Z", recordingSec: 120, turns: [{ speaker: "caller", text: "son dos órdenes, y para Juana dos quesadillas" }] };
const elvi = [L("Street Taco", 3), L("Quesadilla Dorada", 2)];
const prim = ord("o1", "AAAA", "2026-01-05T18:03:00Z", [["Street Taco", 3]]);
const second = ord("o2", "BBBB", "2026-01-05T18:20:00Z", [["Quesadilla Dorada", 2]]);
const far = ord("o3", "CCCC", "2026-01-05T20:00:00Z", [["Quesadilla Dorada", 2]]);
const unrelated = ord("o4", "DDDD", "2026-01-05T18:10:00Z", [["Burrito", 1]]);
test("auto-links the other person's ticket within ±45 min", () => {
  const r = linkedTickets(call, elvi, prim, [prim, second, far, unrelated]);
  assert.deepEqual(r.map((x) => x.order.id), ["o2"]); assert.match(r[0].by, /auto/);
});
test("no auto link without cue, outside window, or when used by another call", () => {
  assert.equal(linkedTickets({ ...call, turns: [{ speaker: "caller", text: "tres tacos" }] }, elvi, prim, [prim, second]).length, 0);
  assert.equal(linkedTickets(call, elvi, prim, [prim, far]).length, 0);
  assert.equal(linkedTickets(call, elvi, prim, [prim, second], { usedElsewhere: new Set(["o2"]) }).length, 0);
});
test("manual link by receipt # works even without cue/window", () => {
  const r = linkedTickets({ ...call, turns: [] }, elvi, prim, [prim, far], { manual: ["CCCC"] });
  assert.deepEqual(r.map((x) => [x.order.id, x.by]), [["o3", "manual"]]);
});
test("link-ticket endpoint is phone-PIN only", () => {
  assert.ok(PHONE_OK.test("/api/calls/CA" + "0".repeat(32) + "/link-ticket"));
});
