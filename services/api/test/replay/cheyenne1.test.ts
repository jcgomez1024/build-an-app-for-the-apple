// cheyenne1: synthetic session pattern. "hecha a mano" = comal; "dos de chorizo" = more of the last dish; fuzzy ticket name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSpokenCatalogAliases } from "../../src/text-intents.ts";
import { sameDishMore, recordLastAdd } from "../../src/elvi.ts";
import { candidateTickets } from "../../src/call-accuracy.ts";
const menu: any[] = [{ id: "taco", name: "Taco", priceCents: 300, modifierGroups: [
  { id: "A", name: "(A) T Tortilla Options", options: [{ id: "tco", name: "(TCO) Taco Comal / Homemade (+$1.00)" }, { id: "tst", name: "(TST) Taco Taquero / Street Taco" }] },
  { id: "B", name: "(B) T Carnes / Meats Opciones", options: [{ id: "bi", name: "Bistec / Steak" }, { id: "ch", name: "Chorizo / Mexican Sausage" }] }] }];
test("cheyenne1: 'de hecha mano' / 'la tortilla grande hecha a mano' / 'handmade' → comal", () => {
  assert.match(normalizeSpokenCatalogAliases("Sí, de hecha mano"), /de comal/);
  assert.match(normalizeSpokenCatalogAliases("de la tortilla grande hecha a mano"), /^de comal$/);
  assert.match(normalizeSpokenCatalogAliases("handmade please"), /de comal/);
});
test("cheyenne1: after 2 bistec comal tacos, 'dos de bistec' is a repeat; 'dos de chorizo. No, digo, solo, ah, cuatro' adds 2 chorizo comal (never dorados)", () => {
  recordLastAdd("chy1", [{ type: "add_item", itemId: "taco", quantity: 2, modifiers: [{ step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }]);
  const base: any = { language: "es", menu, resolverMenu: menu, sessionKey: "chy1" };
  assert.equal(sameDishMore({ ...base, transcript: "dos de bistec" }).actions.length, 0);
  const r: any = sameDishMore({ ...base, transcript: "dos de chorizo. No, digo, solo, ah, cuatro" });
  assert.equal(r.actions.length, 1); assert.equal(r.actions[0].itemId, "taco"); assert.equal(r.actions[0].quantity, 2);
  assert.deepEqual(r.actions[0].modifiers.map((m: any) => m.option).sort(), ["(TCO) Taco Comal / Homemade (+$1.00)", "Chorizo / Mexican Sausage"]);
  assert.equal(sameDishMore({ ...base, transcript: "dos tortas de chorizo" }), null);
});
test("cheyenne1: ticket name 'Zandra' matches heard 'Zandrah' even when Elvi's items were wrong", () => {
  const call: any = { callSid: "CA1", at: "2026-01-05T17:00:00Z", caller: "", recordingSec: 50, recordingSid: "RE1", customerName: "Zandrah" };
  const order = { id: "o1", created_at: "2026-01-05T17:01:00Z", source: { name: "Point of Sale" }, ticket_name: "Zandra", line_items: [{ name: "Taco", quantity: "2", total_money: { amount: 800 } }], total_money: { amount: 800 } };
  const elvi: any[] = [{ name: "Tacos Dorados", baseName: "Tacos Dorados", quantity: 2, choices: [], unitCents: 1400, totalCents: 2800 }];
  assert.equal(candidateTickets(call, elvi, [order]).length, 1);
});
