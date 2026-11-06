// juan-loose1 (CAe78e2500, Nov 6 ~5:31 PM ET): a pozole Elvi already added was removed on a later
// size answer that did not cancel it, and nothing put the bowl back. "Un plato de arroz" + "chico"
// and "dos tortillas sueltas de comal" never matched an add. A "verdura aparte" said with the tacos
// was copied onto every other food line. Keep an explicitly ordered soup, side, or loose tortilla
// through later turns unless that item is cancelled or staff said it is out. Counts come from the
// phrase that named the item, not from another line.
import { statedDishPutQty } from "./modifier-turns.js";
import type { PosCatalog } from "./pos-catalog.js";
import { affirmedStaffSoupQty, isAbandonTurn } from "./readback-pass.js";
import { isAvailQ, staffUnavailable } from "./spoken-ledger.js";

type Turn = { speaker: string; text: string };
const POZOLE_ID = "sq-pozole-rojo-red-pozole-DQ7X4J";
const ENCH_ID = "sq-enchiladas-orden-de-enchiladas-6-6QOYJ5";
const SMALL_RICE_ID = "sq-sides-arroz-rice-26S6E6";
const LOOSE_TORTILLA_ITEM = "Z3VC5CORH6D4ZY2OW3OXMNVK";
const LOOSE_TORTILLA_VAR = "ADELFIEMIO25YMSN3Z5LCOML";

const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

