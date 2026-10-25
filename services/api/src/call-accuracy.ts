import { compareNames } from "./name-accuracy.js";
// Call accuracy: match each recorded call's shadow order (Elvi) to the Square ticket staff rang up, and score it.
// Square is read-only here (Orders Search). Nothing is created or changed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuItem } from "./menu.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logDir = path.join(apiRoot, "data/logs/calls");
export const callsDir = path.join(apiRoot, "data/calls");
export const TARGET = 95;

export type CallRecord = {
  callSid: string; at: string; caller: string; calledNumber?: string; language?: string; heard?: string;
  answered?: boolean; dialStatus?: string; talkSec?: number; recordingSid?: string; recordingSec?: number; file?: string;
  turns?: any[]; transcript?: string; elviCart?: any[]; fulfillment?: "DELIVERY" | "PICKUP" | null; deliveryFeeCents?: number | null; error?: string; source?: "customer" | "training";
  voicemail?: { recordingSid: string; durationSec: number; transcript: string; cart: any[] };
};

const expectedFile = path.join(logDir, "expected-orders.json");
export function loadExpected(): Record<string, { text: string; cart: any[]; savedAt: string }> {
  try { return JSON.parse(fs.readFileSync(expectedFile, "utf8")); } catch { return {}; }
}
export function saveExpected(callSid: string, value: { text: string; cart: any[]; savedAt: string } | null) {
  const all = loadExpected();
  if (value) all[callSid] = value; else delete all[callSid];
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(expectedFile, JSON.stringify(all, null, 2));
}
const trainingNumbers = () => String(process.env.TWILIO_TRAINING_CALLERS || "").split(",").map((p) => p.replace(/\D/g, "").slice(-10)).filter(Boolean);

