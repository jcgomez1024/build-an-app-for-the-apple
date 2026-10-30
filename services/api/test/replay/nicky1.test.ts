// nicky1 (CA59b9358c1de5beb6d29ecfed4f6f7269, Oct 30 7:08 PM ET, Nicky, English pickup): "a order of chila rellenos with the rice
// and beans on the side… corn tortillas". Shadow rang only a Sides rice-and-beans and quoted "Burrito $11.00" / "Enchiladas $14.99".
// cafa1 (CAaf4f6793b63b50b32e85935eed78f077, Oct 30 7:06 PM ET, Spanish pickup): QD bistec preparada + 2 taqueros bistec +
// 2 taqueros tripa right, plus a meatless Quesadilla Taquera from the style question; caller's final "Árbol" (no árbol in catalog).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { rellenoGuard, noUnrungQuote } from "../../src/elvi.ts";
import { applyRellenoOrder, dropMeatlessDup, applyArbolSalsa, normalizeRelleno } from "../../src/order-repair.ts";
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const nTurns = fx("CA59b9358-turns.json"), nMenu = fx("CA59b9358-menu.json");
const aTurns = fx("CAaf4f679-turns.json"), aMenu = fx("CAaf4f679-menu.json");
const REL = "sq-chiles-rellenos-platillo-stuffed-poblano-pepper-EUM4MG", SIDE = "sq-sides-arroz-rice-and-frijole-beans-I5HNHW";
const opts = (l: any) => (l.modifiers || []).map((m: any) => m.option);

test("nicky1: 'chila/chili rellenos', 'stuffed poblano peppers' normalize to chiles rellenos", () => {
  for (const s of ["an order of chila rellenos", "two chili relleno", "chile relleno", "stuffed poblano peppers", "a stuffed pepper"]) assert.match(normalizeRelleno(s), /chiles rellenos/);
});

test("nicky1 post-call: Sides rice/beans line → 1 Chiles Rellenos, rice and beans, corn tortillas", async () => {
  const raw = async (t: string) => /rellenos/i.test(t)
    ? { reply: "Burrito: large, refried beans, rice. $11.00. Anything else?", actions: [{ type: "add_item", itemId: SIDE, quantity: 1, modifiers: [{ step: "Sides", option: "Arroz-Rice and Frijole-Beans" }] }] }
    : { reply: "Go ahead.", actions: [] };
  const r: any = await shadowOrderFromTurns(structuredClone(nTurns), Object.assign(raw, { menu: () => nMenu }) as any);
  assert.equal(r.cart.length, 1);
  assert.equal(r.cart[0].itemId, REL); assert.equal(r.cart[0].quantity, 1);
  assert.ok(opts(r.cart[0]).includes("Arroz-Rice and Frijoles-Beans")); assert.ok(opts(r.cart[0]).includes("3 x (Corn) Corn Tortilla"));
});

test("nicky1 post-call: an extra side said on purpose stays", () => {
  const cart: any[] = [{ itemId: SIDE, quantity: 1, modifiers: [] }];
  applyRellenoOrder(cart, [{ speaker: "caller", text: "chile relleno with rice and beans, and an extra side of rice and beans" }], nMenu);
  assert.deepEqual(cart.map((l) => l.itemId).sort(), [REL, SIDE].sort());
});

test("nicky1 live: a Burrito/Sides add for 'chila rellenos' becomes the relleno with its real price; tortilla turn updates it", () => {
  const input: any = { transcript: normalizeRelleno("Okay, can I get a order of chila rellenos with the rice and beans on the side?"), language: "en", menu: nMenu, history: [], cart: [] };
  const o: any = rellenoGuard({ reply: "Burrito: large, refried beans, rice. $11.00. Anything else?", actions: [{ type: "add_item", itemId: SIDE, quantity: 1, modifiers: [] }] }, input);
  assert.equal(o.actions.length, 1); assert.equal(o.actions[0].itemId, REL);
  assert.match(o.reply, /^Chiles Rellenos .*Rice and Frijoles-Beans.*\$14\.99/);
  const cart = [{ itemId: REL, quantity: 1, modifiers: o.actions[0].modifiers }];
  const o2: any = rellenoGuard({ reply: "Enchiladas Orden de Enchiladas (6): beans, mild asada salsa. $14.99. Anything else?", actions: [] },
    { transcript: "yeah, can you make it with the, corn tortillas?", language: "en", menu: nMenu, history: [], cart });
  assert.equal(o2.actions[0].type, "update_item"); assert.ok(o2.actions[0].modifiers.some((m: any) => /Corn/.test(m.option)));
  assert.doesNotMatch(o2.reply, /Enchilada/);
});

test("nicky1 live: availability question doesn't ring; an unrung dish quote is dropped", () => {
  const r = { reply: "Yes, we have them.", actions: [] };
  assert.equal(rellenoGuard(r, { transcript: "Do you guys have chiles rellenos today?", language: "en", menu: nMenu, cart: [] }), r);
  const q: any = noUnrungQuote({ reply: "Enchiladas Orden de Enchiladas (6): beans. $14.99. Anything else?", actions: [] }, { language: "en", menu: nMenu, cart: [{ itemId: REL, quantity: 1 }] });
  assert.doesNotMatch(q.reply, /Enchilada|\$/);
});

test("cafa1: meatless Quesadilla Taquera beside the QD bistec is dropped; árbol becomes a staff note (no árbol in catalog)", () => {
  const cart: any[] = [
    { itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 1, modifiers: [{ step: "(QD) Options", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QST) Quesadilla Taquera / Street Quesadilla" }], elviNotes: ["confirmar (B) Q Carnes / Meats"], asked: true },
  ];
  assert.ok(dropMeatlessDup(cart, aMenu));
  assert.equal(cart.some((l) => l.itemId === "sq-quesadilla-HLT6CR"), false);
  assert.ok(applyArbolSalsa(cart, aTurns, aMenu));
  assert.ok(cart[1].elviNotes.includes("salsa de árbol"));
  // a lone meatless quesadilla (nothing else of its family) stays for staff to confirm
  const lone: any[] = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [], elviNotes: ["confirmar (B) Q Carnes / Meats"] }];
  assert.equal(dropMeatlessDup(lone, aMenu), false);
});
