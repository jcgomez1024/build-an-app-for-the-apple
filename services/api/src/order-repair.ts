// chalino1 (CAe85a692542519dbf86de4d11c3304029, Oct 30 6:54 PM ET, Chalino, Spanish delivery, staff-answered):
// "unas dos tortas de bistec" + "sin queso" + taco de comal de carnitas + "unas dos sodas… de lata". The shadow rang a phantom
// 2 Chilaquiles ("me llama mucho el heno"), 1→2 Queso Torta bistec+carnitas (the taco's "de carnitas" merged in), and no sodas.
const plain = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const numOf = (w: string) => Number(w) || NUM[w] || 0;
type Turn = { speaker: string; text: string };
const stem = (w: string) => w.replace(/(es|s)$/, "").slice(0, 6);
const STOP = new Set(["with", "options", "option", "orden", "order", "plato", "extra", "salsa", "preferencia", "preference"]);
const isDrink = (i: any) => /^sq-drink-/.test(String(i?.id)) || /drink|bebida/i.test(String(i?.category || ""));

/** A dish whose name, aliases and chosen options are never said in any turn is a mishear — drop it. */
export function dropUnsaidDishes(cart: any[], turns: Turn[], menu: any[]): boolean {
  const said = new Set(plain(turns.map((t) => t.text).join(" ")).split(" ").map(stem));
  let changed = false;
  for (let i = cart.length - 1; i >= 0; i--) {
    const item = menu.find((m) => m.id === cart[i].itemId);
    if (!item || isDrink(item) || /^sq-extras-/.test(item.id)) continue;
    const texts = [item.name, item.nameEs, ...(item.aliases || []), ...(cart[i].modifiers || []).map((m: any) => m.option)];
    const words = plain(texts.filter(Boolean).join(" ")).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
    if (words.length && !words.some((w) => said.has(stem(w)))) { cart.splice(i, 1); changed = true; }
  }
  return changed;
}

const dishLine = (cart: any[], menu: any[], dish: string) => {
  const d = stem(dish);
  return cart.filter((l) => { const it = menu.find((m) => m.id === l.itemId); return it && !isDrink(it) && plain(it.name).split(" ").some((w) => stem(w) === d); });
};
const groupsOf = (menu: any[], itemId: string) => (menu.find((m) => m.id === itemId)?.modifierGroups || []) as any[];
const optName = (o: any) => (typeof o === "string" ? o : o?.name);

/** Caller "N <dish>s de <meat>" (+ "sin queso" for that dish) → that line: quantity N, only that meat, no cheese. */
export function applyCountedDishMeat(cart: any[], turns: Turn[], menu: any[]): boolean {
  let changed = false;
  const ts = turns.map((t) => ({ speaker: t.speaker, p: plain(t.text) }));
  ts.forEach((t, ti) => {
    if (t.speaker !== "caller") return;
    for (const m of t.p.matchAll(/\b(\d+|dos|tres|cuatro|cinco|seis|two|three|four|five|six)\s+([a-z]{4,}s)\s+de\s+([a-z]{4,})\b/g)) {
      const n = numOf(m[1]); const lines = dishLine(cart, menu, m[2]);
      if (n < 2 || lines.length !== 1) continue;
      const l = lines[0]; const gs = groupsOf(menu, l.itemId);
      const mg = gs.find((g) => /carne|meat/i.test(g.name) && !/combo/i.test(g.name));
      const meat = mg && (mg.options || []).map(optName).find((o: string) => plain(o).split(" ").some((x) => x.length >= 4 && stem(x) === stem(m[3])));
      if (!meat) continue;
      if (l.quantity !== n) { l.quantity = n; changed = true; }
      const others = (l.modifiers || []).filter((x: any) => x.step === mg.name && x.option !== meat);
      if (others.length || !(l.modifiers || []).some((x: any) => x.option === meat)) {
        l.modifiers = [...(l.modifiers || []).filter((x: any) => x.step !== mg.name), { step: mg.name, option: meat }]; changed = true;
      }
      // "sin queso" in this turn or the caller's answer to staff "¿con queso o sin queso?" within the next 3 turns
      const sin = /\bsin queso\b/.test(t.p.slice(m.index)) || ts.slice(ti + 1, ti + 4).some((x) => x.speaker === "caller" && /^(?:\w+ )?sin queso\b/.test(x.p));
      if (sin && noCheese(l, gs)) changed = true;
    }
  });
  return changed;
}
/** "Sin queso" removes cheese, never adds it: a single-choice cheese/no-cheese group flips to its plain option; cheese add-ons go. */
export function noCheese(l: any, gs: any[]): boolean {
  let changed = false; const out: any[] = [];
  for (const x of l.modifiers || []) {
    if (!/queso|cheese/i.test(x.option) || /carne|meat/i.test(x.step)) { out.push(x); continue; }
    const g = gs.find((g) => g.name === x.step);
    const plainOpt = (g?.options || []).map(optName).find((o: string) => !/queso|cheese/i.test(o));
    if (g && plainOpt && !/con \/|with|extra/i.test(g.name + " " + x.option)) out.push({ ...x, option: plainOpt });
    changed = true;
  }
  if (changed) l.modifiers = out;
  return changed;
}

/** "unas dos sodas" / "dos de lata" with no drink rung → N canned sodas (flavor not said: note for staff). */
export function ringUnnamedSodas(cart: any[], turns: Turn[], menu: any[]): boolean {
  if (cart.some((l) => isDrink(menu.find((m) => m.id === l.itemId)))) return false;
  const caller = plain(turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" "));
  const ns = [...caller.matchAll(/\b(\d+|un[ao]?|dos|tres|cuatro|cinco|seis|one|two|three|four|a)\s+(?:sodas?|refrescos?|sodas? de lata|de lata|latas?|cans?(?: of soda)?|pops?)\b/g)].map((m) => numOf(m[1]) || 1);
  if (!ns.length) return false;
  const soda = menu.find((m) => /^sq-drink-coca-cola-/.test(m.id)) || menu.find((m) => isDrink(m) && /coca|pepsi|sprite/i.test(m.name));
  if (!soda) return false;
  const lata = /\blatas?\b|\bcans?\b/.test(caller);
  const person = [...cart].reverse().find((l) => l.person)?.person;
  cart.push({ itemId: soda.id, quantity: Math.max(...ns), modifiers: [], elviNotes: [lata ? "soda de lata, sabor no dicho — confirmar" : "soda, sabor no dicho — confirmar"], ...(person ? { person } : {}) });
  return true;
}
