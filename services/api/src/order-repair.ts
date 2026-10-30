import { staffUnavailable, isAvailQ } from "./spoken-ledger.js";
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

// nicky1 (CA59b9358c1de5beb6d29ecfed4f6f7269, Oct 30 7:08 PM ET): STT "chila rellenos" → the model rang a Burrito, quoted
// Enchiladas, and the cart ended with only a side of rice and beans (the platillo's own sides).
export const RELLENO_RE = /\bchil(?:e|i|a|ie)s?\s+rellen[oa]s?\b|\bstuffed\s+(?:poblano\s+)?peppers?\b|\bstuffed\s+poblanos?\b/;
export const normalizeRelleno = (t: string) => String(t || "").replace(/\bchil(?:e|i|a|ie)s?\s+rellen[oa]s?\b/gi, "chiles rellenos").replace(/\bstuffed\s+(?:poblano\s+)?peppers?\b|\bstuffed\s+poblanos?\b/gi, "chiles rellenos");
export const rellenoItem = (menu: any[]) => (menu || []).find((m) => /^sq-chiles-rellenos-platillo/.test(String(m?.id))) || (menu || []).find((m) => /stuffed poblano/i.test(String(m?.name)) && !/extra/i.test(String(m?.name)));
/** Side and tortilla options the caller said for the relleno platillo (catalog option names). */
export function rellenoMods(text: string, item: any): any[] {
  const p = plain(text); const gs: any[] = item?.modifierGroups || []; const out: any[] = [];
  const pick = (gre: RegExp, ore: RegExp) => { const g = gs.find((g) => gre.test(g.name)); const o = g && (g.options || []).map(optName).find((o: string) => ore.test(o)); if (o) out.push({ step: g.name, option: o }); };
  const tipo = gs.find((g) => /tipo/i.test(g.name)); if (tipo && (tipo.options || []).length === 1) out.push({ step: tipo.name, option: optName(tipo.options[0]) });
  if (/\b(only|just|solo|nomas|puro) (rice|arroz)\b/.test(p)) pick(/lado|side/i, /only rice|solo arroz/i);
  else if (/\b(only|just|solo|nomas|puro)s? (beans|frijoles)\b/.test(p)) pick(/lado|side/i, /only beans|solo frijoles/i);
  else if (/\b(rice|arroz)\b/.test(p) && /\b(beans?|frijol(es)?)\b/.test(p)) pick(/lado|side/i, /^arroz.*frijol/i);
  if (/\b(corn|maiz)\b/.test(p)) pick(/^\(C\) Tortilla/i, /corn/i);
  else if (/\b(flour|harina)\b/.test(p)) pick(/^\(C\) Tortilla/i, /flour|harina/i);
  return out;
}
const isSidesRiceBeans = (l: any, menu: any[]) => { const it = menu.find((m) => m.id === l.itemId); return /^sq-sides-/.test(String(l.itemId)) && /arroz|rice|frijol|beans/i.test(`${it?.name} ${(l.modifiers || []).map((m: any) => m.option).join(" ")} ${l.itemId}`); };
/** Caller named chiles rellenos → exactly that platillo is rung (with its said side/tortilla); the platillo's rice-and-beans
 *  never also rings as a Sides line, and a Burrito/Enchilada the caller never named goes. */
export function applyRellenoOrder(cart: any[], turns: Turn[], menu: any[]): boolean {
  const callerTs = turns.filter((t) => t.speaker === "caller").map((t) => normalizeRelleno(plain(t.text)));
  const blob = callerTs.join(" ");
  const rel = rellenoItem(menu);
  if (!rel || !RELLENO_RE.test(blob.replace(/chiles rellenos/g, "chile relleno"))) return false;
  let changed = false;
  for (let i = cart.length - 1; i >= 0; i--) {
    const id = String(cart[i].itemId);
    if ((/burrito/.test(id) && !/\bburritos?\b/.test(blob)) || (/enchilada/.test(id) && !/\benchiladas?\b/.test(blob))) { cart.splice(i, 1); changed = true; }
  }
  let line = cart.find((l) => l.itemId === rel.id);
  const mods = rellenoMods(blob, rel);
  if (!line) {
    const m = blob.match(/\b(\d+|dos|tres|cuatro|two|three|four)\s+(?:orders? of |ordenes de |)chiles rellenos/);
    const person = [...cart].reverse().find((l) => l.person)?.person;
    line = { itemId: rel.id, quantity: m ? numOf(m[1]) || 1 : 1, modifiers: mods, ...(person ? { person } : {}) }; cart.push(line); changed = true;
  } else for (const x of mods) if (!(line.modifiers || []).some((y: any) => y.step === x.step)) { line.modifiers = [...(line.modifiers || []), x]; changed = true; }
  const ownSides = (line.modifiers || []).some((x: any) => /lado|side/i.test(x.step)) || /\bon the side\b|\bde lado\b/.test(blob);
  const extraSide = /\b(extra|another|separate|aparte|additional) (side|order) of (rice|beans)|\b(extra|otra orden de) (arroz|frijoles)\b|\bside of rice and beans too\b/.test(blob);
  if (ownSides && !extraSide) for (let i = cart.length - 1; i >= 0; i--) if (isSidesRiceBeans(cart[i], menu)) { cart.splice(i, 1); changed = true; }
  return changed;
}

