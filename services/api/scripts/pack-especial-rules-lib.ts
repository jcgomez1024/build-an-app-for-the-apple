// Website rules for Pack Meals and Especiales (same idea as combo-rules.csv):
// the cocinaelvis.com storefront decides what is required, the limits, prices and preselects;
// the rules CSVs decide what Elvi asks vs. only adds when the caller mentions it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, STOREFRONT, type StoreGroup } from "./guide-rules-lib.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA = path.resolve(here, "../data");
export const PACK_RULES = path.join(DATA, "rules/pack-rules.csv");
export const ESPECIAL_RULES = path.join(DATA, "rules/especial-rules.csv");
export const PACK_GUIDE = path.join(DATA, "pack-meal-guide.json");
export const ESPECIAL_GUIDE = path.join(DATA, "especial-guide.json");

export type Mode = "ask" | "optional";
export type RuleRow = { squareItem: string; ask: string[]; optional: string[]; callersSay: string[]; summary: string };
export type Sku = { squareId: string; name: string; priceCents: number };
export type StoreProduct = { squareItemId: string; name: string; categoryIds: string[]; priceLowCents: number; skus: Sku[]; groups: StoreGroup[] };

export function readRuleRows(file: string): RuleRow[] {
  const [header, ...body] = parseCsv(fs.readFileSync(file, "utf-8"));
  const col = (n: string) => header.indexOf(n);
  const list = (s: string) => s.split(";").map((x) => x.trim()).filter(Boolean);
  return body.filter((r) => r.some((c) => c.trim())).map((r) => {
    const cell = (n: string) => String(r[col(n)] ?? "").trim();
    return { squareItem: cell("square_item"), ask: list(cell("ask")), optional: list(cell("optional")), callersSay: cell("callers_say").split("|").map((x) => x.trim()).filter(Boolean), summary: cell("summary") };
  });
}

export async function loadStorefrontProducts(): Promise<StoreProduct[]> {
  const out: StoreProduct[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await fetch(`${STOREFRONT.base}?per_page=100&page=${page}&include=modifiers,skus`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`storefront ${res.status}`);
    const json: any = await res.json();
    for (const p of json.data || []) {
      if (!/\(online\)/i.test(p.name) || /voice online/i.test(p.name)) continue;
      out.push({
        squareItemId: p.square_id,
        name: String(p.name).replace(/\s*\(online\)\s*/i, " ").replace(/\s+/g, " ").trim(),
        categoryIds: (p.categoryIds || []).map(String),
        priceLowCents: Math.round(Number(p.price?.regular_low ?? 0) * 100),
        skus: (p.skus?.data || []).map((s: any) => ({ squareId: s.square_id, name: String(s.name), priceCents: Math.round(Number(s.price?.regular ?? 0) * 100) })),
        groups: (p.modifiers?.data || []).sort((a: any, b: any) => a.display_order - b.display_order).map((m: any) => ({
          squareListId: m.modifier_set_id || m.square_id, name: m.name, min: Number(m.min_selected ?? 0),
          max: Number(m.max_selected ?? 0) === 0 ? null : Number(m.max_selected), hidden: Boolean(m.hidden_from_customer),
          choices: (m.choices || []).map((c: any) => ({ squareId: c.square_id, name: c.name, priceCents: Math.round(Number(c.price || 0) * 100), preselected: Boolean(c.selected_by_default), hidden: Boolean(c.hidden), soldOut: Boolean(c.sold_out) }))
        }))
      });
    }
    if (!json.meta?.pagination?.links?.next) break;
  }
  return out;
}

export function key(text: string) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^\s*\*+/, "").replace(/^\s*\([a-z]{1,4}\)\s*/, "").replace(/^\s*\d+\s*x\s+/, "").replace(/\(\s*[+-]?\$[\d.]+\s*\)/g, " ")
    .replace(/\*+/g, " ").replace(/\bfour\b/g, "flour").replace(/\btounge\b/g, "tongue")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Short CSV word for a guide step: option, meats (all item-N-meat), meat, deluxe, salsa, agua, extras, with, options. */
export function ruleWord(step: any): string {
  const k = String(step.key || "");
  if (/^item-\d+-meat$/.test(k)) return "meats";
  if (step.kind === "itemOption" || /-option$/.test(k) && step.kind !== "multi") return "option";
  if (step.kind === "meat") return "meat";
  if (/deluxe/i.test(step.kind) || /deluxe/.test(k)) return "deluxe";
  if (/salsa/.test(k)) return "salsa";
  if (/agua/.test(k)) return "agua";
  if (/extras/.test(k)) return "extras";
  if (/-with$/.test(k)) return "with";
  return "options";
}

/** Which website piece a guide step reads from: the item's options (skus) or one modifier group. */
export function storeSourceFor(step: any, product: StoreProduct): { skus: Sku[] } | { group: StoreGroup } | null {
  const word = ruleWord(step);
  if (word === "option") return product.skus.length ? { skus: product.skus } : null;
  const find = (re: RegExp) => product.groups.find((g) => re.test(g.name)) || null;
  let g: StoreGroup | null = null;
  if (word === "meats") g = find(new RegExp(`Item\\s*#\\s*${String(step.key).match(/\d+/)?.[0]}\\b.*Carne`, "i"));
  else if (word === "meat") g = find(/carnes?\b|carne options|meats?\b/i);
  else if (word === "deluxe") g = find(/deluxe/i);
  else if (word === "salsa") g = find(/salsa preferencia|salsa options/i);
  else if (word === "agua") g = find(/agua fresca/i);
  else if (word === "extras") g = find(/^\W*extras?\b|\bextras\b|extra tortilla/i);
  else if (word === "with") g = find(/con\s*\/\s*with/i);
  else g = product.groups.find((x) => /options/i.test(x.name) && !/carne|meat/i.test(x.name)) || null;
  return g ? { group: g } : null;
}
