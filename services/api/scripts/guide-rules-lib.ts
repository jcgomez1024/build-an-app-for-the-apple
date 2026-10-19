// Shared helpers for build-guides.ts and check-guides.ts.
// Reads Square's catalog through the existing read-only getFullMenu() (POST /v2/catalog/search).
// Never writes to Square and never prints credentials.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const API_ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(API_ROOT, "data");
export const RULES_CSV = path.join(DATA_DIR, "rules", "combo-rules.csv");
export const GUIDE_JSON = path.join(DATA_DIR, "combo-guide.json");

dotenv.config({ path: path.join(API_ROOT, ".env") });

export type Slot =
  | "tortilla" | "option" | "item1" | "item2" | "meat1" | "meat2" | "meat"
  | "size" | "inside" | "side" | "dip" | "prep" | "salsa" | "extras";

export type ComboRuleRow = {
  squareItem: string;
  squareItemId: string;
  ask: Slot[];
  defaults: Record<string, string>;
  optional: Array<{ slot: string; value?: string }>;
  callersSay: string[];
  summary: string;
};

export type SquareOption = { id?: string; name: string; priceDeltaCents?: number };
export type SquareGroup = { id: string; name: string; options: Array<string | SquareOption>; minSelections?: number; maxSelections?: number; defaultOptions?: string[] };
export type SquareItem = { id: string; name: string; priceCents: number; squareCatalogObjectId?: string; modifierGroups?: SquareGroup[] };

