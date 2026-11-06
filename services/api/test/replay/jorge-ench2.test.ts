// jorge-ench2 (CA53162f, Nov 6 ~5:40 PM ET, Jorge, desk-bridged). Not jorge1 (pozole).
// "tres órdenes de enchilada. Sí." then "Todas de pollo" and staff "todas de pollo, con todo" affirmed
// "Por, por favor, sí." Three orders of 6, all pollo, con todo, no salsa.
// A trailing period used to make the phrase an unknown item ("no tenemos … en el menú").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyEnchiladaOrder, ENCH_ID } from "../../src/readback-pass.ts";
import { applyEnchiladaConTodo, callerAcceptedConTodo } from "../../src/list-repair.ts";
import { ENCHILADA_CON_TODO } from "../../src/standard-toppings.ts";
import { resolveMenuRequest } from "../../src/menu-intelligence.ts";
import { compactCatalog, rememberPosCatalog } from "../../src/pos-catalog.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CA53162f-jorge-ench2.json", import.meta.url), "utf8"));
const item = {
  id: ENCH_ID, name: "Enchiladas", nameEs: "Enchiladas", aliases: ["enchiladas", "enchilada"], priceCents: 1499,
  modifierGroups: [{ id: "c", name: "(A) Enchiladas Carne Options (ONLINE)", minSelections: 1, maxSelections: 4, options: [{ id: "p", name: "Pollo / Chicken", priceDeltaCents: 0 }, { id: "s", name: "Mild Salsa Tomato", priceDeltaCents: 0 }] }],
};
const cat = compactCatalog([
  { type: "ITEM", id: "ENCH-POS", item_data: { name: "Enchiladas", modifier_list_info: [{ modifier_list_id: "F", enabled: true }], variations: [{ id: "V", item_variation_data: { name: "Orden de Enchiladas (6)", price_money: { amount: 1499 } } }] } },
  { type: "MODIFIER_LIST", id: "F", modifier_list_data: { name: "(F) Enchiladas Mas Opciones", modifiers: ENCHILADA_CON_TODO.map((r, i) => ({ id: `T${i}`, modifier_data: { name: r.name, price_money: { amount: 0 } } })) } },
]);
const low = (s: string) => s.toLowerCase();
const isTop = (o: string) => ENCHILADA_CON_TODO.some((r) => r.key.test(low(o))) && !/\bsalsa\b/.test(low(o));
const ask = (text: string) => resolveMenuRequest([item] as any, { text, language: "es", actionHint: "add_item", toolArgs: { itemQuery: text } } as any);

test("jorge-ench2: a period after the order is still the enchilada item, not unavailable", () => {
  const bare = ask("quisiera ordenar, perdón, tres órdenes de enchilada. Sí.");
  assert.equal(bare.reason, "missing_required_modifiers");
  assert.notEqual(bare.reason, "unknown_menu_item");
  const withMeat = ask("tres órdenes de enchilada de pollo");
  assert.equal(withMeat.ok, true);
  assert.equal(withMeat.actions[0].quantity, 3);
  assert.equal(withMeat.actions[0].modifiers[0].option, "Pollo / Chicken");
});

test("jorge-ench2: three orders, all pollo, affirmed con todo, no salsa", () => {
  assert.equal(callerAcceptedConTodo(d.turns), true);
  rememberPosCatalog(cat);
  try {
    const cart: any[] = [{ itemId: ENCH_ID, quantity: 3, modifiers: [{ step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Tomato" }] }];
    applyEnchiladaOrder(cart, d.turns);
    applyEnchiladaConTodo(cart, d.turns, [item]);
    assert.equal(cart.length, 1);
    assert.equal(cart[0].quantity, 3);
    assert.equal(cart[0].itemId, ENCH_ID);
    assert.equal(cart[0].elviNotes[0], "enchiladas: 18 pollo");
    const options = cart[0].modifiers.map((m: any) => String(m.option));
    assert.ok(options.includes("Pollo / Chicken"));
    assert.equal(options.filter((o: string) => !isTop(o) && !/salsa/i.test(o)).join("|"), "Pollo / Chicken");
    assert.equal(options.some((o: string) => /salsa/i.test(o)), false);
    for (const rule of ENCHILADA_CON_TODO) assert.ok(options.some((o: string) => rule.key.test(low(o))), rule.name);
  } finally { rememberPosCatalog(null); }
});

test("jorge-ench2: empty model still ends as three pollo orders con todo, name Jorge", async () => {
  const run = async () => ({ reply: "¿Algo más?", actions: [] });
  (run as any).menu = () => [item];
  rememberPosCatalog(cat);
  try {
    const r: any = await shadowOrderFromTurns(d.turns, run as any);
    const ench = r.cart.filter((l: any) => l.itemId === ENCH_ID);
    assert.equal(ench.length, 1, JSON.stringify(r.cart));
    assert.equal(ench[0].quantity, 3);
    const options = ench[0].modifiers.map((m: any) => String(m.option));
    assert.ok(options.includes("Pollo / Chicken"), options.join(" | "));
    assert.equal(ench[0].elviNotes[0], "enchiladas: 18 pollo");
    assert.equal(options.some((o: string) => /salsa/i.test(o)), false, options.join(" | "));
    for (const rule of ENCHILADA_CON_TODO) assert.ok(options.some((o: string) => rule.key.test(low(o))), options.join(" | "));
    assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Jorge");
  } finally { rememberPosCatalog(null); }
});
