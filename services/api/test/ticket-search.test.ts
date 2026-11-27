// search1: the calls page always has a Square ticket to compare to. Synthetic orders only (no customer data).
import test from "node:test";
import assert from "node:assert/strict";
import { nameSimilarity, searchTicket, searchTickets, dishWords } from "../src/ticket-search.ts";

const T0 = Date.parse("2026-11-25T18:48:00Z"); // 1:48 PM ET
const iso = (min: number) => new Date(T0 + min * 60000).toISOString();
const li = (name: string, variation: string, mods: string[] = [], qty = 1, cents = 500) => ({ name, variation_name: variation, quantity: String(qty), modifiers: mods.map((m) => ({ name: m })), gross_sales_money: { amount: cents * qty }, catalog_object_id: name + variation });
const order = (id: string, min: number, ticket: string | null, items: any[], extra: any = {}) => ({ id, created_at: iso(min), state: "COMPLETED", source: { name: "Point of Sale" }, ticket_name: ticket, line_items: items, total_money: { amount: 1000 }, fulfillments: [], ...extra });
const qd = (meat: string, qty = 1) => li("(QD) Quesadilla Dorada", "(QD) DELUXE Preparada", [meat], qty);
const elviQD = (meat: string, qty = 1) => ({ baseName: "(QD) Quesadilla Dorada", name: "(QD) Quesadilla Dorada · (QD) DELUXE Preparada", quantity: qty, choices: ["(QD) DELUXE Preparada", meat], unitCents: 500, totalCents: 500 * qty });
const call = (x: any = {}) => ({ callSid: "CA1", at: iso(0), caller: "+14405550101", talkSec: 77, recordingSec: 77, ...x });

test("names: typos and spelling variants match, different names don't", () => {
  for (const [a, b] of [["Fernado", "Fernando"], ["Cristal", "Crystal"], ["Zuleika", "Zuleita"], ["José", "Jose"], ["Cheyenne", "Cheyen"]]) assert.ok(nameSimilarity(a, b) >= 0.75, `${a}~${b}`);
  for (const [a, b] of [["Vera", "Mesa"], ["Seis", "Kevin"], ["Ana", "Alex"]]) assert.equal(nameSimilarity(a, b), 0, `${a}!~${b}`);
});

test("late ring (+40 min, outside the old 10-min window) with a name typo is found", () => {
  const orders = [order("walkin", 3, "Mesa 2", [qd("Bistec / Steak")]), order("late", 40, "Fernado", [qd("Cabeza / Beef Head", 1), qd("Tripa / Beef Tripe", 1), qd("Bistec / Steak", 1)])];
  const r = searchTicket(call({ names: ["Fernando"] }), [elviQD("Cabeza / Beef Head"), elviQD("Tripa / Beef Tripe"), elviQD("Bistec / Steak")], orders);
  assert.equal(r.best?.orderId, "late");
  assert.equal(r.status, "found");
  assert.ok(r.best!.signals.some((s) => s.kind === "name"));
});

test("phone on the ticket wins over a closer walk-in", () => {
  const orders = [order("near", 2, "Luis", [qd("Bistec / Steak")]), order("mine", 30, null, [qd("Pastor")], { fulfillments: [{ type: "PICKUP", pickup_details: { recipient: { phone_number: "(440) 555-0101" } } }] })];
  assert.equal(searchTicket(call(), [elviQD("Bistec / Steak")], orders).best?.orderId, "mine");
});

test("the name said aloud counts even when Elvi's heard name is junk", () => {
  const orders = [order("a", 5, "Sandra paola", [li("Menudo", "Menudo 32oz con Tortillas", [], 2)]), order("b", 6, "Miriam", [li("Menudo", "CON PATA Menudo 32oz y Tortillas", [], 2)])];
  const r = searchTicket(call({ names: ["Es"], callerText: "quería dos menudos. De Sandra Paola." }), [{ baseName: "Menudo", name: "Menudo · Menudo 32oz con Tortillas", quantity: 2, choices: [], unitCents: 1500, totalCents: 3000 }], orders);
  assert.equal(r.best?.orderId, "a");
});

test("never empty: nothing fits → closest tickets + why; nothing in window → says so", () => {
  const r = searchTicket(call({ names: ["Brian"] }), [elviQD("Pastor")], [order("x", 20, "Elvira", [li("Menudo", "Menudo 32oz", [])])]);
  assert.equal(r.best, null); assert.equal(r.runnerUps.length, 1); assert.match(r.reason, /más cercanos/);
  const n = searchTicket(call(), [elviQD("Pastor")], [order("old", -60, "Ana", [qd("Pastor")]), order("late", 200, "Ana", [qd("Pastor")])]);
  assert.equal(n.status, "none"); assert.equal(n.runnerUps.length, 0); assert.match(n.reason, /No hay tickets/);
});

test("online and empty orders are never candidates; table tickets are not names", () => {
  const orders = [order("online", 5, "Ana", [qd("Pastor")], { source: { name: "Square Online" } }), order("empty", 6, "Ana", [], { total_money: { amount: 0 } }), order("mesa", 4, "Mesa Ana", [qd("Pastor")])];
  const r = searchTicket(call({ names: ["Ana"] }), [elviQD("Pastor")], orders);
  assert.ok(!r.best || r.best.orderId === "mesa"); assert.ok(!(r.best?.signals || []).some((s) => s.kind === "name"));
});

test("a ticket that is another call's direct ticket, or two calls' best hit, is flagged", () => {
  const orders = [order("shared", 8, "Daniel", [li("Menudo", "Menudo 32oz con Tortillas", [], 2)])];
  const menudo = [{ baseName: "Menudo", name: "Menudo · Menudo 32oz con Tortillas", quantity: 2, choices: [], unitCents: 1500, totalCents: 3000 }];
  const out = searchTickets([{ call: call({ callSid: "CA1", names: ["Daniel"] }), elvi: menudo }, { call: call({ callSid: "CA2", at: iso(3), names: ["Daniel"] }), elvi: menudo }], orders, new Map());
  assert.deepEqual(out.get("CA1")!.best!.usedBy, ["CA2"]); assert.equal(out.get("CA1")!.status, "weak");
  const d = searchTickets([{ call: call({ names: ["Daniel"] }), elvi: menudo }], orders, new Map([["shared", "CA9"]]));
  assert.deepEqual(d.get("CA1")!.best!.usedBy, ["CA9"]); assert.ok(d.get("CA1")!.best!.confidence <= 55);
});

test("live square_ticket link: strong when by name/phone, weak when time-only", () => {
  const orders = [order("a", 12, "Chuy", [li("Menudo", "Menudo 32oz", [], 3)]), order("b", 4, "Luis", [li("Torta", "(TO) Torta", [])])];
  const menudo = [{ baseName: "Menudo", name: "Menudo · Menudo 32oz", quantity: 3, choices: [], unitCents: 1500, totalCents: 4500 }];
  assert.equal(searchTicket(call({ names: ["México"], liveLinkOrderId: "a", liveLinkBy: "ticket name" }), menudo, orders).best?.orderId, "a");
  const weak = searchTicket(call({ liveLinkOrderId: "b", liveLinkBy: "only ticket in 20 min" }), [], orders);
  assert.ok((weak.best?.confidence ?? 0) < 60);
});

test("readback dish words", () => { assert.deepEqual([...dishWords("dos quesitartas de vite y tres tacos de tripa")].sort(), ["bistec", "quesadilla", "taco", "tripa"]); });
