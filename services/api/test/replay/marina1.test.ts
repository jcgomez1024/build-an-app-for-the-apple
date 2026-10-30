// marina1 (CAb3acddf, Oct 30 12:03 PM ET, Spanish, DELIVERY, staff-answered; transcript backfilled after a lost recording callback).
// Correct: Marina Aguilar; 3 birria de chivo; 2 órdenes de 5 tacos taqueros de asada = 10; 3 horchatas; 2 jamaicas.
// Elvi: birria 1, 2×6 comal tortillas (the birria's own tortillas), jamaica 1+2 = 3, no tacos, name "Marine" (later garble of Marina).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CAb3acddf-turns.json", import.meta.url), "utf8"));
const BIR = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
const TOR = "sq-tortillas-6-x-tortilla-comal-handmade-YQG6N4", HOR = "sq-drink-agua-fresca-horchata-32oz-HL6HPK", JAM = "sq-drink-agua-fresca-jamaica-32oz-ZLA3ZG";
const add = (itemId: string, quantity: number, modifiers: any[] = []) => ({ type: "add_item", itemId, quantity, modifiers });
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join("|");
const units = (ls: any[]) => ls.reduce((n, l) => n + l.quantity, 0);
const miss = async (t: string) => {
  if (/Tres, tres, tres de, de birria/i.test(t)) return { reply: "ok", actions: [add(BIR, 1), add(TOR, 6), add(TOR, 6)] };
  if (/Dos horchata/i.test(t)) return { reply: "ok", actions: [add(HOR, 2)] };
  if (/dos de Jamaica y un/i.test(t)) return { reply: "ok", actions: [add(JAM, 1)] };
  if (/Que sean tres de horchata/i.test(t)) return { reply: "ok", actions: [add(HOR, 1), add(JAM, 2)] };
  return { reply: "ok", actions: [] };
};
test("marina1: replay with the live miss shape → 3 birria, 10 taquero asada, 3 horchata, 2 jamaica, no tortillas, delivery", async () => {
  const r: any = await shadowOrderFromTurns(turns, miss as any);
  const c = r.cart;
  assert.equal(units(c.filter((l: any) => l.itemId === BIR)), 3);
  assert.ok(!c.some((l: any) => l.itemId === TOR), "birria's tortillas are not a separate order");
  assert.equal(units(c.filter((l: any) => l.itemId === HOR)), 3);
  assert.equal(units(c.filter((l: any) => l.itemId === JAM)), 2);
  const tacos = c.filter((l: any) => /taco/.test(l.itemId));
  assert.equal(units(tacos), 10);
  assert.ok(tacos.every((l: any) => /\(TST\)/.test(opts(l)) && /Bistec/.test(opts(l))), opts(tacos[0]));
  assert.equal(r.fulfillment, "DELIVERY");
});
test("marina1: the full spoken name 'Marina Aguilar' beats the later garble 'Marine'", () => {
  assert.equal(nameFromTranscriptInfo(turns)?.name, "Marina Aguilar");
});
