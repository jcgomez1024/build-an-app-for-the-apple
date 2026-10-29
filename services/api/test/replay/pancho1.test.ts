// pancho1 (CAf6657ca96ab5a47427631b6550d10d45 ~1:54 PM ET Oct 29): Pancho, Spanish pickup, 109 s.
// Live miss (16 items): phantom QD from staff "de harina o doradas", extra gorditas from confirmations,
// "bistec con frijoles" → QCO de Frijoles Refritos, phantom carnitas QCO. Staff read back $41.
// Truth: 6 QCO con frijoles (5 bistec + 1 costilla) + 1 QGD bistec + 1 GD carnitas = $41.00.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T13:54:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { callerLedger, priceCents, spokenTotalDollars } = await import("../../src/caller-ledger.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAf6657c-turns.json", import.meta.url), "utf8"));
const mods = (...o: string[]) => o.map((option) => ({ option }));
// reproduce the live wrong actions: every staff/caller mention adds lines
const stubLiveMiss = async (text: string) => {
  const x = text.toLowerCase();
  const actions: any[] = [];
  if (/doradas?/.test(x)) actions.push({ type: "add_item", itemId: "sq-quesadilla-dorada-T5STUH", quantity: 2, modifiers: mods("REGULAR Dorada", "Bistec / Steak") });
  if (/con frijoles/.test(x)) actions.push({ type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: mods("(QCO) Quesadilla Comal / Homemade (+$1.00)", "Frijoles Refritos") });
  if (/gordita|carnitas/.test(x)) actions.push({ type: "add_item", itemId: "sq-gordita-M647RE", quantity: 2, modifiers: mods("(GD) Gordita", "Carnitas / Pulled Pork (+$0.50)") });
  return { reply: "¿Algo más?", actions };
};

test("pancho1: spoken total parse", () => {
  assert.equal(spokenTotalDollars("Van a ser cuarenta y uno"), 41);
  assert.equal(spokenTotalDollars("son 23 dólares"), 23);
  assert.equal(spokenTotalDollars("serían veintidós"), 22);
});

test("pancho1: caller ledger ignores staff lists/confirmations and prices to $41", () => {
  const l = callerLedger(turns)!;
  assert.ok(l, "ledger");
  assert.equal(priceCents(l), 4100, JSON.stringify(l));
});

test("pancho1: name Pancho", () => {
  assert.match(nameFromTranscriptInfo(turns as any)!.name, /^Pancho$/i);
});

test("pancho1: replay → 5 QCO bistec + 1 QCO costilla con frijoles, QGD bistec, GD carnitas, $41", async () => {
  const r = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const dump = JSON.stringify(r.cart);
  const has = (l: any, re: RegExp) => (l.modifiers || []).some((m: any) => re.test(String(m.option)));
  const qty = (f: (l: any) => boolean) => r.cart.filter(f).reduce((s: number, l: any) => s + l.quantity, 0);
  assert.equal(qty((l) => /dorada/.test(l.itemId)), 0, dump);
  assert.ok(!r.cart.some((l: any) => has(l, /Frijoles Refritos/)), dump);
  const q = (l: any) => /HLT6CR/.test(l.itemId) && has(l, /QCO/) && has(l, /Con Frijoles/);
  assert.equal(qty((l) => q(l) && has(l, /Bistec/)), 5, dump);
  assert.equal(qty((l) => q(l) && has(l, /Costilla/)), 1, dump);
  assert.equal(qty((l) => /HLT6CR/.test(l.itemId)), 6, dump);
  assert.equal(qty((l) => /M647RE/.test(l.itemId) && has(l, /QGD/) && has(l, /Bistec/)), 1, dump);
  assert.equal(qty((l) => /M647RE/.test(l.itemId) && has(l, /\(GD\)/) && has(l, /Carnitas/)), 1, dump);
  assert.equal(qty((l) => /M647RE/.test(l.itemId)), 2, dump);
  assert.equal(priceCents(r.cart as any), 4100);
  assert.equal(r.fulfillment, "PICKUP");
});
