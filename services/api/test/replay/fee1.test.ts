import test from "node:test"; import assert from "node:assert/strict";
import { ticketLines, scoreOrder } from "../../src/call-accuracy.ts";
import { ticketFulfillment } from "../../src/delivery.ts";
const li = (name: string, q: number, cents: number, cat = true) => ({ name, ...(cat ? { catalog_object_id: "C-" + name } : { item_type: "CUSTOM_AMOUNT" }), variation_name: "Regular", quantity: String(q), base_price_money: { amount: cents }, total_money: { amount: cents * q }, gross_sales_money: { amount: cents * q }, modifiers: [] });
const NB = () => li("NO BEBIDA / NO DRINK", 1, 0);
test("fee1: catalog Delivery Fee on a PICKUP ticket = delivery; not an item", () => {
  const o = { fulfillments: [{ type: "PICKUP" }], line_items: [li("Taco", 2, 300), { ...li("Delivery Fee", 1, 800), variation_name: "Delivery 2" }] };
  assert.equal(ticketFulfillment(o).fulfillment, "DELIVERY");
  const T = ticketLines(o); const E: any[] = [{ baseName: "Taco", name: "Taco", quantity: 2, choices: [], unitCents: 300, totalCents: 600 }];
  assert.equal(scoreOrder(E, T).score, 100);
});
test("fee1: nameless $8 on a combined ticket is the fee (not a ghost); elsewhere it stays a possible ghost", () => {
  const big = { fulfillments: [{ type: "PICKUP" }], line_items: [li("Taco", 6, 300), NB(), li("Torta", 6, 900), li("", 1, 800, false)] };
  const fee: any = ticketLines(big).find((l: any) => l.totalCents === 800);
  assert.equal(fee.baseName, "Delivery Fee"); assert.ok(!fee.ghost);
  assert.equal(ticketFulfillment(big).fulfillment, "DELIVERY");
  const small = { line_items: [li("Taco", 1, 300), li("", 1, 800, false)] };
  assert.ok((ticketLines(small).find((l: any) => l.totalCents === 800) as any).ghost);
  assert.equal(ticketFulfillment(small).fulfillment, "PICKUP");
});
test("fee1: Delivery service charge = delivery", () => {
  assert.equal(ticketFulfillment({ line_items: [li("Taco", 1, 300)], service_charges: [{ name: "Delivery", amount_money: { amount: 299 } }] }).fulfillment, "DELIVERY");
});
test("fee1: delivery call ~4 PM, tickets rung 4:30–4:55, combined charged ~5:55 → linked once (150-min look-ahead, no double count)", async () => {
  const { linkedTickets, dedupeCombined } = await import("../../src/call-accuracy.ts");
  const ord = (id: string, at: string, items: any[], state = "COMPLETED") => ({ id, created_at: at, state, source: { name: "Point of Sale" }, tenders: [{ id: id.toUpperCase() + "xxxxxxxxxxxxxx" }], total_money: { amount: 1 }, line_items: items });
  const dishes = ["Taco", "Torta", "Nachos"];
  const parts = dishes.map((d, i) => ord(`p${i}`, `2026-01-03T21:${30 + i * 10}:00Z`, [li(d, 2, 300)], "CANCELED"));
  const combined = ord("all", "2026-01-03T22:55:00Z", [...dishes.flatMap((d, i) => [...(i ? [NB()] : []), li(d, 2, 300)]), { ...li("Delivery Fee", 1, 800), variation_name: "Delivery 2" }]);
  const elvi: any[] = dishes.map((d, i) => ({ itemId: d, baseName: d, name: d, quantity: 2, choices: [], totalCents: 600, ...(i ? { person: `p${i}` } : {}) }));
  const call = { at: "2026-01-03T21:00:00Z", recordingSec: 600, turns: [{ speaker: "caller", text: "son tres órdenes, a domicilio por favor" }] };
  const l = linkedTickets(call, elvi, parts[0], [...parts, combined]);
  const kept = dedupeCombined([parts[0], ...l.map((x) => x.order)]);
  assert.deepEqual(kept.map((o: any) => o.id), ["all"]);
  assert.equal(scoreOrder(elvi, kept.flatMap(ticketLines)).score, 100);
});
// fixture shaped like the Saturday clusters (no PII): simulated 4:00 PM ET call, 7 per-person tickets rung 4:39–4:54 and later
// CANCELED, combined ticket (all items, NO BEBIDA separators, "Delivery Fee · Delivery 2" $8) created/charged ~5:55 PM ET.
test("fee1: Saturday cluster fixture — 7 canceled per-person tickets + combined $8-delivery ticket ~2h later", async () => {
  const { linkedTickets, dedupeCombined, plateGroups, groupingScore } = await import("../../src/call-accuracy.ts");
  const { ticketFulfillment } = await import("../../src/delivery.ts");
  const ord = (id: string, at: string, items: any[], state = "COMPLETED") => ({ id, created_at: at, state, source: { name: "Point of Sale" }, tenders: [{ id: id.toUpperCase() + "xxxxxxxxxxxxxx" }], total_money: { amount: 1 }, fulfillments: [{ type: "PICKUP" }], line_items: items });
  const plates = [["Taco", 3], ["Torta", 2], ["Burrito", 1], ["Quesadilla", 2], ["Gordita", 2], ["Nachos", 1], ["Taco", 2]] as Array<[string, number]>;
  const parts = plates.map(([d, q], i) => ord(`s${i}`, `2026-01-03T21:${String(39 + i * 2).padStart(2, "0")}:00Z`, [li(d, q, 300)], "CANCELED"));
  const combined = ord("final", "2026-01-03T22:55:00Z", [...plates.flatMap(([d, q], i) => [...(i ? [NB()] : []), li(d, q, 300)]), { ...li("Delivery Fee", 1, 800), variation_name: "Delivery 2" }]);
  const elvi: any[] = plates.map(([d, q], i) => ({ itemId: d, baseName: d, name: d, quantity: q, choices: [], totalCents: 300 * q, ...(i ? { person: `persona ${i + 1}` } : {}) }));
  const call = { at: "2026-01-03T21:00:00Z", recordingSec: 900, turns: [{ speaker: "caller", text: "van a ser siete órdenes para entrega a domicilio" }] };
  const kept = dedupeCombined([parts[0], ...linkedTickets(call, elvi, parts[0], [...parts, combined]).map((x) => x.order)]);
  assert.deepEqual(kept.map((o: any) => o.id), ["final"]);
  assert.equal(scoreOrder(elvi, kept.flatMap(ticketLines)).score, 100);
  assert.equal(groupingScore(elvi, plateGroups(kept)), 100);
  assert.equal(ticketFulfillment(combined).fulfillment, "DELIVERY");
});
