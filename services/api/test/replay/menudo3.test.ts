// menudo3 (CA435752, Oct 31 11:34 AM ET) + alex2 (CAe64e71, 11:40 AM ET).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const fx = (f: string) => { const d = JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8")); return { turns: d.turns, cart: (d.cart.cart || d.cart).map((l: any) => ({ ...l })) }; };
const sig = (c: any[]) => c.map((l) => `${l.quantity} ${l.itemId}`);
test("menudo3: 3 menudos = 2 con pata + 1 regular, one line each; no phantom birria; QCO kept", () => {
  const { turns, cart } = fx("CA435752-menudo3.json"); L.applyMenudo3Alex2(cart, turns, menu);
  assert.deepEqual(sig(cart), ["2 sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG", "1 sq-menudo-menudo-con-tortillas-4-ZSRUX4",
    "2 sq-quesadilla-HLT6CR", "1 sq-quesadilla-HLT6CR", "1 sq-quesadilla-HLT6CR"]);
});
test("menudo3 general: caller who says birria keeps it after a meat-list read", () => {
  const turns = [{ speaker: "staff", text: "Tenemos cabeza, chorizo, buche, lengua, tripa y birria." }, { speaker: "caller", text: "Una orden de birria." }] as any;
  const cart = [{ itemId: "sq-birria-de-chivo-x", quantity: 1 }]; assert.equal(L.dropStaffListDish(cart, turns), false);
});
test("menudo3 live: no birria add on 'uno de buche' after the meat list", () => {
  const r = L.liveMenudo3({ actions: [{ type: "add_item", itemId: "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD" }] },
    { transcript: "Uno de buche y uno de cabeza.", history: [{ role: "assistant", text: "Tenemos cabeza, carnita, chorizo, costilla, pollo al pastor, buche, lengua, tripa, prensado y birria." }] });
  assert.equal(r.actions.length, 0);
});
test("alex2: no QD picadillo twin, bistec QD = DELUXE, extra salsa asada side", () => {
  const { turns, cart } = fx("CAe64e71-alex2.json"); L.applyMenudo3Alex2(cart, turns, menu);
  assert.deepEqual(sig(cart), ["2 sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", "2 sq-quesadilla-HLT6CR", "1 sq-extras-mild-salsa-asada-2oz-T6PGNT"]);
  assert.ok(cart[0].modifiers.some((m: any) => /Bistec/.test(m.option)));
  assert.equal(cart[2].modifiers[0].option, "Mild Salsa Asada 2oz");
  assert.equal(L.fixBistecStt("¿Qué viste? Preparadas"), "¿bistec? Preparadas");
});
test("alex2 general: caller asking for regular/normal QD keeps REGULAR; declined salsa adds nothing", () => {
  const cart = [{ itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: 1, modifiers: [] }];
  assert.equal(L.applyQdPreparada(cart, [{ speaker: "caller", text: "Una preparada y una normal" }] as any), false);
  assert.equal(L.extraSalsaSaid([{ speaker: "staff", text: "¿No quieres salsa extra?" }, { speaker: "caller", text: "No, gracias." }] as any), null);
});
