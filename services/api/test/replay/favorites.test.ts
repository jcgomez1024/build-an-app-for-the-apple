// fav1: synthetic fixtures only (no real names/phones/addresses).
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
process.env.ELVI_FAVORITES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fav-"));
process.env.ELVI_CALLERS_FILE = path.join(process.env.ELVI_FAVORITES_DIR, "callers.json");
const { buildHistory, favoritesFor, favoriteAnswer, pendingFav, deliveryNudge, FAV_MIN_ORDERS } = await import("../../src/favorites.ts");

const menu = [
  { id: "T", name: "Torta", readbackName: "torta", readbackNameEs: "torta", priceCents: 1000, squareCatalogObjectId: "sqT", modifierGroups: [{ name: "(B) Torta Carnes", options: [{ name: "Bistec / Steak", priceDeltaCents: 0 }, { name: "Pastor", priceDeltaCents: 0 }] }] },
  { id: "Q", name: "Quesadilla", readbackName: "quesadilla", readbackNameEs: "quesadilla", priceCents: 600, squareCatalogObjectId: "sqQ", modifierGroups: [{ name: "(C) Con / With", options: [{ name: "**Con Frijoles / With Beans (+$0.50)", priceDeltaCents: 50 }] }] },
  { id: "H", name: "Horchata", readbackName: "horchata", readbackNameEs: "horchata", priceCents: 400, squareCatalogObjectId: "sqH", modifierGroups: [] },
];
const yes = () => true;
const o = (at: string, lines: any[], fulfillment = "PICKUP") => ({ at, source: "online" as const, fulfillment: fulfillment as any, lines });
const torta = { name: "Torta", qty: 1, mods: ["Bistec / Steak"] }, quesa = { name: "Quesadilla (ONLINE)", qty: 2, mods: ["Con Frijoles / With Beans (+$0.25)"] }, horch = { name: "Horchata", qty: 1, mods: [] };

test("fav1: threshold — fewer than 3 past orders → normal greeting (null), 3 → favorites", () => {
  assert.equal(FAV_MIN_ORDERS, 3);
  assert.equal(favoritesFor(undefined, menu, { channel: "app", available: yes }), null);
  assert.equal(favoritesFor([o("3", [torta]), o("2", [torta])], menu, { channel: "app", available: yes }), null);
  assert.equal(favoritesFor([o("3", [torta]), o("2", [torta]), o("1", [torta])], menu, { channel: "app", available: yes })!.kind, "usual");
});
test("fav1: last 3 identical → usual with today's prices (old $0.25 add-on is $0.50 today)", () => {
  const f = favoritesFor([o("4", [torta, quesa]), o("3", [quesa, torta]), o("2", [torta, quesa]), o("1", [horch])], menu, { name: "Ana", channel: "phone", available: yes })!;
  assert.equal(f.kind, "usual");
  assert.equal(f.greeting.es, "Hola Ana, ¿le preparo su favorito, torta y 2 quesadilla? Hoy son $23.00.");
  assert.match(f.greeting.en, /^Hi Ana, would you like your usual, torta and 2 quesadilla\? It's \$23\.00 today\.$/);
  assert.deepEqual(f.offers[0][1].action, { type: "add_item", itemId: "Q", quantity: 2, modifiers: [{ step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" }] });
});
test("fav1: not identical → top 3 picks; no name unless given; unavailable items dropped and said", () => {
  const hist = [o("5", [torta, horch]), o("4", [quesa]), o("3", [torta]), o("2", [{ name: "Elote", qty: 1, mods: [] }]), o("1", [horch])];
  const f = favoritesFor(hist, menu, { channel: "app", available: yes })!;
  assert.equal(f.kind, "top"); assert.equal(f.offers.length, 3);
  assert.match(f.greeting.es, /^Hola, sus favoritos son: uno, torta \(\$10\.00\); dos, horchata \(\$4\.00\); tres, quesadilla \(\$6\.50\)\. ¿Le preparo alguno\?$/);
  const soldOut = favoritesFor([o("3", [torta, horch]), o("2", [torta, horch]), o("1", [torta, horch])], menu, { channel: "app", available: (id) => id !== "sqH" })!;
  assert.match(soldOut.greeting.en, /your usual, torta\? It's \$10\.00 today\. \(horchata isn't available today\.\)$/);
});
test("fav1: 'sí' adds the usual; 'el segundo' picks #2; unrelated turn drops it", () => {
  const u = favoritesFor([o("3", [torta]), o("2", [torta]), o("1", [torta])], menu, { channel: "app", available: yes })!;
  pendingFav.set("s1", { fav: u, at: Date.now() }); assert.equal(favoriteAnswer("s1", "sí, por favor")![0].action.itemId, "T");
  const t = favoritesFor([o("3", [torta]), o("2", [horch]), o("1", [quesa])], menu, { channel: "app", available: yes })!;
  pendingFav.set("s2", { fav: t, at: Date.now() }); assert.equal(favoriteAnswer("s2", "el segundo")!.length, 1);
  pendingFav.set("s3", { fav: u, at: Date.now() }); assert.equal(favoriteAnswer("s3", "dos tacos de pastor"), null); assert.equal(favoriteAnswer("s3", "sí"), null);
});
test("fav1: delivery nudge never in the app, never for customers who already had delivery, never without an in-range saved address", () => {
  const pick = [o("2", [torta]), o("1", [torta])];
  assert.equal(deliveryNudge("5550000001", pick, "app"), null);
  assert.equal(deliveryNudge("5550000001", [o("1", [torta], "DELIVERY")], "phone"), null);
  assert.equal(deliveryNudge("5550000001", pick, "phone"), null); // no saved address → no nudge
});
test("fav1: history from online recipient phone + linked POS ticket; $0/canceled skipped", () => {
  const h = buildHistory([
    { id: "a", created_at: "2026-01-02", source: { name: "Square Online" }, state: "COMPLETED", total_money: { amount: 1000 }, fulfillments: [{ type: "PICKUP", pickup_details: { recipient: { phone_number: "+1 555-000-0002" } } }], line_items: [{ name: "Torta", quantity: "1", modifiers: [{ name: "Bistec / Steak" }] }] },
    { id: "b", created_at: "2026-01-03", source: { name: "Point of Sale" }, state: "COMPLETED", total_money: { amount: 600 }, line_items: [{ name: "Quesadilla", quantity: "1" }] },
    { id: "c", created_at: "2026-01-04", source: { name: "Point of Sale" }, state: "OPEN", total_money: { amount: 0 }, line_items: [] },
  ], { b: "+15550000002", c: "+15550000002" });
  assert.equal(h["5550000002"].length, 2); assert.equal(h["5550000002"][0].source, "phone");
});
test("fav1: top picks = one per item; items not on today's menu are skipped quietly (only real sold-out is said)", () => {
  const q2 = { name: "Quesadilla", qty: 1, mods: [] };
  const f = favoritesFor([o("4", [quesa]), o("3", [q2]), o("2", [{ name: "Old Item", qty: 1, mods: [] }]), o("1", [torta])], menu, { channel: "app", available: yes })!;
  assert.deepEqual(f.offers.map((x) => x[0].action.itemId), ["Q", "T"]); assert.deepEqual(f.dropped, []);
});
