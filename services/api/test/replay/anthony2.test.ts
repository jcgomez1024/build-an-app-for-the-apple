// anthony2 (CA17f2b5c, Oct 30 11:55 AM ET, pickup, staff-answered): 1 Queso Birrias del comal, 4 tacos de comal de asada,
// 4 gorditas asada + 4 gorditas pastor, 4 jarritos mezclados. Live miss: phantom Coctel de Camarón (staff listed it), QCO pollo,
// gordita pollo DELUXE (caller only asked "¿tienes pollo a la crema?"), gordita bistec 8+1 + pastor 1, no tacos, 1 Jarrito Tamarindo.
// Tacos = 4: caller said "cuatro tacos de asada"; staff read back "tres" and caller only said "más o menos".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { isAvailQ, isEchoOfStaff } from "../../src/spoken-ledger.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA17f2b5c-turns.json", import.meta.url), "utf8"));
const G = "sq-gordita-M647RE", Q = "sq-quesadilla-HLT6CR", QB = "sq-queso-birrias-qst-3-x-queso-birrias-taquera-street-con-consome-broth-VUBNR7";
const gm = (m: string, x: any[] = []) => [{ step: "(A) Gordita Options", option: "(GD) Gordita" }, { step: "(B) Q Carnes / Meats", option: m }, ...x];
const add = (itemId: string, quantity: number, modifiers: any[] = []) => ({ type: "add_item", itemId, quantity, modifiers });
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join("|");
const units = (ls: any[]) => ls.reduce((n, l) => n + l.quantity, 0);

const miss = async (t: string) => {
  if (/^Coctel de camar/i.test(t)) return { reply: "ok", actions: [add("sq-coctel-de-camaron-X", 1)] };
  if (/me da una orden de esa/i.test(t)) return { reply: "ok", actions: [add(Q, 1, [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }])] };
  if (/^Y, ¿tienes pollo a la crema/i.test(t)) return { reply: "ok", actions: [add(G, 1, gm("Pollo / Chicken", [{ step: "(C) Deluxe", option: "DELUXE" }]))] };
  if (/ocho gorditas/i.test(t)) return { reply: "ok", actions: [add(G, 8, gm("Bistec / Steak"))] };
  if (/Cuatro de asada y cuatro pastor/i.test(t)) return { reply: "ok", actions: [add(G, 1, gm("Bistec / Steak")), add(G, 1, gm("Alpastor / Roasted Pork"))] };
  if (/^\W*cuatro\W*$/i.test(t)) return { reply: "ok", actions: [add("sq-drink-jarrito-tamarindo-tamarind-YEOHG5", 1)] };
  return { reply: "ok", actions: [] };
};

test("anthony2: replay with the live miss shape → QB comal 1, 4 TCO asada, 4+4 gorditas, 4 jarritos mezclados; no phantoms", async () => {
  const r: any = await shadowOrderFromTurns(turns, miss as any);
  const cart = r.cart;
  assert.ok(!cart.some((l: any) => /coctel/i.test(l.itemId)), "no coctel");
  assert.ok(!cart.some((l: any) => /Pollo|DELUXE/i.test(opts(l))), "no pollo / deluxe");
  assert.ok(!cart.some((l: any) => l.itemId === Q), "no plain quesadilla");
  const qb = cart.filter((l: any) => l.itemId === QB);
  assert.equal(units(qb), 1); assert.match(opts(qb[0]), /\(QCO\)/);
  const tacos = cart.filter((l: any) => /taco/.test(l.itemId));
  assert.equal(units(tacos), 4); assert.ok(tacos.every((l: any) => /\(TCO\)/.test(opts(l)) && /Bistec/.test(opts(l))));
  const g = cart.filter((l: any) => l.itemId === G);
  assert.equal(units(g.filter((l: any) => /Bistec/.test(opts(l)))), 4);
  assert.equal(units(g.filter((l: any) => /Alpastor/.test(opts(l)))), 4);
  const j = cart.filter((l: any) => /jarrito/.test(l.itemId));
  assert.equal(units(j), 4); assert.match(String(j.map((l: any) => l.elviNotes)), /mezclad|mixed/i);
});

test("anthony2: availability questions and staff-menu echoes are not orders", () => {
  assert.ok(isAvailQ("Y, ¿tienes pollo a la crema? Ajá,"));
  assert.ok(isAvailQ("Tiene quesadilla de birria."));
  assert.ok(!isAvailQ("¿me da una orden de esa, porfa?"));
  assert.ok(!isAvailQ("cuatro tacos de asada"));
  assert.ok(isEchoOfStaff("Coctel de camarón.", "Tenemos enchiladas, este, tacos al vapor, cóctel de camarón."));
  assert.ok(!isEchoOfStaff("pastor", "¿de pastor o de cabeza?"));
  assert.ok(!isEchoOfStaff("cuatro de asada", "tenemos asada"));
});
