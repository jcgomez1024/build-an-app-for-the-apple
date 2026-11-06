// sopesaso1 (Carlos): "con todo" = the item's standard (included) toppings. Square's catalog marks no topping as
// on-by-default for these, so the house standard lives here; otherwise any free, non-DOUBLE option preselected in a
// toppings group counts. Included toppings are part of the dish in Elvi's cart, the score and the auditor.
import { cachedPosCatalog, type PosCatalog } from "./pos-catalog.js";
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
export const HOUSE_STANDARD: Array<{ item: RegExp; toppings: string[] }> = [
  { item: /\bsopes(?:aso|azo)?s?\s+elvis\b|\bsopes(?:aso|azo)\b|\b[hg]uaraches?\b/i, // sopesize1: huarache = same (Carlos)
    toppings: ["Frijoles / Pinto Beans", "Lechuga / Lettuce", "Crema / Sour Cream", "Queso Fresco / Fresco Cheese"] },
];
const TOPPING_GROUP = /topping/i;
type Group = { name: string; options?: Array<{ name: string; priceDeltaCents?: number; priceCents?: number; preselected?: boolean } | string> };
/** Standard toppings for an item (house table first, else catalog-preselected free toppings). */
export function standardToppings(itemName: string, groups: Group[] = []): string[] {
  const house = HOUSE_STANDARD.find((h) => h.item.test(String(itemName || "")));
  if (house) return house.toppings;
  const out: string[] = [];
  for (const g of groups) if (TOPPING_GROUP.test(g.name)) for (const o of g.options || []) {
    if (typeof o === "string") continue;
    if (o.preselected && !/^\W*double\b/i.test(o.name) && !(Number(o.priceDeltaCents ?? o.priceCents) > 0)) out.push(o.name);
  }
  return out;
}
export const isStandardTopping = (itemName: string, choice: string, groups: Group[] = []) => standardToppings(itemName, groups).some((t) => norm(t) === norm(choice));
const CON_TODO = /\b(con\s+todo|con\s+de\s+todo|with\s+everything|everything\s+on\s+it|the\s+works)\b/;
const KEY = (t: string) => norm(t.split("/")[0]).replace(/^queso fresco$/, "queso fresco");
/** Toppings negated in the sentence ("con todo sin crema"). */
function negated(said: string, toppings: string[]) {
  return toppings.filter((t) => { const es = KEY(t), en = norm(t.split("/")[1] || "");
    return new RegExp(`\\b(?:sin|no|without|but\\s+no|menos|hold\\s+the)\\s+(?:(?:el|la|los|las|the|de)\\s+)?(?:${es}${en ? `|${en}` : ""})`).test(said); });
}
/** Enchiladas "con todo" = the included $0 toppings (lechuga, cebolla, jitomate, crema, queso fresco).
 *  "Enchiladas rojas" is the dish, not a paid salsa cup. Not applied by withIncludedToppings. */
export const ENCHILADA_CON_TODO: Array<{ key: RegExp; name: string }> = [
  { key: /\blechuga\b|\blettuce\b/, name: "Lechuga / Lettuce" },
  { key: /\bcebolla\b|\bonion\b/, name: "Cebolla / Onion" },
  { key: /\bjitomate\b|\btomate\b|\btomato\b/, name: "Jitomate / Tomato" },
  { key: /\bcrema\b|\bsour cream\b/, name: "Crema / Sour Cream" },
  { key: /\bqueso fresco\b|\bfresco cheese\b/, name: "Queso Fresco / Fresco Cheese" },
];
const ENCHILADA_ITEM = /enchilad/i;
const EXPLICIT_SALSA = /\bsalsa\s+(?:roja|verde|asada|picante|hot|mild|tomato|tomate)\b|\b(?:extra|aparte|vasito|side\s+of)\b[^.?!]{0,24}\bsalsa\b|\bsalsa\b[^.?!]{0,24}\b(?:extra|aparte|2\s*oz|4\s*oz)\b/;
const optPrice = (o: any) => (typeof o === "object" && o ? Number(o.priceDeltaCents ?? o.priceCents) || 0 : 0);
const optLabel = (o: any) => String(typeof o === "string" ? o : o?.name || "");
const PREFERENCE_SALSA = /^(?:mild salsa asada|mild salsa tomato|medium salsa verde|hot salsa roja)$/;
/** A salsa the caller did not name. "Con todo" is the included toppings, never a salsa preference
 *  and never a paid cup. The silent Mild Salsa Asada default stays on an enchilada that was not "con todo"
 *  and did not name another salsa. A named salsa ("salsa roja aparte", "salsa verde") stays. */
