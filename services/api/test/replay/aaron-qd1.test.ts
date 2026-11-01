import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyFriedQuesadilla, normalizeFriedQuesadilla } from "../../src/list-repair.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA62bea1-aaron-qd1.json", import.meta.url), "utf8"));
const DLX = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
test("aaron-qd1: 3 fried steak quesadillas deluxe = 3 QD bistec DELUXE; flour one gets DELUXE", () => {
  const c = structuredClone(d.cart);
  assert.equal(applyFriedQuesadilla(c, d.turns), true);
  const qd = c.filter((l: any) => l.itemId === DLX); assert.equal(qd.length, 1); assert.equal(qd[0].quantity, 3);
  assert.ok(qd[0].modifiers.some((m: any) => m.option === "Bistec / Steak"));
  const fl = c.filter((l: any) => l.itemId === "sq-quesadilla-HLT6CR"); assert.equal(fl.length, 1); assert.equal(fl[0].quantity, 1);
  assert.ok(fl[0].modifiers.some((m: any) => /^DELUXE/.test(m.option)) && fl[0].modifiers.some((m: any) => /QHR/.test(m.option)));
  assert.equal(applyFriedQuesadilla(c, d.turns), false);
});
test("aaron-qd1: no deluxe said → regular QD; QD already in cart → untouched", () => {
  const c: any[] = []; applyFriedQuesadilla(c, [{ speaker: "caller", text: "two fried chicken quesadillas please" }, { speaker: "staff", text: "anything else?" }]);
  assert.equal(c.length, 1); assert.match(c[0].itemId, /regular-dorada/); assert.equal(c[0].quantity, 2);
  const c2 = [{ itemId: DLX, quantity: 2, modifiers: [] }]; assert.equal(applyFriedQuesadilla(c2, [{ speaker: "caller", text: "dos quesadillas doradas de bistec deluxe" }]), false);
});
test("aaron-qd1: live wording reaches the QD", () => {
  assert.match(normalizeFriedQuesadilla("three fried steak quesadillas"), /quesadilla dorada steak/);
  assert.equal(normalizeFriedQuesadilla("one flour steak quesadilla deluxe"), "one flour steak quesadilla deluxe");
});
