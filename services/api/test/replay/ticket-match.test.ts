// match1: walk-in tickets never match a call. Synthetic orders/calls only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { assignTickets, candidateTickets } from "../../src/call-accuracy.ts";
import { recordFinding, retireFindings, pendingFindings } from "../../src/auditor.ts";

const T0 = Date.parse("2026-01-05T17:00:00Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const order = (id: string, min: number, item: string, extra: any = {}) => ({ id, created_at: iso(min), source: { name: "Point of Sale" }, line_items: [{ name: item, quantity: "1", catalog_object_id: `V-${id}`, variation_name: "Regular", base_price_money: { amount: 1500 }, total_money: { amount: 1500 } }], ...extra });
const call = (sid: string, min: number, sec: number, extra: any = {}) => ({ callSid: sid, at: iso(min), caller: "+12165550100", recordingSid: `RE${sid}`, recordingSec: sec, ...extra });
const sope = [{ name: "Sopesaso Elvis", baseName: "Sopesaso Elvis", quantity: 1, choices: [], totalCents: 1500 }];

test("match1: no order content → no ticket (a); walk-in before the call start never matches (b)", () => {
  assert.deepEqual(candidateTickets(call("A", 12, 4) as any, [], [order("w", 12.5, "Sopesaso Elvis")]), []);
  assert.deepEqual(candidateTickets(call("B", 12, 30) as any, sope as any, [order("w", 11.9, "Sopesaso Elvis")]), []);
  assert.deepEqual(candidateTickets(call("B", 12, 30) as any, sope as any, [order("late", 12 + 0.5 + 10.5, "Sopesaso Elvis")]), []); // >10 min after end
  assert.equal(candidateTickets(call("B", 12, 30) as any, sope as any, [order("ok", 13, "Sopesaso Elvis")]).length, 1);
});

test("match1: needs ≥50% item overlap or phone/name on the order (c); phone-tagged preferred", () => {
  assert.deepEqual(candidateTickets(call("C", 0, 30) as any, sope as any, [order("x", 1, "Torta")]), []);
  const byName = candidateTickets(call("C", 0, 30, { customerName: "Kilo" }) as any, sope as any, [order("n", 1, "Torta", { ticket_name: "Kilo" })]);
  assert.equal(byName.length, 1); assert.match(byName[0].by, /name/);
  const m = assignTickets([{ call: call("C", 0, 30) as any, elvi: sope as any }], [order("pos", 1, "Sopesaso Elvis"), order("api", 2, "Sopesaso Elvis", { source: { name: "Cocina Elvis Voice" } })]);
  assert.equal(m.get("C")!.order.id, "api");
});

test("match1: one ticket ↔ one call (d); nothing qualifies → no ticket (e)", () => {
  const m = assignTickets([{ call: call("D1", 0, 60) as any, elvi: sope as any }, { call: call("D2", 0.5, 60) as any, elvi: sope as any }], [order("only", 1.5, "Sopesaso Elvis")]);
  assert.equal([...m.values()].length, 1);
  assert.equal(assignTickets([{ call: call("E", 0, 30) as any, elvi: sope as any }], [order("walkin", -3, "Sopesaso Elvis")]).size, 0);
});

test("match1: a finding from a wrong match is retired", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "match1-")), "findings.jsonl");
  recordFinding({ callSid: "CAx1", at: iso(0), score: 0, ticket: { lines: [] } }, [{ type: "CUSTOM_AMOUNT", detail: "x", es: "x", en: "x" }] as any, file);
  assert.equal(pendingFindings(file).length, 1);
  assert.equal(retireFindings("CAx1", "no order on call", file), 1);
  assert.equal(pendingFindings(file).length, 0);
});
