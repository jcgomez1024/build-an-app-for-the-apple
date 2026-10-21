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
        if (e.elviOrder?.fulfillment) c.fulfillment = e.elviOrder.fulfillment;
        if (e.elviOrder?.customerName) (c as any).elviName = e.elviOrder.customerName; // namecheck1
        if (!c.language && e.greetingLanguage) c.language = e.greetingLanguage;
      }
      if (e.event === "fulfillment" && (e.fulfillment === "DELIVERY" || e.fulfillment === "PICKUP")) { c.fulfillment = e.fulfillment; c.deliveryFeeCents = e.feeCents ?? c.deliveryFeeCents ?? null; }
      if (e.event === "order_name_cleared") { (c as any).orderName = undefined; (c as any).orderNameFrom = undefined; } // cleanup1
      if (e.event === "language_corrected" || e.event === "language_manual") (c as any).languageNotes = [...((c as any).languageNotes || []), { kind: e.event === "language_manual" ? "manual" : "auto", from: e.from || null, to: e.to, by: e.by || null, at: e.ts, share: e.share ?? null }]; // lang2
      if (e.event === "order_name" && e.name) { (c as any).orderName = e.name; (c as any).orderNameFrom = e.from || null; } // ordername1
      if (e.event === "recording_error") c.error = e.error;
      if (e.event === "voicemail") { c.answered = false; c.dialStatus = "voicemail"; c.voicemail = { recordingSid: e.recordingSid, durationSec: Number(e.durationSec) || 0, transcript: e.transcript || "", cart: e.elviOrder?.cart || [] }; }
      calls.set(e.callSid, c);
    }
  }
  const mine = trainingNumbers();
  for (const c of calls.values()) if (!c.source) c.source = mine.includes(String(c.caller || "").replace(/\D/g, "").slice(-10)) ? "training" : "customer";
  return [...calls.values()].filter((c) => Date.parse(c.at) >= since).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// "(TCO) Taco de Comal / Homemade" (POS variation) == "(TCO) Taco Comal / Homemade (+$1.00)" (online modifier).
export const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\(\s*[+-]?\s*\$\s*\d+(?:\.\d{1,2})?\s*\)/g, " ").replace(/^\s*\(\s*[a-z]{1,4}\s*\)\s*/i, " ").replace(/^\s*\d+\s*x\s+/i, "")
  .replace(/[^a-z0-9]+/g, " ").replace(/\b(de|del|la|el)\b/g, " ").replace(/\s+/g, " ").trim();
const digits10 = (p: string) => String(p || "").replace(/\D/g, "").slice(-10);
const optName = (o: any) => (typeof o === "object" && o ? o.name : String(o || ""));

export type Line = { baseName?: string; variationId?: string; itemId?: string; name: string; quantity: number; choices: string[]; unitCents: number; totalCents: number };

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
    return { itemId: l.itemId, ...(l.posSize ? { posSize: l.posSize } : {}), baseName: item?.name, variationId: item?.squareVariationId, name: item?.readbackName || item?.name || l.itemId, quantity: q, choices, unitCents: unit, totalCents: unit * q };
  });
}

/** fix1036: Elvi's delivery fee as the POS rings it ("Delivery Fee · Delivery 1" $5 ≤4 mi / "Delivery 2" $8). Unknown distance → $5. */
export function deliveryFeeLine(feeCents?: number | null): Line {
  const fee = Number(feeCents) > 0 ? Number(feeCents) : 500;
  const v = fee >= 800 ? "Delivery 2" : "Delivery 1";
  return { baseName: "Delivery Fee", name: `Delivery Fee · ${v}`, quantity: 1, choices: [v], unitCents: fee, totalCents: fee };
}

