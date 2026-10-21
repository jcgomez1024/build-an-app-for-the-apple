// fav1 (Carlos): favorites for repeat customers. History per phone = Square tickets matched by phone (Square Online recipient
// phone + POS phone tickets linked to a call), read-only. Stored ONLY in data/logs/favorites/ (gitignored; personal data).
// ≥ 3 past orders: last 3 identical → "your usual"; otherwise top 3 picks. < 3 → normal greeting (null).
// Every line is re-checked against TODAY's menu + site availability; prices are today's. A "yes" adds exactly that.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { phoneKey, savedCallerName, savedDelivery } from "./caller-memory.js";
import { isOnlineOrder, isEmptyOrder } from "./call-accuracy.js";
import { itemAvailability } from "./site-catalog.js";
import { cachedQuote } from "./delivery-zone.js";

const dir = process.env.ELVI_FAVORITES_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/logs/favorites");
export const FAV_MIN_ORDERS = 3;
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\(online\)/g, "").replace(/\s+/g, " ").trim();
const plain = (o: string) => norm(String(o || "").replace(/\(\+?\$[^)]*\)/g, "").replace(/\*+/g, ""));
export type HLine = { name: string; qty: number; mods: string[] };
export type HOrder = { at: string; source: "online" | "phone"; fulfillment: "PICKUP" | "DELIVERY"; lines: HLine[] };
export type History = Record<string, HOrder[]>; // phoneKey → newest first

const recipientPhone = (o: any) => { for (const f of o?.fulfillments || []) { const r = f.pickup_details?.recipient || f.delivery_details?.recipient || f.shipment_details?.recipient; if (r?.phone_number) return phoneKey(r.phone_number); } return ""; };
const toOrder = (o: any, source: HOrder["source"]): HOrder => ({
  at: String(o.created_at || ""), source,
  fulfillment: (o.fulfillments || []).some((f: any) => /DELIVERY|SHIPMENT/i.test(f.type || "")) ? "DELIVERY" : "PICKUP",
  lines: (o.line_items || []).filter((li: any) => li.name && !/delivery|service fee|env[ií]o/i.test(li.name)).map((li: any) => ({ name: String(li.name).trim(), qty: Number(li.quantity) || 1, mods: (li.modifiers || []).map((m: any) => String(m.name || "").trim()).filter(Boolean).sort() })),
});
export type NameLink = { phone: string; orderId: string; by: "email" | "address" | "distinctive" };
const recip = (o: any) => { for (const f of o?.fulfillments || []) { const r = f.pickup_details?.recipient || f.delivery_details?.recipient || f.shipment_details?.recipient; if (r) return r; } return null; };
/** Full name only (≥ 2 words of ≥ 2 letters); a first name alone is never a link key. */
export const fullNameKey = (raw: unknown) => { const w = norm(String(raw || "")).replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter((x) => x.length >= 2); return w.length >= 2 ? w.join(" ") : ""; };
const emailOf = (o: any) => String(recip(o)?.email_address || "").trim().toLowerCase();
const addrOf = (o: any) => { const a = recip(o)?.address; return a ? norm(`${a.address_line_1 || ""} ${a.postal_code || ""}`).replace(/[^a-z0-9 ]/g, "") : ""; };
const nameOf = (o: any) => fullNameKey(recip(o)?.display_name) || fullNameKey(o?.ticket_name);
/** Build history (phone = primary key). fav3: an order with no phone, or another phone, is also attached to phone P when its
 * full name matches a name on P's orders AND (same email | same address | the name is distinctive = only ever seen with P). */
