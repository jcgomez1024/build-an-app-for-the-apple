// search1 (Carlos 11/27): "make sure there is always a ticket to compare to, even if you need to search for it."
// When a call has no direct ticket link (match1 assignTickets / manual link / follow-up), search Square orders that were
// already fetched (READ-ONLY; nothing here calls Square or writes anything) over a wider window and score every candidate:
// caller phone on the ticket, fuzzy customer name (accents, typos: Fernado≈Fernando, Cristal≈Crystal, Zuleika≈Zuleita),
// item overlap with Elvi's cart and with the staff readback, the live linker's square_ticket link, and time distance.
// The best candidate is shown as "buscado" with a confidence and the runner-ups; it is never counted in accuracy numbers.
import { ticketLines, scoreOrder, norm, isEmptyOrder, isOnlineOrder, type Line } from "./call-accuracy.js";

export const SEARCH_BEFORE_MS = 10 * 60_000; // tickets rung up to 10 min before the call started (call-back / walk-in-then-call)
export const SEARCH_AFTER_END_MS = 90 * 60_000; // staff ring late, ring several calls together, or ring at pickup

export type SearchCall = {
  callSid: string; at: string; caller?: string; talkSec?: number; recordingSec?: number;
  names?: Array<string | null | undefined>; // heard / order / saved names, best first
  readbackText?: string | null; // staff readback ("dos de bistec y una de pastor, ¿es todo?")
  transcriptText?: string | null; // whole call (used only for dish/meat words when Elvi built no cart)
  callerText?: string | null; // caller's own words — the ticket name said aloud ("De Sandra Paola") counts even when Elvi's heard name is junk
  liveLinkOrderId?: string | null; // square_ticket event / square-links.json from the live linker (twilio.ts linkSquareTickets)
  liveLinkBy?: string | null; // how the live linker picked it ("phone", "ticket name", "items", "only ticket in 20 min")
};
export type Signal = { kind: "phone" | "name" | "items" | "readback" | "live-link" | "time"; value: number; detail: string };
export type Candidate = {
  orderId: string; createdAt: string; minutesFromStart: number; ticketName: string | null; recipient: string | null;
  totalCents: number; state: string; source: string | null; lines: Line[]; signals: Signal[]; score: number; confidence: number;
  usedBy?: string[]; // other calls that have this ticket as their direct ticket or as their own best search hit
};
export type SearchResult = {
  status: "found" | "weak" | "none"; best: Candidate | null; runnerUps: Candidate[]; reason: string;
  window: { from: string; to: string }; searched: number;
};