// cafa1 (CAaf4f6793b63b50b32e85935eed78f077, Oct 30 7:06 PM ET): "una quesadilla de bistec preparada… en aceite" rang the QD
// right, and the style question left a meatless Quesadilla Taquera "confirmar (B) Q Carnes". A line whose meat was never set
// (from a style/clarification question) is dropped when another line of the same dish family already carries a meat.
export function dropMeatlessDup(cart: any[], menu: any[]): boolean {
  let changed = false;
  const fam = (l: any) => plain(menu.find((m) => m.id === l.itemId)?.name || String(l.itemId).replace(/^sq-|-[A-Z0-9]{6}$/g, "").replace(/-/g, " ")).split(" ").filter((w) => w.length >= 4 && !/^q[a-z]?$/.test(w)).map(stem);
  const meatOf = (l: any) => { const g = groupsOf(menu, l.itemId).find((g) => /carne|meat/i.test(g.name) && !/combo|extra/i.test(g.name)); return g ? { g, has: (l.modifiers || []).some((x: any) => x.step === g.name) } : null; };
  for (let i = cart.length - 1; i >= 0; i--) {
    const l = cart[i]; const m = meatOf(l);
    if (!m || m.has || !(l.elviNotes || []).some((n: string) => /confirmar.*(carne|meat)/i.test(n))) continue;
    const f = new Set(fam(l));
    const twin = cart.some((o, j) => j !== i && fam(o).some((w) => f.has(w)) && (meatOf(o)?.has || (o.modifiers || []).some((x: any) => /carne|meat/i.test(x.step))));
    if (twin) { cart.splice(i, 1); changed = true; }
  }
  return changed;
}
/** Caller asked for salsa de árbol: set it where the catalog has it, else a staff note on each line's salsa (no árbol in catalog). */
export function applyArbolSalsa(cart: any[], turns: Turn[], menu: any[]): boolean {
  if (!turns.some((t) => t.speaker === "caller" && /\barbol\b/.test(plain(t.text)))) return false;
  let changed = false;
  for (const l of cart) {
    const g = groupsOf(menu, l.itemId).find((g) => /salsa/i.test(g.name) && !/extra|side/i.test(g.name));
    if (!g) continue;
    const arbol = (g.options || []).map(optName).find((o: string) => /arbol/i.test(plain(o)));
    if (arbol) { l.modifiers = [...(l.modifiers || []).filter((x: any) => x.step !== g.name), { step: g.name, option: arbol }]; changed = true; }
    else if (!(l.elviNotes || []).some((n: string) => /arbol|árbol/i.test(n))) { l.elviNotes = [...(l.elviNotes || []), "salsa de árbol"]; changed = true; }
  }
  return changed;
}

// cmissing1 (CA8e3de9a540a201d103dfe502e5df4aa2, Oct 30 7:26 PM ET): staff "Not today." to "how about ceviche?" and the
// asked-dish pass still rang a Ceviche. A dish staff said is unavailable never stays in the cart unless the caller ordered it
// again after that answer.
export function dropStaffUnavailable(cart: any[], turns: Turn[]): boolean {
  const off = staffUnavailable(turns as any);
  if (!off.length) return false;
  let changed = false;
  for (let i = cart.length - 1; i >= 0; i--) {
    const id = String(cart[i].itemId || "").toLowerCase();
    const d = off.find((d) => id.includes(d.replace(/\s+/g, "-")));
    if (!d) continue;
    const reordered = turns.some((t) => t.speaker === "caller" && plain(t.text).includes(d) && !isAvailQ(t.text)); // "Sí, el pozole rojo, por favor"
    if (!reordered) { cart.splice(i, 1); changed = true; }
  }
  return changed;
}