export function buildHistoryLinked(orders: any[], phoneByOrderId: Record<string, string>): { history: History; links: NameLink[] } {
  const h: History = {}, links: NameLink[] = [];
  const ok = orders.filter((o) => !isEmptyOrder(o) && !/CANCELED/i.test(o.state || ""));
  const phoneOf = (o: any) => { const k = isOnlineOrder(o) ? recipientPhone(o) : phoneKey(phoneByOrderId[o.id] || "") || recipientPhone(o); return k.length === 10 ? k : ""; };
  const ident: Record<string, { names: Set<string>; emails: Set<string>; addrs: Set<string> }> = {}, phonesByName: Record<string, Set<string>> = {};
  for (const o of ok) {
    const k = phoneOf(o); if (!k) continue;
    const ho = toOrder(o, isOnlineOrder(o) ? "online" : "phone"); if (ho.lines.length) (h[k] ||= []).push(ho);
    const id = (ident[k] ||= { names: new Set(), emails: new Set(), addrs: new Set() }), n = nameOf(o), e = emailOf(o), a = addrOf(o);
    if (n) { id.names.add(n); (phonesByName[n] ||= new Set()).add(k); } if (e) id.emails.add(e); if (a) id.addrs.add(a);
  }
  for (const o of ok) {
    const n = nameOf(o); if (!n || !phonesByName[n]) continue;
    const own = phoneOf(o), e = emailOf(o), a = addrOf(o);
    for (const p of phonesByName[n]) {
      if (p === own) continue;
      const by: NameLink["by"] | null = e && ident[p].emails.has(e) ? "email" : a && ident[p].addrs.has(a) ? "address"
        : !own && phonesByName[n].size === 1 ? "distinctive" : null; // a name shared by 2+ phones, or a different phone, needs email/address
      if (!by) continue;
      const ho = toOrder(o, isOnlineOrder(o) ? "online" : "phone"); if (!ho.lines.length) continue;
      (h[p] ||= []).push(ho); links.push({ phone: p, orderId: String(o.id || ""), by });
    }
  }
  for (const k of Object.keys(h)) h[k].sort((a, b) => b.at.localeCompare(a.at));
  return { history: h, links };
}
export const buildHistory = (orders: any[], phoneByOrderId: Record<string, string>) => buildHistoryLinked(orders, phoneByOrderId).history;
const sig = (o: HOrder) => o.lines.map((l) => `${l.qty}x${norm(l.name)}[${l.mods.map(plain).join(",")}]`).sort().join("|");
const itemsSig = (o: HOrder) => o.lines.map((l) => `${l.qty}x${norm(l.name)}`).sort().join("|");
/** fav2: the usual's toppings — per modifier group (today's menu), the choice made most often across the 3 orders
 * ("none" counts as a choice); tie → the most recent order's choice. Orders are newest first. */
export function usualLines(orders: HOrder[], menu: any[]): HLine[] {
  const used = orders.map(() => new Set<number>());
  return orders[0].lines.map((l0) => {
    const same = orders.map((o, k) => { const i = o.lines.findIndex((l, j) => !used[k].has(j) && l.qty === l0.qty && norm(l.name) === norm(l0.name)); if (i >= 0) used[k].add(i); return i >= 0 ? o.lines[i] : null; }).filter(Boolean) as HLine[];
    const item = menu.find((m) => norm(m.name) === norm(l0.name));
    const groupOf = (mod: string) => (item?.modifierGroups || []).find((g: any) => (g.options || []).some((o: any) => plain(o.name) === plain(mod)))?.name || `?${plain(mod)}`;
    const groups = new Set(same.flatMap((l) => l.mods.map(groupOf)));
    const mods: string[] = [];
    for (const g of groups) {
      const choice = same.map((l) => l.mods.filter((m) => groupOf(m) === g).map(plain).sort().join("+"));
      const count = new Map<string, number>(); for (const c of choice) count.set(c, (count.get(c) || 0) + 1);
      const best = Math.max(...count.values()), pick = choice.find((c) => count.get(c) === best)!; // first = most recent on a tie
      if (pick) for (const p of pick.split("+")) mods.push(same.flatMap((l) => l.mods).find((m) => plain(m) === p)!);
    }
    return { ...l0, mods: mods.sort() };
  });
}
const lineSig = (l: HLine) => `${norm(l.name)}[${l.mods.map(plain).join(",")}]`;

export type FavLine = { action: { type: "add_item"; itemId: string; quantity: number; modifiers: Array<{ step: string; option: string }> }; label: { es: string; en: string }; cents: number };
export type Favorites = { kind: "usual" | "top"; orders: number; offers: FavLine[][]; dropped: string[]; greeting: { es: string; en: string }; deliveryNudge: { es: string; en: string } | null };

