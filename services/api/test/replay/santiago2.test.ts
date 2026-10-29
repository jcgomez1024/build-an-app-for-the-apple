// santiago2 (CA7fc26b20254412d21fa2697703bb9122 ~6:41 PM ET Oct 29): Santiago, Spanish pickup, staff answered.
// Live miss: "tres quesadillas de chicharrón duro" (de Comal) → "¿Me pones cuatro, por favor?" → staff "Cuatro quesadillas
// de Comal de Duro." → "Sí" — cart stayed 3. Square linker grabbed walk-in "Memo" (only ticket in 20 min); the real
// ticket (Santiago) was rung 37 s later.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T18:41:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { quantityCorrection, recordLastAdd } = await import("../../src/elvi.ts");
const { pickSquareOrder } = await import("../../src/twilio.ts");
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA7fc26b-turns.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-QSD001";
const menu: any[] = [{ id: Q, name: "Quesadilla", modifierGroups: [{ name: "(A) Q Tortilla Options", options: [{ name: "(QCO) Quesadilla de Comal / Homemade" }] }, { name: "(B) Q Carnes / Meats", options: [{ name: "Duro / Pork Rinds" }] }] }];
const mods = [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" }, { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" }];

test("santiago2 LIVE: '¿Me pones cuatro, por favor?' updates the last line to 4 (no new line)", () => {
  const key = "santiago2-live";
  recordLastAdd(key, [{ type: "add_item", itemId: Q, quantity: 3, modifiers: mods }]);
  const r: any = quantityCorrection({ sessionKey: key, transcript: "¿Me pones cuatro, por favor?", language: "es", menu, resolverMenu: menu } as any);
  assert.ok(r, "no correction");
  assert.deepEqual(r.actions.map((a: any) => [a.type, a.itemId, a.quantity]), [["update_item", Q, 4]]);
  // a different dish or "y dame dos" is NOT a correction
  assert.equal(quantityCorrection({ sessionKey: key, transcript: "me pones cuatro tacos de pastor", language: "es", menu, resolverMenu: menu } as any), null);
  assert.equal(quantityCorrection({ sessionKey: key, transcript: "y dame dos", language: "es", menu, resolverMenu: menu } as any), null);
});

const stub = async (text: string) => {
  if (/quesadillas?/i.test(text) && /tres/i.test(text) && /duro/i.test(text)) return { reply: "¿De comal?", actions: [{ type: "add_item", itemId: Q, quantity: 3, modifiers: mods }] };
  return { reply: "¿Algo más?", actions: [] };
};
test("santiago2 replay: caller 'cuatro' + staff 'Cuatro quesadillas de Comal de Duro' + Sí → one line ×4", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const d = JSON.stringify(r.cart);
  assert.equal(r.cart.length, 1, d);
  assert.equal(r.cart[0].itemId, Q, d); assert.equal(r.cart[0].quantity, 4, d);
  assert.equal(r.fulfillment ?? "PICKUP", "PICKUP");
});

const end = "2026-10-29T22:40:46.415Z";
const mk = (id: string, sec: number, name: string, items: string[]) => ({ id, created_at: new Date(Date.parse(end) + sec * 1000).toISOString(), ticket_name: name, source: { name: "Point of Sale" }, line_items: items.map((n) => ({ name: n, quantity: "1" })), total_money: { amount: 1000 } });
const memo = mk("hpAAlCwOLYCikt36kCVr75ibGZaZY", 60, "Memo", ["Taco", "Coca Cola"]);
const real = mk("tljkjv5aR0iID8ySaWYHosHI2lMZY", 97, "", ["Quesadilla"]);
const call = { at: end, caller: "+14400000000", name: "Santiago", talkSec: 50, lines: [{ name: "Quesadilla · (QCO) Quesadilla de Comal / Homemade", quantity: 4, kind: "food" }] };
test("santiago2 linker: item match beats an earlier walk-in; name mismatch never time-links; no lock before window closes", () => {
  const now = Date.parse(end) + 2 * 60000;
  assert.equal(pickSquareOrder(call, [memo, real], now)?.order.id, real.id);
  assert.equal(pickSquareOrder(call, [memo, real], now)?.by, "items");
  // only Memo so far: before the 20-min window closes → no link; after → still no (name is someone else)
  assert.equal(pickSquareOrder(call, [memo], now), null);
  assert.equal(pickSquareOrder({ ...call, lines: [{ name: "Torta", kind: "food" }] }, [memo], Date.parse(end) + 25 * 60000), null);
  // unnamed single ticket after the window closes still links
  assert.equal(pickSquareOrder({ ...call, lines: [{ name: "Torta", kind: "food" }] }, [real], Date.parse(end) + 25 * 60000)?.by, "only ticket in 20 min");
  // name match picks the closest after the call
  const s1 = mk("S1", -100, "Santiago", ["Taco"]), s2 = mk("S2", 30, "Santiago", ["Quesadilla"]);
  assert.equal(pickSquareOrder({ ...call, lines: [] }, [s1, s2], now)?.order.id, "S2");
});
