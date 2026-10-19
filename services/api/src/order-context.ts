import { rbOptionLabel, rbFormat } from "./readback.js";
import { PACK_WORD } from "./pre-turn.js";
/**
 * Persistent order context (fix7): the dish being built and its open slots live on the server, per
 * session, until the order is submitted or canceled — not just in the last message.
 *  - "4 tacos 2 bistec" keeps "2 more tacos, meat?" open; "2 chorizo" / "dos de choriso" fills it.
 *  - A word that is an option of the pending dish is never answered with "not available".
 *  - If an answer doesn't parse, the dish stays and Elvi asks again ("¿Los otros 2 tacos de qué carne?").
 *  - Every turn is logged to data/logs/sessions/<day>-<session>.jsonl (gitignored) for the learning loop.
 */
import fs from "node:fs";
import path from "node:path";
import type { MenuItem, ModifierGroup } from "./menu.js";
import { normalizeSpokenCatalogAliases } from "./text-intents.js";

type Opt = { id?: string; name: string; priceDeltaCents?: number };
type Fill = { groupId: string; groupName: string; option: string; optionId?: string; priceDeltaCents: number };
type Pending = {
  itemId: string;
  itemName: string;
  qty: number;
  fills: Record<string, Fill>;
  meats: Array<Fill & { qty: number }>;
  said: string[];
  asked?: string;
  clarifications: number;
};
type Ctx = { pending?: Pending; updatedAt: number };

const store = new Map<string, Ctx>();
const TTL_MS = 3 * 60 * 60 * 1000;

export function orderContext(key?: string): Ctx | undefined {
  if (!key) return undefined;
  const c = store.get(key);
  if (c && Date.now() - c.updatedAt > TTL_MS) { store.delete(key); return undefined; }
  return c;
}
export function clearOrderContext(key?: string, reason = "cleared") {
  if (!key) return;
  if (store.has(key)) logTurn(key, { event: reason });
  store.delete(key);
}
export function pendingSummary(key?: string) {
  const p = orderContext(key)?.pending;
  if (!p) return null;
  return { item: p.itemName, qty: p.qty, meats: p.meats.map((m) => `${m.qty} ${m.option}`), fills: Object.values(p.fills).map((f) => f.option), asked: p.asked };
}

const LOG_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../data/logs/sessions");
export function logTurn(key: string | undefined, entry: Record<string, unknown>) {
  if (!key) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
    fs.appendFileSync(path.join(LOG_DIR, `${day}-${safe}.jsonl`), JSON.stringify({ at: new Date().toISOString(), session: safe, ...entry }) + "\n");
  } catch { /* logging never breaks a turn */ }
}

const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, one: 1, a: 1, an: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, doce: 12, twelve: 12 };
const num = (w?: string) => (w ? (/^\d+$/.test(w) ? Number(w) : NUM[w]) : undefined);
const plain = (t: string) => normalizeSpokenCatalogAliases(String(t || ""))
  .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\b(choriso|chorrizo|chorizos)\b/g, "chorizo").replace(/\bbisteck?s?\b/g, "bistec")
  .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const opts = (g: ModifierGroup): Opt[] => (g.options || []).map((o: any) => (typeof o === "string" ? { name: o } : o));
const isMeat = (g: ModifierGroup) => /carne|meat/i.test(g.name) && !/extra/i.test(g.name);
const required = (item: MenuItem) => (item.modifierGroups || []).filter((g) => (g.minSelections ?? 0) > 0);
const short = (name: string) => String(name).replace(/\s*\([+-]\$[\d.]+\)\s*$/, "").replace(/^\(\w+\)\s*/, "").split(" / ")[0].trim();
const STOP = new Set(["con", "with", "the", "and", "de", "del", "la", "el", "beef", "pork", "online", "options", "option"]);

const SYN: Record<string, string> = { street: "taquero", taquera: "taquero", homemade: "comal", flour: "harina", steak: "bistec", asada: "bistec", chicken: "pollo", pastor: "alpastor" };
/** Words that identify each option of a group (words every option shares, like "taco", don't count). */
function optionWords(g: ModifierGroup) {
  const list = opts(g).map((o) => ({ o, words: new Set(plain(o.name.replace(/\s*\([+-]\$[\d.]+\)\s*$/, "")).split(" ").map((w) => SYN[w] || w).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w))) }));
  const common = list.length > 1 ? [...list[0].words].filter((w) => list.every((x) => x.words.has(w))) : [];
  return list.map((x) => ({ o: x.o, words: [...x.words].filter((w) => !common.includes(w)) }));
}

