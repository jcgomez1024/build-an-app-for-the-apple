import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyMeatSplitQty, liveMeatSplitQty, meatSplitCounts } from "../../src/list-repair.ts";
import { addressesIn, detectAddress } from "../../src/delivery.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAb91612-julian1.json", import.meta.url), "utf8"));
const meat = (l: any) => (l.modifiers || []).map((m: any) => m.option).join(" | ");
test("julian1 after-call: 4 QCO = 2 bistec + 2 chorizo", () => {
  const c = structuredClone(d.cart.cart);
  assert.equal(applyMeatSplitQty(c, d.turns), true);
  assert.equal(c.length, 2);
  assert.equal(c.find((l: any) => /Bistec/.test(meat(l))).quantity, 2);
  assert.equal(c.find((l: any) => /Chorizo/.test(meat(l))).quantity, 2);
  assert.equal(applyMeatSplitQty(c, d.turns), false);
});
test("julian1 live: adds match the read-back '4 quesadillas de comal: 2 bistec, 2 chorizo'", () => {
  const r = liveMeatSplitQty({ reply: d.cart.steps.find((s: any) => /18\.00/.test(s.reply || "")).reply, actions: d.cart.cart.map((l: any) => ({ type: "add_item", ...l })) },
    { transcript: "cuatro quesadillas de comal, dos de bistec, dos de chorizo" });
  assert.deepEqual(r.actions.map((a: any) => a.quantity), [2, 2]);
});
test("julian1 rule: per-meat counts need ≥2 meats and must add up to the dish total", () => {
  assert.equal(meatSplitCounts("dos de bistec").length, 0);
  const c = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }, { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] }];
  assert.equal(applyMeatSplitQty(structuredClone(c), [{ speaker: "caller", text: "cinco quesadillas, dos de bistec y dos de chorizo" }] as any), false);
  assert.equal(applyMeatSplitQty(structuredClone(c), [{ speaker: "caller", text: "three quesadillas, two steak and one chorizo" }] as any), true);
});
test("julian1 address: wait-time numbers never become an address; call stays pickup", () => {
  assert.equal(detectAddress(d.turns).address, null);
  for (const s of ["Dame unos 15, 20, Julián, porfa.", "como 20 minutos, Pedro", "give me about 15 to 20, Mike", "unos 10, 15 minutos"]) assert.deepEqual(addressesIn(s), [], s);
  assert.ok(addressesIn("vivo en el 20 Main Street").length === 1);
});
