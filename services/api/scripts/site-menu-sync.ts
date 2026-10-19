/**
 * Snapshot of the cocinaelvis.com storefront (public, read-only feed) -> data/site-catalog.json.
 * The app uses it to (1) allow every item the website sells (matched by Square item ID),
 * (2) apply the website's required / optional / preselect rules to modifier groups, and
 * (3) respect category time windows (Especial del Día, Sábado/Domingo, Enchiladas / Tacos al Vapor).
 *   npm run sync:site-menu
 */
import fs from "node:fs";
import path from "node:path";

const BASE = "https://www.cocinaelvis.com/app/store/api/v28/editor/users/129352762/sites/426206690500291198";
// Dine-in duplicates (MESA) and delivery subscriptions are not part of online ordering.
const SKIP_CATEGORY = /\(MESA\)|delivery plans/i;

async function get(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<any>;
}

export async function fetchSiteCatalog() {
  const cats = (await get(`${BASE}/categories?per_page=100`)).data as any[];
  const products: any[] = [];
  for (let page = 1; page < 10; page++) {
    const j = await get(`${BASE}/products?per_page=100&page=${page}&include=modifiers,skus,categories`);
    products.push(...j.data);
    if (page >= (j.meta?.pagination?.total_pages || j.meta?.total_pages || 1)) break;
  }
  const categories = cats.filter((c) => !SKIP_CATEGORY.test(c.name)).map((c) => ({
    id: c.id,
    siteCategoryId: String(c.site_category_id),
    name: c.name,
    customTimes: Boolean(c.is_custom_times),
    hours: c.is_custom_times ? c.availability?.pickup?.hours || null : null,
    // ui5: the website's own item order inside the category (site product ids).
    productOrder: (c.preferred_order_product_ids || []).map(String)
  }));
  const byKey = new Map<string, any>();
  for (const c of categories) { byKey.set(c.id, c); byKey.set(c.siteCategoryId, c); }
  const out = products
    .filter((p) => p.visibility !== "hidden")
    .map((p) => {
      const inCats = Array.from(new Set<string>((p.categoryIds || []).map((id: any) => byKey.get(String(id))?.name).filter(Boolean)));
      return {
        squareId: p.square_id,
        siteProductId: String(p.site_product_id),
        popularity: Number(p.popularity_score) || 0,
        name: String(p.name).replace(/\s*\((ONLINE|MESA)\)\s*$/i, "").trim(),
        siteName: p.name,
        categories: inCats,
        skus: (p.skus?.data || []).map((s: any) => ({ squareId: s.square_id, name: s.name, priceCents: s.price?.regular_subunits ?? null, soldOut: Boolean(s.sold_out) })),
        groups: (p.modifiers?.data || []).map((m: any) => ({
          squareId: m.square_id,
          name: m.name,
          min: Number(m.min_selected) || 0,
          max: Number(m.max_selected) || 0, // 0 = no limit
          choices: (m.choices || []).map((c: any) => ({ squareId: c.square_id, name: c.name, priceCents: Math.round(Number(c.price || 0) * 100), preselected: Boolean(c.selected_by_default) }))
        }))
      };
    })
    .filter((p) => p.categories.length > 0);
  // Store pickup hours + prep time: the site shows a category as "Available <open+prep> - <close-1min>"
  // using the overlap of the category schedule and these pickup hours.
  const loc = ((await get(`${BASE}/store-locations`)).data || [])[0] || {};
  const store = {
    timezone: loc.pickup_timezone || "America/New_York",
    pickupHours: loc.pickup_hours || null,
    prepMinutes: Number(loc.order_prep_time) || 0
  };
  return { source: BASE, fetchedAt: new Date().toISOString(), timezone: store.timezone, store, categories, products: out };
}

if (process.argv[1] && /site-menu-sync/.test(process.argv[1])) {
  const snap = await fetchSiteCatalog();
  const file = path.resolve(process.cwd(), "data/site-catalog.json");
  fs.writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");
  console.log(`Wrote ${file}: ${snap.categories.length} categories, ${snap.products.length} online products.`);
}