export function unaskedEnchiladaSalsa(option: string, text: string): boolean {
  const said = norm(text), n = norm(option);
  if (!n || EXPLICIT_SALSA.test(said)) return false;
  const paidSalsa = /\bextra\b/.test(n) && /\bsalsa\b/.test(n);
  const fromRojas = /\bsalsa roja\b/.test(n) && /\benchiladas?\s+roj/.test(said);
  const preference = PREFERENCE_SALSA.test(n);
  if (paidSalsa || fromRojas) return true;
  if (!preference) return false;
  if (CON_TODO.test(said)) return true;
  return n !== "mild salsa asada";
}
function enchiladaItem(item: any): boolean {
  return ENCHILADA_ITEM.test(`${item?.name || ""} ${item?.id || ""}`);
}
const SALSA_GROUP = /salsa/i;
/** Free topping option. A salsa preference that shares a word ("Mild Salsa Tomato" vs jitomate) is not a topping. */
function freeEnchiladaTopping(item: any, rule: typeof ENCHILADA_CON_TODO[number]): { step: string; option: string } | null {
  for (const g of item?.modifierGroups || []) {
    if (SALSA_GROUP.test(String(g?.name || ""))) continue;
    for (const o of g.options || []) {
      const name = optLabel(o), n = norm(name);
      if (/\bsalsa\b/.test(n) || !rule.key.test(n) || optPrice(o) > 0 || /\bextra\b|\bdouble\b|\bdoble\b|\(\+\$/.test(n)) continue;
      return { step: g.name, option: name };
    }
  }
  return null;
}
/** The item's modifier groups include every free con-todo topping (lechuga, cebolla, jitomate, crema, queso fresco). */
export function expressesEnchiladaConTodo(item: any): boolean {
  return enchiladaItem(item) && ENCHILADA_CON_TODO.every((rule) => freeEnchiladaTopping(item, rule));
}
const hasFreeTopping = (mods: any[], rule: typeof ENCHILADA_CON_TODO[number]) => (mods || []).some((m) => {
  const n = norm(String(m?.option || ""));
  return !/\bsalsa\b/.test(n) && rule.key.test(n) && !/\bextra\b|\bdouble\b|\bdoble\b/.test(n);
});
/** Counter enchilada toppings from the POS catalog (the auditor cache), not from the website menu.
 *  The phone menu only has the ONLINE orden, which has salsa and no (F) group. A salsa named "Tomato"
 *  is never used as jitomate. Returns null when the catalog has no enchilada with all five free toppings. */
export function posEnchiladaConTodo(cat: PosCatalog | null): Array<{ step: string; option: string }> | null {
  if (!cat) return null;
  const items = cat.items.filter((i) => /enchilad/i.test(i.name))
    .sort((a, b) => Number(/\bonline\b/i.test(a.name)) - Number(/\bonline\b/i.test(b.name)));
  for (const item of items) {
    const groups = item.modifierListIds.map((id) => cat.modifierLists[id]).filter(Boolean);
    const picks: Array<{ step: string; option: string }> = [];
    let ok = true;
    for (const rule of ENCHILADA_CON_TODO) {
      let hit: { step: string; option: string } | null = null;
      for (const g of groups) {
        if (/salsa/i.test(g.name)) continue;
        for (const m of g.modifiers) {
          const n = norm(m.name);
          if (m.priceCents > 0 || /\bextra\b|\bdouble\b|\bdoble\b|\bsalsa\b/.test(n) || !rule.key.test(n)) continue;
          hit = { step: g.name, option: m.name };
          break;
        }
        if (hit) break;
      }
      if (!hit) { ok = false; break; }
      picks.push(hit);
    }
    if (ok) return picks;
  }
  return null;
}
/** Toppings still missing on a con-todo enchilada, copied from the POS catalog's real option names. */
export function catalogEnchiladaConTodoMods(mods: any[], text: string, cat: PosCatalog | null = cachedPosCatalog()): Array<{ step: string; option: string }> | null {
  if (!CON_TODO.test(norm(text))) return null;
  const need = ENCHILADA_CON_TODO.filter((rule) => !hasFreeTopping(mods, rule));
  if (!need.length) return null;
  const picks = posEnchiladaConTodo(cat);
  if (!picks) return null;
  const add = picks.filter((p) => need.some((rule) => rule.key.test(norm(p.option)) && !hasFreeTopping(mods, rule)));
  return add.length ? add : null;
}
const FILL_STEM: Array<[RegExp, string]> = [[/^queso\b/, "queso"], [/^papas?\b/, "papa"], [/^frijol/, "frijol"], [/^pollo\b|^chicken\b/, "pollo"], [/^prensad/, "prensado"]];
function fillingStem(option: string): string | null {
  const n = norm(option).split("/")[0].trim().replace(/^\d+\s*x?\s*/, "");
  if (/queso fresco|fresco cheese/.test(n) || /\bsalsa\b/.test(n)) return null;
  return FILL_STEM.find(([re]) => re.test(n))?.[1] || null;
}
function enchiladaNoteCount(notes: string[] | undefined, stem: string): number | null {
  const note = (notes || []).map(String).find((n) => /^enchiladas:/.test(n));
  if (!note) return null;
  const m = note.match(new RegExp(`\\b(\\d+)\\s+${stem}\\b`));
  return m ? Number(m[1]) : null;
}
/** A real catalog option for this filling. A count-list option ("3 Queso") is used only when the note asked for that count. */
function pickFillingOption(item: any, stem: string, count: number | null): { step: string; option: string } | null {
  const hits: Array<{ step: string; option: string; n: number | null }> = [];
  for (const g of item?.modifierGroups || []) {
    if (SALSA_GROUP.test(String(g?.name || "")) || /topping|extra|mas opciones|agua/i.test(String(g?.name || ""))) continue;
    for (const o of g.options || []) {
      const name = optLabel(o);
      if (fillingStem(name) !== stem || optPrice(o) > 0 || /\bextra\b/i.test(name)) continue;
      const lead = name.match(/^\s*(\d+)\s*x?\s*/i);
      hits.push({ step: g.name, option: name, n: lead ? Number(lead[1]) : null });
    }
  }
  if (!hits.length) return null;
  if (count != null) { const exact = hits.find((h) => h.n === count); if (exact) return exact; }
  return hits.find((h) => h.n == null) || null;
}
/**
 * "Con todo" needs the free toppings. The ONLINE enchilada item has carne + salsa and no topping group, so
 * Mild Salsa Tomato must not stand in for jitomate. When another enchilada item on this menu actually has
 * the five free toppings, that item is the one that can say them. No switch when this item already can,
 * when a salsa was named, or when the other item cannot carry the fillings. Never invents a modifier.
 */
export function withEnchiladaConTodoHost<T extends { itemId?: string; modifiers?: any[]; elviNotes?: string[] }>(row: T, menu: any[], text: string): T {
  const said = norm(text);
  if (!CON_TODO.test(said) || EXPLICIT_SALSA.test(said)) return row;
  const item = (menu || []).find((m: any) => m?.id === row?.itemId);
  if (!enchiladaItem(item) || expressesEnchiladaConTodo(item)) return row;
  const host = (menu || []).find((m: any) => m && m.id !== item.id && expressesEnchiladaConTodo(m));
  if (!host) return row;
  const placed: any[] = [];
  for (const m of row.modifiers || []) {
    const stem = fillingStem(String(m?.option || ""));
    if (!stem) continue;
    const pick = pickFillingOption(host, stem, enchiladaNoteCount(row.elviNotes, stem));
    if (!pick) return row;
    placed.push({ ...m, step: pick.step, option: pick.option });
  }
  const kept = (row.modifiers || []).filter((m) => !fillingStem(String(m?.option || "")) && hostHas(host, String(m?.option || "")));
  return { ...row, itemId: host.id, modifiers: [...placed, ...kept.map((m) => ({ ...m, step: hostStep(host, String(m.option)), option: hostName(host, String(m.option)) }))] };
}
function hostHas(item: any, option: string): boolean {
  return hostName(item, option) !== "";
}
function hostName(item: any, option: string): string {
  const want = norm(option);
  for (const g of item?.modifierGroups || []) for (const o of g.options || []) {
    const name = optLabel(o);
    if (norm(name) === want && !(optPrice(o) > 0)) return name;
  }
  return "";
}
function hostStep(item: any, option: string): string {
  const want = norm(option);
  for (const g of item?.modifierGroups || []) for (const o of g.options || []) if (norm(optLabel(o)) === want) return g.name;
  return "";
}
/** On an enchilada line: drop unasked salsa, and on "con todo" add the free standard toppings the item actually has. */
export function fixEnchiladaSpokenMods(mods: any[], item: any, text: string): any[] | null {
  if (!enchiladaItem(item)) return null;
  const said = norm(text);
  const conTodo = CON_TODO.test(said);
  const rojas = /\benchiladas?\s+roj/.test(said);
  let next = [...(mods || [])];
  const before = next.length;
  next = next.filter((m) => !unaskedEnchiladaSalsa(String(m?.option || ""), text));
  // "con todo" is the included toppings, not a paid (C) EXTRAS crema/queso the model guessed from those words.
  if (conTodo) next = next.filter((m) => {
    const n = norm(String(m?.option || ""));
    if (!/\bextra\b/.test(n)) return true;
    if (EXPLICIT_SALSA.test(said) && /\bsalsa\b/.test(n)) return true;
    return !ENCHILADA_CON_TODO.some((r) => r.key.test(n));
  });
  let changed = next.length !== before;
  if (!conTodo && !rojas && !changed) return null;
  if (conTodo) for (const rule of ENCHILADA_CON_TODO) {
    if (negated(said, [rule.name]).length) continue;
    if (next.some((m) => {
      const n = norm(String(m?.option || ""));
      return !/\bsalsa\b/.test(n) && rule.key.test(n) && !/\bextra\b|\bdouble\b/.test(n);
    })) continue;
    const pick = freeEnchiladaTopping(item, rule);
    if (!pick) continue;
    next.push(pick); changed = true;
  }
  return changed ? next : null;
}
export function fixEnchiladaSpoken<T extends { type: string; itemId?: string; modifiers?: any[]; elviNotes?: string[] }>(actions: T[], menu: any[], text: string): T[] {
  if (!Array.isArray(actions)) return actions;
  return actions.map((a: any) => {
    if (a?.type !== "add_item" && a?.type !== "update_item") return a;
    const row = withEnchiladaConTodoHost(a, menu, text);
    const item = (menu || []).find((m: any) => m.id === row.itemId);
    const mods = fixEnchiladaSpokenMods(row.modifiers, item, text);
    if (row.itemId === a.itemId && !mods) return a;
    return { ...row, modifiers: mods || row.modifiers };
  });
}
/** Elvi actions: on "con todo", add the standard toppings to the dish (minus "sin X"). */
export function withConTodo<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text: string): T[] {
  const said = norm(text);
  if (!CON_TODO.test(said) || !Array.isArray(actions)) return fixEnchiladaSpoken(actions, menu, text);
  const topped = actions.map((a: any) => {
    if (a?.type !== "add_item" && a?.type !== "update_item") return a;
    const item = (menu || []).find((m: any) => m.id === a.itemId);
    const group = (item?.modifierGroups || []).find((g: any) => TOPPING_GROUP.test(g.name));
    if (!item || !group) return a;
    const std = standardToppings(item.name, item.modifierGroups || []);
    if (!std.length) return a;
    const skip = negated(said, std);
    const mods = [...(a.modifiers || [])];
    for (const t of std) if (!skip.includes(t) && !mods.some((m: any) => norm(m.option) === norm(t))) {
      const opt = (group.options || []).find((o: any) => norm(typeof o === "string" ? o : o.name) === norm(t));
      if (opt) mods.push({ step: group.name, option: typeof opt === "string" ? opt : opt.name });
    }
    return { ...a, modifiers: mods };
  });
  return fixEnchiladaSpoken(topped, menu, text);
}
/** Score/auditor lines: a dish with standard toppings and no topping choices at all comes with them (included). */
export function withIncludedToppings<L extends { name: string; baseName?: string; choices?: string[] }>(l: L): L {
  const std = standardToppings(l.baseName || l.name);
  if (!std.length) return l;
  const ch = l.choices || [];
  const anyTopping = ch.some((c) => std.some((t) => norm(t) === norm(c)) || /^double\b/i.test(norm(c)));
  return anyTopping ? l : { ...l, choices: [...ch, ...std] };
}

