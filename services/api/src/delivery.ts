// delivery1: delivery vs pickup + delivery address, shared by the phone (call transcripts) and the customer app.
// Pure text helpers (no I/O besides the shared alias list). Addresses are personal data: they live only in caller
// memory (data/logs/calls/callers.json) and the call logs/tickets (all gitignored). Use redactAddresses() before
// anything goes into training data, alias proposals or reports.
import { applySharedAliases } from "./aliases.js";

export type Fulfillment = "DELIVERY" | "PICKUP" | "FOR_HERE";
export type Turnish = { speaker?: "caller" | "staff"; text: string; start?: number };

export const DELIVERY_TEXT = {
  ask: { es: "¿Para entrega a domicilio o para recoger hoy?", en: "Delivery or pickup today?" },
  same: { es: "¿A la misma dirección, {street}?", en: "Same address, {street}?" },
  askAddress: { es: "¿A qué dirección se lo llevamos? Calle, número y apartamento, por favor.", en: "What's the delivery address? Street, number and apartment, please." },
} as const;
export const deliveryPrompt = (k: keyof typeof DELIVERY_TEXT, lang: "es" | "en", street = "") =>
  DELIVERY_TEXT[k][lang].replace("{street}", street);

// Fallback cues (the shared aliases.json "fulfillment" rules turn the phrasings into these tokens first).
const TOKEN = /__(DELIVERY|PICKUP|FOR_HERE)__/g;
const NEGATED = /\b(?:no|not|sin|ni)\s+(?:es\s+|is\s+|para\s+|for\s+|a\s+)?(?:__(DELIVERY|PICKUP|FOR_HERE)__)/gi;

/** Rewrite fulfillment phrasings to __DELIVERY__ / __PICKUP__ / __FOR_HERE__ using the shared alias list (scope "fulfillment"). */
export function fulfillmentTokens(text: string): string {
  return applySharedAliases(String(text || ""), "fulfillment");
}

/** Fulfillment said in one piece of text (the LAST cue wins; "no es para delivery" cancels that cue). */
export function fulfillmentIn(text: string): Fulfillment | null {
  let t = fulfillmentTokens(text);
  t = t.replace(NEGATED, " ");
  // "¿Para entrega a domicilio o para recoger?" is the question, not an answer.
  t = t.replace(/__(?:DELIVERY|PICKUP|FOR_HERE)__[^.!?]{0,40}?\b(?:o|or)\b[^.!?]{0,20}?__(?:DELIVERY|PICKUP|FOR_HERE)__/gi, " ");
  let last: Fulfillment | null = null;
  for (const m of t.matchAll(TOKEN)) last = m[1] as Fulfillment;
  return last;
}

/** Fulfillment for a whole call (caller + staff read-back, in time order). Default null = not said (ticket stays TO GO). */
export function detectFulfillment(turns: Turnish[]): { fulfillment: Fulfillment | null; by: "caller" | "staff" | null; heard: string | null } {
  let out: { fulfillment: Fulfillment | null; by: "caller" | "staff" | null; heard: string | null } = { fulfillment: null, by: null, heard: null };
  for (const t of [...turns].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))) {
    const f = fulfillmentIn(t.text);
    if (f) out = { fulfillment: f, by: t.speaker || "caller", heard: t.text.slice(0, 160) };
  }
  return out;
}

const SUFFIX = "street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|pike|run|square|sq";
const CITIES = "painesville(?:\\s+township)?|mentor(?:[-\\s]on[-\\s]the[-\\s]lake)?|fairport(?:\\s+harbor)?|concord|perry|madison|willoughby(?:\\s+hills)?|grand\\s+river|leroy|kirtland|chardon|eastlake|wickliffe|north\\s+perry|geneva";
const UNIT = "(?:apt\\.?|apartment|apartamento|unit|suite|ste\\.?|#|n[uú]mero|lote|lot)\\s*[a-z0-9-]{1,6}";
// "123 North Saint Clair Street", "45 Main St apt 2", "678 Bacon Rd, Painesville, OH 44077"
const ADDR_EN = new RegExp(`\\b(\\d{1,6})\\s+((?:(?:north|south|east|west|n|s|e|w)\\.?\\s+)?(?:[a-záéíóúñ.'-]+\\s+){0,4}?(?:${SUFFIX}))\\b\\.?(?:[,\\s]+(${UNIT}))?(?:[,\\s]+(${CITIES}))?(?:[,\\s]+(?:ohio|oh))?(?:[,\\s]+(44\\d{3}))?`, "giu");
// "calle Main número 123", "en la calle Jackson 45", "avenida Mentor 900"
const ADDR_ES = new RegExp(`\\b(calle|avenida|av\\.?)\\s+((?:[a-záéíóúñ.'-]+\\s+){0,3}?)(?:n[uú]mero\\s+)?(\\d{1,6})\\b(?:[,\\s]+(${UNIT}))?(?:[,\\s]+(?:en\\s+)?(${CITIES}))?(?:[,\\s]+(44\\d{3}))?`, "giu");
const title = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
const SUFFIX_SHORT: Record<string, string> = { street: "St", avenue: "Ave", road: "Rd", drive: "Dr", lane: "Ln", boulevard: "Blvd", court: "Ct", place: "Pl", circle: "Cir", parkway: "Pkwy", highway: "Hwy", terrace: "Ter", trail: "Trl" };

