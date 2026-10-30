// alexvoc1 (CA12e9407, Oct 30 12:55 PM ET, Spanish, 45 s, staff-answered): Marina's follow-up on her 12:03 delivery.
// Staff "ahorita la llevamos ya pa allá"; caller restates the drinks (3 horchata, 2 jamaica); staff "…Alex, ¿no?" → caller
// "yo soy otro grupo". Elvi built 7 jamaica + 3 horchata (final ticket) and saved "Alex" to memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo, deniedVocative, nameFromStaffVocative } from "../../src/order-name.ts";
import { applyDrinkRestatement, isStatusFollowUpCall } from "../../src/readback-pass.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA12e9407-turns.json", import.meta.url), "utf8"));
const HOR = "sq-drink-agua-fresca-horchata-32oz-HL6HPK", JAM = "sq-drink-agua-fresca-jamaica-32oz-ZLA3ZG";
const add = (itemId: string, quantity: number) => ({ type: "add_item", itemId, quantity, modifiers: [] });
const miss = async (t: string) => /cinco aguas/i.test(t) ? { reply: "ok", actions: [add(JAM, 5), add(HOR, 3)] } : /Jamaica, por favor/i.test(t) ? { reply: "ok", actions: [add(JAM, 2)] } : { reply: "ok", actions: [] };
test("alexvoc1: a status / drink-confirmation call on a placed order opens no cart", async () => {
  assert.ok(isStatusFollowUpCall(turns));
  const r: any = await shadowOrderFromTurns(turns, miss as any);
  assert.equal(r.cart.length, 0); assert.equal(r.statusCall, true);
});
test("alexvoc1: an order call is not a status call", () => {
  assert.ok(!isStatusFollowUpCall([{ speaker: "caller", text: "Quiero dos tacos, ¿ya viene el otro?", end: 20 }, { speaker: "staff", text: "Sí, ya va en camino.", end: 25 }]));
});
test("alexvoc1: the vocative the caller denied is never the name", () => {
  assert.equal(nameFromStaffVocative(turns), null);
  assert.equal(nameFromTranscriptInfo(turns), null);
  assert.ok(deniedVocative(turns, "Alex"));
  const ok = [{ speaker: "staff", text: "Gracias, Alex, ¿no?" }, { speaker: "caller", text: "Sí, gracias." }] as any;
  assert.ok(!deniedVocative(ok, "Alex"));
});
test("alexvoc1: restating two flavor counts sets totals, not adds", () => {
  const cart: any[] = [{ itemId: JAM, quantity: 5 }, { itemId: HOR, quantity: 3 }, { itemId: JAM, quantity: 2 }];
  applyDrinkRestatement(cart, [{ speaker: "caller", text: "Dos de, tres de horchata y dos de Jamaica, por favor." }]);
  assert.equal(cart.filter((l) => l.itemId === JAM).reduce((n, l) => n + l.quantity, 0), 2);
  assert.equal(cart.filter((l) => l.itemId === HOR).reduce((n, l) => n + l.quantity, 0), 3);
});