// rice1 + addons1 (Carlos): on items with the "(C) Con / With" group (Gordita, Gordita de Aceite, Taco, Quesadilla,
// QD Regular/Deluxe, Torta) these spoken asks are the paid Square add-ons (+$0.50 each), not a free filling:
//   con arroz → **Con Arroz / With Rice · con frijoles → **Con Frijoles / With Beans
//   con queso fresco → **Con Queso Fresco / With Cheese · extra queso derretido → **EXTRA Queso Derretido / Melted Cheese
// Exceptions: the ingredient is the sole filling ("quesadilla de frijoles", "solo arroz") → stays the filling; the
// item already includes it (sopesaso/huarache con todo; QD DELUXE Preparada includes queso fresco) → not charged.
export const plainOpt = (s: string) => norm(String(s || "").replace(/\(\+?\$[^)]*\)/g, "").replace(/\*+/g, ""));
const FOODS = "(?:quesadillas?|tacos?|gorditas?|tortas?|doradas?)";
export const CON_ADDONS: Array<{ key: string; addon: RegExp; said: RegExp; only?: RegExp; filling?: RegExp; includedOn?: RegExp }> = [
  { key: "arroz", addon: /^con arroz \/ with rice$/, filling: /^(?:1 x )?arroz \/ rice$/,
    said: /\b(?:con\s+arroz|with\s+rice|and\s+rice|y\s+arroz|con\s+arrocito|arrocito|plus\s+rice|add\s+rice)\b/,
    only: new RegExp(`\\b(?:solo\\s+(?:de\\s+)?arroz|only\\s+rice|just\\s+rice|rice\\s+only|${FOODS}\\s+de\\s+arroz)\\b`) },
  { key: "frijoles", addon: /^con frijoles \/ with beans$/, filling: /^(?:1 x )?frijoles refritos \/ refried beans$/,
    said: /\b(?:con\s+frijol(?:es|itos)?|with\s+beans|and\s+beans|y\s+frijol(?:es|itos)?|plus\s+beans|add\s+beans)\b/,
    only: new RegExp(`\\b(?:solo\\s+(?:de\\s+)?frijol(?:es)?|only\\s+beans|just\\s+beans|beans\\s+only|${FOODS}\\s+de\\s+frijol(?:es)?|bean\\s+${FOODS})\\b`),
    includedOn: /\bsopes(?:aso|azo)?s?\b|\b[hg]uaraches?\b/i },
  { key: "queso fresco", addon: /^con queso fresco \/ with cheese$/,
    said: /\b(?:con\s+queso\s+fresco|with\s+(?:queso\s+fresco|fresco\s+cheese)|and\s+(?:queso\s+fresco|fresco\s+cheese)|y\s+queso\s+fresco|add\s+(?:queso\s+fresco|fresco\s+cheese))\b/,
    includedOn: /\bsopes(?:aso|azo)?s?\b|\b[hg]uaraches?\b|\bdeluxe\b|\bpreparada\b/i },
  { key: "queso derretido", addon: /^extra queso derretido \/ melted cheese$/, filling: /^(?:1 x )?queso derretido \/ melted cheese$/,
    said: /\b(?:extra\s+(?:de\s+)?queso\s+derretido|mas\s+queso\s+derretido|extra\s+melted\s+cheese|more\s+melted\s+cheese|melted\s+cheese\s+extra|queso\s+derretido\s+extra)\b/ },
];
const NON_FILLING = /salsa|tortilla|comal|harina|maiz|corn|flour|homemade|regular|deluxe|dorada|preparada/i;
function withConAddon<T extends { type: string; itemId?: string; modifiers?: any[] }>(rule: typeof CON_ADDONS[number], actions: T[], menu: any[], said: string): T[] {
  if (!rule.said.test(said) || rule.only?.test(said)) return actions;
  return actions.map((a: any) => {
    if (a?.type !== "add_item" && a?.type !== "update_item") return a;
    const item = (menu || []).find((m: any) => m.id === a.itemId);
    let addon: any = null, group: any = null;
    for (const g of item?.modifierGroups || []) for (const o of g.options || []) { const n = typeof o === "string" ? o : o.name; if (rule.addon.test(plainOpt(n))) { addon = typeof o === "string" ? { name: o } : o; group = g; } }
    if (!addon) return a;
    const mods = [...(a.modifiers || [])];
    const label = `${item?.name || ""} ${mods.map((m: any) => m.option).join(" ")}`;
    if (rule.includedOn?.test(label)) return a; // already part of the dish — never charge
    const isFilling = (m: any) => !!rule.filling && rule.filling.test(plainOpt(m.option));
    const otherFilling = mods.some((m) => !isFilling(m) && m.option !== addon.name && !/^\W*(?:con|extra)\b/i.test(plainOpt(m.option)) && !NON_FILLING.test(plainOpt(m.option)) && !/con \/ with|salsa|topping|extra/i.test(String(m.step || m.groupName || "")));
    const kept = otherFilling ? mods.filter((m) => !isFilling(m)) : mods;
    if (rule.filling && !otherFilling && mods.some(isFilling)) return a; // sole filling stays the filling
    if (!kept.some((m) => m.option === addon.name)) kept.push(a.type === "add_item" && a.modifiers?.[0]?.groupId ? { groupId: group.id, groupName: group.name, option: addon.name, optionId: addon.id, priceDeltaCents: Number(addon.priceDeltaCents || 0), quantity: 1 } : { step: group.name, option: addon.name });
    return { ...a, modifiers: kept };
  });
}
/** Auditor: the add-on rule for a Square option name, and whether the call text asked for it. */
export const conAddonRule = (name: string) => CON_ADDONS.find((r) => r.addon.test(plainOpt(name)));
export const conAddonSaid = (text: string, name: string) => { const r = conAddonRule(name); return r ? r.said.test(norm(text)) && !r.only?.test(norm(text)) : null; };
/** All "(C) Con / With" paid add-ons (rice, beans, queso fresco, extra melted cheese). */
export function withConAddons<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text: string): T[] {
  if (!Array.isArray(actions)) return actions;
  const said = norm(text);
  return cheeseByDish(stripUnaskedCheese(CON_ADDONS.reduce((acc, r) => withConAddon(r, acc, menu, said), actions), said), menu, said);
}
/** queso1 (Carlos, Gloria CA8ce342): a quesadilla already has melted cheese inside → plain "con queso" / "queso adentro"
 *  adds no cheese add-on. A taco "con queso" (incl. "queso adentro") is always **Con Queso Fresco sprinkled on top,
 *  never **EXTRA Queso Derretido — that only when they explicitly ask extra/más melted cheese. */
