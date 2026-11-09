// The phone menu already committed in data/site-catalog.json, plus the phone-only rows named in menu-names.ts.
// No network and no POS fetch.
import { IN_STORE_VARIATIONS, isDrinkProduct, spokenItemName } from "./menu-names.js";
import { menuIdForVariation } from "./retain-spoken.js";
import { loadSiteCatalog } from "./site-catalog.js";

let cached: any[] | null = null;

export function frozenPhoneMenu(): any[] {
  if (cached) return cached;
  const site = loadSiteCatalog();
  const rows = (site?.products || []).flatMap((product) => (product.skus || []).map((sku) => ({
    id: menuIdForVariation(product.name, sku.name, sku.squareId),
    name: /^regular$/i.test(sku.name) ? product.name : `${product.name} ${sku.name}`,
    nameEs: product.siteName || product.name,
    variationName: isDrinkProduct(product.name) ? spokenItemName(product.name, sku.name) : sku.name,
    aliases: [] as string[],
    squareCatalogObjectId: product.squareId,
    squareVariationId: sku.squareId,
    priceCents: sku.priceCents || 0,
    modifierGroups: (product.groups || []).map((group) => ({
      name: group.name,
      minSelections: group.min,
      maxSelections: group.max,
      options: group.choices.map((choice) => ({ name: choice.name, priceDeltaCents: choice.priceCents })),
      defaultOptions: group.choices.filter((choice) => choice.preselected).map((choice) => choice.name),
    })),
  })));
  for (const [variationId, row] of IN_STORE_VARIATIONS) {
    if (rows.some((item) => item.squareVariationId === variationId)) continue;
    rows.push({
      id: `sq-phone-${variationId.slice(0, 6).toLowerCase()}`,
      name: row.name,
      nameEs: row.name,
      variationName: row.name,
      aliases: row.aliases,
      squareCatalogObjectId: "",
      squareVariationId: variationId,
      priceCents: row.priceCents,
      modifierGroups: [],
    });
  }
  cached = rows;
  return cached;
}

/** Test runs may opt in. Production never attaches this menu and never writes a trace. */
export function frozenPhoneMenuAllowed(): boolean {
  return process.env.NODE_ENV === "test" && process.env.ELVI_FROZEN_PHONE_MENU === "1";
}