export function ticketLines(order: any): Line[] {
  return (order?.line_items || []).map((li: any) => {
    const q = Number(li.quantity) || 1;
    const total = Number(li.gross_sales_money?.amount ?? li.total_money?.amount ?? 0);
    return {
      baseName: li.name, variationId: li.catalog_object_id, name: [li.name, li.variation_name && li.variation_name !== "Regular" ? li.variation_name : ""].filter(Boolean).join(" · "),
      // On the POS the tortilla/size is the variation; online it's a modifier. Count it as a choice either way.
      quantity: q, choices: [...(li.variation_name && li.variation_name !== "Regular" ? [String(li.variation_name)] : []), ...(li.modifiers || []).map((m: any) => String(m.name || ""))], unitCents: Math.round(total / q), totalCents: total
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
// The included mild Salsa Asada isn't rung on the POS ticket, so it doesn't count either way.
const IGNORABLE = /\bmild salsa asada\b/;

export type Miss = { kind: "missing_item" | "extra_item" | "quantity" | "choices" | "price"; ticket?: string; elvi?: string; detail: string };

/** Score Elvi's lines against the ticket: item 40, quantity 20, choices 25, price 15 per line. */
export function scoreOrder(elvi: Line[], ticket: Line[]): { score: number; misses: Miss[]; pairs: Array<{ ticket?: Line; elvi?: Line; points: number }> } {
  const misses: Miss[] = [];
  const pairs: Array<{ ticket?: Line; elvi?: Line; points: number }> = [];
  const left = [...elvi];
  for (const t of ticket) {
    // Prefer the same item with the most matching choices.
    let best = -1, bestOverlap = -1;
    left.forEach((e, i) => {
      if (!sameItem(e, t)) return;
      const tc = new Set(t.choices.map(norm));
      const ov = e.choices.filter((c) => tc.has(norm(c))).length;
      if (ov > bestOverlap) { best = i; bestOverlap = ov; }
    });
    if (best < 0) { misses.push({ kind: "missing_item", ticket: t.name, detail: `Elvi missed ${t.quantity} × ${t.name}` }); pairs.push({ ticket: t, points: 0 }); continue; }
    const e = left.splice(best, 1)[0];
    let pts = 40;
    if (e.quantity === t.quantity) pts += 20; else misses.push({ kind: "quantity", ticket: t.name, detail: `${t.name}: ticket ${t.quantity}, Elvi ${e.quantity}` });
    const tc = new Set(t.choices.map(norm).filter((c) => c && !IGNORABLE.test(c)));
    const ec = new Set(e.choices.map(norm).filter((c) => c && !IGNORABLE.test(c)));
    const union = new Set([...tc, ...ec]);
    const inter = [...tc].filter((c) => ec.has(c)).length;
    const jac = union.size ? inter / union.size : 1;
    pts += Math.round(25 * jac);
    if (jac < 1) {
      const miss = [...tc].filter((c) => !ec.has(c)), extra = [...ec].filter((c) => !tc.has(c));
      misses.push({ kind: "choices", ticket: t.name, detail: `${t.name}: ${miss.length ? `missed ${miss.join(", ")}` : ""}${miss.length && extra.length ? "; " : ""}${extra.length ? `extra ${extra.join(", ")}` : ""}` });
    }
    if (Math.abs(e.totalCents - t.totalCents) <= 1) pts += 15;
    else misses.push({ kind: "price", ticket: t.name, detail: `${t.name}: ticket $${(t.totalCents / 100).toFixed(2)}, Elvi $${(e.totalCents / 100).toFixed(2)}` });
    pairs.push({ ticket: t, elvi: e, points: pts });
  }
  for (const e of left) { misses.push({ kind: "extra_item", elvi: e.name, detail: `Elvi added ${e.quantity} × ${e.name} (not on ticket)` }); pairs.push({ elvi: e, points: 0 }); }
  const denom = 100 * Math.max(1, pairs.length);
  return { score: Math.round((pairs.reduce((s, p) => s + p.points, 0) / denom) * 1000) / 10, misses, pairs };
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
    const nameHit = !!first && orderNames(o).includes(first);
    const overlap = itemOverlap(elvi, lines);
    if (!phoneHit && !nameHit && overlap < 0.5) continue;
    const tagged = !/point of sale/i.test(String(o.source?.name || "")) || /voice|elvi|phone/i.test(JSON.stringify(o.metadata || {}) + String(o.reference_id || ""));
    const sim = lines.length ? scoreOrder(elvi, lines).score : 0;
    const rank = (phoneHit ? 1000 : 0) + (nameHit ? 500 : 0) + (tagged ? 200 : 0) + overlap * 100 + sim - Math.abs(t - end) / 60000;
    out.push({ order: o, rank, by: [phoneHit && "phone", nameHit && "name", overlap >= 0.5 && "items"].filter(Boolean).join(" + ") + " + time" });
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