/** History line → today's menu line (null = not sold / unavailable now). Unknown modifiers are left off. */
export function toTodayLine(l: HLine, menu: any[], available = (id?: string) => itemAvailability(id).available, onUnavailable?: (name: string) => void): FavLine | null {
  const item = menu.find((m) => norm(m.name) === norm(l.name)); if (!item) return null; // not on today's voice menu → skip quietly
  if (!available(item.squareCatalogObjectId)) { onUnavailable?.(String(item.readbackName || item.name)); return null; } // sold out / not now → say so
  const mods: Array<{ step: string; option: string }> = []; let cents = Number(item.priceCents) || 0;
  for (const want of l.mods) for (const g of item.modifierGroups || []) { const o = (g.options || []).find((x: any) => plain(x.name) === plain(want)); if (o) { mods.push({ step: g.name, option: o.name }); cents += Number(o.priceDeltaCents) || 0; break; } }
  const es = String(item.readbackNameEs || item.nameEs || item.readbackName || item.name), en = String(item.readbackName || item.name);
  const q = l.qty > 1 ? `${l.qty} ` : "";
  return { action: { type: "add_item", itemId: item.id, quantity: l.qty, modifiers: mods }, label: { es: q + es, en: q + en }, cents: cents * l.qty };
}
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const list = (xs: string[], y: string) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${y} ${xs[xs.length - 1]}`;

export function favoritesFor(orders: HOrder[] | undefined, menu: any[], opts: { name?: string | null; channel: "app" | "phone"; nudge?: { es: string; en: string } | null; available?: (id?: string) => boolean } ): Favorites | null {
  if (!orders || orders.length < FAV_MIN_ORDERS) return null; // Carlos: < 3 orders → normal greeting
  const dropped = new Set<string>(); const today = (l: HLine) => { return toTodayLine(l, menu, opts.available, (n) => dropped.add(n)); };
  const hi = { es: opts.name ? `Hola ${opts.name}, ` : "Hola, ", en: opts.name ? `Hi ${opts.name}, ` : "Hi, " };
  const last3 = orders.slice(0, 3);
  let fav: Favorites | null = null;
  if (last3.every((o) => itemsSig(o) === itemsSig(last3[0]))) { // Carlos: same items + quantities; toppings may differ
    const lines = usualLines(last3, menu).map(today).filter(Boolean) as FavLine[];
    if (lines.length) {
      const total = lines.reduce((a, l) => a + l.cents, 0);
      fav = { kind: "usual", orders: orders.length, offers: [lines], dropped: [...dropped], deliveryNudge: null, greeting: {
        es: `${hi.es}¿le preparo su favorito, ${list(lines.map((l) => l.label.es), "y")}? Hoy son ${money(total)}.`,
        en: `${hi.en}would you like your usual, ${list(lines.map((l) => l.label.en), "and")}? It's ${money(total)} today.` } };
    }
  }
  if (!fav) { // top 3 distinct lines by how many orders had them
    const count = new Map<string, { n: number; line: HLine }>();
    for (const o of orders) for (const l of o.lines) { const k = lineSig(l); const c = count.get(k) || { n: 0, line: { ...l, qty: 1 } }; c.n++; count.set(k, c); }
    const seen = new Set<string>(); // one pick per item (its most-ordered way)
    const picks = ([...count.values()].sort((a, b) => b.n - a.n).map((c) => today(c.line)).filter(Boolean) as FavLine[]).filter((p) => !seen.has(p.action.itemId) && !!seen.add(p.action.itemId)).slice(0, 3);
    if (!picks.length) return null;
    const ord = { es: ["uno", "dos", "tres"], en: ["one", "two", "three"] };
    fav = { kind: "top", orders: orders.length, offers: picks.map((p) => [p]), dropped: [...dropped], deliveryNudge: null, greeting: {
      es: `${hi.es}sus favoritos son: ${picks.map((p, i) => `${ord.es[i]}, ${p.label.es} (${money(p.cents)})`).join("; ")}. ¿Le preparo alguno?`,
      en: `${hi.en}your top picks are: ${picks.map((p, i) => `${ord.en[i]}, ${p.label.en} (${money(p.cents)})`).join("; ")}. Want one of those?` } };
  }
  if (fav.dropped.length) { fav.greeting.es += ` (Hoy no tenemos ${list(fav.dropped, "ni")}.)`; fav.greeting.en += ` (${list(fav.dropped, "and")} ${fav.dropped.length > 1 ? "aren't" : "isn't"} available today.)`; }
  fav.deliveryNudge = opts.nudge || null;
  return fav;
}