const MENU_FILLER = /\b(?:senoritas?|senoras?|senores?|joven(?:es)?|escucha(?:s|me)?|oiga|oye|hola|buenas(?:\s+tardes|\s+dias)?|por\s+favor|porfavor|please|gracias|puede(?:s|n)?|poner(?:me|nos)?|pongame|favor|nombre|si)\b/g;
const MENU_CLOSING = /\b(?:es\s+todo|eso\s+es\s+todo|nada\s+mas|hasta\s+luego|hasta\s+pronto)\b/g;
/** Query the menu matcher should see. Greeting and goodbye fragments are not part of the dish, and a plural soup still names the singular item. */
export function menuQueryForMatch(text: string): string {
  let t = fold(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(MENU_CLOSING, " ").replace(MENU_FILLER, " ");
  t = t.replace(/\bpozoles\b/g, "pozole").replace(/\bmenudos\b/g, "menudo");
  return t.replace(/\s+/g, " ").trim();
}
/** "es todo señorita" / "nombre" / "hasta luego" is not another menu query. A counted dish is. */
export function isClosingFragment(text: string): boolean {
  const t = fold(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (/\b(?:po[sz]oles?|menudos?|birrias?|enchiladas?|tacos?|quesadillas?|gorditas?|tortas?|burritos?|arroz|tortillas?|comal|harina|bistec|asada)\b/.test(t)) return false;
  return /\b(?:es\s+todo|eso\s+es\s+todo|nada\s+mas|hasta\s+luego|nombre|gracias|senorita|adios|bye)\b/.test(t);
}
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, one: 1, a: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10 };
const numOf = (w: string) => NUM[fold(w)] || Number(w) || 0;
const COUNT = "\\d+|un[oa]?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six";

/** Same slug Square uses: item + non-Regular variation, then the first 6 of the variation id. */
export function menuIdForVariation(itemName: string, variationName: string, variationId: string): string {
  const regular = /^regular$/i.test(String(variationName || "").trim());
  const full = !regular && variationName ? `${itemName} ${variationName}` : itemName;
  const slug = fold(full).replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-");
  return `sq-${slug}-${String(variationId || "").slice(0, 6)}`;
}

const CANCEL = /\b(?:quita(?:r|me|le|melo|selo)?|ya\s+no|no\s+(?:quiero|lo\s+quiero|la\s+quiero|me\s+(?:pongas|ponga|pongan))|sin\s+(?:el|la|los|las)?\s*(?:po[sz]oles?|arroz|rice|tortillas?)|cancel\w*|olvid\w*|remove|take\s+(?:it|that|the|them)?\s*off|en\s+vez\s+de)\b/iu;
const FOOD_WORD = /\b(?:tacos?|quesadillas?|gorditas?|tortas?|burritos?|enchiladas?|po[sz]oles?|menudos?|birrias?|arroz|rice|tortillas?|frijoles|beans)\b/u;
function callerTurns(turns: Turn[]) { return (turns || []).filter((t) => t.speaker === "caller"); }
function saidCancel(text: string, dish: RegExp): boolean {
  const t = fold(text);
  if (!dish.test(t) || !CANCEL.test(t)) return false;
  return t.split(/[.?!]/).some((s) => dish.test(s) && CANCEL.test(s));
}
/** "quítame uno" / "quítame un pozole" takes one off. "quita el pozole" is the whole line. */
function quitaOne(text: string, dish: RegExp): boolean {
  const t = fold(text);
  return t.split(/[.?!]/).some((s) => dish.test(s) && /\bquita(?:r|me|le|melo|selo)?\s+(?:uno|un|una)\b/.test(s) && !/\bquita(?:r|me|le|melo|selo)?\s+(?:el|la|los|las|todo)\b/.test(s));
}
function isFullCancel(text: string, dish: RegExp): boolean {
  return saidCancel(text, dish) && !quitaOne(text, dish);
}
/** "mejor dos pozoles" / "nada más un plato de arroz" / "solo una tortilla suelta" sets that dish's count. The number has to sit with the dish, not with a different item in the same sentence. */
function explicitSet(text: string, dish: RegExp): number | null {
  const cue = new RegExp(String.raw`\b(?:mejor|nada\s+mas|nomas|solo|solamente)\s+(?:son\s+|sean\s+)?(${COUNT})\b`, "gu");
  let n: number | null = null;
  for (const s of fold(text).split(/[.?!]/)) {
    if (!dish.test(s)) continue;
    for (const m of s.matchAll(cue)) {
      const after = s.slice(m.index ?? 0);
      const at = after.search(dish);
      if (at < 0 || at > 48) continue;
      if (FOOD_WORD.test(after.slice(m[0].length, at))) continue;
      const k = numOf(m[1]);
      if (k >= 1 && k <= 30) n = k;
    }
  }
  return n;
}
/** Last caller disposition for this dish. A later plain order wins over an earlier cancel. A lower count is still an order. */
function disposition(turns: Turn[], dish: RegExp, ordered: (text: string) => boolean): "order" | "cancel" | "none" {
  let state: "order" | "cancel" | "none" = "none";
  for (const t of callerTurns(turns)) {
    if (isFullCancel(t.text, dish)) state = "cancel";
    else if (explicitSet(t.text, dish) != null || quitaOne(t.text, dish) || (ordered(t.text) && !isAvailQ(t.text))) state = "order";
  }
  return state;
}
/** Keep the ordered count unless the caller later names a smaller one or takes one off. A plain repeat never lowers it. */
function spokenQty(turns: Turn[], dish: RegExp, base: number, countOf: (text: string) => number): number {
  if (!callerTurns(turns).some((t) => explicitSet(t.text, dish) != null || quitaOne(t.text, dish))) return base;
  let qty = 0;
  let live = false;
  for (const t of callerTurns(turns)) {
    if (isFullCancel(t.text, dish)) { qty = 0; live = false; continue; }
    const set = explicitSet(t.text, dish);
    if (set != null) { qty = set; live = true; continue; }
    if (quitaOne(t.text, dish)) { qty = Math.max(0, (live ? qty : base) - 1); live = qty > 0; continue; }
    const c = countOf(t.text);
    if (c) { qty = Math.max(qty, c); live = true; }
  }
  return live ? qty : 0;
}

function pozoleOrdered(turns: Turn[]): number {
  const dish = /po[sz]oles?/iu;
  if (disposition(turns, dish, (t) => dish.test(t) && /\b(?:poner|ponme|ponga|quiero|quisiera|dame|deme|me\s+da|cargar|orden|un[oa]?|dos|tres|\d+)\b/iu.test(t)) !== "order") return 0;
  const all = turns.map((t) => t.text).join(" ");
  if (staffUnavailable(turns).some((d) => /pozole|po[sz]ole/.test(d))) return 0;
  if (/\bverdes?\b/iu.test(all) && !/\brojos?\b|\bpuerco\b/iu.test(all)) return 0;
  const put = statedDishPutQty(turns, dish);
  const staff = affirmedStaffSoupQty(turns, "pozole");
  let n = Math.max(put, staff, 0);
  for (const t of callerTurns(turns)) {
    const m = t.text.match(new RegExp(String.raw`\b(${COUNT})\s+po[sz]oles?\b`, "iu"));
    if (m) n = Math.max(n, numOf(m[1]));
  }
  return spokenQty(turns, dish, n || 1, (text) => {
    const m = text.match(new RegExp(String.raw`\b(${COUNT})\s+po[sz]oles?\b`, "iu"));
    return m ? numOf(m[1]) : 0;
  });
}

const RICE_PHRASE = new RegExp(String.raw`\b(?:plato|platito|orden|lado|side|size)\s+de\s+arroz\b|\b(?:${COUNT})\s+(?:platos?\s+de\s+)?arroz\b|\bsides?\s+of\s+rice\b|\b(?:un|una)\s+arroz\b`, "iu");
function riceMention(text: string): boolean {
  return RICE_PHRASE.test(text) && !/\b(?:frijoles|beans)\b/iu.test(text) && !/\bcon\s+(?:puro\s+)?arroz\b/iu.test(text);
}
function riceOrdered(turns: Turn[]): { qty: number; grande: boolean } | null {
  if (disposition(turns, /\barroz\b|\brice\b/iu, riceMention) !== "order") return null;
  if (turns.some((t) => t.speaker === "caller" && /\b(?:rice\s+and\s+beans|arroz\s+y\s+frijoles|frijoles\s+y\s+arroz)\b/iu.test(t.text) && !turns.some((u) => u.speaker === "caller" && /\bplato\s+de\s+arroz\b|\borden\s+de\s+arroz\b|\bside\s+of\s+rice\b/iu.test(u.text)))) return null;
  let qty = 1;
  for (const t of callerTurns(turns)) {
    if (!riceMention(t.text)) continue;
    const m = t.text.match(new RegExp(String.raw`\b(${COUNT})\s+(?:(?:platos?|sides?)\s+(?:de\s+|of\s+)?)?arroz\b`, "iu"))
      || t.text.match(new RegExp(String.raw`\b(${COUNT})\s+sides?\s+of\s+rice\b`, "iu"));
    if (m) qty = Math.max(qty, numOf(m[1]) || 1);
  }
  qty = spokenQty(turns, /\barroz\b|\brice\b/iu, qty, (text) => {
    if (!riceMention(text)) return 0;
    const m = text.match(new RegExp(String.raw`\b(${COUNT})\s+(?:(?:platos?|sides?)\s+(?:de\s+|of\s+)?)?arroz\b`, "iu"))
      || text.match(new RegExp(String.raw`\b(${COUNT})\s+sides?\s+of\s+rice\b`, "iu"));
    return m ? (numOf(m[1]) || 1) : 0;
  });
  if (!qty) return null;
  let grande = false, small = false;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].speaker !== "caller") continue;
    const prev = [...turns.slice(Math.max(0, i - 3), i)].reverse().find((t) => t.speaker === "staff");
    const recentRice = turns.slice(Math.max(0, i - 4), i + 1).some((t) => riceMention(t.text) || (t.speaker === "staff" && /\barroz\b|\brice\b/iu.test(t.text)));
    const sizeAsk = !!prev && /\b(?:chic[ao]|small|peque)\b/iu.test(prev.text) && /\b(?:grande|large)\b/iu.test(prev.text);
    const aboutRice = riceMention(turns[i].text) || (recentRice && (sizeAsk || /\b(?:chic[ao]|grande|small|large|peque)\b/iu.test(turns[i].text)));
    if (!aboutRice) continue;
    if (/\b(?:grande|large)\b/iu.test(turns[i].text) && !/\b(?:chic[ao]|small|peque)/iu.test(turns[i].text)) grande = true;
    if (/\b(?:chic[ao]|small|peque)\b/iu.test(turns[i].text)) small = true;
  }
  if (small) grande = false;
  return { qty, grande };
}

