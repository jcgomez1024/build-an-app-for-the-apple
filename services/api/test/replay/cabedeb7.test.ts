// cabedeb7 (CAbedeb7ac6e514567b16b43bd80fedb73 ~6:36 PM ET Oct 28): Jorge pickup, staff answered.
// Correct: 1 chile relleno platillo (2 chiles + rice/beans + corn tortillas) + 1 extra chile relleno.
// Live miss: EMPTY cart; misheard as torta huevo con chile (add_item×2 dropped); order_name Just
// from trailing "I'm just" instead of Jorge from ¿Tu nombre?.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-28T18:36:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo, nameFromAnswer } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAbedeb7-turns.json", import.meta.url), "utf8"));
const REL = "sq-chiles-rellenos-platillo-stuffed-poblano-pepper-EUM4MG";
const TOR = "sq-torta-4GNTTE";

/** Stub: reproduces live wrongs — chile relleno → torta huevo con chile add_item (never kept). */
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/chile|relleno|platillo|extra/.test(t)) {
    return {
      reply: "Torta: huevo con chile, salsa asada. $4.75. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TOR, quantity: 1,
        modifiers: [
          { step: "(A) Torta Options", option: "(TO) Torta" },
          { step: "(B) Torta Carne Options", option: "Huevo con Chile / Spicy Egg" },
        ],
        readback: "1 torta huevo con chile",
      }],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("cabedeb7: Jorge from Tu nombre; Just / I'm just blocked", () => {
  assert.equal(nameFromAnswer("Jorge"), "Jorge");
  assert.equal(nameFromAnswer("I'm just"), null);
  assert.equal(nameFromAnswer("Just"), null);
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.equal(info!.name, "Jorge", "name=" + JSON.stringify(info));
  assert.notEqual(info!.name, "Just");
});

test("cabedeb7: chile relleno platillo + extra chile (not torta huevo; cart not empty)", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const dump = JSON.stringify(r.cart.map((l: any) => ({ id: l.itemId, q: l.quantity, rb: l.readback })));

  assert.ok(r.cart.length > 0, "cart must NOT be empty: " + dump);
  assert.ok(!r.cart.some((l: any) => /^sq-torta-/i.test(String(l.itemId))), "no torta huevo: " + dump);

  const rels = r.cart.filter((l: any) => /relleno|poblano/i.test(String(l.itemId)));
  assert.ok(rels.length >= 1, "has chile relleno: " + dump);
  const qty = rels.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.ok(qty >= 2, "platillo + extra (>=2 lines/qty): " + dump);

  assert.equal(r.fulfillment, "PICKUP", "pickup: " + dump);
});
