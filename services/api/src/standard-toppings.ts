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

// rice1: "con arroz" / "with rice" / "arrocito" / "<meat> and rice" on an item that has the "(C) Con / With" add-on
// "**Con Arroz / With Rice" (+$0.50 in Square) = that add-on, not "Arroz / Rice" as a filling. Rice stays a filling
// only when it's the sole filling ("quesadilla de arroz", "solo arroz").
const plainOpt = (s: string) => norm(String(s || "").replace(/\(\+?\$[^)]*\)/g, "").replace(/\*+/g, ""));
const RICE_SAID = /\b(?:con\s+arroz|with\s+rice|and\s+rice|y\s+arroz|con\s+arrocito|arrocito|plus\s+rice|add\s+rice)\b/;
const RICE_ONLY = /\b(?:solo\s+(?:de\s+)?arroz|only\s+rice|just\s+rice|(?:quesadillas?|tacos?|gorditas?|tortas?)\s+de\s+arroz)\b/;
export function withRiceAddon<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text: string): T[] {
  const said = norm(text);
  if (!Array.isArray(actions) || !RICE_SAID.test(said) || RICE_ONLY.test(said)) return actions;
  return actions.map((a: any) => {
    if (a?.type !== "add_item" && a?.type !== "update_item") return a;
    const item = (menu || []).find((m: any) => m.id === a.itemId);
    let addon: any = null, group: any = null;
    for (const g of item?.modifierGroups || []) for (const o of g.options || []) { const n = typeof o === "string" ? o : o.name; if (/^con arroz \/ with rice$/.test(plainOpt(n))) { addon = typeof o === "string" ? { name: o } : o; group = g; } }
    if (!addon) return a;
    const mods = [...(a.modifiers || [])];
    const isRiceFilling = (m: any) => /^(?:arroz \/ rice|1 x arroz \/ rice)$/.test(plainOpt(m.option));
    const otherFilling = mods.some((m) => !isRiceFilling(m) && m.option !== addon.name && !/salsa|tortilla|comal|harina|maiz|corn|flour|homemade|regular|deluxe|dorada/i.test(plainOpt(m.option)) && !/con \/ with|salsa|topping/i.test(String(m.step || m.groupName || "")));
    const kept = otherFilling ? mods.filter((m) => !isRiceFilling(m)) : mods;
    if (!kept.some((m) => m.option === addon.name)) kept.push(a.type === "add_item" && a.modifiers?.[0]?.groupId ? { groupId: group.id, groupName: group.name, option: addon.name, optionId: addon.id, priceDeltaCents: Number(addon.priceDeltaCents || 0), quantity: 1 } : { step: group.name, option: addon.name });
    return { ...a, modifiers: kept };
  });
}
