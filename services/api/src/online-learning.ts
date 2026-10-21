// learn1 (Carlos): learn from customers who order themselves online. Read-only aggregate of PAID Square Online orders:
// item / modifier / combo frequencies + common free-text notes → data/learning/online-orders.json (gitignored).
// Never stores names, phone numbers, addresses, emails, order ids or exact times.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isOnlineOrder } from "./call-accuracy.js";

export const LEARNING_FILE = process.env.ELVI_LEARNING_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/learning/online-orders.json");
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
/** Paid = completed, or has a captured payment (net amount > 0). */
export const isPaid = (o: any) => /^COMPLETED$/i.test(String(o?.state || "")) || Number(o?.net_amounts?.total_money?.amount ?? o?.total_money?.amount ?? 0) > 0 && (o?.tenders || []).length > 0;
/** Free-text note → safe phrase, or null if it could hold personal data (digits runs, emails, street words, long). */
export function safeNote(t: string): string | null {
  const s = norm(t).replace(/[^\p{L}\p{N}\s,.'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!s || s.length > 60) return null;
  if (/\d{3,}|@|\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|lane|ln|ct|court|apt|unit|suite|calle|avenida|call me|text me|my name|llamar|mi nombre)\b/.test(s)) return null;
  return s;
}
type Count = Record<string, number>;
const inc = (m: Count, k: string, n = 1) => { if (k) m[k] = (m[k] || 0) + n; };
const top = (m: Count, n: number, min = 1) => Object.entries(m).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, count: v }));
export function buildOnlineLearning(orders: any[], now = new Date()) {
  const paid = orders.filter((o) => isOnlineOrder(o) && isPaid(o) && (o.line_items || []).length);
  const items: Count = {}, mods: Record<string, Count> = {}, itemOrders: Count = {}, pairs: Count = {}, notes: Count = {}, sizes: Count = {};
  for (const o of paid) {
    const names = new Set<string>();
    for (const li of o.line_items || []) {
      const name = String(li.name || "").trim(); if (!name) continue;
      const q = Number(li.quantity) || 1; inc(items, name, q); names.add(name);
      if (li.variation_name && !/^regular$/i.test(li.variation_name)) inc(sizes, `${name} · ${li.variation_name}`, q);
      mods[name] ||= {}; inc(itemOrders, name);
      for (const m of li.modifiers || []) inc(mods[name], String(m.name || "").trim());
      const n = li.note ? safeNote(li.note) : null; if (n) inc(notes, n);
    }
    const list = [...names].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) inc(pairs, `${list[i]} + ${list[j]}`);
  }
  const byItem = Object.fromEntries(Object.entries(mods).map(([k, m]) => [k, { orders: itemOrders[k], modifiers: top(m, 15).map((x) => ({ ...x, share: Math.round((x.count / itemOrders[k]) * 100) / 100 })) }]));
  return { version: 1, generatedAt: now.toISOString(), source: "Square Online, paid orders (read-only)", orders: paid.length,
    items: top(items, 60), variations: top(sizes, 30), modifiersByItem: byItem, combos: top(pairs, 30, 2), notes: top(notes, 30, 2) };
}
/** Usual modifiers for an item (share ≥ minShare) — for Elvi suggestions/defaults. */
export function usualModifiers(itemName: string, minShare = 0.5, file = LEARNING_FILE): string[] {
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return (j.modifiersByItem?.[itemName]?.modifiers || []).filter((m: any) => m.share >= minShare).map((m: any) => m.name); } catch { return []; }
}
export function writeOnlineLearning(data: ReturnType<typeof buildOnlineLearning>, file = LEARNING_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
}