const LOOSE = new RegExp(String.raw`\b(${COUNT})\s+tortillas?\s+(?:sueltas?|extras?|individual(?:es)?|de\s+comal)\b|\btortillas?\s+(?:sueltas?|extras?)\s+(?:de\s+|del\s+)?comal\b`, "iu");
const PACK = /\b(?:docenas?|paquetes?|\d+\s*x\s*tortilla|six\s*pack|12\s*pack)\b/iu;
function looseTortillas(turns: Turn[]): { qty: number } | null {
  const dish = /tortillas?\s+(?:sueltas?|extras?|individual)/iu;
  const ordered = (t: string) => LOOSE.test(t) && !PACK.test(t) && /\b(?:sueltas?|extras?|individual)/iu.test(t) || (/\btortillas?\s+sueltas?\b/iu.test(t) && /\bcomal\b/iu.test(t));
  if (disposition(turns, /tortillas?/iu, (t) => ordered(t) && !/\btacos?\b/iu.test(t.replace(LOOSE, " "))) !== "order" && !callerTurns(turns).some((t) => ordered(t.text))) return null;
  if (callerTurns(turns).some((t) => isFullCancel(t.text, dish))) return null;
  // A taco "de comal" is the shell, not a loose tortilla. Require suelta/extra/individual.
  if (!callerTurns(turns).some((t) => /\b(?:sueltas?|extras?|individual(?:es)?)\b/iu.test(t.text) && /\btortillas?\b/iu.test(t.text))) {
    const staffLoose = turns.some((t) => t.speaker === "staff" && /\btortillas?\s+extras?\b/iu.test(t.text));
    const callerLoose = callerTurns(turns).some((t) => /\btortillas?\s+sueltas?\b/iu.test(t.text));
    if (!staffLoose || !callerLoose) return null;
  }
  let qty = 0;
  for (const t of callerTurns(turns)) {
    const m = t.text.match(new RegExp(String.raw`\b(${COUNT})\s+tortillas?\s+(?:sueltas?|extras?|individual(?:es)?)`, "iu"))
      || t.text.match(new RegExp(String.raw`\b(${COUNT})\s+tortillas?\s+sueltas?\s+de\s+comal`, "iu"));
    if (m) qty = numOf(m[1]);
  }
  if (!qty) for (const t of turns) if (t.speaker === "staff") {
    const m = t.text.match(new RegExp(String.raw`\b(${COUNT})\s+tortillas?\s+extras?\b`, "iu"));
    if (m) qty = numOf(m[1]);
  }
  qty = spokenQty(turns, dish, qty, (text) => {
    const m = text.match(new RegExp(String.raw`\b(${COUNT})\s+tortillas?\s+(?:sueltas?|extras?|individual(?:es)?)`, "iu"))
      || text.match(new RegExp(String.raw`\b(${COUNT})\s+tortillas?\s+sueltas?\s+de\s+comal`, "iu"));
    return m ? numOf(m[1]) : 0;
  });
  if (!qty || qty > 30) return null;
  const comal = turns.some((t) => /\bcomal\b/iu.test(t.text) && /\btortillas?\b/iu.test(t.text));
  const harina = callerTurns(turns).some((t) => /\b(?:harina|flour)\b/iu.test(t.text) && /\btortillas?\s+(?:sueltas?|extras?)/iu.test(t.text) && !/\bcomal\b/iu.test(t.text));
  if (harina || !comal) return null;
  return { qty };
}

