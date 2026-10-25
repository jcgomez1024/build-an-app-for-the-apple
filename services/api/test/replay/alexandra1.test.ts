// alexandra1 (CA3056f2c5f201254a31b5c17e0641977e ~6:20 PM ET Oct 25): desk English pickup.
// Auditor: 6 gorditas = 4 bistec + 2 lengua, all sin queso; 1 large horchata 32oz. Name Alexandra OK.
// Live miss: qty 1+1; phantom after thanks; "wanted to place" off-menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T18:20:00-04:00";
const { shadowOrderFromTurns, isOrderIntro, isClosing } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA3056f2-turns.json", import.meta.url), "utf8"));
const GD = "sq-gordita-M647RE";
const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";

test("alexandra1: wanted to place an order is intro, not menu item", () => {
  assert.equal(isOrderIntro("Hi, I wanted to place an order."), true);
  assert.equal(isOrderIntro("I wanted to place an order"), true);
  assert.equal(isOrderIntro("could I get six gorditas?"), false);
});

test("alexandra1: thank you so much is closing/thanks (no phantom)", () => {
  assert.equal(isClosing("All right, thank you so much."), true);
  assert.equal(isClosing("thank you so much"), true);
});

test("alexandra1: name Alexandra", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.equal(info!.name, "Alexandra");
});

/** Reproduce live wrongs: 1+1 gorditas, phantom after thanks. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/wanted to place/.test(t)) {
    return {
      reply: "Sorry, wanted to place isn't on our menu. Our most popular are Quesadilla, Quesadilla Dorada, Taco or Burrito. What sounds good?",
      actions: [],
    };
  }
  if (/four of them|steak/.test(t) && /gordita|four|steak/.test(t)) {
    return {
      reply: "6 × Gordita: steak, mild asada salsa. $30.00. Anything else?",
      actions: [{
        type: "add_item", itemId: GD, quantity: 6,
        modifiers: [
          { step: "(A) Gordita Options", option: "(GD) Gordita" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
          { step: "Salsa", option: "Mild Salsa Asada" },
        ],
        readback: "6 gordita steak",
      }],
    };
  }
  if (/other two|lengua/.test(t)) {
    return {
      reply: "Gordita: beef tongue and steak. $5.50. Anything else?",
      actions: [{
        type: "update_item", itemId: GD,
        modifiers: [
          { step: "(A) Gordita Options", option: "(GD) Gordita" },
          { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
      }],
    };
  }
  if (/horchata|big things/.test(t)) {
    return {
      reply: "Agua Fresca Horchata 32oz. $5.50. Anything else?",
      actions: [{ type: "add_item", itemId: HORCH, quantity: 1, modifiers: [], readback: "horchata" }],
    };
  }
  if (/thank you so much|alexandra/.test(t)) {
    return {
      reply: "Gordita: beef tongue and steak, mild asada salsa. $5.50. Anything else?",
      actions: [{
        type: "add_item", itemId: GD, quantity: 1,
        modifiers: [
          { step: "(A) Gordita Options", option: "(GD) Gordita" },
          { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "phantom gordita",
      }],
    };
  }
  return { reply: "Anything else?", actions: [] };
};

test("alexandra1: 4 bistec + 2 lengua sin queso + large horchata; no phantom", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const gds = r.cart.filter((l: any) => String(l.itemId).startsWith("sq-gordita"));
  const bistec = gds.find((l: any) => (l.modifiers || []).some((m: any) => /Bistec/i.test(m.option)));
  const lengua = gds.find((l: any) => (l.modifiers || []).some((m: any) => /Lengua/i.test(m.option)));
  assert.ok(bistec, "bistec line: " + JSON.stringify(r.cart));
  assert.ok(lengua, "lengua line: " + JSON.stringify(r.cart));
  assert.equal(bistec.quantity, 4, "4 bistec");
  assert.equal(lengua.quantity, 2, "2 lengua");
  assert.ok((bistec.elviNotes || []).some((n: string) => /sin queso/i.test(n)), "bistec sin queso");
  assert.ok((lengua.elviNotes || []).some((n: string) => /sin queso/i.test(n)), "lengua sin queso");
  const gdQty = gds.reduce((n: number, l: any) => n + (l.quantity || 1), 0);
  assert.equal(gdQty, 6, "total 6 gorditas");
  const horch = r.cart.filter((l: any) => /horchata/i.test(String(l.itemId)));
  assert.equal(horch.length, 1, "one horchata");
  assert.equal(horch[0].itemId, HORCH, "priced HL6HPK");
  assert.equal(horch[0].quantity, 1);
  assert.ok(!r.steps.some((s: any) => /isn't on our menu|wanted to place isn't/i.test(String(s.reply || s.heard || ""))),
    "no off-menu for wanted to place");
});