// Square modifier group name -> slot. Order matters (first match wins).
const SLOT_PATTERNS: Array<[Slot, RegExp]> = [
  ["tortilla", /tortilla\s+shell/i],
  ["option", /^\(a\)\s*(gorditas|tortas)\s+option/i],
  ["item1", /item\s*#?\s*1\s+mix/i],
  ["item2", /item\s*#?\s*2\s+mix/i],
  ["meat1", /item\s*#?\s*1\s+carne/i],
  ["meat2", /item\s*#?\s*2\s+carne/i],
  ["meat", /carne/i],
  ["size", /size/i],
  ["inside", /burrito\s+options/i],
  ["dip", /burrito\s+combo\s+side/i],
  ["side", /combo\s+sides?/i],
  ["prep", /deluxe/i],
  ["salsa", /salsa/i],
  ["extras", /extras?/i]
];

export function slotForGroup(groupName: string): Slot | null {
  for (const [slot, pattern] of SLOT_PATTERNS) if (pattern.test(groupName)) return slot;
  return null;
}

// Slot -> step key the web app already understands (findGuideModifierGroup in app.js).
export function stepKeyForSlot(slot: Slot, comboName: string): string {
  const base = comboName.toLowerCase();
  switch (slot) {
    case "tortilla": return /quesadilla/.test(base) ? "quesadilla-shell" : "taco-shell";
    case "option": return /torta/.test(base) ? "torta-option" : "gordita-option";
    case "item1": return "item-1-option";
    case "item2": return "item-2-option";
    case "meat1": return "item-1-meat";
    case "meat2": return "item-2-meat";
    case "meat": return "burrito-meat";
    case "size": return "burrito-size";
    case "inside": return "burrito-options";
    case "dip": return "burrito-side";
    case "side": return "combo-side";
    case "prep": return "regular-deluxe";
    case "salsa": return "salsa";
    case "extras": return "extras";
  }
}

export function kindForSlot(slot: Slot): string {
  if (slot.startsWith("meat")) return "meat";
  if (slot === "side" || slot === "dip") return "side";
  if (slot === "prep") return "regularDeluxe";
  if (slot === "salsa") return "salsa";
  if (slot === "extras") return "extras";
  if (slot === "inside") return "multi";
  return "itemOption";
}

export function norm(text: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\(\s*[+-]?\$[\d.]+\s*\)/g, " ")
    .replace(/\*+/g, " ")
    .replace(/\b[12]\s*x\b/g, " ")
    .replace(/\bside\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function optionName(option: string | SquareOption) {
  return typeof option === "string" ? option : String(option.name || "");
}
export function optionDelta(option: string | SquareOption) {
  return typeof option === "string" ? 0 : Number(option.priceDeltaCents || 0);
}
export function optionCode(name: string) {
  return name.match(/^\(([A-Z]{2,4})\)/)?.[1] || "";
}
/** Short label for read-backs: no code, no price, no "1 x", no ***. */
export function cleanLabel(name: string) {
  return String(name)
    .replace(/^\*+/, "")
    .replace(/^\([A-Z]{2,4}\)\s*/, "")
    .replace(/\(\s*[+-]?\$[\d.]+\s*\)/g, "")
    .replace(/^\s*[0-9]+\s*x\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does a rule value (e.g. "Medium Salsa Verde", "Pico de Gallo", "Regular") match a Square option? */
export function valueMatchesOption(value: string, option: string | SquareOption) {
  const v = norm(value);
  const o = norm(optionName(option));
  if (!v || !o) return false;
  if (o === v || o.startsWith(v + " ") || o.includes(" " + v + " ") || o.endsWith(" " + v) || o.startsWith(v)) return true;
  return false;
}

export function readRules(file = RULES_CSV): ComboRuleRow[] {
  const rows = parseCsv(fs.readFileSync(file, "utf-8"));
  const [header, ...body] = rows;
  const col = (name: string) => header.indexOf(name);
  return body.filter((r) => r.some((c) => c.trim())).map((r) => {
    const cell = (name: string) => String(r[col(name)] ?? "").trim();
    const list = (s: string) => s.split(";").map((x) => x.trim()).filter(Boolean);
    const defaults: Record<string, string> = {};
    for (const part of list(cell("defaults"))) {
      const [k, ...rest] = part.split("=");
      defaults[k.trim()] = rest.join("=").trim();
    }
    return {
      squareItem: cell("square_item"),
      squareItemId: cell("square_item_id"),
      ask: list(cell("ask")) as Slot[],
      defaults,
      optional: list(cell("optional")).map((p) => {
        const [slot, ...rest] = p.split(":");
        return { slot: slot.trim(), value: rest.join(":").trim() || undefined };
      }),
      callersSay: cell("callers_say").split("|").map((x) => x.trim()).filter(Boolean),
      summary: cell("summary")
    };
  });
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export async function loadSquareCombos(): Promise<SquareItem[]> {
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    throw new Error("Square credentials are not configured in services/api/.env");
  }
  const { getFullMenu } = await import("../src/square.js");
  const menu = (await getFullMenu()) as SquareItem[];
  const combos = menu.filter((item) => /^combo\s/i.test(item.name));
  if (!combos.length) throw new Error("Square returned no COMBO items (catalog read failed?)");
  return combos;
}

export function findSquareItem(combos: SquareItem[], rule: ComboRuleRow) {
  return combos.find((c) => rule.squareItemId && c.squareCatalogObjectId === rule.squareItemId)
    || combos.find((c) => norm(c.name) === norm(rule.squareItem));
}

export function money(cents: number) {
  return `${cents < 0 ? "-" : "+"}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// cocinaelvis.com storefront (Square Online). Public, read-only product API used by the site itself.
export const STOREFRONT = {
  base: "https://www.cocinaelvis.com/app/store/api/v28/editor/users/129352762/sites/426206690500291198/products",
};

export type StoreGroup = {
  squareListId: string;
  name: string;
  min: number;
  /** null = no limit */
  max: number | null;
  hidden: boolean;
  choices: Array<{ squareId: string; name: string; priceCents: number; preselected: boolean; hidden: boolean; soldOut: boolean }>;
};
export type StoreItem = { squareItemId: string; name: string; visibility: string; priceCents: number; groups: StoreGroup[] };

export async function loadStorefrontCombos(): Promise<StoreItem[]> {
  const out: StoreItem[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await fetch(`${STOREFRONT.base}?per_page=100&page=${page}&include=modifiers`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`storefront ${res.status}`);
    const json: any = await res.json();
    for (const p of json.data || []) {
      if (!/^combo\s/i.test(p.name) || !/\(online\)/i.test(p.name)) continue;
      out.push({
        squareItemId: p.square_id,
        name: String(p.name).replace(/\s*\(online\)\s*/i, "").trim(),
        visibility: p.visibility,
        priceCents: Math.round(Number(p.price?.low ?? p.price?.regular_low ?? 0) * 100),
        groups: (p.modifiers?.data || [])
          .sort((a: any, b: any) => a.display_order - b.display_order)
          .map((m: any) => ({
            squareListId: m.modifier_set_id || m.square_id,
            name: m.name,
            min: Number(m.min_selected ?? 0),
            max: Number(m.max_selected ?? 0) === 0 ? null : Number(m.max_selected),
            hidden: Boolean(m.hidden_from_customer),
            choices: (m.choices || []).map((c: any) => ({
              squareId: c.square_id, name: c.name, priceCents: Math.round(Number(c.price || 0) * 100),
              preselected: Boolean(c.selected_by_default), hidden: Boolean(c.hidden), soldOut: Boolean(c.sold_out)
            }))
          }))
      });
    }
    if (!json.meta?.pagination?.links?.next) break;
  }
  return out;
}