const digits10 = (p: string) => String(p || "").replace(/\D/g, "").slice(-10);
const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const lev = (a: string, b: string) => { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; };
/** Spanish/English spelling folds: y→i, z/c(e,i)→s, k/q→c, v→b, silent h, ll→y, doubled letters. */
const phon = (s: string) => s.replace(/ll/g, "y").replace(/y/g, "i").replace(/h/g, "").replace(/qu/g, "c").replace(/[kq]/g, "c").replace(/c([ei])/g, "s$1").replace(/z/g, "s").replace(/v/g, "b").replace(/ph/g, "f").replace(/(.)\1+/g, "$1");
/** 0..1 similarity of two first names (accents/typos/spelling variants). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = fold(String(a || "")).split(" ")[0] || "", y = fold(String(b || "")).split(" ")[0] || "";
  if (x.length < 2 || y.length < 2) return 0;
  if (x === y) return 1;
  const px = phon(x), py = phon(y);
  if (px === py) return 0.95;
  if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return 0.85; // Cheyenne ≈ Cheyen
  const d = lev(x, y), L = Math.max(x.length, y.length), m = Math.min(x.length, y.length);
  // one typo for 4–6 letters (Fernado/Fernando, Zuleika/Zuleita), two for 7+; Vera≠Mesa, Seis≠Kevin
  if (m >= 4 && (d <= 1 || (m >= 7 && d <= 2))) return Math.max(0.75, 1 - d / L);
  return 0;
}

/** Words that identify what was ordered (dish + meat + drink). Synonyms fold to one key. */
const VOCAB: Array<[RegExp, string]> = [
  [/\btacos?\b/, "taco"], [/\bquesadillas?\b|\bquesitartas?\b/, "quesadilla"], [/\bdoradas?\b|\bduradas?\b|\bfried quesadilla/, "dorada"],
  [/\bgorditas?\b/, "gordita"], [/\btortas?\b/, "torta"], [/\bburritos?\b/, "burrito"], [/\bsopes?\b/, "sope"], [/\bsopesazos?\b/, "sopesazo"],
  [/\bhuaraches?\b/, "huarache"], [/\btostadas?\b/, "tostada"], [/\benchiladas?\b/, "enchilada"], [/\btamal(?:es)?\b/, "tamal"],
  [/\bmenudo\b/, "menudo"], [/\bpozole\b/, "pozole"], [/\bbirrias?\b/, "birria"], [/\bcaldo\b/, "caldo"], [/\bmole\b/, "mole"],
  [/\bchiles? rellenos?\b/, "chile relleno"], [/\bchilaquiles\b/, "chilaquiles"], [/\bpambazos?\b/, "pambazo"], [/\bnachos\b/, "nachos"],
  [/\besquites?\b|\belotes?\b/, "elote"], [/\bfajitas?\b/, "fajitas"], [/\bflautas?\b/, "flauta"], [/\bchimichangas?\b/, "chimichanga"],
  [/\bhorchatas?\b/, "horchata"], [/\bjamaicas?\b/, "jamaica"], [/\btamarindo\b/, "tamarindo"], [/\bcoca\b|\bcoke\b/, "coca"], [/\bpepsi\b/, "pepsi"],
  [/\bjarritos?\b/, "jarrito"], [/\bsprite\b/, "sprite"], [/\bfanta\b/, "fanta"], [/\bsidral\b/, "sidral"], [/\bagua\b/, "agua"],
  [/\bbistec\b|\bbiste\b|\bvite\b|\basada\b|\bsteak\b/, "bistec"], [/\bpastor\b/, "pastor"], [/\bchorizo\b/, "chorizo"], [/\blengua\b|\btongue\b/, "lengua"],
  [/\bcabeza\b/, "cabeza"], [/\btripas?\b/, "tripa"], [/\bbuche\b/, "buche"], [/\bsuadero\b/, "suadero"], [/\bcarnitas\b/, "carnitas"],
  [/\bpollo\b|\bchicken\b/, "pollo"], [/\bchicharr[oó]n\b/, "chicharron"], [/\bprensado\b/, "prensado"], [/\bcostilla\b/, "costilla"],
  [/\bbarbacoa\b/, "barbacoa"], [/\bcampechan[oa]\b/, "campechano"], [/\bpicadillo\b/, "picadillo"], [/\bnopal(?:es)?\b/, "nopales"],
  [/\bhongos?\b|\bmushrooms?\b/, "hongos"], [/\bflor de calabaza\b/, "flor"], [/\brajas\b/, "rajas"], [/\bcamar[oó]n(?:es)?\b|\bshrimp\b/, "camaron"],
  [/\bpescado\b|\bfish\b/, "pescado"], [/\bchivo\b|\bgoat\b/, "chivo"], [/\bres\b|\bbeef\b/, "res"], [/\bhuevo\b|\beggs?\b/, "huevo"],
  [/\barroz\b|\brice\b/, "arroz"], [/\bfrijoles\b|\bbeans\b/, "frijoles"], [/\bharina\b|\bflour\b/, "harina"], [/\bmaiz\b|\bcorn\b/, "maiz"]
];
export function dishWords(text: string): Set<string> {
  const t = " " + fold(text) + " ", out = new Set<string>();
  for (const [re, k] of VOCAB) if (re.test(t)) out.add(k);
  return out;
}
const linesText = (ls: Line[]) => ls.map((l) => `${l.name} ${(l.choices || []).join(" ")}`).join(" ");
const isFee = (l: Line) => /^\s*delivery\s*fee\b/i.test(String(l.baseName || l.name || ""));
const baseKey = (l: Line) => norm(String(l.baseName || l.name || "").split(" · ")[0]);

