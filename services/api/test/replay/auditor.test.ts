// auditor1: POS naming/pricing from the Square catalog + Elvi Auditor flags. Synthetic data only (no personal data).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { compactCatalog, toPosLine } from "../../src/pos-catalog.ts";
import { auditCall, recordFinding, pendingFindings, ackFindings, keywords } from "../../src/auditor.ts";

const V = (id: string, name: string, amount: number) => ({ id, item_variation_data: { name, price_money: { amount } } });
const cat = compactCatalog([
  { type: "ITEM", id: "QD", item_data: { name: "(QD) Quesadilla Dorada", modifier_list_info: [{ modifier_list_id: "MEAT" }], variations: [V("QDR", "(QD) REGULAR Dorada", 575), V("QDD", "(QD) DELUXE Preparada", 625)] } },
  { type: "ITEM", id: "QDO", item_data: { name: "(QD) Quesadilla Dorada (ONLINE)", modifier_list_info: [{ modifier_list_id: "MEAT" }], variations: [V("QDOR", "(QD) REGULAR Dorada", 550)] } },
  { type: "ITEM", id: "Q", item_data: { name: "Quesadilla", modifier_list_info: [{ modifier_list_id: "MEAT" }], variations: [V("QCO", "(QCO) Quesadilla de Comal / Homemade", 450), V("QST", "(QST) Quesadilla Taquera / Street Quesadilla", 350)] } },
  { type: "ITEM", id: "QO", item_data: { name: "Quesadilla (ONLINE)", modifier_list_info: [{ modifier_list_id: "MEAT" }], variations: [V("QOR", "Regular", 350)] } },
  { type: "MODIFIER_LIST", id: "MEAT", modifier_list_data: { name: "(B) Q Carnes / Meats", modifiers: [{ id: "B", modifier_data: { name: "Bistec / Steak", price_money: { amount: 0 } } }, { id: "P", modifier_data: { name: "Prensado / Spicy Pork", price_money: { amount: 50 } } }, { id: "L", modifier_data: { name: "Lengua / Beef Tongue", price_money: { amount: 50 } } }] } },
]);
const line = (variationId: string, choices: string[], quantity = 2) => ({ variationId, baseName: "x", name: "x", quantity, choices, unitCents: 0, totalCents: 0 });

test("auditor1 B: online QD → exact POS names '(QD) Quesadilla Dorada' + variation, POS price incl. +$0.50 prensado", () => {
  const p = toPosLine(line("QDOR", ["Prensado / Spicy Pork (+$0.50)", "Mild Salsa Asada"]) as any, cat);
  assert.equal(p.baseName, "(QD) Quesadilla Dorada"); assert.equal(p.name, "(QD) Quesadilla Dorada · (QD) REGULAR Dorada");
  assert.equal(p.variationId, "QDR"); assert.equal(p.choices[0], "(QD) REGULAR Dorada"); assert.equal(p.unitCents, 625); assert.equal(p.totalCents, 1250);
});
test("auditor1 C: tortilla option becomes the POS variation; meat upcharges priced per item from the catalog", () => {
  const q = toPosLine(line("QOR", ["(QCO) Quesadilla Comal / Homemade (+$1.00)", "Lengua / Beef Tongue"], 3) as any, cat);
  assert.equal(q.name, "Quesadilla · (QCO) Quesadilla de Comal / Homemade"); assert.equal(q.unitCents, 500); assert.equal(q.totalCents, 1500);
  assert.deepEqual(q.choices, ["(QCO) Quesadilla de Comal / Homemade", "Lengua / Beef Tongue"]);
  const b = toPosLine(line("QOR", ["(QST) Quesadilla Taquera / Street Quesadilla", "Bistec / Steak"], 1) as any, cat);
  assert.equal(b.unitCents, 350);
  const unknown = line("NOPE", ["x"]); assert.equal(toPosLine(unknown as any, cat), unknown);
});
const T = (speaker: string, text: string) => ({ speaker, text, start: 0, end: 1 });
const row = (over: any = {}) => ({ callSid: "CAtestauditor0000000000000000001", at: new Date(Date.now() - 4 * 3600_000).toISOString(), recordingSid: "RE1", recordingSec: 60, answered: true, score: 90,
  turns: [T("caller", "dos tortas de bistec y dos cocas"), T("staff", "dos tortas de bistec, dos cocas")], elvi: [], pairs: [], ticket: { lines: [] }, ...over });
