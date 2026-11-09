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
  const source = personPickup(text)
    ? text.replace(/\brecoger\s+a\s+(?:mi|su|el|la|un|una)\s+\p{L}+/giu, " ").replace(/\b(?:él|ella|ellos|ellas)\s+(?:lo|la|los|las)\s+recoge\b/giu, " ")
    : text;
  let t = fulfillmentTokens(source);
  t = t.replace(NEGATED, " ");
  // raul1: "En delivery se fue" / driver out — not a DELIVERY order cue
  if (/(?:delivery|repartidor)\s+se\s+fue|se\s+fue\s+(?:el\s+)?(?:delivery|repartidor)|driver\s+(?:is\s+)?out/iu.test(text)) {
    t = t.replace(/__DELIVERY__/g, " ");
  }
  // "¿Para entrega a domicilio o para recoger?" is the question, not an answer.
  t = t.replace(/__(?:DELIVERY|PICKUP|FOR_HERE)__[^.!?]{0,40}?\b(?:o|or)\b[^.!?]{0,20}?__(?:DELIVERY|PICKUP|FOR_HERE)__/gi, " ");
  let last: Fulfillment | null = null;
  for (const m of t.matchAll(TOKEN)) last = m[1] as Fulfillment;
  return last;
}

/** Staff declines delivery / driver out — never keep DELIVERY from that cue (raul1). */
const STAFF_NO_DELIVERY = /\b(?:(?:el\s+)?delivery\s+se\s+fue|se\s+fue\s+(?:el\s+)?(?:delivery|repartidor)|driver\s+(?:is\s+)?out|no\s+(?:hay\s+)?delivery|ahorita\s+no(?:\s*,|\s+\p{L})|no\s+tenemos\s+(?:delivery|domicilio|repartidor)|(?:no\s+)?(?:tenemos|tiene(?:n)?)\s+(?:servicio\s+a\s+)?domicilio\s*(?:ahorita|ahora|hoy)?\b|no\s+delivery)\b/iu;

const CLOCK_HOUR: Record<string, number> = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const CLOCK_MIN: Record<string, number> = { cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, media: 30, cuarto: 15, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, half: 30, quarter: 15 };
const CLOCK_HOUR_WORD = "\\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
const CLOCK_MIN_WORD = "media|cuarto|cinco|diez|quince|veinte|treinta|cuarenta|\\d{1,2}|half|quarter|five|ten|fifteen|twenty|thirty|forty";
const FOLLOWS_TIME = /^(?:un|una|uno|dos|tres|de\s+(?:esas|bistec|birria)|sour|creams?|quesos?|tortillas?|casas?|both|ambas)\b/;
const BARE_COUNT_HOUR = new Set(["una", "uno", "dos", "tres", "one", "two", "three"]);