// ---- storage (gitignored) ----
const hFile = () => path.join(dir, "history.json"), nFile = () => path.join(dir, "nudged.json");
const readJ = (f: string) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
const writeJ = (f: string, d: any) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); };
export const writeHistory = (h: History, links: NameLink[] = []) => writeJ(hFile(), { generatedAt: new Date().toISOString(), customers: h, nameLinks: links });
export const loadNameLinks = (): NameLink[] => readJ(hFile()).nameLinks || [];
export const loadHistory = (): History => readJ(hFile()).customers || {};

/** Delivery nudge — once ever per phone, only pickup-only customers, phone channel only (app fees not yet in Square),
 * only with a saved address already quoted IN range (never read out). */
export function deliveryNudge(phoneRaw: string, orders: HOrder[], channel: "app" | "phone"): { es: string; en: string } | null {
  if (channel !== "phone" || !orders.length || orders.some((o) => o.fulfillment === "DELIVERY")) return null;
  const k = phoneKey(phoneRaw), done = readJ(nFile()); if (done[k]) return null;
  const sd = savedDelivery(phoneRaw); if (sd.lastFulfillment === "DELIVERY" || !sd.address) return null;
  const q = cachedQuote(sd.address.address); if (!q?.ok || !q.feeCents) return null;
  return { es: `También tenemos entrega a domicilio, ¿le gustaría? Sería ${money(q.feeCents)} de envío.`, en: `We also deliver, would you like that? It'd be ${money(q.feeCents)} for delivery.` };
}
export function markNudged(phoneRaw: string) { const d = readJ(nFile()); d[phoneKey(phoneRaw)] = new Date().toISOString(); writeJ(nFile(), d); }

/** Name only when confidently stored (manual / call readback / heard by Elvi / ticket) and the channel allows it. */
export function confidentName(phoneRaw: string): string | null {
  const s = savedCallerName(phoneRaw); if (!s || !/^(manual|readback|elvi|ticket)$/.test(s.source)) return null;
  return String(s.name).split(/\s+/)[0] || null;
}

// ---- yes / pick answer ----
export const pendingFav = new Map<string, { fav: Favorites; at: number }>();
const YES = /^\s*(?:s[ií]|sip|claro|[oó]rale|va|dale|por favor|yes|yeah|yep|sure|ok(?:ay)?|please)(?=[\s,.!]|$)[\s\w,.!áéíóú]*$/iu;
const PICK: Array<[RegExp, number]> = [[/\b(?:1|uno|el primero|la primera|primer[oa]?|one|first)\b/i, 0], [/\b(?:2|dos|el segundo|la segunda|segund[oa]|two|second)\b/i, 1], [/\b(?:3|tres|el tercero|la tercera|tercer[oa]?|three|third)\b/i, 2]];
/** → add_item actions for the accepted favorite, or null (not an answer: normal flow; offer dropped). */
export function favoriteAnswer(sessionKey: string | undefined, text: string): FavLine[] | null {
  const p = sessionKey ? pendingFav.get(sessionKey) : undefined;
  if (!p || Date.now() - p.at > 30 * 60_000) return null;
  pendingFav.delete(sessionKey!);
  const t = String(text || "");
  if (p.fav.kind === "top") { const hit = PICK.find(([re]) => re.test(t)); if (hit && p.fav.offers[hit[1]]) return p.fav.offers[hit[1]]; if (p.fav.offers.length === 1 && YES.test(t)) return p.fav.offers[0]; return null; }
  return YES.test(t) && !/\b(?:pero|but|sin|without|cambi|change|no)\b/i.test(t) ? p.fav.offers[0] : null;
}