/** Overlap of Elvi's cart with a ticket: F1 of base-dish keys (qty-aware) blended with the full item score. */
export function itemMatch(elvi: Line[], ticket: Line[]): number {
  const E = elvi.filter((l) => !isFee(l)), T = ticket.filter((l) => !isFee(l));
  if (!E.length || !T.length) return 0;
  const cnt = (ls: Line[]) => { const m = new Map<string, number>(); for (const l of ls) m.set(baseKey(l), (m.get(baseKey(l)) || 0) + (Number(l.quantity) || 1)); return m; };
  const a = cnt(E), b = cnt(T); let hit = 0; for (const [k, v] of a) hit += Math.min(v, b.get(k) || 0);
  const qa = [...a.values()].reduce((x, y) => x + y, 0), qb = [...b.values()].reduce((x, y) => x + y, 0);
  const f1 = hit ? (2 * hit) / (qa + qb) : 0;
  let s = 0; try { s = scoreOrder(E, T).score / 100; } catch { s = 0; }
  // meat/dish word agreement catches "(QCO) Quesadilla Comal + Bistec" vs Elvi's "Quesadilla · Bistec" naming differences
  const we = dishWords(linesText(E)), wt = dishWords(linesText(T)); let wi = 0; for (const w of we) if (wt.has(w)) wi++;
  const words = we.size && wt.size ? (2 * wi) / (we.size + wt.size) : 0;
  return Math.max(f1 * 0.6 + s * 0.4, words * 0.8);
}
function orderPhones(o: any): string[] {
  const out: string[] = [];
  for (const f of o?.fulfillments || []) for (const d of [f.pickup_details, f.delivery_details, f.shipment_details]) if (d?.recipient?.phone_number) out.push(digits10(d.recipient.phone_number));
  return out.filter(Boolean);
}
function orderNameList(o: any): string[] {
  const out: string[] = [];
  if (o?.ticket_name) out.push(String(o.ticket_name));
  for (const f of o?.fulfillments || []) for (const d of [f.pickup_details, f.delivery_details, f.shipment_details]) if (d?.recipient?.display_name) out.push(String(d.recipient.display_name));
  return out;
}
/** Ticket names that are ordinary words, never evidence that the caller said their name. */
const NOT_NAMES = new Set(["para", "orden", "pedido", "llevar", "togo", "pickup", "delivery", "entrega", "phone", "telefono", "llamada", "cliente", "customer", "order", "carne", "tacos", "quesadillas", "menudo", "gracias", "bueno", "buenas", "favor", "esposa", "esposo", "mama", "papa", "senor", "senora", "don", "dona", "the", "and"]);
/** Dine-in / table tickets ("Mesa 2", "Mesa tv", "Table 4") are walk-ins, not phone orders. */
export const TABLE = /^\s*(?:mesa|table|barra|bar)\b|^\s*\d+\s*$/i;
const recipientOf = (o: any) => { for (const f of o?.fulfillments || []) for (const d of [f.pickup_details, f.delivery_details]) if (d?.recipient?.display_name) return String(d.recipient.display_name); return null; };

