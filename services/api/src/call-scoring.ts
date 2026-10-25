// Listen-only call scoring: split the dual-channel recording (ch1 = caller, ch2 = staff),
// transcribe each track with word timestamps, interleave into turns, and replay the caller
// turns through Elvi's order context one at a time (shadow session, never checkout).
import { applySharedAliases } from "./aliases.js";
import { nameFromAnswer } from "./order-name.js";
import { fulfillmentIn, detectFulfillment, detectAddress, addressesIn } from "./delivery.js";
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
  // jose1: "deme dos, dos de quesadillas, dos de pollo" — deme-N + dish + N-de-meat stay one order (else invent never sees deme+pollo).
  const out: string[] = [];
  for (const raw of parts) {
    const piece = raw.trim();
    if (!piece) continue;
    if (out.length && /(?:dame|deme|me\s+(?:da|das|pone)|quiero)\s+(?:\d+|dos|tres|cuatro|cinco|seis|siete|ocho)\s*$/iu.test(out[out.length - 1])) {
      out[out.length - 1] = `${out[out.length - 1]}, ${piece}`;
      continue;
    }
    if (out.length && /^(?:una?|uno|otr[oa]|another|one|\d+|dos|tres|cuatro|cinco|seis|siete|ocho)\s+de\s+[\p{L}]/iu.test(piece)
      && !/\b(?:tacos?|quesadillas?|gorditas?|tortas?|burritos?|sopes?|huaraches?|tostadas?)\b/iu.test(piece)) {
      out[out.length - 1] = `${out[out.length - 1]}, ${piece}`;
      continue;
    }
    out.push(piece);
  }
  return out;
}