test("auditor1 A: STAFF_EXTRA (rice never said), CUSTOM_AMOUNT, PRICE_DIFF, STAFF_MISSING, ELVI_MISS, NO_TICKET, delivery fee", () => {
  const torta = { baseName: "Torta", variationId: "T", name: "Torta · (TO) Torta", quantity: 2, choices: ["(TO) Torta", "Bistec / Steak"], totalCents: 950 };
  const tTicket = { ...torta, choices: [...torta.choices, "Arroz / Rice"] };
  const custom = { baseName: "", name: "", quantity: 1, choices: [], totalCents: 700 };
  const coke = { baseName: "Coca Cola / Pepsi", variationId: "C", name: "Coca Cola / Pepsi · Coca Cola", quantity: 2, choices: ["Coca Cola"], totalCents: 700 };
  let a = auditCall(row({ elvi: [torta, coke], ticket: { lines: [tTicket, custom] }, pairs: [{ ticket: tTicket, elvi: torta }, { ticket: custom }, { elvi: coke }] }))!;
  assert.deepEqual(a.flags.map((f) => f.type).sort(), ["CUSTOM_AMOUNT", "STAFF_EXTRA"]); assert.ok(a.final);
  assert.match(a.flags.find((f) => f.type === "STAFF_EXTRA")!.es, /Arroz \/ Rice/);
  a = auditCall(row({ elvi: [torta, coke], ticket: { lines: [{ ...torta, totalCents: 1000 }] }, pairs: [{ ticket: { ...torta, totalCents: 1000 }, elvi: torta }, { elvi: coke }] }))!;
  assert.deepEqual(a.flags.map((f) => f.type).sort(), ["PRICE_DIFF", "STAFF_MISSING"]);
  a = auditCall(row({ turns: [T("caller", "dos tortas")], elvi: [{ ...torta, quantity: 3 }], ticket: { lines: [torta] }, pairs: [{ ticket: torta, elvi: { ...torta, quantity: 3 } }] }))!;
  assert.deepEqual(a.flags.map((f) => f.type), ["ELVI_MISS"]);
  assert.deepEqual(auditCall(row({ elvi: [torta], ticket: null }))!.flags.map((f) => f.type), ["NO_TICKET"]);
  assert.equal(auditCall(row({ at: new Date().toISOString(), elvi: [torta], ticket: null }))!.final, false); // too early to call it
  const fee = { baseName: "Delivery Fee", variationId: "D", name: "Delivery Fee · Delivery 2", quantity: 1, choices: ["Delivery 2"], totalCents: 800 };
  assert.deepEqual(auditCall(row({ elviFulfillment: "DELIVERY", elvi: [torta], ticket: { lines: [torta] }, pairs: [{ ticket: torta, elvi: torta }] }))!.flags.map((f) => f.type), ["DELIVERY_FEE_MISSING"]);
  assert.deepEqual(auditCall(row({ elviFulfillment: "DELIVERY", deliveryFeeCents: 500, elvi: [torta], ticket: { lines: [torta, fee] }, pairs: [{ ticket: torta, elvi: torta }, { ticket: fee }] }))!.flags.map((f) => f.type), ["DELIVERY_FEE_WRONG"]);
  assert.deepEqual(keywords("**Con Arroz / With Rice"), ["arroz", "rice"]);
});
test("auditor1 queue: idempotent, ELVI_MISS-only is a fix candidate (no ping), ack marks notified, no phone/address in summaries", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aud-")), "findings.jsonl");
  const r = row();
  const flags = [{ type: "STAFF_EXTRA" as const, detail: "d", es: "En el ticket hay arroz.", en: "Ticket has rice." }];
  const f = recordFinding(r, flags, file)!; assert.ok(f.ping && !f.notified);
  assert.equal(recordFinding(r, flags, file), null);
  assert.equal(pendingFindings(file).length, 1);
  const g = recordFinding({ ...r, callSid: "CAtestauditor0000000000000000002" }, [{ type: "ELVI_MISS", detail: "q", es: "x", en: "x" }], file)!;
  assert.ok(g.fixCandidate && !g.ping && g.notified);
  assert.equal(ackFindings([f.id], file), 1); assert.equal(pendingFindings(file).length, 0);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /(?<![A-Za-z0-9])\+?1?\d{10}(?!\d)|\(\d{3}\)\s*\d{3}-\d{4}/);
});

test("stop1: generic base name 'Quesadilla' said on the call → Elvi miss, never STAFF_EXTRA (synthetic)", () => {
  const at = new Date(Date.now() - 2 * 3600_000).toISOString();
  const tq = { variationId: "QCO", baseName: "Quesadilla", name: "Quesadilla · (QCO) Quesadilla de Comal / Homemade", quantity: 4, choices: ["(QCO) Quesadilla de Comal / Homemade", "Prensado / Spicy Pork"], totalCents: 2000 };
  const r = { recordingSid: "RE_SYN", at, recordingSec: 40, turns: [
    { speaker: "caller", text: "Me pone dos quesadillas de prensado." }, { speaker: "staff", text: "Eh, de maíz." },
    { speaker: "caller", text: "Y otras dos quesadillas de prensado." } ],
    elvi: [], ticket: { lines: [tq] }, pairs: [{ ticket: tq, elvi: null }] };
  const out = auditCall(r)!;
  assert.ok(!out.flags.some((f) => f.type === "STAFF_EXTRA"), JSON.stringify(out.flags));
  assert.ok(out.flags.some((f) => f.type === "ELVI_MISS"));
  assert.deepEqual(keywords("Quesadilla"), []);
});
