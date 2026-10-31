// luis3 (CA7a1e91, Oct 31 11:43 AM ET): 3 tacos taqueros de birria, 1 menudo regular sin pata, media docena de tortillas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const d = JSON.parse(readFileSync(new URL("../fixtures/CA7a1e91-luis3.json", import.meta.url), "utf8"));
test("luis3: no phantom 1 lb birria; media docena = 6-pack tortillas", () => {
  const cart = (d.cart.cart || d.cart).map((l: any) => ({ ...l })); L.applyLuis3(cart, d.turns, menu);
  assert.deepEqual(cart.map((l: any) => `${l.quantity} ${l.itemId}`), ["3 sq-taco-TAR7L5", "1 sq-menudo-menudo-con-tortillas-4-ZSRUX4", "1 sq-tortillas-6-x-tortilla-comal-handmade-YQG6N4"]);
});
test("luis3 general: 'una orden de birria' + tacos de birria keeps the 1 lb", () => {
  const cart = [{ itemId: "sq-taco-TAR7L5", modifiers: [{ option: "Birria de Chivo / Goat Birria" }] }, { itemId: "sq-birria-de-chivo-x" }];
  assert.equal(L.dropBirriaFromDish(cart, [{ speaker: "caller", text: "Tres tacos de birria y una orden de birria" }] as any), false);
});
test("luis3 reply: regular menudo never read back as Con Pata; the regular-or-pata question stays", () => {
  assert.equal(L.fixMenudoReply("Menudo Con Pata Menudo 32oz y Tortillas (4): comal. $15.99. ¿Algo más?", [{ itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4" }]), "Menudo con Tortillas (4): comal. $15.99. ¿Algo más?");
  const q = "Menudo: ¿Menudo con Tortillas (4) o Con Pata Menudo 32oz y Tortillas (4)?";
  assert.equal(L.fixMenudoReply(q, [{ itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4" }]), q);
});
test("luis3 live: no 1 lb birria add on 'venden tacos de birria'", () => {
  const r = L.liveLuis3({ reply: "Sí.", actions: [{ type: "add_item", itemId: "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD" }] }, { transcript: "Tienen, venden tacos de birria.", cart: [] });
  assert.equal(r.actions.length, 0);
});
