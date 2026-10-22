import test from "node:test"; import assert from "node:assert/strict";
import { auditCall } from "../../src/auditor.js"; import { ticketLines } from "../../src/call-accuracy.js";
const order = { line_items: [{ name: "Chiles Rellenos Platillo", catalog_object_id: "V1", quantity: "1", gross_sales_money: { amount: 1500 },
  modifiers: [{ name: "2 QUESO", total_price_money: { amount: 0 } }, { name: "Extra Crema", total_price_money: { amount: 100 } }] }] };
const row = (elviChoices: string[]) => { const t = ticketLines(order)[0]; const e = { name: "Chiles Rellenos Platillo", quantity: 1, choices: elviChoices, unitCents: 1500, totalCents: 1500 };
  return { recordingSid: "RE1", at: new Date(0).toISOString(), recordingSec: 60, turns: [{ speaker: "caller", text: "quiero un platillo de chiles rellenos" }], elvi: [e], ticket: { lines: [t] }, pairs: [{ ticket: t, elvi: e }] }; };
test("std1: $0 standard modifier ('2 QUESO') is not an extra charge; paid one still is", () => {
  const f = auditCall(row([]))!.flags.filter((x) => x.type === "STAFF_EXTRA").map((x) => x.detail).join("|");
  assert.ok(!/QUESO/.test(f), f); assert.ok(/Extra Crema/.test(f), f);
});
test("std1: '2 QUESO' matches Elvi's 'QUESO / CHEESE' (no miss either way)", () => {
  const f = auditCall(row(["QUESO / CHEESE"]))!.flags.map((x) => x.detail).join("|");
  assert.ok(!/QUESO/i.test(f), f);
});
