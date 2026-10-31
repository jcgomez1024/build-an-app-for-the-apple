// alan1 (CA0a42f0, Oct 31 12:27 PM ET): "una de bistec y una de pastor" + "otra orden igual"; staff read-back (split over two
// turns) "dos tortas de bistec y dos tortas de al pastor". Elvi rang 3 bistec + 1 pastor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const d = JSON.parse(readFileSync(new URL("../fixtures/CA0a42f0-alan1.json", import.meta.url), "utf8"));
const carne = (l: any) => l.modifiers.find((m: any) => /Carne/.test(m.step)).option;
test("alan1: final read-back counts win → 2 bistec + 2 al pastor tortas, one line each", () => {
  const cart = d.cart.cart.map((l: any) => ({ ...l })); L.applyReadbackCounts(cart, d.turns);
  assert.deepEqual(cart.map((l: any) => `${l.quantity} ${carne(l)}`), ["2 Bistec / Steak", "2 Alpastor / Roasted Pork"]);
});
test("alan1 general: dish omitted after the first pair ('dos tortas de bistec y una de pastor')", () => {
  const p = L.finalReadbackPairs([{ speaker: "staff", text: "Te tengo dos tortas de bistec y una de pastor." }] as any);
  assert.deepEqual(p.map((x: any) => `${x.qty} ${x.meat}`), ["2 bistec", "1 alpastor"]);
});
test("alan1 general: no read-back → cart untouched", () => {
  const cart = d.cart.cart.map((l: any) => ({ ...l }));
  assert.equal(L.applyReadbackCounts(cart, d.turns.filter((t: any) => !/te tengo/i.test(t.text))), false);
});
