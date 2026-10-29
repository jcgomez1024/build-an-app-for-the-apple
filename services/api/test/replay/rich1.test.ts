// rich1 (CA2b05372d3222fa320c06e6b3895600cc ~5:20 PM ET Oct 29): Rich, English pickup, staff answered, 90 s.
// Live miss: "queso burias" rung as Pambazo con queso derretido; flour quesadilla steak only (no chorizo, no double meat);
// no esquite; "I need a large street corn" parsed as a DELIVERY address (caller-address-frag, addressConfirmed);
// re-prompted for the quesadilla meat after the goodbye.
// Truth: 1 Queso Birrias QCO double meat, 1 esquite 16oz, 1 QD flour steak + chorizo double meat. Pickup, Rich.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T17:20:00-04:00";
const { shadowOrderFromTurns, rewriteCallerText } = await import("../../src/call-scoring.ts");
const { callerLedgerEn } = await import("../../src/caller-ledger.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA2b0537-turns.json", import.meta.url), "utf8"));
const seen: string[] = [];
const stubLiveMiss = async (text: string) => { seen.push(text);
  if (/burias|birrias/i.test(text)) return { reply: "Pambazo, got it.", actions: [{ type: "add_item", itemId: "sq-pambazo-PMBZ01", quantity: 1, modifiers: [{ step: "Con", option: "Queso Derretido" }] }] };
  if (/quesadilla/i.test(text)) return { reply: "What meat?", actions: [{ type: "add_item", itemId: "sq-quesadilla-QSD001", quantity: 1, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla de Harina / Flour" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }] };
  return { reply: "What meat for the quesadilla?", actions: [] }; };
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option));
const check = (cart: any[]) => {
  const d = JSON.stringify(cart);
  assert.equal(cart.length, 3, d);
  const qb = cart.find((l) => /queso-birrias/.test(l.itemId));
  assert.ok(qb && /TDRF7R$/.test(qb.itemId), d); assert.equal(qb.quantity, 1);
  assert.ok(opts(qb).some((o: string) => /^\(QCO\)/.test(o)) && opts(qb).includes("DOUBLE Carne / Meat"), d);
  assert.equal(cart.find((l) => /esquite-16oz-SGPEZK/.test(l.itemId))?.quantity, 1, d);
  const qd = cart.find((l) => /quesadilla-dorada/.test(l.itemId));
  assert.ok(qd, d); assert.ok(opts(qd).includes("Bistec / Steak") && opts(qd).includes("Chorizo / Mexican Sausage") && opts(qd).includes("DOUBLE Carne / Meat"), d);
  assert.ok(/harina|flour/i.test(JSON.stringify(qd.elviNotes || [])), d);
  assert.ok(!cart.some((l) => /pambazo/.test(l.itemId)), d);
};
test("rich1: ASR aliases", () => {
  assert.match(rewriteCallerText("can I get, queso burias?"), /Queso Birrias/);
  assert.match(rewriteCallerText("queso birias please"), /Queso Birrias/);
  assert.match(rewriteCallerText("taggitorizo and steak on it"), /\bchorizo and steak/);
  assert.match(rewriteCallerText("chorizo"), /^chorizo$/);
});
test("rich1: English ledger", () => check(callerLedgerEn(turns)!));
test("rich1: replay → QB QCO double + esquite + QD flour steak/chorizo double, pickup, no address, no post-goodbye prompts", async () => {
  seen.length = 0;
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  check(r.cart);
  assert.equal(r.fulfillment, "PICKUP");
  assert.ok(!r.address, String(r.address)); assert.ok(!r.addressConfirmed);
  assert.ok(!r.steps.some((s: any) => s.source === "caller-address-frag"), "street corn parsed as an address");
  const iBye = r.steps.findIndex((s: any) => s.source === "staff" && /give us about twenty/i.test(s.heard));
  assert.ok(iBye > 0);
  assert.ok(!r.steps.slice(iBye).some((s: any) => s.reply), JSON.stringify(r.steps.slice(iBye)));
  assert.ok(!seen.some((x) => /^(?:bye|alright, no problem)$/i.test(x.trim())), JSON.stringify(seen));
  assert.equal(nameFromTranscriptInfo(turns as any)!.name, "Rich");
});
