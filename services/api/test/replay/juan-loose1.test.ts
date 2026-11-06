// juan-loose1 (CAe78e2500, Nov 6 ~5:31 PM ET, Juan, pickup).
// Pozole was added, then a later size answer removed it. Rice and loose comal tortillas never got an action.
// "Verdura aparte" was said with the tacos and copied onto the quesadillas.
// Enchilada con-todo toppings stay with Nati PR 13; this replay only keeps all-queso-fresco on the online orden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyVerduraAparte } from "../../src/list-repair.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { loadSiteCatalog } from "../../src/site-catalog.ts";
import type { PosCatalog } from "../../src/pos-catalog.ts";
import { looseComalTortilla, menuIdForVariation, retainSpokenOrder } from "../../src/retain-spoken.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CAe78e2500-juan-loose1.json", import.meta.url), "utf8"));
const site = loadSiteCatalog()!;
const product = (id: string) => site.products.find((p) => p.squareId === id)!;

const LOOSE_ITEM = "Z3VC5CORH6D4ZY2OW3OXMNVK";
const LOOSE_VAR = "ADELFIEMIO25YMSN3Z5LCOML";
const MAC_CATALOG: PosCatalog = {
  fetchedAt: "2026-11-06T21:05:43.000Z",
  items: [{
    id: LOOSE_ITEM,
    name: "Tortillas EXTRAS",
    modifierListIds: [],
    variations: [{ id: LOOSE_VAR, name: "1 x Tortilla Comal", priceCents: 100 }],
  }],
  modifierLists: {},
};

function phoneItem(p: { name: string; squareId: string; skus: Array<{ squareId: string; name: string; priceCents: number | null }>; groups: Array<{ name: string; choices: Array<{ name: string; priceCents: number }> }> }, skuName?: string) {
  const sku = skuName ? p.skus.find((s) => s.name === skuName)! : p.skus[0];
  return {
    id: menuIdForVariation(p.name, sku.name, sku.squareId),
    name: /^regular$/i.test(sku.name) ? p.name : `${p.name} ${sku.name}`,
    squareCatalogObjectId: p.squareId,
    squareVariationId: sku.squareId,
    priceCents: sku.priceCents || 0,
    modifierGroups: (p.groups || []).map((g) => ({
      name: g.name,
      options: g.choices.map((c) => ({ name: c.priceCents ? `${c.name} (+$${(c.priceCents / 100).toFixed(2)})` : c.name, priceDeltaCents: c.priceCents })),
    })),
  };
}

const tortillas = product("5RHPISIPMSC5Y3OYUXBT5RI6");
const sides = product("OJGTLDFWAYP3TGHEHS54PU6F");
const PACKS = tortillas.skus.map((s) => phoneItem(tortillas, s.name));
const RICE = phoneItem(sides, "Arroz / Rice");
const RICE_G = phoneItem(sides, "GRANDE Arroz-Rice");
const POZ = phoneItem(product("FOGHNXGVQJCG7N7IQMASSYGS"));
const ENCH = phoneItem(product("BFVZ4YOEIBN4AN6HV3VGDALJ"));
const Q = phoneItem(product("NAEUYWHLVJ5CZEHSFX5BX4MG"));
const TACO = phoneItem(product("Z5B6CQ5LRTEWTKEBV73MXZRF"));
const QD = phoneItem(product("DANMDMZDAJYSE6ERXUY5EKGZ"), "(QD) DELUXE Preparada");
const MENU = [POZ, ENCH, Q, TACO, QD, RICE, RICE_G, ...PACKS];