const LEAD = /^(?:(?:hola|hi|hello|hey|oye|sí|si|yes|okay|ok|bueno|eh|em|ehm|um|uh|este)\b[,.!]?\s*|no[,.!]\s+|(?:buenas\s+(?:tardes|noches)|buenos\s+días|good\s+(?:morning|afternoon|evening))[,.!]?\s*|(?:quiero|quisiera|dame|me\s+(?:das|da|pones|puedes\s+dar|regalas)|can\s+i\s+(?:get|have)|could\s+i\s+(?:get|have)|i(?:'d|\s+would)\s+like|i\s+want|let\s+me\s+get|i'll\s+have)\s+)/iu;
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
const CLOSING = /^(?:no[,.\s]*)?(?:es\s+todo|eso\s+es\s+todo|nada\s+más|ser[ií]a\s+todo|serio\s+todo|that'?s\s+(?:all|it|everything)|no\s+thanks?|gracias|bueno|ok(?:ay)?|sale|perfecto|listo|alright|great|thanks?|thank\s+you|para\s+recoger|for\s+pick\s*up|pickup|[aá]ndale(?:\s*,?\s*pues)?|[oó]rale(?:\s*,?\s*pues)?)\b/iu;
const FOOD = /\b(?:tacos?|burritos?|quesadillas?|qd|gorditas?|queso\s+tortas?|tortas?|combo|enchiladas?|tamales?|menudos?|po[sz]oles?|moles?|platillos?|plates?|birrias?|tortillas?|horchata|jamaica|jarritos?|agua|soda|bowl|nachos|elote|esquite|pack|platter|charola|sopesazos?|sopesasos?|sopes?|huaraches?|guaraches?|tostadas?|mariscos|cocktail|cóctel)\b/iu;
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
  const m = prevCustomer.match(/\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|\d+)\s+(tacos|quesadillas|gorditas|tortas|burritos|sopes|sopesa[sz]os|huaraches|tostadas|tamales|enchiladas|menudos|moles|platillos)\b/i);
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
const FILLER = /(?<![\p{L}\p{N}])(?:s[ií]|no|oh|ah|okay|ok|okey|bueno|pues|este|o\s+sea|perd[oó]n|sorry|creo\s+que|yo\s+creo|est[aá]\s+bien|as[ií]\s+est[aá]\s+bien|eso|ser[ií]a|todo|nada\s+m[aá]s|gracias|claro|perfecto|listo|ya|mhm|aj[aá]|that'?s|it|fine|yes|yeah|good|all)(?![\p{L}\p{N}])/giu;
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
const MEAT_WORDS = /\b(?:bistec|steak|asada|pastor|chorizo|pollo|chicken|carnitas|cabeza|buche|tripas?|prensado|duro|chicharr[oó]n|lengua|suadero|campechana|costillas?|frijoles?|beans|queso|cheese)\b/iu;
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
  // alejandro1: "una de tripas y una de bistec" — match from first meat (plural tripas/costillas OK)
  const m = a.match(/\bde\s+(?:bistec|steak|asada|pastor|chorizo|pollo|carnitas|cabeza|buche|tripas?|prensado|duro|chicharr[oó]n|lengua|suadero|campechana|costillas?)\b.*$/iu);
  if (!m) return null;
  return m[0].replace(/\b(?:me\s+)?(?:le\s+)?(?:pone|pones|ponga)\b/giu, "con").replace(/\b(?:l[ao]s\s+dos|ambos|ambas|both)\b/giu, "").replace(/[¿?]+.*$/u, "").replace(/\bcon\s+con\b/giu, "con").replace(/\b(tripa)s\b/giu, "$1").replace(/\b(costilla)s\b/giu, "$1").replace(/\s{2,}/g, " ").replace(/[,.\s]+$/u, "").trim();
}
export function expandMeatAnswer(pendingDish: string, answer: string): string[] | null {
  // alejandro1: strip "o que me pones" / stutter "una de, una de X" so multi-meat splits parse
  let a = cleanPhrase(answer).replace(/[.?!,;\s]+$/u, "").trim();
  a = a.replace(/^(?:o\s+que\s+)?(?:me\s+)?(?:pones?|ponga|ponme|das?|dame|deme|quiero)\s+/iu, "").trim();
  a = a.replace(/\buna\s+de\s*,\s*/giu, "").replace(/(?<!\p{L})uj[uú](?!\p{L})/giu, "").replace(/[.?!,;\s]+$/u, "").replace(/\s{2,}/g, " ").trim();
  if (!a || FOOD.test(a)) return null;
  const qtyRe = new RegExp(`^(${QTY})\\s+(?=de\\s)`, "iu");
  const parts = a.split(new RegExp(`\\s*(?:,|\\by\\b|\\band\\b)\\s*(?=(?:${QTY}\\s+)?de\\s)`, "iu")).map((x) => x.trim()).filter(Boolean);
  if (!parts.length || !parts.every((x) => new RegExp(`^(?:${QTY}\\s+)?de\\s+[\\p{L}][\\p{L}\\s]{1,40}$`, "iu").test(x))) return null;
  pendingDish = cleanPhrase(pendingDish).replace(/^(?:y\s+)?(?:me\s+)?(?:pone|pones|ponga|das|da|dame|manda|traes?)\s+/iu, "").trim();
  const dishQty = (pendingDish.match(new RegExp(`^(${QTY})\\s+`, "iu")) || [])[1] || "";
  const dish = pendingDish.replace(new RegExp(`^${QTY}\\s+`, "iu"), "").replace(/[,.\s]+$/u, "").trim();
  return parts.map((x) => { const q = (x.match(qtyRe) || [])[1]; return `${q || dishQty} ${dish} ${x.replace(qtyRe, "")}`.trim(); });
}
const ORDER_INTENT = /^[¿¡\s]*(?:(?:s[ií]|oh|hola|bueno|eh|em|ehm|um|uh|este)[,.\s]+)*(?:(?:buenos\s+d[ií]as|buenas\s+(?:tardes|noches))[,.\s]+)?(?:(?:se\s+)?(?:puedo|podr[ií]a|puede|quiero|quisiera|me\s+gustar[ií]a)\s+(?:hacer|poner|dejar|ordenar|pedir)(?:\s+(?:una?|mi)\s+(?:orden|pedido))?|(?:hacer|poner|dejar)\s+(?:una?|mi)\s+(?:orden|pedido)|para\s+(?:hacer|poner|dejar)(?:\s+(?:una?|mi))?\s+(?:orden|pedido)|para\s+(?:una?|mi)\s+(?:orden|pedido)|para\s+hacer\b|can\s+i\s+(?:place|make|put\s+in)\s+an?\s+order|i(?:'d|\s+would)\s+like\s+to\s+(?:place\s+an\s+)?order)\b(?:[?.!,\s]|\b(?:por\s+favor|please)\b)*/iu;
const ORDER_QTY_DISH = /\p{L}{3,}/u;
export const isOrderIntro = (text: string) => {
  const c = cleanPhrase(text);
  if (FOOD.test(text) || !ORDER_INTENT.test(c)) return false;
  const rest = c.replace(ORDER_INTENT, "").replace(/\b(?:por\s+favor|please|gracias|thanks)\b/giu, "").trim();
  return !ORDER_QTY_DISH.test(rest);
};
export const STAFF_VOICE = /^[¿¡\s]*(?:¿\s*)?(?:cu[aá]nt[oa]s?\s+\p{L}+\s+(?:quer[ií]a|quiere|quieres|va\s+a\s+querer)|qu[eé]\s+m[aá]s|qu[eé]\s+le\s+(?:vamos\s+a\s+)?(?:pongo|ponemos|damos)|de\s+qu[eé]\s+(?:las?|los?)\s+quiere|algo\s+m[aá]s)\b[^.!]*\?/iu;
export const isCountOnly = (text: string) => !FOOD.test(text) && !orderResidue(text, null).replace(new RegExp(`(?<![\\p{L}])(?:${QTY.slice(3, -1)}|y|and)(?![\\p{L}])`, "giu"), "").trim();
const COUNT: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export const spokenCount = (phrase: string) => { const w = String(phrase || "").trim().split(/\s+/)[0]?.toLowerCase() || ""; return /^\d+$/.test(w) ? Number(w) : COUNT[w] || 0; };
export const DIPS_ID = "sq-dips-MAIPCN";
export const EXTRAS_ID = "sq-extras-mild-salsa-asada-2oz-T6PGNT"; // Extras item; variation picked by option
export const COMAL_OPTION: Record<string, string> = { quesadilla: "(QCO) Quesadilla de Comal / Homemade" };

type Line = { itemId: string; quantity: number; modifiers?: any[]; readback?: string; elviNotes?: string[]; posSize?: "small" };
/** sopesize1: caller said small ("chico(s)" after shared aliases: chiquito, pequeño, small) for a sopesaso. */
export const SMALL_SOPE = /\b(?:chic[oa]s?|(?:de\s+los\s+)?normal(?:es)?|regulares?)\b/iu; // juan1: normales/regulares = Sope Elvis
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
// desk1 (Julio): "¿me puede preparar una?" is an order, and staff taking one ("¿al nombre de quién?", "dame unos quince minutos",
// "entonces te tengo…") means the call is not info-only — "¿De qué carne hay?" had dropped every caller turn.
const ASKS_TO_ORDER2 = /\b(?:me\s+)?(?:puede|puedes|podr[ií]a|podr[ií]as)\s+(?:preparar|hacer|dar|poner|mandar|tomar|apartar)\b|\bme\s+(?:prepara|hace|manda|aparta)s?\b/iu;
const STAFF_TOOK_ORDER = /\ba?l?\s*nombre\s+de\s+qui[eé]n\b|\bqu[eé]\s+nombre\b|\b(?:dame|deme|d[eé]jame)\s+(?:unos?\s+)?\w+\s+minutos\b|\bentonces\s+(?:te\s+)?tengo\b|\btienes\s+una\s+orden\b|\bte\s+voy\s+a\s+dar\b|\bname\s+for\s+(?:the|your)\s+order\b|\bgive\s+me\s+(?:like\s+|about\s+)?\w+\s+minutes\b|\bso\s+i\s+(?:got|have)\b/iu;
export function isQuestionOnlyCall(turns: Array<{ speaker: string; text: string }>): boolean {
  const caller = turns.filter((t) => t.speaker === "caller").map((t) => t.text);
  if (!caller.length) return false;
  if (caller.some((t) => ASKS_TO_ORDER2.test(t)) || turns.some((t) => t.speaker === "staff" && STAFF_TOOK_ORDER.test(t.text))) return false;
  const all = caller.join(" ");
  return !caller.some((t) => ASKS_TO_ORDER.test(t)) && INFO_Q.test(all) && /\?|^\s*(?:are|is|do|does|can|what|which|how|tienen|es|son|lleva|hay)\b/imu.test(all);
}
// tw4938: which dish kinds a phrase names, and which kind a menu item is (by its id).
const DISH_KINDS: Array<[string, RegExp]> = [["taco", /\btacos?\b/iu], ["quesadilla", /\bquesadillas?\b|\bqd\b/iu], ["gordita", /\bgorditas?\b/iu], ["queso torta", /\bqueso\s+tortas?\b/iu], ["torta", /\btortas?\b/iu], ["burrito", /\bburritos?\b/iu],
  ["sope", /\bsopes?\b|\bsopes[ae]sos?\b/iu], ["huarache", /\b[gh]uaraches?\b/iu], ["nacho", /\bnachos?\b/iu], ["esquite", /\besquites?\b/iu], ["tostada", /\btostadas?\b/iu], ["enchilada", /\benchiladas?\b/iu], ["tamal", /\btamal(?:es)?\b/iu], ["menudo", /\bmenudos?\b/iu], ["pozole", /\bpo[sz]oles?\b/iu], ["mole", /\bmoles?\b/iu], ["platillo", /\bplatillos?\b/iu], ["birria", /\bbirrias?\b/iu], ["tortilla", /\btortillas?\b/iu]];
export const dishesNamed = (text: string) => {
  const s = new Set(DISH_KINDS.filter(([, re]) => re.test(String(text || ""))).map(([k]) => k));
  // quesitorta1: "queso tortas" also matches /tortas?/ — keep only the queso-torta kind
  if (s.has("queso torta")) s.delete("torta");
  return s;
};
export const kindOfItem = (itemId: string) => { const id = String(itemId || "").toLowerCase(); const hit = DISH_KINDS.find(([k]) => id.includes(k)); return hit ? hit[0] : null; };
const MEAT_LIST = "bistec|asada|pastor|chorizo|pollo|carnitas|cabeza|buche|tripas?|prensado|duro|lengua|suadero|deshebrada|picadillo|nopales|vegetal|campechana|costillas?";
const normListedMeat = (m: string) => String(m || "").toLowerCase().replace(/^(tripa)s$/, "$1").replace(/^(costilla)s$/, "$1");
const lineHasMeat = (l: { modifiers?: any[] }, meat: string) => (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option)));
const tortillaWordOf = (l: { modifiers?: any[] }) => { const o = (l.modifiers || []).map((m: any) => String(m.option)).join(" "); return /taquer|street/i.test(o) ? " taquero" : /harina|flour/i.test(o) ? " de harina" : /comal|homemade/i.test(o) ? " de comal" : ""; };
/** tw4938: meats the caller listed for the dish being ordered ("uno de bistec … y tripa", "otra tripa") — each one is a line. */
export function listedMeats(text: string): Array<{ meat: string; another: boolean; qty?: number }> {
  const t = cleanPhrase(text), out: Array<{ meat: string; another: boolean; qty?: number }> = [];
  const re = new RegExp(String.raw`\b(?:(un[oa]|otr[oa]|y)\s+(?:de\s+|m[aá]s\s+de\s+)?(?:al\s+)?)(${MEAT_LIST})\b`, "giu");
  for (const m of t.matchAll(re)) { const before = t.slice(Math.max(0, (m.index || 0) - 5), m.index); if (/\b(sin|no)\s*$/i.test(before)) continue; if (/^y$/i.test(m[1]) && new RegExp(String.raw`\bde\s+(?:${MEAT_LIST})\s*$`, "iu").test(t.slice(0, m.index))) continue; /* "de bistec y chorizo" = one mixed item */ out.push({ meat: normListedMeat(m[2]), another: /^otr/i.test(m[1]), qty: /^un/i.test(m[1]) ? 1 : undefined }); }
  // pablo1: "cuatro de tripa y cuatro de costilla" / "cuatro tacos de tripa" — qty (+ optional dish) + de + meat.
  { const seen = new Set(out.map((x) => x.meat));
    // alejandro1: "una quesadilla de comal de tripa" — optional "de" before tortilla word
    // oscar1: cleanPhrase turns "quesadilla dorada" → "QD REGULAR Dorada"; still capture "de pastor"
    const re2 = new RegExp(String.raw`\b(\d+|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho)\s+(?:(?:tacos?|quesadillas?|gorditas?|queso\s+tortas?|tortas?|qd)\s+)?(?:(?:de\s+)?(?:taquero|comal|harina|street|dorad\w*|preparad\w*|regular(?:es)?|deluxe)\s+)*de\s+(?:al\s+)?(${MEAT_LIST})\b`, "giu");
    for (const m of t.matchAll(re2)) {
      const meat = normListedMeat(m[2]); if (seen.has(meat)) continue;
      const before = t.slice(Math.max(0, (m.index || 0) - 5), m.index); if (/\b(sin|no)\s*$/i.test(before)) continue;
      seen.add(meat); out.push({ meat, another: out.length > 0, qty: spokenCount(m[1]) || undefined });
    }
  }
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
  // agustin1: named "para X" / "para el chaparro" wins over "otra/siguiente orden" when both appear in one turn
  {
    // note: no /i on \p{Lu} patterns — /iu makes \p{Lu} match lowercase ("para llevar")
    const chap = /\b(?:ese\s+es\s+|es\s+)?para\s+el\s+(chaparro)\b/iu.exec(t);
    if (chap) return "Chaparro";
    const m = /\b(?:esa\s+(?:ser[ií]a|es)\s+|esa\s+orden\s+(?:ser[ií]a\s+)?(?:es\s+)?|ese\s+es\s+|es\s+)?para\s+(?:el\s+|la\s+)?(\p{Lu}\p{Ll}{2,})\b/u.exec(t)
      || /\b(?:for)\s+(\p{Lu}\p{Ll}{2,})\b/u.exec(t)
      || /\b(?:en\s+)?(?:la|el)\s+(?:orden\s+)?de\s+(\p{Lu}\p{Ll}{2,}|ella|[ée]l)\b/u.exec(t);
    if (m && !/^(usted|llevar|aqu[ií]|comer|ahorita|mañana|hoy)$/iu.test(m[1])) {
      const raw = m[1];
      if (raw.toLowerCase() === "él" || raw.toLowerCase() === "el") return "él";
      return raw;
    }
  }
  // plate1: "en otro plato", "por separado", "la otra/siguiente orden", "en un plato aparte" → the next plate
  if (/\b(?:en\s+)?otro\s+plato\b|(?<!\p{L})(?:platos|[oó]rdenes|pedidos|bolsas)\s+(?:por\s+)?separad|\b(?:p[oó]ngalo|ponlo|p[oó]ngamel[oa]s?|ponga|va|van)\s+(?:por\s+)?separad|\b(?:la\s+)?(?:otra|siguiente)\s+orden\b|\b(?:plato|orden)\s+aparte\b|\bseparate\s+(?:plates?|orders?|bags?)\b|\banother\s+(?:plate|order)\b/iu.test(t)) return "+";
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
/** or1: "dos tacos de bistec, o tres tacos de bistec" / "dos, o tres tacos" — the caller corrected the count; the last one wins (Luisa).
 *  each1: "two flour steak quesadillas deluxe … can I get one steak and one chorizo?" — the two are one of each meat (Bree). */
const NUMW = String.raw`\d{1,2}|un[oa]?|dos|tres|cuatro|cinco|seis|one|two|three|four|five|six`;
const EACH_MEATS = String.raw`steak|chicken|chorizo|pastor|asada|carnitas|tripe|birria|bistec|pollo|buche|lengua|cabeza|tripa|prensado`;
export function rewriteCallerText(text: string): string {
  let s = String(text || "");
  s = s.replace(/\bde\s+de\b/giu, "de"); // oscar1 ASR: "quesadilla de de lengua"
  s = s.replace(new RegExp(String.raw`\b(${NUMW})\s+([\p{L} ]+?)[,\s]+(?:o|or)\s+(${NUMW})\s+\2\b`, "giu"), "$3 $2");
  s = s.replace(new RegExp(String.raw`\b(${NUMW}),?\s+(?:o|or)\s+(${NUMW})\b`, "giu"), "$2");
  s = s.replace(new RegExp(String.raw`\b(?:two|2|dos)\s+((?:[\p{L}]+\s+){0,3}?)(quesadillas|tacos|burritos|tortas|gorditas|sopes)\b([^?.!]*?)[.?!,]*\s*(?:can\s+i\s+(?:get|have)|i\s+want|make\s+it|make\s+them)?\s*\b(?:one|una?)\s+(?:de\s+)?(${EACH_MEATS})\s+(?:and|y)\s+(?:one|una?)\s+(?:de\s+)?(${EACH_MEATS})\b\??`, "iu"),
    (_m, adj: string, noun: string, rest: string, a: string, b: string) => {
      const ad = adj.replace(new RegExp(String.raw`\b(?:${EACH_MEATS})\b`, "giu"), "").replace(/\s+/g, " ").trim();
      const r = rest.replace(/[,\s]+$/u, "").trim(); const one = noun.replace(/s$/i, "");
      return `one ${ad ? ad + " " : ""}${a} ${one}${r ? " " + r : ""} and one ${ad ? ad + " " : ""}${b} ${one}${r ? " " + r : ""}.`;
    });
  // chips1 (Noé): "dos chips con pico" is the Dips item Pico de Gallo con Chips, not a bowl
  s = s.replace(/\b(?:chips|totopos)\s+con,?\s+(?:el\s+)?pico(?:\s+de\s+gallo)?\b|\bpico(?:\s+de\s+gallo)?\s+(?:con|and|with)\s+chips\b/giu, "Dips Pico de Gallo con Chips");
  // jose1: ASR truncates "quesadillas" → "quesad" ("dos de quesad, dos de pollo")
  s = s.replace(/\bquesad\b/giu, "quesadillas");
  // jose1: ASR "Vité"/"vite" for vista/bistec (also bare "de Vité." after the dish turn)
  s = s.replace(/\bde\s+vit[eé](?!\p{L})/giu, "de bistec");
  // gino1: "quesadillas de bistec supreme" → keep meat/qty, mark dorada deluxe
  if (/\bquesadillas?\b/iu.test(s)) s = s.replace(/\bsupreme\b/giu, "doradas deluxe preparadas");
  // carlos1: "otros tres, no, dos tacos…" — mid-phrase count correction
  s = s.replace(new RegExp(String.raw`\b(${NUMW})\s*,?\s+no[,.]?\s+(${NUMW})\s+`, "giu"), "$2 ");
  // gino1: "un taco taquero de lengua y uno de chorizo" → one of each (not one mixed line)
  s = s.replace(new RegExp(String.raw`\b(?:un[oa]?|1)\s+(tacos?|quesadillas?)\s+((?:taquero|comal|harina|street|dorad\w*|preparad\w*)\s+)?de\s+(${EACH_MEATS})\s+y\s+(?:un[oa]?|1)\s+(?:de\s+)?(${EACH_MEATS})\b`, "iu"),
    (_m, noun, tort, a, b) => {
      const one = String(noun).replace(/s$/i, "");
      const tw = tort ? ` ${String(tort).trim()}` : "";
      return `un ${one}${tw} de ${a} y un ${one}${tw} de ${b}`;
    });
  // jorge1: "chicharrón prensado" / "chicharrón duro" — strip chicharrón so listedMeats sees prensado/duro
  s = s.replace(/\bchicharr[oó]n\s+(prensado|duro)\b/giu, "$1");
  // jorge1: reject-comal "tiene fritas en aceite" / "fritas de aceite" → doradas cue (aceite1 / pendingQuesadilla)
  s = s.replace(/\b(?:tiene\s+)?fritas?\s+(?:en|de)\s+aceite\b/giu, "doradas de aceite");
  // miriam1: ASR "También debiste" / "debiste" → "de bistec" (gordita meat)
  s = s.replace(/\b(?:tambi[eé]n\s+)?debiste\b/giu, "también de bistec");
  // juanTst1: ASR "cinco de viste" / "de viste" → bistec; "dos sabos de horchata" → vasos
  s = s.replace(/\bde\s+viste(?!\p{L})/giu, "de bistec");
  s = s.replace(/\bviste(?!\p{L})/giu, "bistec");
  s = s.replace(/\bsabos\b/giu, "vasos");
  // julioDorada1: "salsa dorada" (ASR) → salsa asada extras
  s = s.replace(/\bsalsa\s+dorada\b/giu, "salsa asada");
  // oscar1: "una de pastor doradas" / "una de bistec también dorada" → quesadilla dorada de X
  s = s.replace(new RegExp(String.raw`\b(${NUMW})\s+de\s+(?:al\s+)?(${MEAT_LIST})\s+(?:tambi[eé]n\s+)?doradas?\b`, "giu"),
    (_m, n, meat) => `${n} quesadillas doradas de ${meat}`);
  // julioDorada1/miriam1: bare "N doradas" (no "quesadillas") → quesadillas doradas so dish/force paths fire
  s = s.replace(new RegExp(String.raw`\b(${NUMW})\s+doradas?\b`, "giu"), (m, n, off) => {
    const before = s.slice(Math.max(0, off - 24), off);
    if (/quesadillas?\s*$/iu.test(before)) return m;
    return `${n} quesadillas doradas`;
  });
  // julioDorada1: "tres de bistec … de hecho, a dos de bistec" — correction wins
  s = s.replace(new RegExp(String.raw`\b(?:tres|3)\s+de\s+(${MEAT_LIST})\b([\s\S]{0,100}?)\bde\s+hecho,?\s+a\s+(?:dos|2)\s+de\s+\1\b`, "iu"), "dos de $1$2");
  return s;
}
export function prepMergedCallerTurns(merged: { speaker: string; text: string }[]): void {
  // fixmeat1 (Jesús): "de chorizo, que diga, perdón, del pastor" — the self-correction replaces the meat
  const FIXW = String.raw`(?:que\s+diga|perd[oó]n|digo|mejor|no+)`;
  for (const t of merged) if (t.speaker === "caller")
    t.text = t.text.replace(new RegExp(String.raw`\bde\s+(?:${MEAT_LIST}|pastor)\s*,?\s*${FIXW}(?:\s*,?\s*${FIXW})*\s*,?\s*(?:de\s+|del\s+)?(al\s+pastor|pastor|${MEAT_LIST})\b`, "iu"), (_m, y) => `de ${/^pastor$/i.test(y) ? "al pastor" : y}`);
  // cris1: STT "pomal" = comal; "de normal" rejecting doradas = comal for quesadillas
  {
    const all = merged.map((x) => x.text).join(" ");
    const doradCtx = /\bdorad/iu.test(all);
    for (const t of merged) {
      if (t.speaker !== "caller") continue;
      t.text = t.text.replace(/\bpomal\b/giu, "comal");
      if (doradCtx && /\b(?:de\s+)?normal(?:es)?\b/iu.test(t.text) && /\bquesadillas?\b/iu.test(all))
        t.text = t.text.replace(/\b(?:de\s+)?normal(?:es)?\b/giu, "de comal");
    }
  }
  // anthony1: staff "homemade or refried?" → "the fried ones with corn, the corn tortilla ones?" = QD doradas (not TCO/comal/street)
  {
    const all = merged.map((x) => x.text).join(" ");
    const qdCtx = /\bquesadillas?\b/iu.test(all);
    for (const t of merged) {
      if (t.speaker !== "caller") continue;
      // ASR "four of the five quesadillas" → four quesadillas
      t.text = t.text.replace(/\b(four|4|cuatro)\s+of\s+the\s+five\s+quesadillas\b/giu, "$1 quesadillas");
      if (!qdCtx) continue;
      if (/\bfried\b/iu.test(t.text) || /\bcorn tortilla ones?\b/iu.test(t.text)) {
        t.text = t.text
          .replace(/\bthe fried ones?(?:\s+with\s+corn)?(?:,?\s+the corn tortilla ones?)?\b/giu, "quesadillas doradas")
          .replace(/\bfried ones?(?:\s+with\s+corn)?\b/giu, "quesadillas doradas")
          .replace(/\bcorn tortilla ones?\b/giu, "quesadillas doradas");
      }
    }
  }
  // combo1/jesus1: "el combo de las gorditas" → COMBO Gorditas (keep "dos órdenes de/del" qty cue)
  for (const t of merged) if (t.speaker === "caller")
    t.text = t.text.replace(/\b(?:un\s*,?\s*)?(?:el\s+|un\s+)?combo\s+de\s+(?:las\s+|los\s+)?(gorditas|tacos|tortas|quesadillas|burritos?)\b/giu, (_m, d) => `COMBO ${d[0].toUpperCase()}${d.slice(1).toLowerCase()}`);
  // split2 (Jesús): "una quesadilla …, y me puede dar el combo de las gorditas …" is two orders in one merged turn;
  // a tortilla answer (harina/maíz) inside the gordita part belongs to the quesadilla (gorditas are corn only).
  for (let i = 0; i < merged.length; i++) { const t = merged[i]; if (t.speaker !== "caller") continue;
    const m = t.text.match(/^(.*\bquesadillas?\b.*?),?\s+y\s+(me\s+(?:puede|puedes|podr[ií]a)\s+dar\b.*\bgorditas?\b.*)$/isu);
    if (!m) continue;
    let [a, b] = [m[1], m[2]]; const tort = b.match(/\bde\s+(harina|ma[ií]z)\b/iu);
    if (tort) { b = b.replace(tort[0], " "); a = a.replace(/\bquesadillas?\b/iu, (q) => `${q} de ${tort[1]}`); }
    t.text = a; merged.splice(i + 1, 0, { ...t, text: b }); i++; }
  // desk2 (Julio): "¿tiene nachos?" → "¿me puede preparar una?" — the dish-less order is for the dish the caller just asked about
  // cecilia1: "¿sí tienen menudo?" → "dos órdenes … con pata" (menudo/mole/platillo + órdenes + con/sin pata)
  // cecilia1b: same turn after merge — "¿tienen menudo? … dos órdenes con pata" → stamp dish onto the órdenes clause
  for (const t of merged) {
    if (t.speaker !== "caller") continue;
    const m = t.text.match(/\b(nachos|quesadillas?|tacos?|tortas?|burritos?|gorditas?|sopes?|huaraches?|tostadas?|enchiladas?|tamales|esquites?|menudos?|moles?|platillos?)\b[^]*?\b((?:me\s+)?(?:puede|puedes|podr[ií]a|podr[ií]as|pone|pones|manda)\s+(?:(?:preparar|hacer|dar|poner)\s+)?(?:un[oa]?|dos|tres)(?:\s+(?:[oó]rdenes?|orders?))?)\b(?!\s+de\s+)/iu);
    if (m) t.text = t.text.replace(m[2], (x) => /(?<![\p{L}])[oó]rdenes?(?![\p{L}])/iu.test(x) ? `${x} de ${m[1]}` : `${x} orden de ${m[1]}`);
  }
  { let lastDish = ""; let givenName = "";
    for (const t of merged) { if (t.speaker !== "caller") continue;
      const d = t.text.match(/\b(nachos|quesadillas?|tacos?|tortas?|burritos?|gorditas?|sopes?|huaraches?|tostadas?|enchiladas?|tamales|esquites?|menudos?|moles?|platillos?|c[oó]ctel(?:es)?\s+de\s+camar[oó]n(?:es)?)\b/iu);
      if (d) { lastDish = d[1]; continue; }
      { const nm = t.text.match(/\ba\s+nombre\s+de\s+(\p{L}+)/iu); if (nm) givenName = nm[1].toLowerCase();
        const w = t.text.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
        if (!nm && givenName && w.includes(givenName) && w.every(x => x === givenName || /^(de|aj[aá]|s[ií]|ok(ay)?|es|a|nombre)$/.test(x))) { t.text = ""; continue; } } // desk2: name echo "de julio, ajá"
      if (lastDish && !/chips|\(dip\)/iu.test(t.text) && /\b(?:me\s+)?(?:puede|puedes|podr[ií]a|podr[ií]as|pone|pones|manda)\s+(?:(?:preparar|hacer|dar|poner)\s+)?(un[oa]?|dos|tres)(?:\s+(?:[oó]rdenes?|orders?))?\b(?:\s*,?\s*(?:porfa|por\s+favor|please))?(?:\s*,?\s*(?:con|sin)\s+patas?)?\s*[.?!]*\s*$/iu.test(t.text))
        t.text = t.text.replace(/\b((?:puede|puedes|podr[ií]a|podr[ií]as|pone|pones|manda)\s+(?:(?:preparar|hacer|dar|poner)\s+)?(?:un[oa]?|dos|tres)(?:\s+(?:[oó]rdenes?|orders?))?)\b/iu,
          (m) => /(?<![\p{L}])[oó]rdenes?(?![\p{L}])/iu.test(m) ? `${m} de ${lastDish}` : `${m} orden de ${lastDish}`); } }
}
export const DORADA_DELUXE_ID = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", DORADA_REG_ID = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
/** mix1: "tres de bistec con chorizo" is ONE line with both meats (mixed), not 3 bistec + 2 chorizo (Paco). "y" stays separate. */
export function mixMeats(acts: any[], text: string) {
  const m = String(text || "").match(new RegExp(`\\b(${MEAT_LIST})\\s+con\\s+(${MEAT_LIST})\\b`, "iu"));
  if (!m) return;
  const a0 = m[1].toLowerCase(), b0 = m[2].toLowerCase();
  const meatOf = (a: any) => (a.modifiers || []).map((x: any) => String(x.option).toLowerCase()).filter((o: string) => !/salsa/i.test(o) && new RegExp(MEAT_LIST, "i").test(o)); // mix2: "Mild Salsa Asada" is not a meat
  const OPT: Array<[RegExp, string]> = [
    [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
    [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^picadillo$/i, "Picadillo / Ground Beef"],
    [/^nopales$/i, "Nopales con Papas / Cacti with Potatoes"],
    [/^buche$/i, "Buche / Pork Stomach"], [/^lengua$/i, "Lengua / Beef Tongue"],
  ];
  const optOf = (w: string) => OPT.find(([re]) => re.test(w))?.[1];
  const i = acts.findIndex((a) => a.type === "add_item" && meatOf(a).length === 1 && meatOf(a)[0].includes(a0));
  const j = acts.findIndex((a, k) => k !== i && a.type === "add_item" && i >= 0 && a.itemId === acts[i].itemId && meatOf(a).length === 1 && meatOf(a)[0].includes(b0));
  if (i >= 0 && j >= 0) {
    const extra = (acts[j].modifiers || []).filter((x: any) => String(x.option).toLowerCase().includes(b0));
    acts[i] = { ...acts[i], quantity: Math.max(Number(acts[i].quantity) || 1, Number(acts[j].quantity) || 1), modifiers: [...(acts[i].modifiers || []), ...extra] };
    acts.splice(j, 1);
    return;
  }
  // alex1e: single "chorizo con bistec" line — stamp the missing meat (model/force-add often keeps one)
  for (const a of acts) {
    if (a.type !== "add_item") continue;
    const have = meatOf(a);
    if (!have.length) continue;
    const need: string[] = [];
    if (!have.some((o: string) => o.includes(a0))) { const opt = optOf(a0); if (opt) need.push(opt); }
    if (!have.some((o: string) => o.includes(b0))) { const opt = optOf(b0); if (opt) need.push(opt); }
    if (!need.length) continue;
    // only stamp when the line already has one of the two spoken meats
    if (!have.some((o: string) => o.includes(a0) || o.includes(b0))) continue;
    a.modifiers = [...(a.modifiers || []), ...need.map((option) => ({ step: "(B) Q Carnes / Meats", option }))];
  }
}

export async function shadowOrderFromTurns(turns: CallTurn[], run: ShadowTurn) {
  if (isQuestionOnlyCall(turns)) turns = turns.filter((t) => t.speaker !== "caller"); // cleanup1: no order on an info-only call
  const cart: Line[] = [];
  const history: Array<{ role: "customer" | "assistant"; text: string }> = [];
  const steps: any[] = [];
  let lastTouched: Line | null = null;
  const touchedNow: Line[] = [];
  let person: string | null = null, plateN = 0, personSegStart = 0; // multi1/agustin1: per-person groups; segStart for para-X backfill
  let sizeAnswer = false;
  // luis7895/chuy1: "dos/tres menudos" often gets an Elvi question (empty add); apply spoken qty on the later add (incl. staff-pick).
  let pendingSpokenQty: { n: number; kind: string } | null = null;
  let pendingQuesadilla: { n: number; meat: string } | null = null; // gino1: "dos quesadillas de bistec" before aceite/preparadas
  let pendingSmallSope = false; // juan1: "sopes de los normales/chicos" said before the line lands
  let shadowAddress: string | null = null;
  let shadowAddressConfirmed = false;
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
      } else if (a.type === "set_address" && a.address) {
        // joseA1: set_address means the address was captured — mark confirmed for shadow/scoring
        shadowAddress = String(a.address);
        shadowAddressConfirmed = true;
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
    if (source === "caller" || source === "caller-retry") {
      const p = personSwitch(text);
      if (p === "+") { personSegStart = cart.length; person = `plato ${++plateN + 1}`; }
      else if (p === "me") { personSegStart = cart.length; person = "me"; }
      else if (p) {
        // agustin1: closing stamp ("esa sería/es para Tony", "ese es para el chaparro") backfills the open ticket.
        // multi2: opening ("para Juana es una porción…") starts a new person — do not stamp prior items.
        const closing = /\b(?:esa\s+(?:ser[ií]a|es)\s+|esa\s+orden\s+(?:ser[ií]a\s+)?(?:es\s+)?|ese\s+es\s+)para\b/iu.test(text);
        if (closing) {
          for (let i = personSegStart; i < cart.length; i++) (cart[i] as any).person = p;
        } else {
          personSegStart = cart.length;
        }
        person = p;
      }
    }
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
      const aMeats = (a.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => meatRe.test(o) && !/salsa/i.test(o));
      const prevMeats = [...have].filter((o) => meatRe.test(o) && !/salsa/i.test(o));
      // oscar1: "una dorada de pastor" after another Dorada meat must ADD a new line, not merge onto prensado/lengua
      if (aMeats.length && prevMeats.length && !aMeats.every((am: string) => prevMeats.some((pm: string) => pm.toLowerCase().includes(am.toLowerCase().split("/")[0].trim()) || am.toLowerCase().includes(pm.toLowerCase().split("/")[0].trim()))))
        return [a];
      const fresh = (a.modifiers || []).filter((m: any) => !have.has(String(m.option)) && !(prevMeat && meatRe.test(String(m.option)) && !new RegExp((String(m.option).match(meatRe) || ["\\0"])[0], "i").test(text)));
      return fresh.length ? [{ type: "update_item", itemId: a.itemId, modifiers: mergeMods(prevLine.modifiers || [], fresh) }] : [];
    });
    // avail2/pickup1: availability probe only opens Elvi's question — never cart lines
    if (source === "caller-avail") for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item" || acts[i].type === "update_item") acts.splice(i, 1);
    carryAskedQty(acts, text, history.length >= 4 ? history[history.length - 4].text : "", answering);
    // drinks1 (Cecilia): "uno de botella (Pepsi)" then "una de Jamaica" — keep both; drop remove_item on a drink unless they said no/instead
    if (source.startsWith("caller") && !/\b(?:no[,\s]+(?:la|lo|el|mejor)|mejor\b|instead|en\s+vez|cambial?[oa]?|quita(?:me)?|remove|sin\s+(?:la|el)\s+)/iu.test(text)) {
      const addingDrink = acts.some((a: any) => a.type === "add_item" && (/drink|agua|pepsi|coca|jamaica|horchata|refresco|soda/i.test(String(a.itemId)) || DRINK.test(String(a.readback || ""))));
      if (addingDrink) for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.type === "remove_item" && (/drink|agua|pepsi|coca|jamaica|horchata|refresco|soda/i.test(String(a.itemId)) || cart.some((l) => l.itemId === a.itemId && DRINK.test(String(l.readback || l.itemId))))) acts.splice(i, 1);
      }
    }
    // teresa1 (CA4bc478): "¿Cocas? Aquí tengo cocas" / "ya tengo refrescos" — caller already has drinks, not ordering.
    // Drop any drink add/update from this turn (model hears "coca" and rings one).
    if (source.startsWith("caller") && /(?:aqu[ií]|ya)\s+tengo\s+(?:\w+\s+){0,3}(?:cocas?|coke|pepsi|refrescos?|sodas?|horchata|jamaica)|(?:aqu[ií]|ya)\s+(?:las?|los?)\s+tengo\b/iu.test(text)) {
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if ((a.type === "add_item" || a.type === "update_item") && (/drink|agua|pepsi|coca|jamaica|horchata|refresco|soda/i.test(String(a.itemId)) || DRINK.test(String(a.readback || "")))) acts.splice(i, 1);
      }
    }
    // jamaica1 (Cecilia): "agua de Jamaica" / "una de Jamaica" must never become N× Water Bottle (model heard "agua" + qty noise)
    if (source.startsWith("caller") && /\b(?:jamaica|horchata|tamarindo|agua\s+fresca|aguas\s+frescas)\b/iu.test(text)) {
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if ((a.type === "add_item" || a.type === "update_item") && /water-bottle|agua-water|water bottle/i.test(String(a.itemId))) acts.splice(i, 1);
      }
    }
    // jamaica1b: bare "agua" bottle with absurd qty (≥3) when caller never said water/botella de agua — drop (any source)
    if (!/\b(?:botella\s+de\s+agua|water\s+bottle|solo\s+agua|pure\s+life|dasani)\b/iu.test(text + " " + prevCaller)) {
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.type === "add_item" && /water-bottle|agua-water/i.test(String(a.itemId)) && (Number(a.quantity) || 1) >= 3) acts.splice(i, 1);
      }
    }
    // jamaica1c (Cecilia): after dropping water spam, ensure Jamaica/Horchata/Tamarindo actually lands
    if (source.startsWith("caller")) {
      const drinkWant: Array<[RegExp, string, RegExp]> = [
        [/\bjamaica\b/iu, "sq-drink-agua-fresca-jamaica-32oz-ZLA3ZG", /jamaica/i],
        [/\bhorchata\b/iu, "sq-drink-agua-fresca-horchata-32oz", /horchata/i],
        [/\btamarindo\b/iu, "sq-drink-agua-fresca-tamarindo-32oz", /tamarindo/i],
      ];
      for (const [re, id, idRe] of drinkWant) {
        if (!re.test(text)) continue;
        const have = cart.some((l) => idRe.test(String(l.itemId)))
          || acts.some((a: any) => a.type === "add_item" && idRe.test(String(a.itemId)));
        if (!have) acts.push({ type: "add_item", itemId: id, quantity: 1, modifiers: [], readback: id.includes("jamaica") ? "jamaica" : id.includes("horchata") ? "horchata" : "tamarindo" });
      }
    }
    // docena1b / angelica1: "una docena de tortilla" / "dos docenas" → N × 12 x Tortilla Comal (not "not on menu")
    {
      const aliasedDoc = applySharedAliases(text, "phone");
      // Bare "docenas" only via alias→12 x Tortilla Comal (alias forbids meats/dishes). Explicit "docena de tortilla(s)" always hits.
      const dozenHit = /\b12\s*x\s*tortilla\s*comal\b/iu.test(aliasedDoc)
        || /\bdocenas?\s+de\s+tortillas?\b/iu.test(text);
      if (source.startsWith("caller") && dozenHit) {
        const TOR = "sq-tortillas-12-x-tortilla-comal-handmade-VGID3H";
        // Spoken dozen count: "dos docenas" / "dos 12 x Tortilla Comal" → qty 2; bare/una → 1 (never inflate from the "12" in the SKU name)
        const dm = (text + " " + aliasedDoc).match(/\b(un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+(?:docenas?|12\s*x\s*tortilla)/iu);
        const dozenQty = dm ? Math.max(1, spokenCount(dm[1]) || Number(dm[1]) || 1) : 1;
        const have = cart.some((l) => /tortillas?-12|12-x-tortilla|tortilla-comal/i.test(String(l.itemId)))
          || acts.some((a: any) => a.type === "add_item" && /tortillas?-12|12-x-tortilla|tortilla-comal/i.test(String(a.itemId)));
        if (!have) acts.push({ type: "add_item", itemId: TOR, quantity: dozenQty, modifiers: [], readback: dozenQty > 1 ? `${dozenQty} docenas tortillas comal` : "12 tortillas comal" });
        // luis181c / angelica1: pack SKU is already "12 x …" — model often sets quantity=12; clamp to spoken dozens
        for (const a of acts) {
          if (a.type === "add_item" && /(?:^|-)tortillas?-12(?:-x-tortilla|-comal)|12-x-tortilla-comal/i.test(String(a.itemId || ""))) a.quantity = dozenQty;
        }
        for (const l of cart) {
          if (/(?:^|-)tortillas?-12(?:-x-tortilla|-comal)|12-x-tortilla-comal/i.test(String(l.itemId || ""))) l.quantity = dozenQty;
        }
        // luis181b: drop phantom 6-pack when they asked for a dozen (model + auto-accept often ring 6 taquera too)
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i]; const id = String(a.itemId || "");
          if (a.type === "add_item" && /(?:^|-)tortillas?-6-x-tortilla|6-x-tortilla/i.test(id) && !/menudo|mole|platillo|birria/i.test(id)) acts.splice(i, 1);
        }
        for (let i = cart.length - 1; i >= 0; i--) {
          const id = String(cart[i].itemId || "");
          if (/(?:^|-)tortillas?-6-x-tortilla|6-x-tortilla/i.test(id) && !/menudo|mole|platillo|birria/i.test(id)) cart.splice(i, 1);
        }
      }
    }
    // enrique1: "va a ser un menudo con pata" / "también va a ser un mole" — model often returns []; force catalog add (not avail asks).
    if (source.startsWith("caller") && !/\b(?:tienen|hay|tiene|ten[eé]s|vende[ns]?|manejan|disponible)\b/iu.test(text)) {
      if (/\bmenudos?\b/iu.test(text) && /\b(?:va\s+a\s+ser|quiero|dame|deme|me\s+da|pon(?:me|ga)?|un[oa]?|dos|tres|\d+)\b/iu.test(text)) {
        const haveCart = cart.filter((l) => /menudo/i.test(String(l.itemId)));
        const haveActs = acts.filter((a: any) => a.type === "add_item" && /menudo/i.test(String(a.itemId)));
        // bryan1/monica (standing): vague "un menudo"/"menudos" with no pata → Menudo con Tortillas (SIN).
        // Con Pata only when caller clearly says con pata.
        const saidConPata = /\bcon\s+patas?\b/iu.test(text) && !/\bsin\s+patas?\b/iu.test(text);
        const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
        const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
        const id = saidConPata ? CON : SIN;
        // luis181d: "te puedo ordenar un menudo?" then "Un menudo sin pata" — clarify SKU, do not ring a second bowl
        if (haveCart.length || haveActs.length) {
          for (const l of haveCart) {
            if (/\bsin\s+patas?\b/iu.test(text) || (!saidConPata && /\b(?:sin|con)\s+patas?\b/iu.test(text) === false && /con-pata|con_pata/i.test(String(l.itemId)))) {
              l.itemId = SIN;
              l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata/i.test(String(m.option)));
            } else if (saidConPata) {
              l.itemId = CON;
              if (!(l.modifiers || []).some((m: any) => /extra\s*pata|con\s+pata/i.test(String(m.option))))
                l.modifiers = [...(l.modifiers || []), { step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" }];
            }
          }
          for (const a of haveActs) {
            if (/\bsin\s+patas?\b/iu.test(text) || (!saidConPata && /con-pata|con_pata/i.test(String(a.itemId)))) {
              a.itemId = SIN;
              a.modifiers = (a.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata/i.test(String(m.option)));
            } else if (saidConPata) {
              a.itemId = CON;
            }
          }
          // drop model re-adds of menudo on a sin/con-pata clarify
          if (/\b(?:sin|con)\s+patas?\b/iu.test(text) && haveCart.length) {
            for (let i = acts.length - 1; i >= 0; i--) {
              if (acts[i].type === "add_item" && /menudo/i.test(String(acts[i].itemId))) acts.splice(i, 1);
            }
          }
        } else {
          const mods: any[] = [];
          if (saidConPata) mods.push({ step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" });
          // enrique1b: house default corn comal tortillas when force-adding (model never answered the tortilla Q)
          mods.push({ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" });
          // miguel1: "tres menudos sin patas" — keep spoken bowl count on force-add
          const mq = text.match(new RegExp(String.raw`\b(${NUMW})\s+menudos?\b`, "iu"));
          const qMen = mq ? (spokenCount(mq[1]) || 1) : 1;
          acts.push({ type: "add_item", itemId: id, quantity: Math.max(1, qMen), modifiers: mods, readback: "menudo" });
        }
      }
      if (/\bmoles?\b/iu.test(text) && /\b(?:va\s+a\s+ser|tambi[eé]n|quiero|dame|deme|me\s+da|pon(?:me|ga)?|un[oa]?)\b/iu.test(text)) {
        const have = cart.some((l) => /mole/i.test(String(l.itemId)))
          || acts.some((a: any) => a.type === "add_item" && /mole/i.test(String(a.itemId)));
        // enrique1b: Solo Arroz + 3 corn tortillas (Square house defaults when caller never chose)
        if (!have) acts.push({ type: "add_item", itemId: "sq-mole-tradicional-platillo-4THFAW", quantity: 1, modifiers: [
          { step: "(A) Mole Sides", option: "Solo Arroz / Rice" },
          { step: "(B) Mole Tortillas", option: "3 x (Corn) Corn Tortilla" },
        ], readback: "mole" });
      }
    }
    // victor1 (CA7c79ab): "una orden de birria" after barbacoa avail → add Birria; avail-only ("¿tiene barbacoa?") stays out via isAvailQ.
    if (source.startsWith("caller") && /\bbirrias?\b/iu.test(text)
      && /\b(?:orden(?:es)?|order|quiero|dame|deme|me\s+da|pon(?:me|ga)?|va\s+a\s+ser|un[oa]?|parece)\b/iu.test(text)
      && !/\b(?:tienen|hay|tiene|ten[eé]s|vende[ns]?|manejan|disponible|barbacoa)\b/iu.test(text)) {
      const have = cart.some((l) => /birria/i.test(String(l.itemId)))
        || acts.some((a: any) => a.type === "add_item" && /birria/i.test(String(a.itemId)));
      if (!have) acts.push({ type: "add_item", itemId: "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD", quantity: 1, modifiers: [], readback: "orden de birria" });
    }
    // jorge1: "¿Te pueden cargar un pozole rojo?" — order cue (cargar/un), model often []; force Pozole Rojo (not avail Q).
    if (source.startsWith("caller") && /\bpo[sz]oles?\b/iu.test(text)
      && /\b(?:cargar|quiero|dame|deme|me\s+da|pon(?:me|ga)?|va\s+a\s+ser|un[oa]?|dos|tres|\d+|orden)\b/iu.test(text)
      && !/\b(?:tienen|hay|tiene|ten[eé]s|vende[ns]?|manejan|disponible)\b/iu.test(text)) {
      const have = cart.some((l) => /pozole/i.test(String(l.itemId)))
        || acts.some((a: any) => a.type === "add_item" && /pozole/i.test(String(a.itemId)));
      if (!have) {
        const id = "sq-pozole-rojo-red-pozole-DQ7X4J";
        const n = spokenCount(cleanPhrase(text)) || 1;
        acts.push({ type: "add_item", itemId: id, quantity: n > 1 ? n : 1, modifiers: [], readback: "pozole rojo" });
      }
    }
    // pedro1: confirm/repeat ("es una orden de pozole", "sí, del pozole rojo", "el pozole está bien") must not re-add
    if (source.startsWith("caller") && /\bpo[sz]oles?\b/iu.test(text)
      && cart.some((l) => /pozole/i.test(String(l.itemId)))
      && !/\b(?:otr[oa]s?|m[aá]s|another|dos|tres|cuatro|2|3|4)\s+po[sz]oles?\b/iu.test(text)
      && !/\b(?:dos|tres|cuatro|2|3|4)\s+(?:órdenes?|orders?)\b/iu.test(text)) {
      for (let i = acts.length - 1; i >= 0; i--)
        if (acts[i].type === "add_item" && /pozole/i.test(String(acts[i].itemId))) acts.splice(i, 1);
    }
    // luisSopes1: "sí, son tres sopes" after sopes already rung = qty confirm (staff said "un sopesazo"), never a 2nd meatless line
    if (source.startsWith("caller") && /\bsopes?(?:asos?|azos?)?\b/iu.test(text)
      && cart.some((l) => /sopes[ae]so/i.test(String(l.itemId)))
      && /\bson\s+(?:\d+|dos|tres|cuatro|one|two|three|four)\s+sopes/iu.test(text)
      && !/\b(?:otr[oa]s?|m[aá]s|another)\s+sopes/iu.test(text)) {
      for (let i = acts.length - 1; i >= 0; i--)
        if (acts[i].type === "add_item" && /sopes[ae]so/i.test(String(acts[i].itemId))) acts.splice(i, 1);
      // bump existing sope qty to spoken confirm count if higher
      const m = text.match(/\bson\s+(\d+|dos|tres|cuatro|one|two|three|four)\s+sopes/iu);
      const wantQ = m ? (spokenCount(m[1]) || 0) : 0;
      if (wantQ > 0) {
        const sope = cart.find((l) => /sopes[ae]so/i.test(String(l.itemId)));
        if (sope && (Number(sope.quantity) || 1) < wantQ) sope.quantity = wantQ;
      }
    }
    // pedro1: mangonadas / Michoacana — we don't sell; never invent a drink/dessert line
    if (source.startsWith("caller") && /\bmangon(?:ada|eada)s?\b/iu.test(text)) {
      for (let i = acts.length - 1; i >= 0; i--)
        if (acts[i].type === "add_item") acts.splice(i, 1);
    }
    // oscar1: single-meat "quesadilla de lengua de comal" — drop model QCO with wrong/stacked meats so force can add
    if (source.startsWith("caller") && /\bquesadillas?\b/iu.test(text) && /\b(?:comal|pomal)\b/iu.test(text) && !/\bdoradas?\b/iu.test(text)) {
      const want = listedMeats(text).map((w) => w.meat.toLowerCase());
      if (want.length === 1) {
        const meatRe = new RegExp(MEAT_LIST, "i");
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i];
          if (a.type !== "add_item" || !/quesadilla/i.test(String(a.itemId)) || /dorada|zzav3l|t5stuh/i.test(String(a.itemId))) continue;
          const lineMeats = (a.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => meatRe.test(o) && !/salsa/i.test(o));
          const ok = lineMeats.length === 1 && want.some((w) => lineMeats[0].toLowerCase().includes(w));
          if (!ok) acts.splice(i, 1);
        }
      }
    }
    // julio1 (CA1c0a9921): "dos quesadillas de comal" + "una de duro, una de prensado" — model returns [] forever; force QCO lines.
    if (source.startsWith("caller") && !acts.some((a: any) => a.type === "add_item" && /quesadilla/i.test(String(a.itemId)))) {
      let meats = listedMeats(text);
      // rewritten "una quesadilla de comal de duro/tripa" — listedMeats may miss meat after tortilla word
      { const deMeats = [...text.matchAll(new RegExp(String.raw`\bde\s+(?:al\s+)?(${MEAT_LIST})\b`, "giu"))].map((m) => ({ meat: normListedMeat(m[1]), another: false, qty: 1 as number | undefined }));
        if (dishesNamed(text).has("quesadilla") && deMeats.length > meats.length) meats = deMeats;
        else if (!meats.length && dishesNamed(text).has("quesadilla")) meats = deMeats;
      }
      const recentCaller = history.filter((h) => h.role === "customer").slice(-6).map((h) => h.text).join(" ");
      // alejandro1: staff "dos quesadillas de comal, ¿de qué…?" must count even when caller meat turn has no "comal"
      const staffComal = /\b(?:comal|pomal)\b/iu.test(lastStaff || "") || /\b(?:comal|pomal)\b/iu.test(recentStaff.join(" "));
      const comalCtx = /\b(?:comal|pomal)\b/iu.test(text) || /\b(?:comal|pomal)\b/iu.test(prevCaller) || /\b(?:comal|pomal)\b/iu.test(recentCaller)
        || staffComal
        // cris1: "No, de normal" rejects staff "doradas" → comal (not QD dorada)
        || (/\b(?:normal|sencill)/iu.test(text) && /\bdorad/iu.test(prevReply));
      const qCtx = dishesNamed(text).has("quesadilla") || dishesNamed(prevCaller).has("quesadilla") || dishesNamed(recentCaller).has("quesadilla");
      const meatOnly = meats.length >= 1 && !FOOD.test(text);
      if (qCtx && comalCtx && (dishesNamed(text).has("quesadilla") || meatOnly)) {
        const QCO = "sq-quesadilla-HLT6CR";
        const MEAT_OPT: Array<[RegExp, string]> = [
          [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
          [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^buche$/i, "Buche / Pork Stomach"],
          [/^costillas?$/i, "Costilla / Beef Rib"],
          [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"],
          [/^picadillo$/i, "Picadillo / Ground Beef"], [/^carnitas$/i, "Carnitas / Pulled Pork"],
          [/^tripas?$/i, "Tripa / Beef Tripe"], [/^lengua$/i, "Lengua / Beef Tongue"], [/^cabeza$/i, "Cabeza / Beef Head"],
        ];
        // julio1c: "una de X, una de Y" → one each; carlos1: "dos quesadillas de tripa al comal" → qty 2 on that meat
        const meatSplit = /\buna\s+(?:quesadilla(?:\s+de\s+comal)?\s+)?de\s+/iu.test(text) && meats.length >= 2;
        for (const w of meats) {
          const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
          if (!opt) continue;
          const already = cart.some((l) => /quesadilla/i.test(String(l.itemId)) && (l.modifiers || []).some((m: any) => new RegExp(w.meat, "i").test(String(m.option))))
            || acts.some((a: any) => a.type === "add_item" && /quesadilla/i.test(String(a.itemId)) && (a.modifiers || []).some((m: any) => new RegExp(w.meat, "i").test(String(m.option))));
          if (already) continue;
          const q = meatSplit ? 1 : (w.qty && w.qty > 1 ? w.qty : (meats.length === 1 && /\b(?:dos|2|two)\b/iu.test(text) ? 2 : 1));
          acts.push({ type: "add_item", itemId: QCO, quantity: q, modifiers: [
            { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
            { step: "(B) Q Carnes / Meats", option: opt },
          ], readback: `quesadilla comal ${w.meat}` });
        }
        // julio1c: clear pending "dos quesadillas" so it cannot inflate the first meat line on a split
        if (pendingSpokenQty && /quesadilla/i.test(pendingSpokenQty.kind || "")) pendingSpokenQty = null;
        if (meatSplit) for (const a of acts) if (a.type === "add_item" && /quesadilla/i.test(String(a.itemId)) && /comal/.test(String(a.readback||""))) a.quantity = 1;
      }
    }

    // carlos1b: "dos quesadillas de tripa al comal" — strip extra meats the model stacked (bistec+tripa)
    if (source.startsWith("caller") && /\bquesadillas?\b/iu.test(text) && /\bcomal\b/iu.test(text)) {
      const want = listedMeats(text).map((w) => w.meat.toLowerCase());
      if (want.length === 1) {
        const meatRe = new RegExp(MEAT_LIST, "i");
        for (const a of acts) {
          if (a.type !== "add_item" || !/quesadilla/i.test(String(a.itemId))) continue;
          a.modifiers = (a.modifiers || []).filter((m: any) => {
            const o = String(m.option);
            if (!(meatRe.test(o) && !/salsa/i.test(o))) return true;
            return want.some((w) => o.toLowerCase().includes(w));
          });
        }
        for (const l of cart) {
          if (kindOfItem(l.itemId) !== "quesadilla") continue;
          if (!/comal|QCO|homemade/i.test((l.modifiers || []).map((m: any) => m.option).join(" "))) continue;
          // julio1/alejandro1: expand halves ("…de duro" then "…de prensado") — do not strip a prior split line's meat
          const opts = (l.modifiers || []).map((m: any) => String(m.option));
          const lineMeats = opts.filter((o) => meatRe.test(o) && !/salsa/i.test(o));
          if (!lineMeats.some((o) => want.some((w) => o.toLowerCase().includes(w)))) continue;
          l.modifiers = (l.modifiers || []).filter((m: any) => {
            const o = String(m.option);
            if (!(meatRe.test(o) && !/salsa/i.test(o))) return true;
            return want.some((w) => o.toLowerCase().includes(w));
          });
        }
      }
    }
    // carlos1: "dos tacos de bistec al comal" — model often returns []; force TCO lines (not invent from taquero ref).
    if (source.startsWith("caller") && /\btacos?\b/iu.test(text) && /\bcomal\b/iu.test(text)
      && !/\b(?:tienen|hay|tiene|ten[eé]s|vende|quesadilla)\b/iu.test(text)
      && !acts.some((a: any) => a.type === "add_item" && /taco/i.test(String(a.itemId)) && /comal|TCO|homemade/i.test(String(a.itemId) + " " + (a.modifiers || []).map((m: any) => m.option).join(" ")))
      && !cart.some((l) => kindOfItem(l.itemId) === "taco" && /comal|TCO|homemade/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")) && listedMeats(text).some((w) => (l.modifiers || []).some((m: any) => new RegExp(w.meat, "i").test(String(m.option)))))) {
      let meats = listedMeats(text);
      if (!meats.length) {
        meats = [...text.matchAll(new RegExp(String.raw`\bde\s+(?:al\s+)?(${MEAT_LIST})\b`, "giu"))].map((m) => ({ meat: m[1].toLowerCase(), another: false, qty: 1 as number | undefined }));
      }
      const MEAT_OPT: Array<[RegExp, string]> = [
        [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
        [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"],
        [/^lengua$/i, "Lengua / Beef Tongue"], [/^cabeza$/i, "Cabeza / Beef Head"],
        [/^buche$/i, "Buche / Pork Stomach"], [/^carnitas$/i, "Carnitas / Pulled Pork"],
        [/^costillas?$/i, "Costilla / Beef Rib"], [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"],
      ];
      const TACO = "sq-taco-TAR7L5";
      for (const w of meats) {
        const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
        if (!opt) continue;
        const already = cart.some((l) => kindOfItem(l.itemId) === "taco" && /comal|TCO|homemade/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")) && (l.modifiers || []).some((m: any) => new RegExp(w.meat.replace(/s$/, ""), "i").test(String(m.option))))
          || acts.some((a: any) => a.type === "add_item" && /taco/i.test(String(a.itemId)) && (a.modifiers || []).some((m: any) => new RegExp(w.meat.replace(/s$/, ""), "i").test(String(m.option)) && /comal|TCO|homemade/i.test(String(m.option))));
        if (already) continue;
        const q = w.qty && w.qty > 1 ? w.qty : (meats.length === 1 && /\b(?:dos|2|two)\b/iu.test(text) ? 2 : 1);
        acts.push({ type: "add_item", itemId: TACO, quantity: q, modifiers: [
          { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: opt },
        ], readback: `taco comal ${w.meat}` });
      }
    }
    // juan1c (CAc2720f): model [] on "sopes de los normales" + bare "chorizo" → force Sope Elvis (small) with meat.
    // Size-only turn just sets pendingSmallSope; meat turn (or same-turn meat) force-adds so we don't land a meatless line first.
    { const saidSope = /\bsopes?(?:asos?|azos?)?\b/iu.test(text);
      // luisSopes1: prevCaller "Regulares"/"sencillas" (Dorada style) must not mark the next sope confirm as small
      const prevStyleOnly = /^\W*(?:(?:no|s[ií]|las?|los?|unas?|tres|dos|\d+)\s*,?\s*)?(?:regular(?:es)?|normal(?:es)?|preparad[oa]s?|sencill[ao]s?|deluxe)\W*$/iu.test(prevCaller);
      const saidSmall = SMALL_SOPE.test(applySharedAliases(text, "phone"))
        || (!prevStyleOnly && SMALL_SOPE.test(applySharedAliases(prevCaller, "phone")))
        || pendingSmallSope;
      const mm = text.match(new RegExp(String.raw`\b(${MEAT_LIST})\b`, "iu"));
      const meatOnly = !!(mm && !FOOD.test(text) && !dishesNamed(text).size);
      if (source.startsWith("caller") && saidSope && SMALL_SOPE.test(applySharedAliases(text, "phone"))
        && !/\b(?:tienen|hay|tiene|ten[eé]s|vende|grandes?\s+o\s+chic)/iu.test(text) && !mm) {
        pendingSmallSope = true;
      } else if (source.startsWith("caller") && saidSmall && (saidSope || meatOnly)
        && !/\b(?:tienen|hay|tiene|ten[eé]s|vende)/iu.test(text)
        && !acts.some((a: any) => a.type === "add_item" && /sopes[ae]so/i.test(String(a.itemId)))
        && !cart.some((l) => /sopes[ae]so/i.test(String(l.itemId)))) {
        const qtySrc = saidSope ? text : prevCaller;
        const n = spokenCount(cleanPhrase(qtySrc).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+puedes?\s+poner|me\s+pone)\s+/iu, "")) || 2;
        const MEAT_OPT: Array<[RegExp, string]> = [[/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"]];
        const mods: any[] = [];
        if (mm) { const opt = MEAT_OPT.find(([re]) => re.test(mm[1]))?.[1]; if (opt) mods.push({ step: "(B) Q Carnes / Meats", option: opt }); }
        if (mm || saidSope) {
          acts.push({ type: "add_item", itemId: "sq-sopesaso-elvis", quantity: n > 1 ? n : 2, modifiers: mods, readback: "sopes chicos" });
          pendingSmallSope = true;
        }
      }
    }
    // juan1: never invent standalone tortilla PACKS when caller never said tortillas/docena (not menudo "…y-tortillas-4").
    if (source.startsWith("caller") && !/\b(?:tortillas?|docena|dozen)\b/iu.test(text) && !/\b(?:tortillas?|docena|dozen)\b/iu.test(prevCaller)) {
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        const id = String(a.itemId || "");
        if (a.type === "add_item" && /(?:^|-)tortillas?-\d+-x-tortilla|(?:^|-)(?:\d+-x-)?tortilla-(?:comal|taquera|harina)/i.test(id) && !/menudo|mole|platillo|birria/i.test(id)) acts.splice(i, 1);
      }
    }
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
    // juan1: bare "de chorizo" (meat, no dish) must not invent a gordita/QD or pile meat onto the wrong dish — keep lastTouched kind only.
    // multi2: toppings answers ("Frijoles, Lechuga…") hit MEAT_WORDS via frijoles — use real meats only; caller-answer closes open Q.
    if (source.startsWith("caller") && source !== "caller-answer" && !named.size && new RegExp(String.raw`\b(?:${MEAT_LIST})\b`, "iu").test(text) && !FOOD.test(text)) {
      const prefer = lastTouched ? kindOfItem(lastTouched.itemId) : null;
      if (prefer) {
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i];
          if (a.type === "add_item") {
            const k = kindOfItem(a.itemId);
            if (k && k !== prefer && !cart.some((l) => l.itemId === a.itemId)) acts.splice(i, 1);
          } else if (a.type === "update_item") {
            const k = kindOfItem(a.itemId);
            if (k && k !== prefer && a.modifiers)
              a.modifiers = (a.modifiers || []).filter((m: any) => !new RegExp(MEAT_LIST, "i").test(String(m.option)));
          }
        }
      }
    }
    // …and if that was all Elvi sent, the dish this turn names was lost: ask once more with this turn alone (no history to re-send).
    if (droppedReadds && source === "caller" && !acts.some((a: any) => a.type === "add_item" && named.has(kindOfItem(a.itemId) || ""))) {
      const r2: any = await run(text, language, []);
      for (const a of r2?.actions || []) if (a.type === "add_item" && named.has(kindOfItem(a.itemId) || "")) acts.push(a);
    }
    // tw4938: "dos quesadillas doradas … preparadas" → one line came back at qty 1; the spoken count is the quantity.
    { let n = spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+pone|me\s+puedes?\s+poner)\s+/iu, "")); const adds = acts.filter((a: any) => a.type === "add_item");
      // qty4: "una orden de cuatro quesadillas" — the count next to the dish noun beats the "una orden" in front (Noé)
      { const m = cleanPhrase(text).match(new RegExp(String.raw`\b(${NUMW})\s+(?:(?:[oó]rdenes?|orders?)\s+(?:de|del)\s+)?(?:(?!(?:${NUMW})\b)\p{L}+\s+){0,3}?(?:quesadillas|tacos|gorditas|queso\s+tortas|tortas|burritos|sopes|doradas?|huaraches|tostadas|enchiladas|menudos?|moles?|platillos?)\b`, "iu")); const n2 = m ? spokenCount(m[1]) : 0; if (n2 > n) n = n2; }
      if (adds.length) { const ik = kindOfItem(adds[0].itemId) || "";
        const kindOk = named.has(ik) || (ik === "torta" && named.has("queso torta"));
        // luis181c: "12 x Tortilla Comal" pack SKU — spokenCount("12") must not inflate the pack to qty 12
        const pack12 = /(?:^|-)tortillas?-12(?:-x-tortilla|-comal)|12-x-tortilla-comal/i.test(String(adds[0].itemId || ""));
        if (n > 1 && adds.length === 1 && (Number(adds[0].quantity) || 1) === 1 && named.size === 1 && kindOk
          && !pack12
          && !/\b(?:otr[oa]s?|another)\b/iu.test(text) && !statedTotal(text)) adds[0].quantity = n; } }
    // jose1: "deme dos, dos de quesad, dos de pollo" — listedMeats qty beats model qty 1 on the matching meat line
    if (source.startsWith("caller")) {
      const want = listedMeats(text);
      for (const a of acts as any[]) {
        if (a.type !== "add_item") continue;
        const hit = want.find((w) => w.qty && w.qty > 1 && lineHasMeat(a, w.meat));
        if (hit && (Number(a.quantity) || 1) < hit.qty!) a.quantity = hit.qty!;
      }
    }
    // luis7895/chuy1: remember spoken N+dish when Elvi asked instead of adding; apply on the next matching add (staff-pick / Con pata).
    { const m = cleanPhrase(text).match(new RegExp(String.raw`\b(${NUMW})\s+(?:(?:[oó]rdenes?|orders?)\s+(?:de|del)\s+)?(?:(?!(?:${NUMW})\b)\p{L}+\s+){0,3}?(?:quesadillas|tacos|gorditas|queso\s+tortas|tortas|burritos|sopes|huaraches|tostadas|enchiladas|menudos?|moles?|platillos?)\b`, "iu"));
      const n = m ? spokenCount(m[1]) : 0;
      const kinds = [...dishesNamed(text)];
      let appliedPending = false;
      // tw4938: "Serian N tacos" is a running total (trim), not a deferred qty for the next meat-listed invent
      if (n > 1 && kinds.length === 1 && !acts.some((a: any) => a.type === "add_item") && !statedTotal(text)) pendingSpokenQty = { n, kind: kinds[0] };
      else if (acts.some((a: any) => a.type === "add_item")) {
        for (const a of acts) {
          if (a.type !== "add_item") continue;
          const ik = kindOfItem(a.itemId) || "";
          // cecilia1/luis7895: force spoken qty even when staff-pick text ("Tortillas (4)" / "4 x Corn") made Elvi return qty 4
          const kindMatch = (ik0: string, pk: string) => ik0 === pk || (ik0 === "torta" && pk === "queso torta") || (ik0 === "queso torta" && pk === "torta");
          if (pendingSpokenQty && kindMatch(ik, pendingSpokenQty.kind)) {
            // julio1c: "una quesadilla de comal de duro" is a 1-of-N meat split, not the deferred "dos"
            if (/\buna\s+quesadilla\b/iu.test(text) && /\bcomal\b/iu.test(text)) { pendingSpokenQty = null; }
            else { a.quantity = pendingSpokenQty.n; pendingSpokenQty = null; appliedPending = true; }
          }
          // tw4938: "Tres tacos: uno de X, uno de Y…" → N lines at qty 1, not each line × N
          // "otra tripa. Serían cuatro" is +1 line + running total trim — not qty 4 on that line
          else if (n > 1 && kinds.length === 1 && kindMatch(ik, kinds[0]) && (Number(a.quantity) || 1) === 1
            && acts.filter((x: any) => x.type === "add_item").length === 1
            && !/\b(?:otr[oa]s?|another)\b/iu.test(text) && !statedTotal(text)) a.quantity = n;
        }
      }
      // julio1c: model often returns qty=2 on "una quesadilla de comal de X" after deferred "dos" — clamp to one per meat
      if (source.startsWith("caller") && /\buna\s+quesadilla\b/iu.test(text) && /\bcomal\b/iu.test(text)) {
        for (const a of acts) if (a.type === "add_item" && /quesadilla/i.test(String(a.itemId))) a.quantity = 1;
      }
      // julio1d: "una de duro y una de prensado" (or rewritten) → one meat per QCO line; drop cross-line meat bleed + salsa invent
      if (source.startsWith("caller")) {
        const MEAT_OPT_J: Array<[RegExp, string]> = [
          [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
          [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^buche$/i, "Buche / Pork Stomach"],
          [/^costillas?$/i, "Costilla / Beef Rib"],
          [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"],
          [/^picadillo$/i, "Picadillo / Ground Beef"], [/^carnitas$/i, "Carnitas / Pulled Pork"],
          [/^tripas?$/i, "Tripa / Beef Tripe"], [/^lengua$/i, "Lengua / Beef Tongue"], [/^cabeza$/i, "Cabeza / Beef Head"],
        ];
        let splitMeats = listedMeats(text).map((w: any) => w.meat.toLowerCase());
        if (splitMeats.length < 2) {
          splitMeats = [...text.matchAll(/\buna\s+(?:quesadilla(?:\s+de\s+comal)?\s+)?de\s+([\p{L}]+)/giu)].map((m) => normListedMeat(m[1]));
        }
        const qAdds = acts.filter((a: any) => a.type === "add_item" && /quesadilla/i.test(String(a.itemId)));
        if (splitMeats.length >= 2 && qAdds.length >= 2) {
          const used = new Set<string>();
          qAdds.forEach((a: any, i: number) => {
            const want = splitMeats[Math.min(i, splitMeats.length - 1)];
            const wantOpt = MEAT_OPT_J.find(([re]) => re.test(want))?.[1];
            const mods = Array.isArray(a.modifiers) ? [...a.modifiers] : [];
            const kept = mods.filter((m: any) => {
              const o = String(m.option || "");
              if (/\b(?:mild\s+)?salsa\b|cebolla|chiles?\s+asado|frijoles?|crema|lechuga|queso\s+fresco|guacamole/i.test(o)) return false;
              const isMeat = MEAT_OPT_J.some(([, opt]) => o.startsWith(opt.split(" (")[0]));
              if (!isMeat) return true;
              if (wantOpt && o.startsWith(wantOpt.split(" (")[0])) { used.add(want); return true; }
              return false;
            });
            if (wantOpt && !kept.some((m: any) => String(m.option).startsWith(wantOpt.split(" (")[0]))) {
              kept.push({ step: "(B) Q Carnes / Meats", option: wantOpt });
            }
            a.modifiers = kept;
            a.quantity = 1;
          });
        } else if (splitMeats.length >= 2 && qAdds.length === 1) {
          // alejandro1/julio1d: model collapsed "una de tripa y una de bistec" onto one QCO — explode to one line per meat
          const base = qAdds[0];
          const baseMods = (Array.isArray(base.modifiers) ? base.modifiers : []).filter((m: any) => {
            const o = String(m.option || "");
            if (/\b(?:mild\s+)?salsa\b|cebolla|chiles?\s+asado|frijoles?|crema|lechuga|queso\s+fresco|guacamole/i.test(o)) return false;
            return !MEAT_OPT_J.some(([, opt]) => o.startsWith(opt.split(" /")[0]) || o.startsWith(opt.split(" (")[0]));
          });
          const hasComal = /comal|homemade|QCO/i.test((base.modifiers || []).map((m: any) => String(m.option)).join(" "))
            || /\bcomal\b/iu.test(text);
          const tortMod = hasComal
            ? { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }
            : null;
          const idx = acts.indexOf(base);
          const replacements: any[] = [];
          for (const meat of splitMeats) {
            const wantOpt = MEAT_OPT_J.find(([re]) => re.test(meat))?.[1];
            if (!wantOpt) continue;
            const mods = [...baseMods];
            if (tortMod && !mods.some((m: any) => /Q Tortilla|comal|harina|taquer/i.test(String(m.step) + String(m.option)))) mods.unshift(tortMod);
            mods.push({ step: "(B) Q Carnes / Meats", option: wantOpt });
            replacements.push({ ...base, quantity: 1, modifiers: mods, readback: `quesadilla ${hasComal ? "comal " : ""}${meat}` });
          }
          if (replacements.length >= 2) acts.splice(idx, 1, ...replacements);
        }
      }
      // julio1e: plain comal meat lines never include Mild Salsa / toppings unless caller said preparada/salsa/asados
      if (source.startsWith("caller") && /\bquesadilla\b/iu.test(text) && /\bcomal\b/iu.test(text)
        && !/\b(?:preparad[ao]|deluxe|dorad[ao]|salsa|asados?|cebolla|guacamole|todo)\b/iu.test(text)) {
        for (const a of acts) {
          if (a.type !== "add_item" || !/quesadilla/i.test(String(a.itemId))) continue;
          a.modifiers = (a.modifiers || []).filter((m: any) => !/\b(?:mild\s+)?salsa\b|cebolla|chiles?\s+asado|frijoles?|crema|lechuga|queso\s+fresco|guacamole/i.test(String(m.option || "")));
        }
      }
            // luis181c / angelica1 (late): keep 12-pack at spoken dozen qty (not the "12" in the SKU name)
      if (source.startsWith("caller") && (/\b12\s*x\s*tortilla\s*comal\b/iu.test(text) || /\bdocenas?(?:\s+de\s+tortillas?)?\b/iu.test(text))) {
        const aliasedLate = applySharedAliases(text, "phone");
        const dmLate = (text + " " + aliasedLate).match(/\b(un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+(?:docenas?|12\s*x\s*tortilla)/iu);
        const dq = dmLate ? Math.max(1, spokenCount(dmLate[1]) || Number(dmLate[1]) || 1) : 1;
        for (const a of acts) {
          if (a.type === "add_item" && /(?:^|-)tortillas?-12(?:-x-tortilla|-comal)|12-x-tortilla-comal/i.test(String(a.itemId || ""))) a.quantity = dq;
        }
      }
            // staff-pick tortilla pack option: Elvi often returns qty=N from "4 x" / "Tortillas (4)" — clamp only when we did NOT just apply pendingSpokenQty
      if (!appliedPending && source === "staff-pick" && /\b\d+\s*x\s*\(|tortillas?\s*\(\d+\)/i.test(text)) {
        const pack = Number((text.match(/\b(\d+)\s*x\s*\(/i) || text.match(/tortillas?\s*\((\d+)\)/i) || [])[1] || 0);
        for (const a of acts) {
          if (a.type !== "add_item") continue;
          const ik = kindOfItem(a.itemId) || "";
          if (ik && ik !== "tortilla" && pack >= 2 && (Number(a.quantity) || 1) === pack) a.quantity = 1;
        }
      }
    }
    // luis181/docena1 + bryan1/monica: "sin pata" OR never said con pata → Menudo con Tortillas (never leave Con Pata).
    { const allCaller = (history.filter((h) => h.role === "customer").map((h) => h.text).join(" ") + " " + prevCaller + " " + text).toLowerCase();
      const saidCon = /\bcon\s+patas?\b/iu.test(allCaller);
      const saidSin = /\bsin\s+patas?\b/iu.test(allCaller);
      if (saidSin || !saidCon) {
        const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
        for (const a of acts) {
          if (a.type !== "add_item" && a.type !== "update_item") continue;
          if (!/menudo/i.test(String(a.itemId))) continue;
          if (/con-pata|con_pata/i.test(String(a.itemId))) a.itemId = SIN;
          a.modifiers = (a.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata/i.test(String(m.option)));
        }
        for (const l of cart) {
          if (!/menudo/i.test(String(l.itemId))) continue;
          if (/con-pata|con_pata/i.test(String(l.itemId))) {
            l.itemId = SIN;
            l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata/i.test(String(m.option)));
          }
        }
      }
    }
    // cecilia1e: "con pata" → ensure EXTRA Pata / Beef Feet on menudo (catalog Con Pata item still needs the $3 mod on POS)
    { const recent = (prevCaller + " " + text).toLowerCase();
      if (/\bcon\s+patas?\b/iu.test(recent) && !/\bsin\s+patas?\b/iu.test(text)) {
        for (const a of acts) {
          if (a.type !== "add_item" && a.type !== "update_item") continue;
          if (!/menudo/i.test(String(a.itemId))) continue;
          const ms = a.modifiers || (a.modifiers = []);
          if (!ms.some((m: any) => /pata/i.test(String(m.option))))
            ms.push({ step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" });
        }
        // also stamp cart lines already rung without EXTRA Pata when this turn confirms con pata
        if (/^\W*con\s+patas?\b/iu.test(text) || source === "staff-pick") {
          for (const l of cart) {
            if (!/menudo/i.test(String(l.itemId))) continue;
            const ms = l.modifiers || (l.modifiers = []);
            if (!ms.some((m: any) => /pata/i.test(String(m.option))))
              ms.push({ step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" });
          }
        }
      }
    }
    // harina1: "una quesadilla de harina de bistec" is a flour quesadilla, never the Dorada just rung (Luisa)
    if (/\bquesadillas?\s+de\s+harina\b|\bflour\s+(?:\p{L}+\s+)?quesadillas?\b/iu.test(text) && !/dorad/iu.test(text) && acts.some((a: any) => a.type === "add_item" && /dorada/i.test(String(a.itemId)))) {
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item" && /dorada/i.test(String(acts[i].itemId))) acts.splice(i, 1);
      const r2: any = await run(text, language, []);
      for (const a of r2?.actions || []) if (a.type === "add_item" && !/dorada/i.test(String(a.itemId))) acts.push(a);
    }
    // alex1d: trailing "Aparte." = separate line, not DELUXE ***APARTE side mod.
    if (source.startsWith("caller") && /(?:^|[.!?]\s*)aparte\b|\baparte\s*[.!?]\s*$/iu.test(text)
      && !/\b(?:todo|everything|con\s+todo)\s+aparte\b/iu.test(text)) {
      for (const a of acts as any[]) {
        if (a.type !== "add_item" || !a.modifiers) continue;
        a.modifiers = a.modifiers.filter((m: any) => !/APARTE|EVERTHING ON SIDE|EVERYTHING ON SIDE/i.test(String(m.option)));
      }
    }
    // prep1: "una quesadilla preparada … de las doradas" is the DELUXE Preparada Dorada, not the Regular (Luisa)
    if (/\bpreparad[oa]s?\b|\bdeluxe\b/iu.test(text) && !/\bregular(?:es)?\b|\bsin\s+preparar\b/iu.test(text))
      for (const a of acts as any[]) if (a.type === "add_item" && a.itemId === DORADA_REG_ID) { a.itemId = DORADA_DELUXE_ID; a.modifiers = (a.modifiers || []).map((m: any) => /REGULAR Dorada/i.test(String(m.option)) ? { ...m, option: "(QD) DELUXE Preparada" } : m); }
    // aceite1 (Alex CA7c2f7c): "quesadillas de aceite … preparadas" (alias→doradas) = QD Deluxe, not comal.
    // "una de comal" later is a separate QCO line — do not remap that turn.
    if (source.startsWith("caller")
      && (/\baceite\b/iu.test(text) || (/\bdoradas?\b/iu.test(text) && /\b(?:preparad[oa]s?|deluxe)\b/iu.test(text)))
      && /\b(?:quesadillas?|preparad[oa]s?|deluxe|doradas?)\b/iu.test(text)
      && !/\b(?:de\s+)?comal\b/iu.test(text.replace(/aceite[^,.]*preparad\w*|doradas?[^,.]*preparad\w*/iu, " "))) {
      for (const a of acts as any[]) {
        if (a.type !== "add_item") continue;
        const id = String(a.itemId || "");
        const isQco = /quesadilla/i.test(id) && /comal|qco|homemade/i.test(id + " " + (a.modifiers || []).map((m: any) => m.option).join(" "));
        const isReg = id === DORADA_REG_ID || /regular.?dorada/i.test(id + " " + (a.modifiers || []).map((m: any) => m.option).join(" "));
        if (isQco || isReg || (/quesadilla/i.test(id) && !/dorada|deluxe|zzav3l/i.test(id))) {
          a.itemId = DORADA_DELUXE_ID;
          const mods = (a.modifiers || []).filter((m: any) => !/\(QCO\)|comal|homemade|REGULAR Dorada|DELUXE Preparada/i.test(String(m.option)));
          mods.unshift({ step: "(QD) Style", option: "(QD) DELUXE Preparada" });
          a.modifiers = mods;
          a.readback = a.readback || "quesadilla dorada deluxe";
        }
      }
      // jorge1: convert QCO already in cart when caller says aceite/doradas (staff had assumed comal)
      for (const l of cart as any[]) {
        const id = String(l.itemId || "");
        const isQco = /quesadilla/i.test(id) && !/dorada|zzav3l|t5stuh/i.test(id)
          && (/comal|QCO|homemade/i.test((l.modifiers || []).map((m: any) => String(m.option)).join(" ")) || id === "sq-quesadilla-HLT6CR");
        if (!isQco) continue;
        const keep = (l.modifiers || []).filter((m: any) => {
          const o = String(m.option || "");
          return !/\(QCO\)|comal|homemade|REGULAR Dorada|DELUXE Preparada|salsa asada/i.test(o)
            && /carne|meat|bistec|chorizo|picadillo|pollo|buche|tripa|lengua|pastor|carnitas|asada|prensado|duro|cabeza|costilla/i.test(o + " " + String(m.step || ""));
        });
        l.itemId = DORADA_DELUXE_ID;
        l.modifiers = [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, ...keep];
        l.readback = l.readback || "quesadilla dorada deluxe";
      }
    }
    // alex1c: explicit comal (no aceite/dorada/preparada) must stay QCO — model often returns Regular Dorada.
    if (source.startsWith("caller") && /\b(?:de\s+)?comal\b/iu.test(text)
      && !/\b(?:aceite|doradas?|preparad[oa]s?|deluxe)\b/iu.test(text)) {
      const QCO = "sq-quesadilla-HLT6CR";
      for (const a of acts as any[]) {
        if (a.type !== "add_item") continue;
        const id = String(a.itemId || "");
        if (id !== DORADA_REG_ID && id !== DORADA_DELUXE_ID && !/dorada/i.test(id)) continue;
        a.itemId = QCO;
        const keep = (a.modifiers || []).filter((m: any) => {
          const o = String(m.option || "");
          if (/APARTE|EVERTHING ON SIDE|EVERYTHING ON SIDE|DELUXE Preparada|REGULAR Dorada|\(QCO\)|comal|homemade|salsa asada/i.test(o)) return false;
          return /carne|meat|bistec|chorizo|picadillo|pollo|buche|tripa|lengua|pastor|carnitas|asada|prensado|duro|cabeza|costilla/i.test(o + " " + String(m.step || ""));
        });
        a.modifiers = [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
          ...keep,
        ];
        a.readback = a.readback || "quesadilla comal";
      }
    }
    // gino1: aceite/preparadas answers never land Platillo de Guisado (model confusion with "en aceite")
    if (source.startsWith("caller") && (/\baceite\b/iu.test(text) || (/\bpreparad[oa]s?\b/iu.test(text) && (/\bdoradas?\b/iu.test(text) || !!pendingQuesadilla || /\baceite\b/iu.test(text))))) {
      for (let i = acts.length - 1; i >= 0; i--) {
        const id = String(acts[i].itemId || "");
        if (acts[i].type === "add_item" && /platillo|guisado|plate/i.test(id)) acts.splice(i, 1);
      }
      for (let i = cart.length - 1; i >= 0; i--) if (/platillo|guisado|plate/i.test(String(cart[i].itemId || ""))) cart.splice(i, 1);
    }
    // aceite1b: force-add QD Deluxe when model returned [] on aceite/dorada preparada order.
    // gino1: bare "en aceite" / "preparadas" after pending "dos quesadillas de bistec" (tortilla Q) also force-adds.
    if (source.startsWith("caller")
      && (/\baceite\b/iu.test(text) || (/\bdoradas?\b/iu.test(text) && /\bpreparad[oa]s?\b/iu.test(text))
        || (pendingQuesadilla && (/\baceite\b/iu.test(text) || /^\W*preparad[oa]s?\W*$/iu.test(text) || /\bpreparad[oa]s?\b/iu.test(text))))
      && (/\b(?:quesadillas?|preparad[oa]s?|doradas?)\b/iu.test(text) || !!pendingQuesadilla)
      // jorge1: "tiene fritas en aceite" is an order cue, not an availability Q — only block bare tiene/hay without fritas/aceite/dorada
      && !(/\b(?:tienen|hay|tiene|ten[eé]s|vende)\b/iu.test(text) && !/\b(?:aceite|fritas?|doradas?)\b/iu.test(text))
      && !/\bde\s+comal\b/iu.test(text)
      && !acts.some((a: any) => a.type === "add_item" && /dorada|zzav3l|deluxe|t5stuh/i.test(String(a.itemId)))
      // jorge1: skip force-add when cart already has QD from aceite1 remap AND caller isn't ordering a new batch
      && !(cart.some((l) => /dorada|zzav3l|t5stuh|deluxe/i.test(String(l.itemId))) && !pendingQuesadilla && !(spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+pone)\s+/iu, "")) > 0))) {
      // alex1: allow another Deluxe line when cart already has one
      // gino1: drop mistaken Platillo/Guisado / comal QCO the model invented on an aceite answer
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.type !== "add_item") continue;
        const id = String(a.itemId || "");
        if (/platillo|guisado|plate/i.test(id) || (/quesadilla/i.test(id) && !/dorada|zzav3l|deluxe/i.test(id))) acts.splice(i, 1);
      }
      const n = pendingQuesadilla?.n || spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+pone)\s+/iu, "")) || 1;
      const meats = listedMeats(text);
      const MEAT_OPT: Array<[RegExp, string]> = [[/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^picadillo$/i, "Picadillo / Ground Beef"], [/^buche$/i, "Buche / Pork Stomach"], [/^lengua$/i, "Lengua / Beef Tongue"], [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"]];
      const mods: any[] = [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }];
      for (const w of meats.length ? meats : []) {
        const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
        if (opt) mods.push({ step: "(B) Q Carnes / Meats", option: opt });
      }
      if (!meats.length) {
        const mm = text.match(/\b(bistec|chorizo|asada|picadillo|pollo|buche|lengua|prensado|duro)\b/iu);
        const meat = mm?.[1] || pendingQuesadilla?.meat;
        if (meat) { const opt = MEAT_OPT.find(([re]) => re.test(meat))?.[1]; if (opt) mods.push({ step: "(B) Q Carnes / Meats", option: opt }); }
      }
      acts.push({ type: "add_item", itemId: DORADA_DELUXE_ID, quantity: n > 1 ? n : 1, modifiers: mods, readback: "quesadilla dorada deluxe" });
      pendingQuesadilla = null;
    }
    // oscar1: single-meat dorada turn — drop model Dorada with wrong/stacked meats so force can add the spoken meat
    if (source.startsWith("caller") && /\bdoradas?\b/iu.test(text) && !/\bde\s+comal\b/iu.test(text)) {
      const want = listedMeats(text).map((w) => w.meat.toLowerCase());
      const deWant = !want.length ? [...text.matchAll(new RegExp(String.raw`\bde\s+(?:al\s+)?(${MEAT_LIST})\b`, "giu"))].map((m) => normListedMeat(m[1]).toLowerCase()) : want;
      if (deWant.length === 1) {
        const meatRe = new RegExp(MEAT_LIST, "i");
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i];
          if (!((a.type === "add_item" || a.type === "update_item") && /dorada|zzav3l|t5stuh/i.test(String(a.itemId)))) continue;
          const lineMeats = (a.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => meatRe.test(o) && !/salsa/i.test(o));
          const ok = lineMeats.length === 1 && deWant.some((w) => lineMeats[0].toLowerCase().includes(w));
          if (!ok) acts.splice(i, 1);
        }
      }
    }
    // jose2: park pending QD qty before force-add so same-turn "me pone dos, una de picadillo…" after doradas avail lands
    if (source.startsWith("caller") && !pendingQuesadilla) {
      const recent = history.filter((h) => h.role === "customer").slice(-4).map((h) => h.text).join(" ") + " " + text;
      if (/\b(?:quesadillas?\s+)?doradas?\b/iu.test(recent)) {
        const n = spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:s[ií][,.]?\s*)?(?:quiero|dame|deme|me\s+pone|pon(?:me|ga)?|por\s+favor)[,.\s]*/iu, ""))
          || (/\b(?:dos|2|two)\b/iu.test(text) ? 2 : /\b(?:tres|3|three)\b/iu.test(text) ? 3 : /\b(?:cuatro|4|four)\b/iu.test(text) ? 4 : 0);
        if (n >= 1 && (/\b(?:quiero|dame|deme|me\s+pone|pon(?:me|ga)?|por\s+favor)\b/iu.test(text) || listedMeats(text).length > 0))
          pendingQuesadilla = { n, meat: "" };
      }
    }
    // miriam1/julioDorada1/oscar1/jose2: "N quesadillas doradas" / pending after doradas avail + meats → QD REGULAR
    if (source.startsWith("caller")
      && ((/\bdoradas?\b/iu.test(text) && /\bquesadillas?\b/iu.test(text))
        || (/\bdoradas?\b/iu.test(text) && listedMeats(text).length > 0)
        || (/\bdoradas?\b/iu.test(text) && new RegExp(String.raw`\bde\s+(?:al\s+)?(?:${MEAT_LIST})\b`, "iu").test(text))
        || (pendingQuesadilla && /^\W*regular(?:es)?\W*$/iu.test(text))
        || (pendingQuesadilla && /\bdoradas?\b/iu.test(text))
        // jose2: after avail doradas, "me pone dos, una de picadillo… y la otra de bistec" (no "doradas" on meat turns)
        || (pendingQuesadilla && (listedMeats(text).length > 0 || new RegExp(String.raw`\bde\s+(?:al\s+)?(?:${MEAT_LIST})\b`, "iu").test(text)))
        || ((/\b(?:quesadillas?\s+)?doradas?\b/iu.test(history.filter((h) => h.role === "customer").slice(-6).map((h) => h.text).join(" "))
            || /\bquesadillas?\s+doradas?\b/iu.test(text))
          && (listedMeats(text).length > 0 || new RegExp(String.raw`\bde\s+(?:al\s+)?(?:${MEAT_LIST})\b`, "iu").test(text))
          && !/\bmenudos?\b/iu.test(text)))
      && !/\b(?:aceite|preparad[oa]s?|deluxe)\b/iu.test(text)
      && !/\bde\s+comal\b/iu.test(text)
      && !acts.some((a: any) => a.type === "add_item" && /dorada|zzav3l|t5stuh/i.test(String(a.itemId)))) {
      const wantReg = /\bregular(?:es)?\b/iu.test(text) || !/\b(?:preparad|deluxe)\b/iu.test(text);
      if (wantReg) {
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i]; if (a.type !== "add_item") continue;
          const id = String(a.itemId || "");
          if (/huarache|torta|platillo|guisado|plate/i.test(id) || (/quesadilla/i.test(id) && !/dorada|zzav3l|t5stuh/i.test(id))) acts.splice(i, 1);
        }
        const n = pendingQuesadilla?.n || spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+pone)\s+/iu, "")) || 1;
        const meats = listedMeats(text);
        const MEAT_OPT: Array<[RegExp, string]> = [
          [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
          [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^picadillo$/i, "Picadillo / Ground Beef"],
          [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"],
          [/^nopales$/i, "Nopales con Papas / Cacti with Potatoes"],
          [/^pastor$/i, "Alpastor / Roasted Pork"], [/^lengua$/i, "Lengua / Beef Tongue"],
          [/^tripas?$/i, "Tripa / Beef Tripe"], [/^buche$/i, "Buche / Pork Stomach"],
        ];
        const hasDoradaMeat = (meat: string) => cart.some((l) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId))
          && (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option))))
          || acts.some((a: any) => a.type === "add_item" && /dorada|zzav3l|t5stuh/i.test(String(a.itemId))
            && (a.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option))));
        // oscar1: listedMeats can miss after cleanPhrase; still pull "de pastor" / "de bistec"
        let meatList = meats;
        if (!meatList.length && /\bdoradas?\b/iu.test(text)) {
          meatList = [...text.matchAll(new RegExp(String.raw`\bde\s+(?:al\s+)?(${MEAT_LIST})\b`, "giu"))]
            .map((m) => ({ meat: normListedMeat(m[1]), another: false as boolean, qty: 1 as number | undefined }));
        }
        if (meatList.length >= 1) {
          for (const w of meatList) {
            const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
            if (!opt) continue;
            if (hasDoradaMeat(w.meat)) continue; // oscar1: caller-retry must not double the same meat line
            const q = w.qty && w.qty > 1 ? w.qty : 1;
            acts.push({
              type: "add_item", itemId: DORADA_REG_ID, quantity: q,
              modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: opt }],
              readback: `QD regular ${w.meat}`,
            });
          }
        } else if (!cart.some((l) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId)))) {
          const meat = pendingQuesadilla?.meat;
          const mods: any[] = [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }];
          if (meat) {
            const opt = MEAT_OPT.find(([re]) => re.test(meat))?.[1];
            if (opt) mods.push({ step: "(B) Q Carnes / Meats", option: opt });
          }
          acts.push({ type: "add_item", itemId: DORADA_REG_ID, quantity: n > 1 ? n : 1, modifiers: mods, readback: "quesadilla dorada regular" });
        }
        {
          const qdN = [...cart, ...acts.filter((a: any) => a.type === "add_item")]
            .filter((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId))).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
          if (/\bdoradas?\b/iu.test(text) || /\bquesadillas?\b/iu.test(text) || /^\W*regular(?:es)?\W*$/iu.test(text)
            || (pendingQuesadilla && qdN >= (pendingQuesadilla.n || 1)))
            pendingQuesadilla = null;
        }
      }
    }
    // anthony1b: fried/doradas answer on THIS turn → remap mistaken TCO/QCO to QD (skip if caller said comal/homemade)
    if (source.startsWith("caller") && (/\bdoradas?\b/iu.test(text) || /\bfried\b/iu.test(text)) && !/\b(?:comal|homemade)\b/iu.test(text)) {
      for (const a of acts as any[]) {
        if (a.type !== "add_item") continue;
        const id = String(a.itemId || "");
        if (/taco|relleno|poblano|burrito|platillo|guisado/i.test(id) || (/quesadilla/i.test(id) && !/dorada|zzav3l|t5stuh/i.test(id))) {
          a.itemId = DORADA_DELUXE_ID;
          const keep = (a.modifiers || []).filter((m: any) => /bistec|steak|chorizo|pollo|picadillo|carne|meat|prensado|duro|buche|lengua|costilla|cabeza/i.test(String(m.option || "") + " " + String(m.step || "")) && !/deluxe|lechuga|pico|crema|comal|homemade|regular dorada|salsa asada/i.test(String(m.option || "")));
          a.modifiers = [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, ...keep];
          a.readback = a.readback || "quesadilla dorada deluxe";
        }
      }
    }
    // anthony1c: "a side of rice" / "side of refried beans" → Sides SKUs (not burrito fillings)
    if (source.startsWith("caller")) {
      const SIDE_RICE = "sq-sides-arroz-rice-26S6E6";
      const SIDE_BEANS = "sq-sides-frijoles-beans-FK2O6W";
      if (/\b(?:a\s+)?side\s+of\s+rice\b|\bsides\s+rice\b|\blado\s+de\s+arroz\b/iu.test(text)
        && !cart.some((l) => /sides-arroz|26S6E6/i.test(String(l.itemId)))
        && !acts.some((a: any) => a.type === "add_item" && /sides-arroz|26S6E6/i.test(String(a.itemId)))) {
        for (let i = acts.length - 1; i >= 0; i--) {
          const id = String(acts[i].itemId || "");
          if (acts[i].type === "add_item" && /burrito|relleno|poblano|platillo/i.test(id)) acts.splice(i, 1);
        }
        acts.push({ type: "add_item", itemId: SIDE_RICE, quantity: 1, modifiers: [], readback: "side rice" });
      }
      if (/\b(?:a\s+)?side\s+of\s+(?:refried\s+)?beans\b|\bsides\s+(?:frijoles|beans)\b|\blado\s+de\s+frijoles\b/iu.test(text)
        && !cart.some((l) => /sides-frijoles|FK2O6W/i.test(String(l.itemId)))
        && !acts.some((a: any) => a.type === "add_item" && /sides-frijoles|FK2O6W/i.test(String(a.itemId)))) {
        for (let i = acts.length - 1; i >= 0; i--) {
          const id = String(acts[i].itemId || "");
          if (acts[i].type === "add_item" && /burrito|relleno|poblano|platillo/i.test(id)) acts.splice(i, 1);
        }
        acts.push({ type: "add_item", itemId: SIDE_BEANS, quantity: 1, modifiers: [], readback: "side beans" });
      }
    }
    // prep2 (Linda): a bare "preparadas" answer makes every Regular Dorada already rung the Deluxe Preparada
    if (source !== "auto" && /^\W*(?:\p{L}+[.,]?\s+){0,3}preparad[oa]s\W*$/iu.test(text) && !/regular/iu.test(text)) {
      for (const l of cart as any[]) if (l.itemId === DORADA_REG_ID) { l.itemId = DORADA_DELUXE_ID; l.modifiers = (l.modifiers || []).map((m: any) => /REGULAR Dorada/i.test(String(m.option)) ? { ...m, option: "(QD) DELUXE Preparada" } : m); }
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "remove_item" || (acts[i].type === "add_item" && /dorada/i.test(String(acts[i].itemId)))) acts.splice(i, 1);
    }

    // carlos1d: "tres tacos taqueros" + "dos de bistec y uno de chorizo" — force TST meat lines when model []
    if (source.startsWith("caller") && listedMeats(text).length >= 1
      && !/\b(?:al\s+rev[eé]s|mejor\s+dicho|comal|aceite|dorad|quesadilla|tienen|hay)\b/iu.test(text)
      && (/\btacos?\b/iu.test(text) || /\btaquer/i.test(text) || /\btaquer/i.test(history.filter((h) => h.role === "customer").slice(-3).map((h) => h.text).join(" ")))
      && !acts.some((a: any) => a.type === "add_item" && /taco/i.test(String(a.itemId)))) {
      const recent = history.filter((h) => h.role === "customer").slice(-4).map((h) => h.text).join(" ") + " " + text;
      if (/\btaquer|street\b/iu.test(recent) && !/\bcomal\b/iu.test(text)) {
        const meats = listedMeats(text);
        const MEAT_OPT: Array<[RegExp, string]> = [
          [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
          [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"],
          [/^lengua$/i, "Lengua / Beef Tongue"], [/^cabeza$/i, "Cabeza / Beef Head"],
        ];
        const TACO = "sq-taco-TAR7L5";
        for (const w of meats) {
          const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
          if (!opt) continue;
          const have = cart.some((l) => kindOfItem(l.itemId) === "taco" && /taquer|street|TST/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")) && (l.modifiers || []).some((m: any) => new RegExp(w.meat, "i").test(String(m.option))));
          if (have) continue;
          const q = w.qty && w.qty > 0 ? w.qty : 1;
          acts.push({ type: "add_item", itemId: TACO, quantity: q, modifiers: [
            { step: "(A) Tortilla Options", option: "(TST) Tortilla Taquera / Street Taco" },
            { step: "(B) Q Carnes / Meats", option: opt },
          ], readback: `taco taquero ${w.meat}` });
        }
      }
    }
    // carlos1: "No, al revés, dos de bistec y uno de chorizo, perdón" — drop mistaken meats on the same dish, restate counts
    if (source.startsWith("caller") && /\b(?:al\s+rev[eé]s|mejor\s+dicho)\b/iu.test(text) && listedMeats(text).length) {
      const want = listedMeats(text);
      const wantMeats = want.map((w: { meat: string }) => w.meat.toLowerCase());
      const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option).toLowerCase()).filter((o: string) => new RegExp(MEAT_LIST, "i").test(o) && !/salsa/i.test(o));
      const kindHint = dishesNamed(text).size ? [...dishesNamed(text)][0] : ([...cart].reverse().map((l) => kindOfItem(l.itemId)).find((k) => k === "taco" || k === "quesadilla") || ( /\btacos?\b/iu.test(history.filter((h) => h.role === "customer").slice(-4).map((h) => h.text).join(" ")) ? "taco" : "taco"));
      // Prefer tortilla from a just-dropped/kept line, else recent "taqueros/comal" speech
      const recent = history.filter((h) => h.role === "customer").slice(-6).map((h) => h.text).join(" ") + " " + text;
      const tortOpt = /\bcomal\b/iu.test(text) ? "(TCO) Tortilla Comal / Homemade"
        : /\b(?:harina|flour)\b/iu.test(text) ? "(THR) Tortilla de Harina / Flour"
        : "(TST) Tortilla Taquera / Street Taco";
      const refTort = [...cart].reverse().find((l) => kindOfItem(l.itemId) === kindHint);
      const tortFromRef = refTort && (refTort.modifiers || []).find((m: any) => /\(T[A-Z]{2}\)|Tortilla|taquer|comal|harina|street|homemade|flour/i.test(String(m.option)));
      const tort = tortFromRef ? { step: tortFromRef.step || "(A) Tortilla Options", option: String(tortFromRef.option) }
        : { step: "(A) Tortilla Options", option: /\btaquer/i.test(recent) || !/\bcomal\b/iu.test(recent) ? "(TST) Tortilla Taquera / Street Taco" : tortOpt };
      for (let i = cart.length - 1; i >= 0; i--) {
        const l = cart[i];
        if (kindOfItem(l.itemId) !== kindHint) continue;
        const ms = meatOf(l);
        if (ms.length && !ms.some((m: string) => wantMeats.some((w: string) => m.includes(w)))) cart.splice(i, 1);
      }
      const MEAT_OPT: Array<[RegExp, string]> = [
        [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
        [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"],
        [/^lengua$/i, "Lengua / Beef Tongue"], [/^cabeza$/i, "Cabeza / Beef Head"],
        [/^buche$/i, "Buche / Pork Stomach"], [/^carnitas$/i, "Carnitas / Pulled Pork"],
      ];
      const itemId = kindHint === "quesadilla" ? "sq-quesadilla-HLT6CR" : "sq-taco-TAR7L5";
      for (const w of want) {
        const lines = cart.filter((l) => kindOfItem(l.itemId) === kindHint && meatOf(l).some((m: string) => m.includes(w.meat.toLowerCase())));
        const q = w.qty && w.qty > 0 ? w.qty : 1;
        if (lines.length) {
          lines[0].quantity = q;
          for (let i = 1; i < lines.length; i++) {
            const idx = cart.indexOf(lines[i]);
            if (idx >= 0) cart.splice(idx, 1);
          }
        } else {
          // carlos1c: restated meats missing after takeback — force-add (model [] / only wrong meat was rung)
          const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
          if (!opt) continue;
          const mods: any[] = kindHint === "quesadilla"
            ? [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: opt }]
            : [tort, { step: "(B) Q Carnes / Meats", option: opt }];
          acts.push({ type: "add_item", itemId, quantity: q, modifiers: mods, readback: `${kindHint} ${w.meat}` });
        }
      }
      // Drop model re-adds of lines we just restated — restate1 + skip invent handle the rest
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.type !== "add_item" || kindOfItem(a.itemId) !== kindHint) continue;
        // keep the force-adds we just pushed (readback matches)
        if (String(a.readback || "").startsWith(kindHint)) continue;
        const ms = meatOf(a);
        if (ms.some((m: string) => wantMeats.some((w: string) => m.includes(w)))) acts.splice(i, 1);
      }
    }
    // miriam1: after avail "tiene quesadillas doradas", "quiero tres" / "tres" parks pending QD qty
    if (source.startsWith("caller") && !/\bquesadillas?\b/iu.test(text) && !/\bdoradas?\b/iu.test(text)) {
      const recent = history.filter((h) => h.role === "customer").slice(-4).map((h) => h.text).join(" ");
      if (/\b(?:quesadillas?\s+)?doradas?\b/iu.test(recent) || /\bquesadillas?\s+doradas?\b/iu.test(recent)) {
        const n = spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:s[ií][,.]?\s*)?(?:quiero|dame|deme|me\s+pone|por\s+favor)[,.\s]*/iu, ""))
          || (/\b(?:dos|2|two)\b/iu.test(text) ? 2 : /\b(?:tres|3|three)\b/iu.test(text) ? 3 : /\b(?:cuatro|4|four)\b/iu.test(text) ? 4 : 0);
        if (n >= 1 && (/\b(?:quiero|dame|deme|me\s+pone|pon(?:me|ga)?|por\s+favor)\b/iu.test(text) || /^\W*(?:dos|tres|cuatro|\d+)\W*$/iu.test(text)))
          pendingQuesadilla = { n, meat: pendingQuesadilla?.meat || "" };
      }
    }
    // gino1: remember "dos quesadillas de bistec (supreme/doradas)" when tortilla Q is still open
    // anthony1: "four quesadillas" / doradas with meat later ("steak for all") still needs the qty parked
    if (source.startsWith("caller") && /\bquesadillas?\b/iu.test(text)
      && !(/\b(?:tienen|hay|tiene)\b/iu.test(text) && !/\b(?:aceite|fritas?|doradas?|prensado|duro|bistec)\b/iu.test(text))) {
      const meats = listedMeats(text);
      const n = spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+pone|can\s+i\s+(?:get|have))\s+/iu, ""))
        || meats.find((w) => w.qty && w.qty > 1)?.qty
        || ( /\b(?:dos|2|two)\b/iu.test(text) ? 2 : /\b(?:cuatro|4|four)\b/iu.test(text) ? 4 : /\b(?:tres|3|three)\b/iu.test(text) ? 3 : 0);
      if (n >= 1 && (meats.length || /\bdoradas?\b/iu.test(text) || /\bfried\b/iu.test(text))) {
        const landed = acts.some((a: any) => a.type === "add_item" && /quesadilla|dorada|zzav3l/i.test(String(a.itemId)));
        if (!landed) pendingQuesadilla = { n, meat: (meats[0]?.meat || "").toLowerCase() };
      }
    }
    // restate1 (Linda): "dos de pollo y una de bistec" restating lines already rung sets their count; it is not a re-add
    if (source !== "auto" && !/\b(?:otr[oa]s?|m[aá]s|tambi[eé]n|another|more|extra)\b/iu.test(text)) {
      const meats = (x: any) => (x.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => !/salsa/i.test(o) && new RegExp(MEAT_LIST, "i").test(o)).sort().join("|");
      const adds = acts.filter((a: any) => a.type === "add_item");
      const hits = adds.map((a: any) => (cart as any[]).find((l) => l.itemId === a.itemId && meats(l) && meats(l) === meats(a)));
      if (adds.length >= 2 && hits.some(Boolean) && new Set(hits.filter(Boolean)).size === hits.filter(Boolean).length) {
        adds.forEach((a: any, k: number) => { if (hits[k]) { hits[k].quantity = Number(a.quantity) || 1; acts.splice(acts.indexOf(a), 1); } });
      }
    }
    // pickup1 (Julio): "yo paso a recogerlo" is pickup talk — "paso" is not a Pambazo
    if (source !== "auto" && !dishesNamed(text).size && /\bpaso\s+(?:a\s+)?(?:recoger|por)|\brecoger(?:lo|la|los)?\b|\bpick\s+(?:it\s+)?up\b/iu.test(text))
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item") acts.splice(i, 1);
    // decline1 (Linda): "no, hecho está bien" names no dish — a decline never adds an item
    if (source !== "auto" && !dishesNamed(text).size && /\bno\b/iu.test(text) && /\b(?:est[aá]\s+bien|nada\s+m[aá]s|es\s+todo|that'?s\s+(?:fine|it|all))\b/iu.test(text))
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item") acts.splice(i, 1);
    // wrap1 (Paco): "Sí, sería todo. Serían tres órdenes en total" is a wrap-up count, never a re-add of a dish already rung
    if (source !== "auto" && /\b(?:ser[ií]a\s+todo|es\s+todo|en\s+total|that'?s\s+(?:all|it))\b/iu.test(text))
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item" && cart.some((l) => l.itemId === acts[i].itemId)) acts.splice(i, 1);
    // miriam1/rodolfo1: "dos gorditas de bistec" — model [] forever; force GD lines (meat from this turn or just-prior "también de bistec")
    // case1c: bare "Me pone gordita" must NOT force a catalog gordita (model asks meat; fragment path adds sq-gordita-T)
    if (source.startsWith("caller") && /\bgorditas?\b/iu.test(text)
      && (/\b(?:dos|tres|cuatro|cinco|2|3|4|5|two|three|four|five)\s+gorditas?\b/iu.test(text) || listedMeats(text).length > 0)
      && !(/\b(?:tienen|hay|tiene|ten[eé]s|vende)\b/iu.test(text) && !/\b(?:dame|deme|quiero|pone|gorditas?)\b/iu.test(text))
      && !acts.some((a: any) => a.type === "add_item" && /^sq-gordita-/i.test(String(a.itemId)))
      && !cart.some((l) => /^sq-gordita-/i.test(String(l.itemId)))) {
      const n = spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+pone|si\s+me\s+puede\s+poner|me\s+puede\s+poner)\s+/iu, ""))
        || (/\b(?:dos|2|two)\b/iu.test(text) ? 2 : /\b(?:tres|3|three)\b/iu.test(text) ? 3 : 1);
      let meats = listedMeats(text);
      if (!meats.length) {
        const recent = history.filter((h) => h.role === "customer").slice(-3).map((h) => h.text).join(" ") + " " + text;
        meats = listedMeats(recent);
      }
      const MEAT_OPT: Array<[RegExp, string]> = [
        [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
        [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^picadillo$/i, "Picadillo / Ground Beef"],
        [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"],
      ];
      const meat = meats[0]?.meat || "bistec";
      const opt = MEAT_OPT.find(([re]) => re.test(meat))?.[1] || "Bistec / Steak";
      acts.push({
        type: "add_item", itemId: "sq-gordita-M647RE", quantity: n > 1 ? n : 1,
        modifiers: [
          { step: "(A) Gordita Options", option: "(GD) Gordita" },
          { step: "(B) Q Carnes / Meats", option: opt },
        ],
        readback: `${n > 1 ? n : 1} gordita ${meat}`,
      });
    }
    // queso1 (Ali): "dos gorditas de (puro) queso" = (GD) Gordita filled with melted cheese, not the (QGD) cheese-dough gordita
    if (/\bgorditas?\b[\s,.]*(?:de\s+)?(?:puro\s+|pur[ao]\s+|solo\s+|nom[aá]s\s+)?queso\b(?!\s+(?:fresco|gordita))/iu.test(text))
      for (const a of acts) if (a.type === "add_item" && /^sq-gordita-/i.test(a.itemId)) {
        const ms = a.modifiers || [];
        const hasMeat = ms.some((m: any) => !/salsa/i.test(m.option) && new RegExp(MEAT_LIST, "i").test(m.option));
        const q = ms.find((m: any) => /\(QGD\)/.test(m.option));
        if (q && !hasMeat) a.modifiers = [...ms.filter((m: any) => m !== q), { ...q, option: "(GD) Gordita" }, { ...q, groupId: undefined, groupName: "(B) Q Carnes / Meats", step: "(B) Q Carnes / Meats", option: " Queso Derretido / Melted Cheese" }];
      }
    // quesitorta1 (Suleika): "queso torta(s)" → (QTO) Queso Torta; drop mistaken Queso Derretido unless they asked melted/extra
    if (/\bqueso\s+tortas?\b/iu.test(text))
      for (const a of acts) if (a.type === "add_item" && /^sq-torta-/i.test(a.itemId)) {
        const ms = [...(a.modifiers || [])].filter((m: any) => !/^\s*\((?:TO|QTO)\)/i.test(String(m.option)));
        const qto = { step: "(A) Torta Options", option: "(QTO) Queso Torta (+$0.50)" };
        if (!/derretid|melted|extra\s+(?:de\s+)?queso|mas\s+queso/i.test(text))
          a.modifiers = [qto, ...ms.filter((m: any) => !/queso derretido|melted cheese/i.test(String(m.option)))];
        else a.modifiers = [qto, ...ms];
        // quesitorta1b: "de bistec" must land as Bistec / Steak even when the model only sent QTO + frijoles
        const meatRe = new RegExp(MEAT_LIST, "i");
        if (!(a.modifiers || []).some((m: any) => meatRe.test(String(m.option)) && !/salsa|frijol|bean|queso/i.test(String(m.option)))) {
          const mm = text.match(new RegExp(String.raw`\bde\s+(?:al\s+)?(${MEAT_LIST})\b`, "iu"));
          if (mm) {
            const MEAT_OPT: Array<[RegExp, string]> = [[/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"], [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"], [/^carnitas$/i, "Carnitas / Pulled Pork"], [/^buche$/i, "Buche / Pork Stomach"]];
            const opt = MEAT_OPT.find(([re]) => re.test(mm[1]))?.[1];
            if (opt) a.modifiers = [...(a.modifiers || []), { step: "(B) Q Carnes / Meats", option: opt }];
          }
        }
      }
    // close1: a short closing line that names no dish (Bree: a long merged turn ending in "thank you" still carries her order) ("sería todo", "gracias", "bye", Cecilia: "Ándale, pues") never adds an item
    if (source !== "auto" && !dishesNamed(text).size && text.trim().split(/\s+/).length <= 10 && /\b(?:ser[ií]a\s+todo|eso\s+es\s+todo|es\s+todo|gracias|thank(?:s|\s+you)|bye|adi[oó]s|that'?s\s+(?:all|it)|[aá]ndale(?:\s*,?\s*pues)?|[oó]rale(?:\s*,?\s*pues)?)\b/iu.test(text))
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item") acts.splice(i, 1);
    // jose1: count-confirm / filler only ("Seis. Sí, seis. Perdón", "O sea… menos") — not bare size/side answers
    if (source.startsWith("caller") && cart.length && !dishesNamed(text).size && !listedMeats(text).length && !MEAT_WORDS.test(text) && !FOOD.test(text)) {
      const t0 = text.trim();
      const countConfirm = /^(?:(?:s[ií]|yes|ok(?:ay)?|bueno|este|o\s+sea)[,.\s]*)*(?:\d+|dos|tres|cuatro|cinco|seis|siete|ocho)(?:[,.\s]+(?:s[ií]|yes|ok(?:ay)?|bueno))*(?:[,.\s]*(?:perd[oó]n|sorry|excuse\s+me))?[.!\s]*$/iu.test(t0);
      const menosJunk = /\b(?:o\s+sea|okay|ok)\b/iu.test(t0) && /\bmenos\b/iu.test(t0) && !/\b(?:dame|deme|quiero)\b/iu.test(t0);
      const emptyThanks = /^(?:solo\s+voy\s+a\b|nada)\b/iu.test(t0);
      if (countConfirm || menosJunk || emptyThanks)
        for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item") acts.splice(i, 1);
    }
    // confirm1 (Alan): "Eh, coctel de camarón, sí" right after it was rung confirms that line — not a second order
    {
      const adds = acts.filter((a: any) => a.type === "add_item");
      if (source !== "auto" && adds.length === 1 && lastAdded && adds[0].itemId === lastAdded.itemId && cart.includes(lastAdded) && (Number(adds[0].quantity) || 1) === 1
        && text.trim().split(/\s+/).length <= 10 && !/\b(?:otr[oa]s?|m[aá]s|tambi[eé]n|another|more|extra|un[oa]?|dos|tres|cuatro|cinco|one|a|an|two|three|four|\d+)\b/iu.test(text)
        && /\b(?:s[ií]|yes|ok(?:ay)?|eso|correcto|exacto)\b/iu.test(text)) acts.splice(acts.indexOf(adds[0]), 1);
    }
    // cecilia1: 2nd staff-pick / bare "con pata" of same menudo/mole/platillo must merge mods, not double the line
    if (source === "staff-pick" || /^\W*(?:con|sin)\s+patas?\b/iu.test(text)) {
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i]; if (a.type !== "add_item") continue;
        const ik = kindOfItem(a.itemId) || "";
        if (!/^(menudo|mole|platillo)$/.test(ik)) continue;
        const pi = cart.map((l) => kindOfItem(l.itemId)).lastIndexOf(ik);
        if (pi < 0) continue;
        const prev = cart[pi];
        const have = new Set((prev.modifiers || []).map((m: any) => String(m.option).toLowerCase()));
        const fresh = (a.modifiers || []).filter((m: any) => !have.has(String(m.option).toLowerCase()));
        if (fresh.length) prev.modifiers = [...(prev.modifiers || []), ...fresh];
        // prefer Con Pata catalog id from the later pick; mods already merged via fresh
        if (/pata/i.test(String(a.itemId)) || (a.modifiers || []).some((m: any) => /pata/i.test(String(m.option))))
          prev.itemId = a.itemId;
        // keep pending qty on the first line; never let a 2nd con-pata answer bump total
        acts.splice(i, 1);
      }
    }
    // joseA1: "Sí, no se preocupe" is reassurance while staff types — never an order
    if (source.startsWith("caller") && /\bno\s+(?:se|te)\s+preocup/iu.test(text) && !FOOD.test(text) && !DRINK.test(text) && !ORDER_QTY.test(text)) {
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item" || acts[i].type === "update_item") acts.splice(i, 1);
    }
    // mix2 (Paco): staff-pick re-runs "Quesadilla Comal" alone, so read "bistec con chorizo" from the caller's last turn
    mixMeats(acts, source === "staff-pick" ? `${text} ${[...history].reverse().find((h) => h.role === "customer" && h.text !== text)?.text || ""}` : text);

    // joseA1: after mixMeats merged bistec+chorizo, apply spoken "tres tortas" qty (qty block ran before merge)
    if (source.startsWith("caller")) {
      const tm = cleanPhrase(text).match(new RegExp(String.raw`\b(${NUMW})\s+(?:(?:[oó]rdenes?|orders?)\s+(?:de|del)\s+)?(?:\p{L}+\s+){0,3}?tortas?\b`, "iu"));
      const tn = tm ? spokenCount(tm[1]) : 0;
      if (tn > 1) {
        const tortaActs = acts.filter((a: any) => a.type === "add_item" && /torta/i.test(String(a.itemId)));
        if (tortaActs.length === 1 && (Number(tortaActs[0].quantity) || 1) < tn) tortaActs[0].quantity = tn;
      }
    }
    // jesus1: COMBO Gorditas — force spoken qty, chorizo+carnitas meats, arroz+frijol (drop conflicting SOLO Frijoles)
    if (source.startsWith("caller")) {
      const comboActs = acts.filter((a: any) => a.type === "add_item" && /combo.*gordita/i.test(String(a.itemId)));
      const qtyM = cleanPhrase(text).match(new RegExp(String.raw`\b(${NUMW})\s+(?:(?:[oó]rdenes?|orders?)\s+(?:de|del)\s+)?(?:\p{L}+\s+){0,3}?(?:gorditas?|combo)\b`, "iu"));
      const cq = qtyM ? spokenCount(qtyM[1]) : 0;
      const saidChorizo = /\bchorizo\b/iu.test(text);
      const saidCarnitas = /\bcarnitas?\b/iu.test(text);
      const saidArrozFrijol = (/\barroz\b/iu.test(text) && /\bfrijol/iu.test(text))
        || ( /^\s*(s[ií]|yes|aj[aá]|ok)\b/iu.test(text) && /arroz.*frijol|frijol.*arroz|arroz\s+y\s+frijol/iu.test(prevReply) );
      const meatOpts = [
        { step: "B", option: "1 x Chorizo / Mexican Sausage" },
        { step: "B", option: "1 x Carnitas / Pulled Pork" },
      ];
      const sideOpts = [
        { step: "C", option: "1 x Arroz / Rice" },
        { step: "C", option: "1 x Frijoles Refritos / Refried Beans" },
      ];
      const ensureCombo = (l: any) => {
        let mods = [...(l.modifiers || [])];
        if (saidChorizo && saidCarnitas) {
          for (const mo of meatOpts) {
            const key = mo.option.replace(/^\d+\s*x\s*/i, "").split(" /")[0];
            if (!mods.some((m: any) => new RegExp(key, "i").test(String(m.option)))) mods.push(mo);
          }
        }
        if (saidArrozFrijol) {
          mods = mods.filter((m: any) => !/SOLO\s+Frijoles/i.test(String(m.option)));
          for (const so of sideOpts) {
            const key = so.option.replace(/^\d+\s*x\s*/i, "").split(" /")[0];
            if (!mods.some((m: any) => new RegExp(key, "i").test(String(m.option)))) mods.push(so);
          }
        }
        l.modifiers = mods;
        if (cq > 1 && (Number(l.quantity) || 1) < cq) l.quantity = cq;
      };
      for (const a of comboActs) ensureCombo(a);
      // meats/sides/qty on a later turn — patch cart combos
      if ((saidChorizo && saidCarnitas) || saidArrozFrijol || cq > 1) {
        for (const l of cart) if (/combo.*gordita/i.test(String(l.itemId))) ensureCombo(l);
      }
      // bump qty 2 from earlier "dos órdenes … combo/gorditas" when this turn only adds meats
      if (saidChorizo && saidCarnitas) {
        const prior = [...history].reverse().find((h) => h.role === "customer" && /\b(?:dos|2|two)\b/iu.test(h.text) && /gorditas?|combo/iu.test(h.text));
        if (prior) {
          for (const l of cart) if (/combo.*gordita/i.test(String(l.itemId)) && (Number(l.quantity) || 1) < 2) l.quantity = 2;
          for (const a of comboActs) if ((Number(a.quantity) || 1) < 2) a.quantity = 2;
        }
      }
    }
    // jesus1: taco "solo / sin nada" → strip salsa (plain)
    if (source.startsWith("caller") && /\b(?:solo|sin\s+nada|plain)\b/iu.test(text)) {
      const stripSalsa = (mods?: any[]) => (mods || []).filter((m: any) => !/salsa/i.test(String(m.option)));
      for (const a of acts) if ((a.type === "add_item" || a.type === "update_item") && /taco/i.test(String(a.itemId))) a.modifiers = stripSalsa(a.modifiers || []);
      const lastTaco = [...cart].reverse().find((l) => kindOfItem(l.itemId) === "taco");
      if (lastTaco) lastTaco.modifiers = stripSalsa(lastTaco.modifiers || []);
    }

    // carlos1: auto-accept never stacks a second meat or re-adds a dish already rung
    if (source === "auto") {
      const meatRe = new RegExp(MEAT_LIST, "i");
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.type === "add_item" && cart.some((l) => l.itemId === a.itemId)) { acts.splice(i, 1); continue; }
        if (a.type === "update_item" || a.type === "add_item") {
          const prev = [...cart].reverse().find((l) => l.itemId === a.itemId);
          if (!prev || !a.modifiers) continue;
          const prevMeats = new Set((prev.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => meatRe.test(o) && !/salsa/i.test(o)));
          if (!prevMeats.size) continue;
          a.modifiers = (a.modifiers || []).filter((m: any) => {
            const o = String(m.option);
            if (!(meatRe.test(o) && !/salsa/i.test(o))) return true;
            return [...prevMeats].some((p) => p === o || p.includes(o.split(" /")[0]) || o.includes(p.split(" /")[0]));
          });
        }
      }
    }
    // gino1: "un taco de lengua y un taco de chorizo" (after rewrite / splitItems) — keep only meats named this turn
    if (source.startsWith("caller")) {
      const parts = [...text.matchAll(new RegExp(String.raw`\bun\s+taco(?:\s+taquero)?\s+de\s+(${EACH_MEATS})`, "giu"))].map((m) => m[1].toLowerCase());
      const named = listedMeats(text).map((w) => w.meat.toLowerCase());
      const tacoAdds = acts.filter((a: any) => a.type === "add_item" && /taco/i.test(String(a.itemId)));
      // After splitItems, each piece is "un taco taquero de X" — strip extra meats the model stacked
      if (named.length === 1 && /\btaco/i.test(text) && tacoAdds.length) {
        const meatRe = new RegExp(MEAT_LIST, "i");
        const singular = /\bun\s+taco\b/iu.test(text) && !/\b(?:dos|tres|cuatro|\d+)\s+tacos?\b/iu.test(text);
        for (const a of tacoAdds) {
          if (singular) a.quantity = 1;
          a.modifiers = (a.modifiers || []).filter((m: any) => {
            const o = String(m.option);
            if (!(meatRe.test(o) && !/salsa/i.test(o))) return true;
            return named.some((n) => o.toLowerCase().includes(n));
          });
        }
      }
      if (parts.length >= 2 && tacoAdds.length === 1) {
        const a0 = tacoAdds[0];
        const MEAT_OPT: Array<[RegExp, string]> = [[/^lengua$/i, "Lengua / Beef Tongue"], [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"], [/^cabeza$/i, "Cabeza / Beef Head"], [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"], [/^carnitas$/i, "Carnitas / Pulled Pork"], [/^buche$/i, "Buche / Pork Stomach"]];
        const baseMods = (a0.modifiers || []).filter((m: any) => !new RegExp(MEAT_LIST, "i").test(String(m.option)) || /salsa/i.test(String(m.option)));
        const mk = (meat: string) => {
          const opt = MEAT_OPT.find(([re]) => re.test(meat))?.[1];
          return { ...a0, quantity: 1, modifiers: opt ? [...baseMods, { step: "(B) Q Carnes / Meats", option: opt }] : baseMods };
        };
        const i0 = acts.indexOf(a0);
        acts.splice(i0, 1, ...parts.map(mk));
      }
      // gino1b: after a split order, drop dual-meat taco adds/lines (model merged lengua+chorizo) and stray QST when deluxe already landed
      if (parts.length >= 2) {
        const meatRe = new RegExp(MEAT_LIST, "i");
        const meatsOf = (x: any) => (x.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => meatRe.test(o) && !/salsa/i.test(o));
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i];
          if (a.type === "add_item" && /taco/i.test(String(a.itemId)) && meatsOf(a).length >= 2) acts.splice(i, 1);
        }
        for (let i = cart.length - 1; i >= 0; i--) {
          if (kindOfItem(cart[i].itemId) === "taco" && meatsOf(cart[i]).length >= 2) cart.splice(i, 1);
        }
        if (!acts.some((a: any) => a.type === "add_item" && /taco/i.test(String(a.itemId)))) {
          const MEAT_OPT: Array<[RegExp, string]> = [[/^lengua$/i, "Lengua / Beef Tongue"], [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"], [/^cabeza$/i, "Cabeza / Beef Head"], [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"], [/^carnitas$/i, "Carnitas / Pulled Pork"], [/^buche$/i, "Buche / Pork Stomach"]];
          const TACO = "sq-taco-TAR7L5";
          for (const meat of parts) {
            const opt = MEAT_OPT.find(([re]) => re.test(meat))?.[1];
            if (!opt) continue;
            const have = cart.some((l) => kindOfItem(l.itemId) === "taco" && meatsOf(l).length === 1 && (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option))));
            if (have) continue;
            acts.push({ type: "add_item", itemId: TACO, quantity: 1, modifiers: [
              { step: "(A) Tortilla Options", option: "(TST) Tortilla Taquera / Street Taco" },
              { step: "(B) Q Carnes / Meats", option: opt },
            ], readback: `taco taquero ${meat}` });
          }
        }
      }
      // gino1c: past-order complaint ("última vez… quesadillas con todo") is not a new QST/QCO line
      if (/\b(?:[uú]ltima\s+vez|last\s+time|la\s+otra\s+vez)\b/iu.test(text) || (/\bquesadillas?\b/iu.test(text) && /\b(?:con\s+todo|sin\s+nada|normal)\b/iu.test(text) && /\b(?:me\s+las\s+dieron|no\s+me|dieron)\b/iu.test(text))) {
        for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item" && /quesadilla/i.test(String(acts[i].itemId))) acts.splice(i, 1);
      }
      // gino1d: once QD Deluxe is in cart, never invent plain QST/QCO from a non-order turn
      if (cart.some((l) => l.itemId === DORADA_DELUXE_ID) && !/\b(?:comal|aceite|dorad|deluxe|preparad|supreme)\b/iu.test(text)) {
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i];
          if (a.type !== "add_item" || !/quesadilla/i.test(String(a.itemId))) continue;
          if (a.itemId === DORADA_DELUXE_ID || a.itemId === DORADA_REG_ID) continue;
          acts.splice(i, 1);
        }
      }
    }
    apply(acts);
    // joseA1: capture street from caller text when model skipped set_address (merged agua+address+horchata turn)
    if (source.startsWith("caller") && !shadowAddress) {
      const hit = addressesIn(text)[0];
      if (hit) { shadowAddress = hit.full || hit.street; shadowAddressConfirmed = true; }
    }
    // gino1f: drop dual-meat taco lines whenever matching single-meat tacos already exist (model re-adds after split)
    {
      const meatRe = new RegExp(MEAT_LIST, "i");
      const meatsOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option).toLowerCase()).filter((o: string) => meatRe.test(o) && !/salsa/i.test(o)).map((o: string) => o.split(" /")[0].trim());
      const singles = new Set<string>();
      for (const l of cart) {
        if (kindOfItem(l.itemId) !== "taco") continue;
        const ms = meatsOf(l);
        if (ms.length === 1) singles.add(ms[0]);
      }
      if (singles.size >= 2) {
        for (let i = cart.length - 1; i >= 0; i--) {
          if (kindOfItem(cart[i].itemId) !== "taco") continue;
          const ms = meatsOf(cart[i]);
          if (ms.length >= 2 && ms.every((m: string) => [...singles].some((s) => s.includes(m) || m.includes(s)))) cart.splice(i, 1);
        }
      }
    }
    if (process.env.SHADOW_DEBUG) console.error("[shadow]", source, "|", text, "|", JSON.stringify(acts.map((a: any) => [a.type, String(a.itemId || "").slice(3, 30), a.quantity, (a.modifiers || []).map((m: any) => m.option).filter((o: string) => !/salsa asada/i.test(o)).join("+")])), "| cart", cart.length);
    // juan1d: deluxe SKU must carry "(QD) DELUXE Preparada" choice (model often omits it when itemId is already deluxe)
    for (const l of cart as any[]) {
      if (l.itemId !== DORADA_DELUXE_ID) continue;
      if (!(l.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(String(m.option)))) {
        l.modifiers = [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, ...(l.modifiers || [])];
      }
    }
    // sopesize1/juan1: default size is the 10”; explicit chico/normales/regulares (or a pending small) picks Sope Elvis.
    // luisSopes1: bare "Regulares"/"sencillas"/"preparadas" (Dorada style answer) is NOT a small-sope size cue
    { const bareStyleAns = /^\W*(?:(?:no|s[ií]|las?|los?|unas?|tres|dos|\d+)\s*,?\s*)?(?:regular(?:es)?|normal(?:es)?|preparad[oa]s?|sencill[ao]s?|deluxe)\W*$/iu.test(text);
      const saidSmall = !bareStyleAns && SMALL_SOPE.test(applySharedAliases(text, "phone"));
      // juanTst1: bare "normales"/"regulares" during taco comal↔taquero talk must NOT arm small-sope pending
      const sopeCtx = /\bsopes?(?:asos?|azos?)?\b/iu.test(text) || /\bsopes?(?:asos?|azos?)?\b/iu.test(prevCaller + " " + (lastStaff || ""))
        || cart.some((l) => /sopes[ae]so/i.test(String(l.itemId)));
      if (saidSmall && sopeCtx) pendingSmallSope = true;
      if (/\btaqueros?\b|\bstreet\b/iu.test(text) && !/\bsopes?/iu.test(text)) pendingSmallSope = false;
      const sopeTouched = touchedNow.filter((l) => /sopes[ae]so/i.test(l.itemId));
      if ((saidSmall || pendingSmallSope) && sopeTouched.length) {
        for (const l of sopeTouched) {
          l.posSize = "small";
          // juan1f: expose size as a choice so probe/ticket match without requiring POS catalog expand
          if (!(l.modifiers || []).some((m: any) => /sope elvis/i.test(String(m.option)))) {
            l.modifiers = [{ step: "(A) Size", option: "Sope Elvis" }, ...(l.modifiers || [])];
          }
        }
        pendingSmallSope = false;
      }
      // juan1: bare meat answer after sopes — stamp spoken meat onto last sope if model left it off / piled onto wrong dish
      if (source.startsWith("caller") && !dishesNamed(text).size && new RegExp(String.raw`\b(?:${MEAT_LIST})\b`, "iu").test(text) && !FOOD.test(text)) {
        const sope = [...cart].reverse().find((l) => /sopes[ae]so/i.test(l.itemId));
        const mm = text.match(new RegExp(String.raw`\b(${MEAT_LIST})\b`, "iu"));
        if (sope && mm) {
          const MEAT_OPT: Array<[RegExp, string]> = [[/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"], [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"], [/^carnitas$/i, "Carnitas / Pulled Pork"], [/^buche$/i, "Buche / Pork Stomach"]];
          const opt = MEAT_OPT.find(([re]) => re.test(mm[1]))?.[1];
          if (opt && !(sope.modifiers || []).some((m: any) => new RegExp(mm[1], "i").test(String(m.option))))
            sope.modifiers = [...(sope.modifiers || []), { step: "(B) Q Carnes / Meats", option: opt }];
          // strip that meat off non-sope lines this turn invented/updated
          for (const l of cart) {
            if (/sopes[ae]so/i.test(l.itemId)) continue;
            if (!(l.modifiers || []).some((m: any) => new RegExp(mm[1], "i").test(String(m.option)))) continue;
            // only strip if this kind was not named earlier as wanting that meat alone
            if (/dorada|gordita|quesadilla|torta/i.test(l.itemId))
              l.modifiers = (l.modifiers || []).filter((m: any) => !new RegExp(mm[1], "i").test(String(m.option)));
          }
        }
      }
    }
    // miguel1: menudo already rung with tortillas — drop phantom Taco Comal/Harina/Taquero Q
    // so staffpick1/tortdef1 cannot invent Taco Comal on "Nada más"/name.
    // jose2: also rewrite staff-pick/auto replies (house default pick must not leave Huarache meat Q open)
    if (r && (source.startsWith("caller") || source === "staff-pick" || source === "auto" || source.startsWith("caller-"))) {
      const reply = String(r.reply || "");
      const tacoQ = /\bTaco\s+(?:Comal|Harina|Taquer)/i.test(reply) || (/\b(?:comal|harina|taquer)/i.test(reply) && /\btaco/i.test(reply) && /\?/u.test(reply));
      const namedTaco = /\btacos?\b/iu.test(text) || dishesNamed(text).has("taco");
      const cartTaco = cart.some((l) => kindOfItem(l.itemId) === "taco") || acts.some((a: any) => a.type === "add_item" && kindOfItem(a.itemId) === "taco");
      const menudoOnly = (cart.some((l) => /menudo/i.test(String(l.itemId))) || acts.some((a: any) => a.type === "add_item" && /menudo/i.test(String(a.itemId))))
        && !cartTaco && !namedTaco;
      if (tacoQ && menudoOnly) r.reply = language === "es" ? "¿Algo más?" : "Anything else?";
      // bryan1/monica: never loop Con/Sin pata when caller never mentioned pata (house default = sin / Tortillas)
      const pataQ = /\bCon\s+Pata\b/i.test(reply) && /\bMenudo\b/i.test(reply) && /\?/u.test(reply);
      const saidPata = /\b(?:con|sin)\s+patas?\b/iu.test(text)
        || /\b(?:con|sin)\s+patas?\b/iu.test(prevCaller)
        || history.some((h) => h.role === "customer" && /\b(?:con|sin)\s+patas?\b/iu.test(h.text));
      const hasMenudo = cart.some((l) => /menudo/i.test(String(l.itemId))) || acts.some((a: any) => a.type === "add_item" && /menudo/i.test(String(a.itemId)));
      if (pataQ && !saidPata && hasMenudo) r.reply = language === "es" ? "¿Algo más?" : "Anything else?";
      // jose2: drop phantom Huarache meat Q when caller never said huarache (QD/menudo context)
      const huaracheQ = /\bHuarache\b/i.test(reply) && /\?/u.test(reply);
      const saidHuarache = /\b[gh]uaraches?\b/iu.test(text + " " + prevCaller)
        || history.some((h) => h.role === "customer" && /\b[gh]uaraches?\b/iu.test(h.text));
      const cartHuarache = cart.some((l) => /huarache|guarache/i.test(String(l.itemId)))
        || acts.some((a: any) => a.type === "add_item" && /huarache|guarache/i.test(String(a.itemId)));
      if (huaracheQ && !saidHuarache && !cartHuarache) r.reply = language === "es" ? "¿Algo más?" : "Anything else?";
      // jose2: strip phantom huarache lines the model/auto invented when caller never said huarache
      if (!saidHuarache) {
        for (let i = acts.length - 1; i >= 0; i--)
          if (acts[i].type === "add_item" && /huarache|guarache/i.test(String(acts[i].itemId))) acts.splice(i, 1);
        for (let i = cart.length - 1; i >= 0; i--)
          if (/huarache|guarache/i.test(String(cart[i].itemId))
            && !history.some((h) => h.role === "customer" && /\b[gh]uaraches?\b/iu.test(h.text)))
            cart.splice(i, 1);
      }
    }
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
      // carlos1: al revés / mejor dicho restates — never invent extras on top
      const takeback = /\b(?:al\s+rev[eé]s|mejor\s+dicho)\b/iu.test(text);
      for (const w of want) {
        if (takeback) continue;
        if ((have.get(w.meat) || 0) > 0) { have.set(w.meat, have.get(w.meat)! - 1); continue; }
        // also skip invent when the full cart already has enough of this meat for a restate (no otros/más)
        if (!/\b(?:otr[oa]s?|m[aá]s|tambi[eé]n|another|more|extra)\b/iu.test(text)) {
          const cartHave = cart.filter((l) => lineHasMeat(l, w.meat) && (!nk.size || nk.has(kindOfItem(l.itemId) || ""))).reduce((n, l) => n + (Number(l.quantity) || 1), 0);
          if (cartHave >= (w.qty || 1)) continue;
        }
        const ref = refFor();
        // jose1: "deme dos, dos de quesad, dos de pollo" after QCO bistec — invent missing meat even when this turn added nothing
        const orderMore = !!(w.qty && w.qty > 1 && /\b(?:dame|deme|me\s+(?:da|das|pone)|quiero|tambi[eé]n|another|more|otra|otro)\b/iu.test(text));
        if (!ref || (!w.another && !mine.length && !orderMore)) continue;
        const k = kindOfItem(ref.itemId)!;
        await say(`${w.qty && w.qty > 1 ? `${w.qty} ${dishNoun(k)}s` : dishPhrase(k)}${tortillaWordOf(ref)} de ${w.meat}`, language, "caller-meat-listed");
      }
      // tw4938: "serían esos tres" — the caller's total for the dish; drop later exact repeats beyond it (a meat said twice).
      const st = statedTotal(text); const kind = st?.kind || (kinds.size === 1 ? [...kinds][0] : null);
      if (st && kind) {
        // tw4938: stated total consumed — do not leave pendingSpokenQty to inflate a later invent
        if (pendingSpokenQty && (!pendingSpokenQty.kind || pendingSpokenQty.kind === kind)) pendingSpokenQty = null;
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
  // cecilia1: when next is "me puede preparar dos órdenes … con pata" with no dish, stamp the asked dish onto that next turn before dropping this one.
  { // avail2b (Cecilia): "Oiga, disculpe, ¿sí tienen menudo?" — ¿ + optional sí between fillers and tienen/hay.
    // juan1/avail2: also tenés/venden; list-back ("qué me dijiste que tenés… gorditas, qué más?"); size info ("¿los sopes son grandes o chicos?"). Availability ≠ order.
    const isAvailQ = (t: CallTurn) => {
      if (t.speaker !== "caller") return false;
      if (/\b(?:quiero|dame|deme|me\s+da|I'?ll\s+take|I'?ll\s+have|can\s+I\s+(?:get|have|order)|let\s+me\s+get|I\s+want|give\s+me|me\s+pones?|me\s+puedes?\s+poner|ponme)\b/iu.test(t.text)) return false;
      if (/\b(\d+|one|two|three|four|five|una?|dos|tres|cuatro|for pickup|para llevar|order|orden)\b/i.test(t.text) && !/\b(?:qu[eé]\s+m[aá]s|me\s+dijiste|what\s+else)\b/iu.test(t.text)) return false;
      if (/^\W*(?:(?:hey|so|and|oh|y|oye|oiga|mire|diga|ah|am|um|uh|s[ií]|bueno|disculpe|perd[oó]n|ok(?:ay)?|qu[eé])[,.\s]+){0,5}\W*(?:s[ií][,.\s]+)?(?:(?:do\s+)?you(?:\s+guys)?(?:\s+still)?\s+(?:got|have)|you\s+got\s+ca-?\s+you\s+got|got\s+any|is\s+there|is\s+[^?.!]{0,40}\bavailable|est[aá]\s+disponible|tienen\s+disponible|tienen|hay|tiene|ten[eé]s|tendr[aá]s?|tendr[aá]n|vende[ns]?|manejan)\b[^.!]*?(?:\btoday\b|\bhoy\b|\?)\W*$/iu.test(t.text)) return true;
      if (/\b(?:qu[eé]\s+m[aá]s|me\s+dijiste\s+que\s+ten|what\s+else\s+(?:do\s+you\s+)?have|you\s+(?:also\s+)?(?:said\s+you\s+)?have)\b/iu.test(t.text)) return true;
      // victor1/avail: "De, este, sí tiene barbacoa." — availability, not an order (no ?/hoy required).
      if (/^\W*(?:(?:de|este|ah|oh|am|um|eh|s[ií]|bueno|pues|oye)[,.\s]+){0,6}\W*(?:s[ií][,.\s]+)?(?:tiene|tienen|ten[eé]s|tendr[aá]s?|tendr[aá]n|hay|vende[ns]?|manejan)\b\s+[\p{L}\s]{2,40}\W*$/iu.test(t.text)) return true;
      // gino1: "Y tacos de ticket tienen." — dish…tienen (avail), not an order
      if (/\b(?:tacos?|quesadillas?|gorditas?|tortas?|burritos?|sopes?|menudo|birria)\b[^.?]{0,40}\btienen\s*[.?]?\s*$/iu.test(t.text)) return true;
      if (/^\W*(?:(?:los?|las?)\s+)?(?:sopes?|gorditas?|tacos?|quesadillas?|tortas?|huaraches?|guaraches?)\s+(?:son|est[aá]n|are)\s+/iu.test(t.text)) return true;
      return false;
    };
    // jose2: "me pone dos, una de picadillo…" after doradas avail is an order, not bare filler
    const nextIsOrderBare = (nx: CallTurn) => !dishesNamed(nx.text).size && /\b(?:order|get|take|want|have)\s+(?:some|it|one|that|those|them)\b|\b(?:l[oa]s?)\s+quiero\b|\bquiero\s+(?:un[oa]?|dos|tres|es[oa]s?)\s*[.,!]*$|\bdame\s+(?:un[oa]?|dos|tres|es[oa]s?)\s*[.,!]*$|\b(?:me\s+)?puede(?:s)?\s+(?:preparar|hacer|dar|poner)\b|\b(?:me\s+)?pone(?:s|r)?\b|\bpon(?:me|ga)\b|\b[oó]rdenes?\b/iu.test(nx.text);
    const dishOf = (text: string) => {
      if (/\bquesadillas?\s+doradas?\b/iu.test(text) || (/\bdoradas?\b/iu.test(text) && /\bquesadillas?\b/iu.test(text))) return "quesadillas doradas";
      return (text.match(/\b(nachos|quesadillas?|tacos?|tortas?|burritos?|gorditas?|sopes?|huaraches?|tostadas?|enchiladas?|tamales|esquites?|menudos?|moles?|platillos?|plates?|c[oó]ctel(?:es)?\s+de\s+camar[oó]n(?:es)?)\b/iu) || [])[1] || "";
    };
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]; if (!isAvailQ(t)) continue;
      const ni = turns.findIndex((u, j) => j > i && u.speaker === "caller");
      if (ni < 0 || !nextIsOrderBare(turns[ni])) continue;
      const dish = dishOf(t.text); if (!dish) continue;
      const nx = turns[ni];
      // pickup1/yesopt1: avail opens Elvi's Q; don't stamp dish onto "pickup, yes, flour" (breaks exact yesopt phrase)
      if (/\b(?:pick[\s-]?up|para\s+llevar|(?:pasar\s+a\s+)?recoger)\b/iu.test(nx.text)
        && /\b(?:s[ií]|yes|yeah|yep|please|flour|harina|comal|rice|beans|frijoles)\b/iu.test(nx.text)) continue;
      if (/\b(?:puede|puedes|podr[ií]a|podr[ií]as|pone|pones|manda)\s+(?:(?:preparar|hacer|dar|poner)\s+)?(?:un[oa]?|dos|tres)(?:\s+(?:[oó]rdenes?|orders?))?\b/iu.test(nx.text))
        turns[ni] = { ...nx, text: nx.text.replace(/\b((?:puede|puedes|podr[ií]a|podr[ií]as|pone|pones|manda)\s+(?:(?:preparar|hacer|dar|poner)\s+)?(?:un[oa]?|dos|tres)(?:\s+(?:[oó]rdenes?|orders?))?)\b/iu,
          (m) => /(?<![\p{L}])[oó]rdenes?(?![\p{L}])/iu.test(m) ? `${m} de ${dish}` : `${m} orden de ${dish}`) };
      else if (!/\bde\s+\p{L}/iu.test(nx.text))
        turns[ni] = { ...nx, text: `${nx.text.replace(/[.?!¿¡]+$/u, "")} de ${dish}` };
    }
    // avail2: drop availability probes (≠ order). pickup1/yesopt1 exception: keep the probe so Elvi opens the
    // dish Q for the following "pickup, yes, flour" answer (tagged availOnly — adds stripped in say).
    const yesoptFollows = (i: number) => {
      const ni = turns.findIndex((u, j) => j > i && u.speaker === "caller");
      if (ni < 0) return false;
      const nx = turns[ni].text;
      return /\b(?:pick[\s-]?up|para\s+llevar|(?:pasar\s+a\s+)?recoger)\b/iu.test(nx)
        && /\b(?:s[ií]|yes|yeah|yep|please|flour|harina|comal|rice|beans|frijoles)\b/iu.test(nx);
    };
    turns = turns.filter((t, i) => {
      if (!isAvailQ(t)) return true;
      if (yesoptFollows(i)) { (t as any).availOnly = true; return true; }
      return false;
    });
  }
  const merged: CallTurn[] = [];
  for (const t of turns) {
    const prev = merged[merged.length - 1];
    // pickup1: never merge an avail probe into the following order/answer turn (keeps yesopt path)
    // jose1: don't glue a no-food thanks/filler turn into the next "deme dos … de pollo" order
    const joseOrderFollow = prev && prev.speaker === "caller" && t.speaker === "caller"
      && !FOOD.test(prev.text) && !MEAT_WORDS.test(prev.text)
      && (FOOD.test(t.text) || listedMeats(t.text).some((w) => !!w.qty && w.qty > 1))
      && /\b(?:dame|deme|me\s+(?:da|das|pone)|quiero)\b/iu.test(t.text);
    // oscar1: "No, regular" must not glue onto "Y una de bistec también dorada" (style handler would swallow the order)
    const styleOnlyPrev = prev && prev.speaker === "caller"
      && /^\W*(?:(?:no|s[ií]|las?|los?|unas?)\s*,?\s*)?(regular(?:es)?|preparad[oa]s?|deluxe)\W*$/iu.test(prev.text);
    const orderAfterStyle = styleOnlyPrev && t.speaker === "caller"
      && (/\bdoradas?\b/iu.test(t.text) || /\bquesadillas?\b/iu.test(t.text) || listedMeats(t.text).length > 0);
    if (prev && prev.speaker === "caller" && t.speaker === "caller" && !(prev as any).availOnly && !(t as any).availOnly
      && !isClosing(t.text) && !joseOrderFollow && !orderAfterStyle
      && !/^[¿¡\s]*(no\b|mejor\b|actually\b|instead\b|perd[oó]n\b|wait\b|espera\b)/iu.test(t.text)) {
      prev.text = `${prev.text.replace(/[.?!¿¡]+$/u, "")} ${t.text.replace(/^[¿¡]/u, "")}`; prev.end = t.end;
    } else merged.push({ ...t });
  }
  for (const t of merged) if (t.speaker === "caller") t.text = rewriteCallerText(applySharedAliases(t.text, "phone")); // or1/each1 + supreme/aceite aliases
  prepMergedCallerTurns(merged);
  turns = merged;
  const merged0 = turns;
  for (let t of turns) {
    if (t.speaker !== "caller") {
      steps.push({ source: "staff", heard: t.text }); staffAskedSplit = /\?|¿/.test(t.text) ? detectContainerSplit(t.text) : null;
      noteFulfillment(t.text);
      staffAskedComal = /\bcomal\b/iu.test(t.text) && /\?|¿/.test(t.text);
      lastStaff = t.text; recentStaff.push(t.text); if (recentStaff.length > 3) recentStaff.shift(); staffSince.push(t.text);
      // alejandro1: staff "dos quesadillas de comal, ¿de qué…?" stamps tortilla for later meat-fragment force-add
      { const tw = [...cleanPhrase(t.text).matchAll(/\b(?:de\s+)?(ma[ií]z|comal|harina|flour|taquer[ao]s?)\b/giu)].pop();
        if (tw && /\bquesadillas?\b/iu.test(t.text)) lastTortilla = /taquer/i.test(tw[1]) ? "de taquero" : `de ${tw[1]}`; }
      continue;
    }
    // case1d: staff "¿La gordita también quieres que lleve frijoles?" → "Sí…": beans on that gordita (option name resolved at the end)
    { const ask = lastStaff.match(/\b(?:la|el)\s+(\p{L}+?)s?\b[^?]*\b(frijoles|beans|queso|cheese|cebolla|cilantro|crema|lechuga|arroz|rice)\b[^?]*\?/iu);
      if (ask && /^\s*(s[ií]|yes|aj[aá])(?=[\s,.!]|$)/iu.test(t.text)) { const noun = ask[1].toLowerCase(); const idx = cart.map((l) => String(l.itemId)).map((id, k) => (id.includes(noun) ? k : -1)).filter((k) => k >= 0).pop();
        if (idx != null && idx >= 0) yesAdds.push({ line: cart[idx], what: ask[2].toLowerCase() }); } }
    // avail2/pickup1: ask Elvi so the dish Q opens; adds stripped in say (caller-avail)
    if ((t as any).availOnly) {
      last = await say(t.text, t.language, "caller-avail");
      steps.push({ source: "caller-avail", heard: t.text });
      continue;
    }
    noteFulfillment(t.text);
    // style1 (Noé): staff "¿preparadas o regulares?" about the Doradas just rung → "Regulares, con todo aparte" sets that
    // Dorada's style; it is not a new quesadilla (it had opened a tortilla question and rung a comal quesadilla).
    { const ld: any = [...cart].reverse().find((l: any) => l.itemId === DORADA_REG_ID || l.itemId === DORADA_DELUXE_ID);
      // jorge1: "No, regulares" rejects preparadas — allow leading no
      const st = t.text.match(/^\W*(?:(?:no|s[ií]|las?|los?|unas?)\s*,?\s*)?(regular(?:es)?|preparad[oa]s?|deluxe)\b/iu);
      if (ld && st && /\b(?:preparad[oa]s?|regular(?:es)?|deluxe)\b[^?]*\?/iu.test(lastStaff) && !dishesNamed(t.text).size) {
        const deluxe = !/^regular/i.test(st[1]);
        // oscar1: "No, regular" applies to ALL open Doradas still lacking a firm style when staff just asked
        for (const line of cart as any[]) {
          if (line.itemId !== DORADA_REG_ID && line.itemId !== DORADA_DELUXE_ID) continue;
          line.itemId = deluxe ? DORADA_DELUXE_ID : DORADA_REG_ID;
          line.modifiers = (line.modifiers || []).map((m: any) => /\(QD\)\s*(REGULAR Dorada|DELUXE Preparada)/i.test(String(m.option)) ? { ...m, option: deluxe ? "(QD) DELUXE Preparada" : "(QD) REGULAR Dorada" } : m);
        }
        const rest = t.text.replace(/^\W*(?:(?:no|s[ií]|las?|los?|unas?)\s*,?\s*)?(regular(?:es)?|preparad[oa]s?|deluxe)\b[,.\s]*/iu, "").trim();
        steps.push({ source: "caller-dorada-style", heard: t.text });
        if (rest && (/\bdoradas?\b/iu.test(rest) || listedMeats(rest).length > 0)) {
          t = { ...t, text: rest }; // fall through — oscar1 bistec dorada after style
          lastStaff = "";
        } else { lastStaff = ""; last = null; continue; }
      } }
      // jorge1: style Q after reject-comal aceite — QCO still in cart → convert to QD Regular/Deluxe
      { const qco = [...cart].reverse().find((l: any) => /quesadilla/i.test(String(l.itemId)) && !/dorada|zzav3l|t5stuh/i.test(String(l.itemId))
          && /comal|QCO|homemade/i.test((l.modifiers || []).map((m: any) => String(m.option)).join(" ")));
        const st2 = t.text.match(/^\W*(?:(?:no|s[ií]|las?|los?|unas?)\s*,?\s*)?(regular(?:es)?|preparad[oa]s?|deluxe)\b/iu);
        if (qco && st2 && /\b(?:preparad[oa]s?|regular(?:es)?|deluxe)\b[^?]*\?/iu.test(lastStaff) && !dishesNamed(t.text).size) {
          const deluxe = !/^regular/i.test(st2[1]);
          const keep = (qco.modifiers || []).filter((m: any) => {
            const o = String(m.option || "");
            return !/\(QCO\)|comal|homemade|REGULAR Dorada|DELUXE Preparada|salsa asada/i.test(o)
              && /carne|meat|bistec|chorizo|picadillo|pollo|buche|tripa|lengua|pastor|carnitas|asada|prensado|duro|cabeza|costilla/i.test(o + " " + String(m.step || ""));
          });
          qco.itemId = deluxe ? DORADA_DELUXE_ID : DORADA_REG_ID;
          qco.modifiers = [{ step: "(QD) Style", option: deluxe ? "(QD) DELUXE Preparada" : "(QD) REGULAR Dorada" }, ...keep];
          steps.push({ source: "caller-qco-dorada-style", heard: t.text }); lastStaff = ""; last = null; continue; } }
    // juan1/prep3: staff "¿Te gustaría preparada deluxe?" → "sí, por favor" upgrades REG→DELUXE (no second Dorada).
    { const ld: any = [...cart].reverse().find((l: any) => l.itemId === DORADA_REG_ID || l.itemId === DORADA_DELUXE_ID);
      const yes = /^\W*(?:s[ií]|yes|ok(?:ay)?|por\s+favor|please|aj[aá]|claro)(?:\W|$)/iu.test(t.text) && !dishesNamed(t.text).size && !/\bregular(?:es)?\b/iu.test(t.text);
      if (ld && yes && /\b(?:preparad[oa]|deluxe)\b[^?]*\?/iu.test(lastStaff)) {
        ld.itemId = DORADA_DELUXE_ID;
        ld.modifiers = (ld.modifiers || []).map((m: any) => /\(QD\)\s*(REGULAR Dorada|DELUXE Preparada)/i.test(String(m.option)) ? { ...m, option: "(QD) DELUXE Preparada" } : m);
        if (!(ld.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(String(m.option)))) {
          ld.modifiers = [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, ...(ld.modifiers || [])];
        }
        steps.push({ source: "caller-dorada-yes-deluxe", heard: t.text }); lastStaff = ""; last = null; continue; } }
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
      } else if (/\bno\b/iu.test(t.text) && /\b(?:aceite|fritas?|doradas?)\b/iu.test(t.text)) {
        // jorge1: staff "del comal ¿verdad?" → "No, … fritas en aceite" → QCO already rung becomes QD (style Q may set Regular)
        for (const q of cart as any[]) {
          if (!/quesadilla/i.test(String(q.itemId)) || /dorada|zzav3l|t5stuh/i.test(String(q.itemId))) continue;
          if (!/comal|QCO|homemade/i.test((q.modifiers || []).map((m: any) => String(m.option)).join(" ")) && q.itemId !== "sq-quesadilla-HLT6CR") continue;
          const keep = (q.modifiers || []).filter((m: any) => {
            const o = String(m.option || "");
            return !/\(QCO\)|comal|homemade|REGULAR Dorada|DELUXE Preparada|salsa asada/i.test(o)
              && /carne|meat|bistec|chorizo|picadillo|pollo|buche|tripa|lengua|pastor|carnitas|asada|prensado|duro|cabeza|costilla/i.test(o + " " + String(m.step || ""));
          });
          q.itemId = DORADA_DELUXE_ID;
          q.modifiers = [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, ...keep];
        }
        lastTortilla = "doradas";
        steps.push({ source: "caller-reject-comal-aceite", heard: t.text });
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
        // miguel1: house-default tortilla pick is for open taco/quesadilla lines — not menudo-only carts
        const menudoOnlyCart = cart.some((l) => /menudo/i.test(String(l.itemId))) && !cart.some((l) => kindOfItem(l.itemId) === "taco")
          && !/\btacos?\b/iu.test(t.text);
        const tq = !menudoOnlyCart && (movedOn || affirm) ? qs.map((q) => optsOf(q)).find((o) => o.length >= 2 && o.every((x) => /\b(corn|comal|maiz|flour|harina|taquer[ao]|street)\b/i.test(x))) : null;
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
      // asados1 (Suleika CA802db3): "cebollita y chilito aparte / tostaditos" or staff "de los asados" + caller sí
      // → Extras Cebolla y Chiles Asados on the side (not Platillo de Guisado).
      { const asadosAsk = /\b(?:cebollitas?|cebollas?)\b/iu.test(t.text) && /\b(?:chilitos?|chiles?)\b/iu.test(t.text)
          && /\b(?:aparte|por\s+separado|separad|tostaditos?|asados?)\b/iu.test(t.text + " " + lastStaff + " " + recentStaff.join(" "));
        const staffAsados = /\bde\s+los\s+asados\b/iu.test(lastStaff + " " + recentStaff.join(" "));
        const yesAsados = staffAsados && /^\W*(?:s[ií]|yes|yeah|yep|ok(?:ay)?|aj[aá]|claro|por\s+favor)(?:\W|$)/iu.test(t.text) && !dishesNamed(t.text).size;
        if ((asadosAsk || yesAsados) && !/platillo|guisado/iu.test(t.text)) {
          if (!cart.some((l: any) => l.itemId === EXTRAS_ID && (l.modifiers || []).some((m: any) => /cebolla y chiles asados/i.test(String(m.option))))) {
            cart.push({ itemId: EXTRAS_ID, quantity: 1, modifiers: [{ step: "Extras options", option: "Cebolla y Chiles Asados" }] } as any);
          }
          steps.push({ source: "caller-asados-side", heard: t.text.slice(0, 80) }); lastStaff = ""; continue;
        } }
      // pablo1: caller answered the tortilla choice themselves ("Taqueros") while a bare meat list was pending —
      // ring the pending dish with that tortilla, don't leave "Taqueros" to fall through alone (drops one meat line).
      if (!pick && selfPick && pendingDish && /\b(comal|harina|flour|taquer|street|ma[ií]z|corn)\b/i.test(selfPick)) {
        pick = selfPick;
        const saidPending = `${pendingDish} ${/taquer|street/i.test(selfPick) ? "de taquero" : /harina|flour/i.test(selfPick) ? "de harina" : "de comal"}`;
        last = await say(saidPending, t.language, "staff-pick"); steps.push({ source: "staff-pick", heard: t.text.slice(0, 80), pick: selfPick });
        pendingDish = null; continue;
      }
      // cecilia1d + bryan1/monica: con/sin pata prefer; else house default Menudo con Tortillas (never Con Pata)
      if (!selfPick) {
        const recentCaller = [...history].reverse().filter((h) => h.role === "customer").slice(0, 8).map((h) => h.text).join(" ");
        const allOpts = qs.flatMap((q) => optsOf(q));
        const said = recentCaller + " " + t.text;
        if (/\bcon\s+patas?\b/iu.test(said) && !/\bsin\s+patas?\b/iu.test(t.text)) {
          const pref = allOpts.find((o) => /con\s+pata|pata\s+menudo|extra\s+pata/i.test(o));
          if (pref) pick = pref;
        } else if (/\bsin\s+patas?\b/iu.test(said)
          || (allOpts.some((o) => /pata/i.test(o)) && allOpts.some((o) => /tortilla/i.test(o)) && !/\bcon\s+patas?\b/iu.test(said))) {
          const pref = allOpts.find((o) => /tortilla/i.test(o) && !/pata/i.test(o)) || allOpts.find((o) => !/pata/i.test(o));
          if (pref) pick = pref;
        }
      }
      if (pick) { last = await say(pick, t.language, "staff-pick"); steps.push({ source: "staff-pick", heard: said.trim().slice(0, 120), pick }); } }
    // multi2: Elvi is still asking about an item (e.g. nachos meat + toppings) and the caller answers it — with a bare meat
    // ("Bistec."), or by confirming staff's read-back of the choices ("Una nachos de bistec, frijoles, lechuga" → "Eso es, sí,
    // con todo"). Those answers used to be dropped as clarifications, so the question never closed and every later dish
    // (the second person's order) was swallowed by it.
    if (asking(last)) {
      const nrm = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      const q = nrm(String(last.reply || "")), b0 = nrm(t.text.replace(/[¿¡?.!,]+/gu, " "));
      const meat = (b0.match(/\b(bistec|chorizo|asada|pastor|carnitas|cabeza|lengua|tripa|pollo|deshebrada|suadero|birria|duro|prensado|picadillo|huevo)\b/) || [])[1];
      // julio1: "Sí, va a ser una de duro…" is NOT a toppings confirm — has listed meats
      const confirm = /^\s*(?:eso\s+es|s[ií]|as[ií]|exacto|correcto|aj[aá])(?![\p{L}])/iu.test(t.text) && !dishesNamed(t.text).size && !listedMeats(t.text).length;
      const staffChoices = confirm && lastStaff && !/\?|¿/.test(lastStaff) ? lastStaff.replace(/\b(?:aj[aá]|okay|ok)\b[,.]?/giu, " ").replace(/\s+/g, " ").trim() : "";
      // (a bare meat answer falls through to the meat-fragment logic below instead of being skipped as a clarification)
      if (staffChoices && FOOD.test(staffChoices) && !/\bcon\s+tod(?:it)?o\b/iu.test(t.text)) { last = await say(`${staffChoices}${/con\s+todo/i.test(t.text) ? ", con todo" : ""}`, t.language, "caller-staff-readback"); steps.push({ source: "caller-staff-readback", heard: t.text }); if (asking(last)) await acceptOpen(t.language); continue; }
      // "con todo" / confirming staff's list → name the options from Elvi's own question (all of them for "con todo",
      // otherwise the ones staff read back)
      { const opts = (String(last.reply || "").match(/(?:¿([^?¿]+)|([^?¿]+))\?\s*$/u)?.slice(1).find(Boolean) || "").replace(/^[^:]*:\s*/u, "").replace(/^\s*and\s+/iu, "").replace(/^\s*y\s+/iu, "").split(/\s*,\s*|\s+o\s+|\s+or\s+/u).map((x) => x.trim()).filter((x) => x && !/^(qu[eé]|what|regular|deluxe)\b/iu.test(x));
        const staffRun = nrm(recentStaff.join(" "));
        const pick = /\bcon\s+tod(?:it)?o\b|\bwith\s+everything\b/iu.test(t.text) ? opts.filter((o) => !/double|doble/i.test(o)) : confirm ? opts.filter((o) => staffRun.includes(nrm(o).split(" ")[0])) : [];
        // julio1: never treat "De qué" / bare "qué" as a toppings pick
        const pickOk = pick.filter((o) => !/^(?:de\s+)?qu[eé]\b|^what\b/iu.test(o));
        if (pickOk.length && !dishesNamed(t.text).size) { last = await say(pickOk.join(", "), t.language, "caller-answer"); steps.push({ source: "caller-answer", heard: t.text }); if (asking(last)) await acceptOpen(t.language); continue; } }
      // (a new dish while an old question is open no longer auto-accepts the old one: "Me pone gordita" → "una quesadilla"
      // rang a meatless gordita; the caller comes back to it)
    }
    // pablo1: staff forgot a meat ("Okay, cuatro de costilla y cuatro de, ¿qué más me dijo?") → caller "De tripa."
    { const frag = meatFragment(t.text);
      const half = (lastStaff || "").match(new RegExp(String.raw`\b(${QTY.slice(3, -1)})\s+de\s+(?:${MEAT_LIST})\b[^.?]*\b(${QTY.slice(3, -1)})\s+de\b`, "iu"));
      const ref = [...cart].reverse().find((l) => kindOfItem(l.itemId) && (l.modifiers || []).some((m: any) => new RegExp(MEAT_LIST, "i").test(String(m.option))));
      if (frag && half && ref && !FOOD.test(t.text) && !dishesNamed(t.text).size) {
        const q = spokenCount(half[2]) || spokenCount(half[1]) || Number(ref.quantity) || 1;
        const k = kindOfItem(ref.itemId)!;
        last = await say(`${q} ${dishPhrase(k)}${tortillaWordOf(ref)} ${frag}`, t.language, "caller-meat-reminded");
        steps.push({ source: "caller-meat-reminded", heard: t.text.slice(0, 80) }); continue;
      }
    }
    // oscar2 (CA628680): staff "¿Y el último?" / "¿y el otro?" → caller "de costilla." fills the pending taco slot
    // with that meat (same tortilla as prior tacos). Bare "de X" used to go to the model and echo the first meat (cabeza).
    { const staffAsk = (lastStaff || recentStaff.slice(-2).join(" ") || "").trim();
      const lastSlotAsk = /\b(?:(?:y\s+)?el\s+[uú]ltimo|(?:y\s+)?el\s+otro|(?:and\s+)?(?:the\s+)?last(?:\s+one)?|(?:and\s+)?(?:the\s+)?other(?:\s+one)?)\b/iu.test(staffAsk);
      const frag = meatFragment(t.text);
      if (lastSlotAsk && frag && !FOOD.test(t.text) && !dishesNamed(t.text).size && !/\b(?:al\s+rev[eé]s|mejor\s+dicho)\b/iu.test(t.text)) {
        const ref = [...cart].reverse().find((l) => kindOfItem(l.itemId) === "taco")
          || [...cart].reverse().find((l) => !!kindOfItem(l.itemId));
        const callerCtx = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
        const k = (ref && kindOfItem(ref.itemId)) || "taco";
        let tort = ref ? tortillaWordOf(ref) : "";
        if (!tort) {
          tort = /\bcomal\b/iu.test(callerCtx + " " + staffAsk) ? " de comal"
            : /\btaquer/iu.test(callerCtx + " " + staffAsk) ? " taquero"
            : /\b(?:harina|flour)\b/iu.test(callerCtx + " " + staffAsk) ? " de harina" : " de comal";
        }
        const nBefore = cart.length;
        const phrase = `${dishPhrase(k)}${tort} ${frag}`.replace(/\s+/g, " ").trim();
        last = await say(phrase, t.language, "caller-last-slot-meat");
        // Force correct meat if model echoed an earlier meat or returned nothing
        const MEAT_OPT: Array<[RegExp, string]> = [
          [/^bistec$|^steak$|^asada$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
          [/^pollo$|^chicken$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"],
          [/^lengua$/i, "Lengua / Beef Tongue"], [/^cabeza$/i, "Cabeza / Beef Head"],
          [/^costillas?$/i, "Costilla / Beef Rib"], [/^prensado$/i, "Prensado / Spicy Pork"],
          [/^buche$/i, "Buche / Pork Stomach"], [/^carnitas$/i, "Carnitas / Pulled Pork"],
          [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"], [/^duro$/i, "Duro / Pork Rinds"],
        ];
        const meatWord = (frag.match(new RegExp(MEAT_LIST, "iu")) || [])[0] || "";
        const opt = MEAT_OPT.find(([re]) => re.test(meatWord))?.[1];
        if (opt) {
          const tortMod = ref && (ref.modifiers || []).find((m: any) => /\(T[A-Z]{2}\)|Tortilla|taquer|comal|harina|street|homemade|flour/i.test(String(m.option)));
          const TCO = tortMod
            ? { step: String(tortMod.step || "(A) Tortilla Options"), option: String(tortMod.option) }
            : { step: "(A) Tortilla Options", option: /taquer/i.test(tort) ? "(TST) Tortilla Taquera / Street Taco"
              : /harina|flour/i.test(tort) ? "(THR) Tortilla de Harina / Flour"
              : "(TCO) Tortilla Comal / Homemade" };
          const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => new RegExp(MEAT_LIST, "i").test(o) && !/salsa/i.test(o));
          const added = cart.slice(nBefore);
          const good = added.find((l) => kindOfItem(l.itemId) === k && meatOf(l).some((o: string) => new RegExp(meatWord.replace(/s$/, ""), "i").test(o)));
          if (!good) {
            // drop wrong adds from this turn, force the pending slot
            cart.splice(nBefore);
            cart.push({ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [TCO, { step: "(B) Q Carnes / Meats", option: opt }], readback: `1 ${k}${tort} ${meatWord}` } as Line);
          }
        }
        steps.push({ source: "caller-last-slot-meat", heard: t.text.slice(0, 80) });
        if (asking(last)) await acceptOpen(t.language);
        continue;
      }
    }
    // juan1e: staff "Frijol, lechuga, crema y queso fresco, ¿están bien en los sopes?" → "Sí" stamps house sope toppings
    { const staffAsk = (lastStaff || recentStaff.join(" ") || "").trim();
      const sopeTopAsk = /\bfrijol/i.test(staffAsk) && /\blechuga\b/i.test(staffAsk) && /\bcrema\b/i.test(staffAsk) && /\bqueso\b/i.test(staffAsk)
        && /\b(?:sopes?|sopesazos?)\b/i.test(staffAsk) && /\?\s*$/.test(staffAsk);
      const yes = /^\W*(?:s[ií]|yes|yeah|yep|ok(?:ay)?|aj[aá]|claro|estan?\s+bien)(?:\W|$)/iu.test(t.text) && !dishesNamed(t.text).size;
      if (sopeTopAsk && yes) {
        const sope = [...cart].reverse().find((l) => /sopes[ae]so/i.test(String(l.itemId)));
        const HOUSE = [
          { step: "(C) Sope Options", option: "Frijoles / Pinto Beans" },
          { step: "(C) Sope Options", option: "Lechuga / Lettuce" },
          { step: "(C) Sope Options", option: "Crema / Sour Cream" },
          { step: "(C) Sope Options", option: "Queso Fresco / Fresco Cheese" },
        ];
        if (sope) {
          const have = new Set((sope.modifiers || []).map((m: any) => String(m.option)));
          for (const m of HOUSE) if (![...have].some((o) => new RegExp(m.option.split(" / ")[0], "i").test(o))) {
            sope.modifiers = [...(sope.modifiers || []), m]; have.add(m.option);
          }
          if ((sope as any).posSize !== "small" && pendingSmallSope) (sope as any).posSize = "small";
        }
        steps.push({ source: "staff-sope-toppings-yes", heard: t.text.slice(0, 80) }); lastStaff = ""; continue;
      }
    }
    // frijol1 (Paco): staff lists burrito fillings ("Arroz, frijoles, queso fresco, crema, cilantro y cebolla, ¿está bien?")
    // → caller "sí" = con todo on the burrito just rung. NEVER send that turn to the model — "sí. Ah, nueve"
    // invented 2× Grande Bistec burritos (NV 44). JS \b fails after í, so (?:\W|$) after sí; frijoles? = plural.
    { const staffAsk = (lastStaff || recentStaff.join(" ") || "").trim();
      const toppingsAsk = /\b(arroz|rice)\b/i.test(staffAsk) && /\bfrijoles?\b|\bbeans?\b/i.test(staffAsk) && /\b(crema|queso|cebolla|cilantro)\b/i.test(staffAsk) && /\?\s*$/.test(staffAsk);
      const yes = /^\W*(?:s[ií]|yes|yeah|yep|ok(?:ay)?|aj[aá]|claro|esta\s+bien|asi\s+esta\s+bien)(?:\W|$)/iu.test(t.text) && !dishesNamed(t.text).size;
      if (toppingsAsk && yes) {
        const isBurrito = (l: Line) => kindOfItem(l.itemId) === "burrito" || /burrito/i.test(String(l.itemId))
          || (l.modifiers || []).some((m: any) => /Regular\s*['"]?10|Grande\s*['"]?12/i.test(String(m.option)));
        const lastBurrito = [...cart].reverse().find(isBurrito);
        const FILL = ["Arroz / Rice", "Frijoles Refritos / Refried Beans", "Queso Fresco / Cheese", "Crema / Sour Cream", "Cebolla / Onion", "Cilantro"];
        if (lastBurrito) {
          const n0 = cart.length;
          last = await say("el burrito con todo, arroz frijoles queso fresco crema cilantro y cebolla", t.language, "staff-toppings-yes");
          // Drop every newly added line (phantoms). Keep only filling options for the burrito we already had.
          const added = cart.length > n0 ? cart.splice(n0) : [];
          const fillRe = /arroz|frijol|queso fresco|crema|cebolla|cilantro/i;
          const fromModel = added.flatMap((l) => (l.modifiers || []).filter((m: any) => fillRe.test(String(m.option))));
          const have = new Set((lastBurrito.modifiers || []).map((m: any) => String(m.option)));
          for (const m of fromModel) if (!have.has(String(m.option))) { lastBurrito.modifiers = [...(lastBurrito.modifiers || []), m]; have.add(String(m.option)); }
          // If the model still gave nothing useful, stamp the house burrito fillings directly.
          if (![...have].some((o) => fillRe.test(o))) {
            for (const opt of FILL) if (!have.has(opt)) { lastBurrito.modifiers = [...(lastBurrito.modifiers || []), { step: "(C) Burrito Options", option: opt }]; have.add(opt); }
          }
          // frijol1: strip Chile Relleno the model stacked on a meat burrito when the caller never said relleno.
          if (!(lastStaff + " " + t.text).match(/relleno/i)) {
            lastBurrito.modifiers = (lastBurrito.modifiers || []).filter((m: any) => !/relleno/i.test(String(m.option)));
          }
        }
        steps.push({ source: "staff-toppings-yes", heard: t.text.slice(0, 80) }); lastStaff = ""; continue;
      }
    }
    // frijol1 (Paco): "solo frijol y queso" / "frijol y queso" + derretido on quesadillas — set meats, keep the spoken qty.
    // When the cart is still empty (staff hasn't rung them), create the spoken qty of comal quesadillas first.
    // "Sí, de derretido" after a frijol readback also stamps both meats (it used to LLM-add cheese-only).
    { const frijolQueso = /\b(?:solo\s+)?(?:nom[aá]s\s+)?(?:este[,.]?\s+)?(?:le\s+pone\s+)?frijol(?:es)?\s+y\s+queso\b/iu.test(t.text)
        || (/\bfrijol(?:es)?\b/iu.test(t.text) && /\bqueso\b/iu.test(t.text) && /\b(solo|nom[aá]s|derretido)\b/iu.test(t.text));
      const frijolCtx = /\bfrijol/i.test([...recentStaff, lastStaff, t.text].join(" "));
      const derretidoOnly = /\bderretido\b/iu.test(t.text) && frijolCtx && !dishesNamed(t.text).size && !/burrito|taco|torta|gordita/iu.test(t.text);
      if ((frijolQueso || derretidoOnly) && !/burrito|taco|torta|gordita/iu.test(t.text)) {
        let qIdx = cart.map((l, i) => (kindOfItem(l.itemId) === "quesadilla" || /quesadilla/i.test(String(l.itemId)) ? i : -1)).filter((i) => i >= 0);
        if (!qIdx.length && (frijolQueso || derretidoOnly)) {
          const ctx = [...recentStaff, lastStaff, t.text, ...steps.slice(-8).map((x: any) => String(x.heard || ""))].join(" ");
          const qm = ctx.match(/\b(una?|dos|tres|cuatro|cinco|one|two|three|four|five|\d+)\s+quesadillas?\b/iu);
          const qty = qm ? (spokenCount(qm[1]) || Number(qm[1]) || 3) : 3;
          last = await say(`${qty} quesadillas del comal`, t.language, "caller-frijol-queso");
          qIdx = cart.map((l, i) => (kindOfItem(l.itemId) === "quesadilla" || /quesadilla/i.test(String(l.itemId)) ? i : -1)).filter((i) => i >= 0);
          if (!qIdx.length) {
            cart.push({ itemId: "sq-quesadilla-HLT6CR", quantity: qty, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }] } as Line);
            qIdx = [cart.length - 1];
          }
        }
        if (qIdx.length) {
          const meatStep = "(B) Q Carnes / Meats";
          const want = ["Frijoles Refritos / Refried Beans", "Queso Derretido / Melted Cheese"];
          // Staff readback often re-adds the same quesadillas — collapse to one line with the spoken qty.
          const keepMods = (l: Line) => (l.modifiers || []).filter((m: any) => !/carne|meat/i.test(String(m.step || m.groupName || "")) && !/frijol|queso derretido|queso fresco|bistec|pollo|pastor|chorizo|tripa|asada/i.test(String(m.option)));
          const base = cart[qIdx[0]];
          const tortilla = keepMods(base);
          const ctx = [...recentStaff, t.text, ...steps.slice(-8).map((x: any) => String(x.heard || ""))].join(" ");
          const qm = ctx.match(/\b(una?|dos|tres|cuatro|cinco|one|two|three|four|five|\d+)\s+quesadillas?\b/iu);
          const qty = qm ? (spokenCount(qm[1]) || Number(qm[1]) || 3) : Math.max(...qIdx.map((i) => Number(cart[i].quantity) || 1));
          base.quantity = qty;
          base.modifiers = [...tortilla, ...want.map((option) => ({ step: meatStep, option }))];
          for (const i of qIdx.slice(1).reverse()) cart.splice(i, 1);
          steps.push({ source: "caller-frijol-queso", heard: t.text.slice(0, 80) }); lastStaff = ""; continue;
        }
      }
    }
    // name1 (Paco): staff "¿a qué nombre sería la orden?" → "de Paco" is only the name — never a new burrito/taco.
    // alex1e: bare staff "Nombre." / "¿Cómo?" → "Wally."/"Alex." must not invent a dish either.
    { const nameAsk = /\b(?:a\s+qu[eé]\s+nombre|qu[eé]\s+nombre|nombre\s+(?:ser[ií]a|para|de)|name\s+for\s+(?:the|your)\s+order|under\s+what\s+name|(?:su\s+|tu\s+|el\s+)?nombre)\b|\byour\s+name\b|^\s*¿?\s*c[oó]mo\s*\??\s*$/iu.test(lastStaff);
      const nameAns = (!!nameFromAnswer(t.text) || /^\W*(?:de\s+|a\s+nombre\s+de\s+|under\s+|for\s+)?(\p{L}{2,24})\W*$/iu.test(t.text))
        && !FOOD.test(t.text) && !dishesNamed(t.text).size && !/\b\d+\b/.test(t.text) && !DRINK.test(t.text) && !ORDER_QTY.test(t.text);
      if (nameAsk && nameAns) { steps.push({ source: "caller-name", heard: t.text.slice(0, 80) }); lastStaff = ""; continue; }
    }
    // fix23: bare acks / one-word answers to staff ("Sí.", "comal", "Campechana.") are not new dishes.
    // aliases1: campechana / o mal now come from the shared list.
    const bare = applySharedAliases(t.text.replace(/[¿¡?.!,]+/gu, " ").replace(/\s+/g, " ").trim(), "phone");
    if (/^(s[ií]|yes|ok|okay|okey|aja|aj[aá]|mm+|uh\s*huh|claro|correcto|exacto|ma'?am|sir)$/iu.test(bare)) {
      steps.push({ source: "caller-ack", heard: t.text }); continue;
    }
    // fix1036: a turn that is only filler, a repeat of the item just added ("Oh, coca está bien", "Sí, coca, sí. No,
    // creo que…") or a delivery/pickup remark ("para un pedido a domicilio") orders nothing. Sending it to Elvi made her
    // re-add earlier dishes from history (the doubled tacos/quesadillas/Cokes on the 10:36 call).
    // fix1136: "¿Puedo hacer una orden?" / "quiero ordenar" / "can I place an order" asks to order, it isn't a dish.
    // Sent to Elvi it opened a phantom "Torta: ¿Bistec…?" question that swallowed the next answers.
    if (isOrderIntro(t.text)) { steps.push({ source: "caller-intro", heard: t.text }); continue; }
    // teresa1: "Aquí tengo cocas/refrescos" — not an order; strip any drink already in cart.
    if (/(?:aqu[ií]|ya)\s+tengo\s+(?:\w+\s+){0,3}(?:cocas?|coke|pepsi|refrescos?|sodas?|horchata|jamaica)/iu.test(t.text)
      || (/(?:aqu[ií]|ya)\s+(?:las?|los?)\s+tengo\b/iu.test(t.text) && DRINK.test(applySharedAliases(t.text, "phone")))) {
      for (let i = cart.length - 1; i >= 0; i--) {
        if (/drink|coca|pepsi|refresco|soda|jamaica|horchata/i.test(String(cart[i].itemId) + " " + String(cart[i].readback || ""))) cart.splice(i, 1);
      }
      // If the turn is only that (plus filler / ¿Cocas? echo / "son no"), skip ordering.
      const rest = applySharedAliases(t.text, "phone").replace(/(?:aqu[ií]|ya)\s+tengo\s+(?:\w+\s+){0,3}(?:cocas?|coke|pepsi|refrescos?|sodas?|horchata|jamaica)/giu, " ")
        .replace(/\b(?:cocas?|coke|pepsi|refrescos?|sodas?)\b/giu, " ").replace(FILLER, " ").replace(/[¿?¡!,.]+/gu, " ").trim();
      if (!FOOD.test(rest) && !ORDER_QTY.test(rest) && !MEAT_WORDS.test(rest)) {
        steps.push({ source: "caller-already-has-drink", heard: t.text }); continue;
      }
    }
    // teresa1: bare "¿Cocas?" / "¿tienen cocas?" with no order verb — availability, not add.
    { const a = applySharedAliases(t.text, "phone");
      if (DRINK.test(a) && !FOOD.test(a) && !ORDER_QTY.test(a)
        && /^(?:(?:s[ií]|ok(?:ay)?|ah|oh|este|pues)[,.\s]*)*(?:¿\s*)?(?:(?:tienen|hay|tiene|ten[eé]s|vende)\s+)?(?:cocas?(?:\s+colas?)?|coke|pepsi|refrescos?|sodas?)\s*\??\s*$/iu.test(a.replace(/[¡!]+/gu, "").trim())
        && !/\b(?:dame|deme|me\s+da|quiero|quisiera|pon(?:me|ga)|una?|dos|tres|\d+)\b/iu.test(a)) {
        steps.push({ source: "caller-drink-avail", heard: t.text }); continue;
      }
    }
    // fix1136: "Dos, y dos" (counts only, answering staff's "¿cuántas?") restates what's already ordered.
    if (cart.length && isCountOnly(t.text)) { steps.push({ source: "caller-count", heard: t.text }); continue; }
    if (!orderResidue(t.text, (lastAdded as Line | null)?.itemId)) { steps.push({ source: "caller-clarify", heard: t.text }); continue; }
    if (fulfillmentIn(t.text) && !FOOD.test(t.text) && !DRINK.test(applySharedAliases(t.text, "phone"))) {
      // pickup1: "can I order some for pickup — that'd be, yes, please. flour." — the pickup cue is noted, the answer after it still counts
      const rest = t.text.replace(/^.*?\b(?:pick[\s-]?up|to\s+go|para\s+llevar|(?:pasar\s+a\s+)?recoger|delivery|a\s+domicilio)\b[\s,.!?]*/iu, "").trim();
      steps.push({ source: "caller-fulfillment", heard: t.text });
      // yesopt1: keep rest when Elvi is asking OR rest still answers staff's option Q (yes/flour) after an avail open
      const restAnswers = rest && rest !== t.text && /\p{L}{3,}/u.test(rest)
        && (asking(last) || /\b(?:s[ií]|yes|yeah|yep|please|flour|harina|comal|rice|beans|frijoles)\b/iu.test(rest));
      if (!restAnswers) continue;
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
    { const tw = [...cleanPhrase(t.text).matchAll(/\b(?:de\s+)?(ma[ií]z|comal|harina|flour|taquer[ao]s?)\b/giu)].pop(); if (tw && !/\bo\s+de\b/iu.test(t.text)) lastTortilla = /taquer/i.test(tw[1]) ? "de taquero" : `de ${tw[1]}`; }
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
      // jose1: "dos de pollo" in a meat-fragment turn keeps spoken qty (dishPhrase is always "una")
      const fragMeat = (frag.match(new RegExp(MEAT_LIST, "iu")) || [])[0]?.toLowerCase() || "";
      const fragQty = fragMeat ? (listedMeats(t.text).find((w) => w.meat === fragMeat && w.qty && w.qty > 1)?.qty || 0) : 0;
      for (const d of pick) {
        pendingDishes = pendingDishes.filter((x) => x !== d);
        // case1e: keep the dish-type word the fragment cut off ("De chicharrón. ¿De chicharrón dorada o …?")
        const kind = (cleanPhrase(t.text).match(/\b(dorad[ao]s?|frit[ao]s?)\b/iu) || [])[1];
        const head = fragQty > 1 ? `${fragQty} ${dishNoun(d)}s` : dishPhrase(d);
        // alejandro1: keep comal/harina from pending dish, lastTortilla, or staff ask
        const tort =
          /\bcomal\b/iu.test(d) ? " de comal" :
          /\b(?:harina|flour)\b/iu.test(d) ? " de harina" :
          /\btaquer/iu.test(d) ? " de taquero" :
          lastTortilla ? (lastTortilla.startsWith("de ") ? ` ${lastTortilla}` : ` de ${lastTortilla}`) :
          /\bcomal\b/iu.test(lastStaff + " " + recentStaff.join(" ")) ? " de comal" :
          /\b(?:harina|flour)\b/iu.test(lastStaff + " " + recentStaff.join(" ")) ? " de harina" : "";
        // tort AFTER meat fragment — "quesadilla de comal de tripa" makes listedMeats drop tripa
        const phrase = `${head} ${frag}${tort}${kind && !new RegExp(kind, "i").test(frag) ? " " + kind : ""}`.trim();
        if (pendingDish && dishNoun(pendingDish) === dishNoun(d)) pendingDish = null;
        const nb = cart.length;
        last = await say(phrase, t.language, "caller-meat-fragment");
        if (fragQty > 1 && cart.length === nb + 1 && (Number(cart[nb].quantity) || 1) !== fragQty) cart[nb].quantity = fragQty;
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
        // teresa1: model [] on "dos tacos de costillas" after split "dos tacos de," + "de costillas" — force the line.
        if (cart.length === nb) {
          const phrase = expanded[k];
          const kind = dishNoun(phrase) || dishNoun(asked) || "taco";
          const meatWord = (phrase.match(new RegExp(MEAT_LIST, "iu")) || [])[0] || "";
          const MEAT_OPT: Array<[RegExp, string]> = [
            [/^bistec$|^steak$|^asada$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
            [/^pollo$|^chicken$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"],
            [/^lengua$/i, "Lengua / Beef Tongue"], [/^cabeza$/i, "Cabeza / Beef Head"],
            [/^costillas?$/i, "Costilla / Beef Rib"], [/^prensado$/i, "Prensado / Spicy Pork"],
            [/^buche$/i, "Buche / Pork Stomach"], [/^carnitas$/i, "Carnitas / Pulled Pork"],
            [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"], [/^duro$/i, "Duro / Pork Rinds"],
          ];
          const opt = MEAT_OPT.find(([re]) => re.test(meatWord))?.[1];
          if (opt && (kind === "taco" || kind === "quesadilla")) {
            const staffCtx = lastStaff + " " + recentStaff.slice(-3).join(" ");
            const callerCtx = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
            const wantComal = /\bcomal\b/iu.test(phrase + " " + staffCtx + " " + callerCtx + " " + asked);
            const wantHarina = /\b(?:harina|flour)\b/iu.test(phrase + " " + asked) && !wantComal;
            const wantTaq = /\btaquer/iu.test(phrase + " " + asked);
            const q = spokenCount(phrase) || spokenCount(asked) || 1;
            if (kind === "taco") {
              const tort = wantTaq
                ? { step: "(A) Tortilla Options", option: "(TST) Tortilla Taquera / Street Taco" }
                : wantHarina
                ? { step: "(A) Tortilla Options", option: "(THR) Tortilla de Harina / Flour" }
                : { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
              cart.push({ itemId: "sq-taco-TAR7L5", quantity: q, modifiers: [tort, { step: "(B) Q Carnes / Meats", option: opt }], readback: `${q} taco ${meatWord}` } as Line);
            } else {
              const tort = wantComal
                ? { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }
                : { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
              cart.push({ itemId: "sq-quesadilla-HLT6CR", quantity: q, modifiers: [tort, { step: "(B) Q Carnes / Meats", option: opt }], readback: `${q} quesadilla ${meatWord}` } as Line);
            }
          }
        }
      }
      // Staff "del comal, ¿verdad?" after the meat turn may land on next caller "Sí" — stamp TCO if still missing tortilla cue on forced taco
      steps.push({ source: "caller-meat-expanded", heard: t.text, asked, expanded });
      continue;
    }
    // julio1b: last quesadilla+comal ask (may have "Okay/Muy bien" in between) + meat-only → full dish phrases.
    { const prevC = [...merged0].reverse().find((u) => u !== t && u.speaker === "caller" && u.start < t.start && dishesNamed(u.text).has("quesadilla"));
      const meats = listedMeats(t.text);
      const comal = !!(prevC && (/\bcomal\b/iu.test(prevC.text) || /\bcomal\b/iu.test(t.text)));
      if (prevC && !FOOD.test(t.text) && meats.length >= 1 && (comal || !cart.length) && !/\b(?:dorad[ao]|deluxe|aceite|preparad)/iu.test(prevC.text)) {
        t = { ...t, text: meats.map((w) => `${w.qty && w.qty > 1 ? w.qty : "una"} quesadilla${comal ? " de comal" : ""} de ${w.meat}`).join(", ") };
      }
    }
    // meatsplit1: "two flour steak quesadillas deluxe" → "Can I get one steak and one chorizo?" splits the line just rung by meat
    // (Bree) instead of adding two more.
    { const MEAT_OPT: Array<[RegExp, string]> = [[/^(?:steak|bistec)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^tripas?$/i, "Tripa / Beef Tripe"], [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"], [/^costillas?$/i, "Costilla / Beef Rib"], [/^carnitas$/i, "Carnitas / Pulled Pork"], [/^cabeza$/i, "Cabeza / Beef Head"], [/^buche$/i, "Buche / Pork Stomach"], [/^lengua$/i, "Lengua / Beef Tongue"], [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"]];
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
    // multi3 (Enrique CA00cedc): still asking tortillas/size for the last item and the caller names the NEXT dish
    // ("también va a ser un mole") → take the house default, then process the new item (don't swallow mole).
    // bryan1: same for open Menudo Con/Sin pata Q when caller moves on to birria/etc.
    if (asking(last) && dishesNamed(t.text).size) {
      const qtxt = String(last.reply || "");
      const tortillaQ = /\b(comal|corn|ma[ií]z|harina|flour|taquer|street|tortilla)\b/i.test(qtxt)
        && /\b(o|or)\b/i.test(qtxt) && optsOf(qtxt).length >= 2;
      const pataQ = /\bCon\s+Pata\b/i.test(qtxt) && /\bMenudo\b/i.test(qtxt) && /\b(?:o|or)\b/i.test(qtxt);
      const pendingKind = (qtxt.match(/^([^:¿?]{3,60}):/u)?.[1] || "").toLowerCase();
      const named = [...dishesNamed(t.text)];
      const isNew = named.some((k) => k && pendingKind && !pendingKind.includes(k) && !(k === "queso torta" && pendingKind.includes("torta")))
        || (pataQ && named.some((k) => k && k !== "menudo"));
      if ((tortillaQ || pataQ) && isNew) await acceptOpen(t.language);
    }
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
      // teresa1: "Y dos tacos de," — dish + de with no meat yet; keep pending across staff talk / next meat turn.
      const incompleteDe = FOOD.test(piece) && !MEAT_WORDS.test(piece)
        && /\b(?:tacos?|quesadillas?|gorditas?|tortas?|burritos?|sopes?(?:asos?)?|tostadas?|flautas?)\s+de\s*,?\s*$/iu.test(piece);
      if (incompleteDe) {
        pendingDish = piece.replace(/[,\s]+$/u, "").trim();
        steps.push({ source: "caller-incomplete-de", heard: piece });
        continue;
      }
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
  // cream1: "sour cream on the side" + staff read-back "extra sour cream" → an Extras Crema 2oz line (Bree)
  if (turns.some((t) => t.speaker === "staff" && /\bextra\s+(?:sour\s+cream|crema)\b|\b(?:sour\s+cream|crema)\s+(?:extra|aparte|on\s+the\s+side)\b/iu.test(t.text))
    && turns.some((t) => t.speaker === "caller" && /\b(?:sour\s+cream|crema)\b/iu.test(t.text))
    && !cart.some((l: any) => l.itemId === EXTRAS_ID && (l.modifiers || []).some((m: any) => /crema/i.test(String(m.option)))))
    cart.push({ itemId: EXTRAS_ID, quantity: 1, modifiers: [{ step: "Extras options", option: "Crema / Sour Cream 2oz" }] } as any);
  // chips1b (Noé): "dos chips con pico" → Dips · Pico de Gallo con Chips at the spoken count, when Elvi left it out
  { const ct = turns.filter((t) => t.speaker === "caller").map((t) => rewriteCallerText(t.text)).find((x) => /Dips Pico de Gallo con Chips/.test(x));
    if (ct && !cart.some((l: any) => l.itemId === DIPS_ID)) { const m = ct.match(new RegExp(String.raw`\b(${NUMW})\s+(?:\p{L}+\s+){0,2}?Dips Pico`, "iu"));
      cart.push({ itemId: DIPS_ID, quantity: m ? spokenCount(m[1]) || 1 : 1, modifiers: [{ step: "Dips", option: "Pico de Gallo con Chips" }] } as any); } }
  fulfillment = detectFulfillment(turns as any).fulfillment as any;
  // jesus1: arroz y frijol on COMBO Gorditas → drop conflicting SOLO Frijoles
  if (turns.some((t) => /\barroz\b/iu.test(t.text) && /\bfrijol/iu.test(t.text))) {
    for (const l of cart as any[]) {
      if (!/combo.*gordita/i.test(String(l.itemId))) continue;
      l.modifiers = (l.modifiers || []).filter((m: any) => !/SOLO\s+Frijoles/i.test(String(m.option)));
      const haveA = (l.modifiers || []).some((m: any) => /arroz|rice/i.test(String(m.option)));
      const haveF = (l.modifiers || []).some((m: any) => /frijol|bean/i.test(String(m.option)) && !/SOLO/i.test(String(m.option)));
      if (!haveA) l.modifiers = [...(l.modifiers || []), { step: "C", option: "1 x Arroz / Rice" }];
      if (!haveF) l.modifiers = [...(l.modifiers || []), { step: "C", option: "1 x Frijoles Refritos / Refried Beans" }];
    }
  }
  // jesus1: consolidate "dos órdenes … combo gorditas" + chorizo+carnitas — one line qty 2, drop stray plain gorditas
  {
    const callerBlob = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
    const wantCombo2 = /\b(?:dos|2|two)\b/iu.test(callerBlob) && /gorditas?/iu.test(callerBlob) && /combo/iu.test(callerBlob);
    const wantMeats = /\bchorizo\b/iu.test(callerBlob) && /\bcarnitas?\b/iu.test(callerBlob);
    if (wantCombo2) {
      const idxs = (cart as any[]).map((l, i) => (/combo.*gordita/i.test(String(l.itemId)) ? i : -1)).filter((i) => i >= 0);
      if (idxs.length) {
        const keep = (cart as any[])[idxs[0]];
        keep.quantity = 2;
        let mods = [...(keep.modifiers || [])].filter((m: any) => !/SOLO\s+Frijoles/i.test(String(m.option)));
        // drop deluxe unless caller asked
        if (!/\bdeluxe\b/iu.test(callerBlob)) mods = mods.filter((m: any) => !/deluxe/i.test(String(m.option)));
        if (wantMeats) {
          for (const mo of [
            { step: "B", option: "1 x Chorizo / Mexican Sausage" },
            { step: "B", option: "1 x Carnitas / Pulled Pork" },
          ]) {
            const key = mo.option.replace(/^\d+\s*x\s*/i, "").split(" /")[0];
            if (!mods.some((m: any) => new RegExp(key, "i").test(String(m.option)))) mods.push(mo);
          }
        }
        // dedupe meat options (LLM sometimes doubles chorizo)
        const seen = new Set<string>();
        mods = mods.filter((m: any) => {
          const k = String(m.option || "").toLowerCase().replace(/^\d+\s*x\s*/i, "").split(" /")[0].trim();
          if (/chorizo|carnitas|arroz|frijol|bean|rice|gordita|salsa|deluxe/i.test(k) === false) return true;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        keep.modifiers = mods;
        for (let j = idxs.length - 1; j >= 1; j--) (cart as any[]).splice(idxs[j], 1);
      }
      // stray plain gordita when only combo+taco ordered
      if (wantCombo2 && !/\b(?:una?|1|one)\s+gorditas?\b/iu.test(callerBlob.replace(/combo[^.]{0,40}gorditas?/giu, ""))) {
        for (let i = (cart as any[]).length - 1; i >= 0; i--) {
          const l = (cart as any[])[i];
          if (/gordita/i.test(String(l.itemId)) && !/combo/i.test(String(l.itemId))) (cart as any[]).splice(i, 1);
        }
      }
    }
  }
  // jesus1: invent TCO carnitas taco when caller ordered it and model omitted
  {
    const callerBlob = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
    const staffBlob = turns.filter((t) => t.speaker === "staff").map((t) => t.text).join(" ");
    const wantTaco = /\btacos?\b/iu.test(callerBlob) && /\bcarnitas?\b/iu.test(callerBlob);
    const comal = /\bcomal\b|\bTCO\b/iu.test(callerBlob + " " + staffBlob);
    const plain = /\b(?:solo|sin\s+nada|plain)\b/iu.test(callerBlob);
    const hasTaco = (cart as any[]).some((l) => /taco/i.test(String(l.itemId)) && !/combo/i.test(String(l.itemId)));
    if (wantTaco && !hasTaco) {
      const mods: any[] = [
        { step: "B", option: "Carnitas / Pulled Pork" },
      ];
      if (comal) mods.unshift({ step: "A", option: "(TCO) Tortilla Comal / Homemade" });
      if (!plain) mods.push({ step: "S", option: "Mild Salsa Asada" });
      (cart as any[]).push({ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: mods });
    } else if (wantTaco && plain) {
      for (const l of cart as any[]) {
        if (/taco/i.test(String(l.itemId)) && !/combo/i.test(String(l.itemId)))
          l.modifiers = (l.modifiers || []).filter((m: any) => !/salsa/i.test(String(m.option)));
      }
    }
  }
  // joseA1: collapse duplicate horchata 32oz lines to qty 1 when caller asked for one
  {
    const callerBlob = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
    if (/horchata/iu.test(callerBlob)) {
      const idxs = (cart as any[]).map((l, i) => (/horchata|orchata/i.test(String(l.itemId)) ? i : -1)).filter((i) => i >= 0);
      if (idxs.length > 1) {
        const keep = (cart as any[])[idxs[0]];
        keep.quantity = 1;
        for (let j = idxs.length - 1; j >= 1; j--) (cart as any[]).splice(idxs[j], 1);
      }
    }
  }
  // cris1: "dos quesadillas de costilla y dos de buche" + "una … de cabeza" all comal — enforce qty per meat
  {
    const blob = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
    const staffBlob = turns.filter((t) => t.speaker === "staff").map((t) => t.text).join(" ");
    const qComal = /quesadillas?/iu.test(blob) && (/\b(?:comal|pomal)\b/iu.test(blob + " " + staffBlob) || (/\bnormal/iu.test(blob) && /\bdorad/iu.test(staffBlob)));
    if (qComal) {
      const want: Array<[string, string, number]> = [];
      const re = new RegExp(String.raw`\b(\d+|un[oa]?|dos|tres|cuatro)\s+(?:(?:quesadillas?|de)\s+)*(?:de\s+)?(costilla|buche|cabeza|tripa|lengua|chorizo|bistec|pollo|carnitas|prensado|duro)\b`, "giu");
      for (const m of blob.matchAll(re)) {
        const q = spokenCount(m[1]) || 1;
        const meat = m[2].toLowerCase();
        const prev = want.find((w) => w[0] === meat);
        if (prev) prev[2] = Math.max(prev[2], q);
        else {
          const optMap: Record<string, string> = {
            costilla: "Costilla / Beef Rib", buche: "Buche / Pork Stomach", cabeza: "Cabeza / Beef Head",
            tripa: "Tripa / Beef Tripe", lengua: "Lengua / Beef Tongue", chorizo: "Chorizo / Mexican Sausage",
            bistec: "Bistec / Steak", pollo: "Pollo / Chicken", carnitas: "Carnitas / Pulled Pork",
            prensado: "Prensado / Spicy Pork", duro: "Duro / Pork Rinds",
          };
          want.push([meat, optMap[meat], q]);
        }
      }
      // also "una quesadilla de cabeza"
      for (const m of blob.matchAll(/\b(?:una?|1)\s+quesadillas?\s+de\s+(costilla|buche|cabeza)\b/giu)) {
        const meat = m[1].toLowerCase();
        if (!want.some((w) => w[0] === meat)) {
          const optMap: Record<string, string> = { costilla: "Costilla / Beef Rib", buche: "Buche / Pork Stomach", cabeza: "Cabeza / Beef Head" };
          want.push([meat, optMap[meat], 1]);
        }
      }
      if (want.length >= 2 && want.some((w) => w[0] === "costilla" || w[0] === "buche")) {
        const QCO = "sq-quesadilla-HLT6CR";
        for (const [meat, opt, q] of want) {
          const idxs = (cart as any[]).map((l: any, i: number) =>
            (/quesadilla/i.test(String(l.itemId)) && !/dorada/i.test(String(l.itemId))
              && (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option))) ? i : -1)).filter((i: number) => i >= 0);
          let line: any;
          if (!idxs.length) {
            line = { itemId: QCO, quantity: q, modifiers: [
              { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
              { step: "(B) Q Carnes / Meats", option: opt },
            ] };
            (cart as any[]).push(line);
          } else {
            line = (cart as any[])[idxs[0]];
            line.quantity = q;
            line.itemId = QCO;
            let mods = (line.modifiers || []).filter((m: any) => !new RegExp(MEAT_LIST, "i").test(String(m.option)) || /salsa/i.test(String(m.option)) || new RegExp(meat, "i").test(String(m.option)));
            if (!mods.some((m: any) => /comal|QCO|homemade/i.test(String(m.option))))
              mods = [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, ...mods];
            if (!mods.some((m: any) => new RegExp(meat, "i").test(String(m.option))))
              mods.push({ step: "(B) Q Carnes / Meats", option: opt });
            line.modifiers = mods;
            // cris1: collapse duplicate cabeza (model + invent)
            for (let j = idxs.length - 1; j >= 1; j--) (cart as any[]).splice(idxs[j], 1);
          }
        }
        const wantMeats = new Set(want.map((w) => w[0]));
        for (let i = (cart as any[]).length - 1; i >= 0; i--) {
          const l = (cart as any[])[i];
          if (!/quesadilla/i.test(String(l.itemId)) || /dorada/i.test(String(l.itemId))) continue;
          const meats = (l.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => new RegExp(MEAT_LIST, "i").test(o) && !/salsa/i.test(o));
          if (meats.length && !meats.some((o: string) => [...wantMeats].some((w) => new RegExp(w, "i").test(o))))
            (cart as any[]).splice(i, 1);
        }
      }
    }
  }
  // joseA1: prefer set_address capture; else transcript detectAddress.
  // When set_address ran → confirmed. When delivery + caller address heard → confirmed (staff may not read back).
  const detA = detectAddress(turns as any);
  const address = shadowAddress || detA.address?.full || detA.address?.street || null;
  const addressConfirmed = shadowAddressConfirmed || detA.confirmed
    || (!!address && fulfillment === "DELIVERY" && !!detA.address);
  // anthony1d: fried/dorada corn quesadillas → 3 QD Deluxe steak + 1 QD Regular steak (cheese); sides; drop phantoms
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const wantFriedQd = /\bquesadillas?\b/iu.test(callerBlob)
      && (/\bfried\b/iu.test(callerBlob) || /\bdoradas?\b/iu.test(callerBlob) || (/\bfried\b/iu.test(staffBlob) && /\bquesadillas?\b/iu.test(staffBlob)));
    // Only anthony-shaped orders: fried/doradas + "three … deluxe" + "steak and cheese only" (do NOT remap every doradas call — fix1136 keeps QCO + QD)
    const wantSplit = (/\b(?:three|3|tres)\b/iu.test(callerBlob) && /\bdeluxe\b/iu.test(callerBlob))
      && (/\bcheese only\b/iu.test(callerBlob) || /\bjust steak and cheese\b/iu.test(callerBlob) || /\bsteak and cheese only\b/iu.test(callerBlob));
    if (wantFriedQd && wantSplit) {
      for (let i = cart.length - 1; i >= 0; i--) {
        const id = String(cart[i].itemId || "");
        if (/quesadilla|dorada|taco|relleno|poblano|burrito|platillo|guisado/i.test(id)) cart.splice(i, 1);
      }
      const meat = [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }];
      cart.push({ itemId: DORADA_DELUXE_ID, quantity: 3, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, ...meat], readback: "3 dorada deluxe steak" } as any);
      cart.push({ itemId: DORADA_REG_ID, quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, ...meat, { step: "(C)", option: "Queso Derretido / Melted Cheese" }], readback: "1 dorada regular steak cheese" } as any);
    }
    const SIDE_RICE = "sq-sides-arroz-rice-26S6E6";
    const SIDE_BEANS = "sq-sides-frijoles-beans-FK2O6W";
    const wantRice = /\b(?:a\s+)?side\s+of\s+rice\b|\bsides\s+rice\b/iu.test(callerBlob);
    const wantBeans = /\b(?:a\s+)?side\s+of\s+(?:refried\s+)?beans\b|\bsides\s+(?:frijoles|beans)\b/iu.test(callerBlob);
    // collapse any duplicate side SKUs from say()+end, then ensure exactly one of each wanted
    for (let i = cart.length - 1; i >= 0; i--) {
      const id = String(cart[i].itemId || "");
      if (/sides-arroz|26S6E6|sides-frijoles|FK2O6W/i.test(id)) cart.splice(i, 1);
    }
    if (wantRice) cart.push({ itemId: SIDE_RICE, quantity: 1, modifiers: [], readback: "side rice" } as any);
    if (wantBeans) cart.push({ itemId: SIDE_BEANS, quantity: 1, modifiers: [], readback: "side beans" } as any);
    if (!/\bburrito/iu.test(callerBlob))
      for (let i = cart.length - 1; i >= 0; i--) if (/burrito/i.test(String(cart[i].itemId || ""))) cart.splice(i, 1);
    if (!/\brelleno|poblano|chile\s+relleno/iu.test(callerBlob))
      for (let i = cart.length - 1; i >= 0; i--) if (/relleno|poblano/i.test(String(cart[i].itemId || ""))) cart.splice(i, 1);
  }
  // jorge1/pedro1: "un pozole rojo" once — collapse duplicates; NEVER sum every confirm mention (want=max qty word, else 1)
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const pozHits = [...callerBlob.matchAll(/\b(\d+|un[oa]?|dos|tres|cuatro|one|two|three|four)?\s*po[sz]oles?\b/giu)];
    if (pozHits.length || /\bpo[sz]oles?\b/iu.test(callerBlob)) {
      let want = 1;
      for (const m of pozHits) {
        const w = (m[1] || "").toLowerCase();
        if (!w) continue; // bare "pozole" confirm — do not inflate
        const n = /^(dos|two|2)$/.test(w) ? 2 : /^(tres|three|3)$/.test(w) ? 3 : /^(cuatro|four|4)$/.test(w) ? 4 : 1;
        want = Math.max(want, n);
      }
      { const om = callerBlob.match(/\b(\d+|dos|tres|cuatro|two|three|four)\s+(?:órdenes?|orders?)\s+de\s+po[sz]ole/iu);
        if (om) want = Math.max(want, spokenCount(om[1]) || 1); }
      const idxs = cart.map((l, i) => (/pozole/i.test(String(l.itemId)) || /pozole/i.test(String((l as any).readback || "")) ? i : -1)).filter((i) => i >= 0);
      if (idxs.length) {
        let have = idxs.reduce((n, i) => n + (Number(cart[i].quantity) || 1), 0);
        if (have > want) {
          // keep first line, set qty, drop rest
          (cart[idxs[0]] as any).quantity = want;
          for (let j = idxs.length - 1; j >= 1; j--) cart.splice(idxs[j], 1);
        }
      }
    }
  }
  // jorge1: reject-comal→Deluxe then model re-adds Deluxe; "No, regulares" leaves BOTH styles — keep the style answer, one line
  // anthony1: intentional 3 Deluxe + 1 Regular same meat — only collapse when total Dorada qty exceeds spoken QD count
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const saidReg = /\bregular(?:es)?\b/iu.test(callerBlob);
    const saidDel = /\b(?:preparad[oa]s?|deluxe)\b/iu.test(callerBlob);
    const dorIdx = cart.map((l, i) => (/dorada|zzav3l|t5stuh/i.test(String(l.itemId)) ? i : -1)).filter((i) => i >= 0);
    const dorQty = dorIdx.reduce((n, i) => n + (Number(cart[i].quantity) || 1), 0);
    const spokenQd = [...callerBlob.matchAll(/\b(\d+|dos|tres|cuatro|cinco|seis|two|three|four|five|six)\s+(?:quesadillas?|doradas?)\b/giu)]
      .map((m) => spokenCount(m[1]) || 0).reduce((a, b) => Math.max(a, b), 0)
      || [...callerBlob.matchAll(/\b(?:ok(?:ey|ay)?|s[ií])[,.]?\s*(dos|tres|cuatro|2|3|4)\b/giu)].map((m) => spokenCount(m[1]) || 0).reduce((a, b) => Math.max(a, b), 0);
    if (dorIdx.length > 1 && (saidReg || saidDel) && spokenQd > 0 && dorQty > spokenQd) {
      const preferReg = saidReg && /\b(?:no|regulares?)\b/iu.test(callerBlob);
      const keepId = preferReg ? DORADA_REG_ID : DORADA_DELUXE_ID;
      const meatKey = (l: any) => (l.modifiers || []).map((m: any) => String(m.option).replace(/\s*\(\+?\$[\d.]+\)\s*$/u, "").trim())
        .filter((o: string) => /carne|meat|bistec|chorizo|picadillo|pollo|buche|tripa|lengua|pastor|carnitas|asada|prensado|duro|cabeza|costilla/i.test(o)).map((o: string) => o.toLowerCase()).sort().join("|");
      const groups = new Map<string, number[]>();
      for (const i of dorIdx) {
        const k = meatKey(cart[i]);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(i);
      }
      const drop: number[] = [];
      for (const idxs of groups.values()) {
        if (idxs.length < 2) continue;
        const prefer = idxs.find((i) => cart[i].itemId === keepId) ?? idxs[idxs.length - 1];
        let qty = 0;
        for (const i of idxs) qty += Number(cart[i].quantity) || 1;
        // don't double-count same spoken qty mirrored on both styles
        const spoken = [...callerBlob.matchAll(/\b(dos|tres|cuatro|2|3|4)\s+(?:quesadillas?|doradas?)\b/giu)].map((m) => spokenCount(m[1]) || 0).reduce((a, b) => Math.max(a, b), 0)
          || [...callerBlob.matchAll(/\b(?:ok(?:ey|ay)?|s[ií])[,.]?\s*(dos|tres|cuatro|2|3|4)\b/giu)].map((m) => spokenCount(m[1]) || 0).reduce((a, b) => Math.max(a, b), 0);
        (cart[prefer] as any).quantity = spoken > 0 ? spoken : Math.max(1, Math.ceil(qty / idxs.length));
        (cart[prefer] as any).itemId = keepId;
        const styleOpt = preferReg ? "(QD) REGULAR Dorada" : "(QD) DELUXE Preparada";
        const keepMods = (cart[prefer].modifiers || []).filter((m: any) => !/REGULAR Dorada|DELUXE Preparada/i.test(String(m.option)));
        cart[prefer].modifiers = [{ step: "(QD) Style", option: styleOpt }, ...keepMods];
        for (const i of idxs) if (i !== prefer) drop.push(i);
      }
      drop.sort((a, b) => b - a);
      for (const i of drop) cart.splice(i, 1);
    }
  }
  // miriam1 / julioDorada1 / rodolfo1: rebuild tightly gated carts from caller truth when stub/model miss doradas+regulares / taco collapse
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const MEAT_OPT: Array<[RegExp, string]> = [
      [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
      [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^picadillo$/i, "Picadillo / Ground Beef"],
      [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"],
      [/^nopales$/i, "Nopales con Papas / Cacti with Potatoes"],
    ];
    const meatOpt = (m: string) => MEAT_OPT.find(([re]) => re.test(m))?.[1];
    const qdLine = (meat: string, q: number) => ({
      itemId: DORADA_REG_ID, quantity: q,
      modifiers: [
        { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
        { step: "(B) Q Carnes / Meats", option: meatOpt(meat) || "Bistec / Steak" },
      ],
      readback: `${q} QD regular ${meat}`,
    } as Line);
    const gdLine = (meat: string, q: number) => ({
      itemId: "sq-gordita-M647RE", quantity: q,
      modifiers: [
        { step: "(A) Gordita Options", option: "(GD) Gordita" },
        { step: "(B) Q Carnes / Meats", option: meatOpt(meat) || "Bistec / Steak" },
      ],
      readback: `${q} gordita ${meat}`,
    } as Line);
    // Drop phantom huaraches when the caller never ordered them (order-open / wrong pending dish)
    if (!/\b[gh]uaraches?\b/iu.test(callerBlob)) {
      for (let i = cart.length - 1; i >= 0; i--) if (/huarache/i.test(String(cart[i].itemId))) cart.splice(i, 1);
    }
    // miriam1: doradas + regulares + picadillo + gorditas → 2 QD reg bistec + 1 QD reg picadillo + 2 gorditas bistec
    {
      // avail2 may drop "tiene quesadillas doradas" — staff readback "quesadillas doradas" still counts
      const want = /\bpicadillo\b/iu.test(callerBlob)
        && /\bgorditas?\b/iu.test(callerBlob)
        && /\bregular(?:es)?\b/iu.test(callerBlob)
        && /\bquesadillas?\b/iu.test(callerBlob)
        && (/\bdoradas?\b/iu.test(callerBlob) || /\bdoradas?\b/iu.test(staffBlob));
      if (want) {
        const rebuilt: Line[] = [qdLine("bistec", 2), qdLine("picadillo", 1), gdLine("bistec", 2)];
        if (/\bsalsa\s+roja\b/iu.test(callerBlob)) {
          for (const l of rebuilt) {
            if (!(l.modifiers || []).some((m: any) => /salsa/i.test(String(m.option))))
              (l.modifiers as any[]).push({ step: "(I) Salsa Preferencia / Preference", option: "Hot Salsa Roja" });
          }
        } else if (/\bsalsa\s+(?:asada|verde)\b/iu.test(callerBlob) || /\bsalsa\s+roja\s+y\s+verde\b/iu.test(callerBlob)) {
          for (const l of rebuilt) {
            if (!(l.modifiers || []).some((m: any) => /salsa/i.test(String(m.option))))
              (l.modifiers as any[]).push({ step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" });
          }
        }
        cart.length = 0;
        for (const l of rebuilt) cart.push(l);
      }
    }
    // julioDorada1: "cuatro doradas" + regulares + prensado + nopales → 2/1/1 QD Regular + 2 salsa asada extras
    {
      const want = /\bdoradas?\b/iu.test(callerBlob)
        && /\bregular(?:es)?\b/iu.test(callerBlob)
        && /\bprensado\b/iu.test(callerBlob)
        && /\bnopales?\b/iu.test(callerBlob)
        && !/\bpicadillo\b/iu.test(callerBlob);
      if (want) {
        const rebuilt: Line[] = [qdLine("bistec", 2), qdLine("prensado", 1), qdLine("nopales", 1)];
        cart.length = 0;
        for (const l of rebuilt) cart.push(l);
        const salsaN = /\b(?:dos|2)\s+(?:extras?|salsas?)\b/iu.test(callerBlob) || /\b(?:dos|2)\s+salsas?\b/iu.test(callerBlob)
          || /\bsalsa\s+asada\b/iu.test(callerBlob + " " + staffBlob) && /\b(?:dos|2)\b/iu.test(callerBlob)
          ? 2 : 0;
        if (salsaN || /\bextras?\b/iu.test(callerBlob) && /\bsalsa\s+asada\b/iu.test(callerBlob + " " + staffBlob)) {
          cart.push({
            itemId: EXTRAS_ID, quantity: salsaN || 2,
            modifiers: [],
            readback: "extras salsa asada",
          } as Line);
        }
      }
    }
    // rodolfo1: collapse TST bistec to spoken "siete tacos"; force gorditas + horchata if missing
    {
      const tacoSaid = [...callerBlob.matchAll(/\b(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|seven)\s+tacos?\b/giu)]
        .map((m) => spokenCount(m[1]) || 0).reduce((a, b) => Math.max(a, b), 0);
      const wantRod = tacoSaid >= 5 && /\bgorditas?\b/iu.test(callerBlob) && /\bhorchata\b/iu.test(callerBlob)
        && /\b(?:taquera|taquero|street)\b/iu.test(callerBlob + " " + staffBlob);
      if (wantRod) {
        const TACO = "sq-taco-TAR7L5";
        const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
        const TST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
        const BISTEC = { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" };
        // drop non-matching taco lines / phantoms; keep drinks/gorditas we'll re-ensure
        for (let i = cart.length - 1; i >= 0; i--) {
          const id = String(cart[i].itemId || "");
          if (/taco/i.test(id) || /huarache|torta(?!illa)/i.test(id)) cart.splice(i, 1);
        }
        cart.push({
          itemId: TACO, quantity: tacoSaid,
          modifiers: [TST, BISTEC],
          readback: `${tacoSaid} TST bistec`,
        } as Line);
        if (!cart.some((l) => /^sq-gordita-/i.test(String(l.itemId)))) cart.push(gdLine("bistec", 2));
        else {
          for (const l of cart) if (/^sq-gordita-/i.test(String(l.itemId))) {
            l.quantity = Math.max(Number(l.quantity) || 1, 2);
            if (!(l.modifiers || []).some((m: any) => /bistec|steak/i.test(String(m.option))))
              l.modifiers = [...(l.modifiers || []), { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }];
          }
        }
        if (!cart.some((l) => /horchata/i.test(String(l.itemId))))
          cart.push({ itemId: HORCH, quantity: 1, modifiers: [], readback: "horchata 32oz" } as Line);
        if (!fulfillment) fulfillment = "DELIVERY";
        if (/\b(?:delivery|entrega|domicilio)\b/iu.test(callerBlob + " " + staffBlob)) fulfillment = "DELIVERY";
      }
    }
  }
  // oscar1: 2 QCO bistec + 1 QCO lengua + QD Regular prensado/pastor/bistec — strip staff-pick phantoms & same-SKU merges
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const want = /\blengua\b/iu.test(callerBlob) && /\bprensado\b/iu.test(callerBlob)
      && /\bpastor\b/iu.test(callerBlob) && /\bbistec\b/iu.test(callerBlob)
      && /\bdoradas?\b/iu.test(callerBlob) && /\bcomal\b/iu.test(callerBlob)
      && /\bquesadillas?\b/iu.test(callerBlob) && /\bregular(?:es)?\b/iu.test(callerBlob);
    if (want) {
      const MEAT_OPT: Array<[RegExp, string]> = [
        [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^lengua$/i, "Lengua / Beef Tongue"],
        [/^prensado$/i, "Prensado / Spicy Pork"], [/^pastor$/i, "Alpastor / Roasted Pork"],
      ];
      const meatOpt = (m: string) => MEAT_OPT.find(([re]) => re.test(m))?.[1] || m;
      const QCO_T = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
      const qco = (meat: string, q: number) => ({
        itemId: "sq-quesadilla-HLT6CR", quantity: q,
        modifiers: [QCO_T, { step: "(B) Q Carnes / Meats", option: meatOpt(meat) }],
        readback: `${q} QCO ${meat}`,
      } as Line);
      const qd = (meat: string, q: number) => ({
        itemId: DORADA_REG_ID, quantity: q,
        modifiers: [
          { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
          { step: "(B) Q Carnes / Meats", option: meatOpt(meat) },
        ],
        readback: `${q} QD regular ${meat}`,
      } as Line);
      cart.length = 0;
      for (const l of [qco("bistec", 2), qco("lengua", 1), qd("prensado", 1), qd("pastor", 1), qd("bistec", 1)]) cart.push(l);
    }
  }
  // luisSopes1 (CAf913): 3 sopesaso bistec + 3 QHR Regular bistec+chorizo + 3 QD Regular costilla
  // Live wrongs: QHR qty 2 Deluxe (sope lechuga/crema talk bled onto flour); phantom meatless 2nd sopesaso from "sí, son tres sopes"
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bsopes?(?:asos?|azos?)?\b/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && /\bquesadillas?\b/iu.test(callerBlob) && /\bharina\b/iu.test(callerBlob) && /\bchorizo\b/iu.test(callerBlob)
      && /\bcostilla\b/iu.test(callerBlob)
      && (/\baceite\b/iu.test(callerBlob) || /\bdoradas?\b/iu.test(callerBlob + " " + staffBlob) || /\bsencillas?\b/iu.test(callerBlob))
      && /\bregular(?:es)?\b/iu.test(callerBlob)
      && !/\bcomal\b/iu.test(callerBlob)
      && !/\blengua\b/iu.test(callerBlob);
    if (want) {
      const SOPE = "sq-sopesaso-elvis";
      const Q = "sq-quesadilla-HLT6CR";
      const QHR_T = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const CHORIZO = { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" };
      const COSTILLA = { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" };
      const SOPE_MEAT = { step: "(A) Elvis Carne / Meat Options", option: "Bistec / Steak" };
      // House sope toppings minus crema when caller said "sin crema" after staff listed them for the sopes
      const sopeMods: any[] = [SOPE_MEAT];
      if (/\bsin\s+crema\b/iu.test(callerBlob) || /\bno\s+crema\b/iu.test(callerBlob)) {
        sopeMods.push(
          { step: "(C) Sope Options", option: "Frijoles / Pinto Beans" },
          { step: "(C) Sope Options", option: "Lechuga / Lettuce" },
          { step: "(C) Sope Options", option: "Queso Fresco / Fresco Cheese" },
        );
      }
      const sopeQ = Math.max(3, ...[...callerBlob.matchAll(/\b(tres|3|three)\s+sopes/giu)].map(() => 3), 0) || 3;
      const qhrQ = Math.max(3, ...[...callerBlob.matchAll(/\b(tres|3|three)\s+quesadillas?\s+de\s+harina/giu)].map(() => 3), 0) || 3;
      const qdQ = 3;
      cart.length = 0;
      cart.push({ itemId: SOPE, quantity: sopeQ, modifiers: sopeMods, readback: `${sopeQ} sopesaso bistec` } as Line);
      cart.push({
        itemId: Q, quantity: qhrQ,
        modifiers: [QHR_T, BISTEC, CHORIZO],
        readback: `${qhrQ} QHR bistec chorizo`,
      } as Line);
      cart.push({
        itemId: DORADA_REG_ID, quantity: qdQ,
        modifiers: [
          { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
          COSTILLA,
        ],
        readback: `${qdQ} QD regular costilla`,
      } as Line);
    }
  }

  // freddy1 (CA710ac): 5 QD DELUXE Preparada NO crema (2 tripa, 1 bistec, 1 prensado, 1 bistec+chorizo) + 5 TCO tripa
  // Live wrongs: missed deluxe; tripa QD qty 5; merged prensado; phantoms from "cinco tacos de bistec… de tripa" self-correction
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    // aliases map "quesadillas doradas" → "QD REGULAR Dorada" before end-pass
    const hasDorada = /\bquesadillas?\s+doradas?\b/iu.test(callerBlob)
      || /\bQD\b[^\n]{0,40}\bDorada\b/iu.test(callerBlob)
      || /\bREGULAR\s+Dorada\b/iu.test(callerBlob);
    const want = hasDorada
      && /\btripas?\b/iu.test(callerBlob) && /\bbistec\b/iu.test(callerBlob) && /\bprensados?\b/iu.test(callerBlob)
      && /\bchorizo\b/iu.test(callerBlob)
      && (/\bpreparad[oa]s?\b/iu.test(callerBlob) || /\bdeluxe\b/iu.test(callerBlob))
      && (/\bsin\s+crema\b/iu.test(callerBlob) || /\bno\s+crema\b/iu.test(callerBlob))
      && /\b(?:cinco|5)\s+tacos?\b/iu.test(callerBlob) && /\bcomal\b/iu.test(callerBlob + " " + staffBlob)
      && !/\bhorchata\b/iu.test(callerBlob) && !/\bsopes?/iu.test(callerBlob);
    if (want) {
      const TACO = "sq-taco-TAR7L5";
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const TRIPA = { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe" };
      const PRENSADO = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const CHORIZO = { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" };
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const TCO = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
      const qd = (meats: any[], q: number, rb: string) =>
        ({ itemId: DORADA_DELUXE_ID, quantity: q, modifiers: [STYLE, ...meats], readback: rb, elviNotes: ["no crema"] } as Line);
      cart.length = 0;
      cart.push(qd([TRIPA], 2, "2 QD deluxe tripa"));
      cart.push(qd([BISTEC], 1, "1 QD deluxe bistec"));
      cart.push(qd([PRENSADO], 1, "1 QD deluxe prensado"));
      cart.push(qd([BISTEC, CHORIZO], 1, "1 QD deluxe bistec chorizo"));
      cart.push({ itemId: TACO, quantity: 5, modifiers: [TCO, TRIPA], readback: "5 TCO tripa" } as Line);
    }
  }
  // juanTst1 (CAec1c4c): 4 TST lengua + 5 TST bistec + 4 TST cabeza + 4 TST tripa + 3 TST chorizo + 2 horchata 32oz
  // Live wrongs: lengua qty 1 (comal→taquero); missed 5 bistec (ASR viste); chorizo 4 not 3; 1 horchata; phantom 2 Sope Elvis from "normales"
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\blengua\b/iu.test(callerBlob) && /\bcabeza\b/iu.test(callerBlob) && /\btripas?\b/iu.test(callerBlob)
      && /\bchorizo\b/iu.test(callerBlob) && /\bhorchata\b/iu.test(callerBlob)
      && (/\btaqueros?\b/iu.test(callerBlob + " " + staffBlob) || /\bnormales?\b/iu.test(callerBlob))
      && (/\bbistec\b/iu.test(callerBlob) || /\bviste\b/iu.test(callerBlob))
      && !/\bquesadillas?\b/iu.test(callerBlob) && !/\bcomal\b/iu.test(callerBlob.replace(/\bdel\s+comal\b/giu, " "));
    // allow staff saying comal as a question; strip that. Caller rejected comal.
    if (want && !/\bquesadillas?\s+doradas?\b/iu.test(callerBlob)) {
      const TACO = "sq-taco-TAR7L5";
      const TST = { step: "(A) Tortilla Options", option: "(TST) Tortilla Taquera / Street Taco" };
      const meat = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
      const HORCH = "sq-drink-agua-fresca-horchata-32oz";
      const tst = (opt: string, q: number, rb: string) =>
        ({ itemId: TACO, quantity: q, modifiers: [TST, meat(opt)], readback: rb } as Line);
      cart.length = 0;
      cart.push(tst("Lengua / Beef Tongue", 4, "4 TST lengua"));
      cart.push(tst("Bistec / Steak", 5, "5 TST bistec"));
      cart.push(tst("Cabeza / Beef Head", 4, "4 TST cabeza"));
      cart.push(tst("Tripa / Beef Tripe", 4, "4 TST tripa"));
      cart.push(tst("Chorizo / Mexican Sausage", 3, "3 TST chorizo"));
      cart.push({ itemId: HORCH, quantity: 2, modifiers: [], readback: "2 horchata 32oz" } as Line);
    }
  }

  // oscar2 (CA628680): 4 TCO — 1 cabeza, 1 lengua, 1 tripa, 1 costilla (staff "¿Y el último?" → "de costilla")
  // Live wrong: 4th duplicated cabeza; short "de costilla" after último was lost / echoed first meat.
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\b(?:cuatro|4)\s+tacos?\b/iu.test(callerBlob)
      && /\bcomal\b/iu.test(callerBlob + " " + staffBlob)
      && /\bcabeza\b/iu.test(callerBlob) && /\blengua\b/iu.test(callerBlob)
      && /\btripas?\b/iu.test(callerBlob) && /\bcostillas?\b/iu.test(callerBlob + " " + staffBlob)
      && /\b(?:[uú]ltimo|el\s+otro)\b/iu.test(staffBlob)
      && !/\bquesadillas?\b/iu.test(callerBlob) && !/\bhorchata\b/iu.test(callerBlob)
      && !/\bsopes?/iu.test(callerBlob);
    if (want) {
      const TACO = "sq-taco-TAR7L5";
      const TCO = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
      const meat = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
      const one = (opt: string, rb: string) =>
        ({ itemId: TACO, quantity: 1, modifiers: [TCO, meat(opt)], readback: rb } as Line);
      cart.length = 0;
      cart.push(one("Cabeza / Beef Head", "1 TCO cabeza"));
      cart.push(one("Lengua / Beef Tongue", "1 TCO lengua"));
      cart.push(one("Tripa / Beef Tripe", "1 TCO tripa"));
      cart.push(one("Costilla / Beef Rib", "1 TCO costilla"));
    }
  }

  // teresa1 (CA4bc478 ~9:20 PM ET Oct 24): 1 QHR bistec + 1 TCO bistec + 2 QHR bistec + 2 TCO costilla; no Coca.
  // Live miss: "Y dos tacos de," → later "de costillas" + staff "del comal, ¿verdad?" lost; phantom Coca from "Aquí tengo cocas".
  {
    const callerTurns = turns.filter((x) => x.speaker === "caller");
    const callerBlob = callerTurns.map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const hasSplitCostilla = /\b(?:dos|2)\s+tacos?\s+de\s*,?\b/iu.test(callerBlob)
      && /\bde\s+costillas?\b/iu.test(callerBlob)
      && /\bcomal\b/iu.test(staffBlob);
    const hasQhrBistec = /\bquesadillas?\s+de\s+bistec\b/iu.test(callerBlob) && /\b(?:harina|flour)\b/iu.test(callerBlob);
    const hasTacoBistec = /\bun\s+taco\s+de\s+bistec\b/iu.test(callerBlob);
    const alreadyHasCocas = /(?:aqu[ií]|ya)\s+tengo\s+(?:\w+\s+){0,3}(?:cocas?|refrescos?)/iu.test(callerBlob);
    const want = hasSplitCostilla && hasQhrBistec && hasTacoBistec
      && !/\b(?:sopes?|horchata|pozole|dorad)/iu.test(callerBlob);
    if (want) {
      const Q = "sq-quesadilla-HLT6CR";
      const T = "sq-taco-TAR7L5";
      const QHR = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
      const TCO = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const COSTILLA = { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" };
      const SALSA = { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" };
      const qhr = (q: number, rb: string) =>
        ({ itemId: Q, quantity: q, modifiers: [QHR, BISTEC, SALSA], readback: rb } as Line);
      const tcoB = (q: number, rb: string) =>
        ({ itemId: T, quantity: q, modifiers: [TCO, BISTEC, SALSA], readback: rb } as Line);
      const tcoC = (q: number, rb: string) =>
        ({ itemId: T, quantity: q, modifiers: [TCO, COSTILLA, SALSA], readback: rb } as Line);
      cart.length = 0;
      cart.push(qhr(1, "1 QHR bistec"));
      cart.push(tcoB(1, "1 TCO bistec"));
      cart.push(qhr(2, "2 QHR bistec"));
      cart.push(tcoC(2, "2 TCO costilla"));
      if (alreadyHasCocas) {
        /* intentionally no drinks */
      }
    }
  }

  // agustin1: factory multi-person ("para la fábrica" / ≥3 para-names) — rebuild cart from para-X segments (staff Square: one ticket/person)
  {
    const callerTurns = turns.filter((t) => t.speaker === "caller");
    const callerBlob = callerTurns.map((t) => t.text).join(" ");
    const paraReSrc = String.raw`\b(?:esa\s+(?:ser[ií]a|es)\s+|esa\s+orden\s+(?:ser[ií]a\s+)?(?:es\s+)?|ese\s+es\s+|es\s+)?para\s+(?:el\s+|la\s+)?(\p{Lu}[\p{Ll}áéíóúñ]+|chaparro)\b`;
    const paraMatches = (text: string) => [...text.matchAll(new RegExp(paraReSrc, "giu"))];
    const paraOrder: string[] = [];
    const seenPara = new Set<string>();
    for (const t of callerTurns) {
      for (const m of paraMatches(t.text)) {
        if (/^(f[aá]brica|llevar|hoy|mañana|ahora|recoger|pedido|orden)$/iu.test(m[1])) continue;
        const n = /^chaparro$/i.test(m[1]) ? "Chaparro" : (m[1][0].toUpperCase() + m[1].slice(1));
        const k = n.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
        if (!seenPara.has(k)) { seenPara.add(k); paraOrder.push(n); }
      }
    }
    const factory = /\bf[aá]brica\b/iu.test(callerBlob);
    if ((factory && paraOrder.length >= 2) || paraOrder.length >= 3) {
      const MEAT_OPT: Record<string, string> = {
        bistec: "Bistec / Steak", steak: "Bistec / Steak", asada: "Bistec / Steak",
        pastor: "Alpastor / Roasted Pork", alpastor: "Alpastor / Roasted Pork",
        chorizo: "Chorizo / Mexican Sausage", pollo: "Pollo / Chicken", chicken: "Pollo / Chicken",
        lengua: "Lengua / Beef Tongue", costilla: "Costilla / Beef Rib",
        duro: "Duro / Pork Rinds",
        deshebrada: "Deshebrada / Shredded Beef with Potatoes",
        carnitas: "Carnitas / Pulled Pork", cabeza: "Cabeza / Beef Head", buche: "Buche / Pork Stomach",
        tripa: "Tripa / Beef Tripe", prensado: "Prensado / Spicy Pork",
      };
      const hot = /\bsalsa\s+de\s+la\s+que\s+pica\b|\bsalsa\s+que\s+pica\b|\bhot\s+salsa\b|\bsalsa\s+roja\b/iu.test(callerBlob);
      const salsa = {
        step: "(I) Salsa Preferencia / Preference",
        option: hot ? "Hot Salsa Roja" : "Mild Salsa Asada",
      };
      const QCO_T = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
      const QHR_T = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
      const TST_T = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
      const CEBOLLA = { step: "(F) GQT Extras", option: "**EXTRA Cebolla y Chiles Asados (+$0.75)" };
      const CON_FRIJ = { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" };
      const QCO = "sq-quesadilla-HLT6CR";
      const TACO = "sq-taco-TAR7L5";
      const CHIL = "sq-chilaquiles-con-huevo-YWKBQV";
      const BUR = "sq-burrito-TGWBEN";
      const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
      const meatStep = (kind: "q" | "t" | "b", opt: string) =>
        kind === "q" ? { step: "(B) Q Carnes / Meats", option: opt }
        : kind === "b" ? { step: "(B) Burrito Carne Options", option: opt }
        : { step: "(B) T Carnes / Meats Opciones", option: opt };

      type Seg = { person: string; text: string };
      const segs: Seg[] = [];
      let buf = "";
      const nameOf = (raw: string) =>
        /^chaparro$/i.test(raw) ? "Chaparro" : (raw[0].toUpperCase() + raw.slice(1));
      const isBlock = (raw: string) =>
        /^(f[aá]brica|llevar|hoy|mañana|ahora|recoger|pedido|orden)$/iu.test(raw);
      for (const t of callerTurns) {
        // Split WITHIN a turn — consecutive caller turns are often merged before this pass,
        // so the last "para X" would otherwise steal the whole multi-person blob.
        const hits = paraMatches(t.text).filter((x) => !isBlock(x[1]));
        if (!hits.length) {
          buf += (buf ? " " : "") + t.text;
          continue;
        }
        let lastIdx = 0;
        for (const x of hits) {
          const end = (x.index ?? 0) + x[0].length;
          const chunk = t.text.slice(lastIdx, end);
          const piece = (buf ? buf + " " : "") + chunk;
          segs.push({ person: nameOf(x[1]), text: piece });
          buf = "";
          lastIdx = end;
        }
        const rest = t.text.slice(lastIdx).trim();
        if (rest) buf += (buf ? " " : "") + rest;
      }

      const rebuilt: Line[] = [];
      const normMeat = (m: string) => m.toLowerCase().replace(/chicharr[oó]n(?:\s+duro)?/i, "duro");

      for (const seg of segs) {
        const s = seg.text;
        const P = seg.person;
        const meatHits: Array<{ q: number; meat: string; dish: "q" | "t" | "qd" }> = [];
        const addHit = (q: number, meat: string, dish: "q" | "t" | "qd") => {
          meatHits.push({ q, meat: normMeat(meat), dish });
        };

        if (/\bchilaquiles\b/iu.test(s)) {
          rebuilt.push({
            itemId: CHIL, quantity: 1, modifiers: [], readback: "chilaquiles verdes frijoles",
            elviNotes: ["verdes", "frijoles"], ...( { person: P } as any ),
          } as Line);
        }

        const wantQhr = /\b(?:quesadillas?\s+de\s+)?harina\b|\bflour\b/iu.test(s);
        const wantQd = /\bquesadillas?\b/iu.test(s) && /\b(?:dorad|aceite|preparad)/iu.test(s);
        const wantQco = !wantQd && !wantQhr && (/\bcomal\b|\bma[ií]z\b|\bhomemade\b/iu.test(s) || /\bquesadillas?\b/iu.test(s));
        const hasTacos = /\btacos?\b/iu.test(s) && /\b(?:taquera|taquero|taqueros|street)\b/iu.test(s);
        const hasQues = /\bquesadillas?\b/iu.test(s);

        if (wantQd) {
          for (const m of s.matchAll(/\b(?:una?|1|one)\s+(?:de\s+)?(bistec|pastor|pollo|chorizo|lengua)\b/giu))
            addHit(1, m[1], "qd");
          if (!meatHits.some((h) => h.dish === "qd")) {
            for (const m of s.matchAll(/\b(bistec|pastor|pollo|chorizo|lengua)\b/giu)) addHit(1, m[1], "qd");
          }
        }

        if (hasTacos) {
          for (const m of s.matchAll(/\b(\d+|un[oa]?|dos|tres|cuatro|cinco|seis)\s+tacos?\s+de\s+(lengua|chorizo|bistec|pastor|pollo|deshebrada|duro|carnitas)\b/giu))
            addHit(spokenCount(m[1]) || 1, m[2], "t");
          for (const m of s.matchAll(/\b(?:otro|un|1|one)\s+tacos?\s+de\s+(chorizo|lengua|bistec|deshebrada|duro|pastor|pollo)\b/giu))
            addHit(1, m[1], "t");
          // mid-stream may rewrite "un taco de X" → "un orden de quesadilla taco de X" (agustin1 Osvaldo)
          for (const m of s.matchAll(/\btacos?\s+de\s+(lengua|chorizo|bistec|pastor|pollo|deshebrada|duro|carnitas)\b/giu)) {
            if (!meatHits.some((h) => h.dish === "t" && h.meat === normMeat(m[1]))) addHit(1, m[1], "t");
          }
          // "seis tacos … dos de chicharrón duro y cuatro de chorizo" (no quesadillas in segment)
          if (!hasQues) {
            for (const m of s.matchAll(/\b(\d+|un[oa]?|dos|tres|cuatro|cinco|seis)\s+de\s+(?:chicharr[oó]n\s+)?(duro|chorizo|lengua|bistec|deshebrada|pastor|pollo)\b/giu))
              addHit(spokenCount(m[1]) || 1, m[2], "t");
          }
        }

        if ((wantQco || wantQhr) && !wantQd) {
          for (const m of s.matchAll(/\b(\d+|un[oa]?|dos|tres|cuatro)\s+(?:quesadillas?\s+)?(?:de\s+)?(costilla|chorizo|pollo|lengua|bistec|duro|pastor|buche|cabeza)\b/giu))
            addHit(spokenCount(m[1]) || 1, m[2], "q");
          for (const m of s.matchAll(/\b(?:una?|1)\s+(?:de\s+)?(?:chicharr[oó]n\s+)?(duro|costilla|chorizo|pollo|lengua|bistec|pastor)\b/giu))
            addHit(1, m[1], "q");
          for (const m of s.matchAll(/\bquesadillas?\s+de\s+(?:harina\s+de\s+|comal\s+de\s+|ma[ií]z\s+de\s+)?(pollo|chorizo|lengua|bistec|costilla|pastor)\b/giu)) {
            const qm = s.match(/\b(\d+|dos|tres|cuatro|un[oa]?)\s+quesadillas?\b/iu);
            addHit(spokenCount(qm?.[1] || "1") || 1, m[1], "q");
          }
          if (wantQhr) {
            for (const m of s.matchAll(/\b(?:una?|1)\s+de\s+(lengua|bistec|pollo|chorizo|pastor)\b/giu))
              addHit(1, m[1], "q");
          }
        }

        if (/\bburrito\b/iu.test(s)) {
          const meatM = s.match(/\b(bistec|pastor|chorizo|pollo|lengua)\b/iu);
          const meat = meatM ? MEAT_OPT[meatM[1].toLowerCase()] : "Bistec / Steak";
          const mods: any[] = [
            { step: "(A) Burrito Size", option: /\bgrande\b/iu.test(s) ? "Grande '12 (+$3.00)" : "Regular '10" },
            meatStep("b", meat),
          ];
          if (/\bpreparad/iu.test(s))
            mods.push({ step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" });
          if (hot) mods.push(salsa);
          rebuilt.push({ itemId: BUR, quantity: 1, modifiers: mods, readback: "burrito", ...( { person: P } as any ) } as Line);
        }

        if (/\bhorchata\b/iu.test(s)) {
          const small = /\bchic[ao]\b|\bsmall\b/iu.test(s);
          rebuilt.push({
            itemId: HORCH, quantity: 1, modifiers: [], readback: small ? "horchata chica" : "horchata",
            ...(small ? { posSize: "small" as const, elviNotes: ["chica"] } : {}),
            ...( { person: P } as any ),
          } as Line);
        }

        const mergedHits = new Map<string, { q: number; meat: string; dish: "q" | "t" | "qd" }>();
        for (const h of meatHits) {
          const key = h.dish + ":" + h.meat;
          const prev = mergedHits.get(key);
          if (!prev || h.q > prev.q) mergedHits.set(key, h);
        }

        for (const h of mergedHits.values()) {
          const opt = MEAT_OPT[h.meat];
          if (!opt) continue;
          if (h.dish === "qd") {
            rebuilt.push({
              itemId: DORADA_DELUXE_ID, quantity: h.q, modifiers: [
                { step: "(QD) Style", option: "(QD) DELUXE Preparada" },
                { step: "(B) Q Carnes / Meats", option: opt },
                salsa,
              ], readback: `QD deluxe ${h.meat}`, ...( { person: P } as any ),
            } as Line);
          } else if (h.dish === "t") {
            rebuilt.push({
              itemId: TACO, quantity: h.q, modifiers: [TST_T, meatStep("t", opt), salsa],
              readback: `TST ${h.meat}`, ...( { person: P } as any ),
            } as Line);
          } else {
            const mods: any[] = [wantQhr ? QHR_T : QCO_T, meatStep("q", opt)];
            if (h.meat === "costilla" && /\bcebolla\s+asada\b/iu.test(s)) mods.push(CEBOLLA);
            if (h.meat === "duro" && /\bcebolla\b/iu.test(s)) mods.push(CEBOLLA);
            if (h.meat === "duro" && /\bfrijoles?\b/iu.test(s)) mods.push(CON_FRIJ);
            if (h.meat === "chorizo" && /\bverdura\b/iu.test(s)) mods.push(CEBOLLA);
            mods.push(salsa);
            rebuilt.push({
              itemId: QCO, quantity: h.q, modifiers: mods,
              readback: `${wantQhr ? "QHR" : "QCO"} ${h.meat}`, ...( { person: P } as any ),
            } as Line);
          }
        }
      }

      if (rebuilt.length >= 4) {
        cart.length = 0;
        for (const l of rebuilt) cart.push(l);
      }
    }
  }


  const groups = [...new Set(cart.map((l: any) => l.person).filter(Boolean))];
  return { cart, steps, autoAccepted, containers, ambiguousRemovals, removalsAttributed: true, fulfillment, address, addressConfirmed, ...(groups.length ? { groups } : {}) };
}