// ---- suggest1 (Carlos): ONE offer/question per item. Reply only — an option is added only after the customer says yes.
// Sources: (1) Carlos's house offers (quesadilla comal de prensado/duro → "¿la quiere con frijoles?" = paid Con Frijoles +$0.50);
// (2) learned from paid online orders (share ≥ 60 %, item in ≥ 15 orders; free or paid options). Never overrides what was said.
export const SUGGEST_MIN_SHARE = 0.6, SUGGEST_MIN_ORDERS = 15;
let learnCache: { mtime: number; data: any } | null = null;
export function loadLearning(file = LEARNING_FILE): any | null {
  try { const st = fs.statSync(file); if (!learnCache || learnCache.mtime !== st.mtimeMs) learnCache = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(file, "utf8")) }; return learnCache.data; }
  catch { return null; } // missing / unreadable → learned offers off (house offers still work)
}
const baseItem = (n: string) => norm(String(n || "").replace(/\(online\)/i, ""));
const plain = (o: string) => norm(String(o || "").replace(/\(\+?\$[^)]*\)/g, "").replace(/\*+/g, ""));
const SKIP_GROUP = /carne|meat|salsa|tortilla|size|tama[nñ]o|drink|bebida|agua|option meal|deluxe/i;
const OK_GROUP = /option|topping|con \/ with|with|con\b/i;
/** House rules own these items' toppings (sopesaso/huarache con todo) — never offer there. */
const HOUSE_RULE_ITEM = /\bsopes(?:aso|azo)?s?\b|\b[hg]uaraches?\b/i;
const BEANS_SAID = /\b(?:frijol(?:es|itos)?|beans?)\b/;
const short = (opt: string, lang: "es" | "en") => { const [es, en] = plain(opt).replace(/\(.*?\)/g, "").split("/").map((x) => x.trim().replace(/^(?:con|with|extra)\s+/, "")); return lang === "en" ? en || es : es || en; };
const list = (xs: string[], lang: "es" | "en") => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${lang === "es" ? "y" : "and"} ${xs[xs.length - 1]}`;
const optOf = (o: any) => (typeof o === "string" ? { name: o } : o);
const priceOf = (o: any) => Number(o?.priceDeltaCents ?? o?.priceCents ?? (/\(\+\$(\d+(?:\.\d+)?)\)/.exec(String(o?.name || ""))?.[1] ? Math.round(Number(/\(\+\$(\d+(?:\.\d+)?)\)/.exec(String(o.name))![1]) * 100) : 0));
export type Offer = { options: Array<{ group: string; option: string; priceDeltaCents: number }>; text: string; source: "house" | "learned" };
function findOpt(item: any, re: RegExp) { for (const g of item?.modifierGroups || []) for (const o of g.options || []) if (re.test(plain(optOf(o).name))) return { g, o: optOf(o) }; return null; }
/** (1) House offers. */
function houseOffer(item: any, chosen: string[], said: string, lang: "es" | "en"): Offer | null {
  if (!/^quesadilla$/i.test(String(item?.name || "").trim())) return null;
  const ch = chosen.map(plain);
  if (!ch.some((c) => /^(?:prensado|duro)\b/.test(c))) return null; // chicharrón prensado / duro
  if (ch.some((c) => /harina|flour/.test(c))) return null; // comal (regular) only
  if (BEANS_SAID.test(said) || ch.some((c) => /frijol|bean/.test(c))) return null; // said with/without beans, or already on it
  const f = findOpt(item, /^con frijoles \/ with beans$/); if (!f) return null;
  const p = priceOf(f.o), money = `$${(p / 100).toFixed(2)}`;
  return { source: "house", options: [{ group: f.g.name, option: f.o.name, priceDeltaCents: p }],
    text: lang === "es" ? `¿La quiere con frijoles? Son ${money} más.` : `Would you like it with beans? It's ${money} more.` };
}
/** (2) Learned offer: commonly chosen options in one group the customer left unspecified. */
export function learnedSuggestion(item: { name: string; modifierGroups?: any[] }, chosen: string[], heard: string, lang: "es" | "en", learning = loadLearning()): Offer | null {
  if (!learning?.modifiersByItem || !item?.name || HOUSE_RULE_ITEM.test(item.name)) return null;
  const key = Object.keys(learning.modifiersByItem).find((k) => baseItem(k) === baseItem(item.name));
  const stats = key ? learning.modifiersByItem[key] : null;
  if (!stats || Number(stats.orders) < SUGGEST_MIN_ORDERS) return null;
  const said = norm(heard), have = new Set(chosen.map(plain));
  const groups = (item.modifierGroups || []).filter((g: any) => OK_GROUP.test(g.name) && !SKIP_GROUP.test(g.name));
  const picks: Array<{ group: string; option: string; priceDeltaCents: number }> = []; let group: any = null;
  for (const m of stats.modifiers || []) {
    if (m.share < SUGGEST_MIN_SHARE || have.has(plain(m.name))) continue;
    const g = groups.find((x: any) => (x.options || []).some((o: any) => plain(optOf(o).name) === plain(m.name))); if (!g) continue;
    if (group && g.name !== group.name) continue; // one group → one question
    if ((g.options || []).some((x: any) => have.has(plain(optOf(x).name)))) return null; // customer chose in this group
    const w = [short(m.name, "es"), short(m.name, "en")].map((x) => x.split(" ")[0]).filter((x) => x.length > 2).join("|");
    if (w && new RegExp(`\\b(?:${w})`).test(said)) return null; // said it (or "sin …")
    const o = optOf((g.options || []).find((x: any) => plain(optOf(x).name) === plain(m.name)));
    group = g; picks.push({ group: g.name, option: o.name, priceDeltaCents: priceOf(o) });
    if (picks.length === 4) break;
  }
  if (!picks.length) return null;
  const paid = picks.reduce((a, p) => a + p.priceDeltaCents, 0);
  const names = list(picks.map((p) => short(p.option, lang)), lang);
  const cost = paid ? (lang === "es" ? ` Son $${(paid / 100).toFixed(2)} más.` : ` It's $${(paid / 100).toFixed(2)} more.`) : "";
  return { source: "learned", options: picks, text: lang === "es" ? `La mayoría la pide con ${names}. ¿La quiere así?${cost}` : `Most people get it with ${names}. Want it that way?${cost}` };
}
export function offerFor(item: any, chosen: string[], heard: string, lang: "es" | "en", learning?: any): Offer | null {
  if (!item || HOUSE_RULE_ITEM.test(String(item.name || ""))) return null;
  return houseOffer(item, chosen, norm(heard), lang) || learnedSuggestion(item, chosen, heard, lang, learning === undefined ? loadLearning() : learning);
}
const offeredBySession = new Map<string, Set<string>>();
export const pendingOffer = new Map<string, { itemId: string; offer: Offer; at: number }>();
/** Elvi reply: on a single-item add readback, swap the final "¿Algo más?" for one offer (actions untouched). */
export function withLearnedSuggestion<R extends { reply?: string; actions?: any[] }>(result: R, opts: { sessionKey?: string; heard: string; lang: "es" | "en"; menu: any[]; learning?: any }): R {
  const adds = (result?.actions || []).filter((a: any) => a?.type === "add_item");
  if (adds.length !== 1 || (result.actions || []).length !== 1 || !/(¿Algo más\?|Anything else\?)\s*$/.test(String(result.reply || ""))) return result;
  const a = adds[0], item = (opts.menu || []).find((m: any) => m.id === a.itemId);
  if (!item) return result;
  const sk = opts.sessionKey || "", done = offeredBySession.get(sk) || new Set<string>();
  if (sk && done.has(item.id)) return result; // at most one offer per item
  const s = offerFor(item, (a.modifiers || []).map((m: any) => m.option), opts.heard, opts.lang, opts.learning);
  if (!s) return result;
  if (sk) { done.add(item.id); offeredBySession.set(sk, done); pendingOffer.set(sk, { itemId: item.id, offer: s, at: Date.now() }); if (offeredBySession.size > 2000) { offeredBySession.clear(); pendingOffer.clear(); } }
  return { ...result, reply: String(result.reply).replace(/(¿Algo más\?|Anything else\?)\s*$/, s.text), audioBase64: undefined, audioMimeType: undefined, suggestion: s.options.map((o) => o.option), offerText: s.text } as R;
}
const YES = /^\s*(?:s[ií]|sip|claro|[oó]rale|bueno|va|dale|por favor|yes|yeah|yep|sure|ok(?:ay)?|please|sounds good)(?:[\s,.!]+(?:s[ií]|por favor|please|gracias|thanks?|thank you|con (?:frijoles|todo)|with (?:beans|it)|as[ií]|that way))*[\s.!]*$/iu;
const NO = /^\s*(?:no|nah|nope|no gracias|no,? thanks?|as[ií] est[aá] bien|sin (?:frijoles|nada)|without|no beans|just like that)(?:[\s,.!]+(?:gracias|thanks?|thank you|as[ií] est[aá] bien))*[\s.!]*$/iu;
/** Answer to the pending offer: yes → the offered options (one update to that item); no → nothing. null = not an answer. */
export function offerAnswer(sessionKey: string | undefined, text: string, lastReply?: string): { yes: boolean; itemId: string; offer: Offer } | null {
  const p = sessionKey ? pendingOffer.get(sessionKey) : undefined;
  if (!p || Date.now() - p.at > 30 * 60_000) return null;
  // Only an answer to Elvi's own question (phone listen-only: a "sí" to staff must never add anything).
  if (lastReply !== undefined && !String(lastReply).trim().endsWith(p.offer.text)) { pendingOffer.delete(sessionKey!); return null; }
  const yes = YES.test(text), no = !yes && NO.test(text);
  if (!yes && !no) { pendingOffer.delete(sessionKey!); return null; } // anything else: drop the offer, normal flow
  pendingOffer.delete(sessionKey!);
  return { yes, itemId: p.itemId, offer: p.offer };
}
