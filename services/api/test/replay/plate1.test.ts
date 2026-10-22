import test from "node:test"; import assert from "node:assert/strict";
import { ticketLines, plateGroups, groupingScore, linkedTickets, scoreOrder } from "../../src/call-accuracy.ts";
import { personSwitch } from "../../src/call-scoring.ts";
const li = (name: string, q: number, cents = 300) => ({ name, catalog_object_id: "C-" + name, variation_name: "Regular", quantity: String(q), base_price_money: { amount: cents }, total_money: { amount: cents * q }, gross_sales_money: { amount: cents * q }, modifiers: [] });
const NB = () => ({ name: "NO BEBIDA / NO DRINK", catalog_object_id: "C-NB", variation_name: "Regular", quantity: "1", base_price_money: { amount: 0 }, total_money: { amount: 0 }, modifiers: [] });
const ord = (id: string, at: string, items: any[]) => ({ id, created_at: at, state: "COMPLETED", source: { name: "Point of Sale" }, tenders: [{ id: id.toUpperCase() + "xxxxxxxxxxxxxxx" }], total_money: { amount: 1 }, line_items: items });
const E = (name: string, q: number, person?: string) => ({ itemId: name, name, baseName: name, quantity: q, choices: [], totalCents: 300 * q, ...(person ? { person } : {}) } as any);
test("NO BEBIDA is a plate separator, not an item", () => {
  const ls: any[] = ticketLines(ord("a", "2026-01-01T00:00:00Z", [li("Taco", 2), NB(), li("Torta", 3)]));
  assert.deepEqual(ls.map((l) => [l.baseName, l.plate]), [["Taco", 0], ["Torta", 1]]);
  assert.equal(plateGroups([ord("a", "x", [li("Taco", 2), NB(), li("Torta", 3)])]).length, 2);
});
const elviGrouped = [E("Taco", 2), E("Torta", 3, "Ana"), E("Nachos", 1, "plato 2")];
const one = ord("one", "2026-01-05T18:01:00Z", [li("Taco", 2), NB(), li("Torta", 3), NB(), li("Nachos", 1)]);
const three = [ord("t1", "2026-01-05T18:01:00Z", [li("Taco", 2)]), ord("t2", "2026-01-05T18:10:00Z", [li("Torta", 3)]), ord("t3", "2026-01-05T18:25:00Z", [li("Nachos", 1)])];
test("both styles score the same: one ticket with NO BEBIDA vs three tickets", () => {
  const a = groupingScore(elviGrouped, plateGroups([one])), b = groupingScore(elviGrouped, plateGroups(three));
  assert.equal(a, 100); assert.equal(b, 100);
  assert.equal(scoreOrder(elviGrouped, ticketLines(one)).score, scoreOrder(elviGrouped, three.flatMap(ticketLines)).score);
  assert.equal(groupingScore(elviGrouped.map(({ person, ...l }: any) => l), plateGroups(three)), 0); // no groups → 0
  assert.equal(groupingScore(elviGrouped, plateGroups([three[0]])), null); // single plate → no grouping metric
});
test("auto-links 2 more tickets (3 per call) and manual links any number", () => {
  const call = { at: "2026-01-05T18:00:00Z", recordingSec: 180, turns: [{ speaker: "caller", text: "son tres órdenes; para Ana una torta y la otra orden nachos" }] };
  const far = ord("t9", "2026-01-05T21:00:00Z", [li("Torta", 3)]);
  assert.deepEqual(linkedTickets(call, elviGrouped, three[0], [...three, far]).map((x) => x.order.id).sort(), ["t2", "t3"]);
  assert.deepEqual(linkedTickets({ ...call, turns: [] }, elviGrouped, null, [...three, far], { manual: ["T1XX", "t2", "T3XXxxxxxxxxxxxxxx".slice(0, 4)] }).map((x) => x.order.id), ["t1", "t2", "t3"]);
});
test("plate cues", () => {
  for (const s of ["en otro plato dos tacos", "la otra orden es de nachos", "en un plato aparte", "pónmelos en platos separados"]) assert.equal(personSwitch(s), "+", s);
  for (const s of ["la salsa por separado", "y aparte unos nachos", "tres tacos"]) assert.notEqual(personSwitch(s), "+", s);
});
// combine1: 7 per-person tickets rung over ~15 min (later canceled) + one combined charged ticket ~40 min later
test("7-person call: separate tickets or one combined ticket, never double-counted", async () => {
  const { dedupeCombined } = await import("../../src/call-accuracy.ts");
  const dishes = ["Taco", "Torta", "Nachos", "Burrito", "Gordita", "Quesadilla", "Esquite"];
  const people = dishes.map((d, i) => ord(`p${i}`, `2026-01-03T22:${String(30 + i * 2).padStart(2, "0")}:00Z`, [li(d, i % 2 + 1)]));
  for (const o of people) (o as any).state = "CANCELED";
  const combined = ord("all", "2026-01-03T23:30:00Z", dishes.flatMap((d, i) => [...(i ? [NB()] : []), li(d, i % 2 + 1)]));
  const elvi = dishes.map((d, i) => E(d, i % 2 + 1, i ? `p${i}` : undefined));
  const call = { at: "2026-01-03T22:28:00Z", recordingSec: 900, turns: [{ speaker: "caller", text: "van a ser siete órdenes, una para Ana, otra orden para Luis…" }] };
  // (b) separate tickets only
  const sep = linkedTickets(call, elvi, people[0], people);
  assert.equal(sep.length, 6);
  const sepLines = [people[0], ...sep.map((x) => x.order)].flatMap(ticketLines);
  assert.equal(scoreOrder(elvi, sepLines).score, 100);
  assert.equal(groupingScore(elvi, plateGroups([people[0], ...sep.map((x) => x.order)])), 100);
  // (a) originals + combined exist → combined wins, originals dropped, same scores
  const all = linkedTickets(call, elvi, people[0], [...people, combined]);
  const kept = dedupeCombined([people[0], ...all.map((x) => x.order)]);
  assert.deepEqual(kept.map((o: any) => o.id), ["all"]);
  assert.equal(scoreOrder(elvi, kept.flatMap(ticketLines)).score, 100);
  assert.equal(groupingScore(elvi, plateGroups(kept)), 100);
});