export const TACO_CON_QUESO = /\b(?:con\s+(?:queso|quesito)|queso\s+(?:adentro|dentro|derretido)|with\s+cheese|and\s+cheese)\b/;
export const EXPLICIT_EXTRA_MELTED = /\b(?:extra\s+(?:de\s+)?queso(?:\s+derretido)?|mas\s+queso(?:\s+derretido)?|extra\s+(?:melted\s+)?cheese|more\s+(?:melted\s+)?cheese|queso\s+derretido\s+extra)\b/;
const EXPLICIT_FRESCO = /\b(?:queso\s+fresco|quesito\s+fresco|fresco\s+cheese)\b/;
function cheeseByDish<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], said: string): T[] {
  if (!Array.isArray(actions)) return actions;
  const extra = EXPLICIT_EXTRA_MELTED.test(said), fresco = EXPLICIT_FRESCO.test(said);
  return actions.map((a: any) => {
    if (a?.type !== "add_item" && a?.type !== "update_item") return a;
    const item = (menu || []).find((m: any) => m.id === a.itemId);
    const name = norm(`${item?.name || ""} ${a.itemId || ""}`);
    const mods = [...(a.modifiers || [])];
    const isMelted = (m: any) => /^extra queso derretido \/ melted cheese$/.test(plainOpt(m.option));
    const isFresco = (m: any) => /^con queso fresco \/ with cheese$/.test(plainOpt(m.option));
    if (/quesadilla/.test(name)) {
      const kept = mods.filter((m) => !(isMelted(m) && !extra) && !(isFresco(m) && !fresco));
      // queso1 exception: explicit "extra queso" / "más queso" on a quesadilla = the paid EXTRA Queso Derretido
      if (/\b(?:extra|mas)\s+(?:de\s+)?queso\b/.test(said) && !kept.some(isMelted)) {
        for (const g of item?.modifierGroups || []) for (const o of g.options || []) { const n = typeof o === "string" ? o : o.name;
          if (/^extra queso derretido \/ melted cheese$/.test(plainOpt(n)) && !kept.some(isMelted)) { const oo: any = typeof o === "string" ? { name: o } : o;
            kept.push({ step: g.name, groupId: g.id, groupName: g.name, option: oo.name, optionId: oo.id, priceDeltaCents: Number(oo.priceDeltaCents) || 0 } as any); } }
        return { ...a, modifiers: kept };
      }
      return kept.length === mods.length ? a : { ...a, modifiers: kept };
    }
    if (/\btacos?\b|sq-taco-/.test(name) && !/dorad/.test(name)) {
      let opt: any = null, group: any = null;
      for (const g of item?.modifierGroups || []) for (const o of g.options || []) { const n = typeof o === "string" ? o : o.name; if (/^con queso fresco \/ with cheese$/.test(plainOpt(n))) { opt = typeof o === "string" ? { name: o } : o; group = g; } }
      const hadMelted = mods.some((m) => isMelted(m) && !extra);
      const wants = hadMelted || (TACO_CON_QUESO.test(said) && !extra);
      if (!wants || !opt) return a;
      const kept = mods.filter((m) => !(isMelted(m) && !extra));
      if (!kept.some(isFresco)) kept.push({ step: group?.name, groupId: group?.id, groupName: group?.name, option: opt.name, optionId: opt.id, priceDeltaCents: Number(opt.priceDeltaCents) || 0 });
      return { ...a, modifiers: kept };
    }
    return a;
  });
}
/** appaudit1: "torta de asada con queso fresco" must not also get (QTO) Queso Torta or a Queso Derretido filling.
 *  When every cheese the customer said is queso fresco / extra melted (add-ons), drop those unasked cheese picks. */
