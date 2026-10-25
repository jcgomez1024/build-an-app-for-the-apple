// daryl1 (CAaa8a362844cb3d96794a0e49ea341924 ~7:44 PM ET Oct 25): desk English pickup, 68s.
// Square: Nachos Elvis DOUBLE steak + DOUBLE chorizo ("double trigo"), onion+beans only, no lettuce.
// Name: "just tell them it's for Daryl" → Daryl pickupOnly (savedToMemory false); never "For Daryl".
// Live miss: steak + pinto/refried as meat; missed chorizo+DOUBLE; phantom ceviche after done.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T19:44:00-04:00";
const { shadowOrderFromTurns, rewriteCallerText } = await import("../../src/call-scoring.ts");
const {
  nameFromTranscriptInfo, thirdPersonName, nameFromAnswer,
  markOrderOnlyName, rememberOrderName, rememberHeardNameIfNone, isOrderOnlyName,
} = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAaa8a36-turns.json", import.meta.url), "utf8"));
const NACHOS = "sq-nachos-elvis-ZMX4IH";
const CEVICHE = "sq-ceviche-placeholder";

/** Reproduce live wrongs: nachos steak + beans-as-meat; no chorizo/DOUBLE; phantom ceviche. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/nachos|steak|trigo|chorizo|onion|beans/.test(t)) {
    return {
      reply: "Nachos. Anything else? Ceviche?",
      actions: [{
        type: "add_item", itemId: NACHOS, quantity: 1,
        modifiers: [
          { step: "(B) Nachos Options", option: "Frijoles / Pinto Beans" },
          { step: "(A) Nachos Carne Options", option: "Bistec / Steak" },
          { step: "(A) Nachos Carne Options", option: "Frijoles Refritos / Refried Beans" },
        ],
      }],
    };
  }
  if (/ceviche|done|thank|all right|that'?s it/.test(t)) {
    return {
      reply: "Ceviche?",
      actions: [{ type: "add_item", itemId: CEVICHE, quantity: 1, modifiers: [] }],
    };
  }
  return { reply: "", actions: [] };
};

test("daryl1: ASR trigo → chorizo", () => {
  assert.match(rewriteCallerText("I want double steak, double trigo"), /chorizo/i);
});

test("daryl1: it's for Daryl → Daryl pickupOnly (never For Daryl)", () => {
  assert.equal(thirdPersonName("just tell them it's for Daryl."), "Daryl");
  assert.equal(nameFromAnswer("just tell them it's for Daryl."), "Daryl");
  assert.equal(nameFromAnswer("for Daryl"), "Daryl");
  assert.equal(nameFromAnswer("For Daryl"), "Daryl");
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.equal(info!.name, "Daryl");
  assert.equal(info!.thirdPerson, true, "pickupOnly");
  assert.notEqual(info!.name.toLowerCase(), "for daryl");
  markOrderOnlyName("Daryl");
  assert.equal(isOrderOnlyName("Daryl"), true);
  assert.deepEqual(rememberOrderName("+15550009999", "Daryl"), { saved: false, reason: "third-person" });
  assert.equal(rememberHeardNameIfNone("+15550009999", "Daryl"), false);
});

test("daryl1: Nachos DOUBLE bistec+chorizo, onion+beans, no lettuce, no ceviche", async () => {
  const r = await shadowOrderFromTurns(turns as any, stubLiveMiss);
  const ids = r.cart.map((l: any) => `${l.quantity}×${l.itemId}`);
  assert.equal(r.fulfillment, "PICKUP");
  assert.equal(r.cart.length, 1, "only nachos: " + ids.join(","));
  const n = r.cart[0];
  assert.equal(n.itemId, NACHOS);
  const opts = (n.modifiers || []).map((m: any) => String(m.option));
  assert.ok(opts.some((o) => /bistec|steak/i.test(o)), "bistec");
  assert.ok(opts.some((o) => /chorizo/i.test(o)), "chorizo");
  assert.ok(opts.some((o) => /DOUBLE\s+Carne/i.test(o)), "DOUBLE Carne: " + opts.join("|"));
  assert.ok(opts.some((o) => /Frijoles\s*\/\s*Pinto/i.test(o)), "pinto beans topping");
  assert.ok(!opts.some((o) => /Refritos|Refried/i.test(o) && /Carne|Meats|\(A\)/i.test(
    String((n.modifiers || []).find((m: any) => /Refritos|Refried/i.test(String(m.option)))?.step || "")
  )), "refried not as meat");
  assert.ok(!opts.some((o) => /lechuga|lettuce/i.test(o)), "no lettuce");
  const notes = (n.elviNotes || []).join(" ");
  assert.match(notes, /cebolla|onion/i);
  assert.ok(!r.cart.some((l: any) => /ceviche/i.test(String(l.itemId))), "no phantom ceviche");
});