/** Score every POS ticket in [start −10 min, end +90 min] for this call. Pure; orders are the already-fetched list. */
export function scoreCandidates(call: SearchCall, elvi: Line[], orders: any[]): { candidates: Candidate[]; from: number; to: number; searched: number } {
  const start = Date.parse(call.at), end = start + (call.recordingSec || call.talkSec || 0) * 1000;
  const from = start - SEARCH_BEFORE_MS, to = end + SEARCH_AFTER_END_MS;
  const phone = digits10(call.caller || ""), names = (call.names || []).map((n) => String(n || "").trim()).filter(Boolean);
  const rb = dishWords(String(call.readbackText || ""));
  const said = elvi.some((l) => !isFee(l)) ? null : dishWords(String(call.transcriptText || "")); // no cart → words the call mentioned
  const callerWords = fold(String(call.callerText || "")).split(" ").filter((w) => w.length >= 4);
  const out: Candidate[] = []; let searched = 0;
  for (const o of orders) {
    if (isEmptyOrder(o) || isOnlineOrder(o) || /^DRAFT$/i.test(String(o.state || ""))) continue; // online orders = follow-ups (followup1)
    const t = Date.parse(o.created_at); if (!(t >= from && t <= to)) continue;
    searched++;
    const lines = ticketLines(o), signals: Signal[] = [];
    if (phone.length === 10 && orderPhones(o).includes(phone)) signals.push({ kind: "phone", value: 1, detail: "teléfono del cliente en el ticket" });
    if (call.liveLinkOrderId && String(call.liveLinkOrderId) === String(o.id)) {
      const timeOnly = /only ticket/i.test(String(call.liveLinkBy || "")); // link15 time-only guess = weak evidence
      signals.push({ kind: "live-link", value: timeOnly ? 0.35 : 1, detail: `enlazado en vivo (square_ticket: ${call.liveLinkBy || "?"})` });
    }
    let ns = 0, nd = "";
    // every word of the heard name vs every word of the ticket name ("Maldonado" ≈ "Juan maldonado"); first names count most
    for (const h of names) for (const tn of orderNameList(o).filter((n) => !TABLE.test(n))) {
      const hw = fold(h).split(" ").filter((w) => w.length >= 3 && !NOT_NAMES.has(w)), tw = fold(tn).split(" ").filter((w) => w.length >= 3 && !NOT_NAMES.has(w));
      hw.forEach((a, i) => tw.forEach((b, j) => { const s = nameSimilarity(a, b) * (i === 0 && j === 0 ? 1 : 0.9); if (s > ns) { ns = s; nd = `${h} ≈ ${tn}`; } }));
    }
    if (ns < 0.9 && callerWords.length) for (const tn of orderNameList(o).filter((n) => !TABLE.test(n))) {
      const hit = fold(tn).split(" ").find((f) => f.length >= 4 && !NOT_NAMES.has(f) && callerWords.some((w) => w === f || (f.length >= 5 && w.length >= 5 && lev(w, f) <= 1)));
      if (hit) { ns = Math.max(ns, 0.9); nd = `“${tn}” dicho en la llamada`; break; }
    }
    if (ns >= 0.75) signals.push({ kind: "name", value: ns, detail: `nombre ${nd}` });
    const im = itemMatch(elvi, lines);
    if (im > 0) signals.push({ kind: "items", value: im, detail: `artículos de Elvi ${Math.round(im * 100)}%` });
    const tw = dishWords(linesText(lines));
    const wordsFrom = rb.size ? rb : said && said.size ? said : null;
    if (wordsFrom) { let hit = 0; for (const w of wordsFrom) if (tw.has(w)) hit++; const v = hit / wordsFrom.size; if (v > 0) signals.push({ kind: "readback", value: v, detail: `${rb.size ? "read-back" : "llamada"} ${hit}/${wordsFrom.size} palabras` }); }
    // time: best when rung 0–25 min after the call ended; before the call or > 60 min later is weak
    const dm = (t - end) / 60000, ds = (t - start) / 60000;
    const tv = ds < 0 ? Math.max(0, 1 + ds / 10) * 0.5 : dm <= 25 ? 1 : Math.max(0, 1 - (dm - 25) / 65);
    signals.push({ kind: "time", value: tv, detail: `${ds >= 0 ? "+" : ""}${Math.round(ds)} min desde el inicio` });
    const v = (k: Signal["kind"]) => signals.find((s) => s.kind === k)?.value || 0;
    // noisy-OR: each signal is independent evidence that this is the call's ticket
    const table = TABLE.test(String(o.ticket_name || ""));
    if (table) signals.push({ kind: "time", value: 0, detail: `ticket de mesa (${o.ticket_name}) — probablemente en persona` });
    const p = [0.92 * v("phone"), 0.9 * v("live-link"), 0.75 * v("name"), 0.8 * Math.pow(v("items"), 1.3), 0.55 * v("readback"), 0.25 * v("time")];
    const score = (1 - p.reduce((a, x) => a * (1 - x), 1)) * (table ? 0.6 : 1);
    out.push({ orderId: String(o.id), createdAt: o.created_at, minutesFromStart: Math.round(ds), ticketName: o.ticket_name ? String(o.ticket_name) : null, recipient: recipientOf(o),
      totalCents: Number(o.total_money?.amount || 0), state: String(o.state || ""), source: o.source?.name || null, lines, signals, score, confidence: 0 });
  }
  out.sort((a, b) => b.score - a.score || Math.abs(a.minutesFromStart) - Math.abs(b.minutesFromStart));
  return { candidates: out, from, to, searched };
}
const strong = (c: Candidate) => c.signals.some((s) => s.kind === "phone" || (s.kind === "live-link" && s.value >= 1) || (s.kind === "name" && s.value >= 0.75) || (s.kind === "items" && s.value >= 0.5) || (s.kind === "readback" && s.value >= 0.6));

