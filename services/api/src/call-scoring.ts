// Listen-only call scoring: split the dual-channel recording (ch1 = caller, ch2 = staff),
// transcribe each track with word timestamps, interleave into turns, and replay the caller
// turns through Elvi's order context one at a time (shadow session, never checkout).
import { applySharedAliases } from "./aliases.js";
import { fulfillmentIn, detectFulfillment } from "./delivery.js";
export type Speaker = "caller" | "staff";
export type CallTurn = { speaker: Speaker; start: number; end: number; text: string; language: "es" | "en" };
type Word = { text: string; start: number; end: number };

/** Split a 16-bit PCM WAV into one mono WAV per channel. */
export function splitWavChannels(buf: Buffer): Buffer[] {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a WAV file");
  let off = 12, fmt: { ch: number; rate: number; bits: number } | null = null, data: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4), size = buf.readUInt32LE(off + 4), body = off + 8;
    if (id === "fmt ") fmt = { ch: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === "data") data = buf.subarray(body, Math.min(buf.length, body + size));
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("bad WAV");
  if (fmt.bits !== 16) throw new Error(`unsupported WAV bits ${fmt.bits}`);
  const frames = Math.floor(data.length / (2 * fmt.ch));
  return Array.from({ length: fmt.ch }, (_, c) => {
    const pcm = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) pcm.writeInt16LE(data!.readInt16LE((i * fmt!.ch + c) * 2), i * 2);
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(fmt!.rate, 24); h.writeUInt32LE(fmt!.rate * 2, 28);
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([h, pcm]);
  });
}

/** Seconds of real speech energy (20 ms frames above an RMS floor). Echo/line noise stays near 0. */
function activeSeconds(wav: Buffer, rate = 8000, floor = 900) {
  const frame = Math.max(1, Math.round(rate * 0.02));
  let active = 0;
  for (let i = 44; i + frame * 2 <= wav.length; i += frame * 2) {
    let sum = 0;
    for (let j = 0; j < frame; j += 1) { const v = wav.readInt16LE(i + j * 2); sum += v * v; }
    if (Math.sqrt(sum / frame) > floor) active += 1;
  }
  return active * 0.02;
}

function peak(wav: Buffer) {
  let m = 0;
  for (let i = 44; i + 1 < wav.length; i += 2) m = Math.max(m, Math.abs(wav.readInt16LE(i)));
  return m;
}