const CHEESE_ANY = /\b(?:queso|cheese|quesito)\b/g;
const CHEESE_ADDON_PHRASE = /\b(?:queso\s+fresco|quesito\s+fresco|fresco\s+cheese|(?:extra|mas|more)\s+(?:de\s+)?(?:queso\s+derretido|melted\s+cheese)|queso\s+derretido\s+extra|melted\s+cheese\s+extra)\b/g;
function stripUnaskedCheese<T extends { type: string; modifiers?: any[] }>(actions: T[], said: string): T[] {
  const rest = said.replace(CHEESE_ADDON_PHRASE, " ");
  if (rest === said || CHEESE_ANY.test(rest)) { CHEESE_ANY.lastIndex = 0; return actions; }
  CHEESE_ANY.lastIndex = 0;
  const unasked = (o: string) => /^\((?:qto|qgd)\)\s+queso\s+(?:torta|gordita)$/.test(plainOpt(o)) || /^queso derretido \/ melted cheese$/.test(plainOpt(o));
  return actions.map((a: any) => {
    if ((a?.type !== "add_item" && a?.type !== "update_item") || !(a.modifiers || []).some((m: any) => unasked(m.option))) return a;
    const kept = a.modifiers.filter((m: any) => !unasked(m.option));
    return kept.length ? { ...a, modifiers: kept } : a;
  });
}
/** Back-compat (rice1). */
export function withRiceAddon<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text: string): T[] {
  return Array.isArray(actions) ? withConAddon(CON_ADDONS[0], actions, menu, norm(text)) : actions;
}
