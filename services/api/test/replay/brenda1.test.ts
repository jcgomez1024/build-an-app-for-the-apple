// brenda1 (CA6995b9c, Oct 30 12:14 PM ET, English, pickup, staff-answered). Staff read back: 2 QCO tripa quesadillas salsa verde,
// 2 grande lengua burritos DELUXE with rice + beans ("just a little bit of rice"), side salsas 2 green / 1 red / 2 avocado; 15 min; "$35.25".
// Live miss: pozole from "this is the Elvis, right?", mole from "more lengua" / "not too much rice", taco comal items from the salsa turns,
// burritos without deluxe/rice/beans, no salsas, and DELIVERY to an address parsed from the price "35 25".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { addressesIn } from "../../src/delivery.ts";
import { restaurantConfirm, salsaOnlyTurn, sideAnswerTurn, sideSalsas } from "../../src/readback-pass.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA6995b9c-turns.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR", B = "sq-burrito-TGWBEN", EX = "sq-extras-mild-salsa-asada-2oz-T6PGNT";
const add = (itemId: string, quantity: number, modifiers: any[] = []) => ({ type: "add_item", itemId, quantity, modifiers });
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join("|");
const units = (ls: any[]) => ls.reduce((n, l) => n + l.quantity, 0);
const taco = (m: string) => add("sq-taco-X", 1, [{ step: "(A) Taco Options", option: "(TCO) Taco Comal" }, { step: "(B) Carnes", option: m }]);
const miss = async (t: string) => {
  if (/the Elvis, right/i.test(t)) return { reply: "ok", actions: [add("sq-pozole-rojo-X", 1)] };
  if (/homemade quesadillas/i.test(t)) return { reply: "ok", actions: [add(Q, 2, [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe (+$0.50)" }, { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" }])] };
  if (/lengua, burritos/i.test(t)) return { reply: "ok", actions: [add(B, 2, [{ step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" }, { step: "(B) Burrito Carne Options", option: "Lengua / Beef Tongue (+$1.00)" }])] };
  if (/more,?\s*lengua|too much rice/i.test(t)) return { reply: "ok", actions: [add("sq-mole-tradicional-platillo-X", 1)] };
  if (/green|avocado/i.test(t)) return { reply: "ok", actions: [taco("Arroz"), taco("Lengua"), add("sq-huarache-X", 1)] };
  return { reply: "ok", actions: [] };
};

test("brenda1: replay with the live miss shape → 2 QCO tripa verde, 2 grande lengua deluxe rice+beans light rice, salsas 2/1/2, pickup", async () => {
  const r: any = await shadowOrderFromTurns(turns, miss as any);
  const cart = r.cart;
  assert.ok(!cart.some((l: any) => /pozole|mole|taco|huarache/i.test(l.itemId)), JSON.stringify(cart.map((l: any) => l.itemId)));
  const q = cart.filter((l: any) => l.itemId === Q);
  assert.equal(units(q), 2); assert.match(opts(q[0]), /QCO/); assert.match(opts(q[0]), /Tripa/); assert.match(opts(q[0]), /Medium Salsa Verde/); assert.doesNotMatch(opts(q[0]), /Mild Salsa Asada/);
  const b = cart.filter((l: any) => l.itemId === B);
  assert.equal(units(b), 2);
  for (const l of b) { assert.match(opts(l), /Grande/); assert.match(opts(l), /Lengua/); assert.match(opts(l), /DELUXE/); assert.match(opts(l), /Arroz/); assert.match(opts(l), /Frijoles/); assert.match((l.elviNotes || []).join(" "), /light rice/); }
  const sal = Object.fromEntries(cart.filter((l: any) => l.itemId === EX).map((l: any) => [opts(l), l.quantity]));
  assert.deepEqual(sal, { "Medium Salsa Verde 2oz": 2, "Hot Salsa Roja 2oz": 1, "Guacamole Salsa 2oz": 2 });
  assert.notEqual(r.fulfillment, "DELIVERY"); assert.ok(!r.address, "no address");
});

test("brenda1: prices are never addresses", () => {
  for (const s of ["Thank you, Brenda. Bye. it's 35 25. Thank you, Brenda.", "your total is 35 25 thank you", "that's 35.25, Brenda", "son 35 con 25", "it's $35.25"]) assert.deepEqual(addressesIn(s), [], s);
  assert.equal(addressesIn("it's 478 Bank Street")[0]?.street, "478 Bank St");
  assert.equal(addressesIn("I live at 25 Main St")[0]?.street, "25 Main St");
});

test("brenda1: turn guards + side salsa counts", () => {
  assert.ok(restaurantConfirm("this is, this is the Elvis, right?"));
  assert.ok(!restaurantConfirm("two tacos for Elvis"));
  assert.ok(sideAnswerTurn("yeah, just, not too much rice, but yes.", "Rice and beans is fine?"));
  assert.ok(!sideAnswerTurn("and two tacos de asada", "Rice and beans is fine?"));
  assert.ok(salsaOnlyTurn("Two green, one red, and maybe, two, avocado slices."));
  assert.ok(!salsaOnlyTurn("two tacos with green salsa"));
  const s = Object.fromEntries(sideSalsas(turns).map((x) => [x.option, x.quantity]));
  assert.deepEqual(s, { "Medium Salsa Verde 2oz": 2, "Hot Salsa Roja 2oz": 1, "Guacamole Salsa 2oz": 2 });
});