export async function sttWords(wav: Buffer): Promise<{ words: Word[]; language: string; text: string }> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "track.wav");
  const r = await fetch("https://api.x.ai/v1/stt", { method: "POST", headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` }, body: form });
  const body = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new Error(`xAI STT ${r.status}: ${body?.error?.message || ""}`);
  return { words: Array.isArray(body.words) ? body.words : [], language: String(body.language || ""), text: String(body.text || "") };
}

const ES = /\b(quiero|quisiera|de|con|sin|por favor|gracias|una?|dos|tres|cuatro|cinco|mejor|solo|nada|más|para|recoger|sí|bueno|orden|también|así|está|bien|lleva|frijoles|arroz)\b|[ñáéíóú¿¡]/gi;
const EN = /\b(i|i'd|can|get|want|would|like|the|with|without|and|please|thanks|thank|you|actually|make|it|only|just|one|two|three|four|for|pickup|that's|all|yes|no|order)\b/gi;
export function detectLanguage(text: string, fallback: "es" | "en" = "es"): "es" | "en" {
  const es = (text.match(ES) || []).length, en = (text.match(EN) || []).length;
  return es === en ? fallback : es > en ? "es" : "en";
}

/** Group words into utterances: a new one starts after a pause of `gap` seconds. */
function utterances(words: Word[], speaker: Speaker, fallback: "es" | "en", gap = 0.9): CallTurn[] {
  const out: CallTurn[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && w.start - last.end <= gap) { last.text += " " + w.text; last.end = w.end; }
    else out.push({ speaker, start: w.start, end: w.end, text: w.text, language: fallback });
  }
  for (const t of out) t.language = detectLanguage(t.text, fallback);
  return out;
}

export async function transcribeDualChannel(wav: Buffer, opts: { callerChannel?: 1 | 2 } = {}): Promise<CallTurn[]> {
  // Ring-through calls: channel 1 = caller. Counter-phone (queue) calls may put the counter on channel 1: callerChannel = 2.
  const [ch1, ch2] = splitWavChannels(wav);
  const [caller, staff] = opts.callerChannel === 2 ? [ch2, ch1] : [ch1, ch2];
  const tracks: Array<[Speaker, Buffer | undefined]> = [["caller", caller], ["staff", staff]];
  const turns: CallTurn[] = [];
  for (const [speaker, track] of tracks) {
    if (!track || peak(track) < 200) continue; // silent track
    // Staff leg with no real speech (only a faint echo of the caller) is skipped; STT invents words from echo.
    if (speaker === "staff" && activeSeconds(track, track.readUInt32LE(24)) < 0.5) continue;
    const { words, language } = await sttWords(track);
    turns.push(...utterances(words, speaker, language === "en" ? "en" : "es"));
  }
  // The staff whisper ("Llamada de María.") may land at the start of the staff track; it isn't conversation.
  return dropEcho(turns.sort((a, b) => a.start - b.start)).filter((t, i) => !(t.speaker === "staff" && t.start < 6 && /^\s*llamada de [\p{L}'’-]+[.!]?\s*$/iu.test(t.text)));
}

const wordsOf = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").split(/\s+/).filter(Boolean);
/**
 * The staff leg often carries a faint echo of the caller (same words, same time). A staff utterance whose words
 * mostly repeat caller speech at the same moment (overlapping in time) is echo, not staff talking.
 */
export function dropEcho(turns: CallTurn[]): CallTurn[] {
  const caller = turns.filter((t) => t.speaker === "caller");
  return turns.filter((t) => {
    if (t.speaker !== "staff") return true;
    const near = caller.filter((c) => c.start <= t.end + 0.4 && c.end >= t.start - 0.4).flatMap((c) => wordsOf(c.text));
    const w = wordsOf(t.text);
    if (!w.length || !near.length) return !!w.length;
    const set = new Set(near);
    return w.filter((x) => set.has(x)).length / w.length < 0.6;
  });
}

const QTY = "(?:un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)";
/** "tres tacos de pastor y un burrito de asada con frijoles" -> two item phrases. "con arroz y frijoles" stays whole. */
export function splitItems(text: string): string[] {
  // Drop a trailing "sería todo / thanks" so it stays with the order phrase for meat-list splits (fix21).
  let stripped = text.trim();
  // Peel trailing closings (possibly stacked: "…, y sería todo. Gracias").
  for (let i = 0; i < 3; i++) {
    const next = stripped.replace(/[,.\s]+(?:y\s+)?(?:ser[ií]a\s+todo|es\s+todo|eso\s+es\s+todo|nada\s+m[aá]s|that'?s\s+(?:all|it|everything)|gracias|thanks?|thank\s+you)\.?\s*$/iu, "").trim();
    if (next === stripped) break;
    stripped = next;
  }
  if (!stripped) stripped = text;
  // split1: "tres quesadillas doradas, una de bistec y dos de pollo" — the total splits across meats (not 3 of the first meat).
  { const n = (w: string) => ({ un: 1, una: 1, uno: 1, one: 1, a: 1, an: 1 } as Record<string, number>)[w.toLowerCase()] || QTY_N[w.toLowerCase()] || Number(w) || 0;
    const m = stripped.match(new RegExp(`^(.*?)\\b(${QTY})\\s+([\\p{L}][\\p{L} ]{2,40}?)\\s*,\\s*(${QTY}\\s+(?:de|of)\\s+.+)$`, "iu"));
    if (m && !/\b(?:de|of)\b/iu.test(m[3])) { const parts = m[4].split(new RegExp(`\\s*(?:,|\\by\\b|\\band\\b)\\s*(?=${QTY}\\s+(?:de|of)\\s)`, "iu")).map((x) => x.trim()).filter(Boolean);
      const qs = parts.map((x) => n(x.split(/\s+/)[0])); const total = n(m[2]);
      if (parts.length >= 2 && total > 1 && qs.every((q) => q > 0) && qs.reduce((a, b) => a + b, 0) === total)
        stripped = `${m[1]}${parts.map((x) => x.replace(/^(\S+)\s+(de|of)\s+/iu, `$1 ${m[3].trim()} $2 `)).join(", y ").replace(/,\s*,/g, ",").replace(/,(\s*,\s*y)/g, "$1")}`; } }
  const parts = stripped.split(new RegExp(`\\s*(?:,|;|\\by\\b|\\band\\b|\\btambién\\b|\\balso\\b|\\bplus\\b)\\s+(?=(?:(?:me\\s+)?(?:das|da|pones|give me|get me|add)\\s+)?${QTY}\\s+\\p{L})`, "giu"));
  // fix21: "una de chorizo, una de tepa y otra de buche" continues the same dish — rejoin those pieces.
  const out: string[] = [];
  for (const raw of parts) {
    const piece = raw.trim();
    if (!piece) continue;
    if (out.length && /^(?:una?|uno|otra?|otro|another|one)\s+de\s+[\p{L}]/iu.test(piece)) {
      out[out.length - 1] = `${out[out.length - 1]}, ${piece}`;
      continue;
    }
    out.push(piece);
  }
  return out;
}

const LEAD = /^(?:(?:hola|hi|hello|hey|oye|sí|si|yes|okay|ok|bueno)\b[,.!]?\s*|no[,.!]\s+|(?:buenas\s+(?:tardes|noches)|buenos\s+días|good\s+(?:morning|afternoon|evening))[,.!]?\s*|(?:quiero|quisiera|dame|me\s+(?:das|da|pones|puedes\s+dar|regalas)|can\s+i\s+(?:get|have)|could\s+i\s+(?:get|have)|i(?:'d|\s+would)\s+like|i\s+want|let\s+me\s+get|i'll\s+have)\s+)/iu;
// fix20: bare "no" is NOT filler — "no crema" / "no, mejor tres" must keep the "no". Only "no," / "no!" as a discourse tag is stripped.
/** Phone filler the menu resolver doesn't need: "Hola, buenas tardes. Quiero tres tacos..." -> "tres tacos...". */
export function cleanPhrase(text: string): string {
  let t = text.trim().replace(/^[.,!¡¿\s]+/, "");
  for (let i = 0; i < 6; i++) {
    const n = t.replace(/^[^.!?]*\b(?:buenas\s+(?:tardes|noches)|buenos\s+días|good\s+(?:morning|afternoon|evening))\b[.!?,]\s*/iu, "").replace(LEAD, "").replace(/^[.,!¡¿\s]+/, "");
    if (n === t) break;
    t = n;
  }
  // aliases1: shared phone+app spoken aliases (data/aliases/aliases.json).
  // contodo2: the shared "con todo" alias strips the words, but withConTodo (sopesaso1) needs them to add the standard
  // toppings — on the phone path keep "con todo" (the standalone "Con todo, por favor." answer already worked)
  const pre = t.replace(/[,\s]*(?:please|por\s+favor)\b/giu, "").replace(/[.?!\s]+$/u, "").trim();
  const out = applySharedAliases(pre, "phone");
  return /\bcon\s+todo\b/iu.test(pre) && !/\bcon\s+todo\b/iu.test(out) && /\b(?:burritos?|sopes?|sopesa[sz]os?|huaraches?|guaraches?)\b/iu.test(out) ? `${out}, con todo` : out; // tacos: onion+cilantro are already included
}
const CLOSING = /^(?:no[,.\s]*)?(?:es\s+todo|eso\s+es\s+todo|nada\s+más|sería\s+todo|that'?s\s+(?:all|it|everything)|no\s+thanks?|gracias|bueno|ok(?:ay)?|sale|perfecto|listo|alright|great|thanks?|thank\s+you|para\s+recoger|for\s+pick\s*up|pickup)\b/iu;
const FOOD = /\b(?:tacos?|burritos?|quesadillas?|qd|gorditas?|tortas?|combo|enchiladas?|tamales?|horchata|jamaica|jarritos?|agua|soda|bowl|nachos|elote|esquite|pack|platter|charola|sopesazos?|sopesasos?|sopes?|huaraches?|guaraches?|tostadas?|mariscos|cocktail|cóctel)\b/iu;
/** fix22: "Bueno, quiero un guarache…" is an order, not a hang-up. Strip discourse openers before the closing check. */
const QTY_N: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, two: 2, three: 3, four: 4, five: 5, six: 6 };
/** qty1: "Dos tacos de bistec" → Elvi asks the tortilla → "Sí, de hecha mano. Y también dos de," answers that question, so the
 *  add keeps the 2 already asked for. Only when the answer's first clause names no quantity of its own, the dish is the one
 *  the caller just asked for, and the AI rang 1. Mutates acts in place. */
export function isRestatement(text: string, a: any, cart: any[], sig: (x: any) => string): boolean {
  if (a?.type !== "add_item") return false;
  const t = String(text).trim().replace(/[.,!¡¿?]+$/u, "");
  const m = t.match(/^(?:y\s+)?(dos|tres|cuatro|cinco|seis|\d+)\s+de\s+[\p{L} ]{3,30}$/iu);
  if (!m || /\b(m[aá]s|otr[oa]s|tambi[eé]n|also|more)\b/i.test(t) || FOOD.test(t)) return false;
  const n = QTY_N[m[1].toLowerCase()] || Number(m[1]);
  return cart.some((l: any) => sig(l) === sig(a) && (l.quantity || 1) === n && (a.quantity || 1) === n);
}
export function carryAskedQty(acts: any[], text: string, prevCustomer: string, answering: boolean) {
  if (!answering || !prevCustomer) return;
  const m = prevCustomer.match(/\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|\d+)\s+(tacos|quesadillas|gorditas|tortas|burritos|sopes|sopesa[sz]os|huaraches|tostadas|tamales|enchiladas)\b/i);
  if (!m) return;
  const n = QTY_N[m[1].toLowerCase()] || Number(m[1]); if (!(n > 1)) return;
  const first = text.split(/[.;!?]|\s+y\s+(?:tambi[eé]n\s+)?|\s+and\s+/i)[0] || "";
  if (/\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|\d+)\b/i.test(first)) return;
  const stem = m[2].toLowerCase().replace(/(?:es|s)$/, "").replace(/sopesaz?o?/, "sopesaso").replace(/sope$/, "sope");
  const adds = acts.filter((a) => a?.type === "add_item" && String(a.itemId || "").toLowerCase().includes(stem.slice(0, 5)));
  if (adds.length === 1 && (adds[0].quantity || 1) === 1) adds[0].quantity = n;
}
export const isClosing = (t: string) => {
  let s = t.trim();
  if (!s || FOOD.test(s)) return false;
  // orders1: "that's it, I'd like five orders" sets a count — not a goodbye
  if (/\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:orders?|[oó]rdenes|more|m[aá]s)\b/iu.test(s)) return false;
  const body = s.replace(/^(?:bueno|ok(?:ay)?|listo|perfecto|sale|alright|great|sí|si|yes)[,.!]?\s+/iu, "").trim();
  if (body && body !== s && body.length > 8) s = body;
  return CLOSING.test(s) && !FOOD.test(s);
};

/**
 * ticket5: NO BEBIDA / NO DRINK is the kitchen's container divider. A caller asking to pack/plate food separately
 * ("en diferentes recipientes", "separado", "en dos órdenes", "in separate containers", "split it") gets
 * N containers on the ticket. A condiment on the side ("la salsa aparte") is NOT a split, and "y aparte una
 * horchata" (aparte = also, followed by food) is not either.
 */
export type ContainerSplit = { parts: number; phrase: string; rest: string };
export type ContainerPlan = { breaks: number[]; splits: Array<{ parts: number; from: number; to: number | null }>; phrases: string[] };
const SPLIT_N: Record<string, number> = { dos: 2, two: 2, "2": 2, tres: 3, three: 3, "3": 3, cuatro: 4, four: 4, "4": 4 };
const CONTAINER = String.raw`(?:recipientes?|contenedores?|containers?|platos?|platitos?|cajas?|cajitas?|boxes|box|bolsas?|bags?|charolas?|plates?|to-?go\s+boxes|empaques?)`;
const NWORD = String.raw`(?:dos|tres|cuatro|2|3|4|two|three|four)`;
const SPLIT_PATTERNS: RegExp[] = [
  // en diferentes recipientes / en dos contenedores / in separate containers / in two boxes
  new RegExp(String.raw`\b(?:en|in|into)\s+(?:(?:sus|unos|unas|their|its)\s+)?(${NWORD}|diferentes|distint[oa]s|separad[oa]s|otr[oa]s?|vari[oa]s|individuales|different|separate|individual|own)\s+${CONTAINER}(?:\s+(?:separad[oa]s|diferentes|aparte))?`, "iu"),
  // en dos órdenes / dos órdenes separadas / two separate orders / split into two orders
  new RegExp(String.raw`\b(?:en|in|into)\s+(${NWORD})\s+(?:[oó]rdenes|orders)\b`, "iu"),
  new RegExp(String.raw`\b(${NWORD})\s+(?:[oó]rdenes|orders)\s+(?:separad[oa]s|aparte|diferentes|distint[oa]s)`, "iu"),
  new RegExp(String.raw`\b(${NWORD})\s+(?:separate|different)\s+(?:orders|${CONTAINER})`, "iu"),
  new RegExp(String.raw`\b(?:separate|different)\s+${CONTAINER}`, "iu"),
  // split it / split them in two / divídelas en dos
  new RegExp(String.raw`\bsplit\s+(?:it|them|that|those|the\s+order|this|it\s+up|them\s+up|in|into)(?:\s+(?:in|into)\s+(${NWORD}))?`, "iu"),
  new RegExp(String.raw`\b(?:div[ií]d\w*|separ[ae]\w*|reparte\w*|partel[oa]s?)\s+(?:en|in)\s+(${NWORD})\b`, "iu"),
  // por separado / separadas / separately / packed separately
  new RegExp(String.raw`\b(?:por\s+separado|separad[oa]s?|separately)\b`, "iu"),
  // empacadas aparte / por aparte / en otro recipiente aparte / "y las otras tres aparte" (aparte at the end)
  new RegExp(String.raw`\b(?:por|empacad[oa]s?|empaquetad[oa]s?|puest[oa]s?|servid[oa]s?|platead[oa]s?|emplatad[oa]s?|p[oó]n\w*|ech\w*)\s+aparte\b`, "iu"),
  new RegExp(String.raw`\baparte\s*[.!?]*\s*$`, "iu"),
];
// "tres y tres" / "3 and 3" / "mitad y mitad" right after a split request: just how to divide, never a new dish.
const SPLIT_SHARES = new RegExp(String.raw`^[¿¡\s]*(?:(?:${NWORD}|una?|uno|one|seis|six|cinco|five)(?:\s+(?:y|e|and|,)\s+|\s*,\s*)(?:${NWORD}|una?|uno|one|seis|six|cinco|five)(?:(?:\s+(?:y|e|and)\s+|\s*,\s*)(?:${NWORD}|una?|uno|one))?|(?:la\s+)?mitad\s+y\s+(?:la\s+)?mitad|half\s+and\s+half)\s*[.!?]*\s*$`, "iu");
const SIDE_ITEM = /\b(salsas?|crema|sour\s*cream|lim[oó]n(?:es)?|limes?|cebollas?|cilantro|chiles?|jalape[nñ]os?|rabanos?|r[aá]banos?|aderezo|dressing|sauce|queso|cheese|guacamole|pico)\b[^.,;]{0,24}\b(aparte|por\s+separado|separad[oa]s?|on\s+the\s+side|separate(?:ly)?)\b/iu;
const SIDE_ITEM2 = /\b(aparte|por\s+separado|separad[oa]s?|on\s+the\s+side|separate(?:ly)?)\b[^.,;]{0,12}\b(?:la|el|las|los|the)?\s*(salsas?|crema|sour\s*cream|lim[oó]n(?:es)?|limes?|cebollas?|cilantro|aderezo|dressing|sauce|guacamole)\b/iu;
export function detectContainerSplit(text: string, opts: { afterSplit?: boolean } = {}): ContainerSplit | null {
  const t = String(text || "");
  if (!t.trim()) return null;
  if (SIDE_ITEM.test(t) || SIDE_ITEM2.test(t)) return null;
  // fix24: "una y una" / "tres y tres" is only a split when a split request came first (else it answers a question).
  if (SPLIT_SHARES.test(t)) {
    if (!opts.afterSplit) return null;
    const n = (t.match(/\b(?:y|e|and)\b|,/giu) || []).length + 1;
    return { parts: Math.max(2, Math.min(4, n)), phrase: t.trim(), rest: "" };
  }
  for (const re of SPLIT_PATTERNS) {
    const m = t.match(re);
    if (!m) continue;
    // "y aparte una horchata": aparte = also, followed by a dish → not a container split.
    if (/^aparte\b/i.test(m[0].trim()) && FOOD.test(t.slice((m.index || 0) + m[0].length))) continue;
    const n = (m.slice(1).find((g) => g && SPLIT_N[g.toLowerCase()] != null) || "").toLowerCase();
    const rest = (t.slice(0, m.index || 0) + " " + t.slice((m.index || 0) + m[0].length)).replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/[,\s]+$/u, "").trim();
    return { parts: SPLIT_N[n] || 2, phrase: m[0].trim(), rest };
  }
  return null;
}

/** Staff-style removal notes ("no crema"); twilio.ts uses the same list for the kitchen ticket. */
export const REMOVAL_NOTES: Array<{ re: RegExp; note: string }> = [
  { re: /lechuga|lettuce/i, note: "no lechuga" },
  { re: /crema|sour\s*cream/i, note: "no crema" },
  { re: /cebolla|onion/i, note: "no cebolla" },
  { re: /cilantro/i, note: "no cilantro" },
  { re: /pico/i, note: "no pico" },
  { re: /queso\s*fresco|fresco\s*cheese/i, note: "no queso fresco" },
  { re: /frijoles?|beans/i, note: "no frijoles" },
  { re: /arroz|rice/i, note: "no arroz" },
];
export function removalNotesIn(text: string): string[] {
  const out: string[] = [];
  for (const { re, note } of REMOVAL_NOTES) {
    const hit = new RegExp(String.raw`\b(?:no|sin|without|hold(?:\s+the)?)\s+(?:(?:el|la|los|las|the|de)\s+)?(?:${re.source})\b`, "i").test(String(text || ""));
    if (hit && !out.includes(note)) out.push(note);
  }
  return out;
}
const lineHasDeluxe = (l: any) => (l?.modifiers || []).some((m: any) => /\bDELUXE\b/i.test(String(m?.option || "")) && !/^\s*regular\b/i.test(String(m?.option || "")));

// fix1036 (real call 2026-10-20 10:36): words that never order anything on their own.
const FILLER = /(?<![\p{L}\p{N}])(?:s[ií]|no|oh|ah|okay|ok|okey|bueno|pues|este|creo\s+que|yo\s+creo|est[aá]\s+bien|as[ií]\s+est[aá]\s+bien|eso|ser[ií]a|todo|nada\s+m[aá]s|gracias|claro|perfecto|listo|ya|mhm|aj[aá]|that'?s|it|fine|yes|yeah|good|all)(?![\p{L}\p{N}])/giu;
const DRINK = /\b(?:coca(?:\s+cola)?|coke|pepsi|sprite|fanta|jarritos?|horchata|jamaica|tamarindo|agua|soda|refresco|diet)\b/iu;
const ORDER_QTY = new RegExp(`\\b(?:${QTY.slice(3, -1)})\\b`, "iu");
const TOKENS = /__(?:DELIVERY|PICKUP|FOR_HERE)__/g;
/** What's left of a caller turn after filler and the words of the item just added ("Sí, coca, sí. No, creo que" → ""). */
export function orderResidue(text: string, lastItemId?: string | null) {
  let t = applySharedAliases(String(text || ""), "phone").replace(TOKENS, " ").toLowerCase();
  const itemWords = String(lastItemId || "").toLowerCase().replace(/^sq-/, "").replace(/-[a-z0-9]{6}$/i, "").split(/[^a-zñ]+/).filter((w) => w.length > 2 && w !== "drink");
  t = t.replace(FILLER, " ");
  for (const w of itemWords) t = t.replace(new RegExp(`\\b${w}s?\\b`, "giu"), " ");
  return t.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
/** fix1136: Elvi asked "¿de qué carne?" about "cuatro quesadillas de comal"; the caller answers "dos de chorizo y dos de
 *  bistec" (or just "de chicharrón prensado"). Rebuild full dish phrases so each part keeps the dish + tortilla. */
const MEAT_WORDS = /\b(?:bistec|steak|asada|pastor|chorizo|pollo|chicken|carnitas|cabeza|buche|tripa|prensado|duro|chicharr[oó]n|lengua|suadero|campechana|frijoles?|beans|queso|cheese)\b/iu;
/** case1c: a dish named with no meat/choices ("Me pone gordita", "una quesadilla"). */
export function isBareDish(piece: string): boolean {
  const p = cleanPhrase(piece);
  return FOOD.test(p) && !MEAT_WORDS.test(p) && p.split(/\s+/).length <= 5;
}
export const dishNoun = (d: string) => String((cleanPhrase(d).match(FOOD) || [""])[0]).toLowerCase().replace(/s$/, "");
const dishPhrase = (d: string) => { const n = dishNoun(d); return /^(quesadilla|gordita|torta|enchilada|tostada|flauta|charola|agua|soda|horchata|jamaica)$/.test(n) ? `una ${n}` : `un ${n}`; };
/** case1c: "de bistec, me le pone queso" / "el de bistec con frijoles las dos" → "de bistec, con queso"; null if no choice. */
export function meatFragment(text: string): string | null {
  const a = cleanPhrase(text);
  if (FOOD.test(a) || !MEAT_WORDS.test(a)) return null;
  const m = a.match(/\bde\s+(?:bistec|steak|asada|pastor|chorizo|pollo|carnitas|cabeza|buche|tripa|prensado|duro|chicharr[oó]n|lengua|suadero|campechana)\b.*$/iu);
  if (!m) return null;
  return m[0].replace(/\b(?:me\s+)?(?:le\s+)?(?:pone|pones|ponga)\b/giu, "con").replace(/\b(?:l[ao]s\s+dos|ambos|ambas|both)\b/giu, "").replace(/[¿?]+.*$/u, "").replace(/\bcon\s+con\b/giu, "con").replace(/\s{2,}/g, " ").replace(/[,.\s]+$/u, "").trim();
}
export function expandMeatAnswer(pendingDish: string, answer: string): string[] | null {
  const a = cleanPhrase(answer).replace(/[.?!,;\s]+$/u, "").trim();
  if (!a || FOOD.test(a)) return null;
  const qtyRe = new RegExp(`^(${QTY})\\s+(?=de\\s)`, "iu");
  const parts = a.split(new RegExp(`\\s*(?:,|\\by\\b|\\band\\b)\\s*(?=(?:${QTY}\\s+)?de\\s)`, "iu")).map((x) => x.trim()).filter(Boolean);
  if (!parts.length || !parts.every((x) => new RegExp(`^(?:${QTY}\\s+)?de\\s+[\\p{L}][\\p{L}\\s]{1,40}$`, "iu").test(x))) return null;
  pendingDish = cleanPhrase(pendingDish).replace(/^(?:y\s+)?(?:me\s+)?(?:pone|pones|ponga|das|da|dame|manda|traes?)\s+/iu, "").trim();
  const dishQty = (pendingDish.match(new RegExp(`^(${QTY})\\s+`, "iu")) || [])[1] || "";
  const dish = pendingDish.replace(new RegExp(`^${QTY}\\s+`, "iu"), "").replace(/[,.\s]+$/u, "").trim();
  return parts.map((x) => { const q = (x.match(qtyRe) || [])[1]; return `${q || dishQty} ${dish} ${x.replace(qtyRe, "")}`.trim(); });
}
const ORDER_INTENT = /^[¿¡\s]*(?:(?:s[ií]|oh|hola|bueno)[,.\s]+)*(?:(?:buenos\s+d[ií]as|buenas\s+(?:tardes|noches))[,.\s]+)?(?:(?:se\s+)?(?:puedo|podr[ií]a|puede|quiero|quisiera|me\s+gustar[ií]a)\s+(?:hacer|poner|dejar|ordenar|pedir)(?:\s+(?:una?|mi)\s+(?:orden|pedido))?|can\s+i\s+(?:place|make|put\s+in)\s+an?\s+order|i(?:'d|\s+would)\s+like\s+to\s+(?:place\s+an\s+)?order)\b[?.!,\s]*/iu;
const ORDER_QTY_DISH = /\p{L}{3,}/u;
export const STAFF_VOICE = /^[¿¡\s]*(?:¿\s*)?(?:cu[aá]nt[oa]s?\s+\p{L}+\s+(?:quer[ií]a|quiere|quieres|va\s+a\s+querer)|qu[eé]\s+m[aá]s|qu[eé]\s+le\s+(?:vamos\s+a\s+)?(?:pongo|ponemos|damos)|de\s+qu[eé]\s+(?:las?|los?)\s+quiere|algo\s+m[aá]s)\b[^.!]*\?/iu;
export const isCountOnly = (text: string) => !FOOD.test(text) && !orderResidue(text, null).replace(new RegExp(`(?<![\\p{L}])(?:${QTY.slice(3, -1)}|y|and)(?![\\p{L}])`, "giu"), "").trim();
const COUNT: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export const spokenCount = (phrase: string) => { const w = String(phrase || "").trim().split(/\s+/)[0]?.toLowerCase() || ""; return /^\d+$/.test(w) ? Number(w) : COUNT[w] || 0; };
export const EXTRAS_ID = "sq-extras-mild-salsa-asada-2oz-T6PGNT"; // Extras item; variation picked by option
export const COMAL_OPTION: Record<string, string> = { quesadilla: "(QCO) Quesadilla de Comal / Homemade" };

type Line = { itemId: string; quantity: number; modifiers?: any[]; readback?: string; elviNotes?: string[]; posSize?: "small" };
/** sopesize1: caller said small ("chico(s)" after shared aliases: chiquito, pequeño, small) for a sopesaso. */
export const SMALL_SOPE = /\b(?:chic[oa]s?)\b/iu;
export type ShadowTurn = (text: string, language: "es" | "en", history: Array<{ role: "customer" | "assistant"; text: string }>) => Promise<any>;

/** Replay caller turns through Elvi; apply her actions to a shadow cart. */
/** sopesaso1: newer choices replace older ones in the same single-choice step; multi-pick steps add up. */
export function mergeMods(old: any[], add: any[]): any[] {
  let out = [...old];
  const VAR = /^\s*\([A-Z]{1,4}\)/; // case1: "(GD) Gordita" vs "(QGD) Queso Gordita" — one variation per line, newest wins
  if (add.some((m) => VAR.test(String(m.option)))) out = out.filter((o) => !VAR.test(String(o.option)));
  for (const m of add) if (!out.some((o) => String(o.option) === String(m.option))) out.push(m);
  return out;
}
/** cleanup1: an info-only call — the caller only asks questions (ingredients, dietary, hours, prices) and never asks to
 *  order. No shadow order for those ("are your beans vegetarian?" must not become a burrito). */
const ASKS_TO_ORDER = /\b(?:i(?:'d| would)?\s+(?:like|want|wanna|need|get|take|have)|can\s+i\s+(?:get|have|order)|let\s+me\s+(?:get|have)|give\s+me|(?:to\s+)?(?:place|make)\s+an?\s+order|order|para\s+(?:hacer|ordenar|llevar)|(?:me\s+)?(?:da|das|dé|puede|podría|pone|pones|regala)s?\s+(?:un|una|dos|tres|cuatro|\d)|quiero|quisiera|me\s+gustar[ií]a|ordenar|pedido|pedir|dame|deme|mándame|for\s+(?:pickup|delivery)|to\s+go)\b/iu;
const INFO_Q = /\b(?:vegetarian[oa]?s?|vegan[oa]?s?|meat|carne|pork|puerco|manteca|lard|fat|gluten|dairy|l[aá]cteos?|allerg\w*|alergi\w*|ingredients?|ingredientes?|lleva[ns]?|contains?|spicy|picante|hours?|horario|open|abiertos?|cierran|close|price|precio|cu[aá]nto\s+cuesta|how\s+much)\b/iu;
export function isQuestionOnlyCall(turns: Array<{ speaker: string; text: string }>): boolean {
  const caller = turns.filter((t) => t.speaker === "caller").map((t) => t.text);
  if (!caller.length) return false;
  const all = caller.join(" ");
  return !caller.some((t) => ASKS_TO_ORDER.test(t)) && INFO_Q.test(all) && /\?|^\s*(?:are|is|do|does|can|what|which|how|tienen|es|son|lleva|hay)\b/imu.test(all);
}
// tw4938: which dish kinds a phrase names, and which kind a menu item is (by its id).
const DISH_KINDS: Array<[string, RegExp]> = [["taco", /\btacos?\b/iu], ["quesadilla", /\bquesadillas?\b|\bqd\b/iu], ["gordita", /\bgorditas?\b/iu], ["torta", /\btortas?\b/iu], ["burrito", /\bburritos?\b/iu],
  ["sope", /\bsopes?\b|\bsopes[ae]sos?\b/iu], ["huarache", /\b[gh]uaraches?\b/iu], ["nacho", /\bnachos?\b/iu], ["esquite", /\besquites?\b/iu], ["tostada", /\btostadas?\b/iu], ["enchilada", /\benchiladas?\b/iu], ["tamal", /\btamal(?:es)?\b/iu]];
export const dishesNamed = (text: string) => new Set(DISH_KINDS.filter(([, re]) => re.test(String(text || ""))).map(([k]) => k));
export const kindOfItem = (itemId: string) => { const id = String(itemId || "").toLowerCase(); const hit = DISH_KINDS.find(([k]) => id.includes(k)); return hit ? hit[0] : null; };
const MEAT_LIST = "bistec|asada|pastor|chorizo|pollo|carnitas|cabeza|buche|tripa|prensado|duro|lengua|suadero|deshebrada|picadillo|nopales|vegetal|campechana";
const lineHasMeat = (l: { modifiers?: any[] }, meat: string) => (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option)));
const tortillaWordOf = (l: { modifiers?: any[] }) => { const o = (l.modifiers || []).map((m: any) => String(m.option)).join(" "); return /taquer|street/i.test(o) ? " taquero" : /harina|flour/i.test(o) ? " de harina" : /comal|homemade/i.test(o) ? " de comal" : ""; };
/** tw4938: meats the caller listed for the dish being ordered ("uno de bistec … y tripa", "otra tripa") — each one is a line. */
export function listedMeats(text: string): Array<{ meat: string; another: boolean }> {
  const t = cleanPhrase(text), out: Array<{ meat: string; another: boolean }> = [];
  const re = new RegExp(String.raw`\b(?:(un[oa]|otr[oa]|y)\s+(?:de\s+|m[aá]s\s+de\s+)?(?:al\s+)?)(${MEAT_LIST})\b`, "giu");
  for (const m of t.matchAll(re)) { const before = t.slice(Math.max(0, (m.index || 0) - 5), m.index); if (/\b(sin|no)\s*$/i.test(before)) continue; if (/^y$/i.test(m[1]) && new RegExp(String.raw`\bde\s+(?:${MEAT_LIST})\s*$`, "iu").test(t.slice(0, m.index))) continue; /* "de bistec y chorizo" = one mixed item */ out.push({ meat: m[2].toLowerCase(), another: /^otr/i.test(m[1]) }); }
  return out;
}
/** tw4938: "serían (esos) tres [tacos]" — the caller's running total for a dish. */
export function statedTotal(text: string): { n: number; kind: string | null } | null {
  const m = [...cleanPhrase(text).matchAll(/\b(?:ser[ií]an|son)\s+(?:esos\s+|estos\s+|los\s+)?(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b(?:\s+(\w+))?/giu)].pop();
  if (!m) return null; const n = spokenCount(m[1]); if (!n) return null;
  const k = m[2] ? [...dishesNamed(m[2])][0] || null : null; return { n, kind: k };
}

/** multi1: whose order a caller turn is about — "para Juana…", "en la de ella", "la orden de Ana" → that person; "en mi orden",
 *  "la mía", "la primera" → the caller ("me"). null = no switch (keep the current person). */
export function personSwitch(text: string): string | null {
  const t = String(text || "");
  if (/\b(?:en\s+)?mi\s+orden\b|\b(?:en\s+)?la\s+m[ií]a\b|\ben\s+la\s+primera\b|\bpara\s+m[ií]\b|\bmy\s+order\b/iu.test(t)) return "me";
  // plate1: "en otro plato", "por separado", "la otra orden", "en un plato aparte" → the next plate (plain "aparte" = "also", not a plate)
  if (/\b(?:en\s+)?otro\s+plato\b|(?<!\p{L})(?:platos|[oó]rdenes|pedidos|bolsas)\s+(?:por\s+)?separad|\b(?:p[oó]ngalo|ponlo|p[oó]ngamel[oa]s?|ponga|va|van)\s+(?:por\s+)?separad|\b(?:la\s+)?otra\s+orden\b|\b(?:plato|orden)\s+aparte\b|\bseparate\s+(?:plates?|orders?|bags?)\b|\banother\s+(?:plate|order)\b/iu.test(t)) return "+";
  const m = /\b(?:para|for)\s+(\p{Lu}\p{Ll}{2,})\b/u.exec(t) || /\b(?:en\s+)?(?:la|el)\s+(?:orden\s+)?de\s+(\p{Lu}\p{Ll}{2,}|ella|[ée]l)\b/u.exec(t);
  if (m && !/^(Usted|Llevar|Aqu[ií]|Comer|Ahorita|Mañana|Hoy)$/u.test(m[1])) return m[1].toLowerCase() === "él" || m[1].toLowerCase() === "el" ? "él" : m[1];
  return null;
}

/** staffpick1: which of Elvi's offered options did staff state (not ask)? Exactly one match or null.
 *  "normal(es)/sencilla" = REGULAR, "preparada" = DELUXE, "street" = Taquero, "flour" = Harina, "homemade/hecha a mano" = Comal. */
export function staffPick(opts: string[], staffSaid: string): string | null {
  const f = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const said = f(staffSaid).replace(/\bnormal(?:es)?\b|\bsencill[ao]s?\b/g, " regular ").replace(/\bpreparad[ao]s?\b/g, " deluxe ")
    .replace(/\bstreet\b/g, " taquero ").replace(/\bflour\b/g, " harina ").replace(/\bhomemade\b|\bhecha a mano\b/g, " comal ");
  if (!said.trim() || opts.length < 2) return null;
  const GENERIC = new Set(["taco", "tacos", "quesadilla", "qd", "dorada", "con", "de", "la", "el", "y", "x", "or", "o", "solo", "and"]);
  const keys = opts.map((o) => f(o).replace(/\([^)]*\)/g, " ").split(/[^a-z]+/).filter((w) => w.length > 2 && !GENERIC.has(w)));
  const stem = (w: string) => w.replace(/(?:es|s|a|o)$/, "");
  const hit = opts.filter((_, i) => keys[i].length && keys[i].some((w) => new RegExp(`\\b${stem(w)}(?:[aoe]s?|s)?\\b`).test(said)));
  return hit.length === 1 ? hit[0] : null;
}
export async function shadowOrderFromTurns(turns: CallTurn[], run: ShadowTurn) {
  if (isQuestionOnlyCall(turns)) turns = turns.filter((t) => t.speaker !== "caller"); // cleanup1: no order on an info-only call
  const cart: Line[] = [];
  const history: Array<{ role: "customer" | "assistant"; text: string }> = [];
  const steps: any[] = [];
  let lastTouched: Line | null = null;
  const touchedNow: Line[] = [];
  let person: string | null = null, plateN = 0; // multi1: per-person groups inside the one cart
  let sizeAnswer = false;
  const apply = (actions: any[] = []) => {
    for (let a of actions) {
      // size1: a bare size answer ("A regular.") to "¿regular o grande?" resizes the dish just rung, it isn't a 2nd one (Paco).
      if (a.type === "add_item" && sizeAnswer && cart.length && cart[cart.length - 1].itemId === a.itemId) { const p0 = cart.pop()!; a = { ...a, quantity: p0.quantity || a.quantity }; }
      if (a.type === "add_item") { const l: Line = { itemId: a.itemId, quantity: a.quantity, modifiers: a.modifiers, readback: a.readback, ...(person ? { person } : {}) } as Line; cart.push(l); lastTouched = l; touchedNow.push(l); }
      else if (a.type === "update_item") {
        const i = cart.map((l) => l.itemId).lastIndexOf(a.itemId);
        if (i >= 0) { cart[i] = { ...cart[i], quantity: a.quantity ?? cart[i].quantity, ...(a.modifiers ? { modifiers: a.modifiers } : {}) }; lastTouched = cart[i]; touchedNow.push(cart[i]); }
      } else if (a.type === "remove_item") {
        const i = cart.map((l) => l.itemId).lastIndexOf(a.itemId);
        if (i >= 0) cart.splice(i, 1);
      }
    }
  };
  // fix24: a removal ("no crema") belongs to the dish it was said with, else to the last dish touched. Two Deluxe
  // dishes and no way to tell which → ambiguous (the ticket flags it for staff instead of guessing).
  const ambiguousRemovals: string[] = [];
  const attributeRemovals = (text: string, wasLast: Line | null) => {
    const notes = removalNotesIn(text);
    if (!notes.length) return;
    // Said with a dish ("un sopesazo deluxe sin crema") → that dish. A bare "sin crema" later → see below.
    const fresh = FOOD.test(text) ? [...new Set(touchedNow)].filter((l) => cart.includes(l)) : [];
    let targets: Line[] = fresh;
    if (targets.length > 1) {
      const deluxe = targets.filter(lineHasDeluxe);
      targets = deluxe.length === 1 ? deluxe : deluxe.length > 1 ? [] : targets;
      if (!targets.length) { for (const n of notes) if (!ambiguousRemovals.includes(n)) ambiguousRemovals.push(n); return; }
    }
    if (!targets.length) {
      if (cart.filter(lineHasDeluxe).length > 1) { for (const n of notes) if (!ambiguousRemovals.includes(n)) ambiguousRemovals.push(n); return; }
      const only = cart.filter(lineHasDeluxe);
      targets = only.length === 1 ? only : wasLast && cart.includes(wasLast) ? [wasLast] : cart.length ? [cart[cart.length - 1]] : [];
    }
    for (const l of targets) l.elviNotes = [...new Set([...(l.elviNotes || []), ...notes])];
  };
  const say = async (text: string, language: "es" | "en", source: string) => {
    // multi2: "dos tacos de qué? Deshebrada. Deshebrada. Deshebrada." — the caller echoing staff's question + repeated word
    if (source.startsWith("caller")) text = text.replace(/\b(de\s+)?qu[eé]\?\s*/giu, " ").replace(/\b(\p{L}+)(?:[.,]?\s+\1\b)+/giu, "$1").replace(/\s+/g, " ").trim() || text;
    if (source === "caller" || source === "caller-retry") { const p = personSwitch(text); if (p === "+") person = `plato ${++plateN + 1}`; else if (p) person = p; }
    const r = await run(text, language, history.slice(-24));
    sizeAnswer = /^\W*(?:a\s+|el\s+|un\s+|lo\s+)?(?:regular|grande|chico|mediano|small|medium|large)\W*$/iu.test(text);
    // larry1: "eight of your steak quesadillas" → Elvi asks the tortilla → "flour": the answer keeps the count of the turn that asked.
    { const pa = history[history.length - 1]?.text || "", pc = history[history.length - 2]?.text || "";
      const NUM: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
      const NRE = /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i;
      const mq = /\?\s*$/.test(pa) && !/algo más|anything else/i.test(pa) ? pc.match(NRE) : null;
      const noun = mq ? dishNoun(pc) : "";
      if (mq && noun && !NRE.test(text)) { const n = NUM[mq[1].toLowerCase()] ?? Number(mq[1]);
        if (n >= 2 && n <= 30) for (const a of (r?.actions || []) as any[]) if (a.type === "add_item" && (Number(a.quantity) || 1) === 1 && String(a.itemId).toLowerCase().includes(String(noun).toLowerCase().replace(/s$/, ""))) a.quantity = n; } }
    // suggest1: listen-only — staff, not Elvi, answer the caller, so Elvi's offer never becomes answerable here.
    const said = String(r?.reply || ""), offer = String(r?.offerText || "");
    history.push({ role: "customer", text }, { role: "assistant", text: offer && said.endsWith(offer) ? said.slice(0, -offer.length).trim() : said });
    const wasLast = lastTouched;
    touchedNow.length = 0;
    // fix1036: Elvi re-adding dishes from history on a turn that names no dish, drink or quantity and answers no
    // open question is a duplicate, not a new item.
    const prevReply = history.length >= 4 ? history[history.length - 3].text : "";
    const answering = /\?\s*$/.test(prevReply) && !/algo más|anything else/i.test(prevReply);
    const prevCaller = history.length >= 4 ? history[history.length - 4].text : "";
    // alex1: "Y en otro no me le puede poner este," + "en vez de huevos bistec" — the previous half-sentence asked for ANOTHER one
    const names0 = FOOD.test(text) || DRINK.test(text) || ORDER_QTY.test(text) || (/\b(otr[oa]s?|another|one more)\b/i.test(prevCaller) && /[,]\s*$/.test(prevCaller.trim()) && !FOOD.test(prevCaller));
    // case1: "…la otra" / "las de bistec" points at a dish already rung — choices for it, not a new one
    const definite = /\b(la|el|las|los)\s+otr[oa]s?\b|\b(?:o\s+)?las,?\s+de\b/i.test(text) && !/\b(\d+|dos|tres|cuatro|una m[aá]s|otra m[aá]s)\b/i.test(text) && !FOOD.test(text);
    const names = names0 && !definite;
    // sopesaso1: …but if the re-add carries new choices ("bistec con chicharrón del duro", "con todo") it updates that dish.
    // alex1: "sí, unos normales y otros con bistec, sí" confirms lines already rung — re-adds of an identical line are dropped
    // burrito2: same for the scorer's own "así está bien" auto-accept turn (it never orders anything new)
    const confirming = /^\s*(s[ií]|aj[aá]|ok|okay|yes|yeah|yep|yup|sure|go ahead|all right|alright|that'?s fine|fine)(?=[\s,.!]|$)/i.test(text) && !/\b(\d+|dos|tres|cuatro|cinco|seis|m[aá]s|more|tambi[eé]n|also)\b/i.test(text);
    const sig = (x: any) => `${x.itemId}|${(x.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => !/salsa asada/i.test(o)).sort().join(",")}`;
    const acts = (r?.actions || []).filter((a: any) => a.type !== "checkout").filter((a: any) => !(a.type === "add_item" && (((confirming || source === "auto") && (cart.some((l) => sig(l) === sig(a)) || (/\bunos\b.*\botros\b/i.test(text) && cart.some((l) => l.itemId === a.itemId)))) || (/^\s*(dos|2|two) huevos\W*$/i.test(text) && cart.some((l) => /huevo/i.test(String(l.itemId)))))))
      .map((a: any) => (a.type === "add_item" && /en vez de (los )?huevos|instead of (the )?eggs/i.test(text) ? { ...a, modifiers: (a.modifiers || []).filter((m: any) => !/extra huevo/i.test(String(m.option))) } : a)).flatMap((a: any) => {
      // case1c: staff "¿La gordita también quieres que lleve frijoles?" → "Sí. Una gordita con queso, de frijoles" is about
      // the gordita already rung (definite article + yes), not a new one
      const aboutExisting = /^\s*(s[ií]|yes)(?=[\s,.!]|$)/i.test(text) && new RegExp(`\\b(?:la|el)\\s+${dishNoun(text) || "\\0"}s?\\b[^?]*\\?`, "i").test(lastStaff) && !/\b(dos|tres|\d+|otr[oa]s?|m[aá]s)\b/i.test(text);
      if (!(a.type === "add_item" && source === "caller" && (!names || aboutExisting) && !answering && cart.some((l) => l.itemId === a.itemId))) return [a];
      // tw4938: a re-sent line of a dish other than the one being talked about ("Preparada con todo" about the quesadilla
      // just rung re-sent the tacos) changes nothing — merging it put bistec + al pastor + Deluxe on the tripa taco.
      const ka = kindOfItem(a.itemId), kl = lastAdded ? kindOfItem((lastAdded as Line).itemId) : null;
      if (ka && kl && ka !== kl && !dishesNamed(text).has(ka)) return [];
      const prevLine = cart[cart.map((l) => l.itemId).lastIndexOf(a.itemId)];
      const have = new Set((prevLine.modifiers || []).map((m: any) => String(m.option)));
      // tw4938: never stack a second meat on a line through a merge unless this turn names that meat
      const meatRe = new RegExp(MEAT_LIST, "i"), prevMeat = [...have].some((o) => meatRe.test(o));
      const fresh = (a.modifiers || []).filter((m: any) => !have.has(String(m.option)) && !(prevMeat && meatRe.test(String(m.option)) && !new RegExp((String(m.option).match(meatRe) || ["\\0"])[0], "i").test(text)));
      return fresh.length ? [{ type: "update_item", itemId: a.itemId, modifiers: mergeMods(prevLine.modifiers || [], fresh) }] : [];
    });
    carryAskedQty(acts, text, history.length >= 4 ? history[history.length - 4].text : "", answering);
    // qty1: "dos de bistec" right after 2 bistec were rung (no dish noun, no más/otros) restates that line — not 2 more
    for (let i = acts.length - 1; i >= 0; i--) if (isRestatement(text, acts[i], cart, sig)) acts.splice(i, 1);
    // tw4938: a turn that names a dish re-sends earlier lines of a dish it never names ("serían esos tres y una quesadilla
    // preparada" → the 3 tacos came back with Deluxe) — those lines are already rung, not new.
    const named = dishesNamed(text);
    // reg1: "A uno agrégamele bistec" — the "-le" verb adds to a dish already rung; a brand-new dish the caller never named
    // (Elvi rang a Huarache) is not an order.
    if (source !== "auto" && cart.length && /\b(?:agr[eé]g|p[oó]n|[eé]ch|p[oó]ng)\p{L}*l[eo]s?\b/iu.test(text)) {
      const tn = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      for (let i = acts.length - 1; i >= 0; i--) { const a = acts[i]; if (a.type !== "add_item") continue;
        const w = String(a.itemId || "").toLowerCase().replace(/^sq-/, "").split("-").filter((x: string) => x.length > 3 && !/^(elvis|drink|regular)$/.test(x));
        if (w.length && !w.some((x: string) => tn.includes(x.slice(0, 5))) && !cart.some((l) => l.itemId === a.itemId)) acts.splice(i, 1); } }
    // tw4938: "Eh. Y" (no dish, meat or choice word) changed nothing — Elvi's update moved a bistec onto the tripa taco.
    if (source === "caller" && !FOOD.test(text) && !MEAT_WORDS.test(text) && !/\b(con|sin|deluxe|todo|preparad\w*|extra|aparte|harina|comal|ma[ií]z|taquer\w*|grande|chico|regular|doble|double|with|without|no)\b/iu.test(text))
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "update_item") acts.splice(i, 1);
    // …and a turn naming no dish ("Preparada con todo") is about the dish just rung: re-sent lines of another dish are dropped.
    { const pk = [...dishesNamed(prevCaller)]; const kl = pk.length === 1 ? pk[0] : lastAdded ? kindOfItem((lastAdded as Line).itemId) : null;
      if (source !== "auto" && !named.size && kl) for (let i = acts.length - 1; i >= 0; i--) { const a = acts[i]; const k = a.type === "add_item" || a.type === "update_item" ? kindOfItem(a.itemId) : null; if (k && k !== kl && cart.some((l) => l.itemId === a.itemId)) acts.splice(i, 1); } }
    let droppedReadds = 0;
    if (source !== "auto" && named.size) for (let i = acts.length - 1; i >= 0; i--) { const a = acts[i]; const k = a.type === "add_item" ? kindOfItem(a.itemId) : null; if (k && !named.has(k) && cart.some((l) => l.itemId === a.itemId)) { acts.splice(i, 1); droppedReadds++; } }
    // …and if that was all Elvi sent, the dish this turn names was lost: ask once more with this turn alone (no history to re-send).
    if (droppedReadds && source === "caller" && !acts.some((a: any) => a.type === "add_item" && named.has(kindOfItem(a.itemId) || ""))) {
      const r2: any = await run(text, language, []);
      for (const a of r2?.actions || []) if (a.type === "add_item" && named.has(kindOfItem(a.itemId) || "")) acts.push(a);
    }
    // tw4938: "dos quesadillas doradas … preparadas" → one line came back at qty 1; the spoken count is the quantity.
    { const n = spokenCount(cleanPhrase(text).replace(/^\s*(?:y|e|and|me\s+das|dame|quiero)\s+/iu, "")); const adds = acts.filter((a: any) => a.type === "add_item");
      if (n > 1 && adds.length === 1 && (Number(adds[0].quantity) || 1) === 1 && named.size === 1 && named.has(kindOfItem(adds[0].itemId) || "")) adds[0].quantity = n; }
    apply(acts);
    // sopesize1: default size is the 10”; only an explicit "chico(s)" on this turn picks the small POS sizes.
    if (SMALL_SOPE.test(applySharedAliases(text, "phone"))) for (const l of touchedNow) if (/sopes[ae]so/i.test(l.itemId)) l.posSize = "small";
    const added = acts.filter((a: any) => a.type === "add_item");
    if (added.length) lastAdded = cart[cart.length - 1] || null;
    if (source !== "auto") attributeRemovals(text, wasLast);
    steps.push({ source, heard: text, language, reply: r?.reply, actions: (r?.actions || []).map((a: any) => a.type) });
    if (source === "caller") {
      // tw4938: every meat the caller listed for this dish is a line; Elvi dropped "… y tripa" / "otra tripa". Ring the missing
      // ones as their own short phrase (same dish + tortilla as the line they go with).
      const mine = [...new Set(touchedNow)].filter((l) => cart.includes(l));
      const kinds = new Set(mine.map((l) => kindOfItem(l.itemId)).filter(Boolean));
      const nk = dishesNamed(text);
      const refFor = () => mine.length && kinds.size === 1 ? mine[mine.length - 1] : (!mine.length ? [...cart].reverse().find((l) => { const k = kindOfItem(l.itemId); return k && (!nk.size || nk.has(k)) && (l.modifiers || []).some((m: any) => new RegExp(MEAT_LIST, "i").test(String(m.option))); }) : null);
      const want = listedMeats(text), have = new Map<string, number>();
      for (const l of mine) for (const w of want) if (lineHasMeat(l, w.meat)) have.set(w.meat, (have.get(w.meat) || 0) + (Number(l.quantity) || 1));
      for (const w of want) {
        if ((have.get(w.meat) || 0) > 0) { have.set(w.meat, have.get(w.meat)! - 1); continue; }
        const ref = refFor(); if (!ref || (!w.another && !mine.length)) continue;
        const k = kindOfItem(ref.itemId)!;
        await say(`${dishPhrase(k)}${tortillaWordOf(ref)} de ${w.meat}`, language, "caller-meat-listed");
      }
      // tw4938: "serían esos tres" — the caller's total for the dish; drop later exact repeats beyond it (a meat said twice).
      const st = statedTotal(text); const kind = st?.kind || (kinds.size === 1 ? [...kinds][0] : null);
      if (st && kind) {
        const of = () => cart.filter((l) => kindOfItem(l.itemId) === kind);
        let count = of().reduce((a, l) => a + (Number(l.quantity) || 1), 0);
        for (let i = cart.length - 1; i >= 0 && count > st.n; i--) { const l = cart[i]; if (kindOfItem(l.itemId) !== kind || (Number(l.quantity) || 1) !== 1) continue; if (cart.slice(0, i).some((x) => sig(x) === sig(l))) { cart.splice(i, 1); count--; } }
      }
    }
    return r;
  };
  let last: any = null;
  let autoAccepted = false;
  const containers: ContainerPlan = { breaks: [], splits: [], phrases: [] };
  let staffAskedSplit: ContainerSplit | null = null; // staff: "¿en diferentes recipientes?" → caller: "sí"
  // fix1036: fulfillment heard anywhere (caller or staff read-back "delivery, tus quesadillas…"); last mention wins.
  let fulfillment: "DELIVERY" | "PICKUP" | null = null;
  let staffAskedComal = false; // staff: "¿En el comal?" → caller: "Sí" = homemade corn tortilla on the last quesadilla
  let lastAdded: Line | null = null;
  let sideOffer = "", sideOfferAge = 9; // larry1: staff side offer stays answerable for 2 caller turns ("On the gordita?" "No," "Yes… two of those")
  let pendingDish: string | null = null; // fix1136
  let pendingDishes: string[] = []; let lastStaff = ""; const recentStaff: string[] = []; let staffSince: string[] = []; let lastTortilla = ""; const yesAdds: Array<{ line: Line; what: string }> = []; // case1c: several bare dishes waiting for their meat
  const noteFulfillment = (_text: string) => {};
  const lang0 = () => turns.filter((t) => t.speaker === "caller").pop()?.language || "es";
  const asking = (r: any) => !!r && /\?\s*$/.test(String(r.reply || "")) && !/algo más|anything else/i.test(String(r.reply || ""));
  // Phone staff fill in the details; accept Elvi's suggested choices for whatever is still open.
  const optsOf = (reply: string) => (String(reply || "").match(/(?:¿([^?¿]+)|([^?¿]+))\?\s*$/u)?.slice(1).find(Boolean) || "").replace(/^[^:]*:\s*/u, "").replace(/^\s*and\s+/iu, "").replace(/^\s*y\s+/iu, "").split(/\s*,\s*|\s+o\s+|\s+or\s+/u).map((x) => x.trim()).filter((x) => x && !/^(qu[eé]|what)\b/iu.test(x));
  const acceptOpen = async (lang: "es" | "en") => {
    for (let i = 0; i < 4 && asking(last); i++) {
      const prev = String(last.reply || ""), n0 = cart.length;
      last = await say(lang === "es" ? "así está bien" : "that's fine", lang, "auto");
      autoAccepted = true;
      // multi2: a required choice with no default ("Esquite: ¿Tajín o NO TAJIN?") was dropped on "así está bien" —
      // take the first option offered instead of losing the item
      if (cart.length === n0 && !asking(last) && !(last?.actions || []).length) { const o = optsOf(prev); if (o.length) { const item = (prev.match(/^([^:¿?]{3,60}):/u)?.[1] || "").trim(); last = await say(`${item ? item + ", " : ""}${o[0]}`, lang, "auto"); } break; }
      if (String(last.reply || "") === prev) break;
    }
  };
  // A caller's pauses mid-sentence ("¿Me puedes tomar dos … tacos de … bistec") split one request into fragments.
  // Join consecutive caller utterances until staff speaks, then split by item.
  // fix1136: staff speech bleeding into the caller channel ("¿Cuántas quesadillas quería, güero?") is staff, not an order.
  turns = turns.map((t) => t.speaker === "caller" && STAFF_VOICE.test(t.text) ? { ...t, speaker: "staff" as Speaker } : t);
  // larry1: "you got quesadilla today?" / "¿tienen birria hoy?" asks what's available; it isn't an order line (it opened a
  // quesadilla question that swallowed the Queso Birrias and the rest of the call).
  // …only when the caller names that dish again later ("do you have plate x today?" → "can I order some" still needs it).
  // avail4: "Sí, y me da, ¿tienen como arroz, como una side de arroz?" — a trailing ¿tienen/hay/manejan …? clause with no count is a
  // question; strip it, and drop the turn if only filler is left (the order comes on the next turn: "me da una side de arroz").
  turns = turns.flatMap((t) => { if (t.speaker !== "caller") return [t];
    const m = t.text.match(/^(.*?)[,\s]*¿\s*(?:tienen|hay|manejan|tiene|est[aá]\s+disponible)\b[^?¿]*\?\s*$/iu);
    if (!m || !m[1].trim() || /\b(\d+|dos|tres|cuatro|cinco)\b/iu.test(t.text.slice(m[1].length))) return [t];
    const rest = m[1].trim(); return dishesNamed(rest).size || /\b\d+\b/.test(rest) ? [{ ...t, text: rest }] : []; });
  // avail2: any availability question ("¿tienen arroz?", "do you have X?") is never an order line, whether or not the dish is named again.
  turns = turns.filter((t, i) => !(t.speaker === "caller" && !(() => { const nx = turns.slice(i + 1).find((u) => u.speaker === "caller"); return !!nx && !dishesNamed(nx.text).size && /\b(?:order|get|take|want|have)\s+(?:some|it|one|that|those|them)\b|\b(?:l[oa]s?)\s+quiero\b|\bquiero\s+(?:un[oa]?|dos|tres|es[oa]s?)\s*[.,!]*$|\bdame\s+(?:un[oa]?|dos|tres|es[oa]s?)\s*[.,!]*$/iu.test(nx.text); })() && !/\b(?:quiero|dame|deme|me\s+da|I'?ll\s+take|I'?ll\s+have|can\s+I\s+(?:get|have|order)|let\s+me\s+get|I\s+want|give\s+me|me\s+pones?)\b/iu.test(t.text) && /^\W*(?:(?:hey|so|and|oh|y|oye|ah|am|um|uh|s[ií]|bueno|disculpe|ok(?:ay)?)[,.\s]+){0,3}(?:(?:do\s+)?you(?:\s+guys)?(?:\s+still)?\s+(?:got|have)|you\s+got\s+ca-?\s+you\s+got|got\s+any|is\s+there|is\s+[^?.!]{0,40}\bavailable|est[aá]\s+disponible|tienen\s+disponible|tienen|hay|tiene|manejan)\b[^.!]*?(?:\btoday\b|\bhoy\b|\?)\W*$/iu.test(t.text) && !/\b(\d+|one|two|three|four|five|una?|dos|tres|cuatro|for pickup|para llevar|order|orden)\b/i.test(t.text)));
  const merged: CallTurn[] = [];
  for (const t of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker === "caller" && t.speaker === "caller" && !isClosing(t.text) && !/^[¿¡\s]*(no\b|mejor\b|actually\b|instead\b|perd[oó]n\b|wait\b|espera\b)/iu.test(t.text)) {
      prev.text = `${prev.text.replace(/[.?!¿¡]+$/u, "")} ${t.text.replace(/^[¿¡]/u, "")}`; prev.end = t.end;
    } else merged.push({ ...t });
  }
  turns = merged;
  const merged0 = turns;
  for (let t of turns) {
    if (t.speaker !== "caller") {
      steps.push({ source: "staff", heard: t.text }); staffAskedSplit = /\?|¿/.test(t.text) ? detectContainerSplit(t.text) : null;
      noteFulfillment(t.text);
      staffAskedComal = /\bcomal\b/iu.test(t.text) && /\?|¿/.test(t.text);
      lastStaff = t.text; recentStaff.push(t.text); if (recentStaff.length > 3) recentStaff.shift(); staffSince.push(t.text);
      continue;
    }
    // case1d: staff "¿La gordita también quieres que lleve frijoles?" → "Sí…": beans on that gordita (option name resolved at the end)
    { const ask = lastStaff.match(/\b(?:la|el)\s+(\p{L}+?)s?\b[^?]*\b(frijoles|beans|queso|cheese|cebolla|cilantro|crema|lechuga|arroz|rice)\b[^?]*\?/iu);
      if (ask && /^\s*(s[ií]|yes|aj[aá])(?=[\s,.!]|$)/iu.test(t.text)) { const noun = ask[1].toLowerCase(); const idx = cart.map((l) => String(l.itemId)).map((id, k) => (id.includes(noun) ? k : -1)).filter((k) => k >= 0).pop();
        if (idx != null && idx >= 0) yesAdds.push({ line: cart[idx], what: ask[2].toLowerCase() }); } }
    noteFulfillment(t.text);
    if (staffAskedComal) {
      staffAskedComal = false;
      if (/^[¿¡\s]*(s[ií]|yes|ok(?:ay)?|aj[aá]|eso|claro|correcto|exacto|comal)(?![\p{L}\p{N}])/iu.test(t.text) && !/\bno\b/iu.test(t.text)) {
        const q = [...cart].reverse().find((l) => /quesadilla/i.test(l.itemId));
        if (q) {
          const mods = q.modifiers || [];
          const i = mods.findIndex((m: any) => /tortilla/i.test(String(m?.step || "")));
          if (i >= 0 && !/comal/i.test(String(mods[i].option || ""))) { mods[i] = { ...mods[i], option: COMAL_OPTION.quesadilla }; q.modifiers = mods; }
          steps.push({ source: "caller-comal", heard: t.text });
        }
      }
    }
    if (staffAskedSplit) {
      const asked = staffAskedSplit;
      staffAskedSplit = null;
      if (/^[¿¡\s]*(s[ií]|yes|yeah|yep|claro|ok(?:ay)?|por\s+favor|please|aj[aá]|eso|exacto|correcto|sure)(?![\p{L}\p{N}])/iu.test(t.text) && !/^[¿¡\s]*s[ií][,.\s]+no(?![\p{L}])/iu.test(t.text)) {
        containers.splits.push({ parts: asked.parts, from: 0, to: null });
        containers.phrases.push(`staff: ${asked.phrase} → ${t.text.trim()}`);
        steps.push({ source: "caller-split", heard: t.text, parts: asked.parts });
        if (!FOOD.test(t.text)) continue;
      }
    }
    if (isClosing(t.text)) { steps.push({ source: "caller-closing", heard: t.text }); continue; }
    // orders1: "I would like five orders" with one dish on the order and none named → that dish, five of them
    { const W: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
      const m = t.text.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:orders?|[oó]rdenes)\b/iu);
      const n = m ? (W[m[1].toLowerCase()] ?? Number(m[1])) : 0;
      const food = cart.filter((l) => !DRINK.test(String(l.itemId).replace(/[-_]/g, " ")));
      if (n >= 1 && n <= 20 && food.length === 1 && !dishesNamed(t.text).size && !FOOD.test(t.text)) {
        food[0].quantity = n; steps.push({ source: "caller-orders-count", heard: t.text }); continue;
      } }
    // staffpick1: Elvi's open choice ("¿Taco Comal, Taco Harina o Taco Taquero?", "¿REGULAR Dorada o DELUXE Preparada?") that
    // staff settled out loud since the caller last spoke ("Taco normal, taquero.", "Normales.") is answered with staff's pick.
    // Callers rarely repeat the option name, so the question stayed open and swallowed the rest of the order (5:22 PM call).
    { const rawStaff = staffSince.join(" "); const said = staffSince.flatMap((x) => x.split(/(?<=[.!])\s+|¿[^?]*\?/u)).filter((x) => x.trim() && !/\?/.test(x)).join(" ");
      staffSince = [];
      const qs = asking(last) ? (String(last.reply || "").match(/(?:¿[^?¿]+|[^.!?¿:]+)\?/gu) || []) : [];
      // staffpick2: if the caller answers the open choice themselves this turn ("Ajá, de comal"), let their turn answer it.
      const selfPick = qs.map((q) => staffPick(optsOf(q), t.text)).find(Boolean) || null;
      let pick = selfPick ? null : (qs.map((q) => staffPick(optsOf(q), said)).find(Boolean) || null);
      // larry1: staff's yes/no check ("Flour, right?" / "¿De harina?") + caller "Yep" answers the open tortilla choice.
      if (!pick && !selfPick && /^\W*(yep|yup|yes|yeah|uh-?huh|correct|right|s[ií]|aj[aá]|exacto|eso)\b/iu.test(t.text)) {
        const tw = (rawStaff.match(/\b(flour|harina|corn|comal|ma[ií]z|taquer[ao]|street)\b[^?]*\?/iu) || [])[1];
        if (tw) { const want = /flour|harina/i.test(tw) ? /flour|harina/i : /taquer|street/i.test(tw) ? /taquer|street/i : /comal|homemade|ma[ií]z/i;
          pick = qs.map((q) => optsOf(q).find((o) => want.test(o))).find(Boolean) || null; } }
      // tortdef1 (Nico 11:40): an unanswered tortilla-type question must not block the item. Once the order moves on (staff
      // "anything else / algo más / name", or caller "that is it / es todo"), take the house default — corn/comal, as staff rings it.
      if (!pick && !selfPick) {
        const nf = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
        const movedOn = /\b(anything else|something else|algo mas|otra cosa|name for the order|nombre)\b/.test(nf(rawStaff)) || /\b(that is it|that's it|thats it|that's all|nothing else|es todo|eso es todo|nada mas|seria todo)\b/.test(nf(t.text));
        // larry1: a bare "yeah / that's fine" to a tortilla question (Queso Birrias loop) also takes the house default.
        const affirm = /^\s*(yeah|yep|yup|yes|ok(?:ay)?|sure|fine|that'?s fine|si|aja|esta bien|asi esta bien)\b/.test(nf(t.text)) && !dishesNamed(t.text).size;
        const tq = movedOn || affirm ? qs.map((q) => optsOf(q)).find((o) => o.length >= 2 && o.every((x) => /\b(corn|comal|maiz|flour|harina|taquer[ao]|street)\b/i.test(x))) : null;
        if (tq) pick = tq.find((x) => /\b(comal|maiz|homemade)\b/i.test(x)) || tq.find((x) => /\bcorn\b/i.test(x) && !/\b(street|taquer)/i.test(x)) || null;
      }
      // larry1: staff offers a side ("you want onions and peppers?") → caller "yes… two of those": ring that side.
      { if (/\b(?:want|quieres?|gusta)\b[^?]*\b(?:onions?\s+(?:and|y)\s+peppers?|cebollas?\s+y\s+chiles?)/iu.test(rawStaff)) { sideOffer = rawStaff; sideOfferAge = 0; } else sideOfferAge++;
        const off = (sideOfferAge <= 2 ? sideOffer : "").match(/\b(?:want|quieres?|gusta)\b[^?]*?\b((?:grilled\s+)?onions?\s+(?:and|y)\s+peppers?|cebollas?\s+y\s+chiles?(?:\s+asados?)?)\b[^?]*\?/iu);
        const yes = /\b(yes|yeah|yep|sure|s[ií]|aj[aá])\b/iu.test(t.text);
        const m2 = t.text.match(/\b(\d|one|two|three|four|una?|dos|tres|cuatro)\s+(?:of\s+)?(?:those|them|these|esos?|esas?|de\s+es[oa]s)\b/iu);
        if (off && yes && !dishesNamed(t.text).size) { const said2 = `${m2 ? m2[1] : "1"} Extras: Cebolla y Chiles Asados (grilled onions and peppers side)`;
          const n0s = cart.length; last = await say(said2, t.language, "staff-offer-yes");
          // side1: the yes rings exactly the Extras side — drop whatever the model added (salsa, a 2nd gordita) and ring the side.
          { const q = ({ one: 1, un: 1, una: 1, two: 2, dos: 2, three: 3, tres: 3, four: 4, cuatro: 4 } as Record<string, number>)[String(m2?.[1] || "1").toLowerCase()] || Number(m2?.[1]) || 1;
            cart.splice(n0s); cart.push({ itemId: EXTRAS_ID, quantity: q, modifiers: [{ step: "Extras options", option: "Cebolla y Chiles Asados" }] } as any); } steps.push({ source: "staff-offer-yes", heard: t.text.slice(0, 80) }); lastStaff = ""; sideOffer = ""; continue; } }
      if (pick) { last = await say(pick, t.language, "staff-pick"); steps.push({ source: "staff-pick", heard: said.trim().slice(0, 120), pick }); } }
    // multi2: Elvi is still asking about an item (e.g. nachos meat + toppings) and the caller answers it — with a bare meat
    // ("Bistec."), or by confirming staff's read-back of the choices ("Una nachos de bistec, frijoles, lechuga" → "Eso es, sí,
    // con todo"). Those answers used to be dropped as clarifications, so the question never closed and every later dish
    // (the second person's order) was swallowed by it.
    if (asking(last)) {
      const nrm = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      const q = nrm(String(last.reply || "")), b0 = nrm(t.text.replace(/[¿¡?.!,]+/gu, " "));
      const meat = (b0.match(/\b(bistec|chorizo|asada|pastor|carnitas|cabeza|lengua|tripa|pollo|deshebrada|suadero|birria)\b/) || [])[1];
      const confirm = /^\s*(?:eso\s+es|s[ií]|as[ií]|exacto|correcto|aj[aá])(?![\p{L}])/iu.test(t.text) && !dishesNamed(t.text).size;
      const staffChoices = confirm && lastStaff && !/\?|¿/.test(lastStaff) ? lastStaff.replace(/\b(?:aj[aá]|okay|ok)\b[,.]?/giu, " ").replace(/\s+/g, " ").trim() : "";
      // (a bare meat answer falls through to the meat-fragment logic below instead of being skipped as a clarification)
      if (staffChoices && FOOD.test(staffChoices) && !/\bcon\s+tod(?:it)?o\b/iu.test(t.text)) { last = await say(`${staffChoices}${/con\s+todo/i.test(t.text) ? ", con todo" : ""}`, t.language, "caller-staff-readback"); steps.push({ source: "caller-staff-readback", heard: t.text }); if (asking(last)) await acceptOpen(t.language); continue; }
      // "con todo" / confirming staff's list → name the options from Elvi's own question (all of them for "con todo",
      // otherwise the ones staff read back)
      { const opts = (String(last.reply || "").match(/(?:¿([^?¿]+)|([^?¿]+))\?\s*$/u)?.slice(1).find(Boolean) || "").replace(/^[^:]*:\s*/u, "").replace(/^\s*and\s+/iu, "").replace(/^\s*y\s+/iu, "").split(/\s*,\s*|\s+o\s+|\s+or\s+/u).map((x) => x.trim()).filter((x) => x && !/^(qu[eé]|what|regular|deluxe)\b/iu.test(x));
        const staffRun = nrm(recentStaff.join(" "));
        const pick = /\bcon\s+tod(?:it)?o\b|\bwith\s+everything\b/iu.test(t.text) ? opts.filter((o) => !/double|doble/i.test(o)) : confirm ? opts.filter((o) => staffRun.includes(nrm(o).split(" ")[0])) : [];
        if (pick.length && !dishesNamed(t.text).size) { last = await say(pick.join(", "), t.language, "caller-answer"); steps.push({ source: "caller-answer", heard: t.text }); if (asking(last)) await acceptOpen(t.language); continue; } }
      // (a new dish while an old question is open no longer auto-accepts the old one: "Me pone gordita" → "una quesadilla"
      // rang a meatless gordita; the caller comes back to it)
    }
    // fix23: bare acks / one-word answers to staff ("Sí.", "comal", "Campechana.") are not new dishes.
    // aliases1: campechana / o mal now come from the shared list.
    const bare = applySharedAliases(t.text.replace(/[¿¡?.!,]+/gu, " ").replace(/\s+/g, " ").trim(), "phone");
    if (/^(s[ií]|yes|ok|okay|okey|aja|aj[aá]|mm+|uh\s*huh|claro|correcto|exacto)$/iu.test(bare)) {
      steps.push({ source: "caller-ack", heard: t.text }); continue;
    }
    // fix1036: a turn that is only filler, a repeat of the item just added ("Oh, coca está bien", "Sí, coca, sí. No,
    // creo que…") or a delivery/pickup remark ("para un pedido a domicilio") orders nothing. Sending it to Elvi made her
    // re-add earlier dishes from history (the doubled tacos/quesadillas/Cokes on the 10:36 call).
    // fix1136: "¿Puedo hacer una orden?" / "quiero ordenar" / "can I place an order" asks to order, it isn't a dish.
    // Sent to Elvi it opened a phantom "Torta: ¿Bistec…?" question that swallowed the next answers.
    if (!FOOD.test(t.text) && ORDER_INTENT.test(cleanPhrase(t.text)) && !ORDER_QTY_DISH.test(cleanPhrase(t.text).replace(ORDER_INTENT, ""))) { steps.push({ source: "caller-intro", heard: t.text }); continue; }
    // fix1136: "Dos, y dos" (counts only, answering staff's "¿cuántas?") restates what's already ordered.
    if (cart.length && isCountOnly(t.text)) { steps.push({ source: "caller-count", heard: t.text }); continue; }
    if (!orderResidue(t.text, (lastAdded as Line | null)?.itemId)) { steps.push({ source: "caller-clarify", heard: t.text }); continue; }
    if (fulfillmentIn(t.text) && !FOOD.test(t.text) && !DRINK.test(applySharedAliases(t.text, "phone"))) {
      // pickup1: "can I order some for pickup — that'd be, yes, please. flour." — the pickup cue is noted, the answer after it still counts
      const rest = t.text.replace(/^.*?\b(?:pick[\s-]?up|to\s+go|para\s+llevar|(?:pasar\s+a\s+)?recoger|delivery|a\s+domicilio)\b[\s,.!?]*/iu, "").trim();
      steps.push({ source: "caller-fulfillment", heard: t.text });
      if (!(asking(last) && rest && rest !== t.text && /\p{L}{3,}/u.test(rest))) continue;
      t = { ...t, text: rest };
    }
    // yesopt1: staff asked a yes/no about one of the options Elvi is waiting on ("You like a rice and beans?") → "yes, please.
    // flour." = that option plus the rest of the answer
    if (asking(last) && /\?\s*$/.test(lastStaff)) {
      const m = t.text.match(/^(?:(?:that'?d\s+be|it'?d\s+be|ok(?:ay)?|este|pues)[,\s]*)*(?:s[ií]|yes|yeah|yep|sure|aj[aá]|claro)\b[,.!\s]*(?:(?:please|por\s+favor)[,.!\s]*)?(.*)$/iu);
      if (m && !dishesNamed(t.text).size) {
        const fold = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
        const st = fold(lastStaff);
        const ws = (o: string) => fold(o).split(/[^a-z]+/).filter((w) => w.length >= 4 && !/^(solo|only|with|con|and)$/.test(w));
        const qOpts = String(last.reply || "").replace(/^[^:¿?]{3,60}:\s*/u, "").split(/[?¿]/u).flatMap((q) => q.replace(/^\s*(?:y|and)\s+/iu, "").split(/\s*,\s*|\s+o\s+|\s+or\s+/u)).map((x) => x.trim()).filter((x) => x && !/^(qu[eé]|what)\b/iu.test(x));
        const scored = qOpts.map((o) => ({ o, n: ws(o).filter((w) => new RegExp(`\\b${w}`).test(st)).length, all: ws(o).length }));
        const best = scored.filter((x) => x.n >= 1).sort((a, b) => b.n - a.n || a.all - b.all)[0];
        if (best && scored.filter((x) => x.n === best.n).length === 1) {
          const tail = m[1].replace(/[.!]+$/u, "").trim();
          const dish = (String(last.reply || "").match(/^([^:¿?]{3,60}):/u)?.[1] || "").trim();
          last = await say(`${dish ? dish + ", " : ""}${best.o}${tail ? ", " + tail : ""}`, t.language, "caller-yes-option"); steps.push({ source: "caller-yes-option", heard: t.text });
          if (asking(last)) await acceptOpen(t.language);
          continue;
        }
      }
    }
    if (cart.length && /^(comal|harina|flour|homemade|ma[ií]z|corn|campechana|bistec|chorizo|asada|pastor|al\s*pastor|bistec y chorizo)$/iu.test(bare) && !(asking(last) && String(last.reply || "").toLowerCase().includes(bare.toLowerCase()))) {
      steps.push({ source: "caller-clarify", heard: t.text }); continue;
    }
    // fix1136: answer to Elvi's open meat question about the previous dish → full dish phrases (no lost tortilla / dorada).
    // case1c: "Me pone gordita y una quesadilla" → staff "¿La gordita de qué?" → "de bistec, me le pone queso" →
    // "¿Y la quesadilla?" → "el de bistec con frijoles las dos". Each meat fragment goes to the dish staff asked about
    // (else the first still waiting); "las dos / both" covers every dish still waiting.
    { const tw = [...cleanPhrase(t.text).matchAll(/\b(?:de\s+)?(ma[ií]z|comal|harina|flour|taquera)\b/giu)].pop(); if (tw && !/\bo\s+de\b/iu.test(t.text)) lastTortilla = `de ${tw[1]}`; }
    const frag = pendingDishes.length && !(pendingDish && expandMeatAnswer(pendingDish, t.text)) ? meatFragment(t.text) : null;
    if (frag) {
      const both = /\b(?:l[ao]s\s+dos|ambos|ambas|both)\b/iu.test(t.text);
      const askedNoun = (lastStaff.match(FOOD) || [])[0]?.toLowerCase().replace(/s$/, "");
      // tw4938: staff "Otra quesadilla, ¿de qué va a ser?" → "de bistec, igual" is about a quesadilla, not the nachos still waiting.
      const askedKind = [...dishesNamed(lastStaff)][0];
      if (!both && askedKind && !pendingDishes.some((d) => dishesNamed(d).has(askedKind))) {
        const ref = [...cart].reverse().find((l) => kindOfItem(l.itemId) === askedKind);
        const fm = (frag.match(new RegExp(MEAT_LIST, "iu")) || [])[0];
        if (ref && /\b(igual|same|lo\s+mismo)\b/iu.test(t.text) && (!fm || lineHasMeat(ref, fm))) { const l: Line = { ...ref, quantity: 1, modifiers: [...(ref.modifiers || [])] }; cart.push(l); lastAdded = l; steps.push({ source: "caller-same-as", heard: t.text, kind: askedKind }); }
        else { last = await say(`${dishPhrase(askedKind)} ${frag}`.trim(), t.language, "caller-meat-fragment"); if (asking(last)) await acceptOpen(t.language); }
        continue;
      }
      const pick = both ? [...pendingDishes] : [pendingDishes.find((d) => askedNoun && dishNoun(d) === askedNoun) || pendingDishes[0]];
      for (const d of pick) {
        pendingDishes = pendingDishes.filter((x) => x !== d);
        // case1e: keep the dish-type word the fragment cut off ("De chicharrón. ¿De chicharrón dorada o …?")
        const kind = (cleanPhrase(t.text).match(/\b(dorad[ao]s?|frit[ao]s?)\b/iu) || [])[1];
        const phrase = `${dishPhrase(d)} ${frag}${kind && !new RegExp(kind, "i").test(frag) ? " " + kind : ""}`.trim();
        if (pendingDish && dishNoun(pendingDish) === dishNoun(d)) pendingDish = null;
        last = await say(phrase, t.language, "caller-meat-fragment");
        // the tortilla the caller already chose this call ("De maíz") answers a repeat tortilla question
        if (asking(last) && lastTortilla && /comal|harina|taquera|tortilla/i.test(String(last.reply || ""))) last = await say(lastTortilla, t.language, "caller-meat-fragment-tortilla");
        if (asking(last)) await acceptOpen(t.language);
      }
      steps.push({ source: "caller-meat-fragments", heard: t.text, dishes: pick });
      continue;
    }
    const expanded = pendingDish ? expandMeatAnswer(pendingDish, t.text) : null;
    if (expanded) {
      const asked = pendingDish!; pendingDish = null;
      const before = cart.length;
      // Settle Elvi's open question with the first part as plain text, then add the rest as full phrases.
      for (let k = 0; k < expanded.length; k++) {
        const nb = cart.length;
        last = await say(expanded[k], t.language, "caller-meat");
        // Elvi answering her own open question keeps her pending quantity (1); the caller said the count explicitly.
        const said = spokenCount(expanded[k]);
        if (said && cart.length === nb + 1 && cart[nb].quantity !== said) cart[nb].quantity = said;
        if (k === 0 && cart.length === before && asking(last)) { await acceptOpen(t.language); }
      }
      steps.push({ source: "caller-meat-expanded", heard: t.text, asked, expanded });
      continue;
    }
    // meatsplit1: "two flour steak quesadillas deluxe" → "Can I get one steak and one chorizo?" splits the line just rung by meat
    // (Bree) instead of adding two more.
    { const MEAT_OPT: Array<[RegExp, string]> = [[/^(?:steak|bistec)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^tripa$/i, "Tripa / Beef Tripe"], [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"], [/^costilla$/i, "Costilla / Beef Rib"], [/^carnitas$/i, "Carnitas / Pulled Pork"], [/^cabeza$/i, "Cabeza / Beef Head"], [/^buche$/i, "Buche / Pork Stomach"], [/^lengua$/i, "Lengua / Beef Tongue"], [/^prensado$/i, "Prensado / Spicy Pork"]];
      const W: Record<string, number> = { one: 1, una: 1, uno: 1, un: 1, two: 2, dos: 2, three: 3, tres: 3 };
      const prev = cart[cart.length - 1] as any; const body = t.text.replace(/^.*?\b(?:can i get|could i get|get|me da|dame)\s+/iu, "").replace(/[?.!]+\s*$/, "");
      const parts = [...body.matchAll(/\b(one|una?|uno|two|dos|three|tres)\s+(?:de\s+|of\s+)?([\p{L}]+(?:\s+pastor)?)/giu)];
      const mi = prev ? (prev.modifiers || []).findIndex((m: any) => MEAT_OPT.some(([, o]) => String(m.option).startsWith(o.split(" (")[0]))) : -1;
      if (prev && mi >= 0 && !FOOD.test(t.text) && parts.length >= 2 && parts.every((p) => MEAT_OPT.some(([re]) => re.test(p[2])))
        && parts.reduce((a, p) => a + W[p[1].toLowerCase()], 0) === (prev.quantity || 1) && body.replace(/\b(one|una?|uno|two|dos|three|tres|and|y|of|de)\b|[\p{L}]+/giu, (w) => parts.some((p) => p[2].toLowerCase() === w.toLowerCase()) || /^(one|una?|uno|two|dos|three|tres|and|y|of|de)$/i.test(w) ? "" : "X").replace(/[\s,]/g, "") === "") {
        cart.pop();
        for (const p of parts) { const opt = MEAT_OPT.find(([re]) => re.test(p[2]))![1]; const mods = [...prev.modifiers]; mods[mi] = { ...mods[mi], option: opt }; cart.push({ ...prev, quantity: W[p[1].toLowerCase()], modifiers: mods }); }
        steps.push({ source: "meat-split", heard: t.text }); continue; } }
    // order3: "Y la tercera orden serían tres de bistec con chorizo" — a numbered order with only "N de MEAT" is another of the
    // last dish (Paco's 3rd quesadilla order was dropped).
    { const m = t.text.match(/\b(?:primer[ao]?|segund[ao]|tercer[ao]?|cuart[ao]|quint[ao]|otra)\s+orden\s+(?:ser[ií]an?|es|son|ser[aá]n?|de)\s+(.*)$/iu);
      const lastDish = [...cart].reverse().map((l: any) => dishNoun(String(l.itemId).replace(/^sq-/, "").replace(/-/g, " "))).find(Boolean);
      if (m && !FOOD.test(m[1]) && MEAT_WORDS.test(m[1]) && lastDish) t = { ...t, text: m[1].replace(new RegExp(`^(${QTY})\\s+(?:de,?\\s+)+`, "iu"), `$1 ${lastDish}s de `) }; }
    // dish1b: same, merged into one turn ("…una orden de tacos. Diga, me da cuatro de tripa y cuatro de costilla").
    { const m = t.text.match(/\b(?:una?\s+)?orden\s+de\s+(tacos|quesadillas|gorditas|tortas|burritos|sopes|tostadas|tamales|enchiladas|flautas)\b/iu);
      if (m && !cart.length) { const tail = t.text.slice((m.index || 0) + m[0].length);
        if (!FOOD.test(tail) && new RegExp(`\\b${QTY}\\s+de\\s+\\p{L}`, "iu").test(tail))
          t = { ...t, text: tail.replace(/^[\s.,]*(?:diga,?\s*)?(?:ah,?\s*)?/iu, "").replace(new RegExp(`\\b(${QTY})\\s+de\\s+(?=\\p{L})`, "giu"), `$1 ${m[1].toLowerCase()} de `) }; } }
    // dish1: "quería poner una orden de tacos" → "me da cuatro de tripa y cuatro de costilla": the counts are of that dish.
    { const prevC = [...merged0].reverse().find((u) => u !== t && u.speaker === "caller" && u.start < t.start);
      const ctx = prevC && FOOD.test(prevC.text) && !/\b(dos|tres|cuatro|cinco|seis|siete|ocho|two|three|four|five|six|\d+)\b/i.test(prevC.text) ? dishNoun(prevC.text) : "";
      if (ctx && !cart.length && !FOOD.test(t.text) && new RegExp(`(?:^|\\s)(?:me\\s+da|dame|quiero|give me)?\\s*${QTY}\\s+de\\s+\\p{L}`, "iu").test(t.text))
        t = { ...t, text: t.text.replace(new RegExp(`\\b(${QTY})\\s+de\\s+(?=\\p{L})`, "giu"), `$1 ${ctx}s de `) }; }
    for (const raw of splitItems(cleanPhrase(t.text))) {
      let piece = cleanPhrase(raw).replace(TOKENS, " ").replace(/\b(?:para\s+)?(?:un\s+)?pedido\s*$/iu, "").replace(/\s{2,}/g, " ").trim();
      if (!piece) continue;
      if (cart.length && isCountOnly(piece)) { steps.push({ source: "caller-count", heard: piece }); continue; }
      // ticket5: container split ("en diferentes recipientes", "separado", "split it") → NO BEBIDA dividers on the ticket.
      const sp = detectContainerSplit(piece, { afterSplit: containers.phrases.length > 0 });
      let splitFrom = -1;
      if (sp) {
        containers.phrases.push(sp.phrase);
        const restHasFood = FOOD.test(sp.rest);
        if (!restHasFood) {
          // No new dish: applies to what was already ordered. Don't send it to Elvi (she'd treat "dos" as a quantity).
          // Applied at ticket time to whatever food is in the cart (Elvi may still be settling a question).
          if (!containers.splits.some((x) => x.from === 0 && x.to == null && x.parts === sp.parts)) containers.splits.push({ parts: sp.parts, from: 0, to: null });
          steps.push({ source: "caller-split", heard: piece, parts: sp.parts });
          continue;
        }
        splitFrom = cart.length;
        piece = cleanPhrase(sp.rest) || piece;
      }
      const prev = last ? String(last.reply || "") : "";
      const nBefore = cart.length;
      last = await say(piece, t.language, "caller");
      pendingDish = cart.length === nBefore && asking(last) && FOOD.test(piece) ? piece : cart.length > nBefore ? null : pendingDish;
      if (cart.length === nBefore && asking(last) && isBareDish(piece)) pendingDishes.push(piece); // case1c
      else if (cart.length > nBefore) pendingDishes = pendingDishes.filter((d) => !cart.slice(nBefore).some((l) => String(l.itemId).includes(dishNoun(d))));
      if (sp && splitFrom >= 0) {
        const added = cart.length > splitFrom;
        // "y aparte/por separado tres tacos" after earlier food → new container starts with the new dish.
        if (added && splitFrom > 0 && /aparte|separad|separate|otr[oa]\s|another/iu.test(sp.phrase) && !/\b(?:dos|tres|cuatro|two|three|four|[234])\b/iu.test(sp.phrase)) containers.breaks.push(splitFrom);
        else containers.splits.push({ parts: sp.parts, from: added ? splitFrom : Math.max(0, cart.length - 1), to: added ? cart.length : null });
      }
      // Elvi was stuck on an earlier question and ignored this turn: settle it, then retry the turn.
      if (prev && asking(last) && String(last.reply || "") === prev) {
        await acceptOpen(t.language);
        last = await say(piece, t.language, "caller-retry");
      }
    }
  }
  await acceptOpen(lang0());
  for (const y of yesAdds) { // case1d
    const re = /frijol|bean/.test(y.what) ? /con frijoles|with beans/i : new RegExp(y.what, "i");
    if (!cart.includes(y.line) || (y.line.modifiers || []).some((m: any) => re.test(String(m.option)))) continue;
    const opt = cart.flatMap((l) => (l.itemId === y.line.itemId ? l.modifiers || [] : [])).find((m: any) => re.test(String(m.option)));
    if (opt) y.line.modifiers = [...(y.line.modifiers || []), { ...opt }];
  }
  // qbcomal1: Queso Birrias with no tortilla named by the caller defaults to comal (QCO), as staff rings it — never Taquera.
  if (!turns.some((t) => t.speaker === "caller" && /\b(taquer[oa]s?|street|chiquit[oa]s?)\b/iu.test(t.text)))
    for (const l of cart as any[]) l.modifiers = (l.modifiers || []).map((m: any) => /^\s*\(QST\)[^]*queso birria/i.test(String(m.option || "")) ? { ...m, option: "(QCO) 3 x Queso Birrias Comal / Homemade con Consome/Broth" } : m);
  fulfillment = detectFulfillment(turns as any).fulfillment as any;
  const groups = [...new Set(cart.map((l: any) => l.person).filter(Boolean))];
  return { cart, steps, autoAccepted, containers, ambiguousRemovals, removalsAttributed: true, fulfillment, ...(groups.length ? { groups } : {}) };
}
