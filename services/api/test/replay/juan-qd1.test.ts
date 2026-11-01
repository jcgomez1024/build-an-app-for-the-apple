import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyStaffPreparadaYes, applyAguaChica } from "../../src/list-repair.ts";
import { availabilityQuestion } from "../../src/elvi.ts";
import { smallDrinkLine, toPosLines } from "../../src/pos-catalog.ts";
import { withDeliveryFee } from "../../src/twilio.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA36cd1a-juan-qd1.json", import.meta.url), "utf8"));
const cat = JSON.parse(readFileSync(new URL("../../data/logs/pos-catalog.json", import.meta.url), "utf8"));
const fresh = () => JSON.parse(JSON.stringify(d.cart));
test("juan-qd1: staff '¿te gustarían preparadas?' + 'Sí' → 2 QD DELUXE huevo con chile", () => {
  const c = fresh(); assert.ok(applyStaffPreparadaYes(c, d.turns));
  const q = c.find((l: any) => /deluxe-preparada/.test(l.itemId)); assert.equal(q.quantity, 2);
  assert.ok(q.modifiers.some((m: any) => m.option === "(QD) DELUXE Preparada") && q.modifiers.some((m: any) => /Huevo con Chile/.test(m.option)));
  const c2 = fresh(); assert.equal(applyStaffPreparadaYes(c2, [{ speaker: "staff", text: "¿Las quieres preparadas?" }, { speaker: "caller", text: "No, normales." }] as any), false);
  assert.equal(applyStaffPreparadaYes(fresh(), [{ speaker: "staff", text: "¿Preparadas o regular?" }, { speaker: "caller", text: "Sí" }] as any), false);
});
test("juan-qd1: horchata chica/pequeña/small → POS Orchata 20oz; plain stays 32oz", () => {
  const c = fresh(); assert.ok(applyAguaChica(c, d.turns));
  const h = c.find((l: any) => /horchata/.test(l.itemId)); assert.equal(h.posSize, "small");
  const line: any = { itemId: h.itemId, variationId: "HL6HPKWVIXOKQRHHXALTVGES", quantity: 1, choices: [], unitCents: 550, totalCents: 550, posSize: "small" };
  const s: any = smallDrinkLine(line, cat); assert.match(s.name, /Orchata 20oz/); assert.equal(s.totalCents, 450);
  const big: any = toPosLines([{ ...line, posSize: undefined }], cat)[0]; assert.match(big.name, /32oz/);
  for (const w of ["una horchata pequeña", "a small horchata"]) { const c3 = fresh(); assert.ok(applyAguaChica(c3, [{ speaker: "caller", text: w }] as any), w); }
  assert.equal(applyAguaChica(fresh(), [{ speaker: "caller", text: "una horchata grande" }] as any), false);
});
test("juan-qd1: delivery ticket always gets a Delivery Fee line (once); pickup none", () => {
  const food = [{ name: "QD", quantity: 2, choices: [], totalCents: 1500, kind: "food" as const }];
  const a = withDeliveryFee(food, "DELIVERY / ENTREGA", null); assert.equal(a.filter((l) => l.kind === "fee").length, 1); assert.equal(a[1].totalCents, 500);
  assert.equal(withDeliveryFee(a, "DELIVERY / ENTREGA", 800).filter((l) => l.kind === "fee").length, 1);
  assert.equal(withDeliveryFee(food, "DELIVERY / ENTREGA", 800)[1].name, "Delivery Fee · Delivery 2");
  assert.equal(withDeliveryFee(a, "TO GO / LLEVAR").length, 1);
  assert.equal(withDeliveryFee([], "DELIVERY / ENTREGA").length, 0);
});
test("juan-qd1: availability questions never add the dish", () => {
  for (const t of ["quería ver si me podían preparar, no sé si tengan chilaquiles", "Ni chiles rellenos hoy", "I was wondering if you have chilaquiles"]) {
    const r: any = availabilityQuestion({ transcript: t, history: [], menu: [], language: "es" } as any); assert.ok(r && r.actions.length === 0, t); }
  for (const t of ["dame unos chilaquiles", "me puedes poner dos quesadillas doradas"]) assert.equal(availabilityQuestion({ transcript: t, history: [], menu: [], language: "es" } as any), null, t);
});