export function loadCalls(sinceDays = 60): CallRecord[] {
  if (!fs.existsSync(logDir)) return [];
  const since = Date.now() - sinceDays * 86400000;
  const calls = new Map<string, CallRecord>();
  for (const f of fs.readdirSync(logDir).filter((x) => x.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(logDir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e: any; try { e = JSON.parse(line); } catch { continue; }
      if (!e.callSid || /^CAtest/i.test(e.callSid)) continue;
      const c: CallRecord = calls.get(e.callSid) || { callSid: e.callSid, at: e.ts, caller: e.caller || "" };
      if (e.source === "training" || e.source === "customer") c.source = e.source; // "tag" events re-label a call
      if (e.event === "incoming") { c.at = e.ts; c.caller = e.caller || c.caller; c.calledNumber = e.calledNumber; }
      if (e.event === "language") { c.language = e.language; c.heard = e.heard; }
      if (e.event === "answered" || e.event === "missed") { c.answered = e.event === "answered"; c.dialStatus = e.dialStatus; c.talkSec = Number(e.durationSec) || 0; }
      if (e.event === "recording") { // latest processing wins (reprocessed calls)
        c.recordingSid = e.recordingSid; c.recordingSec = Number(e.durationSec) || 0; c.file = e.file;
        c.turns = e.turns; c.transcript = e.transcript; c.elviCart = e.elviOrder?.cart || []; c.error = undefined;
        // live1: first processing = "Elvi en la llamada" (that day's code); later rescores = "Elvi hoy" (current fixes)
        if (!e.rescoredBy && (c as any).elviCartLive === undefined) (c as any).elviCartLive = e.elviOrder?.cart || [];
        if (e.rescoredBy) (c as any).rescoredAt = e.ts;
        // replay3: fresh-replay runs behind the current order (median run); a later plain rescore clears them
        (c as any).replayScores = Array.isArray(e.replayScores) ? e.replayScores : null; (c as any).replayVaries = !!e.replayVaries; (c as any).replayHead = e.replayHead || null;
        if (e.elviOrder?.fulfillment) c.fulfillment = e.elviOrder.fulfillment;
        if (e.elviOrder?.customerName) (c as any).elviName = e.elviOrder.customerName; // namecheck1
        if (!c.language && e.greetingLanguage) c.language = e.greetingLanguage;
      }
      if (e.event === "fulfillment" && (e.fulfillment === "DELIVERY" || e.fulfillment === "PICKUP")) { c.fulfillment = e.fulfillment; c.deliveryFeeCents = e.feeCents ?? c.deliveryFeeCents ?? null; }
      if (e.event === "order_name_cleared") { (c as any).orderName = undefined; (c as any).orderNameFrom = undefined; } // cleanup1
      if (e.event === "language_corrected" || e.event === "language_manual") (c as any).languageNotes = [...((c as any).languageNotes || []), { kind: e.event === "language_manual" ? "manual" : "auto", from: e.from || null, to: e.to, by: e.by || null, at: e.ts, share: e.share ?? null }]; // lang2
      if (e.event === "order_name" && e.name) { (c as any).orderName = e.name; (c as any).orderNameFrom = e.from || null; } // ordername1
      if (e.event === "recording_error") c.error = e.error;
      if (e.event === "bridged") (c as any)._bridged = true; // deadleg1
      // readback1: answering device (no staff identity yet): desk 9249, cell 6793, or the counter tablet
      if (e.event === "whisper" && e.via === "desk" && e.ringTo) (c as any).answeredBy = `${/9249$/.test(String(e.ringTo)) ? "desk" : /6793$/.test(String(e.ringTo)) ? "cell" : "phone"} ${String(e.ringTo).slice(-4)}`;
      if (e.event === "answered" && e.via === "counter") (c as any).answeredBy = "counter";
      if (/^(parent_end|caller_gone|ring_answer_dead|ring_accept_dead)$/.test(e.event)) (c as any)._gone = true;
      if (e.event === "voicemail") { c.answered = false; c.dialStatus = "voicemail"; c.voicemail = { recordingSid: e.recordingSid, durationSec: Number(e.durationSec) || 0, transcript: e.transcript || "", cart: e.elviOrder?.cart || [] }; }
      calls.set(e.callSid, c);
    }
  }
  const mine = trainingNumbers();
  // deadleg1: "answered" by a staff leg that never bridged after the caller left = missed (counts as follow-up/callback)
  for (const c of calls.values()) { if (c.answered && !(c as any)._bridged && (c as any)._gone) { c.answered = false; c.dialStatus = "caller-hungup"; c.talkSec = 0; } delete (c as any)._bridged; delete (c as any)._gone; }
  for (const c of calls.values()) if (!c.source) c.source = mine.includes(String(c.caller || "").replace(/\D/g, "").slice(-10)) ? "training" : "customer";
  return [...calls.values()].filter((c) => Date.parse(c.at) >= since).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// "(TCO) Taco de Comal / Homemade" (POS variation) == "(TCO) Taco Comal / Homemade (+$1.00)" (online modifier).
export const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\(\s*[+-]?\s*\$\s*\d+(?:\.\d{1,2})?\s*\)/g, " ").replace(/^\s*\(\s*[a-z]{1,4}\s*\)\s*/i, " ").replace(/^\s*\d+\s*x\s+/i, "")
  .replace(/[^a-z0-9]+/g, " ").replace(/\b(de|del|la|el)\b/g, " ").replace(/\s+/g, " ").trim();
const digits10 = (p: string) => String(p || "").replace(/\D/g, "").slice(-10);
const optName = (o: any) => (typeof o === "object" && o ? o.name : String(o || ""));

export type Line = { baseName?: string; variationId?: string; itemId?: string; name: string; quantity: number; choices: string[]; freeChoices?: string[]; unitCents: number; totalCents: number };

/** Elvi's shadow cart → priced lines (base price + each chosen option's price delta). */
export function elviLines(cart: any[] = [], menu: MenuItem[]): Line[] {
  return cart.map((l) => {
    const item = menu.find((m) => m.id === l.itemId);
    let unit = item?.priceCents || 0;
    const choices: string[] = [];
    for (const m of l.modifiers || []) {
      const opt = String(m.option || "");
      choices.push(opt);
      for (const g of item?.modifierGroups || []) {
        const o: any = (g.options || []).find((x) => norm(optName(x)) === norm(opt));
        if (o && typeof o === "object") { unit += Number(o.priceDeltaCents) || 0; break; }
      }
    }
    const q = Number(l.quantity) || 1;
    return { itemId: l.itemId, ...(l.posSize ? { posSize: l.posSize } : {}), ...((l as any).posMenudo ? { posMenudo: (l as any).posMenudo } : {}), baseName: item?.name, variationId: item?.squareVariationId, name: item?.readbackName || item?.name || l.itemId, quantity: q, choices, unitCents: unit, totalCents: unit * q };
  });
}

/** fix1036: Elvi's delivery fee as the POS rings it ("Delivery Fee · Delivery 1" $5 ≤4 mi / "Delivery 2" $8). Unknown distance → $5. */
export function deliveryFeeLine(feeCents?: number | null): Line {
  const fee = Number(feeCents) > 0 ? Number(feeCents) : 500;
  const v = fee >= 800 ? "Delivery 2" : "Delivery 1";
  return { baseName: "Delivery Fee", name: `Delivery Fee · ${v}`, quantity: 1, choices: [v], unitCents: fee, totalCents: fee };
}

/** ghost1: Square POS re-adds random custom amounts when a saved/open ticket is reopened; staff delete them or name them
 *  "Entry Error". Those are not items: Entry Error lines are dropped, other nameless custom amounts are marked ghost. */
export const ENTRY_ERROR = /\bentry\s*error\b|\berror\s+de\s+(?:entrada|captura)\b/i;
export const isCustomAmountLi = (li: any) => li?.item_type === "CUSTOM_AMOUNT" || (!li?.catalog_object_id && !/delivery|env[ií]o/i.test(String(li?.name || "")));
export const isEntryError = (li: any) => isCustomAmountLi(li) && (ENTRY_ERROR.test(String(li?.name || "")) || ENTRY_ERROR.test(String(li?.note || "")));
/** plate1: staff ring a $0 "NO BEBIDA / NO DRINK" item between plates/people (233 of ~3.7k orders in 60 days, 97% mid-ticket).
 *  It's a separator, not an item: lines get a plate index and the marker itself is dropped. */
export const PLATE_MARKER = /^\s*(?:no|sin)\s+bebida\b|^\s*no\s+drink\b/i;
export const isPlateMarker = (li: any) => PLATE_MARKER.test(String(li?.name || "")) && !Number(li?.base_price_money?.amount || 0);
// std2: variationId → options that are the only choice in their modifier group (true defaults). Set from the live menu.
// std3: "3 x (Flour) Harina Tortilla" — the count is how many come; the type is the caller's choice, so it's checked normally.
export const TORT_TYPE = /\b(comal|ma[ií]z|corn|harina|flour)\b/i;
/** tortilla3: ticket items whose tortilla type was never said by the caller nor asked/confirmed by staff (a minor staff miss). */
export function tortillaUnconfirmed(turns: any[] = [], lines: Line[] = []): string[] {
  const all = norm((turns || []).map((t: any) => t.text).join(" "));
  if (/\b(comal|maiz|corn|harina|flour|hech[oa]s? a mano|handmade|homemade|street|taquer[oa]s?|chiquit[oa]s?)\b/.test(all)) return [];
  return [...new Set((lines || []).filter((l) => (l.choices || []).some((c) => TORT_TYPE.test(c) && !/^\s*\*{2,}|\bextra\b/i.test(c))).map((l) => String(l.baseName || l.name)))];
}
const STD_SINGLE = new Map<string, Set<string>>();
export function setStdMenu(menu: any[] = []) {
  STD_SINGLE.clear();
  for (const m of menu) { const s = new Set<string>(); for (const g of m?.modifierGroups || []) if ((g.options || []).length === 1) s.add(norm(optName(g.options[0])));
    if (s.size && m?.squareVariationId) STD_SINGLE.set(String(m.squareVariationId), s); }
}
export function ticketLines(order: any): Line[] {
  let plate = 0; const L = (order?.line_items || []).filter((li: any) => !isEntryError(li));
  const hasMarker = L.some(isPlateMarker);
  // fee1: a nameless $8.00 custom amount on a delivery or big/combined ticket is the delivery fee (not an item, not a ghost)
  const bigOrDelivery = hasMarker || (order?.fulfillments || []).some((f: any) => f?.type === "DELIVERY") || L.reduce((a: number, li: any) => a + (Number(li.quantity) || 1), 0) >= 12;
  return L.flatMap((li: any) => { if (isPlateMarker(li)) { plate++; return []; } return [{ li, plate }]; }).map(({ li, plate }: any) => {
    const q = Number(li.quantity) || 1;
    const total = Number(li.gross_sales_money?.amount ?? li.total_money?.amount ?? 0);
    return {
      ...(hasMarker ? { plate } : {}),
      ...(isCustomAmountLi(li) && !String(li.name || "").trim().replace(/^custom amount$/i, "") && !(bigOrDelivery && Number(li.base_price_money?.amount) === 800) ? { ghost: true } : {}),
      baseName: isCustomAmountLi(li) && !String(li.name || "").trim() && bigOrDelivery && Number(li.base_price_money?.amount) === 800 ? "Delivery Fee" : li.name, variationId: li.catalog_object_id, name: [isCustomAmountLi(li) && !String(li.name || "").trim() && bigOrDelivery && Number(li.base_price_money?.amount) === 800 ? "Delivery Fee" : li.name, li.variation_name && li.variation_name !== "Regular" ? li.variation_name : ""].filter(Boolean).join(" · "),
      // On the POS the tortilla/size is the variation; online it's a modifier. Count it as a choice either way.
      quantity: q, choices: [...(li.variation_name && li.variation_name !== "Regular" ? [String(li.variation_name)] : []), ...(li.modifiers || []).map((m: any) => String(m.name || ""))],
      // std2: a $0 modifier is standard/included only when it's a true default — a count-prefixed label ("2 QUESO") or the only
      // option of its group on this item. A $0 protein/choice that was rung but never said still flags.
      freeChoices: (li.modifiers || []).filter((m: any) => !Number(m.total_price_money?.amount ?? m.base_price_money?.amount ?? 0))
        .map((m: any) => String(m.name || "")).filter((n: string) => (/^\s*\d+\s+\S/.test(n) && !TORT_TYPE.test(n)) || !!STD_SINGLE.get(String(li.catalog_object_id || ""))?.has(norm(n))), unitCents: Math.round(total / q), totalCents: total
    };
  });
}

function orderPhones(o: any): string[] {
  const out: string[] = [];
  for (const f of o?.fulfillments || []) {
    for (const d of [f.pickup_details, f.delivery_details, f.shipment_details]) if (d?.recipient?.phone_number) out.push(digits10(d.recipient.phone_number));
  }
  return out.filter(Boolean);
}

// fix1136: the online menu folds the variation into the item name ("(QD) Quesadilla Dorada (QD) REGULAR Dorada", its own
// variation id); the POS rings item "(QD) Quesadilla Dorada" + variation "(QD) REGULAR Dorada". Same dish.
const sameItem = (a: Line, b: Line) => (a.variationId && a.variationId === b.variationId) || norm(a.baseName || a.name) === norm(b.baseName || b.name)
  || norm(a.baseName || a.name) === norm(b.name) || norm(a.name) === norm(b.baseName || b.name);
// The included mild Salsa Asada isn't rung on the POS ticket (staff skip it; it's packed anyway), so it doesn't count either way —
// salsa1: unless the customer named a salsa; then salsa is scored normally on both sides.
const IGNORABLE = /\bmild salsa asada\b/;
const NEVER = /$^/;
/** salsa1: did the caller name a salsa / sauce ("salsa verde", "hot sauce", "la roja")? */
export const callerNamedSalsa = (turns: Array<{ speaker?: string; text?: string }> = []) =>
  turns.some((t) => t.speaker === "caller" && /\bsalsas?\b|\bsauces?\b|\b(?:la|the)\s+(?:verde|roja|green|red)\b|\bpicante\b|\bhabanero\b|\bchipotle\b/iu.test(String(t.text || "")));
/** choice1: same option, different label — POS "2 QUESO" vs online "QUESO / CHEESE" (count prefix, English half). */
export const optKey = (c: string) => { const n = norm(c).trim(); const k = norm(String(c || "").split(/\s+\/\s+/)[0]).trim().replace(/^\d+\s+(?=[a-z])/, ""); return k || n; };

export type Miss = { kind: "missing_item" | "extra_item" | "quantity" | "choices" | "price"; ticket?: string; elvi?: string; detail: string };

/** match2: non-item ticket lines (NO DRINK / NO BEBIDA, notes, $0 "no …" lines) are never scored. */
export const isNonItemLine = (l: Line) => /^\s*(?:no\s+(?:bebida|drink|soda|refresco)s?\b|nota\b|note\b|notes\b|\*+\s*note)/i.test(String(l.baseName || l.name || ""))
  || (!Number(l.totalCents) && /^\s*no\b/i.test(String(l.baseName || l.name || "")));
let IGN: RegExp = IGNORABLE;
const choiceKey = (l: Line) => [...new Set(l.choices.map(optKey).filter((c) => c && !IGN.test(c)))].sort().join("|");
/** Same item + same choices → one line with the summed quantity (split lines / duplicate ticket lines). */
export function consolidate(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (const l of lines) {
    if (isNonItemLine(l)) continue;
    const hit = out.find((o) => sameItem(o, l) && choiceKey(o) === choiceKey(l));
    if (hit) { hit.quantity += l.quantity; hit.totalCents += l.totalCents; hit.unitCents = Math.round(hit.totalCents / Math.max(1, hit.quantity)); }
    else out.push({ ...l, choices: [...l.choices] });
  }
  return out;
}
const part = (l: Line, q: number): Line => ({ ...l, quantity: q, totalCents: Math.round((l.totalCents / Math.max(1, l.quantity)) * q) });

/** match2: score per ITEM (item 40, total quantity 20, choices 25 × exactly-matched units, price 15). Each unit is
 *  matched once: same choices first, then the closest choices, then the leftover is ONE quantity difference. */
export function scoreOrder(elvi: Line[], ticket: Line[], opts: { salsaNamed?: boolean } = {}): { score: number; misses: Miss[]; pairs: Array<{ ticket?: Line; elvi?: Line; points: number }> } {
  IGN = opts.salsaNamed ? NEVER : IGNORABLE;
  try { return scoreOrder0(elvi, ticket); } finally { IGN = IGNORABLE; }
}
function scoreOrder0(elvi: Line[], ticket: Line[]): { score: number; misses: Miss[]; pairs: Array<{ ticket?: Line; elvi?: Line; points: number }> } {
  const misses: Miss[] = [];
  const pairs: Array<{ ticket?: Line; elvi?: Line; points: number }> = [];
  // fee1: delivery fees are not items — delivery yes/no is the separate fulfillment check
  const isFeeLine = (l: any) => /^\s*delivery\s*fee\b/i.test(String(l?.baseName || l?.name || ""));
  elvi = elvi.filter((l) => !isFeeLine(l)); ticket = ticket.filter((l) => !isFeeLine(l));
  const E = consolidate(elvi), T = consolidate(ticket);
  type G = { t: Line[]; e: Line[] };
  const groups: G[] = [];
  const groupOf = (l: Line) => groups.find((g) => [...g.t, ...g.e].some((x) => sameItem(x, l)));
  for (const t of T) { const g = groupOf(t); if (g) g.t.push(t); else groups.push({ t: [t], e: [] }); }
  for (const e of E) { const g = groupOf(e); if (g) g.e.push(e); else groups.push({ t: [], e: [e] }); }
  let total = 0;
  for (const g of groups) {
    const tq = g.t.reduce((a, l) => a + l.quantity, 0), eq = g.e.reduce((a, l) => a + l.quantity, 0);
    const name = (g.t[0] || g.e[0]).name;
    if (!eq) { for (const t of g.t) { misses.push({ kind: "missing_item", ticket: t.name, detail: `Elvi missed ${t.quantity} × ${t.name}` }); pairs.push({ ticket: t, points: 0 }); } continue; }
    if (!tq) { for (const e of g.e) { misses.push({ kind: "extra_item", elvi: e.name, detail: `Elvi added ${e.quantity} × ${e.name} (not on ticket)` }); pairs.push({ elvi: e, points: 0 }); } continue; }
    const tl = g.t.map((l) => ({ l, q: l.quantity })), el = g.e.map((l) => ({ l, q: l.quantity }));
    let exact = 0;
    // 1) same choices
    for (const t of tl) for (const e of el) { if (!t.q || !e.q || choiceKey(t.l) !== choiceKey(e.l)) continue; const m = Math.min(t.q, e.q); t.q -= m; e.q -= m; exact += m; pairs.push({ ticket: part(t.l, m), elvi: part(e.l, m), points: 100 }); }
    // 2) closest choices for the rest (choice flags, never a quantity flag)
    for (const t of tl) while (t.q) {
      const tc = new Set(t.l.choices.map(optKey));
      const cand = el.filter((e) => e.q).sort((a, b) => b.l.choices.filter((c) => tc.has(optKey(c))).length - a.l.choices.filter((c) => tc.has(optKey(c))).length)[0];
      if (!cand) break;
      const m = Math.min(t.q, cand.q); t.q -= m; cand.q -= m;
      const tcs = new Set(t.l.choices.map(optKey).filter((c) => c && !IGN.test(c))), ecs = new Set(cand.l.choices.map(optKey).filter((c) => c && !IGN.test(c)));
      const miss = [...tcs].filter((c) => !ecs.has(c)), extra = [...ecs].filter((c) => !tcs.has(c));
      misses.push({ kind: "choices", ticket: t.l.name, detail: `${t.l.name}${m > 1 ? ` (${m})` : ""}: ${miss.length ? `missed ${miss.join(", ")}` : ""}${miss.length && extra.length ? "; " : ""}${extra.length ? `extra ${extra.join(", ")}` : ""}` });
      const jac = (() => { const u = new Set([...tcs, ...ecs]); return u.size ? [...tcs].filter((c) => ecs.has(c)).length / u.size : 1; })();
      const pt = part(t.l, m), pe = part(cand.l, m);
      exact += m * jac; // partial choice credit
      pairs.push({ ticket: pt, elvi: pe, points: 60 + Math.round(25 * jac) + (Math.abs(pt.totalCents - pe.totalCents) <= 1 ? 15 : 0) });
    }
    // 3) leftover units on one side = ONE quantity difference for this item
    const restT = tl.filter((t) => t.q), restE = el.filter((e) => e.q);
    if (tq !== eq) misses.push({ kind: "quantity", ticket: name, detail: `${name}: ticket ${tq}, Elvi ${eq}` });
    const qtyDiff = { item: name, ticket: tq, elvi: eq };
    for (const t of restT) pairs.push({ ticket: part(t.l, t.q), points: 0, qtyDiff } as any);
    for (const e of restE) pairs.push({ elvi: part(e.l, e.q), points: 0, qtyDiff } as any);
    // item score
    const tc = g.t.reduce((a, l) => a + l.totalCents, 0), ec = g.e.reduce((a, l) => a + l.totalCents, 0);
    let pts = 40 + (tq === eq ? 20 : 0) + Math.round(25 * (exact / Math.max(tq, eq)));
    if (Math.abs(tc - ec) <= 1) pts += 15;
    else if (tq === eq && exact >= tq - 1e-9 && !misses.some((x) => x.kind === "choices" && x.ticket === name)) misses.push({ kind: "price", ticket: name, detail: `${name}: ticket $${(tc / 100).toFixed(2)}, Elvi $${(ec / 100).toFixed(2)}` }); // only when nothing else explains it
    total += pts;
  }
  const n = groups.filter((g) => g.t.length || g.e.length).length;
  return { score: Math.round((total / (100 * Math.max(1, n))) * 1000) / 10, misses, pairs };
}

/**
 * Pick the ticket for a call: created between 2 min before the call and 45 min after it ended,
 * phone match first, then the most similar items, then the closest in time.
 */
export function matchTicket(call: CallRecord, elvi: Line[], orders: any[]) {
  const start = Date.parse(call.at) - 2 * 60000;
  const end = Date.parse(call.at) + ((call.recordingSec || call.talkSec || 0) + 30) * 1000 + 45 * 60000;
  const phone = digits10(call.caller);
  let best: { order: any; rank: number; by: string } | null = null;
  for (const o of orders) {
    const t = Date.parse(o.created_at);
    if (!(t >= start && t <= end)) continue;
    const phoneHit = !!phone && orderPhones(o).includes(phone);
    const lines = ticketLines(o);
    const sim = lines.length ? scoreOrder(elvi, lines).score : 0;
    const rank = (phoneHit ? 1000 : 0) + sim - Math.abs(t - Date.parse(call.at)) / 60000 / 10;
    if (!best || rank > best.rank) best = { order: o, rank, by: phoneHit ? "phone + time" : "time window" };
  }
  return best;
}

/** match1: ticket ↔ call matching that walk-ins can never win.
 *  (a) a call with no order content (no Elvi items) gets no ticket; (b) only orders created from call start to 10 min
 *  after it ends; (c) ≥50% of the call's items on the ticket, or the caller's phone / heard name on the order;
 *  API/Elvi/phone-tagged orders preferred; (d) one ticket ↔ one call (best pairs first); (e) else no ticket. */
export const MATCH_AFTER_END_MS = 10 * 60_000;
export function hasOrderContent(elvi: Line[]) { return elvi.some((l) => !/^delivery fee\b/i.test(String(l.baseName || l.name || ""))); }
function itemOverlap(elvi: Line[], ticket: Line[]) {
  const food = elvi.filter((l) => !/^delivery fee\b/i.test(String(l.baseName || l.name || "")));
  if (!food.length) return 0;
  const key = (l: Line) => norm(String(l.baseName || l.name || "").split(" · ")[0]);
  const t = new Set(ticket.map(key));
  return food.filter((l) => t.has(key(l))).length / food.length;
}
function orderNames(o: any): string[] {
  const out: string[] = [];
  for (const f of o?.fulfillments || []) for (const d of [f.pickup_details, f.delivery_details, f.shipment_details]) if (d?.recipient?.display_name) out.push(String(d.recipient.display_name));
  if (o?.ticket_name) out.push(String(o.ticket_name));
  return out.map((n) => norm(n).split(" ")[0]).filter(Boolean);
}
// followup1 (Carlos): Square Online orders are never scored against Elvi; $0 orders with no items are never tickets.
export const isOnlineOrder = (o: any) => /online|website|ecom/i.test(String(o?.source?.name || ""));
export const isEmptyOrder = (o: any) => !(o?.line_items || []).length && !Number(o?.total_money?.amount || 0);
export const isPosTicket = (o: any) => !isEmptyOrder(o) && !isOnlineOrder(o);
/** Caller talks about an order already placed (online / scheduled / status / change). */
export const FOLLOWUP_CUES = /\b(?:placed an order|you placed|i placed|my order|your order|the order (?:i|you)|ordered online|online order|on(?:line| the website| the app)|for tomorrow|says tomorrow|pick ?up time|is it ready|ready yet|change (?:my|the) order|cancel (?:my|the) order|hice (?:un|una|el|mi) (?:pedido|orden)|mi (?:pedido|orden)|su (?:pedido|orden)|por internet|en l[ií]nea|para ma[nñ]ana|ya est[aá] list[oa]|cambiar (?:mi|el|la) (?:pedido|orden)|cancelar)\b/i;
/** followup1b: staff (often an outbound callback) mention the order's date/time — "it says for tomorrow at 11", "para mañana a las 11". */
export const ORDER_TIME_CUES = /\b(?:tomorrow|today at|tonight|for (?:today|now)|right now today|\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m|p\.?\s?m)\b|ma[nñ]ana|hoy (?:a las|mismo)|para hoy|a las \d{1,2}|pick(?:ed)? ?up (?:at|time)|scheduled|programad[oa])/i;
/** Our own Twilio numbers (outbound callbacks put us in "caller"; the customer is then the called number). */
const OUR_LINES = () => String(process.env.TWILIO_LINES || "+14409011609=x,+14406642795=x").split(",").map((p) => digits10(p.split("=")[0])).filter(Boolean);
export const customerPhoneOf = (call: { caller: string; calledNumber?: string }, ours: string[] = OUR_LINES()) => { const c = digits10(call.caller); return c && ours.includes(c) && call.calledNumber ? digits10(call.calledNumber) : c; };
/** followup1: the caller's own recent Square Online order (phone, else name) from 24 h before the call to its end. */
export function findFollowUpOrder(call: CallRecord & { customerName?: string | null }, orders: any[]): { order: any; by: string } | null {
  const start = Date.parse(call.at), end = start + (call.recordingSec || call.talkSec || 0) * 1000 + 5 * 60000;
  const phone = customerPhoneOf(call), first = norm(String(call.customerName || "")).split(" ")[0];
  const recent = orders.filter((o) => isOnlineOrder(o) && !isEmptyOrder(o) && !/^DRAFT$/i.test(String(o.state || "")) && (() => { const t = Date.parse(o.created_at); return t >= start - 24 * 3600000 && t <= end; })());
  const byPhone = phone ? recent.filter((o) => orderPhones(o).includes(phone)) : [];
  if (byPhone.length) return { order: byPhone[byPhone.length - 1], by: "phone" };
  const byName = first ? recent.filter((o) => orderNames(o).includes(first)) : [];
  if (byName.length === 1) return { order: byName[0], by: "name" };
  return null;
}
/** followup1: an order follow-up call = links to a recent online order and adds no new phone order (or says so). */
export function followUpFor(call: CallRecord & { customerName?: string | null }, elvi: Line[], orders: any[]) {
  const hit = findFollowUpOrder(call, orders);
  if (!hit) return null;
  const said = (call.turns || []).map((t: any) => t.text).join(" ");
  // A new phone order (items, no follow-up / order-time words) is not a follow-up. Phone-matched + staff naming the
  // order's time/date (outbound callbacks for late online orders pushed to tomorrow) always is.
  const staffSaid = (call.turns || []).filter((t: any) => t.speaker === "staff").map((t: any) => t.text).join(" ");
  const timeTalk = hit.by === "phone" && ORDER_TIME_CUES.test(staffSaid);
  if (hasOrderContent(elvi) && !FOLLOWUP_CUES.test(said) && !timeTalk) return null;
  const f = (hit.order.fulfillments || [])[0] || {}, d = f.pickup_details || f.delivery_details || {};
  return { orderId: String(hit.order.id), source: String(hit.order.source?.name || "online"), state: String(hit.order.state || ""), fulfillment: f.type || null, fulfillmentState: f.state || null,
    dueAt: d.pickup_at || d.deliver_at || null, placedAt: d.placed_at || hit.order.created_at, totalCents: Number(hit.order.total_money?.amount || 0), matchedBy: hit.by };
}
/** match3: Jaccard overlap of all chosen options (tortilla, meats, toppings; default salsa ignored) between two orders. */
export function choiceAgreement(a: Line[], b: Line[]): number {
  const set = (ls: Line[]) => new Set(ls.flatMap((l) => [l.baseName, ...(l.choices || [])]).map((c) => String(c).replace(/\s*\(\+\$[\d.]+\)/, "").trim().toLowerCase()).filter((c) => c && !/salsa asada/.test(c)));
  const A = set(a), B = set(b); if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}