export type LooseTortillaPick = { itemId: string; variationId: string; name: string };
const isPackName = (n: string) => /^\s*(?:6|12)\s*x\b/i.test(n) || /\b(?:6|12)\s*x\s*tortilla\b/i.test(n);
/** The single counter comal tortilla. Phone-menu packs are not this. No id is invented when neither the menu nor the catalog has it. */
export function looseComalTortilla(menu: any[] | null | undefined, catalog: PosCatalog | null | undefined): LooseTortillaPick | null {
  for (const m of menu || []) {
    const varId = String(m?.squareVariationId || "");
    const name = String(m?.name || "");
    if (varId === LOOSE_TORTILLA_VAR || (/^1\s*x\s*tortilla\s*comal\b/i.test(name) && !isPackName(name)))
      return { itemId: String(m.id), variationId: varId || LOOSE_TORTILLA_VAR, name };
  }
  const item = (catalog?.items || []).find((i) => i.id === LOOSE_TORTILLA_ITEM)
    || (catalog?.items || []).find((i) => /tortillas?\s+extras\b/i.test(i.name) && (i.variations || []).some((v) => /^1\s*x\s*tortilla\s*comal\b/i.test(v.name)));
  const variation = item?.variations.find((v) => v.id === LOOSE_TORTILLA_VAR) || item?.variations.find((v) => /^1\s*x\s*tortilla\s*comal\b/i.test(v.name) && !isPackName(v.name));
  if (!item || !variation) return null;
  return { itemId: menuIdForVariation(item.name, variation.name, variation.id), variationId: variation.id, name: `${item.name} ${variation.name}` };
}

