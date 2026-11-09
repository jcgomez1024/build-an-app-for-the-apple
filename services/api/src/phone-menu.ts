// The phone menu and the runtime menu are both buildMenuFromSquareCatalog on the committed site catalog.
// No network and no POS fetch.
import { IN_STORE_VARIATIONS, isDrinkProduct } from "./menu-names.js";
import { buildMenuFromSquareCatalog } from "./square.js";
import { loadSiteCatalog } from "./site-catalog.js";

let cached: any[] | null = null;

/** Square-shaped objects from data/site-catalog.json, plus the two phone-only variations. */
export function squareObjectsFromSiteCatalog(): any[] {
  const site = loadSiteCatalog();
  const objects: any[] = [];
  const categories = new Map<string, string>();
  for (const product of site?.products || []) {
    for (const name of product.categories || []) {
      if (categories.has(name)) continue;
      const id = `cat-${categories.size}`;
      categories.set(name, id);
      objects.push({ type: "CATEGORY", id, category_data: { name } });
    }
  }
  for (const product of site?.products || []) {
    const drink = isDrinkProduct(product.name) || (product.categories || []).some((name: string) => /bebida|drink/i.test(name));
    objects.push({
      type: "ITEM",
      id: product.squareId,
      item_data: {
        name: drink ? (product.siteName || product.name) : product.name,
        categories: (product.categories || []).map((name: string) => ({ id: categories.get(name) })),
        variations: (product.skus || []).map((sku) => ({
          id: sku.squareId,
          item_variation_data: {
            name: sku.name,
            channels: ["ONLINE"],
            price_money: { amount: sku.priceCents || 0 },
          },
        })),
      },
    });
  }
  for (const [variationId, row] of IN_STORE_VARIATIONS) {
    objects.push({
      type: "ITEM",
      id: `in-store-${variationId}`,
      item_data: {
        name: row.name,
        variations: [{
          id: variationId,
          item_variation_data: { name: "Regular", price_money: { amount: row.priceCents } },
        }],
      },
    });
  }
  return objects;
}

function groupsFor(product: { groups?: Array<{ name: string; min: number; max: number; choices: Array<{ name: string; priceCents: number; preselected?: boolean }> }> }) {
  return (product.groups || []).map((group) => ({
    name: group.name,
    minSelections: group.min,
    maxSelections: group.max,
    options: group.choices.map((choice) => ({ name: choice.name, priceDeltaCents: choice.priceCents })),
    defaultOptions: group.choices.filter((choice) => choice.preselected).map((choice) => choice.name),
  }));
}

export function frozenPhoneMenu(): any[] {
  if (cached) return cached;
  const site = loadSiteCatalog();
  const bySquare = new Map((site?.products || []).map((product) => [product.squareId, product]));
  cached = buildMenuFromSquareCatalog(squareObjectsFromSiteCatalog()).map((item) => {
    const product = bySquare.get(item.squareCatalogObjectId || "");
    return product ? { ...item, modifierGroups: groupsFor(product) } : item;
  });
  return cached;
}

/** Test runs may opt in. Production never attaches this menu and never writes a trace. */
export function frozenPhoneMenuAllowed(): boolean {
  return process.env.NODE_ENV === "test" && process.env.ELVI_FROZEN_PHONE_MENU === "1";
}