/** One call's search: best + runner-ups + why. Confidence = score, lowered when the runner-up is nearly as good. */
export function searchTicket(call: SearchCall, elvi: Line[], orders: any[], opts: { runnerUps?: number } = {}): SearchResult {
  const { candidates, from, to, searched } = scoreCandidates(call, elvi, orders);
  const window = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  const n = opts.runnerUps ?? 3;
  if (!candidates.length) return { status: "none", best: null, runnerUps: [], reason: "No hay tickets de Square (POS) entre 10 min antes y 90 min después de la llamada.", window, searched };
  // confidence = score, scaled down when another candidate is nearly as good (runner-ups therefore stay below the best)
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i], other = Math.max(0, ...candidates.filter((_, j) => j !== i).map((x) => x.score));
    c.confidence = Math.round(Math.max(0, Math.min(0.99, c.score * Math.max(0.1, Math.min(1, 0.55 + (c.score - other) * 1.5)))) * 100);
  }
  const best = candidates[0];
  if (strong(best)) return { status: best.confidence >= 60 ? "found" : "weak", best, runnerUps: candidates.slice(1, 1 + n), reason: best.signals.filter((s) => s.kind !== "time").map((s) => s.detail).join(" · "), window, searched };
  // never empty: closest-in-time tickets, and say why none fits
  const byTime = [...candidates].sort((a, b) => Math.abs(a.minutesFromStart) - Math.abs(b.minutesFromStart));
  return { status: "none", best: null, runnerUps: byTime.slice(0, n + 1), reason: "Ningún ticket coincide por teléfono, nombre ni artículos; se muestran los más cercanos en hora.", window, searched };
}

/** All calls: run the search, then flag tickets claimed by more than one call (direct link elsewhere, or the best hit of
 *  two searched calls — e.g. several calls rung together on one ticket). */
export function searchTickets(items: Array<{ call: SearchCall; elvi: Line[] }>, orders: any[], directByOrder: Map<string, string>): Map<string, SearchResult> {
  const out = new Map<string, SearchResult>();
  for (const { call, elvi } of items) out.set(call.callSid, searchTicket(call, elvi, orders));
  const bestBy = new Map<string, string[]>();
  for (const [sid, r] of out) if (r.best) (bestBy.get(r.best.orderId) || bestBy.set(r.best.orderId, []).get(r.best.orderId)!).push(sid);
  for (const [sid, r] of out) for (const c of [r.best, ...r.runnerUps].filter(Boolean) as Candidate[]) {
    const others = [...(directByOrder.has(c.orderId) ? [directByOrder.get(c.orderId)!] : []), ...(bestBy.get(c.orderId) || [])].filter((x) => x !== sid);
    if (others.length) c.usedBy = [...new Set(others)];
  }
  for (const r of out.values()) if (r.best?.usedBy?.length) { r.best.confidence = Math.min(r.best.confidence, 55); r.status = "weak"; r.reason += ` · ⚠ este ticket también es de otra llamada`; }
  return out;
}