const isGrandeRice = (m: any) => /grande/i.test(`${m?.name || ""} ${m?.id || ""}`) && /arroz|rice/i.test(`${m?.name || ""} ${m?.id || ""}`) && !/frijol|bean/i.test(`${m?.name || ""} ${m?.id || ""}`);
const isSmallRice = (m: any) => /arroz|rice/i.test(`${m?.name || ""} ${m?.id || ""}`) && !isGrandeRice(m) && !/frijol|bean/i.test(`${m?.name || ""} ${m?.id || ""}`) && (/sides/i.test(String(m?.name || m?.id || "")) || /26S6E6/i.test(String(m?.id || m?.squareVariationId || "")));
function riceItem(menu: any[], grande: boolean): { id: string; sizeOption?: { step: string; option: string } } | null {
  const hit = (menu || []).find((m) => grande ? isGrandeRice(m) : isSmallRice(m) || String(m?.squareVariationId || "").startsWith("26S6E6"));
  if (hit && (grande ? isGrandeRice(hit) : !isGrandeRice(hit))) {
    const g = (hit.modifierGroups || [])[0];
    const opts: string[] = (g?.options || []).map((o: any) => typeof o === "string" ? o : o?.name).filter(Boolean);
    const option = opts.find((o) => (grande ? /^GRANDE/i.test(o) : !/^GRANDE/i.test(o)) && /rice|arroz/i.test(o) && !/bean|frijol/i.test(o));
    return { id: hit.id, ...(option && g ? { sizeOption: { step: g.name, option } } : {}) };
  }
  if (!grande) return { id: SMALL_RICE_ID };
  return null;
}

const MEAT_MOD = /puerco|pork|pollo|chicken|res\b|beef|maciza|pavo/i;
function stripUnaskedPozoleMeat(line: any, turns: Turn[]) {
  const said = callerTurns(turns).map((t) => t.text).join(" ");
  line.modifiers = (line.modifiers || []).filter((m: any) => {
    const o = String(m?.option || "");
    if (!MEAT_MOD.test(o)) return true;
    const word = fold(o).split(/[^a-z]+/).find((w) => w.length > 3 && MEAT_MOD.test(w));
    return !!word && new RegExp(`\\b${word}`, "iu").test(fold(said));
  });
}

