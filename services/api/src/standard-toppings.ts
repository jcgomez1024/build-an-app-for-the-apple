// sopesaso1 (Carlos): "con todo" = the item's standard (included) toppings. Square's catalog marks no topping as
// on-by-default for these, so the house standard lives here; otherwise any free, non-DOUBLE option preselected in a
// toppings group counts. Included toppings are part of the dish in Elvi's cart, the score and the auditor.
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
/** Elvi actions: on "con todo", add the standard toppings to the dish (minus "sin X"). */
export function withConTodo<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text: string): T[] {
  const said = norm(text);
  if (!CON_TODO.test(said) || !Array.isArray(actions)) return actions;
  return actions.map((a: any) => {
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
  { key: "queso derretido", addon: /^extra queso derretido \/ melted cheese$/,
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
  return CON_ADDONS.reduce((acc, r) => withConAddon(r, acc, menu, said), actions);
}
/** Back-compat (rice1). */
export function withRiceAddon<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text: string): T[] {
  return Array.isArray(actions) ? withConAddon(CON_ADDONS[0], actions, menu, norm(text)) : actions;
}
