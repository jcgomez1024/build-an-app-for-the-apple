import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyRestatedQty, applyStaffMenudo } from "../../src/list-repair.ts";
import { cleanFullName, canonSttName } from "../../src/caller-memory.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA5ca258-michael1.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR";
test("michael1: 'una quesadilla de bistec' then 'son dos quesadillas de bistec' → one line of 2, torta kept, menudo added", () => {
  const c = structuredClone(d.cart);
  assert.equal(applyRestatedQty(c, d.turns), true); assert.equal(applyStaffMenudo(c, d.turns), true);
  const q = c.filter((l: any) => l.itemId === Q); assert.equal(q.length, 1); assert.equal(q[0].quantity, 2);
  assert.ok(q[0].modifiers.some((m: any) => /QCO/.test(m.option)) && q[0].modifiers.some((m: any) => m.option === "Bistec / Steak"));
  assert.equal(c.filter((l: any) => /^sq-torta-/.test(l.itemId)).length, 1);
  const men = c.filter((l: any) => /menudo/.test(l.itemId)); assert.equal(men.length, 1); assert.equal(men[0].quantity, 1); assert.match(men[0].itemId, /menudo-con-tortillas/);
  assert.equal(applyRestatedQty(c, d.turns), false); assert.equal(applyStaffMenudo(c, d.turns), false);
});
test("michael1: different meats or a real 'y otra' are not merged; no menudo without staff readback", () => {
  const mk = (q: number, meat: string) => ({ itemId: Q, quantity: q, modifiers: [{ step: "(B) Q Carnes / Meats", option: meat }] });
  const a = [mk(1, "Bistec / Steak"), mk(1, "Pollo / Chicken")]; assert.equal(applyRestatedQty(a, [{ speaker: "caller", text: "una quesadilla de bistec y una de pollo" }]), false);
  const b = [mk(1, "Bistec / Steak"), mk(2, "Bistec / Steak")]; assert.equal(applyRestatedQty(b, [{ speaker: "caller", text: "una quesadilla de bistec" }, { speaker: "caller", text: "y otras dos quesadillas de bistec" }, { speaker: "staff", text: "Entonces te tengo tres quesadillas de bistec" }]), false);
  assert.equal(applyStaffMenudo([], [{ speaker: "staff", text: "¿Algo más?" }, { speaker: "caller", text: "nada más" }]), false);
});
test("michael1: STT 'Miquel' saves as Michael", () => {
  assert.equal(canonSttName("Miquel"), "Michael"); assert.equal(cleanFullName("Miquel"), "Michael"); assert.equal(cleanFullName("Maicol Pérez"), "Michael Pérez");
  assert.equal(cleanFullName("Miguel"), "Miguel");
  const n = nameFromTranscriptInfo(d.turns as any)?.name; assert.equal(cleanFullName(n), "Michael");
});