function allQueso(turns: Turn[]): boolean {
  return callerTurns(turns).some((t, i, all) => {
    if (!/\b(?:tod[oa]s?|las\s+seis|all)\s+(?:de\s+)?queso(?:\s+fresco)?\b/iu.test(t.text)) return false;
    if (/\b(?:mitad|papas?|frijoles?|pollo|prensado)\b/iu.test(t.text)) return false;
    const prev = [...all.slice(0, i + 1)].reverse().find((u) => /\benchiladas?\b/iu.test(u.text));
    const window = all.slice(Math.max(0, i - 3), i + 1).map((u) => u.text).join(" ");
    return /\benchiladas?\b/iu.test(window) || !!prev;
  });
}

function upsert(cart: any[], id: string, qty: number, extra: any = {}) {
  const lines = cart.filter((l) => l.itemId === id || (extra.match && extra.match(l)));
  if (!lines.length) { cart.push({ itemId: id, quantity: qty, modifiers: extra.modifiers || [], readback: extra.readback }); return true; }
  let changed = false;
  if ((Number(lines[0].quantity) || 1) !== qty) { lines[0].quantity = qty; changed = true; }
  for (const l of lines.slice(1)) cart.splice(cart.indexOf(l), 1);
  return changed || lines.length > 1;
}

/** Drop a remove of a soup, side, or loose tortilla this turn did not cancel. */
export function dropUncancelledRemoves(actions: any[], text: string, cart: any[]): any[] {
  if (!Array.isArray(actions) || isAbandonTurn(text)) return actions;
  const protectedId = (id: string) => /pozole/i.test(id) || /^sq-sides-/i.test(id) || /tortillas-extras|1-x-tortilla-comal|ADELFI/i.test(id);
  return actions.filter((a) => {
    if (a?.type !== "remove_item" || !protectedId(String(a.itemId || ""))) return true;
    if (!cart.some((l) => l?.itemId === a.itemId)) return true;
    const dish = /pozole/i.test(a.itemId) ? /po[sz]oles?/iu : /sides/i.test(a.itemId) ? /\barroz\b|\brice\b|\bfrijoles?\b|\bbeans?\b/iu : /tortillas?/iu;
    return isFullCancel(text, dish) || explicitSet(text, dish) != null || quitaOne(text, dish);
  });
}

function dropCancelled(cart: any[], pred: (l: any) => boolean): boolean {
  let changed = false;
  for (let i = cart.length - 1; i >= 0; i--) if (pred(cart[i])) { cart.splice(i, 1); changed = true; }
  return changed;
}

