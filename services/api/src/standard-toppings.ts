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
