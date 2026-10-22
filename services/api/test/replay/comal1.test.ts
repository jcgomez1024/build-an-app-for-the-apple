// comal1/aceite1/again1/prep1: synthetic patterns. An option word answers the open dish question even when another
// item shares it; "en aceite" = dorada; "y otras dos" = more of the last line; "preparada" switches the variation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSpokenCatalogAliases } from "../../src/text-intents.ts";
import { resolveFollowUp, sameAgain, variationSwitch, recordLastAdd } from "../../src/elvi.ts";
const meats = { id: "B", name: "(B) Q Carnes / Meats", options: [{ id: "pr", name: "Prensado / Spicy Pork (+$0.50)" }, { id: "bi", name: "Bistec / Steak" }] };
const menu: any[] = [
  { id: "q", name: "Quesadilla", priceCents: 400, modifierGroups: [meats, { id: "A", name: "(A) Q Tortilla Options", options: [{ id: "c", name: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { id: "h", name: "(QHA) Quesadilla Harina / Flour" }, { id: "t", name: "(QTA) Quesadilla Taquera" }] }] },
  { id: "tort", name: "Tortillas 6 x Tortilla Comal / Handmade", priceCents: 300, modifierGroups: [] },
  { id: "torta", name: "Torta", priceCents: 500, modifierGroups: [meats] },
  { id: "qd-reg", name: "(QD) Quesadilla Dorada (QD) REGULAR Dorada", squareCatalogObjectId: "QD", priceCents: 550, modifierGroups: [meats] },
  { id: "qd-dlx", name: "(QD) Quesadilla Dorada (QD) DELUXE Preparada", squareCatalogObjectId: "QD", priceCents: 600, modifierGroups: [meats] },
];
test("comal1: 'Ajá, de comal' answers 'Quesadilla: ¿Comal, Harina o Taquera?' though Tortillas Comal exists", () => {
  const h: any[] = [{ role: "customer", text: "dos tortas de bistec" }, { role: "assistant", text: "2 × Torta: bistec." },
    { role: "customer", text: "dos quesadillas de prensado" }, { role: "assistant", text: "Quesadilla: ¿Quesadilla Comal, Quesadilla Harina o Quesadilla Taquera?" }];
  const r: any = resolveFollowUp("Ajá, de comal", h, menu, "es");
  assert.equal(r.actions.length, 1); assert.equal(r.actions[0].itemId, "q"); assert.equal(r.actions[0].quantity, 2);
  assert.ok(r.actions[0].modifiers.some((m: any) => /Comal/.test(m.option)) && r.actions[0].modifiers.some((m: any) => /Prensado/.test(m.option)));
});
test("aceite1: quesadilla 'en aceite' / 'fritas' = dorada; deluxe stays deluxe", () => {
  assert.match(normalizeSpokenCatalogAliases("una quesadilla de bistec en aceite"), /Dorada de bistec/);
  assert.match(normalizeSpokenCatalogAliases("dos quesadillas fritas"), /Dorada/);
  assert.doesNotMatch(normalizeSpokenCatalogAliases("quesadilla de bistec y un agua en aceite"), /Dorada/);
});
test("again1: 'y otras dos' adds two more of the last line with the same options; a named dish is not this", () => {
  const mods = [{ step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork (+$0.50)" }];
  recordLastAdd("ag1", [{ type: "add_item", itemId: "q", quantity: 2, modifiers: mods } as any]);
  const base: any = { language: "es", menu, resolverMenu: menu, sessionKey: "ag1" };
  const r: any = sameAgain({ ...base, transcript: "Y otras dos" });
  assert.equal(r.actions[0].itemId, "q"); assert.equal(r.actions[0].quantity, 2); assert.deepEqual(r.actions[0].modifiers, mods);
  assert.equal(sameAgain({ ...base, transcript: "otras dos tortas" }), null);
});
test("prep1: 'preparada, por favor' after a regular dorada switches to the deluxe variation, options kept", () => {
  const mods = [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }];
  recordLastAdd("pp1", [{ type: "add_item", itemId: "qd-reg", quantity: 1, modifiers: mods } as any]);
  const base: any = { language: "es", menu, resolverMenu: menu, sessionKey: "pp1" };
  const r: any = variationSwitch({ ...base, transcript: "No, preparada, por favor" });
  assert.deepEqual(r.actions.map((a: any) => `${a.type}:${a.itemId}`), ["remove_item:qd-reg", "add_item:qd-dlx"]);
  assert.deepEqual(r.actions[1].modifiers, mods);
  assert.equal(variationSwitch({ ...base, transcript: "una preparada de pastor" }), null);
});