export function retainSpokenOrder(cart: any[], turns: Turn[], menu: any[] = [], catalog: PosCatalog | null = null): boolean {
  if (!Array.isArray(cart) || !Array.isArray(turns)) return false;
  let changed = false;
  const poz = pozoleOrdered(turns);
  if (!poz && callerTurns(turns).some((t) => isFullCancel(t.text, /po[sz]oles?/iu) || quitaOne(t.text, /po[sz]oles?/iu))) changed = dropCancelled(cart, (l) => /pozole/i.test(String(l.itemId))) || changed;
  if (poz) {
    const lines = cart.filter((l) => /pozole/i.test(String(l.itemId)));
    if (!lines.length) { cart.push({ itemId: POZOLE_ID, quantity: poz, modifiers: [], readback: "pozole rojo" }); changed = true; }
    else {
      if (lines.reduce((s, l) => s + (Number(l.quantity) || 1), 0) !== poz || lines.length > 1) {
        lines[0].quantity = poz; for (const l of lines.slice(1)) cart.splice(cart.indexOf(l), 1); changed = true;
      }
      const before = JSON.stringify(lines[0].modifiers || []);
      stripUnaskedPozoleMeat(lines[0], turns);
      if (JSON.stringify(lines[0].modifiers || []) !== before) changed = true;
    }
  }
  const rice = riceOrdered(turns);
  if (!rice && callerTurns(turns).some((t) => isFullCancel(t.text, /\barroz\b|\brice\b/iu) || quitaOne(t.text, /\barroz\b|\brice\b/iu))) changed = dropCancelled(cart, (l) => isSmallRice(l) || isGrandeRice(l) || /sides-arroz|26S6E6|QPUFQG/i.test(String(l.itemId))) || changed;
  if (rice) {
    const pick = riceItem(menu, rice.grande);
    if (pick) {
      const lines = cart.filter((l) => isSmallRice(l) || isGrandeRice(l) || l.itemId === pick.id || /sides-arroz|26S6E6|QPUFQG/i.test(String(l.itemId)));
      const wrong = lines.filter((l) => l.itemId !== pick.id);
      if (wrong.length) { for (const l of wrong) cart.splice(cart.indexOf(l), 1); changed = true; }
      const keep = cart.find((l) => l.itemId === pick.id);
      if (!keep) { cart.push({ itemId: pick.id, quantity: rice.qty, modifiers: pick.sizeOption ? [pick.sizeOption] : [], readback: rice.grande ? "arroz grande" : "arroz chico" }); changed = true; }
      else {
        if ((Number(keep.quantity) || 1) !== rice.qty) { keep.quantity = rice.qty; changed = true; }
        if (pick.sizeOption && !(keep.modifiers || []).some((m: any) => m.option === pick.sizeOption!.option)) { keep.modifiers = [pick.sizeOption]; changed = true; }
      }
    }
  }
  const loose = looseTortillas(turns);
  if (!loose && callerTurns(turns).some((t) => isFullCancel(t.text, /tortillas?\s+(?:sueltas?|extras?|individual)/iu) || quitaOne(t.text, /tortillas?\s+(?:sueltas?|extras?|individual)/iu))) changed = dropCancelled(cart, (l) => /tortillas-extras|1-x-tortilla-comal|ADELFI/i.test(String(l.itemId))) || changed;
  if (loose) {
    const pick = looseComalTortilla(menu, catalog);
    if (pick) {
      const lines = cart.filter((l) => l.itemId === pick.itemId || String(l.squareVariationId || "") === pick.variationId);
      const packs = cart.filter((l) => /tortillas?-6|tortillas?-12|6-x-tortilla|12-x-tortilla/i.test(String(l.itemId)) && !/menudo|birria|mole/i.test(String(l.itemId)));
      if (!lines.length && packs.length && callerTurns(turns).every((t) => !PACK.test(t.text))) {
        for (const l of packs) cart.splice(cart.indexOf(l), 1); changed = true;
      }
      if (upsert(cart, pick.itemId, loose.qty, { readback: `${loose.qty} tortilla comal` })) changed = true;
      const line = cart.find((l) => l.itemId === pick.itemId);
      if (line) line.squareVariationId = pick.variationId;
    }
  }
  if (allQueso(turns)) {
    let line = cart.find((l) => l.itemId === ENCH_ID || /enchilad/i.test(String(l.itemId)));
    if (!line) { line = { itemId: ENCH_ID, quantity: 1, modifiers: [], readback: "enchiladas" }; cart.push(line); changed = true; }
    const step = "(A) Enchiladas Carne Options (ONLINE)";
    const queso = { step, option: "Queso / Cheese" };
    const carne = (line.modifiers || []).filter((m: any) => /carne/i.test(String(m.step || "")));
    const onlyQueso = carne.length === 1 && /queso/i.test(String(carne[0].option)) && !/fresco/i.test(String(carne[0].option));
    if (!onlyQueso) {
      line.modifiers = [...(line.modifiers || []).filter((m: any) => !/carne/i.test(String(m.step || ""))), queso];
      changed = true;
    }
    const note = "enchiladas: 6 queso";
    if (!(line.elviNotes || []).includes(note)) { line.elviNotes = [...(line.elviNotes || []).filter((n: string) => !/^enchiladas:/.test(n)), note]; changed = true; }
    let nOrd = 1;
    for (const t of callerTurns(turns)) {
      const m = t.text.match(/\b(\d+|dos|tres|cuatro|un[ao]?)\s+[oó]rdenes?\s+de\s+enchiladas?\b/iu);
      if (m) nOrd = Math.max(nOrd, numOf(m[1]) || 1);
    }
    if ((Number(line.quantity) || 1) !== nOrd) { line.quantity = nOrd; changed = true; }
  }
  return changed;
}
