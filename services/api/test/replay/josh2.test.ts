// josh2 (CA75cb2b4213dda5d66db2ab418ac4c5ae ~1:36 PM ET Oct 29): Josh, returning, pickup, 23 s.
// "Dos quesadillas en el Salte, fried steak and rice" + staff "Steak and rice, frijoles, that's it?" → "Yep".
// Live miss: EMPTY cart (kept asking comal/harina/taquera); greeting got "isn't on our menu".
// Truth: 2× QD REGULAR Dorada bistec + Con Arroz + Con Frijoles ("en el Salte"/"fried" = en aceite = dorada).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T13:36:00-04:00";
const { shadowOrderFromTurns, rewriteCallerText } = await import("../../src/call-scoring.ts");
const { unavailableItemReply } = await import("../../src/menu-info.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA75cb2b-turns.json", import.meta.url), "utf8"));
const stubLiveMiss = async (text: string) =>
  /quesadilla|steak|rice/i.test(text)
    ? { reply: "Quesadilla: I have 1 steak and 1 rice. Quesadilla Comal, Quesadilla Harina or Quesadilla Taquera?", actions: [] }
    : { reply: "", actions: [] };

test("josh2: 'en el Salte' / 'en aceite' / fried → quesadillas en aceite (QD)", () => {
  assert.match(rewriteCallerText("Dos quesadillas en el Salte, fried steak and rice"), /quesadillas (?:doradas|en aceite)/i);
  assert.match(rewriteCallerText("dos quesadillas en aceite de bistec"), /quesadillas (?:doradas|en aceite)/i);
  assert.match(rewriteCallerText("two fried quesadillas steak"), /quesadillas (?:doradas|en aceite)/i);
});

test("josh2: greeting 'it's Josh, just wanna place an order' is not an off-menu item", async () => {
  const r = await unavailableItemReply("it's Josh. Just wanna place an order", "en", []);
  assert.doesNotMatch(r, /isn't on our menu/i);
  const r2 = await unavailableItemReply("Hola, soy Ana, quiero hacer un pedido", "es", []);
  assert.doesNotMatch(r2, /no tenemos/i);
});

test("josh2: name Josh", () => {
  assert.match(nameFromTranscriptInfo(turns as any)!.name, /^Josh$/i);
});

test("josh2: cart never empty → 2× QD REGULAR bistec + arroz + frijoles, PICKUP", async () => {
  const r = await shadowOrderFromTurns(turns as any, stubLiveMiss);
  const dump = JSON.stringify(r.cart);
  assert.equal(r.cart.length, 1, dump);
  const l: any = r.cart[0];
  const has = (re: RegExp) => (l.modifiers || []).some((m: any) => re.test(String(m.option)));
  assert.match(l.itemId, /quesadilla-dorada.*T5STUH/, dump);
  assert.equal(l.quantity, 2, dump);
  assert.ok(has(/REGULAR Dorada/) && has(/Bistec/) && has(/Con Arroz/) && has(/Con Frijoles/), dump);
  assert.ok(!has(/QCO|Harina|Taquera/), dump);
  assert.equal(r.fulfillment, "PICKUP");
});
