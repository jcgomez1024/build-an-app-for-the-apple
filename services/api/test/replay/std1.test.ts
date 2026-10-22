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
test("std2: a $0 protein rung but never said still flags; a single-option-group default doesn't", async () => {
  const { setStdMenu } = await import("../../src/call-accuracy.js");
  const o = { line_items: [{ name: "Torta", catalog_object_id: "V2", quantity: "1", gross_sales_money: { amount: 900 },
    modifiers: [{ name: "Pollo / Chicken", total_price_money: { amount: 0 } }, { name: "Pan Telera", total_price_money: { amount: 0 } }] }] };
  setStdMenu([{ squareVariationId: "V2", modifierGroups: [{ options: [{ name: "Pollo / Chicken" }, { name: "Bistec / Steak" }] }, { options: [{ name: "Pan Telera" }] }] }]);
  const t = ticketLines(o)[0]; const e = { name: "Torta", quantity: 1, choices: [], unitCents: 900, totalCents: 900 };
  const f = auditCall({ recordingSid: "RE2", at: new Date(0).toISOString(), recordingSec: 60, turns: [{ speaker: "caller", text: "una torta por favor" }], elvi: [e], ticket: { lines: [t] }, pairs: [{ ticket: t, elvi: e }] })!
    .flags.filter((x) => x.type === "STAFF_EXTRA").map((x) => x.detail).join("|");
  setStdMenu([]);
  assert.ok(/Pollo/.test(f), f); assert.ok(!/Telera/.test(f), f);
});
test("std3: counted tortilla label checks the type: wrong type flags, no type said is fine, '2 QUESO' stays standard", () => {
  const o = { line_items: [{ name: "Chiles Rellenos Platillo", catalog_object_id: "V3", quantity: "1", gross_sales_money: { amount: 1500 },
    modifiers: [{ name: "2 QUESO", total_price_money: { amount: 0 } }, { name: "3 x (Flour) Harina Tortilla", total_price_money: { amount: 0 } }] }] };
  const run = (text: string) => { const t = ticketLines(o)[0]; const e = { name: "Chiles Rellenos Platillo", quantity: 1, choices: [], unitCents: 1500, totalCents: 1500 };
    return auditCall({ recordingSid: "RE3", at: new Date(0).toISOString(), recordingSec: 60, turns: [{ speaker: "caller", text }], elvi: [e], ticket: { lines: [t] }, pairs: [{ ticket: t, elvi: e }] })!
      .flags.filter((x) => x.type === "STAFF_EXTRA").map((x) => x.detail).join("|"); };
  assert.ok(/Harina/.test(run("un platillo de chiles rellenos con tortillas de maíz")));
  assert.ok(/Harina/.test(run("chiles rellenos platter, corn tortillas")));
  const none = run("un platillo de chiles rellenos"); assert.ok(!/Harina|QUESO/.test(none), none);
  const flour = run("chiles rellenos with flour tortillas"); assert.ok(!/STAFF/.test(flour) && !/Harina/.test(flour), flour);
});