/** Options of a group mentioned in the text, in order, with the count said right before each one. */
function mentions(text: string, g: ModifierGroup) {
  const words = plain(text).split(" ").map((w) => SYN[w] || w);
  const out: Array<{ o: Opt; qty?: number; at: number }> = [];
  for (const { o, words: keys } of optionWords(g)) {
    const at = words.findIndex((w) => keys.includes(w));
    if (at < 0) continue;
    let q: number | undefined;
    for (let j = at - 1; j >= Math.max(0, at - 3); j--) { const n = num(words[j]); if (n) { q = n; break; } if (!["de", "of", "con", "y", "and", "tacos", "taco"].includes(words[j])) break; }
    out.push({ o, qty: q, at });
  }
  return out.sort((a, b) => a.at - b.at);
}
const fillOf = (g: ModifierGroup, o: Opt): Fill => ({ groupId: g.id, groupName: g.name, option: o.name, optionId: o.id, priceDeltaCents: o.priceDeltaCents || 0 });

/** "4 tacos 2 bistec": a quantity with meats that don't cover it, or several meats → keep it as a pending dish. */
function tryStart(text: string, menu: MenuItem[]): Pending | null {
  const t = plain(text);
  if (/\b(pack|paquete|combo|meal)\b/.test(t)) return null;
  const m = t.match(/\b(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(tacos?|quesadillas?|gorditas?|tortas?|burritos?|sopes?)\b/);
  if (!m) return null;
  const qty = num(m[1]) || 0;
  if (qty < 2) return null;
  const noun = m[2].replace(/s$/, "");
  const item = menu.find((i) => plain(i.name) === noun && required(i).some(isMeat));
  if (!item) return null;
  const meat = required(item).find(isMeat)!;
  const rest = t.slice((m.index || 0) + m[0].length);
  const found = mentions(rest, meat);
  const counted = found.reduce((s, f) => s + (f.qty || 0), 0);
  const split = found.length > 1 || (found.length === 1 && found[0].qty && found[0].qty < qty);
  if (!split || counted > qty) return null;
  const p: Pending = { itemId: item.id, itemName: item.name, qty, fills: {}, meats: [], said: [text], clarifications: 0 };
  apply(p, item, rest);
  return p;
}

/** Put whatever the words fill into the pending dish. Returns true if anything was filled. */
function apply(p: Pending, item: MenuItem, text: string) {
  let any = false;
  for (const g of required(item)) {
    if (isMeat(g)) {
      const left = p.qty - p.meats.reduce((s, x) => s + x.qty, 0);
      if (left <= 0) continue;
      const found = mentions(text, g);
      let room = left;
      found.forEach((f, i) => {
        if (room <= 0) return;
        const q = Math.min(room, f.qty || (i === found.length - 1 ? room : 1));
        const same = p.meats.find((x) => x.option === f.o.name);
        if (same) same.qty += q; else p.meats.push({ ...fillOf(g, f.o), qty: q });
        room -= q; any = true;
      });
    } else if (!p.fills[g.id]) {
      const os = opts(g);
      if (os.length === 1) { p.fills[g.id] = fillOf(g, os[0]); continue; }
      const f = mentions(text, g)[0];
      if (f) { p.fills[g.id] = fillOf(g, f.o); any = true; }
      else if ((g as any).defaultOptions?.length) {
        // Site preselect (Comal, Grande) applied silently and read back (fix9).
        const d = os.find((o) => (g as any).defaultOptions.includes(o.name));
        if (d) p.fills[g.id] = fillOf(g, d);
      }
    }
  }
  return any;
}

function nextQuestion(p: Pending, item: MenuItem, es: boolean): string | null {
  const noun = short(item.name).toLowerCase() + "s";
  for (const g of required(item)) {
    if (isMeat(g)) {
      const done = p.meats.reduce((s, x) => s + x.qty, 0);
      const left = p.qty - done;
      if (left <= 0) continue;
      p.asked = g.id;
      const list = opts(g).slice(0, 4).map((o) => short(o.name));
      if (!done) return es ? `${item.name}: ¿de qué carne los ${p.qty} ${noun}? (${list.join(", ")}…)` : `${item.name}: what meat for the ${p.qty} ${noun}? (${list.join(", ")}…)`;
      const had = p.meats.map((m) => `${m.qty} ${rbOptionLabel(m.option, "meat", es ? "es" : "en")}`).join(es ? " y " : " and ");
      return es ? `${item.name}: ya tengo ${had}. ¿Los otros ${left} ${noun} de qué carne?` : `${item.name}: I have ${had}. What meat for the other ${left} ${noun}?`;
    }
    if (!p.fills[g.id]) {
      p.asked = g.id;
      const list = opts(g).map((o) => short(o.name));
      const or = es ? " o " : " or ";
      const had = p.meats.map((m) => `${m.qty} ${rbOptionLabel(m.option, "meat", es ? "es" : "en")}`).join(es ? " y " : " and ");
      const lead = p.meats.length ? (es ? `ya tengo ${had}. ` : `I have ${had}. `) : "";
      return `${item.name}: ${lead}${es ? "¿" : ""}${list.slice(0, -1).join(", ")}${list.length > 1 ? or : ""}${list[list.length - 1]}?`;
    }
  }
  return null;
}

export type ContextTurn = { reply: string; adds: Array<{ itemId: string; quantity: number; modifiers: Fill[] }>; pending: boolean; interpretation: string };

/** fix11: a count that matches a pack of the same tortilla (8 comal tacos) becomes the N Pack MEAL. */
function asPack(p: Pending, item: MenuItem, menu: MenuItem[], lang: string): ContextTurn | null {
  const total = p.meats.reduce((n, m) => n + m.qty, 0);
  if (p.said.some((t) => /\b(sueltos?|sueltas?|individual(es)?|singles?|separad[oa]s?)\b/i.test(t))) return null;
  // fix12: only when the caller said a pack word (pack, meal, paquete, chopack).
  if (!p.said.some((t) => PACK_WORD.test(t))) return null;
  const noun = (String(item.name).match(/^(taco|quesadilla|torta|gordita)\b/i)?.[1] || "").toLowerCase();
  if (!noun) return null;
  const shell = Object.values(p.fills).find((b) => /tortilla|shell/i.test(String(b.groupName)));
  const kind = String(shell?.option || "").match(/comal|harina|taquer/i)?.[0]?.toLowerCase() || "";
  const pack = menu.find((m) => {
    if (!new RegExp(`^${total}\\s*pack\\s+meal\\b`, "i").test(m.name)) return false;
    const rb = String(m.readbackName || m.id).toLowerCase();
    if (!new RegExp(`\\b${noun}s\\b`).test(rb) || /queso/.test(rb)) return false;
    return kind ? rb.includes(kind) : !/comal|harina|taquer/.test(rb);
  });
  if (!pack) return null;
  const meatGroups = (pack.modifierGroups || []).filter((g: any) => /carne|meat/i.test(g.name) && !/extra/i.test(g.name));
  if (meatGroups.length !== total) return null;
  const queue = p.meats.flatMap((m) => Array.from({ length: m.qty }, () => m));
  const mods: Fill[] = [];
  for (let i = 0; i < meatGroups.length; i += 1) {
    const g: any = meatGroups[i];
    const want = String(queue[i].option).split(" / ")[0].replace(/\s*\(\+?\$[\d.]+\)/, "").trim().toLowerCase();
    const o: any = (g.options || []).map((x: any) => (typeof x === "string" ? { name: x } : x)).find((x: any) => String(x.name).replace(/^\s*\d+\s*x\s+/i, "").split(" / ")[0].trim().toLowerCase() === want);
    if (!o) return null;
    mods.push({ groupId: g.id, groupName: g.name, option: o.name, optionId: o.id, priceDeltaCents: o.priceDeltaCents || 0 });
  }
  const cents = (pack.priceCents || 0) + mods.reduce((x, m) => x + (m.priceDeltaCents || 0), 0);
  const reply = rbFormat([{ name: pack.name, alt: pack.readbackName, quantity: 1, mods: mods.map((m) => ({ option: m.option, group: m.groupName })), cents }], lang);
  return { reply, adds: [{ itemId: pack.id, quantity: 1, modifiers: mods }], pending: false, interpretation: `complete ${total} as ${pack.name}` };
}

function finish(p: Pending, item: MenuItem, es: boolean, menu: MenuItem[] = []): ContextTurn {
  const packed = asPack(p, item, menu, es ? "es" : "en");
  if (packed) return packed;
  const base = Object.values(p.fills);
  const adds = p.meats.map((m) => ({ itemId: item.id, quantity: m.qty, modifiers: [...base, { groupId: m.groupId, groupName: m.groupName, option: m.option, optionId: m.optionId, priceDeltaCents: m.priceDeltaCents }] }));
  // fix10: one short read-back ("4 × Taco: pastor, comal; 2 × Taco: asada, comal. $X. ¿Algo más?").
  const lang = es ? "es" : "en";
  const cents = adds.reduce((sum, a) => sum + ((item.priceCents || 0) + a.modifiers.reduce((x, m) => x + (m.priceDeltaCents || 0), 0)) * a.quantity, 0);
  // fix10: one dish split by meat → "8 tacos de comal: 4 pastor, 4 asada. $32.00. ¿Algo más?"
  const noun = String(item.name).split(/[ /(]/).filter(Boolean)[0] || item.name;
  const total = adds.reduce((n, a) => n + a.quantity, 0);
  const shell = base.find((b) => /tortilla|shell/i.test(String(b.groupName)));
  const kind = shell ? rbOptionLabel(shell.option, shell.groupName, lang) : "";
  const plural = total > 1 ? `${noun.toLowerCase()}${/[aeiou]$/i.test(noun) ? "s" : "es"}` : noun.toLowerCase();
  const name = es ? `${total} ${plural}${kind ? (/taquer/.test(kind) ? ` ${kind}s` : ` de ${kind}`) : ""}` : `${total} ${kind ? `${kind} ` : ""}${plural}`;
  const others = base.filter((b) => b !== shell).map((b) => rbOptionLabel(b.option, b.groupName, lang)).filter(Boolean);
  const meats = adds.map((a) => `${adds.length > 1 ? `${a.quantity} ` : ""}${rbOptionLabel(a.modifiers[a.modifiers.length - 1].option, "meat", lang)}`);
  const reply = `${name}: ${[...meats, ...others].join(", ")}. $${(cents / 100).toFixed(2)}. ${es ? "¿Algo más?" : "Anything else?"}`;
  return { reply, adds, pending: false, interpretation: `complete ${p.qty} ${item.name}` };
}

/**
 * Run this first on every channel. Returns a reply when the turn belongs to the pending dish (or starts
 * one); null when the normal flow should handle it (the pending dish stays open).
 */
export function orderContextTurn(key: string | undefined, text: string, menu: MenuItem[], language: string): ContextTurn | null {
  if (!key || !text.trim()) return null;
  const es = language === "es";
  const ctx = orderContext(key) || { updatedAt: Date.now() };
  const t = plain(text);
  if (ctx.pending) {
    const p = ctx.pending;
    const item = menu.find((i) => i.id === p.itemId);
    if (!item) { clearOrderContext(key); return null; }
    if (/\b(cancel|cancela|cancelar|olvida|olvidalo|never ?mind|forget it|ya no)\b/.test(t)) {
      clearOrderContext(key, "canceled");
      return { reply: es ? `Listo, quité los ${p.qty} ${short(item.name).toLowerCase()}s.` : `OK, I dropped the ${p.qty} ${short(item.name).toLowerCase()}s.`, adds: [], pending: false, interpretation: "cancel pending" };
    }
    p.said.push(text);
    if (apply(p, item, text)) {
      p.clarifications = 0;
      const q = nextQuestion(p, item, es);
      ctx.updatedAt = Date.now();
      if (q) { store.set(key, ctx); return { reply: q, adds: [], pending: true, interpretation: `fill ${item.name}` }; }
      delete ctx.pending; store.set(key, ctx);
      return finish(p, item, es, menu);
    }
    // A different dish by name: let the normal flow add it; the tacos stay pending.
    const otherDish = /\b(burrito|quesadilla|torta|gordita|pambazo|menudo|pozole|combo|pack|jarrito|agua|soda|coca|ceviche|coctel|nachos|bowl|enchiladas?|fajitas|chimichanga|sope|huarache|tamal|elote|esquite)\b/.test(t) && !t.includes(short(item.name).toLowerCase());
    if (otherDish) return null;
    p.clarifications += 1;
    const q = nextQuestion(p, item, es) || "";
    store.set(key, { ...ctx, updatedAt: Date.now() });
    const sorry = es ? "Perdón, no te entendí. " : "Sorry, I didn't catch that. ";
    return { reply: sorry + q, adds: [], pending: true, interpretation: "unparsed; kept pending" };
  }
  const started = tryStart(text, menu);
  if (!started) return null;
  const item = menu.find((i) => i.id === started.itemId)!;
  const q = nextQuestion(started, item, es);
  if (!q) return finish(started, item, es, menu);
  store.set(key, { pending: started, updatedAt: Date.now() });
  return { reply: q, adds: [], pending: true, interpretation: `start ${started.qty} ${item.name}` };
}
