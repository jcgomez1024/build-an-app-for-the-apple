// carolina1 (CA4bdd506, 7:35 PM ET), luis1 (CAddef3f8, 7:37), angie1 (CA4aba561, 7:37), oscar1b (CA792a432, 7:41), miguel1 (CAe376014, 7:46).
// Real Elvi carts from the recordings, run through the post-call list repairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyStaffReadback, fillMeatlessFromCaller, dropDeluxeComponentSides, applySaidQuesoFresco, splitEnchiladaOrders, parseList } from "../../src/list-repair.ts";
import { isNumberName } from "../../src/order-name.ts";
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const menu = fx("CA4bdd506-menu.json");
const run = (c: string) => { const t = fx(`${c}-turns.json`), cart = fx(`${c}-cart.json`);
  applyStaffReadback(cart, t, menu); fillMeatlessFromCaller(cart, t, menu); dropDeluxeComponentSides(cart, t); applySaidQuesoFresco(cart, t, menu); splitEnchiladaOrders(cart, t, menu); return cart; };
const sig = (cart: any[]) => cart.map((l) => `${l.quantity} ${String(l.itemId).replace(/^sq-([a-z]+).*$/, "$1")} ${(l.modifiers || []).map((m: any) => String(m.option).replace(/ \(\+\$[\d.]+\)/, "").split(" / ")[0]).sort().join("|")}`).sort();

test("parseList: per-meat counts, taquero context carries, dish-less count takes its neighbour", () => {
  const e = parseList("tres tacos taqueros de al pastor, tres tacos de costilla, y los tres tacos de cabeza");
  assert.deepEqual(e.map((x) => [x.qty, x.meat, x.style]), [[3, "alpastor", "taquero"], [3, "costilla", "taquero"], [3, "cabeza", "taquero"]]);
  assert.equal(parseList("cuatro del del Comal de bistec y dos quesadillas de Comal de chorizo")[0].kind, "quesadilla");
});
test("carolina1: 2 QCO bistec, QD preparada prensado + bistec, 3 each pastor/costilla/tripa/cabeza taquero, 2 bistec, horchata", () => {
  const c = run("CA4bdd506");
  assert.deepEqual(sig(c), ["1 drink ", "1 qd (QD) DELUXE Preparada|Bistec", "1 qd (QD) DELUXE Preparada|Prensado", "2 quesadilla (QCO) Quesadilla Comal|Bistec|Mild Salsa Asada",
    "2 taco (TST) Taco Taquero|Bistec|Mild Salsa Asada", "3 taco (TST) Taco Taquero|Alpastor|Mild Salsa Asada", "3 taco (TST) Taco Taquero|Cabeza|Mild Salsa Asada", "3 taco (TST) Taco Taquero|Costilla|Mild Salsa Asada", "3 taco (TST) Taco Taquero|Tripa"].sort());
  assert.ok(c.find((l: any) => (l.modifiers || []).some((m: any) => /Tripa/.test(m.option))).elviNotes.some((n: string) => /dorad/.test(n)));
});
test("luis1: 'Del Comal' resolves the 4 bistec; no phantom QD chorizo", () => {
  assert.deepEqual(sig(run("CAddef3f8")), ["2 quesadilla (QCO) Quesadilla Comal|Chorizo|Mild Salsa Asada", "4 quesadilla (QCO) Quesadilla Comal|Bistec|Mild Salsa Asada"]);
});
test("angie1: bistec said for the group fills meatless tacos/QCO; queso fresco on the gordita; deluxe sour cream not a side", () => {
  const c = run("CA4aba561");
  assert.ok(!c.some((l: any) => /^sq-extras-/.test(l.itemId)));
  const g = c.find((l: any) => /^sq-gordita-/.test(l.itemId));
  assert.ok(g.modifiers.some((m: any) => /Con Queso Fresco/.test(m.option)) && g.modifiers.some((m: any) => /^DELUXE/.test(m.option)));
  assert.deepEqual(sig(c.filter((l: any) => !/gordita/.test(l.itemId))), ["2 quesadilla (QCO) Quesadilla Comal|Bistec", "2 taco (TST) Taco Taquero|Bistec"]);
});
test("oscar1b: repeat after the hold restates (3 not 6); pastor comal; QD lengua added; no phantom QD prensado; junk name blocked", () => {
  assert.deepEqual(sig(run("CA792a432")), ["1 qd (QD) REGULAR Dorada|Bistec", "1 qd (QD) REGULAR Dorada|Lengua", "1 quesadilla (QCO) Quesadilla Comal|Alpastor", "1 quesadilla (QCO) Quesadilla Comal|Prensado", "3 quesadilla (QCO) Quesadilla Comal|Bistec"]);
  assert.equal(isNumberName("You Serious Yeah"), true); assert.equal(isNumberName("Oscar"), false);
});
test("miguel1: 'dos órdenes' + 'una de puro pollo' + 'la otra de papas y frijoles' → two enchilada orders", () => {
  assert.deepEqual(sig(run("CAe376014")), ["1 enchiladas Frijol|Mild Salsa Asada|Papas", "1 enchiladas Mild Salsa Asada|Pollo"]);
});
