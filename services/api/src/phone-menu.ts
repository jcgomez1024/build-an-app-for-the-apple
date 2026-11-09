// The phone menu already committed in data/site-catalog.json. No network and no POS fetch.
import { menuIdForVariation } from "./retain-spoken.js";
import { loadSiteCatalog } from "./site-catalog.js";

let cached: any[] | null = null;

export function frozenPhoneMenu(): any[] {
  if (cached) return cached;
  const site = loadSiteCatalog();
  if (!site) return [];
  cached = site.products.flatMap((product) => (product.skus || []).map((sku) => ({
    id: menuIdForVariation(product.name, sku.name, sku.squareId),
    name: /^regular$/i.test(sku.name) ? product.name : `${product.name} ${sku.name}`,
    nameEs: product.siteName || product.name,
    variationName: sku.name,
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
  return cached;
}

/** Test runs may opt in. Production never attaches this menu and never writes a trace. */
export function frozenPhoneMenuAllowed(): boolean {
  return process.env.NODE_ENV === "test" && process.env.ELVI_FROZEN_PHONE_MENU === "1";
}
