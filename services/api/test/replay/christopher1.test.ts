// christopher1 (CAdd2004, Oct 31 10:07 AM ET) + daniela1 (CA1acb74, 10:11 AM ET): "sin patas" → regular menudo; "quesadilla de
// tripo" → Tripa; "chiles toreados con cebolla" / staff "¿Cebolla y chiles asados?" → Extras Cebolla y Chiles Asados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { applyMenudoSinPata, applySaidMeat, applyAsadosSide, liveChristopher } = await import("../../src/list-repair.ts");
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const MENU = fx("CA4bdd506-menu.json");
const run = (f: string) => { const { turns, cart } = fx(f); applyMenudoSinPata(cart, turns, MENU); applySaidMeat(cart, turns, MENU); applyAsadosSide(cart, turns, MENU); return cart; };
const opts = (l: any) => l.modifiers.map((m: any) => m.option);
test("christopher1: 'Sin patas' → Menudo con Tortillas (4), no Con Pata option", () => {
  const m = run("CAdd2004-christopher1.json").find((l: any) => /menudo/.test(l.itemId));
  assert.ok(!opts(m).some((o: string) => /con pata/i.test(o)), JSON.stringify(m)); assert.ok(opts(m).includes("Menudo con Tortillas (4)"));
});
test("christopher1: 'quesadilla de tripo' → Tripa, comal kept", () => {
  const q = run("CAdd2004-christopher1.json").find((l: any) => /quesadilla/.test(l.itemId));
  assert.ok(opts(q).includes("Tripa / Beef Tripe (+$0.50)")); assert.ok(!opts(q).includes("Bistec / Steak")); assert.ok(opts(q).some((o: string) => /QCO/.test(o)));
});
test("daniela1: toreados con cebolla → 1 Extras Cebolla y Chiles Asados; bistec + regular menudo untouched", () => {
  const c = run("CA1acb74-daniela1.json");
  assert.equal(c.filter((l: any) => l.modifiers.some((m: any) => m.option === "Cebolla y Chiles Asados")).length, 1);
  assert.equal(c.filter((l: any) => /quesadilla/.test(l.itemId) && opts(l).includes("Bistec / Steak")).length, 2);
  assert.ok(!c.some((l: any) => /menudo/.test(l.itemId) && opts(l).some((o: string) => /con pata/i.test(o))));
});
test("con pata orders keep Con Pata", () => {
  const cart = [{ itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 1, modifiers: [{ step: "Menudo options", option: "Con Pata Menudo 32oz y Tortillas (4)" }] }];
  applyMenudoSinPata(cart, [{ speaker: "staff", text: "¿Con pata o sin pata?" }, { speaker: "caller", text: "Con pata, por favor." }], MENU);
  assert.equal(cart[0].modifiers[0].option, "Con Pata Menudo 32oz y Tortillas (4)");
});
test("live: 'de tripo' turn's bistec add → Tripa; 'Sí' to ¿cebolla y chiles asados? adds the Extras", () => {
  const r = liveChristopher({ actions: [{ type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }] },
    { transcript: "de tripo, porfa.", history: [{ role: "user", text: "Y una quesadilla de," }], cart: [], menu: MENU, language: "es" });
  assert.equal(r.actions[0].modifiers[0].option, "Tripa / Beef Tripe (+$0.50)");
  const r2 = liveChristopher({ actions: [] }, { transcript: "Sí, por favor.", history: [{ role: "assistant", text: "¿Cebolla y chiles asados?" }], cart: [], menu: MENU, language: "es" });
  assert.equal(r2.actions[0].modifiers[0].option, "Cebolla y Chiles Asados");
});
