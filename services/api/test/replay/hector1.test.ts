// hector1 (CA434ba9c06e7e182ca695c10d64e08b23 ~6:41 PM ET Oct 25): desk Spanish delivery.
// Auditor: 1 birria 1lb + Coca taparrosca + 1 torta bistec QTO $5.25; delivery fee set.
// Live miss: phantom plain torta; missed Coca (ASR "Una torta. Sí"); torta $4.75; feeCents null.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T18:41:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");
const { provisionalDeliveryFeeCents } = await import("../../src/delivery-zone.ts");
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA434ba9-turns.json", import.meta.url), "utf8"));
const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
const COCA = "sq-drink-coca-cola-JJE4KC";
const TOR = "sq-torta-4GNTTE";

/** Reproduce live wrongs: phantom plain torta + Melted Cheese; ASR torta steals coca. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/birria/.test(t)) {
    return {
      reply: "Birria. ¿Algo más?",
      actions: [{ type: "add_item", itemId: BIRRIA, quantity: 1, modifiers: [], readback: "1 birria" }],
    };
  }
  // Live wrong: "Una torta. Sí" after ¿Una coca? → plain torta (no coca)
  if (/torta/.test(t) && /s[ií]/.test(t) && !/bistec|queso/.test(t)) {
    return {
      reply: "Torta. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TOR, quantity: 1,
        modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }],
        readback: "1 torta bistec",
      }],
    };
  }
  // Live wrong: torta en queso → TO + Melted Cheese ($4.75 path) instead of QTO
  if (/torta/.test(t) && /bistec|queso/.test(t)) {
    return {
      reply: "Torta bistec. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TOR, quantity: 1,
        modifiers: [
          { step: "(A) Torta Options", option: "(TO) Torta" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
          { step: "(C)", option: "Queso Derretido / Melted Cheese" },
        ],
        readback: "1 torta bistec melted cheese",
      }],
    };
  }
  if (/coca|refresco|taparrosca|caparrusca/.test(t)) {
    return { reply: "Coca. ¿Algo más?", actions: [{ type: "add_item", itemId: COCA, quantity: 1, modifiers: [], readback: "1 coca" }] };
  }
  return { reply: "", actions: [] };
};

test("hector1: name Héctor", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.match(info!.name, /^H[eé]ctor$/i);
});

test("hector1: provisional fee when address taken but geocode failed", () => {
  assert.equal(provisionalDeliveryFeeCents(null, true), 500);
  assert.equal(provisionalDeliveryFeeCents({ ok: false, needsConfirm: true, reason: "geocode_failed", message: { es: "", en: "" } } as any, true), 500);
  assert.equal(provisionalDeliveryFeeCents({ ok: false, needsConfirm: true, reason: "out_of_range", miles: 20, message: { es: "", en: "" } } as any, true), null);
  assert.equal(provisionalDeliveryFeeCents({ ok: true, needsConfirm: false, feeCents: 800, message: { es: "", en: "" } } as any, true), 800);
  assert.equal(provisionalDeliveryFeeCents(null, false), null);
});

test("hector1: birria + coca + one QTO torta bistec; DELIVERY; no phantom plain", async () => {
  const r = await shadowOrderFromTurns(turns as any, stubLiveMiss);
  const ids = r.cart.map((l: any) => `${l.quantity}×${l.itemId}`);
  assert.equal(r.fulfillment, "DELIVERY", JSON.stringify({ fulfillment: r.fulfillment, address: r.address }));
  assert.ok(r.cart.some((l: any) => l.itemId === BIRRIA && (l.quantity || 1) === 1), "birria: " + ids.join(","));
  assert.ok(r.cart.some((l: any) => l.itemId === COCA && (l.quantity || 1) === 1), "coca: " + ids.join(","));
  const tortas = r.cart.filter((l: any) => /^sq-torta-/i.test(l.itemId));
  assert.equal(tortas.length, 1, "one torta only: " + ids.join(","));
  const t = tortas[0];
  assert.ok((t.modifiers || []).some((m: any) => /\(QTO\)/i.test(String(m.option))), "QTO: " + JSON.stringify(t.modifiers));
  assert.ok((t.modifiers || []).some((m: any) => /bistec|steak/i.test(String(m.option))), "bistec: " + JSON.stringify(t.modifiers));
  assert.ok(!(t.modifiers || []).some((m: any) => /melted cheese|queso derretido/i.test(String(m.option))), "no Melted Cheese twin");
  // QTO (+$0.50) is the $5.25 catalog path vs plain TO $4.75
  assert.ok((t.modifiers || []).some((m: any) => /\(QTO\).*\+\$0\.50/i.test(String(m.option))), "QTO +$0.50 option");
});