const B = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
const BT = { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" };
const DELUXE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
const QCO = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
const TCO = { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" };
const QUESO = { step: "(A) Enchiladas Carne Options (ONLINE)", option: "Queso / Cheese" };
const SALSA = { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Tomato" };
const NOTE = "verdura aparte";

/** Live miss: pozole is added, then the rice-size answer removes it. Rice and loose tortillas get no action. The note is copied onto every line. */
function missStub() {
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/pozole/.test(t)) return { actions: [{ type: "add_item", itemId: POZ.id, quantity: 1, modifiers: [{ step: "Tipo", option: "Rojo de Puerco / Red with Pork" }], readback: "pozole rojo" }], reply: "Pozole rojo." };
    if (/enchiladas/.test(t) && !/queso/.test(t)) return { actions: [{ type: "add_item", itemId: ENCH.id, quantity: 1, modifiers: [QUESO, SALSA], readback: "enchiladas" }], reply: "¿De qué?" };
    if (/plato de arroz/.test(t) || /chico/.test(t)) return { actions: /chico/.test(t) ? [{ type: "remove_item", itemId: POZ.id, quantity: 1 }] : [], reply: "¿Chico o grande?" };
    if (/dorada|preparada/.test(t) && /bistec/.test(t)) return { actions: [{ type: "add_item", itemId: QD.id, quantity: 1, modifiers: [DELUXE, B], elviNotes: [NOTE], readback: "qd" }], reply: "Deluxe." };
    if (/quesadillas de comal/.test(t)) return { actions: [{ type: "add_item", itemId: Q.id, quantity: 2, modifiers: [QCO, B], elviNotes: [NOTE], readback: "qco" }], reply: "Dos." };
    if (/tacos de bistec/.test(t)) return { actions: [{ type: "add_item", itemId: TACO.id, quantity: 2, modifiers: [TCO, BT], elviNotes: [NOTE], readback: "tacos" }], reply: "Dos tacos." };
    if (/tortillas sueltas/.test(t)) return { actions: [], reply: "¿Algo más?" };
    return { actions: [], reply: "¿Algo más?" };
  };
  r.menu = () => MENU;
  r.posCatalog = MAC_CATALOG;
  return r;
}

const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option));
const note = (l: any) => l?.elviNotes || [];

test("juan-loose1: phone menu packs are not the single tortilla; the catalog variation is", () => {
  assert.ok(PACKS.length >= 2);
  assert.ok(PACKS.every((m) => /\b(?:6|12)\s*x\b/i.test(m.name)));
  assert.equal(PACKS.some((m) => m.squareVariationId === LOOSE_VAR || /ADELFI/.test(m.id)), false);
  assert.equal(looseComalTortilla(PACKS, null), null);
  const pick = looseComalTortilla(PACKS, MAC_CATALOG);
  assert.equal(pick?.variationId, LOOSE_VAR);
  assert.equal(pick?.itemId, "sq-tortillas-extras-1-x-tortilla-comal-ADELFI");
  assert.equal(MENU.some((m) => m.id === pick?.itemId), false);
});