export type Address = { street: string; unit?: string; city?: string; zip?: string; full: string };
function fmt(a: Omit<Address, "full">): Address {
  const full = [a.street + (a.unit ? ` ${a.unit}` : ""), a.city, a.zip ? `OH ${a.zip}` : a.city ? "OH" : ""].filter(Boolean).join(", ");
  return { ...a, full };
}
/** Every street address heard in one piece of text, in order. */
export function addressesIn(text: string): Address[] {
  // joseA1: STT "127 Morse, Morse Avenue" → "127 Morse Avenue"
  let t = String(text || "").replace(
    /\b(\d{1,6})\s+([a-záéíóúñ.'-]+)\s*,\s*\2\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b/giu,
    "$1 $2 $3",
  );
  const out: Array<{ at: number; a: Address }> = [];
  for (const m of t.matchAll(ADDR_EN)) {
    const words = m[2].trim().split(/\s+/);
    const last = words.pop()!.replace(/\.$/, "");
    const suf = SUFFIX_SHORT[last.toLowerCase()] || title(last);
    const name = words.map((w) => title(w)).join(" ");
    if (!name) continue; // "3 tacos St" style noise needs a street name
    if (/^(tacos?|quesadillas?|burritos?|tortas?|orders?|ordenes|combos?|packs?)$/i.test(words[0] || "")) continue;
    out.push({ at: m.index ?? 0, a: fmt({ street: `${m[1]} ${name} ${suf}`, unit: m[3] ? title(m[3]).replace(/^#\s*/, "#") : undefined, city: m[4] ? title(m[4]) : undefined, zip: m[5] }) });
  }
  for (const m of t.matchAll(ADDR_ES)) {
    const kind = /^av/i.test(m[1]) ? "Ave" : "St";
    const name = title(m[2] || "");
    if (!name) continue;
    out.push({ at: m.index ?? 0, a: fmt({ street: `${m[3]} ${name} ${kind}`, unit: m[4] ? title(m[4]) : undefined, city: m[5] ? title(m[5]) : undefined, zip: m[6] }) });
  }
  return out.sort((x, y) => x.at - y.at).map((x) => x.a);
}
export const addressKey = (a: string) => String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3).join(" ");

/** Delivery address for a call: the latest one said; "confirmed" when caller and staff both said it (staff read-back). */
export function detectAddress(turns: Turnish[]): { address: Address | null; confirmed: boolean; by: "caller" | "staff" | null } {
  let best: { address: Address; by: "caller" | "staff" } | null = null;
  const seen: Record<string, Set<string>> = {};
  for (const t of [...turns].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))) {
    for (const a of addressesIn(t.text)) {
      const k = addressKey(a.street);
      (seen[k] ||= new Set()).add(t.speaker || "caller");
      // Keep extra detail (unit/city/zip) from an earlier mention of the same street.
      if (best && addressKey(best.address.street) === k) {
        a.unit ||= best.address.unit; a.city ||= best.address.city; a.zip ||= best.address.zip;
        Object.assign(a, fmt(a));
      }
      best = { address: a, by: t.speaker || "caller" };
    }
  }
  if (!best) return { address: null, confirmed: false, by: null };
  return { address: best.address, confirmed: (seen[addressKey(best.address.street)]?.size || 0) > 1, by: best.by };
}

/** Replace street addresses with <ADDRESS> (for training data, alias proposals, reports). */
export function redactAddresses(text: string): string {
  return String(text || "").replace(ADDR_EN, "<ADDRESS>").replace(ADDR_ES, "<ADDRESS>");
}

/** Square ticket fulfillment (read-only order JSON) → our type + the address/notes as typed. */
const bigTicket = (o: any) => (o?.line_items || []).some((l: any) => /^\s*(?:no|sin)\s+bebida/i.test(String(l?.name || ""))) || (o?.line_items || []).reduce((a: number, l: any) => a + (Number(l?.quantity) || 1), 0) >= 12;
export function ticketFulfillment(order: any): { fulfillment: Fulfillment; address: string | null } {
  const fs = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  const noteText = [order?.note, ...fs.map((f: any) => f?.delivery_details?.note || f?.pickup_details?.note), ...(order?.line_items || []).map((l: any) => l?.note)].filter(Boolean).join(" ");
  const d = fs.find((f: any) => f?.type === "DELIVERY" || f?.delivery_details);
  let address: string | null = null;
  const ra = d?.delivery_details?.recipient?.address;
  if (ra?.address_line_1) address = [ra.address_line_1, ra.address_line_2, ra.locality, ra.postal_code].filter(Boolean).join(", ");
  if (!address) address = addressesIn(noteText)[0]?.full || null;
  if (d) return { fulfillment: "DELIVERY", address };
  // fee1: phone delivery is rung as PICKUP + a "Delivery Fee" catalog line ($5 / $8), a Delivery service charge, or a nameless $8
  if ((order?.line_items || []).some((l: any) => /^\s*delivery\s*fee\b|^\s*env[ií]o\b/i.test(String(l?.name || "")) || (!l?.catalog_object_id && !String(l?.name || "").trim() && Number(l?.base_price_money?.amount) === 800 && bigTicket(order)))
    || (order?.service_charges || []).some((c: any) => /deliver|env[ií]o|domicilio/i.test(String(c?.name || "")))) return { fulfillment: "DELIVERY", address };
  if (/\b(delivery|deliver|entrega|domicilio)\b/i.test(noteText) || address) return { fulfillment: "DELIVERY", address }; // staff typed it in the notes
  if (fs.some((f: any) => f?.type === "DINE_IN")) return { fulfillment: "FOR_HERE", address: null };
  return { fulfillment: "PICKUP", address: null };
}

/** Accuracy: fulfillment + address, Elvi (transcript) vs the Square ticket. Score 0–100 (address counts only for delivery). */
export function scoreFulfillment(elvi: { fulfillment: Fulfillment | null; address: string | null }, ticket: { fulfillment: Fulfillment; address: string | null }) {
  const ef = elvi.fulfillment || "PICKUP";
  const misses: string[] = [];
  const typeOk = ef === ticket.fulfillment || (ef !== "DELIVERY" && ticket.fulfillment !== "DELIVERY");
  if (!typeOk) misses.push(`fulfillment: Elvi ${ef}, ticket ${ticket.fulfillment}`);
  let addrOk = true;
  if (ticket.fulfillment === "DELIVERY" || ef === "DELIVERY") {
    const a = addressKey(elvi.address || ""), b = addressKey(ticket.address || "");
    addrOk = !!a && !!b && a === b;
    if (!addrOk) misses.push(!b ? "address: missing on ticket" : !a ? "address: Elvi did not catch it" : "address: different street/number");
  }
  const ticketMissedDelivery = ef === "DELIVERY" && ticket.fulfillment !== "DELIVERY";
  return { score: (typeOk ? 60 : 0) + (addrOk ? 40 : 0), typeOk, addrOk, misses, ticketMissedDelivery };
}

/** delivery1: Elvi's delivery dialog rules (customer app voice/touch + any Elvi-run phone order). A saved address is only
 *  offered when the caller's identity is verified by phone number (phone caller ID, or a verified app session). */
export function deliveryDialogRules(opts: { verifiedSavedStreet?: string | null } = {}) {
  return [
    `Before checkout, if pickup/delivery is not set yet, ask exactly: "${DELIVERY_TEXT.ask.es}" (English: "${DELIVERY_TEXT.ask.en}"). "Para llevar" / "to go" / "recoger" means PICKUP, not delivery. "A domicilio", "delivery", "me lo traen", "me lo mandan" mean DELIVERY.`,
    opts.verifiedSavedStreet
      ? `If DELIVERY: this customer is verified and has a saved address. Ask exactly: "${DELIVERY_TEXT.same.es.replace("{street}", opts.verifiedSavedStreet)}" (English: "${DELIVERY_TEXT.same.en.replace("{street}", opts.verifiedSavedStreet)}"). If no, ask for the new address.`
      : `If DELIVERY: ask for the full address (street, number, apartment, city). Never mention or guess a saved address — the customer is not verified.`,
    "After you have the address, call set_address and check_delivery_zone. When confirming, say the city, the delivery fee and the ETA from its result in one short sentence (use its message; if fee_confirmed is false, say the fee is approximate and staff will confirm it). If it says needs_confirm, say staff will confirm the delivery zone and fee — never guess a fee. If it is outside the delivery area, say so and offer pickup.",
    "Delivery needs a food subtotal of at least $10 before the delivery fee. If the cart is under $10, say: \"El mínimo para entrega es de $10.\" (English: \"The delivery minimum is $10.\") and offer to add something or switch to pickup. There is no service fee.",
  ].join(" ");
}