function foldClock(text: string): string {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function clockParts(hourRaw: string, minuteRaw?: string): string | null {
  const hour = Number(hourRaw) || CLOCK_HOUR[hourRaw];
  if (!hour || hour > 12) return null;
  if (minuteRaw && /^\d+$/.test(minuteRaw) && Number(minuteRaw) > 59) return null;
  const minute = minuteRaw ? (Number(minuteRaw) || CLOCK_MIN[minuteRaw] || 0) : 0;
  if (minute > 59) return null;
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

/** Caller clock only: "a las" / "para las" + hour, "at" + a clock, or am/pm / de la tarde. A count or a dish after the hour is not a time. */
export function spokenClock(text: string): { time: string; cue: string } | null {
  const p = foldClock(text);
  const patterns: Array<{ re: RegExp; cue: string }> = [
    { re: new RegExp(`\\ba\\s+las\\s+(${CLOCK_HOUR_WORD})(?:\\s+y\\s+(${CLOCK_MIN_WORD})|\\s+(${CLOCK_MIN_WORD}))?\\b`, "g"), cue: "a las" },
    { re: new RegExp(`\\bpara\\s+las\\s+(${CLOCK_HOUR_WORD})(?:\\s+y\\s+(${CLOCK_MIN_WORD})|\\s+(${CLOCK_MIN_WORD}))?\\b`, "g"), cue: "para las" },
    { re: new RegExp(`\\bat\\s+(\\d{1,2})(?::(\\d{2}))?(?:\\s*(am|pm))?\\b`, "g"), cue: "at" },
    { re: new RegExp(`\\b(${CLOCK_HOUR_WORD})\\s*(am|pm)\\b`, "g"), cue: "ampm" },
    { re: new RegExp(`\\b(${CLOCK_HOUR_WORD})\\s+de\\s+la\\s+(tarde|manana|noche)\\b`, "g"), cue: "daypart" },
  ];
  let found: { time: string; cue: string } | null = null;
  for (const pattern of patterns) {
    for (const match of p.matchAll(pattern.re)) {
      const after = p.slice((match.index || 0) + match[0].length).trim();
      if (FOLLOWS_TIME.test(after) || DISH_AFTER_HOUR.test(after)) continue;
      const minuteRaw = match[2] && /am|pm|tarde|manana|noche/.test(match[2]) ? undefined : (match[2] || match[3]);
      const hourWord = String(match[1] || "");
      if (!minuteRaw && BARE_COUNT_HOUR.has(hourWord) && pattern.cue !== "ampm" && pattern.cue !== "daypart") continue;
      const time = clockParts(hourWord, minuteRaw);
      if (time) found = { time, cue: pattern.cue };
    }
  }
  return found;
}

/** Last caller clock. Staff turns never set a ready time. */
export function callerReadyTime(turns: Array<{ speaker?: string; text?: string }>): { time: string; turn: number; speaker: "caller"; cue: string } | null {
  let found: { time: string; turn: number; speaker: "caller"; cue: string } | null = null;
  turns.forEach((turn, index) => {
    if (turn.speaker !== "caller") return;
    const clock = spokenClock(String(turn.text || ""));
    if (clock) found = { time: clock.time, turn: index, speaker: "caller", cue: clock.cue };
  });
  return found;
}

const WAIT_WORD: Record<string, number> = { cinco: 5, diez: 10, quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, media: 30, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };

/** Staff "dame quince minutos" is a wait, not a clock time. */
export function staffWaitMinutes(turns: Array<{ speaker?: string; text?: string }>): { minutes: number; turn: number; speaker: "staff"; cue: "minutos" } | null {
  let found: { minutes: number; turn: number; speaker: "staff"; cue: "minutos" } | null = null;
  turns.forEach((turn, index) => {
    if (turn.speaker !== "staff") return;
    const p = foldClock(String(turn.text || ""));
    const match = p.match(/\b(\d+|cinco|diez|quince|veinte|veinticinco|treinta|cuarenta|media|five|ten|fifteen|twenty|thirty)\s*(?:minutos?|mins?|minutes?)\b/);
    if (!match) return;
    const minutes = Number(match[1]) || WAIT_WORD[match[1]];
    if (!minutes || minutes > 180) return;
    found = { minutes, turn: index, speaker: "staff", cue: "minutos" };
  });
  return found;
}

const DISH_AFTER_HOUR = /^(?:de\s+)?(?:quesadillas?|tacos?|tortas?|gorditas?|burritos?|birrias?|menudos?|orden(?:es)?|platillos?|platos?|fajitas?|sopes?|tostadas?|enchiladas?|tamales?|aguas?|horchatas?|jamaicas?|cocas?|pepsis?|sour|creams?|quesos?|tortillas?|casas?)\b/;

/** Cue token for a fulfillment phrase. Not the sentence. */
export function fulfillmentCue(text: string): string | null {
  if (personPickup(text) || !fulfillmentIn(text)) return null;
  const p = foldClock(text);
  if (/\brecoger/.test(p)) return "recoger";
  if (/\bllevar\b/.test(p)) return "llevar";
  if (/\bdomicilio\b/.test(p)) return "domicilio";
  if (/\bdelivery\b|\bdeliver\b/.test(p)) return "delivery";
  if (/\bpick\s*-?\s*up\b|\bto\s+go\b|\bcarry\s*out\b/.test(p)) return "pickup";
  if (/\bfor\s+here\b|\bpara\s+aqui\b/.test(p)) return "for-here";
  return fulfillmentIn(text)?.toLowerCase() || null;
}

/** Picking up a person or a driver is not a to-go order. */
export function personPickup(text: string): boolean {
  const p = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\brecoger\s+a\s+(?:mi|su|el|la|un|una)\b/.test(p)
    || /\b(?:el|ella|ellos|ellas)\s+(?:lo|la|los|las)\s+recoge\b/.test(p);
}

/** Fulfillment for a whole call (caller + staff read-back, in time order). Default null = not said (ticket stays TO GO). */
export function detectFulfillment(turns: Turnish[]): { fulfillment: Fulfillment | null; by: "caller" | "staff" | null; heard: string | null } {
  let out: { fulfillment: Fulfillment | null; by: "caller" | "staff" | null; heard: string | null } = { fulfillment: null, by: null, heard: null };
  for (const t of [...turns].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))) {
    // raul1 (CA8debe0): "Ahorita no, Raúl" / "En delivery se fue" → force PICKUP (staff capability)
    if ((t.speaker === "staff" || !t.speaker) && STAFF_NO_DELIVERY.test(t.text)) {
      out = { fulfillment: "PICKUP", by: "staff", heard: t.text.slice(0, 160) };
      continue;
    }
    const f = fulfillmentIn(t.text.replace(/\bdeliver(?:ie|y\u2019?)s\b/giu, "delivery"))
      // alex3: staff "ahorita te la llevamos" / "se la llevamos" = staff took it as a delivery
      || ((t.speaker === "staff") && /\b(?:te|se)\s+(?:la|lo|las|los)\s+llev(?:amos|o)\b/iu.test(t.text) && !/\bpara\s+llevar\b/iu.test(t.text) ? "DELIVERY" as Fulfillment : null);
    if (f && !(out.fulfillment === "DELIVERY" && f === "PICKUP" && out.by === "staff" && t.speaker === "staff" && /llev/i.test(t.text))) out = { fulfillment: f, by: t.speaker || "caller", heard: t.text.slice(0, 160) };
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
  // julian1 (CAb91612): wait-time phrases never hold an address: "Dame unos 15, 20, Julián" / "como 20 minutos" / "15 to 20 minutes".
  text = String(text || "")
    .replace(/\b(?:dame|deme|denme|danos|d[eé]jame|give\s+(?:me|us)|unos|unas|about|around)\s+(?:unos\s+|about\s+)?\d{1,2}(?:\s*(?:,|-|a|o|y|to|or|and)\s*\d{1,2})*\b(?:\s*(?:minutos?|mins?|minutes?))?/giu, " ")
    .replace(/\b\d{1,2}(?:\s*(?:,|-|a|o|y|to|or|and)\s*\d{1,2})*\s*(?:minutos?|mins?|minutes?)\b/giu, " ");
  let t = String(text || "").replace(
    /\b(\d{1,6})\s+([a-záéíóúñ.'-]+)\s*,\s*\2\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b/giu,
    "$1 $2 $3",
  );
  // juan1: STT "8 7 2 Bank Street" / "8 72 Bank" → "872 Bank Street" (spaced house digits)
  t = t
    .replace(/\b(\d)\s+(\d)\s+(\d)\s+(\d)?\b/g, (_, a, b, c, d) => d != null ? a + b + c + d : a + b + c)
    .replace(/\b(\d)\s+(\d{2,4})\b/g, "$1$2")
    .replace(/\b(\d{2,4})\s+(\d)\b/g, "$1$2");
  // brenda1: prices are never addresses — "it's 35 25", "that's 35.25", "$12.50", "total is 20 dollars", "son 35 con 25"
  t = t.replace(/\$\s*\d+(?:[.,]\d{1,2})?/g, " ")
    .replace(/\b(?:it'?s|it\s+is|that'?s|that\s+is|that\s+will\s+be|that'?ll\s+be|total(?:\s+is)?|comes\s+to|be|son|ser[ií]an?|ser[aá]|cuesta|es|fueron|price\s+is|precio\s+es)\s+\d{1,3}(?:[.,]\d{2}|\s+(?:con\s+)?\d{2}(?![a-z0-9])(?!\s*(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way)\b))\b(?:\s*(?:dollars?|d[oó]lares|bucks|cents?|centavos))?/giu, " ")
    .replace(/\b\d+(?:[.,]\d{1,2})?\s*(?:dollars?|d[oó]lares|bucks|cents?|centavos)\b/giu, " ");
  // chalino1 (CAe85a69): phone digits are never a house number — "dame tu número… 2 6 2 2 9", "my number is 262…", "phone 262…"
  // ("el número de tu casa" / "house number" are not phone cues).
  t = t.replace(/\b(?:(?:tu|su|mi|your|my|el|the)\s+(?:n[uú]mero(?!\s+de\s+(?:tu|su|la|mi)\s+casa)|tel[eé]fono|cel(?:ular)?|phone(?:\s+number)?|cell(?:\s+number)?|number)|tel[eé]fono|phone\s+number|call\s+back\s+number)\b([^\d]{0,40}?)((?:\d[\d\s().-]*)+)/giu, (_m, gap) => " " + gap + " ");
    // cad71199: "478, Bank Street" / "4 78, Bank Street" → "478 Bank Street"
  t = t.replace(/\b(\d{1,6}),\s+(?=[a-záéíóúñ])/giu, "$1 ");
  // acevedo1 (CA99d48f): "127 calle Amor" (number before calle/avenida) → "127 Amor St"; never "127 Calle St".
  t = t.replace(/\b(\d{1,6})\s+(calle|avenida|av\.?)\s+([a-záéíóúñ][a-záéíóúñ.'-]{2,}(?:\s+[a-záéíóúñ][a-záéíóúñ.'-]{2,})?)\b/giu,
    (_m, n, k, name) => `${n} ${name.replace(/\s+(?:por favor|please|oiga|mano)$/i, "")} ${/^av/i.test(k) ? "Avenue" : "Street"}`);
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
  // caguamas1/callback1: "a la William 544" / "544 La Williams" (no St/Ave). Require street-like token; reject "25 por"/time phrases.
  if (!out.length) {
    const BAD = /^(calles?|avenidas?|tacos?|quesadillas?|menudos?|gorditas?|tortas?|burritos?|ordenes?|orders?|aguas?|horchata|unos?|unas?|para|por|con|sin|las?|los?|una?|tres|dos|cuatro|cinco|ah|oh|eh|ok|okay|muy|bien|minutos?|dame|unos|lo|menos|también|tambien|sería|seria|todo|domicilio|delivery|entrega|pickup|repartidor)$/i;
    for (const m of t.matchAll(/\b(?:a\s+(?:a\s+)?(?:la\s+)?)([a-záéíóúñ][a-záéíóúñ.'-]{2,})\s+(\d{2,6})\b/giu)) {
      const name = title(m[1]);
      if (BAD.test(name) || name.length < 4) continue;
      out.push({ at: m.index ?? 0, a: fmt({ street: `${m[2]} ${name} St` }) });
    }
    for (const m of t.matchAll(/\b(\d{2,6})\s+(?:la\s+)([a-záéíóúñ][a-záéíóúñ.'-]{2,})\b/giu)) {
      const name = title(m[2]);
      if (BAD.test(name) || name.length < 4) continue;
      out.push({ at: m.index ?? 0, a: fmt({ street: `${m[1]} ${name} St` }) });
    }
    // gerardo1 (CAdf3a04): "fairground número 85" / "Fairground 85" / "85 Fairground" (no St/Ave spoken)
    const BAD2 = /^(calles?|avenidas?|tacos?|quesadillas?|menudos?|gorditas?|tortas?|burritos?|ordenes?|orders?|aguas?|horchata|unos?|unas?|para|por|con|sin|las?|los?|una?|tres|dos|cuatro|cinco|seis|siete|ocho|nueve|diez|ah|oh|eh|ok|okay|muy|bien|minutos?|dame|unos|lo|menos|también|tambien|sería|seria|todo|total|gerardo|h[eé]ctor|thank|thanks|bye|you|please|brenda|minutes?|dollars?|cents?|it's|that's|josh|vale|dale|okey|sim[oó]n|simon|chente|domicilio|delivery|entrega|pickup|repartidor|joven)$/i;
    const key3 = (st: string) => st.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3).join(" ");
    for (const m of t.matchAll(/\b([a-záéíóúñ][a-záéíóúñ.'-]{3,})\s+(?:n[uú]mero\s+)?(\d{2,6})\b/giu)) {
      const name = title(m[1]);
      if (BAD2.test(name) || BAD.test(name) || name.length < 4) continue;
      const street = `${m[2]} ${name} St`;
      if (out.some((x) => key3(x.a.street) === key3(street))) continue;
      out.push({ at: m.index ?? 0, a: fmt({ street }) });
    }
    for (const m of t.matchAll(/\b(\d{2,6})\s+([a-záéíóúñ][a-záéíóúñ.'-]{3,})\b/giu)) {
      const name = title(m[2]);
      if (BAD2.test(name) || BAD.test(name) || name.length < 4) continue;
      if (/^(a|y|e|o|or|and|to|de|en)$/i.test(name)) continue;
      const street = `${m[1]} ${name} St`;
      if (out.some((x) => key3(x.a.street) === key3(street))) continue;
      out.push({ at: m.index ?? 0, a: fmt({ street }) });
    }
  }
  return out.sort((x, y) => x.at - y.at).map((x) => x.a);
}
export const addressKey = (a: string) => String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3).join(" ");

// jonathan2 (CA11d424f): staff "es la West Walnut, quinientos uno" + caller "Sí" is the delivery address.
// Hundreds-words are house numbers here ("quinientos cuarenta y cuatro" = 544); a bare "tres" stays a food count.
const ES_CARD: Record<string, number> = {
  un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
  seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};
const STREET_BAD = /^(?:quesadillas?|tacos?|gorditas?|tortas?|burritos?|sopes?|doradas?|dorados?|comal|harina|taquera|taquero|duro|prensado|bistec|pastor|chorizo|coca|coke|cocas|delivery|domicilio|joven|mano|calle|numero|direccion|entrega|gracias|okay|okey|total|dolares|precio|para|como|donde|este|esta|eso|esa|todo|nada|mas|nomas|botella|vidrio|quesadilla|joven)$/i;
// \b is ASCII-only, so it never fires after "Sí" / "ajá". (?!\p{L}) is the boundary.
const ADDR_YES = /^\W*(?:s[ií]|yes|yeah|yep|aja|ajá|correcto|exacto|as[ií]\s+es|eso(?:\s+es)?|ok(?:ay)?|claro|est[aá]\s+bien)(?!\p{L})/iu;
/** Spanish cardinal used as a house number. Rejects small food counts ("tres") unless a hundreds word is present. */
export function spanishHouseNumber(phrase: string): number | null {
  const raw = String(phrase || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (/^\d{1,6}$/.test(raw)) { const n = Number(raw); return n >= 1 && n <= 999999 ? n : null; }
  const parts = raw.split(" ").filter((w) => w && w !== "y");
  if (!parts.length || parts.length > 6) return null;
  let n = 0;
  for (const w of parts) { const v = ES_CARD[w]; if (v == null) return null; n += v; }
  if (!parts.some((w) => (ES_CARD[w] || 0) >= 100) && n < 20) return null;
  return n >= 20 && n <= 99999 ? n : null;
}
/** Staff reads a street back ("West Walnut, quinientos uno" / "Williams, quinientos cuarenta y cuatro") and the caller says sí. */
export function staffConfirmedStreet(turns: Turnish[]): Address | null {
  const ts = [...turns].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const re = /\b(?:es\s+)?(?:la|el|en(?:\s+la)?\s+)?((?:north|south|east|west)\s+)?([a-z][a-z.'-]{3,}(?:\s+[a-z][a-z.'-]{3,})?)\s*,\s*((?:doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|ciento|cien|\d{2,6})(?:\s+(?:y\s+)?(?:uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintitres|veinticuatro|veinticinco|veintiseis|veintisiete|veintiocho|veintinueve|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|y))*)/giu;
  let found: Address | null = null;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]; if ((t.speaker || "caller") === "caller") continue;
    const text = String(t.text || "").normalize("NFD").replace(/\p{M}/gu, "");
    for (const m of text.matchAll(re)) {
      const name = m[2];
      if (name.split(/\s+/).some((w) => STREET_BAD.test(w))) continue;
      const num = spanishHouseNumber(m[3]); if (!num || num < 20) continue;
      const nxt = ts.slice(i + 1).find((x) => (x.speaker || "caller") === "caller");
      if (!nxt || !ADDR_YES.test(nxt.text)) continue;
      if (/\b(?:no|nel|otra|diferente)\b/iu.test(nxt.text) && !/^\W*s[ií]\b/iu.test(nxt.text)) continue;
      const dir = m[1] ? `${title(m[1])} ` : "";
      found = fmt({ street: `${num} ${dir}${title(name)}`.replace(/\s+/g, " ").trim() });
    }
  }
  return found;
}

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
  // jonathan2: staff "West Walnut, quinientos uno" + caller "Sí" beats a missing or unconfirmed fragment.
  { const rb = staffConfirmedStreet(turns); if (rb && (!best || (seen[addressKey(best.address.street)]?.size || 0) < 2)) return { address: rb, confirmed: true, by: "staff" }; }
  // chalino1: the caller's answer to "¿el número de tu casa?" beats a loose unconfirmed "rollo. 24" (price) match.
  { const h = houseNumberAnswer(turns); if (h && (!best || (seen[addressKey(best.address.street)]?.size || 0) < 2)) return { address: h, confirmed: false, by: "caller" }; }
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

const ES_UNITS: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
/** chalino1: staff "¿me das el número de tu casa?" → caller "en la Portland." / "es 2:46" (STT clock) → "246 Portland". The caller's
 *  street word next to the ask + the caller's number after it; suffix unknown so none is invented. */
export function houseNumberAnswer(turns: Turnish[]): Address | null {
  const ts = [...turns].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const ask = /n[uú]mero\s+de\s+(?:tu|su|la)\s+casa|house\s+number|address\s+number|n[uú]mero\s+de\s+(?:la\s+)?direcci[oó]n/iu;
  const i = ts.findIndex((t) => t.speaker === "staff" && ask.test(t.text));
  if (i < 0) return null;
  const near = ts.slice(Math.max(0, i - 2), i + 4).filter((t) => (t.speaker || "caller") === "caller");
  let street: string | null = null;
  for (const t of near) {
    const m = String(t.text).match(/\b(?:en|a)\s+(?:la|el)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][a-záéíóúñ'-]{3,}(?:\s+[A-Z][a-z]{2,})?)/u);
    if (m && !/^(calle|casa|esquina|tienda|escuela|iglesia|parte)$/i.test(m[1])) street = title(m[1]);
  }
  let num: string | null = null;
  for (const t of ts.slice(i + 1, i + 5).filter((t) => (t.speaker || "caller") === "caller")) {
    const m = String(t.text).match(/\b(\d{1,2}):(\d{2})\b|\b(\d{2,6})\b/);
    if (m) { num = m[3] || m[1] + m[2]; break; }
  }
  if (!street || !num) return null;
  return fmt({ street: `${num} ${street}` });
}

/** alex3: a caller's "Aquí en Perry" with no street → the town (never a street), for an unconfirmed zone/fee quote. */
export function cityHeard(turns: Turnish[]): string | null {
  const re = new RegExp(`\\b(?:aqu[ií]\\s+en|estoy\\s+en|vivo\\s+en|en|in|to)\\s+(${CITIES})\\b`, "iu");
  for (const t of [...turns].reverse()) { if (t.speaker === "staff") continue; const m = String(t.text).match(re); if (m) return `${title(m[1])}, OH`; }
  return null;
}