test("juan-loose1: soup stays, small rice and two loose tortillas are added, note stays on the tacos", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, missStub());
  const c = r.cart;
  const dump = JSON.stringify(c.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l), n: note(l) })));
  const poz = c.find((l: any) => /pozole/i.test(l.itemId));
  assert.ok(poz, dump);
  assert.equal(poz.quantity, 1);
  assert.equal(poz.itemId, POZ.id);
  assert.equal(opts(poz).some((o: string) => /puerco|pork/i.test(o)), false, dump);
  const rice = c.filter((l: any) => /arroz|rice|26S6E6|QPUFQG/i.test(`${l.itemId} ${l.name || ""}`));
  assert.equal(rice.length, 1, dump);
  assert.equal(rice[0].itemId, RICE.id);
  assert.equal(rice[0].quantity, 1);
  assert.equal(/GRANDE|QPUFQG/i.test(rice[0].itemId), false);
  const tort = c.find((l: any) => l.itemId === "sq-tortillas-extras-1-x-tortilla-comal-ADELFI");
  assert.ok(tort, dump);
  assert.equal(tort.quantity, 2);
  assert.equal(tort.squareVariationId, LOOSE_VAR);
  assert.equal(c.some((l: any) => /tortillas?-6|tortillas?-12|6-x-tortilla|12-x-tortilla/i.test(l.itemId)), false, dump);
  const ench = c.filter((l: any) => /enchilad/i.test(l.itemId));
  assert.equal(ench.length, 1, dump);
  assert.equal(ench[0].quantity, 1);
  assert.equal(ench[0].itemId, ENCH.id);
  assert.ok(opts(ench[0]).includes("Queso / Cheese"), dump);
  assert.equal(ench[0].elviNotes.includes("enchiladas: 6 queso"), true);
  const qd = c.find((l: any) => l.itemId === QD.id);
  const qco = c.find((l: any) => l.itemId === Q.id);
  const tacos = c.find((l: any) => l.itemId === TACO.id);
  assert.equal(qd?.quantity, 1);
  assert.equal(qco?.quantity, 2);
  assert.equal(tacos?.quantity, 2);
  assert.ok(note(tacos).includes(NOTE), dump);
  assert.equal(note(qd).includes(NOTE), false, dump);
  assert.equal(note(qco).includes(NOTE), false, dump);
  assert.equal(note(ench[0]).includes(NOTE), false);
  assert.equal(note(poz).includes(NOTE), false);
  assert.equal(c.length, 7, dump);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Juan");
});

test("juan-loose1: a cancel removes the soup, the rice, and the tortillas; another line's count is not copied", () => {
  const cancel = [
    { speaker: "caller", text: "¿Me puede poner un pozole rojo?" },
    { speaker: "caller", text: "No, quítame el pozole." },
    { speaker: "caller", text: "¿Y me pone un plato de arroz?" },
    { speaker: "caller", text: "Ya no quiero el arroz." },
    { speaker: "caller", text: "Dos tacos de bistec y dos tortillas sueltas de comal." },
    { speaker: "caller", text: "Sin las tortillas extras." },
  ];
  const cart: any[] = [{ itemId: POZ.id, quantity: 1, modifiers: [] }, { itemId: RICE.id, quantity: 1, modifiers: [] }];
  retainSpokenOrder(cart, cancel as any, MENU, MAC_CATALOG);
  assert.equal(cart.some((l) => /pozole|arroz|tortilla/i.test(l.itemId)), false);
  const counted: any[] = [];
  retainSpokenOrder(counted, [
    { speaker: "caller", text: "Dos tacos de bistec de comal." },
    { speaker: "caller", text: "Una tortilla suelta de comal." },
  ] as any, PACKS, MAC_CATALOG);
  assert.equal(counted.length, 1);
  assert.equal(counted[0].quantity, 1);
  const none: any[] = [];
  assert.equal(retainSpokenOrder(none, [{ speaker: "caller", text: "Dos tortillas sueltas de comal." }] as any, PACKS, null), false);
  assert.equal(none.length, 0);
});

test("juan-loose1: grande rice is the other side, and the note does not leave the tacos", () => {
  const cart: any[] = [];
  retainSpokenOrder(cart, [
    { speaker: "caller", text: "Me pone un plato de arroz." },
    { speaker: "staff", text: "¿Chico o grande?" },
    { speaker: "caller", text: "Grande." },
  ] as any, MENU, null);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].itemId, RICE_G.id);
  const lines = [
    { itemId: QD.id, modifiers: [B], elviNotes: [NOTE] },
    { itemId: Q.id, modifiers: [B], elviNotes: [NOTE] },
    { itemId: TACO.id, modifiers: [BT], elviNotes: [NOTE] },
  ];
  assert.equal(applyVerduraAparte(lines, d.turns), true);
  assert.equal(lines[0].elviNotes, undefined);
  assert.equal(lines[1].elviNotes, undefined);
  assert.deepEqual(lines[2].elviNotes, [NOTE]);
});