export function candidateTickets(call: CallRecord & { customerName?: string | null }, elvi: Line[], orders: any[]) {
  if (!hasOrderContent(elvi)) return [];
  const start = Date.parse(call.at);
  const end = start + (call.recordingSec || call.talkSec || 0) * 1000 + MATCH_AFTER_END_MS;
  const phone = digits10(call.caller), first = norm(String(call.customerName || "")).split(" ")[0];
  const out: Array<{ order: any; rank: number; by: string }> = [];
  for (const o of orders) {
    if (!isPosTicket(o)) continue; // followup1
    const t = Date.parse(o.created_at);
    if (!(t >= start && t <= end)) continue;
    const lines = ticketLines(o);
    const phoneHit = !!phone && orderPhones(o).includes(phone);
    const nameHit = !!first && (orderNames(o).includes(first) || orderNames(o).some((n: string) => first.length >= 4 && n.length >= 4 && compareNames(first, n) !== "mismatch")); // cheyenne1: 'Cheyenne' ≈ ticket 'Cheyen'
    const overlap = itemOverlap(elvi, lines);
    if (!phoneHit && !nameHit && overlap < 0.5) continue;
    // match3: an items-only match (no phone, no name) must also agree on the details — 'quesadillas' alone paired a training
    // call (chorizo/tripa/buche) with an unrelated walk-in ticket (menudo/al pastor) 7 min later
    if (!phoneHit && !nameHit && choiceAgreement(elvi, lines) < 0.4) continue;
    const tagged = !/point of sale/i.test(String(o.source?.name || "")) || /voice|elvi|phone/i.test(JSON.stringify(o.metadata || {}) + String(o.reference_id || ""));
    const sim = lines.length ? scoreOrder(elvi, lines).score : 0;
    const rank = (phoneHit ? 1000 : 0) + (nameHit ? 500 : 0) + (tagged ? 200 : 0) + overlap * 100 + sim - Math.abs(t - end) / 60000;
    out.push({ order: o, rank, by: [phoneHit && "phone", nameHit && "name", overlap >= 0.5 && "items"].filter(Boolean).join(" + ") + " + time" });
  }
  return out;
}
/** multi1: the caller orders for other people too ("dos órdenes", "para Juana…", "la de ella", "otra orden aparte"). */
export const MULTI_ORDER_CUES = /\b(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|[2-9]|1[0-9])\s+[oó]rdenes\b|\botra\s+orden\b|\b(?:la|el|en\s+la)\s+(?:orden\s+)?de\s+(?:ella|[ée]l|mi\s+\w+)\b|\bpara\s+(?:mi\s+(?:esposa|esposo|hij[oa]|herman[oa]|mam[aá]|pap[aá]|amig[oa]|compa\w*)|ella|[ée]l)\b|\bpara\s+\p{Lu}\p{Ll}{2,}|\b(?:separate|another)\s+order\b|\bfor\s+(?:my\s+\w+|her|him)\b/u;
export const mentionsOtherOrders = (turns: Array<{ speaker: string; text: string }>) => MULTI_ORDER_CUES.test((turns || []).filter((t) => t.speaker === "caller").map((t) => t.text).join(" \n "));
export const MULTI_WINDOW_MS = 45 * 60_000;
export const isSaturdayET = (at: string) => new Date(at).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }) === "Sat";
/** local only: data/learning/repeat-callers.json = ["last 10 digits", …] of callers known for big multi-order calls */
export function repeatCaller(phone?: string, file = "data/learning/repeat-callers.json"): boolean {
  try { const d = String(phone || "").replace(/\D/g, "").slice(-10); return !!d && (JSON.parse(fs.readFileSync(file, "utf8")) as string[]).includes(d); } catch { return false; }
}
const refMatches = (o: any, ref: string) => { const r = String(ref || "").trim().replace(/^#/, "").toLowerCase(); const s = squareRefs(o); return !!r && (String(o.id).toLowerCase() === r || String(s.receiptNumber || "").toLowerCase() === r || String(s.paymentId || "").toLowerCase() === r); };
/** combine1: big multi-person calls (e.g. Saturday 6–8 orders): staff ring one ticket per person, then CANCEL those and ring one
 *  combined ticket that is charged. A ticket whose items all sit inside another linked, larger ticket is that combined
 *  ticket's original — drop it so nothing is counted twice (keep the paid/larger one). */
const itemSig = (o: any) => { const m = new Map<string, number>(); for (const l of ticketLines(o)) { const k = norm(String(l.name || "")); if (k) m.set(k, (m.get(k) || 0) + (Number(l.quantity) || 1)); } return m; };
const within = (a: Map<string, number>, b: Map<string, number>) => [...a].every(([k, v]) => (b.get(k) || 0) >= v);
export function dedupeCombined<T>(list: T[], get: (x: T) => any = (x: any) => x): T[] {
  const sigs = list.map((x) => itemSig(get(x))), size = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const rank = (i: number) => (get(list[i])?.state === "COMPLETED" ? 1e6 : 0) + size(sigs[i]);
  // drop each original fully inside a bigger one; also drop a set of originals that together fit inside one combined ticket
  const keep = list.map((_, i) => !list.some((__, j) => j !== i && size(sigs[i]) > 0 && within(sigs[i], sigs[j]) && (rank(j) > rank(i) || (rank(j) === rank(i) && j < i))));
  return list.filter((_, i) => keep[i]);
}
/** multi1: extra tickets for one call — manual links (receipt # or order id) first, then, when the caller talks about other
 *  people's orders, unassigned POS tickets within ±45 min that make Elvi's order fit better (union score up, details agree). */
export function linkedTickets(call: { at: string; recordingSec?: number; talkSec?: number; turns?: any[] }, elvi: Line[], primary: any | null, orders: any[], opts: { manual?: string[]; usedElsewhere?: Set<string> } = {}) {
  const out: Array<{ order: any; by: string }> = []; const have = new Set<string>(primary ? [String(primary.id)] : []);
  for (const ref of opts.manual || []) { const o = orders.find((x) => refMatches(x, ref)); if (o && !have.has(String(o.id))) { out.push({ order: o, by: "manual" }); have.add(String(o.id)); } }
  if (!hasOrderContent(elvi) || !mentionsOtherOrders((call.turns || []) as any)) return out;
  // combine1: per-person tickets get rung over 10–20 min and the combined charge can land ~40 min after the last one, so look
  // further ahead (90 min; 120 for a known big-order repeat caller on a Saturday — that list is local data, never in git).
  // fee1: a delivery order is charged at delivery time (combined ticket ~2h after a ~4 PM call) → 150 min for delivery calls
  // and known Saturday repeat callers
  const isDelivery = (call as any).fulfillment === "DELIVERY" || /\b(?:a\s+domicilio|para\s+entrega|delivery|deliver)\b/i.test(((call.turns || []) as any[]).map((t) => t.text).join(" "));
  const ahead = (isDelivery || (isSaturdayET(call.at) && repeatCaller((call as any).caller)) ? 150 : 90) * 60_000;
  const start = Date.parse(call.at) - MULTI_WINDOW_MS, end = Date.parse(call.at) + (call.recordingSec || call.talkSec || 0) * 1000 + ahead;
  const union = () => dedupeCombined([...(primary ? [primary] : []), ...out.map((x) => x.order)]).flatMap((o) => ticketLines(o));
  const bk = (l: any) => norm(String(l.baseName || l.name || "").split(" · ")[0]);
  const mine = (lines: Line[]) => { const ks = new Set(lines.map(bk)); return elvi.filter((l) => ks.has(bk(l))); }; // only this person's part of Elvi's cart
  for (let k = 0; k < 8; k++) { // N tickets per call (one per person), not just 2
    const base = scoreOrder(elvi, union()).score; let best: { o: any; gain: number } | null = null;
    for (const o of orders) {
      if (have.has(String(o.id)) || opts.usedElsewhere?.has(String(o.id)) || !isPosTicket(o)) continue;
      const t = Date.parse(o.created_at); if (!(t >= start && t <= end)) continue;
      const lines = ticketLines(o).filter((l) => String(l.name || "").trim()); if (!lines.length) continue;
      if (itemOverlap(lines, elvi) < 0.5 || choiceAgreement(mine(lines), lines) < 0.25) continue; // its items must be things the caller ordered
      const gain = scoreOrder(elvi, [...union(), ...ticketLines(o)]).score - base;
      if (gain >= 5 && (!best || gain > best.gain)) best = { o, gain };
    }
    if (!best) break; if (best.o.state === "CANCELED" && orders.some((x) => x !== best!.o && x.state === "COMPLETED" && have.has(String(x.id)) && within(itemSig(best!.o), itemSig(x)))) { have.add(String(best.o.id)); continue; }
    out.push({ order: best.o, by: "auto: other person's order + items + time (±45 min)" }); have.add(String(best.o.id));
  }
  return out;
}
/** (d) global assignment: highest-ranked call/ticket pairs first; each ticket and each call used once. */
export function assignTickets(calls: Array<{ call: CallRecord & { customerName?: string | null }; elvi: Line[] }>, orders: any[]): Map<string, { order: any; by: string }> {
  const pairs = calls.flatMap(({ call, elvi }) => call.recordingSid ? candidateTickets(call, elvi, orders).map((c) => ({ sid: call.callSid, ...c })) : []);
  pairs.sort((a, b) => b.rank - a.rank);
  const out = new Map<string, { order: any; by: string }>(), used = new Set<string>();
  for (const p of pairs) { if (out.has(p.sid) || used.has(p.order.id)) continue; out.set(p.sid, { order: p.order, by: p.by }); used.add(p.order.id); }
  return out;
}

export function trend(rows: Array<{ at: string; score: number | null }>) {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const groups = (key: (d: Date) => string) => {
    const m = new Map<string, number[]>();
    for (const r of rows) if (r.score !== null) { const k = key(new Date(r.at)); m.set(k, [...(m.get(k) || []), r.score]); }
    return [...m.entries()].sort().map(([k, v]) => ({ period: k, calls: v.length, avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 }));
  };
  const week = (d: Date) => { const x = new Date(day(d) + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return `wk ${x.toISOString().slice(0, 10)}`; };
  return { daily: groups(day), weekly: groups(week), target: TARGET };
}

/** names1: the customer name on a Square ticket for this phone (fulfillment recipient as typed, else customer name). */
export function orderNameForPhone(o: any, phone10: string): string | null {
  for (const f of o?.fulfillments || []) {
    for (const d of [f.pickup_details, f.delivery_details, f.shipment_details]) {
      const r = d?.recipient;
      if (r && digits10(r.phone_number || "") === phone10 && String(r.display_name || "").trim()) return String(r.display_name).trim();
    }
  }
  return null;
}
/** names1: high-confidence only — a ticket with the SAME phone number inside the call window (2 min before → 45 min after). */
export function nameMatchForCall(call: { at: string; caller: string; talkSec?: number; recordingSec?: number }, orders: any[]): { name: string; orderId: string; createdAt: string } | null {
  const phone = digits10(call.caller);
  if (phone.length !== 10) return null;
  const start = Date.parse(call.at) - 2 * 60000;
  const end = Date.parse(call.at) + ((call.recordingSec || call.talkSec || 0) + 30) * 1000 + 45 * 60000;
  let best: { name: string; orderId: string; createdAt: string; d: number } | null = null;
  for (const o of orders) {
    const t = Date.parse(o.created_at);
    if (!(t >= start && t <= end)) continue;
    const name = orderNameForPhone(o, phone);
    if (!name) continue;
    const d = Math.abs(t - Date.parse(call.at));
    if (!best || d < best.d) best = { name, orderId: o.id, createdAt: o.created_at, d };
  }
  return best ? { name: best.name, orderId: best.orderId, createdAt: best.createdAt } : null;
}

/** ticketno1: the numbers Square shows for an order. "Receipt #" = the payment's receipt_number (first 4 characters of
 *  the payment/tender ID, as printed on the receipt and searchable in Transactions); "Ticket" = the order's ticket_name
 *  typed at the POS. The long order ID stays for linking. */
export function squareRefs(order: any) {
  const tender = (order?.tenders || [])[0];
  const paymentId: string | null = tender?.payment_id || tender?.id || null;
  return {
    orderId: String(order?.id || ""),
    receiptNumber: paymentId ? paymentId.slice(0, 4) : null,
    ticketName: order?.ticket_name ? String(order.ticket_name) : null,
    paymentId,
    dashboardUrl: paymentId ? `https://app.squareup.com/dashboard/sales/transactions/${paymentId}` : null,
  };
}

/** plate1: secondary metric — how well Elvi's per-person groups match the ticket's plates (ticket order = tickets in sequence,
 *  each ticket's NO BEBIDA plates). null when the ticket(s) have one plate only. Item accuracy stays the primary score. */
export function groupingScore(elvi: any[], ticketGroups: any[][]): number | null {
  const fee = (l: any) => /^\s*delivery\s*fee\b/i.test(String(l?.baseName || l?.name || "")); // fee1: not part of any plate
  const T = ticketGroups.map((g) => g.filter((l) => !fee(l))).filter((g) => g.length); if (T.length < 2) return null; elvi = elvi.filter((l) => !fee(l));
  const key = (l: any) => norm(String(l.baseName || l.name || "").split(" · ")[0]);
  const eg = new Map<string, any[]>(); for (const l of elvi) { const k = String(l.person ?? "_"); (eg.get(k) || eg.set(k, []).get(k)!).push(l); }
  const E = [...eg.values()]; if (E.length < 2) return 0;
  const qty = (g: any[]) => g.reduce((a, l) => a + (Number(l.quantity) || 1), 0); const total = T.reduce((a, g) => a + qty(g), 0) || 1;
  const ov = (e: any[], t: any[]) => { const c = new Map<string, number>(); for (const l of t) c.set(key(l), (c.get(key(l)) || 0) + (Number(l.quantity) || 1)); let n = 0; for (const l of e) { const k = key(l), h = c.get(k) || 0, q = Math.min(h, Number(l.quantity) || 1); n += q; c.set(k, h - q); } return n; };
  // greedy best pairing of Elvi groups to plates
  const pairs: Array<[number, number, number]> = []; E.forEach((e, i) => T.forEach((t, j) => pairs.push([ov(e, t), i, j]))); pairs.sort((a, b) => b[0] - a[0]);
  const ui = new Set<number>(), uj = new Set<number>(); let got = 0; for (const [n, i, j] of pairs) if (!ui.has(i) && !uj.has(j)) { ui.add(i); uj.add(j); got += n; }
  return Math.round(got / total * 1000) / 10;
}
export function plateGroups(orders: any[]): any[][] { const out: any[][] = []; for (const o of orders) { const by = new Map<number, any[]>(); for (const l of ticketLines(o) as any[]) (by.get(l.plate || 0) || by.set(l.plate || 0, []).get(l.plate || 0)!).push(l); out.push(...by.values()); } return out; }
