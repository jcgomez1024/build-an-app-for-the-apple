/**
 * Website (cocinaelvis.com storefront) rules at runtime, from data/site-catalog.json
 * (refresh with `npm run sync:site-menu`). One generic engine for every category:
 *  - which Square items the site sells (matched by Square item ID),
 *  - each modifier group's min / max / preselected choices (site wins over Square defaults),
 *  - category time windows (e.g. Menudo only Sat/Sun).
 */
import fs from "node:fs";
import type { MenuItem, ModifierGroup } from "./menu.js";

type Hours = Record<string, Array<{ open: string; close: string }>>;
export type SiteGroup = { squareId: string; name: string; min: number; max: number; choices: Array<{ squareId: string; name: string; priceCents: number; preselected: boolean }> };
export type SiteProduct = { squareId: string; name: string; siteName: string; categories: string[]; skus: Array<{ squareId: string; name: string; priceCents: number | null; soldOut: boolean }>; groups: SiteGroup[] };
export type SiteCatalog = { fetchedAt: string; timezone: string; store?: { timezone: string; pickupHours: Hours | null; prepMinutes: number }; categories: Array<{ name: string; customTimes: boolean; hours: Hours | null }>; products: SiteProduct[] };

let cached: SiteCatalog | null | undefined;
export function loadSiteCatalog(): SiteCatalog | null {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(new URL("../data/site-catalog.json", import.meta.url), "utf8"));
  } catch {
    cached = null;
  }
  return cached ?? null;
}

export function siteProductFor(squareItemId?: string) {
  if (!squareItemId) return null;
  return loadSiteCatalog()?.products.find((p) => p.squareId === squareItemId) || null;
}

export function siteSellsSquareItem(squareItemId?: string) {
  return Boolean(siteProductFor(squareItemId));
}

