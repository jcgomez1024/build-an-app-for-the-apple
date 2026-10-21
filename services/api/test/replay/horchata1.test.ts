// horchata1: synthetic. A stale dish question must not swallow a drink; "orchata" spelling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSpokenCatalogAliases } from "../../src/text-intents.ts";
import { resolveFollowUp } from "../../src/elvi.ts";
const menu: any[] = [
  { id: "menudo", name: "Menudo", priceCents: 1500, variations: [{ name: "Menudo con Tortillas (4)" }, { name: "Con Pata" }], modifierGroups: [] },
  { id: "hor", name: "Agua Fresca Horchata 32oz", priceCents: 550, modifierGroups: [] }];
test("horchata1: 'orchata' / 'horchatas' → horchata", () => {
  assert.match(normalizeSpokenCatalogAliases("una orchata grande"), /horchata/);
  assert.match(normalizeSpokenCatalogAliases("dos horchatas"), /horchata/);
});
test("horchata1: 'póngame un agua de horchata' after a Menudo question starts over (not a Menudo answer)", () => {
  const history: any[] = [{ role: "customer", text: "menudo" }, { role: "assistant", text: "Menudo: ¿Menudo con Tortillas (4) o Con Pata?" }];
  assert.equal(resolveFollowUp("Ah, póngame un agua de horchata", history, menu, "es"), null);
});
