// eesha1 (CA9724e14b637b408eb8048e12d8646967 ~5:12 PM ET Oct 29): Eesha, English pickup, staff answered, 99 s.
// Live miss: only 1 QD REGULAR bistec (caller said yes to deluxe), no rice & beans sides, no comal steak tacos, no sour cream;
// name "Isha" from staff although the caller spelled "two Es, S H A". Square ticket "Eesha".
// Truth: 1 QD DELUXE bistec, 2 rice & beans sides, 2 TCO steak tacos meat + queso fresco only, 2 sides crema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T17:12:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { callerLedgerEn, priceCents } = await import("../../src/caller-ledger.ts");
const { nameFromTranscriptInfo, spelledNameFromCall } = await import("../../src/order-name.ts");
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA9724e1-turns.json", import.meta.url), "utf8"));
const stubLiveMiss = async (text: string) => /quesadilla/i.test(text)
  ? { reply: "Anything else?", actions: [{ type: "add_item", itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }] }
  : { reply: "Taco: Taco Comal, Taco Harina or Taco Taquero?", actions: [] };

const has = (l: any, re: RegExp) => (l.modifiers || []).some((m: any) => re.test(String(m.option)));
const check = (cart: any[]) => {
  const d = JSON.stringify(cart);
  const qd = cart.filter((l) => /ZZAV3L/.test(l.itemId));
  assert.equal(qd.length, 1, d); assert.equal(qd[0].quantity, 1); assert.ok(has(qd[0], /Bistec/));
  assert.ok(!cart.some((l) => /T5STUH/.test(l.itemId)), d);
  assert.equal(cart.find((l) => /I5HNHW/.test(l.itemId))?.quantity, 2, d);
  const tc = cart.find((l) => /TAR7L5/.test(l.itemId));
  assert.equal(tc?.quantity, 2, d); assert.ok(has(tc, /\(TCO\)/) && has(tc, /Bistec/) && has(tc, /Con Queso Fresco/), d);
  assert.equal(cart.find((l) => /KL2XTU/.test(l.itemId))?.quantity, 2, d);
};

test("eesha1: English ledger", () => { const l = callerLedgerEn(turns)!; check(l); assert.equal(priceCents(l), 2450); });
test("eesha1: replay → deluxe QD + 2 R&B + 2 TCO steak queso fresco + 2 crema", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  check(r.cart); assert.equal(r.fulfillment, "PICKUP");
});
test("eesha1: spelled name wins over staff pronunciation", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)!.name, "Eesha");
  assert.equal(spelledNameFromCall([{ speaker: "caller", text: "It's Mark, M A R K." }]), "Mark");
  assert.equal(spelledNameFromCall([{ speaker: "caller", text: "J-O-S-H" }]), "Josh");
});