const groupKey = (name: string) => String(name || "").toLowerCase().replace(/^\s*\([a-z]{1,3}\)\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Site min / max / preselect onto the Square-built groups (matched by Square modifier list ID, then name). */
export function applySiteGroupRules(item: MenuItem): MenuItem {
  const product = siteProductFor(item.squareCatalogObjectId);
  if (!product || !item.modifierGroups?.length) return item;
  const modifierGroups = item.modifierGroups.map((group): ModifierGroup => {
    const site = product.groups.find((g) => g.squareId === group.id) || product.groups.find((g) => groupKey(g.name) === groupKey(group.name));
    if (!site) return group;
    const preselected = site.choices.filter((c) => c.preselected).map((c) => c.name);
    const defaults = group.options
      .map((o) => (typeof o === "string" ? { id: "", name: o } : o))
      .filter((o) => site.choices.some((c) => c.preselected && (c.squareId === o.id || groupKey(c.name) === groupKey(String(o.name).replace(/\s*\([+-]\$[\d.]+\)\s*$/, "")))))
      .map((o) => o.name);
    const next: ModifierGroup = { ...group, minSelections: site.min, maxSelections: site.max === 0 ? undefined : site.max } as ModifierGroup;
    if (preselected.length) (next as any).defaultOptions = defaults.length ? defaults : preselected;
    else delete (next as any).defaultOptions;
    return next;
  });
  return { ...item, modifierGroups: siteOrderGroups(modifierGroups, product) };
}

/**
 * Ask in the website's order: the size/option (sku) picker first, then the item's modifier groups
 * exactly as the storefront lists them. Groups the site doesn't show keep their place at the end.
 */
function siteOrderGroups(groups: ModifierGroup[], product: any): ModifierGroup[] {
  const idx = (g: ModifierGroup) => {
    if (/^reviewed-/.test(String(g.id))) return -1;
    const i = product.groups.findIndex((sg: any) => sg.squareId === g.id || groupKey(sg.name) === groupKey(g.name));
    return i < 0 ? 1000 : i;
  };
  return groups.map((g, n) => ({ g, n, i: idx(g) })).sort((a, b) => a.i - b.i || a.n - b.n).map((x) => x.g);
}

/** The website's question order for a Square item: "size" (when it has several skus), then group names. */
export function siteQuestionOrder(squareId?: string): string[] {
  const product: any = siteProductFor(squareId);
  if (!product) return [];
  return [...(product.skus.length > 1 ? ["(size/option)"] : []), ...product.groups.map((g: any) => g.name)];
}

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_NAMES: Record<string, [string, string]> = { SUN: ["Sun", "dom"], MON: ["Mon", "lun"], TUE: ["Tue", "mar"], WED: ["Wed", "mié"], THU: ["Thu", "jue"], FRI: ["Fri", "vie"], SAT: ["Sat", "sáb"] };

function storeNow(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value.toUpperCase().slice(0, 3) || "SUN";
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return { day: wd, minutes: h * 60 + m };
}
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const fmt = (t: string) => { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };

/** Clock override for tests only (ELVI_SIMULATED_NOW=2026-10-15T19:30:00-04:00). */
export function currentTime() {
  const sim = process.env.ELVI_SIMULATED_NOW;
  const d = sim ? new Date(sim) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

const fmtMin = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? "pm" : "am"; return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${ap}`; };

/**
 * What cocinaelvis.com displays for a time-limited category, per day: the overlap of the category
 * schedule and the store's pickup hours, starting after the prep time and ending one minute before
 * close (Thu: Especial 9:00-20:00 ∩ pickup 11:00-20:00, prep 20 min -> "11:20 am - 7:59 pm").
 */
export function displayedWindows(categoryHours: Hours, catalog = loadSiteCatalog()) {
  const store = catalog?.store;
  const prep = store?.prepMinutes || 0;
  const out: Record<string, Array<{ start: number; end: number }>> = {};
  for (const d of DAYS) {
    out[d] = [];
    for (const w of categoryHours[d] || []) {
      const pickups = store?.pickupHours ? store.pickupHours[d] || [] : [{ open: "00:00", close: "24:00" }];
      for (const p of pickups) {
        const open = Math.max(toMin(w.open), toMin(p.open));
        const close = Math.min(toMin(w.close), toMin(p.close));
        if (close - 1 >= open + prep) out[d].push({ start: open + prep, end: close - 1 });
      }
    }
  }
  return out;
}

/**
 * An item is limited only when every website category it's in has custom hours
 * (an item also listed in an always-on category is always available). It can be ordered now when
 * the earliest pickup (now + prep time) falls inside what the site displays for today.
 */
export function itemAvailability(squareItemId: string | undefined, now = currentTime()): { available: boolean; window?: { en: string; es: string }; today?: string } {
  const catalog = loadSiteCatalog();
  const product = siteProductFor(squareItemId);
  if (!catalog || !product) return { available: true };
  const cats = product.categories.map((n) => catalog.categories.find((c) => c.name === n)).filter(Boolean) as SiteCatalog["categories"];
  if (!cats.length || cats.some((c) => !c.customTimes || !c.hours)) return { available: true };
  const { day, minutes } = storeNow(now, catalog.store?.timezone || catalog.timezone);
  const prep = catalog.store?.prepMinutes || 0;
  const windows = cats.map((c) => displayedWindows(c.hours!, catalog));
  const pickupAt = minutes + prep;
  const open = windows.some((w) => (w[day] || []).some((x) => pickupAt >= x.start && pickupAt <= x.end));
  const describe = (es: boolean) => DAYS.flatMap((d) => windows.flatMap((w) => (w[d] || []).map((x) => `${DAY_NAMES[d][es ? 1 : 0]} ${fmtMin(x.start)}–${fmtMin(x.end)}`))).join(", ");
  const today = windows.flatMap((w) => (w[day] || []).map((x) => `${fmtMin(x.start)} - ${fmtMin(x.end)}`)).join(", ");
  return { available: open, window: { en: describe(false), es: describe(true) }, today };
}

export function unavailableNowReply(item: { name: string }, squareItemId: string | undefined, language: "en" | "es", now = currentTime()) {
  const a = itemAvailability(squareItemId, now);
  if (a.available || !a.window) return null;
  const name = item.name.replace(/\s*\([A-Z]{1,4}\)\s*/g, " ").trim();
  return language === "es"
    ? `${name} ${a.today ? `hoy solo está disponible ${a.today}` : `solo está disponible ${a.window.es}`}. No lo agregué. ¿Algo más?`
    : `${name} ${a.today ? `is only available ${a.today} today` : `is only available ${a.window.en}`}. I didn't add it. Anything else?`;
}

/** Drop add_items the website wouldn't sell right now; say why instead of "added". */
export function enforceSiteAvailability<T extends { reply: string; actions: any[] }>(result: T, menu: MenuItem[], language: "en" | "es", now = currentTime()): T {
  const blocked: string[] = [];
  const actions = (result.actions || []).filter((action) => {
    if (action?.type !== "add_item") return true;
    const item = menu.find((m) => m.id === action.itemId);
    const reply = item ? unavailableNowReply(item, item.squareCatalogObjectId, language, now) : null;
    if (reply) blocked.push(reply);
    return !reply;
  });
  if (!blocked.length) return result;
  return { ...result, actions, reply: blocked[0], audioBase64: undefined, audioMimeType: undefined } as T;
}

const QTY_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, un: 1, una: 1, uno: 1, two: 2, dos: 2, three: 3, tres: 3, four: 4, cuatro: 4, five: 5, cinco: 5 };
function leadingQuantity(text: string) {
  const m = String(text || "").trim().toLowerCase().match(/^(?:i(?:'d| would)? (?:like|want)|quiero|dame|me da)?\s*(\d+|[a-z]+)\b/);
  if (!m) return 1;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : QTY_WORDS[m[1]];
  return n && n > 0 && n < 50 ? n : 1;
}

/**
 * Website rule for required groups the caller didn't name: a group with only one choice is that
 * choice, and a non-meat group with a website preselect (e.g. Menudo's 4 Comal tortillas) uses the
 * preselect, the same as checking out on cocinaelvis.com. Meat groups are still asked.
 * Returns the completed add, or the result asking only the groups that are really open.
 */
export const STREET_WORDS = /\b(street|taquer[oa]s?|de ma[ií]z|maiz|chic[oa]s?)\b/i;
export const SMALL_WORDS = /\b(chic[oa]s?|chiquit[oa]s?|small|pequen[oa]s?|pequeñ[oa]s?|regular|10\s*(inch|in|inches|pulgadas)?|diez pulgadas|ten inch)\b|'10/i;
export function completeWithSiteDefaults(result: any, items: MenuItem[], text: string) {
  if (!result || result.ok !== false || result.reason !== "missing_required_modifiers" || !result.selectedItem?.itemId) return result;
  const item = items.find((m) => m.id === result.selectedItem.itemId);
  if (!item) return result;
  const filled: any[] = [];
  const open: any[] = [];
  for (const req of result.requiredGroups || []) {
    const g: any = (item.modifierGroups || []).find((x) => x.id === req.groupId);
    const options = (g?.options || []).map((o: any) => (typeof o === "string" ? { name: o } : o));
    let pick: any[] = [];
    if (options.length === 1) pick = options;
    // Least friction (Carlos, fix9): a site preselect is applied silently and read back — except meat,
    // which is always asked. Small/street words switch to the 10" size or the street tortilla.
    // Exception (fix10): COMBO Mix always asks which two items, despite the Street Taco preselect.
    else if (g && !/carne|meat/i.test(g.name) && !/mix option/i.test(g.name) && g.defaultOptions?.length) {
      if (/\bsize\b/i.test(g.name) && SMALL_WORDS.test(text)) pick = options.filter((o: any) => /'\s*10\b/.test(o.name)).slice(0, 1);
      else if (/tortilla|shell/i.test(g.name) && STREET_WORDS.test(text)) pick = options.filter((o: any) => /taquer|street/i.test(o.name)).slice(0, 1);
      if (!pick.length) pick = options.filter((o: any) => g.defaultOptions.includes(o.name));
    }
    if (pick.length) for (const o of pick) filled.push({ groupId: g.id, groupName: g.name, option: o.name, optionId: o.id, priceDeltaCents: o.priceDeltaCents || 0, quantity: 1 });
    else open.push(req);
  }
  if (!filled.length) return result;
  const provided = Array.isArray(result.provided) ? result.provided : [];
  if (!open.length) {
    return {
      ok: true,
      actions: [{ type: "add_item", itemId: item.id, quantity: leadingQuantity(text), modifiers: [...provided, ...filled] }],
      selectedItem: result.selectedItem
    };
  }
  return { ...result, requiredGroups: open, provided: [...provided, ...filled], siteDefaults: filled };
}

/** "EXTRA …" add-ons are never picked up just because the dish name contains the word (camarones). */
export function dropUnaskedExtras(actions: any[], text: string) {
  if (/\b(extra|extras|adicional|additional|doble|double|add|agrega|m[aá]s)\b/i.test(text)) return actions;
  return (actions || []).map((a) => a?.type === "add_item" && Array.isArray(a.modifiers)
    ? { ...a, modifiers: a.modifiers.filter((m: any) => !/^\W*(\(\w+\)\s*)?(extra|add|double)\b/i.test(String(m.groupName || m.step || "")) && !/^\W*extra\b/i.test(String(m.option || ""))) }
    : a);
}

/** Caller words per Square item (data/rules/site-items-rules.csv: square_item_id,website_item,callers_say "a; b"). */
let callerWords: Map<string, string[]> | null = null;
export function siteCallerWords(): Map<string, string[]> {
  if (callerWords) return callerWords;
  callerWords = new Map();
  try {
    const rows = fs.readFileSync(new URL("../data/rules/site-items-rules.csv", import.meta.url), "utf8").split(/\r?\n/).slice(1);
    for (const row of rows) {
      const [id, , words] = row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      if (id && words) callerWords.set(id, words.split(";").map((w) => w.trim().toLowerCase()).filter(Boolean));
    }
  } catch { /* optional */ }
  return callerWords;
}

const plain = (t: string) => ` ${String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

/**
 * When the caller names a dish by its caller words ("chiles rellenos con arroz y frijoles"),
 * resolve only against that dish so its side / tortilla words fill its own options
 * instead of matching another item (Sides, Birria...).
 */
export function pinnedMenu<T extends MenuItem>(text: string, allMenu: T[]): T[] {
  const t = plain(text);
  // fix18: COMBO items only when the caller says "combo" ("dos gorditas de chorizo" is 2 Gorditas).
  // Packs only by the "meal"/"pack" keyword (same rule as pre-turn.ts).
  const saysCombo = /\bcombos?\b/.test(t), saysPack = /\b(packs?|paks?|pacs?|meals?|paquetes?)\b/.test(t);
  const isCombo = (m: MenuItem) => (!saysCombo && /^\s*combo\b/i.test(String(m.name || ""))) || (!saysPack && /\bpack\s+meal\b/i.test(String(m.name || "")));
  const noCombo = saysCombo && saysPack ? allMenu : allMenu.filter((m) => !isCombo(m));
  const menu = noCombo.length ? noCombo : allMenu;
  const comboIds = new Set(allMenu.filter(isCombo).map((m) => m.squareCatalogObjectId));
  let best: { id: string; len: number } | null = null;
  for (const [id, words] of siteCallerWords()) {
    if (menu !== allMenu && comboIds.has(id)) continue;
    for (const w of words) {
      const pw = plain(w);
      if (t.includes(pw) && (!best || pw.length > best.len)) best = { id, len: pw.length };
    }
  }
  // fix23: pin common singles by noun when siteCallerWords missed them ("una torta de…").
  if (!best) {
    const nounPin: Array<[RegExp, RegExp]> = [
      [/\btortas?\b/, /^torta\b/i],
      [/\bquesadillas?\b/, /^quesadilla\b/i],
      [/\bgorditas?\b/, /^gordita\b/i],
      [/\btacos?\b/, /^taco\b/i],
      [/\bburritos?\b/, /^burrito\b/i],
    ];
    for (const [saidRe, nameRe] of nounPin) {
      if (!saidRe.test(t)) continue;
      const hits = menu.filter((m) => nameRe.test(String(m.name || "")) && (!m.squareCatalogObjectId || siteSellsSquareItem(m.squareCatalogObjectId)));
      if (hits.length && hits.length < menu.length) return pickVariation(text, hits);
    }
  }
  if (!best) {
    // Only what the website sells (e.g. "a gordita" is the online Gordita, not the in-store Gordita de Aceite).
    if (!loadSiteCatalog()) return menu;
    const sold = menu.filter((m) => !m.squareCatalogObjectId || siteSellsSquareItem(m.squareCatalogObjectId));
    // fix17: Fiesta Platters / Fajitas / Pans only when the caller says platter/fiesta ("una gordita … con salsa roja" is the Gordita).
    const party = /\b(fiesta|platter|party|charola|bandeja|tray)\b/.test(t);
    const noPlatter = party ? sold : sold.filter((m) => !/\bfiesta\b/i.test(String(m.name || "")));
    return noPlatter.length ? noPlatter : sold.length ? sold : menu;
  }
  const only = menu.filter((m) => m.squareCatalogObjectId === best!.id);
  return only.length ? pickVariation(text, only) : menu;
}

const SYN: Record<string, string> = { rice: "arroz", arroz: "arroz", beans: "frijol", bean: "frijol", frijoles: "frijol", frijol: "frijol", refried: "frijol", corn: "maiz", maiz: "maiz", flour: "harina", harina: "harina", half: "half", medio: "half", media: "half", mitad: "half", full: "full", completo: "full", completa: "full", entera: "full", grande: "grande", large: "grande", only: "solo", solo: "solo", sola: "solo", pata: "pata", street: "maiz", taquero: "maiz", taquera: "maiz", homemade: "comal", dearina: "harina", sin: "no", without: "no" };
const STOP = new Set(["de", "con", "y", "and", "with", "of", "a", "an", "the", "un", "una", "x", "pan", "aluminum", "tortilla", "tortillas", "por", "favor"]);
function concepts(t: string) {
  return new Set(plain(t).trim().split(" ").filter((w) => w && !STOP.has(w)).map((w) => SYN[w] || w));
}
const SYNONYM_OF = (w: string) => SYN[w] || w;
function overlap(option: string, said: Set<string>) {
  const c = concepts(option);
  let score = 0;
  for (const w of c) if (said.has(w)) score += 1;
  if (c.has("solo") && !said.has("solo")) score -= 2;
  if ((c.has("double") || c.has("doble") || c.has("extra")) && !said.has("double") && !said.has("doble") && !said.has("extra")) score -= 2;
  // "with tajin" → Tajín, not "NO TAJIN" (negated options need a no/sin/without).
  if ((c.has("no") || c.has("sin")) && !said.has("no") && !said.has("sin") && !said.has("without")) score -= 2;
  return score;
}

/** Among several website options (variations) of the pinned dish, keep the one the caller described. */
export function pickVariation<T extends MenuItem>(text: string, items: T[]): T[] {
  if (items.length < 2) return items;
  const said = concepts(text);
  // Only the words that tell the variations apart (the shared "Rice / Beans Fiesta Pan" part doesn't count).
  // Score the website option name (sku), e.g. "Frijoles/Refried Beans Half Aluminum Pan", not the full item title.
  const skuName = (i: MenuItem) => siteProductFor(i.squareCatalogObjectId)?.skus.find((k) => k.squareId === i.squareVariationId)?.name || i.name;
  const sets = items.map((i) => concepts(skuName(i)));
  const shared = new Set([...sets[0]].filter((w) => sets.every((x) => x.has(w))));
  // The dish's own name never picks an option ("quesadilla dorada" vs "(QD) REGULAR Dorada").
  for (const w of concepts(siteProductFor(items[0].squareCatalogObjectId)?.name || "")) shared.add(w);
  const scoreOf = (set: Set<string>) => [...set].filter((w) => !shared.has(w) && said.has(w)).length - (set.has("solo") && !shared.has("solo") && !said.has("solo") ? 2 : 0);
  const scored = items.map((i, n) => ({ i, s: scoreOf(sets[n]) })).sort((a, b) => b.s - a.s);
  if (scored[0].s <= 0) return items;
  // Keep every option that fits best, in website order (the first is what the site preselects).
  const top = items.filter((i) => scored.some((x) => x.i === i && x.s === scored[0].s));
  if (top.length < 2) return top;
  // Tie: the option with nothing extra the caller didn't ask for ("shrimp" -> Camarón, not Camarón con Pulpo).
  const extra = (i: T) => [...sets[items.indexOf(i)]].filter((w) => !shared.has(w) && !said.has(w)).length;
  const least = Math.min(...top.map(extra));
  const lean = top.filter((i) => extra(i) === least);
  return lean.length === 1 && top.filter((i) => extra(i) === least + 0).length === 1 && top.some((i) => extra(i) > least) ? lean : top;
}

/** Single-choice groups: if another website choice fits the caller's words better (arroz y frijoles vs SOLO frijoles), use it. */
export function rescoreSingleChoices(actions: any[], items: MenuItem[], text: string) {
  const said = concepts(text);
  return (actions || []).map((a) => {
    if (a?.type !== "add_item" || !Array.isArray(a.modifiers)) return a;
    const item = items.find((m) => m.id === a.itemId);
    if (!item) return a;
    const modifiers = a.modifiers.map((m: any) => {
      const g: any = (item.modifierGroups || []).find((x) => x.id === m.groupId || x.name === m.groupName || x.name === m.step);
      if (!g || (g.maxSelections ?? 0) !== 1 || /carne|meat/i.test(g.name)) return m;
      const opts = (g.options || []).map((o: any) => (typeof o === "string" ? { name: o } : o));
      const current = overlap(String(m.option), said);
      const best = opts.map((o: any) => ({ o, s: overlap(o.name, said) })).sort((x: any, y: any) => y.s - x.s)[0];
      if (!best || best.s <= current || best.o.name === m.option) return m;
      return { ...m, option: best.o.name, ...(m.optionId !== undefined ? { optionId: best.o.id } : {}), ...(m.priceDeltaCents !== undefined ? { priceDeltaCents: best.o.priceDeltaCents || 0 } : {}) };
    });
    return { ...a, modifiers };
  });
}

const cleanItemName = (n: string) => String(n || "").replace(/\s*\([A-Z]{1,4}\)\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Follow-up answers ("asada" after "Gordita: Bistec, Cabeza…?") belong to the dish that was asked about.
 * Returns that dish's variations and the customer words said for it so far, or null.
 */
export function followUpContext(history: Array<{ role: string; text: string }> | undefined, menu: MenuItem[]) {
  const turns = history || [];
  let i = turns.length - 1;
  while (i >= 0 && turns[i].role !== "assistant") i--;
  if (i < 0) return null;
  const lastAsk = String(turns[i].text || "");
  // fix23: "Quesadilla: … ¿Algo más?" is a finished read-back, not a build question.
  if (/\b(algo\s+m[aá]s|anything\s+else)\b/i.test(lastAsk)) return null;
  const m = lastAsk.match(/^(.+?):\s*¿?[^:]*\?\s*$/);
  if (!m) return null;
  const name = cleanItemName(m[1]);
  const product = loadSiteCatalog()?.products.find((p) => cleanItemName(p.name) === name);
  const hit = menu.find((x) => cleanItemName(x.name) === name || cleanItemName(x.readbackName || "") === name || cleanItemName(x.readbackNameEs || "") === name) || (product ? menu.find((x) => x.squareCatalogObjectId === product.squareId) : undefined);
  if (!hit) return null;
  const items = hit.squareCatalogObjectId ? menu.filter((x) => x.squareCatalogObjectId === hit.squareCatalogObjectId) : [hit];
  // Customer words for this dish: every customer turn back to the one that started it.
  const said: string[] = [];
  for (let j = i - 1; j >= 0; j--) {
    if (turns[j].role === "customer") said.unshift(turns[j].text);
    if (turns[j].role === "assistant") {
      // Keep going while the earlier question was about the same dish (any of its sizes).
      const q = String(turns[j].text || "").match(/^(.+?):\s*¿?[^:]*\?\s*$/);
      const qn = q ? cleanItemName(q[1]) : "";
      const same = qn && (qn === name || items.some((x) => [x.name, x.readbackName, x.readbackNameEs].some((n) => n && cleanItemName(n) === qn)) || (product && cleanItemName(product.name) === qn) || (hit.squareCatalogObjectId && loadSiteCatalog()?.products.some((p) => p.squareId === hit.squareCatalogObjectId && cleanItemName(p.name) === qn)));
      if (!same) break;
    }
  }
  return { name: hit.name, items, said: said.join(" "), saidTurns: said };
}

const cleanSku = (n: string) => String(n || "").replace(/\*+/g, "").replace(/^\s*\([A-Z]{1,4}\)\s*/, "").replace(/\s*\(\+?\$[\d.]+\)/g, "").replace(/\s+/g, " ").trim();

/**
 * The website makes the customer pick one option (sku) of a multi-option item (Ceviche: fish / shrimp…,
 * Fiesta Fajitas: Full Pollo / Half Bistec…, Extras, Sides…). When the caller didn't say which, ask
 * instead of silently adding the first one. Returns the question result or the original result.
 */
export function variationQuestion(result: any, items: MenuItem[], text: string, language: "en" | "es") {
  if (!result) return result;
  const add = (result.actions || []).find((a: any) => a?.type === "add_item");
  const pickedId = add?.itemId || (result.ok === false && result.reason === "missing_required_modifiers" ? result.selectedItem?.itemId : null);
  const picked = pickedId && items.find((m) => m.id === pickedId);
  const product: SiteProduct | null = picked ? siteProductFor(picked.squareCatalogObjectId) : null;
  if (!picked || !product || product.skus.length < 2 || picked.category === "drinks" || /pack meal|^combo/i.test(product.name)) return result;
  const siblings = items.filter((m) => m.squareCatalogObjectId === product.squareId);
  if (siblings.length < 2) return result;
  const fits = pickVariation(text, siblings);
  if (fits.length === 1 || fits.length === 0) return result;
  const names = fits.map((m) => cleanSku(product.skus.find((k) => k.squareId === m.squareVariationId)?.name || m.name)).filter(Boolean);
  const shown = names.slice(0, 6);
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} ${language === "es" ? "o" : "or"} ${shown[shown.length - 1]}` : shown[0];
  const more = names.length > shown.length ? (language === "es" ? ` (y ${names.length - shown.length} más)` : ` (and ${names.length - shown.length} more)`) : "";
  const message = language === "es" ? `${product.name}: ¿${list}${more}?` : `${product.name}: ${list}${more}?`;
  return {
    ok: false,
    reason: "choose_variation",
    message,
    actions: [],
    selectedItem: result.selectedItem,
    comboState: { ruleId: "site-followup", squareId: product.squareId, said: text },
    comboStep: { key: "site-variation", question: message }
  };
}

/**
 * Short read-back name the way the website reads: the product name, or the option for a
 * multi-option product ("Pambazo Elvis", not "Pambazo Elvis Pambazo"; "Ceviche de Camarón").
 */
export function readbackName(item: MenuItem, language: "en" | "es") {
  const product = siteProductFor(item.squareCatalogObjectId);
  const half = (n: string) => {
    const parts = String(n).split(" / ").map((p) => p.trim()).filter(Boolean);
    return (parts.length > 1 ? (language === "es" ? parts[0] : parts[parts.length - 1]) : parts[0] || "").trim();
  };
  if (!product) return String(item.name).replace(/\s*\([A-Z]{1,4}\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const base = cleanSku(product.name).replace(/^\(QD\)\s*/, "");
  if (product.skus.length < 2) return half(base) || base;
  const sku = cleanSku(product.skus.find((k) => k.squareId === item.squareVariationId)?.name || "");
  if (!sku) return half(base);
  const skuWords = concepts(sku);
  const baseWords = [...concepts(half(base))];
  return baseWords.some((w) => skuWords.has(w)) ? sku : `${half(base)} ${sku}`;
}

/**
 * A short answer ("half", "rice") belongs to the group Elvi just asked about. Given the resolver's
 * previous "missing required" result, return that group's option the answer fits best (or null).
 */
export function answerForAskedGroup(previous: any, heard: string): string | null {
  const group = previous?.ok === false && previous.reason === "missing_required_modifiers" ? previous.requiredGroups?.[0] : null;
  if (!group) return null;
  const said = concepts(heard);
  const scored = (group.options || []).map((o: any) => String(typeof o === "string" ? o : o.name)).map((name: string) => ({ name, s: overlap(name, said) })).sort((a: any, b: any) => b.s - a.s);
  if (!scored.length || scored[0].s <= 0 || (scored[1] && scored[1].s === scored[0].s)) return null;
  return scored[0].name;
}

/** Choices already answered in a follow-up are kept, whatever the resolver reads from the words. */
export function applyChosen(result: any, chosen: any[], items: MenuItem[], text: string) {
  if (!result || !chosen.length) return result;
  const ids = new Set(chosen.map((c) => c.groupId));
  if (result.ok === false && result.reason === "missing_required_modifiers") {
    const item = items.find((m) => m.id === result.selectedItem?.itemId);
    const filled = chosen.map((c) => {
      const g: any = item?.modifierGroups?.find((x) => x.id === c.groupId);
      const o: any = (g?.options || []).map((x: any) => (typeof x === "string" ? { name: x } : x)).find((x: any) => x.name === c.option);
      return { groupId: c.groupId, groupName: c.groupName, option: c.option, optionId: o?.id, priceDeltaCents: o?.priceDeltaCents || 0, quantity: 1 };
    });
    const provided = [...(result.provided || []).filter((p: any) => !ids.has(p.groupId)), ...filled];
    const open = (result.requiredGroups || []).filter((g: any) => !ids.has(g.groupId));
    if (!open.length && item) {
      return { ok: true, actions: [{ type: "add_item", itemId: item.id, quantity: leadingQuantity(text), modifiers: provided }], selectedItem: result.selectedItem };
    }
    return { ...result, requiredGroups: open, provided };
  }
  return result;
}

/** One follow-up answer: either the asked group's option, or more words about the dish. */
export function followUpStep(run: (t: string) => any, said: string, chosen: any[], answer: string, items: MenuItem[], language: any = "en") {
  const before = applyChosen(run(said), chosen, items, said);
  // While the size/variation is still open, the answer picks it; groups come after.
  // Only a size/kind question if that is what the customer was actually asked.
  const open = (variationQuestion(before, items, said, language) as any)?.reason === "choose_variation";
  let opt = open ? null : answerForAskedGroup(before, answer);
  let g: any = opt ? before.requiredGroups[0] : null;
  // Not the asked group? It may answer one of the other open ones ("24 flour" while rice is asked).
  // One answer can fill several open questions ("pastor y solo arroz"), fix9.
  const extra: any[] = [];
  for (const other of (before?.requiredGroups || [])) {
    if (open || (g && other.groupId === g.groupId)) continue;
    const o = answerForAskedGroup({ ...before, requiredGroups: [other] }, answer);
    if (o) { if (!opt) { opt = o; g = other; } else extra.push({ groupId: other.groupId, groupName: other.groupName, option: o }); }
  }
  // A group that tied because another group's answer shares a word ("solo rice" vs meat "Arroz"):
  // retry it without the words the other answers used.
  if (!open && (opt || extra.length)) {
    const used = new Set([opt, ...extra.map((e) => e.option)].filter(Boolean).flatMap((n: any) => String(n).toLowerCase().split(/[^a-z]+/)).map((w) => SYNONYM_OF(w)));
    const rest = answer.split(/\s+/).filter((w) => !used.has(SYNONYM_OF(w.toLowerCase()))).join(" ");
    for (const other of (before?.requiredGroups || [])) {
      if ((g && other.groupId === g.groupId) || extra.some((e) => e.groupId === other.groupId) || !rest) continue;
      const o = answerForAskedGroup({ ...before, requiredGroups: [other] }, rest);
      if (o) extra.push({ groupId: other.groupId, groupName: other.groupName, option: o });
    }
  }
  let nextChosen = [...chosen, ...extra];
  let nextSaid = said;
  if (opt) {
    nextChosen = [...nextChosen, { groupId: g.groupId, groupName: g.groupName, option: opt }];
  } else if (open || !(before?.requiredGroups || []).length) {
    nextSaid = `${said} ${answer}`.trim();
  }
  // Otherwise the size is settled and the answer fits no open question: keep what we have and ask again.
  return { result: applyChosen(run(nextSaid), nextChosen, items, nextSaid), said: nextSaid, chosen: nextChosen };
}

/**
 * Words that only picked the size/kind ("half pollo" → Half Pollo Fajitas Pan) must not also fill a
 * group ("half" → Half Beans Pan). Returns the text without them once a single sku is chosen.
 */
export function withoutSkuWords(text: string, chosen: MenuItem[], all: MenuItem[]): string {
  if (chosen.length !== 1 || all.length < 2) return text;
  const wordsOf = (m: MenuItem) => new Set(String(m.readbackName || m.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  // Only the words that tell this sku apart (not "ceviche" / "fajitas", which every sku has).
  const words = new Set([...wordsOf(chosen[0])].filter((w) => !all.every((m) => wordsOf(m).has(w))));
  return String(text).split(/\s+/).filter((w) => !words.has(w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""))).join(" ");
}

/**
 * fix16 (Carlos): the included salsa (e.g. "(I) Salsa Preferencia / Preference", "(D) Salsa Options")
 * defaults to the free mild Salsa Asada — applied silently and read back, the same on web, chat and voice.
 * Verde (medium), Roja (hot), Tomato, Guacamole only when the customer asks; "sin salsa" leaves it empty.
 * Rule sheet: data/rules/salsa-default-rules.csv (group_pattern,default_option).
 */
let salsaRules: Array<{ group: RegExp; option: string }> | null = null;
function salsaDefaultRules() {
  if (salsaRules) return salsaRules;
  salsaRules = [];
  try {
    const raw = fs.readFileSync(new URL("../data/rules/salsa-default-rules.csv", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/).slice(1)) {
      const cells = [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map((m) => (m[1] ?? m[2] ?? "").replace(/""/g, '"').trim());
      if (cells.length >= 2 && cells[0] && cells[1]) salsaRules.push({ group: new RegExp(cells[0], "i"), option: cells[1] });
    }
  } catch { /* fall back below */ }
  if (!salsaRules.length) salsaRules.push({ group: /\bsalsa\b.*\b(preferencia|preference|options)\b/i, option: "Mild Salsa Asada" });
  return salsaRules;
}
const cleanOpt = (o: any) => String(typeof o === "string" ? o : o?.name || "").replace(/\s*\(\+?\$[\d.]+\)\s*$/, "").trim();
const isAddOnGroup = (name: string) => /^\W*(\(\w+\)\s*)?(extra|add)\b|\b\d\s*oz\b/i.test(name);

/** The item's included-salsa groups with their free default option (only groups that have one). */
export function includedSalsaDefaults(item: any): Array<{ group: any; option: any }> {
  const out: Array<{ group: any; option: any }> = [];
  for (const g of item?.modifierGroups || []) {
    const name = String(g?.name || "");
    if (isAddOnGroup(name)) continue;
    const rule = salsaDefaultRules().find((r) => r.group.test(name));
    if (!rule) continue;
    const opt = (g.options || []).find((o: any) => cleanOpt(o).toLowerCase() === rule.option.toLowerCase() && !Number((o as any)?.priceDeltaCents || 0));
    if (opt) out.push({ group: g, option: opt });
  }
  return out;
}

/** What the customer asked for, salsa-wise: "none", a variant word, "conflict", or null (nothing said). */
export function salsaAsk(text: string): { kind: "none" | "conflict" | "variant" | null; variant?: RegExp; double?: boolean } {
  // "chicharrón verde" / "chile verde" / "mole verde" name the dish, not the salsa (fix11).
  const t = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bchicharr\w*\s+(en\s+)?(chile\s+)?(verdes?|rojos?)\b/g, " chicharron ")
    .replace(/\b(chile|mole|pozole)\s+(verdes?|rojos?)\b/g, " ");
  if (/\b(sin|no|without)\s+(la\s+)?salsas?\b|\bno\s+sauce\b/.test(t)) return { kind: "none" };
  const salsaCtx = /\bsalsas?\b|\bsauce\b/.test(t);
  const wants: RegExp[] = [];
  if (/\bverde\b/.test(t) || (salsaCtx && /\b(medium|green)\b/.test(t))) wants.push(/verde/i);
  if (/\broja\b/.test(t) || (salsaCtx && /\b(hot|red|picante|spicy)\b/.test(t))) wants.push(/roja/i);
  if (salsaCtx && /\b(tomat[eo]|tomato)\b/.test(t)) wants.push(/tomato/i);
  if (salsaCtx && /\bguacamole\b/.test(t)) wants.push(/guacamole/i);
  if (wants.length > 1) return { kind: "conflict" };
  // fix19: a named salsa with the other's heat ("verde hot", "roja medium") is a conflict even without "salsa".
  if (/\bverde\b/.test(t) && /\b(hot|picante|spicy|red)\b/.test(t)) return { kind: "conflict" };
  if (/\broja\b/.test(t) && /\b(medium|mild|green|suave)\b/.test(t)) return { kind: "conflict" };
  if (wants.length === 1) return { kind: "variant", variant: wants[0], double: /\b(doble|double)\s+salsa|\bsalsa\s+\w*\s*(doble|double)\b/.test(t) };
  return { kind: null };
}

/**
 * Adds the included salsa to each add_item without one. Modifier shape follows the action:
 * resolver shape { groupId, groupName, option, optionId, priceDeltaCents, quantity } or Elvi shape { step, option }.
 */
export function withDefaultSalsa<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text = "", shape: "elvi" | "resolver" = "resolver"): T[] {
  if (!Array.isArray(actions) || !actions.length) return actions;
  const ask = salsaAsk(text);
  if (ask.kind === "none" || ask.kind === "conflict") return actions;
  return actions.map((a: any) => {
    if (a?.type !== "add_item") return a;
    const item = (menu || []).find((m: any) => m.id === a.itemId);
    const groups = item ? includedSalsaDefaults(item) : [];
    if (!groups.length) return a;
    const mods = Array.isArray(a.modifiers) ? [...a.modifiers] : [];
    const elviShape = shape === "elvi";
    let changed = false;
    for (const { group, option } of groups) {
      const names = new Set((group.options || []).map((o: any) => String(typeof o === "string" ? o : o.name)));
      const has = mods.some((m: any) => m && (m.groupId === group.id || m.step === group.name || m.groupName === group.name || (names.has(String(m.option)) && /salsa/i.test(String(m.option)))));
      if (has) continue;
      let pick: any = option;
      if (ask.kind === "variant") {
        const opts = (group.options || []).filter((o: any) => ask.variant!.test(cleanOpt(o)));
        pick = opts.find((o: any) => (ask.double ? /double|doble/i.test(cleanOpt(o)) : !/double|doble/i.test(cleanOpt(o)))) || null;
        if (!pick) continue; // asked for a salsa this dish doesn't have: leave it for the resolver / staff
      }
      const name = String(typeof pick === "string" ? pick : pick.name);
      mods.push(elviShape
        ? { step: group.name, option: name, ...(pick === option ? { isDefault: true } : {}) }
        : { groupId: group.id, groupName: group.name, option: name, optionId: pick.id, priceDeltaCents: Number(pick.priceDeltaCents || 0), quantity: 1, ...(pick === option ? { isDefault: true } : {}) });
      changed = true;
    }
    return changed ? { ...a, modifiers: mods } : a;
  });
}

/** fix17: the dish words without the salsa words ("2 tacos de pastor salsa verde hot" → "2 tacos de pastor"). */
export function withoutSalsaWords(text: string) {
  return String(text || "")
    // The chicharrón kind is a dish word, not a salsa (fix11).
    .replace(/\bchicharr([oó])n(es)?\s+(en\s+)?(chile\s+)?verdes?\b/gi, "chicharr$1n duro")
    .replace(/\bchicharr([oó])n(es)?\s+(en\s+)?(chile\s+)?roj[oa]s?\b/gi, "chicharr$1n prensado")
    .replace(/\b(con|with)?\s*(la\s+)?(salsas?|sauce)\s+(de\s+)?asada\b/gi, " ")
    .replace(/\b((con|with|y|and|o|or|e)\s+)?(la\s+)?(salsas?|sauce|verdes?|roj[oa]s?|tomate|tomato|mild|medium|hot|picante|green|red|spicy)\b/gi, " ")
    .replace(/\s+(con|with|y|and|o|or)\s*$/i, "")
    .replace(/\s+/g, " ").trim();
}

/** fix17: the answer to "¿Qué salsa…?" as words the resolver understands ("" = the mild Asada default). */
export function salsaAnswerWords(text: string): string | null {
  const t = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const said = [/\b(verde|medium|green)\b/.test(t) && "salsa verde", /\b(roja|rojo|hot|red|picante|spicy)\b/.test(t) && "salsa roja", /\b(tomate|tomato)\b/.test(t) && "salsa tomate", /\b(asada|mild|suave)\b/.test(t) && ""].filter((x) => x !== false);
  if (said.length !== 1) return null;
  return said[0] as string;
}

/**
 * ui2: burrito fillings said in words ("con frijoles y doble crema") go into the burrito's Options group —
 * DOUBLE twin when "doble/double/extra" comes first — not into the meat list (Frijoles Refritos is also a
 * "meat" choice) and never as Deluxe unless the caller said deluxe.
 */
const FILLINGS: Array<{ re: string; key: RegExp }> = [
  { re: "frijol(?:es)?(?:\\s+refritos)?|refried\\s+beans|beans", key: /frijol/i },
  { re: "arroz|rice", key: /arroz/i },
  { re: "queso\\s+fresco|cheese", key: /queso\s+fresco/i },
  { re: "crema|sour\\s+cream", key: /^crema/i },
  { re: "cebolla|onion", key: /cebolla/i },
  { re: "cilantro", key: /cilantro/i },
  { re: "queso\\s+dip", key: /queso\s+dip/i },
  { re: "guacamole\\s+dip", key: /guacamole\s+dip/i },
];
export function fixBurritoFillings<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text = "", shape: "elvi" | "resolver" = "resolver"): T[] {
  if (!Array.isArray(actions) || !actions.length) return actions;
  // tw10 (Carlos): on a burrito, "con todo" / "with everything" = every included filling of the website's
  // Burrito Options group: free and not DOUBLE (frijoles, arroz, queso fresco, crema, cebolla, cilantro).
  const said = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const conTodo = /\b(con\s+todo|con\s+de\s+todo|with\s+everything|everything\s+on\s+it)\b/.test(said);
  // "con todo sin cebolla" / "with everything but no onion": drop the named fillings.
  const negated = FILLINGS.filter((f) => new RegExp(`\\b(?:sin|no|without|but\\s+no|except|menos|hold\\s+the)\\s+(?:(?:el|la|los|las|the|de|y|ni|or|nor)\\s+)?(?:\\w+\\s+(?:y|ni|and|or|nor)\\s+)?(?:${f.re})\\b`).test(said));
  const isNegated = (opt: string) => negated.some((f) => f.key.test(cleanOpt(opt).replace(/^\W*double\s+/i, "")));
  if (!conTodo && !FILLINGS.some((f) => new RegExp(`\\b(${f.re})\\b`).test(said))) return actions;
  const saysDeluxe = /\b(deluxe|de\s+lujo|preparad[oa])\b/.test(said);
  return actions.map((a: any) => {
    if (a?.type !== "add_item") return a;
    const item = (menu || []).find((m: any) => m.id === a.itemId);
    const fill: any = (item?.modifierGroups || []).find((g: any) => /burrito\s+(combo\s+)?options/i.test(g.name) && !/salsa/i.test(g.name));
    if (!fill) return a;
    const groupOf = (m: any) => (item.modifierGroups || []).find((g: any) => g.id === m.groupId || g.name === m.step || g.name === m.groupName);
    const meatG: any = (item.modifierGroups || []).find((g: any) => /carne|meat/i.test(g.name));
    let mods: any[] = Array.isArray(a.modifiers) ? [...a.modifiers] : [];
    const wanted: any[] = [];
    for (const f of FILLINGS) {
      const m = said.match(new RegExp(`\\b(?:(doble|double|extra)\\s+(?:de\\s+)?)?(${f.re})\\b`));
      if (!m) continue;
      const base = (fill.options || []).find((o: any) => f.key.test(cleanOpt(o.name)) && !/^\W*double/i.test(o.name));
      const twin = base && (fill.options || []).find((o: any) => /^\W*double/i.test(o.name) && f.key.test(cleanOpt(String(o.name).replace(/^\W*double\s+/i, ""))));
      const pick = m[1] && twin ? twin : base;
      if (pick) wanted.push({ pick, key: f.key });
    }
    if (conTodo) {
      const priceOf = (o: any) => (typeof o === "object" && o ? Number(o.priceDeltaCents) || 0 : 0) || (/\(\+\$\s*[1-9]|\(\+\$\s*0\.[1-9]/.test(String(o?.name || o)) ? 1 : 0);
      for (const o of fill.options || []) {
        const name = String(typeof o === "string" ? o : o.name || "");
        if (/^\W*double\b/i.test(name) || priceOf(o) > 0 || isNegated(name)) continue;
        const key = new RegExp(`^${cleanOpt(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
        if (!wanted.some((w) => w.pick === o || w.key.test(cleanOpt(name)))) wanted.push({ pick: typeof o === "string" ? { name: o } : o, key });
      }
    }
    if (!wanted.length) return a;
    // Meat picks that are really fillings ("asada con frijoles"), when a real meat was also chosen.
    const meatPicks = mods.filter((m) => groupOf(m) === meatG);
    const fillingMeat = (m: any) => wanted.some((w) => w.key.test(cleanOpt(m.option)));
    const meatWord = FILLINGS.find((f) => new RegExp(`\\b(?:burrito|bowl)s?\\s+(?:\\w+\\s+)?de\\s+(${f.re})\\b`).test(said));
    if (meatWord && !/relleno/.test(said)) mods = mods.filter((m) => !(groupOf(m) === meatG && /relleno/i.test(m.option)));
    if (meatWord) {
      wanted.splice(0, wanted.length, ...wanted.filter((w) => w.key !== meatWord.key));
      mods = mods.filter((m) => !(groupOf(m) === fill && meatWord.key.test(cleanOpt(String(m.option).replace(/^\W*double\s+/i, "")))));
    } else if (meatPicks.some((m) => !fillingMeat(m))) mods = mods.filter((m) => !(groupOf(m) === meatG && fillingMeat(m)));
    if (!saysDeluxe) mods = mods.filter((m) => !/deluxe/i.test(String(groupOf(m)?.name || m.step || m.groupName || "")));
    mods = mods.filter((m) => groupOf(m) !== fill || !wanted.some((w) => w.key.test(cleanOpt(String(m.option).replace(/^\W*double\s+/i, "")))));
    if (negated.length) {
      wanted.splice(0, wanted.length, ...wanted.filter((w) => !isNegated(String(w.pick?.name || ""))));
      mods = mods.filter((m) => groupOf(m) !== fill || !isNegated(String(m.option || "")));
    }
    for (const { pick } of wanted) {
      mods.push(shape === "elvi"
        ? { step: fill.name, option: pick.name }
        : { groupId: fill.id, groupName: fill.name, option: pick.name, optionId: pick.id, priceDeltaCents: Number(pick.priceDeltaCents || 0), quantity: 1 });
    }
    return { ...a, modifiers: mods };
  });
}

/**
 * fix20 (Carlos): meats named with the dish ("sopesazo de bistec con chorizo", "tacos de harina de tripas")
 * fill that dish's Carne/Meat group, up to the website max (Sopesaso Elvis allows 2). If the caller names
 * more meats than max, leave meats unset so Elvi asks — never silently drop extras.
 */
const meatOptSaid = (optName: string, said: string) => {
  const clean = cleanOpt(optName).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/^solo\s+/i.test(clean) && !/\bsolo\s+/i.test(said)) return false; // "Solo Frijoles" needs "solo"
  if (/bistec|steak/.test(clean) && /\b(bistec|asada|steak|campechana)\b/.test(said)) return true;
  if (/chorizo/.test(clean) && /\b(chorizo|campechana)\b/.test(said)) return true; // fix23: campechana = bistec+chorizo
  if (/al\s*pastor|alpastor/.test(clean) && /\b(al\s*pastor|alpastor|pastor)\b/.test(said)) return true;
  if (/tripas?/.test(clean) && /\b(tripas?|tepa|tipa|trepa)\b/.test(said)) return true; // fix21 STT
  // Skip glue words so "Shredded Beef with Potatoes" does not match every "with …" order (fix20).
  const stop = new Set(["with", "and", "con", "de", "del", "la", "el", "los", "las", "the", "of", "y", "a", "an", "or", "para", "por"]);
  const [es, en] = clean.split("/").map((s) => s.trim());
  for (const part of [es, en].filter(Boolean)) {
    for (const w of part.split(/\s+/).filter((x) => x.length >= 4 || /^(pollo|buche|duro|mole|huevo)$/.test(x))) {
      if (stop.has(w)) continue;
      const stem = w.replace(/s$/, "");
      if (stem.length < 3 || stop.has(stem)) continue;
      if (new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(said)) return true;
    }
  }
  return false;
};
export function fixNamedMeats<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text = "", shape: "elvi" | "resolver" = "resolver"): T[] {
  if (!Array.isArray(actions) || !actions.length) return actions;
  const said = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!said.trim()) return actions;
  // fix21: "una de chorizo, una de tepa y otra de buche" is one meat per line (already split) —
  // do NOT stack every named meat onto each add (that trips maxSelections and strips them all).
  const oneEachHits = said.match(/\b(?:una?|uno|otra?|otro|another|one)\s+de\b/g);
  if (oneEachHits && oneEachHits.length >= 2) return actions;
  return actions.map((a: any) => {
    if (a?.type !== "add_item") return a;
    const item = (menu || []).find((m: any) => m.id === a.itemId);
    const meatG: any = (item?.modifierGroups || []).find((g: any) => /carne|meat/i.test(g.name));
    if (!meatG) return a;
    const opts = (meatG.options || []).map((o: any) => (typeof o === "string" ? { name: o } : o)).filter((o: any) => o?.name && !/^\W*double\b/i.test(o.name));
    const hits = opts.filter((o: any) => meatOptSaid(o.name, said));
    // Deduplicate by option id/name (asada+bistec both match Bistec).
    const seen = new Set<string>();
    const named: any[] = [];
    for (const o of hits) {
      const k = String(o.id || o.name);
      if (seen.has(k)) continue;
      seen.add(k);
      named.push(o);
    }
    if (!named.length) return a;
    const max = meatG.maxSelections == null || meatG.maxSelections === 0 ? named.length : Number(meatG.maxSelections);
    if (named.length > max) {
      // Conflict: too many meats for the website rule — strip meats so Elvi asks which ones.
      const mods = (Array.isArray(a.modifiers) ? a.modifiers : []).filter((m: any) => {
        const g = (item.modifierGroups || []).find((x: any) => x.id === m.groupId || x.name === m.step || x.name === m.groupName);
        return g !== meatG;
      });
      return { ...a, modifiers: mods, meatConflict: true, meatNamed: named.map((o) => o.name) };
    }
    let mods: any[] = Array.isArray(a.modifiers) ? a.modifiers.filter((m: any) => {
      const g = (item.modifierGroups || []).find((x: any) => x.id === m.groupId || x.name === m.step || x.name === m.groupName);
      return g !== meatG;
    }) : [];
    for (const pick of named) {
      mods.push(shape === "elvi"
        ? { step: meatG.name, option: pick.name }
        : { groupId: meatG.id, groupName: meatG.name, option: pick.name, optionId: pick.id, priceDeltaCents: Number(pick.priceDeltaCents || 0), quantity: 1 });
    }
    return { ...a, modifiers: mods };
  });
}

/**
 * fix20: "no crema" / "sin cebolla" on a dish with a Toppings (or burrito Options) group removes that
 * topping from the add — never invents another item. Same-breath "con crema" adds the free topping.
 */
const TOPPING_WORDS: Array<{ re: string; key: RegExp }> = [
  { re: "crema|sour\\s+cream", key: /^crema|sour\s+cream/i },
  { re: "cebolla|onion", key: /cebolla|onion/i },
  { re: "cilantro", key: /cilantro/i },
  { re: "lechuga|lettuce", key: /lechuga|lettuce/i },
  { re: "pico(?:\\s+de\\s+gallo)?", key: /pico/i },
  { re: "queso\\s+fresco|fresco\\s+cheese|cheese", key: /queso\s+fresco|fresco\s+cheese/i },
  { re: "frijol(?:es)?(?:\\s+refritos)?|refried\\s+beans|beans", key: /frijol|bean/i },
  { re: "arroz|rice", key: /arroz|rice/i },
];
export function fixToppingNegations<T extends { type: string; itemId?: string; modifiers?: any[] }>(actions: T[], menu: any[], text = "", shape: "elvi" | "resolver" = "resolver"): T[] {
  if (!Array.isArray(actions) || !actions.length) return actions;
  const said = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const negated = TOPPING_WORDS.filter((f) => new RegExp(`\\b(?:sin|no|without|but\\s+no|except|menos|hold\\s+the)\\s+(?:(?:el|la|los|las|the|de|y|ni|or|nor)\\s+)?(?:${f.re})\\b`).test(said));
  const wanted = TOPPING_WORDS.filter((f) => !negated.includes(f) && new RegExp(`\\b(?:con|with)\\s+(?:(?:el|la|los|las|the|doble|double|extra|de)\\s+)*(?:${f.re})\\b`).test(said));
  if (!negated.length && !wanted.length) return actions;
  const isNeg = (opt: string) => negated.some((f) => f.key.test(cleanOpt(opt).replace(/^\W*double\s+/i, "")));
  return actions.map((a: any) => {
    if (a?.type !== "add_item") return a;
    const item = (menu || []).find((m: any) => m.id === a.itemId);
    const fill: any = (item?.modifierGroups || []).find((g: any) => /toppings?|burrito\s+(combo\s+)?options/i.test(g.name) && !/salsa|carne|meat/i.test(g.name));
    if (!fill) return a;
    let mods: any[] = Array.isArray(a.modifiers) ? [...a.modifiers] : [];
    const groupOf = (m: any) => (item.modifierGroups || []).find((g: any) => g.id === m.groupId || g.name === m.step || g.name === m.groupName);
    if (negated.length) mods = mods.filter((m) => groupOf(m) !== fill || !isNeg(String(m.option || "")));
    for (const f of wanted) {
      if (mods.some((m) => groupOf(m) === fill && f.key.test(cleanOpt(String(m.option || "").replace(/^\W*double\s+/i, ""))))) continue;
      const base = (fill.options || []).map((o: any) => (typeof o === "string" ? { name: o } : o)).find((o: any) => f.key.test(cleanOpt(o.name)) && !/^\W*double/i.test(o.name));
      if (!base) continue;
      mods.push(shape === "elvi"
        ? { step: fill.name, option: base.name }
        : { groupId: fill.id, groupName: fill.name, option: base.name, optionId: base.id, priceDeltaCents: Number(base.priceDeltaCents || 0), quantity: 1 });
    }
    return { ...a, modifiers: mods };
  });
}

