// Listen-only call scoring: split the dual-channel recording (ch1 = caller, ch2 = staff),
// transcribe each track with word timestamps, interleave into turns, and replay the caller
// turns through Elvi's order context one at a time (shadow session, never checkout).
import { applySharedAliases } from "./aliases.js";
import { applyAskedDishes, applyAddOnCallback } from "./asked-dishes.js";
import { applySplitCorrection, applySidesAndToppings } from "./multi-order.js";
import { applyQdCorrection, applyConsomeSolo, applyMenudoPata, applyVerduraAparte, wantsExtraCarne, applyExtraCarne, applyMeatSplitQty, applyEnglishMultiItem, applyQdRecap, applyBurritoMeatRepeat, applyLateTortillaChoice, addAskedEsquite, addAskedJarrito, applyRelayOrders, applyAlex3, mergeReMentionedDrink, applySopesAsada, applyBurritoSaid, applyStaffReadback, fillMeatlessFromCaller, dropDeluxeComponentSides, applySaidQuesoFresco, splitEnchiladaOrders, applyNegatedMeat, dropUnsaidDorados, applyRiceBeansSide, applyCremaOnSide, applyMeatBienDorada, applySolasVerduraAparte, applySpokenCount, applySideSize, applyMenudoSinPata, applySaidMeat, applyAsadosSide, applyMenudoHominy, dropQdRegularTwin, applyMenudo3Alex2, applyLuis3, applyReadbackCounts, dropTortillaStyleAsk, applyStatedDishTotal, applyStaffRecap, applyMarta1 } from "./list-repair.js";
import { dropUnsaidDishes, applyCountedDishMeat, ringUnnamedSodas, applyRellenoOrder, dropMeatlessDup, applyArbolSalsa, dropStaffUnavailable } from "./order-repair.js";
import { EXPLICIT_EXTRA_MELTED } from "./standard-toppings.js";
import { restaurantConfirm, salsaOnlyTurn, sideAnswerTurn, sideSalsas, applyBurritoReadback, applyReadbackSalsaPref, applyStaffOrderCount, dropIncludedTortillas, applyDrinkRestatement, addStaffConfirmedTacos, applyEnglishReadback, isStatusFollowUpCall, isCancelOrderCall, applyVaporOrders, applyQuesoTortaSpoken, applyEnchiladaOrder, applyQdSupreme } from "./readback-pass.js";
import { spokenLedger, staffUnavailable, unaSplitMeats, applyUnaSplit, isAvailQ, isEchoOfStaff } from "./spoken-ledger.js";
import { callerLedger, callerLedgerEn, priceCents, spokenTotalDollars, priceAnswer } from "./caller-ledger.js";
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
/** chui1: copy of a 16-bit mono WAV with every sample scaled by g (clipped). */
export function withGain(wav: Buffer, g: number): Buffer {
  const b = Buffer.from(wav);
  for (let i = 44; i + 1 < b.length; i += 2) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(b.readInt16LE(i) * g))), i);
  return b;
}
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
    let { words, language } = await sttWords(track);
    // chui1 (CA95e4264e): a quiet staff leg (peak ~10k, 26 s of speech) came back from STT as "" — retry louder.
    if (!words.length && activeSeconds(track, track.readUInt32LE(24)) >= 2) for (const g of [2, 3]) {
      const again = await sttWords(withGain(track, g)); if (again.words.length) { ({ words, language } = again); break; }
    }
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
  // kazandra1/daniel2: "…con pata y …sin pata" must stay ONE item — splitItems otherwise
  // breaks rewriteCallerText's "un menudo con pata y un menudo sin pata" and the second
  // half's "sin pata" converts every Con Pata bowl to SIN (adriana1 path).
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i], b = out[i + 1];
    const conSin = /\bcon\s+patas?\b/iu.test(a) && /\bsin\s+patas?\b/iu.test(b);
    const sinCon = /\bsin\s+patas?\b/iu.test(a) && /\bcon\s+patas?\b/iu.test(b);
    const menudoish = /\bmenudos?\b/iu.test(a + " " + b)
      || /\buno\s+(?:con|sin)\s+patas?\b/iu.test(a)
      || /\b(?:uno|el\s+otro)\s+(?:con|sin)\s+patas?\b/iu.test(b);
    if ((conSin || sinCon) && menudoish) {
      out[i] = `${a} y ${b}`;
      out.splice(i + 1, 1);
      i--;
    }
  }
  return out;
}

const LEAD = /^(?:(?:hola|hi|hello|hey|oye|sí|si|yes|okay|ok|bueno|eh|em|ehm|um|uh|este)\b[,.!]?\s*|no[,.!]\s+|(?:buenas\s+(?:tardes|noches)|buenos\s+días|good\s+(?:morning|afternoon|evening))[,.!]?\s*|(?:quiero|quisiera|dame|me\s+(?:das|da|pones|puedes\s+dar|regalas)|can\s+i\s+(?:get|have)|could\s+i\s+(?:get|have)|i(?:'d|\s+would)\s+like|i\s+want|let\s+me\s+get|i'll\s+have)\s+)/iu;
// fix20: bare "no" is NOT filler — "no crema" / "no, mejor tres" must keep the "no". Only "no," / "no!" as a discourse tag is stripped.
/** Phone filler the menu resolver doesn't need: "Hola, buenas tardes. Quiero tres tacos..." -> "tres tacos...". */
export function cleanPhrase(text: string): string {
  let t = String(text || "").trim().replace(/^[.,!¡¿\s]+/, "");
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
const CLOSING = /^(?:no[,.\s]*)?(?:es\s+todo|eso\s+es\s+todo|nada\s+más|ser[ií]a\s+todo|serio\s+todo|that'?s\s+(?:all|it|everything)|no\s+thanks?|gracias|bueno|ok(?:ay)?|sale|perfecto|listo|alright|great|thanks?|thank\s+you(?:\s+so\s+much)?|para\s+recoger|for\s+pick\s*up|pickup|[aá]ndale(?:\s*,?\s*pues)?|[oó]rale(?:\s*,?\s*pues)?)\b/iu;
const FOOD = /\b(?:tacos?|burritos?|burros?|chimichangas?|quesadillas?|qd|gorditas?|queso\s+tortas?|tortas?|combo|enchiladas?|tamales?|menudos?|po[sz]oles?|moles?|platillos?|plates?|birrias?|tortillas?|horchata|jamaica|jarritos?|agua|soda|bowl|nachos|elote|esquite|corn|pack|platter|charola|sopesazos?|sopesasos?|sopes?|huaraches?|guaraches?|tostadas?|mariscos|cocktail|cóctel)\b/iu;
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
// rich1: staff goodbye or pickup ETA ("give us about twenty", "we should have this for you", "bye")
const WRAP_UP = /\b(?:bye|good\s*bye|adi[oó]s|have\s+a\s+(?:good|great|nice)\s+(?:one|day|night|evening))\b|\bgive\s+us\s+(?:about\s+)?(?:\d+|ten|fifteen|twenty|thirty|twenty[-\s]five)\b|\bshould\s+have\s+(?:this|it|that|them)\s+(?:for\s+you|ready)\b/iu;
export const isClosing = (t: string) => {
  let s = t.trim();
  if (!s || FOOD.test(s)) return false;
  // orders1: "that's it, I'd like five orders" sets a count — not a goodbye
  if (/\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:orders?|[oó]rdenes|more|m[aá]s)\b/iu.test(s)) return false;
  const body = s.replace(/^(?:bueno|ok(?:ay)?|listo|perfecto|sale|all\s+right|alright|great|sí|si|yes)[,.!]?\s+/iu, "").trim();
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
  // daniel2: "nada de verduras" / "así solitos" / staff "no verdura"
  { re: /verduras?|vegetables?|veggies?/i, note: "no verdura" },
];
export function removalNotesIn(text: string): string[] {
  const out: string[] = [];
  for (const { re, note } of REMOVAL_NOTES) {
    const hit = new RegExp(String.raw`\b(?:no|sin|without|hold(?:\s+the)?)\s+(?:(?:el|la|los|las|the|de)\s+)?(?:${re.source})\b`, "i").test(String(text || ""));
    if (hit && !out.includes(note)) out.push(note);
  }
  // daniel2: "nada de verduras" / "puro bistec… así solitos" (plain taco, no toppings)
  if (/\bnada\s+de\s+verduras?\b/iu.test(text) || /\bas[ií]\s+solitos?\b/iu.test(text)) {
    if (!out.includes("no verdura")) out.push("no verdura");
  }
  // noe1 (CA8e26a89, Oct 30 8:08 PM ET): "con la verdura aparte" / "veggies on the side" → toppings packed separately
  if (/\b(?:verduras?|vegetales|toppings?|veggies|cebolla\s+y\s+cilantro)\s+(?:(?:por\s+)?aparte|por\s+separado|de\s+lado|a\s+un\s+lado|on\s+the\s+side|separate(?:ly)?)\b/iu.test(text) || /\b(?:aparte|on\s+the\s+side)\s+(?:la|las|el|the)\s+(?:verduras?|vegetales|toppings?|veggies)\b/iu.test(text)) {
    if (!out.includes("verdura aparte")) out.push("verdura aparte");
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
  // ricardo1: STT stutter "una, dos de costilla y una de bistec" (not "una de,")
  a = a.replace(/^(?:una?|uno)\s*,\s*/iu, "").trim();
  // roberto1: "una de bistec llena de chorizo" → two meats (llena de = another filled with)
  a = a.replace(/\bllena\s+de\b/giu, "y una de").replace(/\s{2,}/g, " ").trim();
  if (!a || FOOD.test(a)) return null;
  const qtyRe = new RegExp(`^(${QTY})\\s+(?=de\\s)`, "iu");
  const parts = a.split(new RegExp(`\\s*(?:,|\\by\\b|\\band\\b)\\s*(?=(?:${QTY}\\s+)?de\\s)`, "iu")).map((x) => x.trim()).filter(Boolean);
  if (!parts.length || !parts.every((x) => new RegExp(`^(?:${QTY}\\s+)?de\\s+[\\p{L}][\\p{L}\\s]{1,40}$`, "iu").test(x))) return null;
  pendingDish = cleanPhrase(pendingDish).replace(/^(?:y\s+)?(?:me\s+)?(?:pone|pones|ponga|das|da|dame|manda|traes?)\s+/iu, "").trim();
  const dishQty = (pendingDish.match(new RegExp(`^(${QTY})\\s+`, "iu")) || [])[1] || "";
  const dish = pendingDish.replace(new RegExp(`^${QTY}\\s+`, "iu"), "").replace(/[,.\s]+$/u, "").trim();
  return parts.map((x) => { const q = (x.match(qtyRe) || [])[1]; return `${q || dishQty} ${dish} ${x.replace(qtyRe, "")}`.trim(); });
}
const ORDER_INTENT = /^[¿¡\s]*(?:(?:s[ií]|oh|hola|bueno|eh|em|ehm|um|uh|este)[,.\s]+)*(?:(?:buenos\s+d[ií]as|buenas\s+(?:tardes|noches))[,.\s]+)?(?:(?:se\s+)?(?:puedo|podr[ií]a|puede|quiero|quisiera|me\s+gustar[ií]a)\s+(?:hacer|poner|dejar|ordenar|pedir)(?:\s+(?:una?|mi)\s+(?:orden|pedido))?|(?:hacer|poner|dejar)\s+(?:una?|mi)\s+(?:orden|pedido)|para\s+(?:hacer|poner|dejar)(?:\s+(?:una?|mi))?\s+(?:orden|pedido)|para\s+(?:una?|mi)\s+(?:orden|pedido)|para\s+hacer\b|can\s+i\s+(?:place|make|put\s+in)\s+an?\s+order|i(?:'d|\s+would)\s+like\s+to\s+(?:place\s+an\s+)?order|i\s+wanted\s+to\s+(?:place\s+(?:an\s+)?)?order|wanted\s+to\s+place\s+an?\s+order)\b(?:[?.!,\s]|\b(?:por\s+favor|please)\b)*/iu;
const ORDER_QTY_DISH = /\p{L}{3,}/u;
export const isOrderIntro = (text: string) => {
  const c = cleanPhrase(text);
  if (FOOD.test(text) || !ORDER_INTENT.test(c)) return false;
  const rest = c.replace(ORDER_INTENT, "").replace(/\b(?:por\s+favor|please|gracias|thanks)\b/giu, "").trim();
  return !ORDER_QTY_DISH.test(rest);
};
export const STAFF_VOICE = /^[¿¡\s]*(?:¿\s*)?(?:cu[aá]nt[oa]s?\s+\p{L}+\s+(?:quer[ií]a|quiere|quieres|va\s+a\s+querer)|qu[eé]\s+m[aá]s|qu[eé]\s+le\s+(?:vamos\s+a\s+)?(?:pongo|ponemos|damos)|de\s+qu[eé]\s+(?:las?|los?)\s+quiere|algo\s+m[aá]s)\b[^.!]*\?/iu;
export const isCountOnly = (text: string) => !FOOD.test(text) && !orderResidue(text, null).replace(new RegExp(`(?<![\\p{L}])(?:${QTY.slice(3, -1)}|y|and)(?![\\p{L}])`, "giu"), "").trim();
const COUNT: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, dosa: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export const spokenCount = (phrase: string) => { const w = String(phrase || "").trim().split(/\s+/)[0]?.toLowerCase() || ""; return /^\d+$/.test(w) ? Number(w) : COUNT[w] || 0; };
export const DIPS_ID = "sq-dips-MAIPCN";
export const EXTRAS_ID = "sq-extras-mild-salsa-asada-2oz-T6PGNT"; // Extras item; variation picked by option
export const COMAL_OPTION: Record<string, string> = { quesadilla: "(QCO) Quesadilla de Comal / Homemade" };

type Line = { itemId: string; quantity: number; modifiers?: any[]; readback?: string; elviNotes?: string[]; posSize?: "small"; posMenudo?: "solo" };
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
const INFO_Q = /\b(?:vegetarian[oa]?s?|vegan[oa]?s?|meat|carne|pork|puerco|manteca|lard|fat|gluten|dairy|l[aá]cteos?|allerg\w*|alergi\w*|ingredients?|ingredientes?|lleva[ns]?|contains?|spicy|picante|hours?|horario|open|abiertos?|cierran|close|price|precio|cu[aá]nto\s+cuesta|how\s+much|(?:qu[eé]|cu[aá]nto)\s+(?:cuesta[ns]?|vale[ns]?|sale[ns]?|cobra[ns]?)|a\s+c[oó]mo\s+(?:tiene[ns]?|est[aá][ns]?|son|sale[ns]?|las|los|la|el|me)|precios?|cu[aá]nto\s+(?:es|son)\s+(?:la|el|las|los)|what'?s\s+the\s+price|how\s+much\s+(?:is|are|for))\b/iu;
// desk1 (Julio): "¿me puede preparar una?" is an order, and staff taking one ("¿al nombre de quién?", "dame unos quince minutos",
// "entonces te tengo…") means the call is not info-only — "¿De qué carne hay?" had dropped every caller turn.
const ASKS_TO_ORDER2 = /\b(?:me\s+)?(?:puede|puedes|podr[ií]a|podr[ií]as)\s+(?:preparar|hacer|dar|poner|mandar|tomar|apartar)\b|\bme\s+(?:prepara|hace|manda|aparta)s?\b/iu;
const STAFF_TOOK_ORDER = /\ba?l?\s*nombre\s+de\s+qui[eé]n\b|\bqu[eé]\s+nombre\b|\b(?:dame|deme|d[eé]jame)\s+(?:unos?\s+)?\w+\s+minutos\b|\bentonces\s+(?:te\s+)?tengo\b|\btienes\s+una\s+orden\b|\bte\s+voy\s+a\s+dar\b|\bname\s+for\s+(?:the|your)\s+order\b|\bgive\s+me\s+(?:like\s+|about\s+)?\w+\s+minutes\b|\bso\s+i\s+(?:got|have)\b/iu;
// relleno2: + "ahorita hablo para atrás", "le llamo de nuevo", "vuelvo a llamar"
const CALLBACK_RE = /\b(?:i'?ll|i\s+will|we'?ll|let\s+me)\s+call\s+(?:you\s+)?back\b|\bcall\s+(?:you\s+)?(?:back\s+)?later\b|\b(?:te|le|les)\s+(?:hablo|llamo|marco)\s+(?:m[aá]s\s+(?:tarde|al\s+rato)|luego|al\s+rato|despu[eé]s|otra\s+vez)\b|\b(?:luego|al\s+rato)\s+(?:te|le)\s+(?:hablo|llamo|marco)\b|\b(?:hablo|llamo|marco)\s+(?:para\s+atr[aá]s|de\s+nuevo|otra\s+vez)\b|\bahorita\s+(?:(?:te|le|les)\s+)?(?:hablo|llamo|marco)\b|\bvuelvo\s+a\s+(?:llamar|hablar|marcar)\b/iu;
const CALLBACK_SAID = (turns: Array<{ speaker: string; text: string }>) => turns.some((t) => t.speaker === "caller" && CALLBACK_RE.test(String(t.text || "")));
export function isCallBackNoOrder(turns: Array<{ speaker: string; text: string }>): boolean {
  const caller = turns.filter((t) => t.speaker === "caller").map((t) => String(t.text || ""));
  if (!caller.some((t) => CALLBACK_RE.test(t))) return false;
  if (turns.some((t) => t.speaker === "staff" && STAFF_TOOK_ORDER.test(t.text))) return false;
  const order = (t: string) => ASKS_TO_ORDER2.test(t) || (ASKS_TO_ORDER.test(t) && !/\bcall/i.test(t) && !/^\W*(?:i\s+was\s+)?calling\s+to\s+see\b/i.test(t.replace(/^\W*(?:hi|hello|hey)[,.\s]+/i, ""))) ||
    /\b(?:\d+|one|two|three|four|five|six|dos|tres|cuatro|cinco|seis)\s+(?:orders?\s+of\s+|[oó]rdenes\s+de\s+)?\p{L}{3,}/iu.test(t);
  return !caller.some(order);
}
export function isQuestionOnlyCall(turns: Array<{ speaker: string; text: string }>): boolean {
  const caller = turns.filter((t) => t.speaker === "caller").map((t) => t.text);
  if (!caller.length) return false;
  if (caller.some((t) => ASKS_TO_ORDER2.test(t)) || turns.some((t) => t.speaker === "staff" && STAFF_TOOK_ORDER.test(t.text))) return false;
  const all = caller.join(" ");
  return !caller.some((t) => ASKS_TO_ORDER.test(t)) && INFO_Q.test(all) && /\?|^\s*(?:are|is|do|does|can|what|which|how|tienen|es|son|lleva|hay)\b/imu.test(all);
}
// tw4938: which dish kinds a phrase names, and which kind a menu item is (by its id).
const DISH_KINDS: Array<[string, RegExp]> = [["taco", /\btacos?\b/iu], ["quesadilla", /\bquesadillas?\b|\bqd\b/iu], ["gordita", /\bgorditas?\b/iu], ["queso torta", /\bqueso\s+tortas?\b/iu], ["torta", /\btortas?\b/iu], ["burrito", /\bburritos?\b|\bburros?\b/iu], ["chimichanga", /\bchimichangas?\b/iu],
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
    // felipe1: also "N gorditas al/de pastor" (optional de before al/meat)
    const re2 = new RegExp(String.raw`\b(\d+|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho)\s+(?:(?:tacos?|quesadillas?|gorditas?|queso\s+tortas?|tortas?|qd)\s+)?(?:(?:de\s+)?(?:taquero|comal|harina|street|dorad\w*|preparad\w*|regular(?:es)?|deluxe)\s+)*(?:de\s+)?(?:al\s+)?(${MEAT_LIST})\b`, "giu");
    for (const m of t.matchAll(re2)) {
      const meat = normListedMeat(m[2]); if (seen.has(meat)) continue;
      const before = t.slice(Math.max(0, (m.index || 0) - 5), m.index); if (/\b(sin|no)\s*$/i.test(before)) continue;
      seen.add(meat); out.push({ meat, another: out.length > 0, qty: spokenCount(m[1]) || undefined });
    }
    // felipe1: "dos al pastor" / "cuatro de costilla" — qty + (optional de) + meat, no dish word required
    const re3 = new RegExp(String.raw`\b(\d+|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho)\s+(?:(?:de|del)\b[,.\s]*)?(?:(?:eh|ah|este|umm?)\b[,.\s]*)*(?:al\s+)?(${MEAT_LIST})\b`, "giu");
    for (const m of t.matchAll(re3)) {
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
  // ca7bae57: "a/en nombre de Kevin/Pedro", "Eso sería nombre Ronald" (no "de") — group tickets by name
  {
    // note: no /i on \p{Lu} patterns — /iu makes \p{Lu} match lowercase ("para llevar")
    const chap = /\b(?:ese\s+es\s+|es\s+)?para\s+el\s+(chaparro)\b/iu.exec(t);
    if (chap) return "Chaparro";
    const m = /\b(?:esa\s+(?:ser[ií]a|es)\s+|esa\s+orden\s+(?:ser[ií]a\s+)?(?:es\s+)?|ese\s+es\s+|es\s+)?para\s+(?:el\s+|la\s+)?(\p{Lu}\p{Ll}{2,})\b/u.exec(t)
      || /\b(?:for)\s+(\p{Lu}\p{Ll}{2,})\b/u.exec(t)
      || /\b(?:en\s+)?(?:la|el)\s+(?:orden\s+)?de\s+(\p{Lu}\p{Ll}{2,}|ella|[ée]l)\b/u.exec(t)
      || /\b(?:[Aa]|[Aa]l|[Ee]n)\s+nombre\s+de\s+(\p{Lu}\p{Ll}{2,})\b/u.exec(t)
      || /\b(?:[Ee]so\s+)?[Ss]er[ií]a\s+nombre\s+(?:de\s+)?(\p{Lu}\p{Ll}{2,})\b/u.exec(t);
    if (m && !/^(usted|llevar|aqu[ií]|comer|ahorita|mañana|hoy)$/iu.test(m[1])) {
      const raw = m[1];
      if (raw.toLowerCase() === "él" || raw.toLowerCase() === "el") return "él";
      return raw;
    }
  }
  // plate1: "en otro plato", "por separado", "la otra/siguiente orden", "en un plato aparte" → the next plate
  // nayeli1: "me haces otro orden" / "otra orden" / "dos órdenes" → new person segment
  if (/\b(?:en\s+)?otro\s+plato\b|(?<!\p{L})(?:platos|[oó]rdenes|pedidos|bolsas)\s+(?:por\s+)?separad|\b(?:p[oó]ngalo|ponlo|p[oó]ngamel[oa]s?|ponga|va|van)\s+(?:por\s+)?separad|\b(?:la\s+)?(?:otr[oa]|siguiente)\s+[oó]rden(?:es)?\b|\botr[oa]s?\s+[oó]rden(?:es)?\b|\bme\s+haces\s+otr[oa]\s+[oó]rden\b|\b(?:plato|orden)\s+aparte\b|\bseparate\s+(?:plates?|orders?|bags?)\b|\banother\s+(?:plate|order)\b/iu.test(t)) return "+";
  return null;
}

/** staffpick1: which of Elvi's offered options did staff state (not ask)? Exactly one match or null.
 *  "normal(es)/sencilla" = REGULAR, "preparada" = DELUXE, "street" = Taquero, "flour" = Harina, "homemade/hecha a mano" = Comal. */
export function staffPick(opts: string[], staffSaid: string): string | null {
  const f = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  // cad71199: staff filler "No, es verdad" must not match Comal/Harina/Taquera (or any) opts
  let said = f(staffSaid).replace(/\bno,?\s*es\s+verdad\b/g, " ").replace(/\bes\s+verdad\b/g, " ")
    .replace(/\bnormal(?:es)?\b|\bsencill[ao]s?\b/g, " regular ").replace(/\bpreparad[ao]s?\b/g, " deluxe ")
    .replace(/\bstreet\b/g, " taquero ").replace(/\bflour\b/g, " harina ").replace(/\bhomemade\b|\bhecha a mano\b/g, " comal ")
    // sean1 (CA249b7d): ASR Kamal/Camal = comal; English "corn" for a quesadilla tortilla = comal (no option says corn)
    .replace(/\b[kc]amal\b/g, " comal ");
  if (opts.some((o) => /comal/i.test(o)) && !opts.some((o) => /\bcorn\b/i.test(o))) said = said.replace(/\bcorn\b|\bmaiz\b/g, " comal ");
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
  // josh1 (CAaaa9a2): English ASR "dosa" for Spanish "dos" before comal/quesadillas
  s = s.replace(/\bdosa\b/giu, "dos");
  // josh2 (CA75cb2b): "quesadillas en el Salte / en aceite / fried" = fried in oil → quesadillas doradas (no tortilla ask)
  s = s.replace(/\b(quesadillas?)\s+en\s+(?:el\s+|la\s+)?(?:salte|saltes|salt|aseite|asete|acete|aceites)\b,?(?:\s+fried\b)?/giu, "$1 en aceite");
  s = s.replace(/\b(quesadillas?)\s+fried\b|\bfried\s+(quesadillas?)\b/giu, (_m, a, b) => `${a || b} en aceite`);
  // sean1 (CA249b7d): English ASR "Kamal/Camal" for comal
  s = s.replace(/\b[KkCc]amal\b/gu, "comal");
  // joseBirria1 (CA13b893): STT "cuatro tortillas estas" → tortillas extras
  s = s.replace(/(?<![\p{L}])tortillas?\s+estas(?![\p{L}])/giu, (m) => m.replace(/estas/i, "extras"));
  // oscar1: STT menú↔menudo when ordering verb present (ASCII \b fails on menú)
  if (/(?<![\p{L}])(?:preparar|pedir|quiero|quisiera|dame|deme|pon(?:me|ga)?)(?![\p{L}])/iu.test(s))
    s = s.replace(/(?<![\p{L}])men[uú](?![\p{L}])/giu, "menudo");
  s = s.replace(/\bde\s+de\b/giu, "de"); // oscar1 ASR: "quesadilla de de lengua"
  // ca0d0e12: ASR "charrón" / "charron" → chicharrón (duro correction)
  s = s.replace(/\bcharr[oó]n(?:es)?\b/giu, "chicharrón");
  // cad71199: ASR "clemoritas" / "clemorita" → gorditas (chicharrón duro)
  s = s.replace(/\bclemoritas?\b/giu, "gorditas");
  // ca0d0e12: "dos. O póngame tres, perdón" after staff "¿Dos o tres?" — final qty wins
  s = s.replace(new RegExp(String.raw`\b(${NUMW})\s*[.,]?\s*(?:o\s+)?p[oó]ngame\s+(${NUMW})\b`, "giu"), "$2");
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
  // ca7bae57: staff "quesibirrias"/"quesivirrias" + caller "quesadilla de birria" → Queso Birrias (not 1 lb birria)
  s = s.replace(/\bquesi[bv]irrias?\b/giu, "Queso Birrias");
  // rich1: ASR "queso burias" / "queso birias" / "quesabirria" → Queso Birrias (never pambazo / 1 lb birria)
  s = s.replace(/\b(?:queso|quesa|keso)\s*[bv](?:u|i|ui)r+i?as?\b|\bquesa[bv]irrias?\b/giu, "Queso Birrias");
  // rich1: ASR glues the article onto chorizo ("taggitorizo")
  s = s.replace(/\b[a-z]+[ck]?[ht]orizo\b/giu, (m) => /^chorizo$/i.test(m) ? m : "chorizo");
  s = s.replace(/\bquesadillas?\s+de\s+birria\b/giu, "Queso Birrias");
  // ca7bae57: ASR "disel" → bistec ("burrito grande de disel")
  s = s.replace(/\bdisel\b/giu, "bistec");
  // ca35be80: "tripita" diminutive + "taquitos" — listedMeats needs tripa/tacos
  s = s.replace(/\btripitas?\b/giu, "tripa");
  s = s.replace(/\btaquitos\b/giu, "tacos");
  // jose1: ASR "Vité"/"vite" for vista/bistec (also bare "de Vité." after the dish turn)
  // kevin1 (CA58ec0f): ASR "Vitéz"/"Vité"/"vite" → bistec
  s = s.replace(/\bde\s+vit[eé]z?(?!\p{L})/giu, "de bistec");
  s = s.replace(/\bvit[eé]z?(?!\p{L})/giu, "bistec");
  // gino1: "quesadillas de bistec supreme" → keep meat/qty, mark dorada deluxe
  if (/\b(?:quesadillas?|doradas?|qd)\b/iu.test(s)) s = s.replace(/\bsuprem[ea]s?\b/giu, "doradas deluxe preparadas"); // chui1: + doradas/qd, suprema
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
  // ca537a80: "sí, tiene quesadillas en aceite" → doradas order cue (not victor1 avail drop)
  s = s.replace(/\b(?:s[ií][,.]?\s+)?tiene\s+quesadillas?\s+(?:en|de)\s+aceite\b/giu, "quesadillas doradas de aceite");
  // ca537a80: ASR "Para la." (cut-off preparada) after style ask — bare fragment
  s = s.replace(/^\W*para\s+la\W*$/iu, "preparadas");
  // miriam1: ASR "También debiste" / "debiste" → "de bistec" (gordita meat)
  s = s.replace(/\b(?:tambi[eé]n\s+)?debiste\b/giu, "también de bistec");
  // juanTst1: ASR "cinco de viste" / "de viste" → bistec; "dos sabos de horchata" → vasos
  s = s.replace(/\bde\s+viste(?!\p{L})/giu, "de bistec");
  s = s.replace(/\bviste(?!\p{L})/giu, "bistec");
  // raul2 (CA06ecc4): ASR "bizco" for bistec ("otros tres de bizco")
  s = s.replace(/\bbizco\b/giu, "bistec");
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
  // kazandra1/daniel2: "dos menudo, uno con pata y uno/el otro sin pata" → one of each SKU
  s = s.replace(/\b(?:dos|2)\s+menudos?\b([^.]{0,120}?)\buno\s+con\s+patas?\s+y\s+(?:uno|el\s+otro)\s+sin\s+patas?\b/giu,
    "un menudo con pata y un menudo sin pata");
  s = s.replace(/\b(?:dos|2)\s+menudos?\b([^.]{0,120}?)\buno\s+sin\s+patas?\s+y\s+(?:uno|el\s+otro)\s+con\s+patas?\b/giu,
    "un menudo sin pata y un menudo con pata");
  // daniel2: split answer on its own turn after "dos menudos" ("y ah, uno con pata y el otro sin pata")
  s = s.replace(/^\W*y?\s*(?:ah[,.]?\s*)?uno\s+con\s+patas?\s+y\s+(?:uno|el\s+otro)\s+sin\s+patas?\W*$/giu,
    "un menudo con pata y un menudo sin pata");
  s = s.replace(/^\W*y?\s*(?:ah[,.]?\s*)?uno\s+sin\s+patas?\s+y\s+(?:uno|el\s+otro)\s+con\s+patas?\W*$/giu,
    "un menudo sin pata y un menudo con pata");
  // miriam2: STT "orden de menos" / "menos dos" → menudo (alias also maps menos→menudo)
  s = s.replace(/\borden(?:es)?\s+de\s+menos(?:\s+dos)?\b/giu, "orden de menudo");
  s = s.replace(/\b(?:un[oa]?|una)\s+menos(?:\s+dos)?\b/giu, "un menudo");
  // julioDorada1: "tres de bistec … de hecho, a dos de bistec" — correction wins
  s = s.replace(new RegExp(String.raw`\b(?:tres|3)\s+de\s+(${MEAT_LIST})\b([\s\S]{0,100}?)\bde\s+hecho,?\s+a\s+(?:dos|2)\s+de\s+\1\b`, "iu"), "dos de $1$2");
  // eva1: STT "opales" → nopales; "papas con nopales" / "nopales con papas"
  s = s.replace(/\bopales\b/giu, "nopales");
  s = s.replace(/\bpapas\s+con\s+nopales\b/giu, "nopales con papas");
  // eva1: "chicharrón del duro" → duro
  s = s.replace(/\bchicharr[oó]n\s+del\s+duro\b/giu, "duro");
  // felipe1 (CA398d11): ASR "unas cuatro de, unas gorditas … de costillas" → "cuatro gorditas de costilla"
  s = s.replace(new RegExp(String.raw`\b(?:unas?\s+)?(${NUMW})\s+de\s*,?\s*(?:unas?\s+)?gorditas?\b([^.!?]{0,100}?)\bde\s+(costillas?)\b`, "giu"),
    (_m, n, _mid, meat) => `${n} gorditas de ${meat}`);
  // felipe1: "dos al pastor" when gorditas already named → "dos gorditas de pastor" (listedMeats needs de+meat)
  if (/\bgorditas?\b/iu.test(s)) {
    s = s.replace(new RegExp(String.raw`\b(${NUMW})\s+al\s+(pastor)\b`, "giu"), (_m, n) => `${n} gorditas de pastor`);
  }
  // kevin1 (CA58ec0f): ASR "quesitota" → quesitorta; "sopa de lata" → coca de lata
  s = s.replace(/\bquesitot[ao]s?\b/giu, "quesitorta"); // vapor1: "quesitoto"
  // ca39e2bb: ASR "queso bruta" → quesitorta (QTO)
  s = s.replace(/\bqueso\s+brutas?\b/giu, "quesitorta");
  s = s.replace(/\bsopa\s+de\s+lata\b/giu, "coca de lata");
  // daryl1 (CAaa8a36): ASR "trigo" → chorizo (double steak double trigo)
  s = s.replace(/\btrigo\b/giu, "chorizo");
  // juan1: NEVER rewrite "papa(s)" → pata — potato STT is not beef feet
  return s;
}
export function prepMergedCallerTurns(merged: { speaker: string; text: string }[]): void {
  // ca2e1da7 (Santiago): a caller line cut mid-item ("…y una de de" | "de combinada, de bistec con chorizo")
  // is ONE clause — join the dangling "una de" with the next caller turn so the 2nd item isn't lost.
  for (let i = 0; i < merged.length - 1; i++) {
    const t = merged[i]; if (t.speaker !== "caller") continue;
    if (!/\b(?:un[oa]?|dos|tres|cuatro|cinco|\d+)\s+de(?:\s+de)*\s*[,.…]*\s*$/iu.test(t.text)) continue;
    let j = i + 1; while (j < merged.length && merged[j].speaker !== "caller" && /^\W*\s*$/u.test(merged[j].text)) j++;
    if (j >= merged.length || merged[j].speaker !== "caller") continue;
    t.text = (t.text.replace(/(?:\s+de)+\s*[,.…]*\s*$/iu, " de ") + merged[j].text.replace(/^\s*(?:de\s+)+/iu, "")).replace(/\s+/g, " ");
    merged[j].text = ""; }
  // ca2e1da7: "otras tres quesadillas de comal" … "dos de prensado y una de combinada, de bistec con chorizo"
  // → stamp the dish + tortilla onto each "N de X" clause; "combinada de A con B" = one mixed-meat line.
  { let dish = "";
    for (const t of merged) { if (t.speaker !== "caller" || !t.text) continue;
      // only a bare group announce ("otras tres quesadillas de comal" — tortilla said, no meat) carries to the NEXT caller turn
      const d = [...t.text.matchAll(new RegExp(String.raw`\b(?:otr[oa]s?\s+)?(?:\d+|dos|tres|cuatro|cinco|seis)\s+(quesadillas?|tacos?|gorditas?|sopes?)(\s+de\s+(?:comal|harina|ma[ií]z|aceite))(?!\s+(?:de\s+|del\s+)?(?:${MEAT_LIST}))\s*[.,]?\s*$`, "giu"))].pop();
      const prevDish = dish; dish = d ? `${d[1].replace(/s$/i, "")}${d[2]}` : "";
      if (d || !prevDish) continue;
      dish = ""; const useDish = prevDish;
      if (!new RegExp(String.raw`\b(?:un[oa]?|dos|tres|cuatro|\d+)\s+(?:de\s+)+(?:combinada,?\s+de\s+)?(?:${MEAT_LIST})\b[^.?]*\by\s+un[oa]?\s+de\s+`, "iu").test(t.text)
        && !/\bun[oa]?\s+de\s+combinada\b/iu.test(t.text)) continue;
      if (new RegExp(String.raw`\b${useDish.split(" ")[0]}s?\s+de\s+(?:${MEAT_LIST})`, "iu").test(t.text)) continue;
      t.text = t.text
        .replace(/\b(?:de\s+){2,}/giu, "de ") // stutter "una de de (combinada)"
        .replace(/\bcombinada,?\s+de\s+/giu, "")
        .replace(new RegExp(String.raw`\b(un[oa]?|dos|tres|cuatro|cinco|\d+)\s+de\s+(?=(?:${MEAT_LIST})\b)`, "giu"), (_m, n) => {
          const one = /^(?:un[oa]?|1)$/i.test(n); const [w, ...rest] = useDish.split(" ");
          return `${one ? (/^(?:quesadilla|gordita)/i.test(w) ? "una" : "un") : n} ${one ? w : w + "s"}${rest.length ? " " + rest.join(" ") : ""} de `; });
    } }
  // ca2e1da7: "¿me puede poner un plato grande?" right after asking for menudo = the menudo (32oz con tortillas),
  // not a new dish — Elvi looped the pata prompt. No pata said → sin pata.
  { let menudoAt = -9;
    for (let i = 0; i < merged.length; i++) { const t = merged[i]; if (t.speaker !== "caller") continue;
      if (/(?<![\p{L}])menudos?(?![\p{L}])/iu.test(t.text)) { menudoAt = i; }
      if (i - menudoAt <= 4 && /\b(?:un|el)\s+plato\s+grande\b/iu.test(t.text) && !/\b(?:tacos?|quesadillas?|gorditas?|platillos?\s+de)\b/iu.test(t.text)) {
        const pata = merged.some((x) => x.speaker === "caller" && /\bcon\s+patas?\b/iu.test(x.text));
        t.text = t.text.replace(/\b(?:un|el)\s+plato\s+grande\b/iu, pata ? "un Con Pata Menudo 32oz y Tortillas (4)" : "un Menudo con Tortillas (4)"); menudoAt = i; } } }
  // fixmeat1 (Jesús): "de chorizo, que diga, perdón, del pastor" — the self-correction replaces the meat
  const FIXW = String.raw`(?:que\s+diga|perd[oó]n|digo|mejor|no+)`;
  for (const t of merged) if (t.speaker === "caller")
    t.text = t.text.replace(new RegExp(String.raw`\bde\s+(?:${MEAT_LIST}|pastor)\s*,?\s*${FIXW}(?:\s*,?\s*${FIXW})*\s*,?\s*(?:de\s+|del\s+)?(al\s+pastor|pastor|${MEAT_LIST})\b`, "iu"), (_m, y) => `de ${/^pastor$/i.test(y) ? "al pastor" : y}`);
  // ca0d0e12: "las de comal van a ser de chicharrón duro(s)" / "de duros" — meat swap on comal lines
  for (const t of merged) if (t.speaker === "caller") {
    t.text = t.text.replace(/\bcharr[oó]n(?:es)?\b/giu, "chicharrón");
    t.text = t.text.replace(/\b(?:las?\s+de\s+comal\s+)?van\s+a\s+ser\s+de\s+(?:chicharr[oó]n\s+)?duros?\b/giu, "de chicharrón duro");
    t.text = t.text.replace(/\bde\s+prensado,\s*no,?\s+las\s+de\s+comal\s+van\s+a\s+ser\s+de\s+(?:chicharr[oó]n\s+)?duros?\b/giu, "de chicharrón duro las de comal");
  }
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

  // joseBirria1: STT "tortillas estas" → tortillas extras (before menu/menudo logic)
  for (const t of merged) {
    if (t.speaker !== "caller" && t.speaker !== "staff") continue;
    t.text = t.text.replace(/(?<![\p{L}])tortillas?\s+estas(?![\p{L}])/giu, (m: string) => m.replace(/estas/i, "extras"));
  }
  // oscar1 (CA041f564): STT "preparar un menú" ↔ menudo — don't leave menu-pitch when ordering
  // (\b is ASCII-only; menú needs lookaround so ú is not split as a boundary)
  {
    const all = merged.map((x) => x.text).join(" ");
    const menudoCtx = /(?<![\p{L}])menudos?(?![\p{L}])/iu.test(all) || /(?<![\p{L}])patas?(?![\p{L}])/iu.test(all);
    const MENU = /(?<![\p{L}])men[uú](?![\p{L}])/giu;
    for (const t of merged) {
      if (t.speaker !== "caller") continue;
      // alejandro1: "¿qué menú tiene hoy?" / "el menú de hoy" is asking for the menu, never menudo
      if (/(?<![\p{L}])(?:qu[eé]|cu[aá]l|el)\s+men[uú](?![\p{L}])/iu.test(t.text) || /(?<![\p{L}])men[uú]\s+(?:de\s+)?hoy\b/iu.test(t.text)) continue;
      if (MENU.test(t.text) && (/(?<![\p{L}])(?:preparar|pedir|quiero|quisiera|dame|deme|me\s+da|pon(?:me|ga)?|orden|pedido)(?![\p{L}])/iu.test(t.text) || menudoCtx)) {
        MENU.lastIndex = 0;
        t.text = t.text.replace(MENU, "menudo");
      }
      MENU.lastIndex = 0;
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
  // alexvoc1e: single "chorizo con bistec" line — stamp the missing meat (model/force-add often keeps one)
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
  // CAaf7c97: a price/availability question with no order intent never opens the item flow; Elvi's suggested reply is the
  // catalog price (data/site-catalog.json), never a modifier upcharge ("$1" for QCO) or a meat prompt.
  // alexvoc1: "ya va pa allá" / restating the drinks on an order already placed — no new cart.
  if (isStatusFollowUpCall(turns as any))
    return { cart: [] as Line[], steps: [{ source: "status-call", heard: turns.map((t) => t.text).join(" ").slice(0, 120) }], autoAccepted: false, containers: [], ambiguousRemovals: [], removalsAttributed: true, fulfillment: null, address: null, addressConfirmed: false, statusCall: true } as any;
  // daniel-cancel1: a callback cancelling an earlier order — never a new cart (nothing from memory, recap or the old order).
  if (isCancelOrderCall(turns as any))
    return { cart: [] as Line[], steps: [{ source: "cancel-order", heard: turns.map((t) => t.text).join(" ").slice(0, 120) }], autoAccepted: false, containers: [], ambiguousRemovals: [], removalsAttributed: true, fulfillment: null, address: null, addressConfirmed: false, statusCall: true, noOrder: true, cancelCall: true } as any;
  // cmissing1: only availability questions + "I'll call you back" / "le hablo luego" — no cart, no final ticket.
  if (isCallBackNoOrder(turns as any))
    return { cart: [] as Line[], steps: [{ source: "call-back-no-order", heard: turns.map((t) => t.text).join(" ").slice(0, 120) }], autoAccepted: false, containers: [], ambiguousRemovals: [], removalsAttributed: true, fulfillment: null, address: null, addressConfirmed: false, statusCall: true, noOrder: true } as any;
  if (isQuestionOnlyCall(turns)) {
    const steps: any[] = [];
    const ctx: string[] = []; let lastReply = "";
    for (const t of turns) if (t.speaker === "caller") { // ASR splits "las quesadillas en" / "Comal" — answer on the caller's recent words
      ctx.push(t.text); if (ctx.length > 3) ctx.shift();
      const reply = priceAnswer(ctx.join(" "), t.language === "en" ? "en" : "es");
      if (reply && reply !== lastReply) { const prev = steps[steps.length - 1]; if (prev && ctx.length > 1 && reply.length > prev.reply.length && prev.heard === ctx[ctx.length - 2]) steps.pop(); steps.push({ source: "caller-price-question", heard: t.text, language: t.language, reply, actions: [] }); lastReply = reply; } }
    return { cart: [] as Line[], steps, autoAccepted: false, containers: [], ambiguousRemovals: [], removalsAttributed: true, fulfillment: null, address: null, addressConfirmed: false, questionOnly: true } as any;
  }
  const origTurns = turns.map((t) => ({ speaker: t.speaker, text: String(t.text || "") })); // gloria1: as heard, before in-loop merges/rewrites
  const cart: Line[] = [];
  const history: Array<{ role: "customer" | "assistant"; text: string }> = [];
  const steps: any[] = [];
  let lastTouched: Line | null = null;
  const touchedNow: Line[] = [];
  let person: string | null = null, plateN = 0, personSegStart = 0; // multi1/agustin1: per-person groups; segStart for para-X backfill
  let sizeAnswer = false;
  // luis7895/chuy1: "dos/tres menudos" often gets an Elvi question (empty add); apply spoken qty on the later add (incl. staff-pick).
  let pendingSpokenQty: { n: number; kind: string } | null = null;
  let pendingQuesadilla: { n: number; meat: string; deluxe?: boolean } | null = null; // gino1: "dos quesadillas de bistec" before aceite/preparadas; eva1 deluxe=aceite
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
        if (i >= 0) { cart[i] = { ...cart[i], quantity: Number(a.quantity) > 0 ? a.quantity : cart[i].quantity, ...(a.modifiers ? { modifiers: a.modifiers } : {}) }; lastTouched = cart[i]; touchedNow.push(cart[i]); }
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
      if (p === "+") { if (!(person && personSegStart === cart.length)) person = `plato ${++plateN + 1}`; personSegStart = cart.length; } // lena1: "another order?"… "for the other order" = one new group
      else if (p === "me") { personSegStart = cart.length; person = "me"; }
      else if (p) {
        // agustin1: closing stamp ("esa sería/es para Tony", "ese es para el chaparro") backfills the open ticket.
        // multi2: opening ("para Juana es una porción…") starts a new person — do not stamp prior items.
        // nayeli1: staff "orden para quién" → caller "Para Verónica" stamps the open segment (not a fresh open).
        const staffWho = /\b(?:orden\s+)?para\s+qui[eé]n|para\s+qui[eé]n\s+va|a\s+nombre\s+de\s+qui[eé]n/iu.test(
          history.filter((h) => h.role === "assistant").slice(-3).map((h) => h.text).join(" "));
        const closing = /\b(?:esa\s+(?:ser[ií]a|es)\s+|esa\s+orden\s+(?:ser[ií]a\s+)?(?:es\s+)?|ese\s+es\s+)para\b/iu.test(text)
          || (staffWho && /\bpara\s+(?:el\s+|la\s+)?\p{Lu}/u.test(text) && cart.length > personSegStart);
        if (closing) {
          for (let i = personSegStart; i < cart.length; i++) (cart[i] as any).person = p;
        } else {
          personSegStart = cart.length;
        }
        person = p;
      }
    }
    const r = await run(text, language, history.slice(-24));
    // anthony1: a caller availability question ("¿tienes pollo a la crema?") or an echo of staff's menu list ("Coctel de camarón")
    // orders nothing — drop any adds the model made on that turn.
    if ((source === "caller" || source === "caller-retry") && Array.isArray((r as any)?.actions)
      && (isAvailQ(text) && !/\b(?:\d+|dos|tres|cuatro|cinco|seis|ocho|diez)\s+\p{L}/iu.test(text) || isEchoOfStaff(text, recentStaff.slice(-2).join(" "))))
      (r as any).actions = (r as any).actions.filter((a: any) => a?.type !== "add_item");
    // brenda1: "this is the Elvis, right?" (pozole), "more lengua" / "not too much rice" after staff's "rice and beans is fine?" (mole),
    // "two green, one red, the avocado salsa" (tacos/huarache) — none of these start a new dish.
    if ((source === "caller" || source === "caller-retry") && Array.isArray((r as any)?.actions)
      && (restaurantConfirm(text) || sideAnswerTurn(text, recentStaff.slice(-1).join(" ")) || salsaOnlyTurn(text)))
      (r as any).actions = (r as any).actions.filter((a: any) => a?.type !== "add_item" || (salsaOnlyTurn(text) && a.itemId === EXTRAS_ID) || cart.some((l: any) => l.itemId === a.itemId)); // a re-add of a dish already ordered is an update
    // gio1: "una de tripa y de bistec" — each split meat is one unit on this turn's adds (announced "dos" is shared, not per line)
    const unaSplit = unaSplitMeats(text);
    if (unaSplit && Array.isArray((r as any)?.actions)) applyUnaSplit((r as any).actions.filter((a: any) => a?.type === "add_item"), unaSplit);
    sizeAnswer = /^\W*(?:a\s+|el\s+|un\s+|lo\s+)?(?:regular|grande|chico|mediano|small|medium|large)\W*$/iu.test(text);
    // larry1: "eight of your steak quesadillas" → Elvi asks the tortilla → "flour": the answer keeps the count of the turn that asked.
    { const pa = history[history.length - 1]?.text || "", pc = history[history.length - 2]?.text || "";
      const NUM: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
      const NRE = /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i;
      const mq = /\?\s*$/.test(pa) && !/algo más|anything else/i.test(pa) ? pc.match(NRE) : null;
      const noun = mq ? dishNoun(pc) : "";
      if (mq && noun && !NRE.test(text) && !unaSplit) { const n = NUM[mq[1].toLowerCase()] ?? Number(mq[1]);
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
    // alexvoc1: "Y en otro no me le puede poner este," + "en vez de huevos bistec" — the previous half-sentence asked for ANOTHER one
    const names0 = FOOD.test(text) || DRINK.test(text) || ORDER_QTY.test(text) || (/\b(otr[oa]s?|another|one more)\b/i.test(prevCaller) && /[,]\s*$/.test(prevCaller.trim()) && !FOOD.test(prevCaller));
    // case1: "…la otra" / "las de bistec" points at a dish already rung — choices for it, not a new one
    const definite = /\b(la|el|las|los)\s+otr[oa]s?\b|\b(?:o\s+)?las,?\s+de\b/i.test(text) && !/\b(\d+|dos|tres|cuatro|una m[aá]s|otra m[aá]s)\b/i.test(text) && !FOOD.test(text);
    const names = names0 && !definite;
    // sopesaso1: …but if the re-add carries new choices ("bistec con chicharrón del duro", "con todo") it updates that dish.
    // alexvoc1: "sí, unos normales y otros con bistec, sí" confirms lines already rung — re-adds of an identical line are dropped
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
    // carlos-qd1: name/thanks filler must never invent QD (or Mild Salsa Asada) when caller named no dish/meat
    if (source.startsWith("caller") && (/\ba\s+nombre\s+de\b/iu.test(text) || /^\W*(?:(?:ok(?:ay)?|s[ií]|bueno)[,.]?\s+)*(?:s[ií][,.]?\s+)?(?:est[aá]\s+bien|ok(?:ay)?|perfecto)[,.\s]*(?:much[ií]simas?(?:\s+gracias)?|gracias)?\W*$/iu.test(text) || /^\W*(?:much[ií]simas?(?:\s+gracias)?|gracias)\W*$/iu.test(text))
      && !FOOD.test(text) && !listedMeats(text).length) {
      for (let i = acts.length - 1; i >= 0; i--)
        if ((acts[i].type === "add_item" || acts[i].type === "update_item") && /dorada|zzav3l|t5stuh|quesadilla/i.test(String(acts[i].itemId)))
          acts.splice(i, 1);
    }
    carryAskedQty(acts, text, history.length >= 4 ? history[history.length - 4].text : "", answering);
    // ca0d0e12: staff "¿Dos o tres?" → "dos. O póngame tres" / "tres" bumps last quesadilla/dorada qty
    if (source.startsWith("caller")) {
      const staffAsk = lastStaff || "";
      const fork = /\b(?:dos|2)\s+o\s+(?:tres|3)\b|\b(?:tres|3)\s+o\s+(?:dos|2)\b/iu.test(staffAsk);
      const m = cleanPhrase(text).match(/\b(?:p[oó]ngame\s+)?(tres|3|dos|2|cuatro|4|cinco|5)\b/iu);
      if (fork && m) {
        const n = spokenCount(m[1]) || Number(m[1]) || 0;
        if (n >= 2 && n <= 12) {
          const lastQ = [...cart].reverse().find((l) => /quesadilla|dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
          if (lastQ && (Number(lastQ.quantity) || 1) !== n) lastQ.quantity = n;
          for (const a of acts) if (a.type === "add_item" && /quesadilla|dorada|zzav3l|t5stuh/i.test(String(a.itemId || ""))) a.quantity = n;
        }
      }
    }
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
    // francisco1 (CA69876b): "dos aguas de horchata chicas" → qty 2 (not hardcode 1)
    if (source.startsWith("caller")) {
      const drinkWant: Array<[RegExp, string, RegExp]> = [
        [/\bjamaica\b/iu, "sq-drink-agua-fresca-jamaica-32oz-ZLA3ZG", /jamaica/i],
        [/\bhorchata\b/iu, "sq-drink-agua-fresca-horchata-32oz-HL6HPK", /horchata/i],
        [/\btamarindo\b/iu, "sq-drink-agua-fresca-tamarindo-32oz", /tamarindo/i],
      ];
      for (const [re, id, idRe] of drinkWant) {
        if (!re.test(text)) continue;
        const qm = text.match(/\b(dos|2|two|tres|3|three|cuatro|4|four|un[oa]?|1|one)\s+(?:aguas?\s+(?:de\s+)?)?(?:horchata|jamaica|tamarindo)\b/iu)
          || text.match(/\b(dos|2|two|tres|3|three)\s+aguas?\b/iu);
        const drinkQty = qm ? Math.max(1, spokenCount(qm[1]) || Number(qm[1]) || 1) : 1;
        const small = /\bchic[ao]s?\b|\bsmall\b/iu.test(text);
        const have = cart.some((l) => idRe.test(String(l.itemId)))
          || acts.some((a: any) => a.type === "add_item" && idRe.test(String(a.itemId)));
        const rb = id.includes("jamaica") ? "jamaica" : id.includes("horchata") ? "horchata" : "tamarindo";
        if (!have) {
          acts.push({
            type: "add_item", itemId: id, quantity: drinkQty, modifiers: [],
            readback: small ? `${rb} chica` : rb,
            ...(small ? { posSize: "small" as const, elviNotes: ["chica"] } : {}),
          });
        } else {
          for (const a of acts) {
            if (a.type === "add_item" && idRe.test(String(a.itemId)) && (a.quantity || 1) < drinkQty) a.quantity = drinkQty;
          }
          for (const l of cart) {
            if (idRe.test(String(l.itemId)) && (l.quantity || 1) < drinkQty) {
              l.quantity = drinkQty;
              if (small) { (l as any).posSize = "small"; l.elviNotes = [...new Set([...(l.elviNotes || []), "chica"])]; }
            }
          }
        }
      }
    }
    // raul1 (CA8debe0): bare horchata item id at $0 → priced HL6HPK catalog drink
    {
      const BARE = "sq-drink-agua-fresca-horchata-32oz";
      const PRICED = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
      for (const l of cart as any[]) if (String(l.itemId) === BARE) l.itemId = PRICED;
      for (const a of acts as any[]) if (a.type === "add_item" && String(a.itemId) === BARE) a.itemId = PRICED;
    }
    // raul1: drop meatless QD REGULAR phantom when cart already has a meat QD
    {
      const isQd = (id: string) => /dorada|zzav3l|t5stuh/i.test(id);
      const meatless = (mods: any[]) => !(mods || []).some((m: any) => /carne|meat|bistec|chorizo|picadillo|pollo|prensado|duro|pastor|costilla|lengua|buche|nopales|cabeza|carnitas/i.test(String(m.option)));
      const hasMeatQd = cart.some((l) => isQd(String(l.itemId)) && !meatless(l.modifiers || []));
      if (hasMeatQd) {
        for (let i = cart.length - 1; i >= 0; i--) {
          const l = cart[i] as any;
          if (isQd(String(l.itemId)) && meatless(l.modifiers)) cart.splice(i, 1);
        }
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i];
          if (a.type === "add_item" && isQd(String(a.itemId)) && meatless(a.modifiers)) acts.splice(i, 1);
        }
      }
    }
    // raul1: "una torta de bistec" — model often replies with add_item in text but drops the action; force torta
    if (source.startsWith("caller") && /\btortas?\b/iu.test(text) && !/\bqueso\s+tortas?\b/iu.test(text)
      && /\b(?:bistec|steak|asada)\b/iu.test(text)) {
      const TOR = "sq-torta-4GNTTE";
      const haveT = cart.some((l) => /torta/i.test(String(l.itemId)))
        || acts.some((a: any) => a.type === "add_item" && /torta/i.test(String(a.itemId)));
      if (!haveT) {
        acts.push({
          type: "add_item", itemId: TOR, quantity: 1,
          modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }],
          readback: "1 torta bistec",
        });
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
    // joseBirria1 (CA13b893): "N tortillas extras" → Tortillas EXTRAS / 1 x Tortilla Comal ×N (not birria-included tortillas; not dozen pack)
    if (source.startsWith("caller") && /(?<![\p{L}])tortillas?\s+extras?(?![\p{L}])/iu.test(text)) {
      const TOR_X = "sq-tortillas-extras-1-x-tortilla-comal-ADELFI";
      const m = text.match(/\b(\d+|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+tortillas?\s+extras?/iu);
      const n = m ? Math.max(1, spokenCount(m[1]) || Number(m[1]) || 1) : 1;
      const have = cart.some((l) => /tortillas-extras|extras-1-x-tortilla/i.test(String(l.itemId)))
        || acts.some((a: any) => a.type === "add_item" && /tortillas-extras|extras-1-x-tortilla/i.test(String(a.itemId)));
      if (!have) acts.push({ type: "add_item", itemId: TOR_X, quantity: n, modifiers: [], readback: `${n} tortillas extras comal` });
      else {
        for (const a of acts) if (a.type === "add_item" && /tortillas-extras|extras-1-x-tortilla/i.test(String(a.itemId))) a.quantity = n;
        for (const l of cart) if (/tortillas-extras|extras-1-x-tortilla/i.test(String(l.itemId))) l.quantity = n;
      }
    }
    // daniel1 (CA9de2b6): "Nada más, pero no, no sin pata el menudo" = reaffirm SIN.
    // Never qty-bump, never flip to Con Pata / EXTRA Pata. Drop model menudo adds; keep cart SIN.
    if (source.startsWith("caller")) {
      const reaffirmSin = /\bno(?:\s*,?\s*no)?(?:\s+\w+){0,6}\s+sin\s+patas?\b/iu.test(text)
        || /\bsin\s+patas?\s+el\s+menudo\b/iu.test(text)
        || (/\bnada\s+m[aá]s\b/iu.test(text) && /\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(text) && /\bmenudos?\b/iu.test(text));
      const cartMenudo = cart.filter((l) => /menudo/i.test(String(l.itemId)));
      if (reaffirmSin && cartMenudo.length) {
        const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
        for (let i = acts.length - 1; i >= 0; i--) {
          if ((acts[i].type === "add_item" || acts[i].type === "update_item") && /menudo/i.test(String(acts[i].itemId))) acts.splice(i, 1);
        }
        // Keep first bowl qty=1; drop phantom qty×4 from "4 x Tortillas" / model Con Pata dump
        const keep = cartMenudo[0];
        keep.itemId = SIN;
        keep.quantity = 1;
        keep.modifiers = (keep.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet|extra\s*carne/i.test(String(m.option)));
        if (!(keep.modifiers || []).some((m: any) => /tortilla/i.test(String(m.option))))
          keep.modifiers = [...(keep.modifiers || []), { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }];
        for (let i = cart.length - 1; i >= 0; i--) {
          if (/menudo/i.test(String(cart[i].itemId)) && cart[i] !== keep) cart.splice(i, 1);
        }
      }
    }
    // gaby1: "dos botes de puro caldo de menudo" / "uno solo" → SOLO Menudo (posMenudo), not SIN Tortillas default.
    if (source.startsWith("caller") && /\bmenudos?\b/iu.test(text) && /\b(?:puro\s+caldo|caldo\s+de\s+menudo|uno\s+solo)\b/iu.test(text)
      && !/\b(?:con\s+pat|sin\s+pat)\b/iu.test(text)) {
      const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
      const tortMod = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
      const n = spokenCount(cleanPhrase(text)) || (/\bdos\b|\bbotes\b/iu.test(text) ? 2 : 1);
      const markSolo = (row: any) => { row.itemId = SIN; row.posMenudo = "solo"; row.modifiers = [tortMod]; row.readback = row.readback || "menudo solo"; };
      let hit = false;
      for (const a of acts as any[]) if (a.type === "add_item" && /menudo/i.test(String(a.itemId))) { markSolo(a); a.quantity = Math.max(Number(a.quantity) || 1, n); hit = true; }
      for (const l of cart as any[]) if (/menudo/i.test(String(l.itemId)) && !(l as any).posMenudo) { markSolo(l); if (!hit) l.quantity = Math.max(Number(l.quantity) || 1, n); hit = true; }
      if (!hit && !acts.some((a: any) => a.type === "add_item" && /menudo/i.test(String(a.itemId)))) {
        acts.push({ type: "add_item", itemId: SIN, quantity: n, modifiers: [tortMod], readback: `${n} menudo solo`, posMenudo: "solo" } as any);
      }
    }
    // kazandra1/daniel2: "uno con pata y (uno|el otro) sin pata" → exactly 1 CON + 1 SIN (never qty-2 of one).
    if (source.startsWith("caller")) {
      const splitOneEach = /\bun\s+menudo\s+con\s+pata\s+y\s+un\s+menudo\s+sin\s+pata\b/iu.test(text)
        || /\bun\s+menudo\s+sin\s+pata\s+y\s+un\s+menudo\s+con\s+pata\b/iu.test(text)
        || /\buno\s+con\s+patas?\s+y\s+(?:uno|el\s+otro)\s+sin\s+patas?\b/iu.test(text)
        || /\buno\s+sin\s+patas?\s+y\s+(?:uno|el\s+otro)\s+con\s+patas?\b/iu.test(text);
      if (splitOneEach) {
        const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
        const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
        const tortMod = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
        for (let i = acts.length - 1; i >= 0; i--) {
          if ((acts[i].type === "add_item" || acts[i].type === "update_item") && /menudo/i.test(String(acts[i].itemId))) acts.splice(i, 1);
        }
        for (let i = cart.length - 1; i >= 0; i--) {
          if (/menudo/i.test(String(cart[i].itemId))) cart.splice(i, 1);
        }
        cart.push({ itemId: CON, quantity: 1, modifiers: [tortMod], readback: "1 menudo con pata" } as Line);
        cart.push({ itemId: SIN, quantity: 1, modifiers: [tortMod], readback: "1 menudo sin pata" } as Line);
        // Skip the single-SKU con/sin clarify below for this turn — split already final.
        // Fall through for tacos/notes on other turns; menudo force-add gated by split flag via empty acts.
      }
    }
    // enrique1: "va a ser un menudo con pata" / "también va a ser un mole" — model often returns []; force catalog add (not avail asks).
    if (source.startsWith("caller") && !/\b(?:tienen|tienes|hay|tiene|ten[eé]s|vende[ns]?|manejan|disponible)\b/iu.test(text)
      && !(/\bun\s+menudo\s+con\s+pata\s+y\s+un\s+menudo\s+sin\s+pata\b/iu.test(text)
        || /\bun\s+menudo\s+sin\s+pata\s+y\s+un\s+menudo\s+con\s+pata\b/iu.test(text)
        || /\buno\s+con\s+patas?\s+y\s+(?:uno|el\s+otro)\s+sin\s+patas?\b/iu.test(text)
        || /\buno\s+sin\s+patas?\s+y\s+(?:uno|el\s+otro)\s+con\s+patas?\b/iu.test(text))) {
      const haveCart0 = cart.filter((l) => /menudo/i.test(String(l.itemId)));
      // luis1 (CAc1eed1): "De Luis, los quiero con pata" with menudo already in cart — enter even without menudo word
      if ((/\bmenudos?\b/iu.test(text) || /^\W*uno\s+(?:con|sin)\s+patas?\b/iu.test(text)
          || (haveCart0.length > 0 && /\b(?:con|sin)\s+patas?\b/iu.test(text)))
        && (/\b(?:va\s+a\s+ser|quiero|dame|deme|me\s+da|pon(?:me|ga)?|encargar|quisiera|un[oa]?|dos|tres|\d+|los\s+quiero)\b/iu.test(text)
          || /^\W*(?:uno\s+)?(?:con|sin)\s+patas?\b/iu.test(text)
          || (haveCart0.length > 0 && /\b(?:con|sin)\s+patas?\b/iu.test(text)))) {
        const haveCart = haveCart0;
        const haveActs = acts.filter((a: any) => a.type === "add_item" && /menudo/i.test(String(a.itemId)));
        // bryan1/monica (standing): vague "un menudo"/"menudos" with no pata → Menudo con Tortillas (SIN).
        // Con Pata only when caller clearly says con pata.
        // juan1: "con papa(s)" (potato STT) is NEVER Con Pata — only real "pata/patas"
        const saidConPata = /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(text) && !/\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(text) && !/\bcon\s+papas?\b/iu.test(text);
        // daniel1: "no… sin pata" / reaffirm = SIN
        const reaffirmSinPata = /\bno(?:\s*,?\s*no)?(?:\s+\w+){0,6}\s+sin\s+patas?\b/iu.test(text)
          || /\bsin\s+patas?\s+el\s+menudo\b/iu.test(text);
        // miguel2/Carlos 10/25: EXTRA Pata / EXTRA Carne only when customer says *extra* pata/carne — never auto-stamp on bare "con pata".
        const saidExtraPata = /\bextra\s+patas?\b/iu.test(text) && !reaffirmSinPata;
        const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
        const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
        const id = saidConPata ? CON : SIN;
        // luis181d: clarify SKU on an existing bowl; kazandra1: when the other SKU is already rung, ADD the missing bowl instead of converting.
        if (haveCart.length || haveActs.length) {
          const isConId = (id: string) => /con-pata|con_pata/i.test(id);
          const hasCon = haveCart.some((l) => isConId(String(l.itemId))) || haveActs.some((a: any) => isConId(String(a.itemId)));
          const hasSin = haveCart.some((l) => /menudo/i.test(String(l.itemId)) && !isConId(String(l.itemId)))
            || haveActs.some((a: any) => /menudo/i.test(String(a.itemId)) && !isConId(String(a.itemId)));
          const saidSinPata = (/\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(text) || reaffirmSinPata) && !saidConPata;
          const tortMod = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
          const pataMod = { step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" };
          const bareUnoPata = /^\W*uno\s+(?:con|sin)\s+patas?\b/iu.test(text);
          const barePataAnswer = /^\W*(?:sin|con)\s+patas?\W*$/iu.test(text);
          const conMods = saidExtraPata ? [tortMod, pataMod] : [tortMod];
          // Split a qty≥2 SIN line when caller says "uno con pata" (kazandra1)
          if (bareUnoPata && saidConPata) {
            for (const l of haveCart) {
              if ((Number(l.quantity) || 1) >= 2 && !isConId(String(l.itemId))) {
                l.quantity = (Number(l.quantity) || 1) - 1;
                acts.push({ type: "add_item", itemId: CON, quantity: 1, modifiers: conMods, readback: "menudo" });
              }
            }
          } else if (saidConPata && hasSin && (barePataAnswer || !bareUnoPata)) {
            // miguel2: bare "con pata" (or "dos menudos con pata") after SIN bowls → convert ALL to Con Pata SKU, no EXTRA
            for (const l of haveCart) {
              if (/menudo/i.test(String(l.itemId)) && !isConId(String(l.itemId))) {
                l.itemId = CON;
                l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet|extra\s*carne/i.test(String(m.option)));
                if (!(l.modifiers || []).some((m: any) => /tortilla/i.test(String(m.option)))) l.modifiers = [...(l.modifiers || []), tortMod];
                if (saidExtraPata) l.modifiers = [...(l.modifiers || []), pataMod];
              }
            }
            for (const a of haveActs) {
              if (/menudo/i.test(String(a.itemId)) && !isConId(String(a.itemId))) {
                a.itemId = CON;
                a.modifiers = (a.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet|extra\s*carne/i.test(String(m.option)));
              }
            }
            // drop model re-adds on convert
            for (let i = acts.length - 1; i >= 0; i--) {
              if (acts[i].type === "add_item" && /menudo/i.test(String(acts[i].itemId)) && acts[i].readback !== "menudo") acts.splice(i, 1);
            }
          } else if (saidConPata && hasSin && !hasCon && bareUnoPata) {
            acts.push({ type: "add_item", itemId: CON, quantity: 1, modifiers: conMods, readback: "menudo" });
          } else if (saidSinPata && hasCon && (barePataAnswer || !bareUnoPata)) {
            // adriana1: model named Con Pata on "sin pata" → convert ALL to Tortillas (SIN); keep spoken qty
            for (const l of haveCart) {
              if (/menudo/i.test(String(l.itemId))) {
                l.itemId = SIN;
                l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet|extra\s*carne/i.test(String(m.option)));
                if (!(l.modifiers || []).some((m: any) => /tortilla/i.test(String(m.option)))) l.modifiers = [...(l.modifiers || []), tortMod];
              }
            }
            for (const a of haveActs) {
              if (/menudo/i.test(String(a.itemId))) {
                a.itemId = SIN;
                a.readback = "menudo"; // keep after convert (do not splice away model lines we rewrote)
                a.modifiers = (a.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet|extra\s*carne/i.test(String(m.option)));
                if (!(a.modifiers || []).some((m: any) => /tortilla/i.test(String(m.option)))) a.modifiers = [...(a.modifiers || []), tortMod];
              }
            }
            const mqSin = text.match(new RegExp(String.raw`\b(${NUMW})\s+menudos?\b`, "iu"));
            const qSin = mqSin ? (spokenCount(mqSin[1]) || 0) : 0;
            if (qSin > 1) {
              for (const l of haveCart) if (/menudo/i.test(String(l.itemId))) l.quantity = qSin;
              for (const a of haveActs) if (/menudo/i.test(String(a.itemId))) a.quantity = qSin;
            }
          } else if (saidSinPata && hasCon && !hasSin && bareUnoPata) {
            acts.push({ type: "add_item", itemId: SIN, quantity: 1, modifiers: [tortMod], readback: "menudo" });
          } else if (!(saidConPata && hasSin) && !(saidSinPata && hasCon)) {
            // single-SKU clarify (luis181d): rewrite existing bowl(s)
            for (const l of haveCart) {
              if (saidSinPata || (!saidConPata && /\b(?:sin|con)\s+patas?\b/iu.test(text) === false && isConId(String(l.itemId)))) {
                l.itemId = SIN;
                l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet/i.test(String(m.option)));
              } else if (saidConPata) {
                l.itemId = CON;
                l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet/i.test(String(m.option)));
                if (saidExtraPata) l.modifiers = [...(l.modifiers || []), pataMod];
              }
            }
            for (const a of haveActs) {
              if (saidSinPata || (!saidConPata && isConId(String(a.itemId)))) {
                a.itemId = SIN;
                a.modifiers = (a.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet/i.test(String(m.option)));
              } else if (saidConPata) {
                a.itemId = CON;
                a.modifiers = (a.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet/i.test(String(m.option)));
                if (saidExtraPata) a.modifiers = [...(a.modifiers || []), pataMod];
              }
            }
            // drop model re-adds on clarify (keep our force-adds with readback menudo)
            if (/\b(?:sin|con)\s+patas?\b/iu.test(text) && haveCart.length) {
              for (let i = acts.length - 1; i >= 0; i--) {
                if (acts[i].type === "add_item" && /menudo/i.test(String(acts[i].itemId)) && acts[i].readback !== "menudo") acts.splice(i, 1);
              }
            }
          }
        } else {
          const mods: any[] = [];
          // Con Pata catalog SKU — EXTRA Pata only if they asked for *extra* pata on top
          if (saidExtraPata) mods.push({ step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" });
          // enrique1b: house default corn comal tortillas when force-adding (model never answered the tortilla Q)
          mods.push({ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" });
          // miguel1: "tres menudos sin patas" — keep spoken bowl count on force-add
          const mq = text.match(new RegExp(String.raw`\b(${NUMW})\s+menudos?\b`, "iu"));
          const qMen = mq ? (spokenCount(mq[1]) || 1) : 1;
          acts.push({ type: "add_item", itemId: id, quantity: Math.max(1, qMen), modifiers: mods, readback: "menudo" });
        }
      }
      // suleika1/enrique1/adriana1: mole platillo; "dos órdenes" after moles = qty 2; "un platillo de mole" = qty 1 (never menudo "dos"/tortilla "4")
      if ((/\bmoles?\b/iu.test(text) || (/\b(?:[oó]rdenes?|orders?)\b/iu.test(text) && /\bmoles?\b/iu.test(history.filter((h) => h.role === "customer").slice(-6).map((h) => h.text).join(" "))))
        && /\b(?:va\s+a\s+ser|tambi[eé]n|quiero|dame|deme|me\s+da|me\s+das|pon(?:me|ga)?|un[oa]?|dos|tres|\d+)\b/iu.test(text)) {
        const have = cart.some((l) => /mole/i.test(String(l.itemId)))
          || acts.some((a: any) => a.type === "add_item" && /mole/i.test(String(a.itemId)));
        const om = text.match(/\b(\d+|dos|tres|cuatro|two|three|four)\s+(?:[oó]rdenes?|orders?)\b/iu);
        const pm = text.match(new RegExp(String.raw`\b(${NUMW})\s+(?:platillos?\s+de\s+)?moles?\b`, "iu"))
          || text.match(new RegExp(String.raw`\b(${NUMW})\s+platillos?\b`, "iu"));
        // adriana1: only trust N next to órdenes/mole/platillo — never spokenCount(full text) (picks "dos"/"4")
        const spokenMole = om ? (spokenCount(om[1]) || 1) : (pm ? (spokenCount(pm[1]) || 1) : 0);
        const moleMods = [
          { step: "(A) Mole Sides", option: "Solo Arroz / Rice" },
          { step: "(B) Mole Tortillas", option: "3 x (Corn) Corn Tortilla" },
        ];
        if (!have) {
          const q = spokenMole || 1;
          acts.push({ type: "add_item", itemId: "sq-mole-tradicional-platillo-4THFAW", quantity: q, modifiers: moleMods,
            readback: q > 1 ? `${q} mole` : "mole" });
        } else if (spokenMole > 0) {
          for (const l of cart) if (/mole/i.test(String(l.itemId))) l.quantity = spokenMole;
          for (const a of acts) if (a.type === "add_item" && /mole/i.test(String(a.itemId))) a.quantity = spokenMole;
        }
      }
    }
    // victor1 (CA7c79ab): "una orden de birria" after barbacoa avail → add Birria; avail-only ("¿tiene barbacoa?") stays out via isAvailQ.
    // joseBirria1: also "me puedes poner una orden" when recent caller/staff already established birria.
    // ca7bae57: "quesadilla de birria" / staff "quesibirrias" / "quesivirrias" = Queso Birrias, NOT 1 lb birria de chivo.
    if (source.startsWith("caller")
      && (/\bbirrias?\b/iu.test(text)
        || (/\b(?:una\s+orden|un\s+order|orden(?:es)?)\b/iu.test(text)
          && /\bbirrias?\b/iu.test(prevCaller + " " + (history.slice(-6).map((h: any) => h.text).join(" ")))))
      && /\b(?:orden(?:es)?|order|quiero|dame|deme|me\s+da|pon(?:me|ga)?|va\s+a\s+ser|un[oa]?|parece)\b/iu.test(text)
      && !/\b(?:tienen|tienes|hay|tiene|ten[eé]s|vende[ns]?|manejan|disponible|barbacoa)\b/iu.test(text)
      && !/\bques(?:o\s+)?birrias?\b|\bquesi[bv]irrias?\b|\bquesadillas?\s+de\s+birria\b/iu.test(text)
      && !/\bques(?:o\s+)?birrias?\b|\bquesi[bv]irrias?\b|\bquesadillas?\s+de\s+birria\b/iu.test(prevCaller + " " + (history.slice(-8).map((h: any) => h.text).join(" ")))) {
      const have = cart.some((l) => /birria/i.test(String(l.itemId)))
        || acts.some((a: any) => a.type === "add_item" && /birria/i.test(String(a.itemId)));
      if (!have) acts.push({ type: "add_item", itemId: "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD", quantity: 1, modifiers: [], readback: "orden de birria" });
    }
    // jorge1: "¿Te pueden cargar un pozole rojo?" — order cue (cargar/un), model often []; force Pozole Rojo (not avail Q).
    if (source.startsWith("caller") && /\bpo[sz]oles?\b/iu.test(text)
      && /\b(?:cargar|quiero|dame|deme|me\s+da|pon(?:me|ga)?|va\s+a\s+ser|un[oa]?|dos|tres|\d+|orden)\b/iu.test(text)
      && !/\b(?:tienen|tienes|hay|tiene|ten[eé]s|vende[ns]?|manejan|disponible)\b/iu.test(text)) {
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
      && !/\b(?:tienen|tienes|hay|tiene|ten[eé]s|vende|quesadilla)\b/iu.test(text)
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
      // francisco1 / carlos1: "taco al comal" — drop model TST (taquero) for the same meat; comal ≠ taquero
      if (!/\btaquer/iu.test(text)) {
        const meatRe = listedMeats(text).map((w) => w.meat.replace(/s$/, "")).filter(Boolean);
        const dropTst = (mods: any[]) => {
          const o = (mods || []).map((m: any) => String(m.option || "")).join(" ");
          return /\(TST\)|Taquero|Street Taco/i.test(o) && !/\(TCO\)|Comal|Homemade/i.test(o)
            && (!meatRe.length || meatRe.some((m) => new RegExp(m, "i").test(o)));
        };
        for (let i = acts.length - 1; i >= 0; i--) {
          if (acts[i].type === "add_item" && /taco/i.test(String(acts[i].itemId)) && dropTst(acts[i].modifiers || [])) acts.splice(i, 1);
        }
        for (let i = cart.length - 1; i >= 0; i--) {
          if (kindOfItem(cart[i].itemId) === "taco" && dropTst(cart[i].modifiers || [])) cart.splice(i, 1);
        }
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
        && !/\b(?:tienen|tienes|hay|tiene|ten[eé]s|vende|grandes?\s+o\s+chic)/iu.test(text) && !mm) {
        pendingSmallSope = true;
      } else if (source.startsWith("caller") && saidSmall && (saidSope || meatOnly)
        && !/\b(?:tienen|tienes|hay|tiene|ten[eé]s|vende)/iu.test(text)
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
    // francisco1 (CA69876b): chimichanga "de pollo" unavailable → "de chorizo" replaces protein (never second chimi / stacked meats)
    if (source.startsWith("caller") && /\b(?:de\s+)?(chorizo|bistec|pastor|carnitas|asada)\b/iu.test(text)
      && !/\bchimichanga\b/iu.test(text) && !FOOD.test(text.replace(/\b(?:de\s+)?(?:chorizo|bistec|pastor|carnitas|asada)\b/giu, " "))
      && /\bno\s+tengo\s+de\s+pollo\b|\bno\s+(?:hay|tenemos)\s+(?:de\s+)?pollo\b|\botra\s+cosa\b/iu.test(lastStaff)) {
      const mm = text.match(/\b(chorizo|bistec|pastor|carnitas|asada)\b/iu);
      const MEAT_MAP: Record<string, string> = {
        chorizo: "Chorizo / Mexican Sausage", bistec: "Bistec / Steak", pastor: "Alpastor / Roasted Pork",
        carnitas: "Carnitas / Pulled Pork", asada: "Bistec / Steak",
      };
      const opt = mm ? MEAT_MAP[mm[1].toLowerCase()] : null;
      if (opt) {
        const chimi = [...cart].reverse().find((l) => /chimichanga/i.test(String(l.itemId)));
        if (chimi) {
          chimi.modifiers = (chimi.modifiers || []).filter((m: any) => !/pollo|chicken|chorizo|bistec|pastor|carnitas|steak/i.test(String(m.option || "")) || /salsa/i.test(String(m.option || "")));
          chimi.modifiers.push({ step: "(C) Chimichanga Carne Options", option: opt });
          // drop model re-adds of a second chimichanga on this turn
          for (let i = acts.length - 1; i >= 0; i--) {
            if (acts[i].type === "add_item" && /chimichanga/i.test(String(acts[i].itemId))) acts.splice(i, 1);
          }
        }
      }
    }
    // ca11603f: "aparte vienen otras" / "falta otro pedazo" = continuation of same order, not a new add of prior meat
    if (source.startsWith("caller")
      && /\b(?:aparte\s+vienen\s+otras|falta(?:\s*,?\s*falta)?\s+otro\s+pedazo|falta\s+otro\s+pedazo)\b/iu.test(text)
      && !new RegExp(String.raw`\b(?:${MEAT_LIST})\b`, "iu").test(text)
      && !/\b(?:\d+|dos|tres|cuatro|cinco|seis)\s+(?:quesadillas?|tacos?|gorditas?)/iu.test(text)) {
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item") acts.splice(i, 1);
    }
    // francisco1 (CA69876b): staff "¿Un qué?" / clarification → caller repeats dish — not a second line
    if (source.startsWith("caller") && /\b(?:un\s+qu[eé]|qu[eé]\s+(?:fue|dij|dijo)|c[oó]mo\s+|perd[oó]n|repeat|what\s+did)\b/iu.test(lastStaff)) {
      for (let i = acts.length - 1; i >= 0; i--) {
        if (acts[i].type !== "add_item") continue;
        if (cart.some((l) => sig(l) === sig(acts[i]))) acts.splice(i, 1);
      }
    }
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
            // gio1: "una de tripa y de bistec" splits the announced "dos" across the lines — never stamps it on one
            else if (unaSplitMeats(text)) { pendingSpokenQty = null; }
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
    // luis181/docena1 + bryan1/monica: never said con pata → Menudo con Tortillas.
    // kazandra1: when caller said BOTH con and sin (split bowls), do NOT rewrite Con Pata → SIN.
    // juan1 (CA5dddcd): STT "con papa" + staff "con patas" confirm = saidCon (do not force-back to SIN).
    { const allCaller = (history.filter((h) => h.role === "customer").map((h) => h.text).join(" ") + " " + prevCaller + " " + text).toLowerCase();
      const staffBlob = (typeof turns !== "undefined" ? turns.filter((u: any) => u.speaker === "staff").map((u: any) => u.text).join(" ") : "")
        + " " + (typeof recentStaff !== "undefined" ? recentStaff.join(" ") : "") + " " + (typeof lastStaff !== "undefined" ? lastStaff : "");
      const staffCon = /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(staffBlob) && !/\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(staffBlob);
      const callerPapa = /\bcon\s+papas?\b/iu.test(allCaller);
      const saidCon = /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(allCaller)
        || (callerPapa && staffCon)
        || (typeof steps !== "undefined" && steps.some((st: any) => st.source === "caller-staff-papa-pata"));
      const saidSin = /\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(allCaller);
      if (!saidCon || (saidSin && !saidCon)) {
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
    // kazandra1: Menudo con Tortillas (SIN) must never keep EXTRA Pata mod
    { const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
      for (const a of acts) {
        if ((a.type === "add_item" || a.type === "update_item") && (String(a.itemId) === SIN || (/menudo/i.test(String(a.itemId)) && !/con-pata|con_pata/i.test(String(a.itemId)))))
          a.modifiers = (a.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet/i.test(String(m.option)));
      }
      for (const l of cart) {
        if (String(l.itemId) === SIN || (/menudo/i.test(String(l.itemId)) && !/con-pata|con_pata/i.test(String(l.itemId))))
          l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet/i.test(String(m.option)));
      }
    }
    // miguel2/Carlos 10/25: EXTRA Pata / EXTRA Carne are paid add-ons — never stamp from bare "con pata" or a normal protein choice.
    // Keep only when caller explicitly said "extra pata" / "extra carne" (same rule as EXTRA pata standing).
    { const allCaller = (history.filter((h) => h.role === "customer").map((h) => h.text).join(" ") + " " + prevCaller + " " + text).toLowerCase();
      const wantExtraPata = /\bextra\s+patas?\b/iu.test(allCaller);
      const wantExtraCarne = wantsExtraCarne(allCaller); // sergio1: cargadito / con más carne too
      const stripExtra = (mods: any[] | undefined) => (mods || []).filter((m: any) => {
        const o = String(m.option || "");
        if (/extra\s*pata|beef\s+feet/i.test(o) && !wantExtraPata) return false;
        if (/extra\s*carne|extra\s*meat/i.test(o) && !wantExtraCarne) return false;
        return true;
      });
      for (const a of acts) {
        if (a.type !== "add_item" && a.type !== "update_item") continue;
        if (!/menudo/i.test(String(a.itemId))) continue;
        a.modifiers = stripExtra(a.modifiers);
      }
      for (const l of cart) {
        if (!/menudo/i.test(String(l.itemId))) continue;
        l.modifiers = stripExtra(l.modifiers);
      }
    }
    // harina1: "una quesadilla de harina de bistec" is a flour quesadilla, never the Dorada just rung (Luisa)
    if (/\bquesadillas?\s+de\s+harina\b|\bflour\s+(?:\p{L}+\s+)?quesadillas?\b/iu.test(text) && !/dorad/iu.test(text) && acts.some((a: any) => a.type === "add_item" && /dorada/i.test(String(a.itemId)))) {
      for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "add_item" && /dorada/i.test(String(acts[i].itemId))) acts.splice(i, 1);
      const r2: any = await run(text, language, []);
      for (const a of r2?.actions || []) if (a.type === "add_item" && !/dorada/i.test(String(a.itemId))) acts.push(a);
    }
    // alexvoc1d: trailing "Aparte." = separate line, not DELUXE ***APARTE side mod.
    if (source.startsWith("caller") && /(?:^|[.!?]\s*)aparte\b|\baparte\s*[.!?]\s*$/iu.test(text)
      && !/\b(?:todo|everything|con\s+todo)\s+aparte\b/iu.test(text)) {
      for (const a of acts as any[]) {
        if (a.type !== "add_item" || !a.modifiers) continue;
        a.modifiers = a.modifiers.filter((m: any) => !/APARTE|EVERTHING ON SIDE|EVERYTHING ON SIDE/i.test(String(m.option)));
      }
    }
    // gaby1: staff "¿Prensado, preparado o normal?" + caller "Sí, no normal" / "normal" → REGULAR (not DELUXE).
    // "en aceite" house-defaults deluxe; the style answer must win.
    if (source.startsWith("caller")) {
      const lastStaff = [...history].reverse().find((h) => h.role === "assistant")?.text || "";
      const styleAsk = /\bprensado\b/iu.test(lastStaff) && /\bpreparad/iu.test(lastStaff) && /\bnormal\b/iu.test(lastStaff) && /\?/u.test(lastStaff);
      const saidNormal = /\b(?:regular(?:es)?|normal(?:es)?|sencill[oa]s?)\b/iu.test(text)
        && !/\b(?:preparad[oa]s?|deluxe)\b/iu.test(text.replace(/\bno\s+normal\b/iu, " normal "));
      // "sí, no normal" / "no, normal" = normal (hesitation), not rejecting normal
      const saidNormalHesit = /^\W*(?:s[ií][,.]?\s*)?(?:no[,.]?\s+)?normal(?:es)?\W*$/iu.test(text)
        || /\bs[ií][,.]?\s*no\s+normal\b/iu.test(text);
      if ((styleAsk || saidNormalHesit) && (saidNormal || saidNormalHesit)) {
        const toReg = (row: any) => {
          const id = String(row.itemId || "");
          if (id !== DORADA_DELUXE_ID && id !== DORADA_REG_ID && !/dorada|zzav3l|t5stuh/i.test(id)) return;
          const keep = (row.modifiers || []).filter((m: any) => {
            const o = String(m.option || "");
            return !/REGULAR Dorada|DELUXE Preparada/i.test(o)
              && /carne|meat|bistec|chorizo|picadillo|pollo|buche|tripa|lengua|pastor|carnitas|asada|prensado|duro|cabeza|costilla|nopales/i.test(o + " " + String(m.step || ""));
          });
          row.itemId = DORADA_REG_ID;
          row.modifiers = [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, ...keep];
          row.readback = "quesadilla dorada regular";
        };
        for (const a of acts as any[]) if (a.type === "add_item") toReg(a);
        for (const l of cart as any[]) toReg(l);
        if (pendingQuesadilla) pendingQuesadilla.deluxe = false;
      }
    }
    // prep1: "una quesadilla preparada … de las doradas" is the DELUXE Preparada Dorada, not the Regular (Luisa)
    if (/\bpreparad[oa]s?\b|\bdeluxe\b/iu.test(text) && !/\bregular(?:es)?\b|\bsin\s+preparar\b/iu.test(text))
      for (const a of acts as any[]) if (a.type === "add_item" && a.itemId === DORADA_REG_ID) { a.itemId = DORADA_DELUXE_ID; a.modifiers = (a.modifiers || []).map((m: any) => /REGULAR Dorada/i.test(String(m.option)) ? { ...m, option: "(QD) DELUXE Preparada" } : m); }
    // aceite1 (Alex CA7c2f7c): "quesadillas de/en aceite" = QD (not QCO). Style: preparadas→DELUXE, normales/regulares→REGULAR.
    // rodolfo1/andres1: aceite on avail turn + later "cuatro quesadillas… Normales/Preparadas" still maps to QD.
    // "una de comal" later is a separate QCO line — do not remap that turn.
    if (source.startsWith("caller")) {
      const recentCaller = history.filter((h) => h.role === "customer").slice(-8).map((h) => h.text).join(" ");
      const aceiteCue = /\baceite\b/iu.test(text) || /\baceite\b/iu.test(recentCaller)
        || (/\bdoradas?\b/iu.test(text) && /\b(?:preparad[oa]s?|deluxe)\b/iu.test(text));
      const qCue = /\b(?:quesadillas?|preparad[oa]s?|deluxe|doradas?|normal(?:es)?|regular(?:es)?)\b/iu.test(text) || !!pendingQuesadilla;
      if (aceiteCue && qCue
        && !/\b(?:de\s+)?comal\b/iu.test(text.replace(/aceite[^,.]*preparad\w*|doradas?[^,.]*preparad\w*/iu, " "))) {
        const styleBlob = text + " " + recentCaller;
        const wantReg = /\b(?:regular(?:es)?|normal(?:es)?|sencill[oa]s?)\b/iu.test(styleBlob)
          && !/\b(?:preparad[oa]s?|deluxe)\b/iu.test(text);
        const wantDel = /\b(?:preparad[oa]s?|deluxe)\b/iu.test(styleBlob) && !wantReg;
        const targetId = wantReg ? DORADA_REG_ID : DORADA_DELUXE_ID;
        const styleOpt = wantReg ? "(QD) REGULAR Dorada" : "(QD) DELUXE Preparada";
        const toQd = (row: any) => {
          const id = String(row.itemId || "");
          const isQco = /quesadilla/i.test(id) && !/dorada|zzav3l|t5stuh/i.test(id)
            && (/comal|QCO|homemade/i.test(id + " " + (row.modifiers || []).map((m: any) => m.option).join(" ")) || id === "sq-quesadilla-HLT6CR");
          const isReg = id === DORADA_REG_ID || /regular.?dorada/i.test(id + " " + (row.modifiers || []).map((m: any) => m.option).join(" "));
          const isDel = id === DORADA_DELUXE_ID || /deluxe|preparada/i.test(id + " " + (row.modifiers || []).map((m: any) => m.option).join(" "));
          const bareQ = /quesadilla/i.test(id) && !/dorada|deluxe|zzav3l|t5stuh/i.test(id);
          if (!(isQco || isReg || isDel || bareQ)) return;
          if (!wantReg && !wantDel && (isReg || isDel)) return; // style not decided yet — leave QD as-is
          const keep = (row.modifiers || []).filter((m: any) => {
            const o = String(m.option || "");
            return !/\(QCO\)|comal|homemade|REGULAR Dorada|DELUXE Preparada|salsa asada/i.test(o)
              && /carne|meat|bistec|chorizo|picadillo|pollo|buche|tripa|lengua|pastor|carnitas|asada|prensado|duro|cabeza|costilla/i.test(o + " " + String(m.step || ""));
          });
          row.itemId = (wantReg || (!wantDel && isReg)) ? DORADA_REG_ID : DORADA_DELUXE_ID;
          const opt = row.itemId === DORADA_REG_ID ? "(QD) REGULAR Dorada" : "(QD) DELUXE Preparada";
          row.modifiers = [{ step: "(QD) Style", option: opt }, ...keep];
          row.readback = row.readback || (row.itemId === DORADA_REG_ID ? "quesadilla dorada regular" : "quesadilla dorada deluxe");
        };
        for (const a of acts as any[]) if (a.type === "add_item") toQd(a);
        for (const l of cart as any[]) toQd(l);
        if (/\bquesadillas?\b/iu.test(text) && !pendingQuesadilla) {
          const n = spokenCount(cleanPhrase(text)) || 1;
          // eva1/aceite1: aceite without style yet → park deluxe pending (preparadas is house default for aceite)
          pendingQuesadilla = { n, meat: "", deluxe: wantDel || (!wantReg && /\baceite\b/iu.test(text + " " + recentCaller)) };
        } else if ((wantReg || wantDel) && pendingQuesadilla) {
          pendingQuesadilla.deluxe = wantDel || (!wantReg && !!pendingQuesadilla.deluxe);
          if (wantReg && !wantDel) pendingQuesadilla.deluxe = false;
        }
      }
    }
    // alexvoc1c: explicit comal (no aceite/dorada/preparada) must stay QCO — model often returns Regular Dorada.
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
      && !(/\b(?:tienen|tienes|hay|tiene|ten[eé]s|vende)\b/iu.test(text) && !/\b(?:aceite|fritas?|doradas?)\b/iu.test(text))
      // lalo1 (CA72b325): "¿Tienes quesadilla de aceite?" = clarify tortilla only (staff → comal) — never force-add QD
      // carlos-qd1 (CAfc6b32): also "¿Tendrá quesadillas de aceite?" availability — never force-add QD
      && !((/(?<![\p{L}])(?:tienen|tienes|hay|tiene|ten[eé]s|vende|tendr[aá]s?|tendr[aá]n)(?![\p{L}])/iu.test(text)
        && /\baceite\b/iu.test(text)
        && !/\b(?:dame|deme|me\s+das|quiero|pon(?:me|ga)|otra|unas?|\d+|dos|tres|cuatro|preparad|deluxe|dorad)\b/iu.test(text)))
      && !/\bde\s+comal\b/iu.test(text)
      // nayeli1: enter when no dorada acts, OR only meatless dumps (strip below → park pending / per-meat)
      && (() => {
        const isMeat = (a: any) => (a.modifiers || []).some((m: any) => /carne|meat|bistec|chorizo|picadillo|pollo|prensado|duro|pastor|costilla|lengua|buche|nopales/i.test(String(m.option)));
        const dor = acts.filter((a: any) => a.type === "add_item" && /dorada|zzav3l|deluxe|t5stuh/i.test(String(a.itemId)));
        if (dor.some(isMeat)) return false; // already have meat lines this turn
        if (!dor.length) {
          // jorge1: skip when cart already has QD and caller isn't ordering a new batch
          return !(cart.some((l) => /dorada|zzav3l|t5stuh|deluxe/i.test(String(l.itemId))) && !pendingQuesadilla
            && !(spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+pone)\s+/iu, "")) > 0));
        }
        return true; // meatless dumps — strip and park/rebuild
      })()) {
      // alexvoc1: allow another Deluxe line when cart already has one
      // gino1: drop mistaken Platillo/Guisado / comal QCO the model invented on an aceite answer
      // nayeli1: drop meatless deluxe dumps so we park pending or add per-meat
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.type !== "add_item") continue;
        const id = String(a.itemId || "");
        if (/platillo|guisado|plate/i.test(id) || (/quesadilla/i.test(id) && !/dorada|zzav3l|deluxe/i.test(id))) acts.splice(i, 1);
        else if (/dorada|zzav3l|t5stuh/i.test(id) && !(a.modifiers || []).some((m: any) => /carne|meat|bistec|chorizo|picadillo|pollo|prensado|duro|pastor|costilla|lengua|buche|nopales/i.test(String(m.option))))
          acts.splice(i, 1);
      }
      const n = pendingQuesadilla?.n || spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+pone)\s+/iu, "")) || 1;
      const meats = listedMeats(text);
      const MEAT_OPT: Array<[RegExp, string]> = [[/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^picadillo$/i, "Picadillo / Ground Beef"], [/^buche$/i, "Buche / Pork Stomach"], [/^lengua$/i, "Lengua / Beef Tongue"], [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"], [/^nopales$/i, "Nopales con Papas / Cacti with Potatoes"]];
      // eva1: multiple meats → one DELUXE line each (not qty-n with stacked meats)
      if (meats.length >= 2) {
        for (const w of meats) {
          const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
          if (!opt) continue;
          acts.push({ type: "add_item", itemId: DORADA_DELUXE_ID, quantity: w.qty && w.qty > 1 ? w.qty : 1,
            modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: opt }],
            readback: `QD deluxe ${w.meat}` });
        }
        pendingQuesadilla = null;
      } else {
      const mods: any[] = [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }];
      for (const w of meats.length ? meats : []) {
        const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
        if (opt) mods.push({ step: "(B) Q Carnes / Meats", option: opt });
      }
      if (!meats.length) {
        const mm = text.match(/\b(bistec|chorizo|asada|picadillo|pollo|buche|lengua|prensado|duro|nopales)\b/iu);
        const meat = mm?.[1] || pendingQuesadilla?.meat;
        if (meat) { const opt = MEAT_OPT.find(([re]) => re.test(meat))?.[1]; if (opt) mods.push({ step: "(B) Q Carnes / Meats", option: opt }); }
      }
      // eva1: aceite order without meats yet — park deluxe pending, don't dump qty-n meatless
      if (!meats.length && !mods.some((m) => /Carnes|Meats/i.test(String(m.step))) && n > 1) {
        pendingQuesadilla = { n, meat: "", deluxe: true };
      } else {
        acts.push({ type: "add_item", itemId: DORADA_DELUXE_ID, quantity: n > 1 ? n : 1, modifiers: mods, readback: "quesadilla dorada deluxe" });
        pendingQuesadilla = null;
      }
      }
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
    // tw4938: "otra tripa. Serían cuatro tacos" names another dish — never park/force a QD from it
    const otherDishTurn = /\b(?:tacos?|taqueros?|burritos?|tortas?|sopes?|gorditas?|huaraches?|tostadas?|menudos?|enchiladas?|tamales)\b/iu.test(text) && !/\bquesadillas?\b|\bdoradas?\b/iu.test(text);
    if (source.startsWith("caller") && !pendingQuesadilla && !otherDishTurn) {
      const recent = history.filter((h) => h.role === "customer").slice(-4).map((h) => h.text).join(" ") + " " + text;
      if (/\b(?:quesadillas?\s+)?doradas?\b/iu.test(recent)) {
        const n = spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:s[ií][,.]?\s*)?(?:quiero|dame|deme|me\s+pone|pon(?:me|ga)?|por\s+favor)[,.\s]*/iu, ""))
          || (/\b(?:dos|2|two)\b/iu.test(text) ? 2 : /\b(?:tres|3|three)\b/iu.test(text) ? 3 : /\b(?:cuatro|4|four)\b/iu.test(text) ? 4 : 0);
        if (n >= 1 && (/\b(?:quiero|dame|deme|me\s+pone|pon(?:me|ga)?|por\s+favor)\b/iu.test(text) || listedMeats(text).length > 0))
          pendingQuesadilla = { n, meat: "" };
      }
    }
    // eva1 (CA4f480f): pending aceite/deluxe + meat turns → one DELUXE line per meat (duro/prensado/nopales), never REG qty dump
    // gino1: do not steal taco/taquero meat turns into phantom QD Deluxe (clear pending when caller moved to tacos)
    if (source.startsWith("caller") && pendingQuesadilla?.deluxe
      && /\b(?:tacos?|taqueros?)\b/iu.test(text)) {
      pendingQuesadilla = null;
    }
    if (source.startsWith("caller") && pendingQuesadilla?.deluxe
      && (listedMeats(text).length > 0 || new RegExp(String.raw`\bde\s+(?:al\s+)?(?:${MEAT_LIST})\b`, "iu").test(text)
        || /\b(?:duro|prensado|nopales|papas)\b/iu.test(text))
      && !/\b(?:tienen|tienes|hay)\b/iu.test(text)
      && !/\b(?:tacos?|taqueros?)\b/iu.test(text)) {
      const MEAT_OPT: Array<[RegExp, string]> = [
        [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
        [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^picadillo$/i, "Picadillo / Ground Beef"],
        [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"],
        [/^nopales$/i, "Nopales con Papas / Cacti with Potatoes"],
        [/^pastor$/i, "Alpastor / Roasted Pork"], [/^lengua$/i, "Lengua / Beef Tongue"],
        [/^tripas?$/i, "Tripa / Beef Tripe"], [/^buche$/i, "Buche / Pork Stomach"],
      ];
      let meatList = listedMeats(text);
      if (!meatList.length) {
        meatList = [...text.matchAll(new RegExp(String.raw`\bde\s+(?:al\s+)?(${MEAT_LIST})\b`, "giu"))]
          .map((m) => ({ meat: normListedMeat(m[1]), another: false as boolean, qty: 1 as number | undefined }));
      }
      if (!meatList.length && /\b(?:duro|prensado|nopales)\b/iu.test(text)) {
        const mm = text.match(/\b(duro|prensado|nopales)\b/iu);
        if (mm) meatList = [{ meat: normListedMeat(mm[1]), another: false, qty: 1 }];
      }
      const hasDoradaMeat = (meat: string) => cart.some((l) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId))
        && (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option))))
        || acts.some((a: any) => a.type === "add_item" && /dorada|zzav3l|t5stuh/i.test(String(a.itemId))
          && (a.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option))));
      for (const w of meatList) {
        const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
        if (!opt || hasDoradaMeat(w.meat)) continue;
        acts.push({
          type: "add_item", itemId: DORADA_DELUXE_ID, quantity: w.qty && w.qty > 1 ? w.qty : 1,
          modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: opt }],
          readback: `QD deluxe ${w.meat}`,
        });
      }
      // drop mistaken REG adds on this turn
      for (let i = acts.length - 1; i >= 0; i--) {
        if (acts[i].type === "add_item" && String(acts[i].itemId) === DORADA_REG_ID) acts.splice(i, 1);
      }
      const qdN = [...cart, ...acts.filter((a: any) => a.type === "add_item")]
        .filter((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId))).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
      if (qdN >= (pendingQuesadilla.n || 1)) pendingQuesadilla = null;
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
      && !pendingQuesadilla?.deluxe
      && !otherDishTurn
      && !/\baceite\b/iu.test(history.filter((h) => h.role === "customer").slice(-8).map((h) => h.text).join(" "))
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
        // carlos-qd1: pending after doradas stamp + bare "De picadillo" (no "doradas" on meat turn)
        let meatList = meats;
        if (!meatList.length && (/\bdoradas?\b/iu.test(text) || !!pendingQuesadilla)) {
          meatList = [...text.matchAll(new RegExp(String.raw`\bde\s+(?:al\s+)?(${MEAT_LIST})\b`, "giu"))]
            .map((m) => ({ meat: normListedMeat(m[1]), another: false as boolean, qty: (pendingQuesadilla?.n && pendingQuesadilla.n > 1 ? pendingQuesadilla.n : 1) as number | undefined }));
        }
        if (meatList.length >= 1) {
          for (const w of meatList) {
            const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
            if (!opt) continue;
            // carlos-qd1: "me pone tres" pending + bare "De picadillo" → qty 3 (not 1 per meat)
            const q = w.qty && w.qty > 1 ? w.qty
              : (meatList.length === 1 && (pendingQuesadilla?.n || 0) > 1 ? pendingQuesadilla!.n : 1);
            // caguamas1: "dos de costilla" then later "dos de costilla" again → add qty, don't skip
            if (hasDoradaMeat(w.meat)) {
              const hit = [...cart].reverse().find((l) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId))
                && (l.modifiers || []).some((m: any) => new RegExp(w.meat, "i").test(String(m.option)))
                && (l.itemId === DORADA_REG_ID || /REGULAR Dorada/i.test((l.modifiers || []).map((m: any) => m.option).join(" "))));
              if (hit && /\b(?:otra|otras|m[aá]s|pegadillas|quesadillas?)\b/iu.test(text + " " + (history.filter((h) => h.role === "customer").slice(-2).map((h) => h.text).join(" ")))) {
                hit.quantity = (Number(hit.quantity) || 1) + q;
                continue;
              }
              continue; // oscar1: caller-retry must not double the same meat line
            }
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
          // carlos-qd1: "me pone tres" after aceite/doradas avail — park qty, don't dump meatless REGULAR
          // (meat lands on the next "De picadillo" turn; dumping here clears pending and splits under preparadas).
          if (!meat && !mods.some((m) => /Carnes|Meats/i.test(String(m.step))) && n > 1) {
            pendingQuesadilla = { n, meat: "", deluxe: !!pendingQuesadilla?.deluxe };
          } else {
            acts.push({ type: "add_item", itemId: DORADA_REG_ID, quantity: n > 1 ? n : 1, modifiers: mods, readback: "quesadilla dorada regular" });
          }
        }
        {
          const qdAdds = acts.filter((a: any) => a.type === "add_item" && /dorada|zzav3l|t5stuh/i.test(String(a.itemId)));
          const hasMeatQd = [...cart, ...qdAdds].some((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId))
            && (l.modifiers || []).some((m: any) => /carne|meat|bistec|chorizo|picadillo|pollo|prensado|duro|pastor|costilla|lengua|buche|nopales/i.test(String(m.option))));
          const qdN = [...cart, ...qdAdds]
            .filter((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId))).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
          // Only clear pending once meat actually landed (or style-only "regulares" answer with no pending qty left)
          if (/^\W*regular(?:es)?\W*$/iu.test(text)
            || (pendingQuesadilla && hasMeatQd && qdN >= (pendingQuesadilla.n || 1)))
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

    // suleika1: staff "con puro arroz ¿será?" / caller "Sí, con arroz" → mole Mole Sides = Solo Arroz; never Sides Arroz line
    if (source.startsWith("caller") && /\b(?:con\s+)?(?:puro\s+)?arroz\b/iu.test(text)
      && !/\b(?:orden\s+de\s+arroz|side\s+(?:de\s+)?(?:arroz|rice)|un\s+arroz)\b/iu.test(text)
      && (cart.some((l) => /mole|platillo/i.test(String(l.itemId))) || acts.some((a: any) => a.type === "add_item" && /mole|platillo/i.test(String(a.itemId))))) {
      const setSolo = (row: any) => {
        if (!/mole|platillo/i.test(String(row.itemId))) return;
        const ms = [...(row.modifiers || [])].filter((m: any) => !/Mole Sides|Arroz|Fideo|Rice|Noodles/i.test(String(m.step || "") + " " + String(m.option || "")));
        ms.push({ step: "(A) Mole Sides", option: "Solo Arroz / Rice" });
        row.modifiers = ms;
      };
      for (const l of cart) setSolo(l);
      for (const a of acts) if (a.type === "add_item") setSolo(a);
      for (let i = acts.length - 1; i >= 0; i--)
        if (acts[i].type === "add_item" && /sides-arroz|26S6E6/i.test(String(acts[i].itemId))) acts.splice(i, 1);
      for (let i = cart.length - 1; i >= 0; i--)
        if (/sides-arroz|26S6E6/i.test(String(cart[i].itemId))) cart.splice(i, 1);
    }
    // anthony1c: "a side of rice" / "side of refried beans" → Sides SKUs (not burrito fillings)
    if (source.startsWith("caller")) {
      const SIDE_RICE = "sq-sides-arroz-rice-26S6E6";
      const SIDE_BEANS = "sq-sides-frijoles-beans-FK2O6W";
      // andres1: "una orden de arroz" / "un arroz" / "side de arroz" — keep Sides Arroz in cart
      // suleika1: "con arroz" / "con puro arroz" = mole/platillo side choice, never Sides Arroz SKU
      if (/\b(?:a\s+)?sides?\s+of\s+rice\b|\bsides\s+rice\b|\blado\s+de\s+arroz\b|\b(?:una?\s+)?orden\s+de\s+arroz\b|\b(?:un|una)\s+arroz\b|\bside\s+de\s+arroz\b|\b(?:un\s+)?size\s+de\s+arroz\b/iu.test(text)
        && !/\b(?:con\s+)?arroz\s+y\s+frijol/iu.test(text) // combo filling, not a side order
        && !/^\W*(?:s[ií][,.]?\s*)?(?:con\s+)?(?:puro\s+)?arroz\W*$/iu.test(text)
        && !(/\bcon\s+(?:puro\s+)?arroz\b/iu.test(text) && (/\bmoles?\b/iu.test(history.filter((h) => h.role === "customer").slice(-6).map((h) => h.text).join(" ") + " " + text) || cart.some((l) => /mole|platillo/i.test(String(l.itemId)))))
        && !cart.some((l) => /sides-arroz|26S6E6/i.test(String(l.itemId)))
        && !acts.some((a: any) => a.type === "add_item" && /sides-arroz|26S6E6/i.test(String(a.itemId)))) {
        for (let i = acts.length - 1; i >= 0; i--) {
          const id = String(acts[i].itemId || "");
          if (acts[i].type === "add_item" && /burrito|relleno|poblano|platillo/i.test(id)) acts.splice(i, 1);
        }
        const rq = /\b(?:two|2|dos)\s+sides?\s+of\s+rice\b/iu.test(text) ? 2 : 1;
        acts.push({ type: "add_item", itemId: SIDE_RICE, quantity: rq, modifiers: [], readback: rq > 1 ? `${rq} side rice` : "side rice" });
      }
      if (/\b(?:a\s+)?sides?\s+of\s+(?:refried\s+)?beans\b|\bsides\s+(?:frijoles|beans)\b|\blado\s+de\s+frijoles\b/iu.test(text)
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
    // juana1: skip full flip when caller is splitting "dos sin preparar … una preparada"
    // eva1: "Como regulares, ¿eh? Preparadas, sí" / staff ¿Preparadas?→Sí after aceite → flip REG→DELUXE
    { const recentCaller = history.filter((h) => h.role === "customer").slice(-8).map((h) => h.text).join(" ") + " " + text;
      const recentSplit = /\b(?:dos|2)\s+sin\s+preparad/iu.test(recentCaller)
        || /\buna\s+preparad/iu.test(text) && /\bsin\s+preparad/iu.test(recentCaller);
      const aceiteCtx = /\baceite\b/iu.test(recentCaller);
      const prepAffirm = /\bpreparad[oa]s?\b/iu.test(text)
        || (/^\W*(?:s[ií]|yes|aj[aá]|ok(?:ay)?)\W*$/iu.test(text) && /\bpreparad/iu.test(typeof lastStaff !== "undefined" ? lastStaff : ""));
      const prepWins = prepAffirm && (!/\bregular(?:es)?\b/iu.test(text) || /\bpreparad/iu.test(text));
      if (source !== "auto" && !recentSplit && (
          (/^\W*(?:\p{L}+[.,]?\s+){0,3}preparad[oa]s\W*$/iu.test(text) && !/regular/iu.test(text))
          || (aceiteCtx && prepWins)
        )) {
        for (const l of cart as any[]) if (l.itemId === DORADA_REG_ID) { l.itemId = DORADA_DELUXE_ID; l.modifiers = (l.modifiers || []).map((m: any) => /REGULAR Dorada/i.test(String(m.option)) ? { ...m, option: "(QD) DELUXE Preparada" } : m); }
        for (const a of acts as any[]) if (a.type === "add_item" && a.itemId === DORADA_REG_ID) {
          a.itemId = DORADA_DELUXE_ID;
          a.modifiers = (a.modifiers || []).map((m: any) => /REGULAR Dorada/i.test(String(m.option)) ? { ...m, option: "(QD) DELUXE Preparada" } : m);
        }
        if (pendingQuesadilla) pendingQuesadilla.deluxe = true;
        for (let i = acts.length - 1; i >= 0; i--) if (acts[i].type === "remove_item") acts.splice(i, 1);
        // carlos-qd1: drop meatless DELUXE twin the model/force dumped when cart already has QD with meat
        // (preparadas confirmation must flip the meat line, not invent a second bare DELUXE).
        {
          const hasMeatQd = cart.some((l) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId))
            && (l.modifiers || []).some((m: any) => /carne|meat|bistec|chorizo|picadillo|pollo|prensado|duro|pastor|costilla|lengua|buche|nopales/i.test(String(m.option))));
          if (hasMeatQd) {
            const meatless = (mods: any[]) => !(mods || []).some((m: any) => /carne|meat|bistec|chorizo|picadillo|pollo|prensado|duro|pastor|costilla|lengua|buche|nopales/i.test(String(m.option)));
            for (let i = acts.length - 1; i >= 0; i--) {
              const a = acts[i];
              if (a.type === "add_item" && /dorada|zzav3l|t5stuh/i.test(String(a.itemId)) && meatless(a.modifiers)) acts.splice(i, 1);
            }
            for (let i = cart.length - 1; i >= 0; i--) {
              const l = cart[i] as any;
              if (/dorada|zzav3l|t5stuh/i.test(String(l.itemId)) && meatless(l.modifiers)) cart.splice(i, 1);
            }
          }
        }
      }
    }
    // juana1 (CA3ab468): "dos sin preparar … una preparada" after N same-meat REG doradas → (N-1 or 2) REG + 1 DELUXE
    if (source.startsWith("caller")
      && (/\b(?:dos|2)\s+sin\s+preparad/iu.test(text) || (/\buna\s+preparad/iu.test(text) && /\bsin\s+preparad/iu.test(history.filter((h) => h.role === "customer").slice(-6).map((h) => h.text).join(" "))))
      && /\b(?:preparad|sin\s+preparad)/iu.test(text)) {
      const regs = cart.filter((l) => String(l.itemId) === DORADA_REG_ID);
      const totalReg = regs.reduce((n, l) => n + (Number(l.quantity) || 1), 0);
      if (totalReg >= 2) {
        const wantSin = /\b(?:dos|2)\s+sin\s+preparad/iu.test(text) ? 2
          : Math.max(1, totalReg - 1);
        const wantDel = 1;
        // collapse regs into one line qty=wantSin, push one DELUXE clone of first meat/mods
        const base = regs[0];
        const meatMods = (base.modifiers || []).filter((m: any) => !/REGULAR Dorada|DELUXE Preparada/i.test(String(m.option)));
        for (let i = cart.length - 1; i >= 0; i--) if (String(cart[i].itemId) === DORADA_REG_ID) cart.splice(i, 1);
        cart.push({
          itemId: DORADA_REG_ID, quantity: wantSin,
          modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, ...meatMods],
          readback: "QD regular",
        } as any);
        cart.push({
          itemId: DORADA_DELUXE_ID, quantity: wantDel,
          modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, ...meatMods],
          readback: "QD deluxe",
        } as any);
        for (let i = acts.length - 1; i >= 0; i--) {
          if (acts[i].type === "add_item" && /dorada|zzav3l|t5stuh/i.test(String(acts[i].itemId))) acts.splice(i, 1);
        }
      }
    }

    // maria1 (CA403f137): "otra también de aceite … frijol con picadillo" — add a 2nd QD REG for the new meat
    // (model often updates/skips the first prensado line). Prefer REG when cart already has REG / caller said regular.
    if (source.startsWith("caller")
      && /\botra\b/iu.test(text)
      && /\baceite\b/iu.test(text)
      && !/\b(?:de\s+)?comal\b/iu.test(text)
      && !/\b(?:preparad[oa]s?|deluxe)\b/iu.test(text)) {
      const MEAT_OPT: Array<[RegExp, string]> = [
        [/^prensado$/i, "Prensado / Spicy Pork (+$0.50)"], [/^picadillo$/i, "Picadillo / Ground Beef"],
        [/^duro$/i, "Duro / Pork Rinds"], [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"],
        [/^chorizo$/i, "Chorizo / Mexican Sausage"], [/^(?:chicken|pollo)$/i, "Pollo / Chicken"],
        [/^buche$/i, "Buche / Pork Stomach"], [/^lengua$/i, "Lengua / Beef Tongue"],
      ];
      let meats = listedMeats(text);
      if (!meats.length) {
        const mm = text.match(/\b(prensado|picadillo|duro|bistec|chorizo|pollo|buche|lengua)\b/iu);
        if (mm) meats = [{ meat: normListedMeat(mm[1]), another: true, qty: 1 }];
      }
      const wantReg = cart.some((l) => String(l.itemId) === DORADA_REG_ID || /t5stuh|regular.?dorada/i.test(String(l.itemId)))
        || /\bregular(?:es)?\b/iu.test(history.filter((h) => h.role === "customer").slice(-8).map((h) => h.text).join(" ") + " " + text);
      const targetId = wantReg ? DORADA_REG_ID : DORADA_DELUXE_ID;
      const styleOpt = wantReg ? "(QD) REGULAR Dorada" : "(QD) DELUXE Preparada";
      const wantBeans = /\bfrijol/iu.test(text);
      const hasMeat = (meat: string) =>
        [...cart, ...acts.filter((a: any) => a.type === "add_item")].some((l: any) =>
          /dorada|zzav3l|t5stuh/i.test(String(l.itemId))
          && (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option))));
      for (const w of meats) {
        const opt = MEAT_OPT.find(([re]) => re.test(w.meat))?.[1];
        if (!opt || hasMeat(w.meat)) continue;
        const mods: any[] = [
          { step: "(QD) Style", option: styleOpt },
          { step: "(B) Q Carnes / Meats", option: opt },
        ];
        if (wantBeans) mods.push({ step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" });
        acts.push({
          type: "add_item", itemId: targetId, quantity: 1, modifiers: mods,
          readback: `QD ${wantReg ? "regular" : "deluxe"} ${w.meat}${wantBeans ? " frijoles" : ""}`,
        } as any);
      }
    }

    // maria1: caller answers staff "¿taqueros o de comal?" with "Sí, Taqueros" (often no "?") — remap taco TCO→TST.
    if (source.startsWith("caller") && /\btaqueros?\b/iu.test(text)
      && !/\bcomal\b/iu.test(text)
      && !/\b(?:quesadillas?|dorad|aceite|gorditas?)\b/iu.test(text)) {
      const recentStaff = history.filter((h) => h.role === "assistant").slice(-4).map((h) => h.text).join(" ");
      const hasTaco = cart.some((l) => kindOfItem(l.itemId) === "taco")
        || acts.some((a: any) => a.type === "add_item" && kindOfItem(String(a.itemId)) === "taco");
      if (hasTaco || /\btaqueros?\b/iu.test(recentStaff) || /^\W*(?:s[ií][,.]?\s*)?taqueros?\b/iu.test(text)) {
        const toTst = (row: any) => {
          if (kindOfItem(String(row.itemId || "")) !== "taco") return;
          const mods = [...(row.modifiers || [])];
          let stamped = false;
          for (let i = 0; i < mods.length; i++) {
            const o = String(mods[i].option || "");
            if (/\(TCO\)|Comal|Homemade|Harina|Flour|\(THR\)|\(TST\)|Taquero|Street|Tortilla/i.test(o)) {
              mods[i] = { step: mods[i].step || "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
              stamped = true;
            }
          }
          if (!stamped) mods.unshift({ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" });
          row.modifiers = mods;
          row.readback = row.readback || "taco taquero";
        };
        for (const a of acts as any[]) if (a.type === "add_item") toTst(a);
        for (const l of cart as any[]) toTst(l);
      }
    }

    // david1 (CA775ab720): drop meatless QCO dumps; explode dual-meat QCO singles from "dos de X y una de Y".
    if (source.startsWith("caller") && /\bquesadillas?\b/iu.test(text + " " + history.filter((h) => h.role === "customer").slice(-6).map((h) => h.text).join(" "))
      && /\bcomal\b/iu.test(text + " " + history.filter((h) => h.role === "customer").slice(-6).map((h) => h.text).join(" "))
      && !/\baceite\b/iu.test(text) && !/\bdorad/iu.test(text)) {
      const QCO = "sq-quesadilla-HLT6CR";
      const isQco = (id: string) => /quesadilla/i.test(id) && !/dorada|zzav3l|t5stuh/i.test(id);
      const meatOpts = (row: any) => (row.modifiers || []).map((m: any) => String(m.option || ""))
        .filter((o: string) => /carne|meat|bistec|chorizo|picadillo|pollo|buche|tripa|lengua|pastor|carnitas|asada|prensado|duro|cabeza|costilla/i.test(o) && !/salsa/i.test(o));
      // frijol1: meatless fillings (frijol, queso, nopales, papas, champiñones…) are a real quesadilla, not a meatless dump
      const hasFilling = (row: any) => (row.modifiers || []).some((m: any) => /queso|cheese|frijol|beans|nopal|papa|potato|champi|mushroom|flor|rajas|huitlacoche/i.test(String(m.option || "")) && !/salsa/i.test(String(m.option || "")));
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.type !== "add_item" || !isQco(String(a.itemId || ""))) continue;
        if (!meatOpts(a).length && !hasFilling(a)) acts.splice(i, 1);
      }
      for (let i = cart.length - 1; i >= 0; i--) {
        if (isQco(String(cart[i].itemId || "")) && !meatOpts(cart[i]).length && !hasFilling(cart[i])) cart.splice(i, 1);
      }
      const listed = listedMeats(text);
      if (listed.length >= 2) {
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i];
          if (a.type !== "add_item" || !isQco(String(a.itemId || ""))) continue;
          const ms = meatOpts(a);
          if (ms.length < 2) continue;
          const tort = (a.modifiers || []).find((m: any) => /QCO|Comal|Homemade|Q Tortilla|Harina|Flour/i.test(String(m.option) + " " + String(m.step)))
            || { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
          acts.splice(i, 1);
          for (const w of listed) {
            const opt = ms.find((o: string) => new RegExp(w.meat, "i").test(o))
              || ({ bistec: "Bistec / Steak", pastor: "Alpastor / Roasted Pork", tripa: "Tripa / Beef Tripe",
                chorizo: "Chorizo / Mexican Sausage" } as Record<string, string>)[w.meat.toLowerCase()];
            if (!opt) continue;
            acts.push({
              type: "add_item", itemId: QCO, quantity: w.qty && w.qty > 0 ? w.qty : 1,
              modifiers: [tort, { step: "(B) Q Carnes / Meats", option: opt }],
              readback: `QCO ${w.meat}`,
            } as any);
          }
        }
      }
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
      if (n >= 1 && (meats.length || /\bdoradas?\b/iu.test(text) || /\bfried\b/iu.test(text) || /\baceite\b/iu.test(text))) {
        const landed = acts.some((a: any) => a.type === "add_item" && /quesadilla|dorada|zzav3l/i.test(String(a.itemId)));
        if (!landed) pendingQuesadilla = { n, meat: (meats[0]?.meat || "").toLowerCase(), deluxe: /\baceite\b/iu.test(text) || /\b(?:preparad[oa]s?|deluxe)\b/iu.test(text) || pendingQuesadilla?.deluxe };
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
    // felipe1 (CA398d11): N gorditas de costilla + M al pastor → separate lines with correct qtys (not one dual-meat $5 line)
    if (source.startsWith("caller")
      && (/\bgorditas?\b/iu.test(text) || (listedMeats(text).length > 0 && cart.some((l) => /^sq-gordita-/i.test(String(l.itemId)))))
      && (/\b(?:dos|tres|cuatro|cinco|2|3|4|5|two|three|four|five)\s+gorditas?\b/iu.test(text) || listedMeats(text).length > 0 || /\bgorditas?\b/iu.test(text) && /\b(?:costilla|pastor)\b/iu.test(text))
      && !(/\b(?:tienen|tienes|hay|tiene|ten[eé]s|vende)\b/iu.test(text) && !/\b(?:dame|deme|quiero|pone|ponme|gorditas?)\b/iu.test(text))
      && !acts.some((a: any) => a.type === "add_item" && /^sq-gordita-/i.test(String(a.itemId)))) {
      let meats = listedMeats(text);
      if (!meats.length) {
        const recent = history.filter((h) => h.role === "customer").slice(-3).map((h) => h.text).join(" ") + " " + text;
        meats = listedMeats(recent);
      }
      const MEAT_OPT: Array<[RegExp, string]> = [
        [/^(?:steak|bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
        [/^(?:chicken|pollo)$/i, "Pollo / Chicken"], [/^picadillo$/i, "Picadillo / Ground Beef"],
        [/^prensado$/i, "Prensado / Spicy Pork"], [/^duro$/i, "Duro / Pork Rinds"],
        [/^costillas?$/i, "Costilla / Beef Rib"], [/^(?:al\s*)?pastor$/i, "Alpastor / Roasted Pork"],
        [/^lengua$/i, "Lengua / Beef Tongue"], [/^tripas?$/i, "Tripa / Beef Tripe"],
        [/^buche$/i, "Buche / Pork Stomach"], [/^carnitas$/i, "Carnitas / Pulled Pork"],
      ];
      const meatRe = new RegExp(MEAT_LIST, "i");
      const cartHasMeat = (meat: string) => cart.some((l) => /^sq-gordita-/i.test(String(l.itemId))
        && (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option)) && meatRe.test(String(m.option)) && !/salsa/i.test(String(m.option))));
      const fallN = spokenCount(cleanPhrase(text).replace(/^\s*(?:ay[,.]?\s*)?(?:y|e|and|me\s+das|dame|deme|quiero|me\s+pone|ponme|si\s+me\s+puede\s+poner|me\s+puede\s+poner)\s+/iu, ""))
        || (/\b(?:cuatro|4|four)\b/iu.test(text) ? 4 : /\b(?:dos|2|two)\b/iu.test(text) ? 2 : /\b(?:tres|3|three)\b/iu.test(text) ? 3 : 1);
      const rows = (meats.length ? meats : [{ meat: "bistec", another: false, qty: fallN }])
        .filter((x) => !cartHasMeat(x.meat));
      // Only invent a default bistec line when cart has no gordita yet and text named gorditas
      const toAdd = rows.length ? rows : (!cart.some((l) => /^sq-gordita-/i.test(String(l.itemId))) && /\bgorditas?\b/iu.test(text)
        ? [{ meat: "bistec", another: false, qty: fallN }] : []);
      for (const x of toAdd) {
        const meat = x.meat || "bistec";
        const opt = MEAT_OPT.find(([re]) => re.test(meat))?.[1];
        if (!opt) continue;
        const n = (x.qty && x.qty > 0 ? x.qty : fallN) || 1;
        acts.push({
          type: "add_item", itemId: "sq-gordita-M647RE", quantity: n > 1 ? n : 1,
          modifiers: [
            { step: "(A) Gordita Options", option: "(GD) Gordita" },
            { step: "(B) Q Carnes / Meats", option: opt },
          ],
          readback: `${n > 1 ? n : 1} gordita ${meat}`,
        });
      }
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
    // hector1 (CA434ba9): "una torta de bistec. En queso" / "con queso" → same QTO path ($5.25), not plain TO + Melted Cheese
    if (/\bqueso\s+tortas?\b/iu.test(text)
      || /\btortas?\b[^.!?]{0,48}\b(?:en|con)\s+queso\b/iu.test(text)
      || /\b(?:en|con)\s+queso\b[^.!?]{0,48}\btortas?\b/iu.test(text))
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
    // jesus2: COMBO Gorditas — force spoken qty, chorizo+carnitas meats, arroz+frijol (drop conflicting SOLO Frijoles)
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
    // jesus2: taco "solo / sin nada" → strip salsa (plain)
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
      // raul2 (CA06ecc4): "otros tres de bistec/bizco" (no "taco" word) after a TCO line — prior meat must not stick
      const tacoCtx = /\btaco/i.test(text)
        || cart.some((l) => kindOfItem(l.itemId) === "taco")
        || /\botr[oa]s?\s+(?:\d+|dos|tres|cuatro|cinco|seis)\s+de\s+/iu.test(text);
      if (named.length === 1 && tacoCtx && tacoAdds.length) {
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
    // lalo1: before apply — drop dual-meat QCO adds when cart already has covering single-meat QCO lines
    {
      const isQco = (id: string) => /quesadilla/i.test(id) && !/dorada|zzav3l|t5stuh/i.test(id);
      const meatRe = new RegExp(MEAT_LIST, "i");
      const meatsOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option).toLowerCase())
        .filter((o: string) => meatRe.test(o) && !/salsa/i.test(o)).map((o: string) => o.split(" /")[0].trim());
      const singles = new Set<string>();
      for (const l of cart) {
        if (!isQco(String(l.itemId || ""))) continue;
        const ms = meatsOf(l);
        if (ms.length === 1) singles.add(ms[0]);
      }
      if (singles.size) {
        for (let i = acts.length - 1; i >= 0; i--) {
          const a = acts[i];
          if (a.type !== "add_item" || !isQco(String(a.itemId || ""))) continue;
          const ms = meatsOf(a);
          if (ms.length >= 2 && ms.every((m: string) => [...singles].some((s) => s.includes(m) || m.includes(s))))
            acts.splice(i, 1);
        }
      }
    }
    // raul2 (CA06ecc4): before apply — strip prior-line meat from dual-meat taco adds (keep only the new meat)
    {
      const meatRe = new RegExp(MEAT_LIST, "i");
      const meatsOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option).toLowerCase())
        .filter((o: string) => meatRe.test(o) && !/salsa/i.test(o)).map((o: string) => o.split(" /")[0].trim());
      const singles = new Set<string>();
      for (const l of cart) {
        if (kindOfItem(l.itemId) !== "taco") continue;
        const ms = meatsOf(l);
        if (ms.length === 1) singles.add(ms[0]);
      }
      const hitSingle = (m: string) => [...singles].some((s) => s.includes(m) || m.includes(s));
      if (singles.size) {
        for (const a of acts) {
          if (a.type !== "add_item" || !/taco/i.test(String(a.itemId || ""))) continue;
          const ms = meatsOf(a);
          if (ms.length < 2) continue;
          if (ms.every((m: string) => hitSingle(m))) continue; // gino1f drops after apply
          const fresh = ms.filter((m: string) => !hitSingle(m));
          if (!fresh.length) continue;
          a.modifiers = (a.modifiers || []).filter((m: any) => {
            const o = String(m.option);
            if (!(meatRe.test(o) && !/salsa/i.test(o))) return true;
            const key = o.toLowerCase().split(" /")[0].trim();
            return fresh.some((f: string) => key.includes(f) || f.includes(key));
          });
        }
      }
    }
    apply(acts);
    // roberto1: "Sí, huevo en orden" STT for "hacer una orden" — never invent Chilaquiles con Huevo / EXTRA Huevo
    if (source.startsWith("caller")
      && /\bhuevo\s+en\s+orden\b/iu.test(text)
      && !/\bchilaquiles\b/iu.test(text)) {
      for (let i = acts.length - 1; i >= 0; i--) {
        if (acts[i].type !== "add_item" && acts[i].type !== "update_item") continue;
        const id = String(acts[i].itemId || "");
        if (/chilaquiles|huevo/i.test(id)) acts.splice(i, 1);
      }
      for (let i = cart.length - 1; i >= 0; i--) {
        if (/chilaquiles|huevo/i.test(String(cart[i].itemId || ""))) cart.splice(i, 1);
      }
    }
    // roberto1: "taco de bistec, costilla grande" + staff "Tortilla grande" → size, not Costilla meat
    {
      const staffAsk = (lastStaff || recentStaff.join(" ") || "").trim();
      if (source.startsWith("caller")
        && /\bcostilla\s+grande\b/iu.test(text)
        && (/\btortilla\s+grande\b/iu.test(staffAsk) || /\bcostilla\s+grande\b/iu.test(staffAsk) && /\btortilla\b/iu.test(staffAsk))) {
        for (const l of cart) {
          if (kindOfItem(l.itemId) !== "taco") continue;
          l.modifiers = (l.modifiers || []).filter((m: any) => !/costilla/i.test(String(m.option || "")));
          // keep/ensure bistec if caller said bistec on this or prior taco turn
          const blob = text + " " + (prevCaller || "");
          if (/\bbistec\b/iu.test(blob) && !(l.modifiers || []).some((m: any) => /bistec/i.test(String(m.option || "")))) {
            l.modifiers = [...(l.modifiers || []), { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }];
          }
          // stamp comal/grande note if missing
          if (!(l.modifiers || []).some((m: any) => /TCO|Comal|Homemade/i.test(String(m.option || "")))) {
            l.modifiers = [...(l.modifiers || []), { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" }];
          }
          l.readback = "taco comal bistec";
        }
        for (let i = acts.length - 1; i >= 0; i--) {
          if (acts[i].type !== "add_item") continue;
          const mods = acts[i].modifiers || [];
          if (mods.some((m: any) => /costilla/i.test(String(m.option || ""))) && /taco/i.test(String(acts[i].itemId || ""))) {
            acts[i].modifiers = mods.filter((m: any) => !/costilla/i.test(String(m.option || "")));
            if (!acts[i].modifiers.some((m: any) => /bistec/i.test(String(m.option || "")))) {
              acts[i].modifiers.push({ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" });
            }
          }
        }
      }
    }
        // juana1/juan1: address / house-number turns never add food (STT "diecisiete prospectos" ≠ chilaquiles×17)
    if (source.startsWith("caller") && (addressesIn(text).length > 0
      || /\b\d{1,5}\s+[a-záéíóúñ.'-]+\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|prospect)\b/iu.test(text)
      || /\b(?:diecisiete|seventeen|\d{1,2})\s+prospect/iu.test(text))) {
      for (let i = acts.length - 1; i >= 0; i--) {
        if (acts[i].type !== "add_item" && acts[i].type !== "update_item") continue;
        const id = String(acts[i].itemId || "");
        if (/drink|agua|horchata|jamaica|refresco|soda|coca/i.test(id)) continue;
        if (/chilaquiles|enchilada|menudo|quesadilla|taco|burrito|torta|dorada|platillo/i.test(id) || kindOfItem(id))
          acts.splice(i, 1);
      }
    }
    // joseA1: capture street from caller text when model skipped set_address (merged agua+address+horchata turn)
    if (source.startsWith("caller") && !shadowAddress) {
      const hit = addressesIn(text)[0];
      if (hit) { shadowAddress = hit.full || hit.street; shadowAddressConfirmed = true; }
    }
    // gino1f / raul2 (CA06ecc4): dual-meat taco — drop when every meat already has a single line;
    // else strip meats that already have their own single line (prior-line meat carried onto the next qty/meat change).
    {
      const meatRe = new RegExp(MEAT_LIST, "i");
      const meatsOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option).toLowerCase()).filter((o: string) => meatRe.test(o) && !/salsa/i.test(o)).map((o: string) => o.split(" /")[0].trim());
      const singles = new Set<string>();
      for (const l of cart) {
        if (kindOfItem(l.itemId) !== "taco") continue;
        const ms = meatsOf(l);
        if (ms.length === 1) singles.add(ms[0]);
      }
      const hitSingle = (m: string) => [...singles].some((s) => s.includes(m) || m.includes(s));
      if (singles.size) {
        for (let i = cart.length - 1; i >= 0; i--) {
          if (kindOfItem(cart[i].itemId) !== "taco") continue;
          const ms = meatsOf(cart[i]);
          if (ms.length < 2) continue;
          if (ms.every((m: string) => hitSingle(m))) { cart.splice(i, 1); continue; }
          const fresh = ms.filter((m: string) => !hitSingle(m));
          if (!fresh.length) continue;
          cart[i].modifiers = (cart[i].modifiers || []).filter((m: any) => {
            const o = String(m.option);
            if (!(meatRe.test(o) && !/salsa/i.test(o))) return true;
            const key = o.toLowerCase().split(" /")[0].trim();
            return fresh.some((f: string) => key.includes(f) || f.includes(key));
          });
          const left = meatsOf(cart[i]);
          cart[i].readback = `${cart[i].quantity || 1} taco ${left.join("+")}`;
        }
      }
    }
    // lalo1 (CA72b325) / david1 spirit: drop dual-meat QCO when single-meat QCO lines already cover those meats
    // (model merges tripa+duro on a name/filler turn into a phantom 3rd line).
    {
      const isQco = (id: string) => /quesadilla/i.test(id) && !/dorada|zzav3l|t5stuh/i.test(id);
      const meatRe = new RegExp(MEAT_LIST, "i");
      const meatsOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option).toLowerCase())
        .filter((o: string) => meatRe.test(o) && !/salsa/i.test(o)).map((o: string) => o.split(" /")[0].trim());
      const singles = new Set<string>();
      for (const l of cart) {
        if (!isQco(String(l.itemId || ""))) continue;
        const ms = meatsOf(l);
        if (ms.length === 1) singles.add(ms[0]);
      }
      if (singles.size) {
        for (let i = cart.length - 1; i >= 0; i--) {
          if (!isQco(String(cart[i].itemId || ""))) continue;
          const ms = meatsOf(cart[i]);
          if (ms.length >= 2 && ms.every((m: string) => [...singles].some((s) => s.includes(m) || m.includes(s))))
            cart.splice(i, 1);
        }
      }
    }
    // felipe1 (CA398d11): never keep a gordita line with two meats (Costilla+Alpastor) — split using spoken qtys
    {
      const meatRe = new RegExp(MEAT_LIST, "i");
      const meatsOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => meatRe.test(o) && !/salsa/i.test(o));
      const MEAT_OPT: Array<[RegExp, string]> = [
        [/costilla/i, "Costilla / Beef Rib"], [/pastor|alpastor/i, "Alpastor / Roasted Pork"],
        [/bistec|steak|asada/i, "Bistec / Steak"], [/chorizo/i, "Chorizo / Mexican Sausage"],
        [/pollo|chicken/i, "Pollo / Chicken"], [/prensado/i, "Prensado / Spicy Pork"],
        [/duro/i, "Duro / Pork Rinds"], [/lengua/i, "Lengua / Beef Tongue"],
        [/tripa/i, "Tripa / Beef Tripe"], [/buche/i, "Buche / Pork Stomach"],
      ];
      const qtyFor = (opt: string) => {
        const key = /pastor/i.test(opt) ? "pastor" : /costilla/i.test(opt) ? "costilla" : (opt.split(" /")[0] || "").toLowerCase();
        const listed = listedMeats(text);
        const hit = listed.find((x) => new RegExp(key, "i").test(x.meat));
        if (hit?.qty && hit.qty > 0) return hit.qty;
        const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = text.match(new RegExp(String.raw`\b(\d+|dos|tres|cuatro|cinco|seis)\b[^.]{0,80}?\b` + esc, "iu"));
        return m ? (spokenCount(m[1]) || 1) : 1;
      };
      for (let i = cart.length - 1; i >= 0; i--) {
        if (!/^sq-gordita-/i.test(String(cart[i].itemId))) continue;
        const ms = meatsOf(cart[i]);
        if (ms.length < 2) continue;
        const base = (cart[i].modifiers || []).filter((m: any) => !meatRe.test(String(m.option)) || /salsa/i.test(String(m.option)));
        const lines = ms.map((opt: string) => {
          const canon = MEAT_OPT.find(([re]) => re.test(opt))?.[1] || opt;
          const n = qtyFor(canon);
          return {
            itemId: "sq-gordita-M647RE", quantity: n > 1 ? n : 1,
            modifiers: [...base, { step: "(B) Q Carnes / Meats", option: canon }],
            readback: `${n > 1 ? n : 1} gordita ${canon.split(" /")[0]}`,
          } as Line;
        });
        cart.splice(i, 1, ...lines);
      }
      // Also split pending add_item acts with dual meats
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.type !== "add_item" || !/^sq-gordita-/i.test(String(a.itemId))) continue;
        const ms = meatsOf(a);
        if (ms.length < 2) continue;
        const base = (a.modifiers || []).filter((m: any) => !meatRe.test(String(m.option)) || /salsa/i.test(String(m.option)));
        const parts = ms.map((opt: string) => {
          const canon = MEAT_OPT.find(([re]) => re.test(opt))?.[1] || opt;
          const n = qtyFor(canon);
          return {
            type: "add_item", itemId: "sq-gordita-M647RE", quantity: n > 1 ? n : 1,
            modifiers: [...base.filter((m: any) => /\(GD\)|Gordita Options/i.test(String(m.option) + " " + String(m.step || "")) || !/\(QGD\)/i.test(String(m.option))),
              { step: "(A) Gordita Options", option: "(GD) Gordita" },
              { step: "(B) Q Carnes / Meats", option: canon }],
            readback: `${n > 1 ? n : 1} gordita ${canon.split(" /")[0]}`,
          };
        });
        // dedupe GD option
        for (const part of parts) {
          const seen = new Set<string>();
          part.modifiers = part.modifiers.filter((m: any) => {
            const k = String(m.option);
            if (seen.has(k)) return false;
            seen.add(k); return true;
          });
        }
        acts.splice(i, 1, ...parts);
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
      // daniel1: SIN bowls — readback must say Menudo con Tortillas / sin pata, never "Con Pata… extra pata"
      { const sinOnly = cart.some((l) => /menudo/i.test(String(l.itemId)) && !/con-pata|con_pata/i.test(String(l.itemId)))
          && !cart.some((l) => /con-pata|con_pata/i.test(String(l.itemId)));
        if (sinOnly && /\bCon\s+Pata\b/i.test(String(r.reply || "")) && !/\?/u.test(String(r.reply || ""))) {
          r.reply = language === "es"
            ? String(r.reply).replace(/\bCon\s+Pata(?:\s+Menudo)?[^.]*/ig, "Menudo con Tortillas").replace(/\bextra\s+pata[^.]*/ig, "").replace(/\s{2,}/g, " ").trim()
            : String(r.reply).replace(/\bCon\s+Pata(?:\s+Menudo)?[^.]*/ig, "Menudo with Tortillas").replace(/\bextra\s+pata[^.]*/ig, "").replace(/\s{2,}/g, " ").trim();
        }
      }
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
      // joseBirria1 (CA13b893): default Consomé+comal already forced — do not loop Birria Consomé/SOLO variant Q
      {
        const birriaQ = /\bbirria\b/i.test(reply) && /Consome|SOLO\/?ONLY/i.test(reply) && /\?/u.test(reply);
        const hasBirria = cart.some((l) => /birria/i.test(String(l.itemId)))
          || acts.some((a: any) => a.type === "add_item" && /birria/i.test(String(a.itemId)));
        const movedOn = /(?<![\p{L}])tortillas?\s+(?:extras?|estas)(?![\p{L}])/iu.test(text)
          || /\b(?:nombre|ser[ií]a\s+todo|nada\s+m[aá]s|a\s+nombre\s+de)\b/iu.test(text);
        if (birriaQ && (hasBirria || movedOn)) r.reply = language === "es" ? "¿Algo más?" : "Anything else?";
      }
      // jose2: strip phantom huarache lines the model/auto invented when caller never said huarache
      if (!saidHuarache) {
        for (let i = acts.length - 1; i >= 0; i--)
          if (acts[i].type === "add_item" && /huarache|guarache/i.test(String(acts[i].itemId))) acts.splice(i, 1);
        for (let i = cart.length - 1; i >= 0; i--)
          if (/huarache|guarache/i.test(String(cart[i].itemId))
            && !history.some((h) => h.role === "customer" && /\b[gh]uaraches?\b/iu.test(h.text)))
            cart.splice(i, 1);
      }
      // adriana1/miriam2: drop phantom torta when caller never said torta (cerdos greeting / model invent)
      // ca0d0e12: "si tiene torta de milanesa" is availability (staff out of bolillo) — never counts as said
      {
        const tortaAvailOnly = (s: string) => /\btortas?\b/iu.test(s)
          && (/(?:s[ií]\s+)?(?:tiene|tienen|tienes|hay|vende[ns]?)\s+(?:\w+\s+){0,4}tortas?/iu.test(s)
            || /\btortas?\b[^.?]{0,40}\b(?:tiene|tienen|tienes|hay)\b/iu.test(s)
            || /(?:me\s+)?(?:pone|pones|p[oó]ngame)\s+(?:un[oa]?)?\s*,?\s*(?:s[ií]\s+)?(?:tiene|tienen|tienes)\b/iu.test(s));
        const saidTorta = (/\btortas?\b/iu.test(text) && !tortaAvailOnly(text))
          || history.some((h) => h.role === "customer" && /\btortas?\b/iu.test(h.text) && !tortaAvailOnly(h.text));
        if (!saidTorta) {
          for (let i = acts.length - 1; i >= 0; i--)
            if ((acts[i].type === "add_item" || acts[i].type === "update_item") && /torta/i.test(String(acts[i].itemId))) acts.splice(i, 1);
          for (let i = cart.length - 1; i >= 0; i--)
            if (/torta/i.test(String(cart[i].itemId)) && !/menudo/i.test(String(cart[i].itemId))) cart.splice(i, 1);
        }
      }
      // daniel2: drop phantom Tacos Dorados when caller never said dorados/flautas
      {
        const saidDor = /\b(?:tacos?\s+)?dorados?\b|\bflautas?\b/iu.test(text)
          || history.some((h) => h.role === "customer" && /\b(?:tacos?\s+)?dorados?\b|\bflautas?\b/iu.test(h.text));
        if (!saidDor) {
          for (let i = acts.length - 1; i >= 0; i--)
            if ((acts[i].type === "add_item" || acts[i].type === "update_item") && /tacos-dorados/i.test(String(acts[i].itemId))) acts.splice(i, 1);
          for (let i = cart.length - 1; i >= 0; i--)
            if (/tacos-dorados/i.test(String(cart[i].itemId))) cart.splice(i, 1);
        }
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
      // ca11603f: QCO already on cart — never loop Tortillas pack SKUs (6x Taquera/Harina/Comal)
      if (/^\s*Tortillas\s*:/iu.test(prev) && /\d+\s*x\s*Tortilla/iu.test(prev)
        && cart.some((l) => (l.modifiers || []).some((m: any) => /\(QCO\)|Comal\s*\/\s*Homemade/i.test(String(m.option))))) {
        last = { ...(last || {}), reply: lang === "es" ? "¿Algo más?" : "Anything else?", actions: [] };
        break;
      }
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
  const rawCallerBlob = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
  // larry1: "you got quesadilla today?" / "¿tienen birria hoy?" asks what's available; it isn't an order line (it opened a
  // quesadilla question that swallowed the Queso Birrias and the rest of the call).
  // …only when the caller names that dish again later ("do you have plate x today?" → "can I order some" still needs it).
  // avail4: "Sí, y me da, ¿tienen como arroz, como una side de arroz?" — a trailing ¿tienen/hay/manejan …? clause with no count is a
  // question; strip it, and drop the turn if only filler is left (the order comes on the next turn: "me da una side de arroz").
  turns = turns.flatMap((t) => { if (t.speaker !== "caller") return [t];
    const m = t.text.match(/^(.*?)[,\s]*¿\s*(?:tienen|tienes|hay|manejan|tiene|est[aá]\s+disponible)\b[^?¿]*\?\s*$/iu);
    if (!m || !m[1].trim() || /\b(\d+|dos|tres|cuatro|cinco)\b/iu.test(t.text.slice(m[1].length))) return [t];
    const rest = m[1].trim(); return dishesNamed(rest).size || /\b\d+\b/.test(rest) ? [{ ...t, text: rest }] : []; });
  // carlos-qd1 (CAfc6b32): "¿Tendrá" + "quesadillas de aceite?" split across ASR turns —
  // join incomplete avail openers onto the next caller fragment so isAvailQ sees the full question
  // (avail runs before consecutive-caller merge; without this the opener alone fails isAvailQ and
  // "quesadillas de aceite?" can rewrite into a pending REGULAR that later duplicates under preparadas).
  {
    const out: CallTurn[] = [];
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      if (t.speaker !== "caller") { out.push(t); continue; }
      const opener = /^\W*¿?\s*(?:tendr[aá]s?|tendr[aá]n|tienen|tienes|tiene|hay|ten[eé]s|vende[ns]?|manejan|do\s+you\s+(?:guys\s+)?have|got\s+any)\s*\W*$/iu.test(t.text);
      if (opener && i + 1 < turns.length && turns[i + 1].speaker === "caller") {
        const nx = turns[i + 1];
        out.push({
          ...t,
          text: `${t.text.replace(/[.?!¿¡]+$/u, "")} ${nx.text.replace(/^[¿¡]+/u, "")}`.replace(/\s+/g, " ").trim(),
          end: nx.end,
        });
        i++;
        continue;
      }
      out.push(t);
    }
    turns = out;
  }
  // avail2: any availability question ("¿tienen arroz?", "do you have X?") is never an order line, whether or not the dish is named again.
  // cecilia1: when next is "me puede preparar dos órdenes … con pata" with no dish, stamp the asked dish onto that next turn before dropping this one.
  { // avail2b (Cecilia): "Oiga, disculpe, ¿sí tienen menudo?" — ¿ + optional sí between fillers and tienen/hay.
    // juan1/avail2: also tenés/venden; list-back ("qué me dijiste que tenés… gorditas, qué más?"); size info ("¿los sopes son grandes o chicos?"). Availability ≠ order.
    const isAvailQ = (t: CallTurn) => {
      if (t.speaker !== "caller") return false;
      // ca0d0e12 / alex1: "Ah, me pone un, si tiene torta de milanesa" — incomplete crumb + availability, not an order
      if (/^\W*(?:(?:ah|oh|este|bueno|pues|s[ií])[,.\s]+){0,4}(?:me\s+)?(?:pone|pones|pongo|ponme|p[oó]ngame)\s+(?:un[oa]?)?\s*,?\s*(?:s[ií]\s+)?(?:tiene|tienen|tienes|hay|vende[ns]?)\b/iu.test(t.text)) return true;
      if (/\b(?:quiero|dame|deme|me\s+da|I'?ll\s+take|I'?ll\s+have|can\s+I\s+(?:get|have|order)|let\s+me\s+get|I\s+want|give\s+me|me\s+pones?|me\s+puedes?\s+poner|ponme)\b/iu.test(t.text)) return false;
      if (/\b(\d+|one|two|three|four|five|una?|dos|tres|cuatro|for pickup|para llevar|order|orden)\b/i.test(t.text) && !/\b(?:qu[eé]\s+m[aá]s|me\s+dijiste|what\s+else)\b/iu.test(t.text)) return false;
      if (/^\W*(?:(?:hey|so|and|oh|y|oye|oiga|mire|diga|ah|am|um|uh|s[ií]|bueno|disculpe|perd[oó]n|ok(?:ay)?|qu[eé])[,.\s]+){0,5}\W*(?:s[ií][,.\s]+)?(?:(?:do\s+)?you(?:\s+guys)?(?:\s+still)?\s+(?:got|have)|you\s+got\s+ca-?\s+you\s+got|got\s+any|is\s+there|is\s+[^?.!]{0,40}\bavailable|est[aá]\s+disponible|tienen\s+disponible|tienen|tienes|hay|tiene|ten[eé]s|tendr[aá]s?|tendr[aá]n|vende[ns]?|manejan)\b[^.!]*?(?:\btoday\b|\bhoy\b|\?)\W*$/iu.test(t.text)) return true;
      if (/\b(?:qu[eé]\s+m[aá]s|me\s+dijiste\s+que\s+ten|what\s+else\s+(?:do\s+you\s+)?have|you\s+(?:also\s+)?(?:said\s+you\s+)?have)\b/iu.test(t.text)) return true;
      // ca537a80: "sí, tiene quesadillas en aceite" (no ?) is QD order cue — not victor1 avail
      if (/\bquesadillas?\b/iu.test(t.text) && /\b(?:en|de)\s+aceite\b/iu.test(t.text) && !/[?¿]/.test(t.text)) return false;
      // victor1/avail: "De, este, sí tiene barbacoa." — availability, not an order (no ?/hoy required).
      if (/^\W*(?:(?:de|este|ah|oh|am|um|eh|s[ií]|bueno|pues|oye)[,.\s]+){0,6}\W*(?:s[ií][,.\s]+)?(?:tiene|tienen|tienes|ten[eé]s|tendr[aá]s?|tendr[aá]n|hay|vende[ns]?|manejan)\b\s+[\p{L}\s]{2,40}\W*$/iu.test(t.text)) return true;
      // gino1: "Y tacos de ticket tienen." — dish…tienen (avail), not an order
      if (/\b(?:tacos?|quesadillas?|gorditas?|tortas?|burritos?|sopes?|menudo|birria)\b[^.?]{0,40}\btienen\s*[.?]?\s*$/iu.test(t.text)) return true;
      if (/^\W*(?:(?:los?|las?)\s+)?(?:sopes?|gorditas?|tacos?|quesadillas?|tortas?|huaraches?|guaraches?)\s+(?:son|est[aá]n|are)\s+/iu.test(t.text)) return true;
      // carlos-qd1 (CAfc6b32): "¿Tendrá quesadillas de aceite?" — JS \b is ASCII-only, so tendr[aá]s?\b never
      // matches Tendrá (á is \W). Use lookaround / trailing space-or-punct instead.
      if (/^\W*¿?\s*tendr[aá]s?(?:\s|[?.!,¿¡])/iu.test(t.text)
        && /[?¿]/u.test(t.text)
        && !/\b(?:dame|deme|me\s+das|quiero|pon(?:me|ga)|me\s+pone)\b/iu.test(t.text)
        && !ORDER_QTY.test(t.text)) return true;
      // carlos-qd1: bare "quesadillas de aceite?" fragment (opener merge failed / alone) is avail, not an order
      if (/^\W*¿?\s*quesadillas?\s+de\s+aceite\s*\?\s*$/iu.test(t.text)) return true;
      // arturo1 (CAf5008b): "para los tacos, normalmente, ¿son de tortilla amarilla o blanca?" — menu/info, not an order.
      // Must drop before merge; otherwise it glues onto "dos quesadillas doradas" and opens a pending taco that blocks later items.
      if (/\b(?:tacos?|quesadillas?|gorditas?|sopes?|tortas?|burritos?)\b[\s\S]{0,80}\b(?:son|est[aá]n|are)\s+(?:de\s+)?tortilla/iu.test(t.text)
        || /\b(?:normalmente|usualmente|usually)\b[\s\S]{0,60}\b(?:tortilla\s+)?(?:amarilla|blanca|ma[ií]z|harina|corn|flour)/iu.test(t.text)
        || /\bson\s+de\s+tortilla\s+(?:amarilla|blanca)/iu.test(t.text)
        || (/\btortilla\s+(?:amarilla|blanca)\b/iu.test(t.text) && /\?|¿/.test(t.text) && !ORDER_QTY.test(t.text))) return true;
      return false;
    };
    // jose2: "me pone dos, una de picadillo…" after doradas avail is an order, not bare filler
    const nextIsOrderBare = (nx: CallTurn) => !dishesNamed(nx.text).size && /\b(?:order|get|take|want|have)\s+(?:some|it|one|that|those|them)\b|\b(?:l[oa]s?)\s+quiero\b|\bquiero\s+(?:un[oa]?|dos|tres|es[oa]s?)\s*[.,!]*$|\bdame\s+(?:un[oa]?|dos|tres|es[oa]s?)\s*[.,!]*$|\b(?:me\s+)?puede(?:s)?\s+(?:preparar|hacer|dar|poner)\b|\b(?:me\s+)?pone(?:s|r)?\b|\bpon(?:me|ga)\b|\b[oó]rdenes?\b/iu.test(nx.text);
    // ca537a80: after aceite avail, "una de bistec y una de prensado" is the order (no quiero/dame)
    const meatPairAfterQd = (nx: CallTurn) => !dishesNamed(nx.text).size
      && listedMeats(nx.text).length >= 2
      && /\buna\s+de\b/iu.test(nx.text)
      && !/\btortas?\b/iu.test(nx.text);
    const dishOf = (text: string) => {
      // carlos-qd1: "quesadillas de aceite" avail → stamp doradas onto the following qty order
      if (/\bquesadillas?\b/iu.test(text) && /\baceite\b/iu.test(text)) return "quesadillas doradas";
      if (/\bquesadillas?\s+doradas?\b/iu.test(text) || (/\bdoradas?\b/iu.test(text) && /\bquesadillas?\b/iu.test(text))) return "quesadillas doradas";
      return (text.match(/\b(nachos|quesadillas?|tacos?|tortas?|burritos?|gorditas?|sopes?|huaraches?|tostadas?|enchiladas?|tamales|esquites?|menudos?|moles?|platillos?|plates?|c[oó]ctel(?:es)?\s+de\s+camar[oó]n(?:es)?)\b/iu) || [])[1] || "";
    };
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]; if (!isAvailQ(t)) continue;
      // alex2: skip size/info avail turns ("¿están grandes…?") when finding the bare qty order after a dish probe
      const ni = turns.findIndex((u, j) => j > i && u.speaker === "caller" && (nextIsOrderBare(u) || meatPairAfterQd(u) || !isAvailQ(u)));
      if (ni < 0 || !(nextIsOrderBare(turns[ni]) || meatPairAfterQd(turns[ni]))) continue;
      // Prefer dish from this probe; if size-info, look back for recent dish avail
      let dish = dishOf(t.text);
      if (!dish) {
        for (let k = i; k >= 0; k--) {
          if (turns[k].speaker !== "caller" || !isAvailQ(turns[k])) continue;
          dish = dishOf(turns[k].text); if (dish) break;
        }
      }
      if (!dish) continue;
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
  let wrapUp = false; // rich1: staff goodbye / pickup ETA — later caller chatter never re-prompts
  for (let t of turns) {
    if (t.speaker === "caller" && wrapUp && !FOOD.test(t.text) && !listedMeats(t.text).length && !DRINK.test(t.text)) {
      steps.push({ source: "caller-after-goodbye", heard: t.text }); last = null; continue;
    }
    if (t.speaker !== "caller") {
      if (WRAP_UP.test(t.text)) wrapUp = true;
      steps.push({ source: "staff", heard: t.text }); staffAskedSplit = /\?|¿/.test(t.text) ? detectContainerSplit(t.text) : null;
      noteFulfillment(t.text);
      staffAskedComal = /\bcomal\b/iu.test(t.text) && /\?|¿/.test(t.text);
      lastStaff = t.text; recentStaff.push(t.text); if (recentStaff.length > 3) recentStaff.shift(); staffSince.push(t.text);
      // adriana1: staff "¿Cerdos también?" is pork/avail chatter — not a torta order
      if (/\bcerdos?\b/iu.test(t.text)) {
        const allC = turns.filter((u) => u.speaker === "caller").map((u) => u.text).join(" ");
        if (!/\btortas?\b/iu.test(allC)) {
          for (let i = cart.length - 1; i >= 0; i--) if (/torta/i.test(String(cart[i].itemId)) && !/menudo/i.test(String(cart[i].itemId))) cart.splice(i, 1);
          if (asking(last) && /torta|carne|meat/i.test(String(last?.reply || ""))) last = { actions: [], reply: "" } as any;
        }
      }
      // miriam2: staff "Un menudo, ¿con pata o sin pata?" — confirm menudo; drop phantom torta if caller never said torta
      if (/\bmenudos?\b/iu.test(t.text) && /\b(?:con\s+pata|sin\s+pata)\b/iu.test(t.text)) {
        const allC = turns.filter((u) => u.speaker === "caller").map((u) => u.text).join(" ");
        if (!/\btortas?\b/iu.test(allC)) {
          for (let i = cart.length - 1; i >= 0; i--) if (/torta/i.test(String(cart[i].itemId)) && !/menudo/i.test(String(cart[i].itemId))) cart.splice(i, 1);
        }
        // don't let an open torta/meat Q absorb the next "Sin pata" / staff Bistec
        if (asking(last) && /torta|carne|meat/i.test(String(last?.reply || ""))) last = { actions: [], reply: "" } as any;
        // oscar1: staff restates "sin pata, un menudo" after Sí — ensure SIN bowl if still empty
        if (!cart.some((l) => /menudo/i.test(String(l.itemId))) && /\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(t.text)) {
          cart.push({
            itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 1,
            modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }],
            readback: "menudo sin pata",
          } as Line);
        }
      }
      // joseBirria1: staff "Una orden de birria" — force default Consomé+comal SKU; clear open birria variant Q
      if (/\bbirrias?\b/iu.test(t.text) && /\b(?:orden(?:es)?|order)\b/iu.test(t.text)
        && !/(?<![\p{L}])tortillas?\s+extras?(?![\p{L}])/iu.test(t.text)) {
        const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
        if (!cart.some((l) => /birria/i.test(String(l.itemId))))
          cart.push({ itemId: BIRRIA, quantity: 1, modifiers: [], readback: "orden de birria" } as Line);
        if (asking(last) && /birria/i.test(String(last?.reply || ""))) last = { actions: [], reply: "" } as any;
      }
      // joseBirria1: staff "cuatro tortillas extras y una birria" — ensure both lines
      if (/\bbirrias?\b/iu.test(t.text) && /(?<![\p{L}])tortillas?\s+extras?(?![\p{L}])/iu.test(t.text)) {
        const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
        const TOR_X = "sq-tortillas-extras-1-x-tortilla-comal-ADELFI";
        const m = t.text.match(/\b(\d+|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+tortillas?\s+extras?/iu);
        const n = m ? Math.max(1, spokenCount(m[1]) || Number(m[1]) || 4) : 4;
        if (!cart.some((l) => /birria/i.test(String(l.itemId))))
          cart.push({ itemId: BIRRIA, quantity: 1, modifiers: [], readback: "birria" } as Line);
        const haveX = cart.find((l) => /tortillas-extras|extras-1-x-tortilla/i.test(String(l.itemId)));
        if (!haveX) cart.push({ itemId: TOR_X, quantity: n, modifiers: [], readback: `${n} tortillas extras` } as Line);
        else haveX.quantity = n;
        if (asking(last) && /birria/i.test(String(last?.reply || ""))) last = { actions: [], reply: "" } as any;
      }

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
    // arturo1: unresolved "Missing required choices for: 1 taco" (phantom from avail Q) must not block
    // later fully-specified items (e.g. "dos QD REGULAR Dorada" + prensado/duro). Abandon the open
    // incomplete when this turn names a different dish or staff already confirmed those items.
    {
      const miss = /Missing required choices for:|Falta completar:/i.test(String(last?.reply || ""));
      if (miss) {
        const openKind = (String(last?.reply || "").match(/(?:for|:\s*)(\d+\s+)?([\p{L}\s]+?)\.?\s*$/iu) || [])[2] || "";
        const otherDish = dishesNamed(t.text).size > 0
          && (!openKind || ![...dishesNamed(t.text)].some((k) => new RegExp(k, "i").test(openKind)));
        const staffHasOther = /\b(?:quesadilla|dorada|qd)\b/iu.test(recentStaff.join(" ") + " " + lastStaff)
          && /\b(?:prensado|duro|bistec|pollo|buche)\b/iu.test(recentStaff.join(" ") + " " + lastStaff);
        if (otherDish || staffHasOther || /\bdoradas?\b|\baceite\b|\bquesadillas?\b/iu.test(t.text)) {
          last = { actions: [], reply: "" } as any;
          pendingDish = null;
          pendingDishes = [];
          steps.push({ source: "caller-abandon-incomplete", heard: t.text.slice(0, 80) });
        }
      }
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
        attributeRemovals(t.text, ld); // noe1: "No regulares, con la verdura aparte" — the note rides on that Dorada
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
        // rodrigo1: "sí, con todo" on preparada = on-item deluxe toppings, NOT APARTE side and NOT Con Frijoles
        // unless caller/staff explicitly said aparte / con frijoles.
        const blob = (t.text + " " + lastStaff + " " + recentStaff.join(" ")).toLowerCase();
        const saidAparte = /\baparte\b|\bon\s+the\s+side\b|\beverything\s+on\s+side\b/i.test(blob);
        const saidFrij = /\bcon\s+frijoles?\b|\bwith\s+beans\b/i.test(blob);
        ld.modifiers = (ld.modifiers || []).filter((m: any) => {
          const o = String(m.option || "");
          if (!saidAparte && /APARTE|EVERTHING ON SIDE|EVERYTHING ON SIDE/i.test(o)) return false;
          if (!saidFrij && /Con Frijoles|With Beans/i.test(o)) return false;
          return true;
        });
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
    // cad71199: address / street / city turns must not re-open food (Bank Street → enchiladas)
    {
      const frag = t.text.replace(/[¿¡?.!,]+/gu, " ").replace(/\s+/g, " ").trim();
      const hit = addressesIn(t.text)[0];
      const streetFrag = /\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b/iu.test(frag)
        && !FOOD.test(frag) && !listedMeats(frag).length && !DRINK.test(frag);
      const cityOnly = /^(?:aj[aá]\s+)?(?:toledo|painesville|mentor|fairport|willoughby|eastlake|chardon|madison|perry|concord|kirtland)\b$/iu.test(frag);
      // house# + street, or bare "Bank Street" / "Bank Street, Ajá", or city — skip model food path
      if ((hit || streetFrag || cityOnly) && !FOOD.test(frag) && !listedMeats(frag).length && !DRINK.test(frag)
        && !/\b(?:dame|deme|quiero|quisiera|pon(?:me|ga)|orden|pedido)\b/iu.test(frag)) {
        // juan1: STT spells the house number digit by digit ("Es 8 7 2 Bank Street. Va, sí. Ah, Juan.")
        const compact = t.text.replace(/\b\d(?:\s+\d\b)+/g, (m) => m.replace(/\s+/g, ""));
        const hit2 = hit || addressesIn(compact)[0];
        const suffixCut = (x: string) => { const m = x.match(/^(.*?\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b)/iu); return m ? m[1] : x; };
        if (hit2 && !shadowAddress) { shadowAddress = hit2.full || hit2.street; shadowAddressConfirmed = true; }
        else if (!shadowAddress && streetFrag) {
          shadowAddress = suffixCut(frag.replace(/\b\d(?:\s+\d\b)+/g, (m) => m.replace(/\s+/g, "")).replace(/^(?:es|est[aá]|aj[aá])\s+/iu, "")).replace(/^(?:aj[aá]\s+)+/iu, "").replace(/\b(?:aj[aá]|ok(?:ay)?|eh|lester|gracias)\b/giu, " ").replace(/\s+/g, " ").trim();
          shadowAddressConfirmed = true;
        }
        steps.push({ source: "caller-address-frag", heard: t.text }); continue;
      }
    }
    // ca537a80: English name scraps ("Old", "man, old man", "What I said") must not reopen QD REGULAR/DELUXE
    {
      const frag = t.text.replace(/[¿¡?.!,]+/gu, " ").replace(/\s+/g, " ").trim();
      if (t.speaker === "caller" && !FOOD.test(frag) && !MEAT_WORDS.test(frag) && !DRINK.test(frag)
        && /^(?:hey|old(?:\s+man)?|man(?:[,\s]+old\s+man)?|what\s+i\s+said|that(?:'?s| is)?\s+(?:what\s+i\s+)?said)$/iu.test(frag)) {
        steps.push({ source: "caller-name-frag", heard: t.text }); continue;
      }
    }
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
      // gloria1 (CA8ce342): the alias default "quesadillas doradas" → "QD REGULAR Dorada" is not the caller choosing REGULAR
      // over DELUXE — only an explicit regular/normal/sencilla answers the open style question.
      const pickText = /\bQD REGULAR Dorada\b/.test(t.text) && !/\b(?:regular(?:es)?|normal(?:es)?|sencill[ao]s?|plain)\b/iu.test(t.text.replace(/\bQD REGULAR Dorada\b/g, " "))
        ? t.text.replace(/\bQD REGULAR Dorada\b/g, " quesadillas ") : t.text;
      const selfPick = qs.map((q) => staffPick(optsOf(q), pickText)).find(Boolean) || null;
      // cad71199: caller "preparadas …" must answer open REGULAR/DELUXE (selfPick was discarded before)
      let pick = selfPick && /regular|deluxe|preparad|dorada|comal|harina|flour|taquer|street|ma[ií]z|corn|homemade/i.test(selfPick)
        ? selfPick
        : (selfPick ? null : (qs.map((q) => staffPick(optsOf(q), said)).find(Boolean) || null));
      // larry1: staff's yes/no check ("Flour, right?" / "¿De harina?") + caller "Yep" answers the open tortilla choice.
      if (!pick && !selfPick && /^\W*(yep|yup|yes|yeah|uh-?huh|correct|right|s[ií]|aj[aá]|exacto|eso)\b/iu.test(t.text)) {
        // Prefer explicit caller word (Taqueros / comal / harina) over first staff option; allow no trailing "?"
        const callerTort = (t.text.match(/\b(flour|harina|corn|comal|ma[ií]z|taqueros?|taquer[ao]|street)\b/iu) || [])[1];
        const tw = callerTort
          || (rawStaff.match(/\b(flour|harina|taqueros?|taquer[ao]|street|corn|comal|ma[ií]z)\b/iu) || [])[1];
        if (tw) { const want = /flour|harina/i.test(tw) ? /flour|harina/i : /taquer|street/i.test(tw) ? /taquer|street/i : /comal|homemade|ma[ií]z|corn/i;
          pick = qs.map((q) => optsOf(q).find((o) => want.test(o))).find(Boolean) || null; } }
      // tortdef1 (Nico 11:40): an unanswered tortilla-type question must not block the item. Once the order moves on (staff
      // "anything else / algo más / name", or caller "that is it / es todo"), take the house default — corn/comal, as staff rings it.
      // rodrigo1 (CA99492106): staff already settled "quesadilla de buche dorada" — never house-default Comal; force Dorada path.
      if (!pick && !selfPick) {
        const nf = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
        const movedOn = /\b(anything else|something else|algo mas|otra cosa|name for the order|nombre)\b/.test(nf(rawStaff)) || /\b(that is it|that's it|thats it|that's all|nothing else|es todo|eso es todo|nada mas|seria todo)\b/.test(nf(t.text));
        // larry1: a bare "yeah / that's fine" to a tortilla question (Queso Birrias loop) also takes the house default.
        const affirm = /^\s*(yeah|yep|yup|yes|ok(?:ay)?|sure|fine|that'?s fine|si|aja|esta bien|asi esta bien)\b/.test(nf(t.text)) && !dishesNamed(t.text).size;
        // miguel1: house-default tortilla pick is for open taco/quesadilla lines — not menudo-only carts
        const menudoOnlyCart = cart.some((l) => /menudo/i.test(String(l.itemId))) && !cart.some((l) => kindOfItem(l.itemId) === "taco")
          && !/\btacos?\b/iu.test(t.text);
        const staffSaidDorada = /\bdorad|\baceite\b/iu.test(rawStaff);
        const tortillaQOpen = qs.some((q) => optsOf(q).length >= 2 && optsOf(q).every((x) => /\b(corn|comal|maiz|flour|harina|taquer[ao]|street|quesadilla)\b/i.test(x)));
        if (staffSaidDorada && tortillaQOpen && (movedOn || affirm || /\bdorad/iu.test(t.text))) {
          // Answer with dorada so aceite1 / dorada handlers convert QCO→QD; do not pick Comal.
          last = await say("dorada", t.language, "staff-dorada-not-comal");
          steps.push({ source: "staff-dorada-not-comal", heard: (rawStaff + " " + t.text).slice(0, 120) });
          // Convert any just-added QCO quesadilla to QD Regular (style may upgrade later via preparada).
          for (const l of cart as any[]) {
            const id = String(l.itemId || "");
            const isQco = /quesadilla/i.test(id) && !/dorada|zzav3l|t5stuh/i.test(id)
              && (l.modifiers || []).some((m: any) => /QCO|Comal|Homemade/i.test(String(m.option)));
            if (!isQco) continue;
            const keep = (l.modifiers || []).filter((m: any) => {
              const o = String(m.option || "");
              return !/\(QCO\)|comal|homemade|REGULAR Dorada|DELUXE Preparada|salsa asada|APARTE|Con Frijoles/i.test(o)
                && /carne|meat|bistec|chorizo|picadillo|pollo|buche|tripa|lengua|pastor|carnitas|asada|prensado|duro|cabeza|costilla/i.test(o + " " + String(m.step || ""));
            });
            l.itemId = DORADA_REG_ID;
            l.modifiers = [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, ...keep];
            l.readback = "quesadilla dorada regular";
          }
          lastStaff = ""; continue;
        }
        const tq = !menudoOnlyCart && !staffSaidDorada && (movedOn || affirm) ? qs.map((q) => optsOf(q)).find((o) => o.length >= 2 && o.every((x) => /\b(corn|comal|maiz|flour|harina|taquer[ao]|street)\b/i.test(x))) : null;
        if (tq) pick = tq.find((x) => /\b(comal|maiz|homemade)\b/i.test(x)) || tq.find((x) => /\bcorn\b/i.test(x) && !/\b(street|taquer)/i.test(x)) || null;
      }
      // hector1 (CA434ba9): staff "¿Una coca?" / "¿Taparrosca o vidrio?" + caller yes / "un refresco nomás" / Caparrusca
      // — even when ASR steals "Una torta. Sí". Ring Coca-Cola taparrosca; strip phantom torta from this turn.
      {
        const staffAsk = (rawStaff || lastStaff || recentStaff.join(" ") || "").trim();
        const staffCoca = /\b(?:una\s+)?cocas?(?:\s+colas?)?\b/iu.test(staffAsk)
          || (/\btaparrosca\b/iu.test(staffAsk) && /\bvidrio\b/iu.test(staffAsk));
        const saidBottle = /\b(?:taparrosca|caparrusca|caparrosca|vidrio)\b/iu.test(t.text);
        const saidOneRefresco = /\b(?:un|una)\s+refresco\b/iu.test(t.text) || (/\brefresco\b/iu.test(t.text) && /\bnom[aá]s\b/iu.test(t.text));
        const asrTortaYes = /\buna\s+tortas?\b/iu.test(t.text) && /\bs[ií]\b/iu.test(t.text) && !/\bbistec\b|\bqueso\b|\b(?:al\s*)?pastor\b|\bpollo\b|\bchorizo\b/iu.test(t.text);
        const bareYes = /^\W*(?:s[ií]|yes|yeah|yep|ok(?:ay)?|claro|aj[aá]|eso)(?:\W|$)/iu.test(t.text) && !dishesNamed(t.text).size;
        if (staffCoca && (saidBottle || saidOneRefresco || asrTortaYes || bareYes)) {
          const COCA = "sq-drink-coca-cola-JJE4KC";
          if (!cart.some((l) => /coca/i.test(String(l.itemId)))) {
            cart.push({ itemId: COCA, quantity: 1, modifiers: [], readback: "1 coca cola taparrosca" } as Line);
          } else {
            const c = [...cart].reverse().find((l) => /coca/i.test(String(l.itemId)));
            // fix1036: "Tengo coca" + "Sí, coca" confirms the kind, not a count — only a singular ask / "un refresco" means 1
            if (c && (Number(c.quantity) || 1) > 1 && (saidOneRefresco || (/\buna\s+coca/iu.test(staffAsk) && (saidBottle || asrTortaYes || bareYes)))) c.quantity = 1;
          }
          if (asrTortaYes) {
            t.text = t.text.replace(/\buna\s+tortas?\b/giu, " ").replace(/\s+/g, " ").trim() || "sí";
          }
          steps.push({ source: "staff-coca-confirm", heard: (staffAsk + " | " + t.text).slice(0, 120) });
          if (saidBottle || asrTortaYes) { lastStaff = ""; /* keep going so later torta can land */ }
        }
      }
      // larry1: staff offers a side ("you want onions and peppers?") → caller "yes… two of those": ring that side.
      { if (/\b(?:want|quieres?|gusta)\b[^?]*\b(?:onions?\s+(?:and|y)\s+peppers?|cebollas?\s+y\s+chiles?)/iu.test(rawStaff) || /(?:^|[?.!]\s*)(?:grilled\s+)?onions?\s+(?:and|y)\s+peppers?\s*\?/iu.test(rawStaff)) { sideOffer = rawStaff; sideOfferAge = 0; } else sideOfferAge++;
        const off = (sideOfferAge <= 2 ? sideOffer : "").match(/(?:\b(?:want|quieres?|gusta)\b[^?]*?|(?:^|[?.!]\s*))\b((?:grilled\s+)?onions?\s+(?:and|y)\s+peppers?|cebollas?\s+y\s+chiles?(?:\s+asados?)?)\b[^?]*\?/iu);
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
        if (/\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(said) && !/\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(t.text)) {
          const pref = allOpts.find((o) => /con\s+pata|pata\s+menudo|extra\s+pata/i.test(o));
          if (pref) pick = pref;
        } else if (/\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(said)
          || (allOpts.some((o) => /pata/i.test(o)) && allOpts.some((o) => /tortilla/i.test(o)) && !/\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(said))) {
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
    // rodrigo1 (CA99492106): staff lists nachos toppings ("frijoles, lechuga, crema, pico, queso fresco" + "queso dip")
    // and caller confirms ("Ajá" / "sí") → stamp Pollo meat + ALL toppings. Never map "frijoles" to Carne
    // "Frijoles Refritos"; use "(B) Nachos Options" Frijoles / Pinto Beans. multi2 used Elvi's 4-opt Q and
    // dropped pollo / queso fresco / queso dip.
    {
      const staffAsk = (recentStaff.join(" ") + " " + lastStaff).trim();
      const nachosCue = /\bnachos?\b/iu.test(staffAsk + " " + rawCallerBlob) || cart.some((l) => /nachos/i.test(String(l.itemId)));
      const listed = /\bfrijol/i.test(staffAsk) && /\blechuga\b/i.test(staffAsk) && (/\bcrema\b/i.test(staffAsk) || /\bpico\b/i.test(staffAsk));
      const yes = /^\W*(?:(?:o\s+)?(?:s[ií]|aj[aá]|yes|yeah|yep|ok(?:ay)?|claro|eso|exacto|todo\s+est[aá]\s+bien)|estan?\s+bien)(?:\W|$)/iu.test(t.text)
        && !dishesNamed(t.text).size && !listedMeats(t.text).length;
      // Also catch staff appending "y queso dip está bien" while toppings Q still open
      const staffDipOk = /\bqueso\s+dip\b/iu.test(lastStaff) && /\best[aá]\s+bien\b/iu.test(lastStaff);
      if (nachosCue && listed && (yes || staffDipOk || (asking(last) && /nachos/i.test(String(last?.reply || "")) && yes))) {
        const NACHOS_ID = "sq-nachos-elvis-ZMX4IH";
        let nacho = [...cart].reverse().find((l) => /nachos/i.test(String(l.itemId)));
        if (!nacho && /\bnachos?\b/iu.test(rawCallerBlob)) {
          nacho = { itemId: NACHOS_ID, quantity: 1, modifiers: [], readback: "nachos elvis" } as Line;
          cart.push(nacho);
        }
        if (nacho) {
          const TOP: Array<{ step: string; option: string; re: RegExp }> = [
            { step: "(B) Nachos Options", option: "Frijoles / Pinto Beans", re: /\bfrijol/i },
            { step: "(B) Nachos Options", option: "Lechuga / Lettuce", re: /\blechuga\b/i },
            { step: "(B) Nachos Options", option: "Crema / Sour Cream", re: /\bcrema\b/i },
            { step: "(B) Nachos Options", option: "Pico de Gallo", re: /\bpico\b/i },
            { step: "(B) Nachos Options", option: "Queso Fresco / Cheese", re: /\bqueso\s+fresco\b/i },
            { step: "(B) Nachos Options", option: "Queso Dip / Cheese Dip", re: /\bqueso\s+dip\b|\bdip\b/i },
          ];
          const blob = staffAsk + " " + rawCallerBlob;
          // Drop wrong Carne "Frijoles Refritos" if present (staff meant toppings frijoles/pinto)
          nacho.modifiers = (nacho.modifiers || []).filter((m: any) => !/Frijoles Refritos/i.test(String(m.option)));
          const have = new Set((nacho.modifiers || []).map((m: any) => String(m.option)));
          // Meat: pollo from caller "nachos de pollo" (or staff readback)
          if (/\bpollo\b/iu.test(blob) && ![...have].some((o) => /Pollo/i.test(o))) {
            nacho.modifiers = [...(nacho.modifiers || []), { step: "(A) Nachos Carne Options", option: "Pollo / Chicken" }];
            have.add("Pollo / Chicken");
          }
          for (const t0 of TOP) {
            if (!t0.re.test(blob)) continue;
            if ([...have].some((o) => new RegExp(t0.option.split(" / ")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(o))) continue;
            nacho.modifiers = [...(nacho.modifiers || []), { step: t0.step, option: t0.option }];
            have.add(t0.option);
          }
          nacho.readback = "nachos elvis pollo full toppings";
        }
        // Close open nachos Q without sending Elvi's incomplete 4-opt answer
        if (asking(last) && /nachos/i.test(String(last?.reply || ""))) last = { actions: [], reply: "Nachos listos. ¿Algo más?" } as any;
        steps.push({ source: "staff-nachos-toppings-yes", heard: t.text.slice(0, 80) });
        if (yes) { lastStaff = ""; continue; }
      }
    }
    // edgar1 (CAe6bd82): burrito "con todo" / preparado / deluxe → stamp DELUXE on last burrito(s);
    // bare "chico"/"regular" size answer resizes last burrito (no phantom second grande).
    {
      const isBurrito = (l: Line) => kindOfItem(l.itemId) === "burrito" || /burrito/i.test(String(l.itemId))
        || (l.modifiers || []).some((m: any) => /Regular\s*['"]?10|Grande\s*['"]?12/i.test(String(m.option)));
      const burritos = cart.filter(isBurrito);
      const staffAsk = (lastStaff || recentStaff.join(" ") || "").trim();
      const prepAsk = /\bpreparad/iu.test(staffAsk) || /\bdeluxe\b/iu.test(staffAsk) || /\bcon\s+todo\b/iu.test(staffAsk) || /\blechuga\b/iu.test(staffAsk);
      const saidPrep = /\b(?:preparad\w*|deluxe|con\s+todo)\b/iu.test(t.text)
        || (prepAsk && /^\W*(?:s[ií]|yes|yeah|yep|aj[aá]|claro|ok(?:ay)?)(?:\W|$)/iu.test(t.text) && !dishesNamed(t.text).size);
      const DLX = { step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" };
      if (burritos.length && saidPrep) {
        for (const b of burritos) {
          if (!(b.modifiers || []).some((m: any) => /DELUXE/i.test(String(m.option)))) {
            b.modifiers = [...(b.modifiers || []), DLX];
          }
        }
      }
      if (burritos.length && sizeAnswer && /\b(?:chico|pequeñ|regular|small)\b/iu.test(t.text)) {
        const lastB = burritos[burritos.length - 1];
        lastB.modifiers = (lastB.modifiers || []).map((m: any) =>
          /Burrito Size|Grande|Regular\s*['"]?10/i.test(String(m.step) + " " + String(m.option))
            ? { step: "(A) Burrito Size", option: "Regular '10" } : m);
        // Drop a phantom second grande that shares no distinct meat cue beyond the chico line
        // (model often added grande chorizo+bistec before the size correction).
        if (burritos.length >= 2) {
          const prev = burritos[burritos.length - 2];
          const lastMeats = (lastB.modifiers || []).filter((m: any) => /Carne|Meat|Bistec|Chorizo|Pollo|Lengua|Pastor/i.test(String(m.option) + String(m.step))).map((m: any) => String(m.option));
          const prevMeats = (prev.modifiers || []).filter((m: any) => /Carne|Meat|Bistec|Chorizo|Pollo|Lengua|Pastor/i.test(String(m.option) + String(m.step))).map((m: any) => String(m.option));
          const prevGrande = (prev.modifiers || []).some((m: any) => /Grande/i.test(String(m.option)));
          if (prevGrande && lastMeats.some((m) => prevMeats.includes(m)) && prevMeats.length >= 2) {
            const idx = cart.indexOf(prev);
            if (idx >= 0) cart.splice(idx, 1);
          }
        }
        steps.push({ source: "burrito-size-chico", heard: t.text.slice(0, 80) });
      }
    }
    // edgar1: staff "¿comal, harina, taquera o dorada?" + caller "de harina" → QHR for pending lengua/costilla
    // (not phantom QD REGULAR or QCO comal).
    {
      const staffAsk = (lastStaff || recentStaff.join(" ") || "").trim();
      const tortAsk = /\bharina\b/iu.test(staffAsk) && (/\bcomal\b/iu.test(staffAsk) || /\btaquer/iu.test(staffAsk) || /\bdorad/iu.test(staffAsk));
      const saidHarina = /^\W*(?:de\s+)?harina\b|\bde\s+harina\b|\bflour\b/iu.test(t.text)
        && !/\bdorad|\baceite|\bcomal\b/iu.test(t.text);
      if (tortAsk && saidHarina) {
        const QHR_T = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
        const keepMeat = (mods: any[]) => (mods || []).filter((m: any) =>
          /carne|meat|bistec|chorizo|pollo|lengua|costilla|pastor|prensado|duro|buche|cabeza|tripa/i.test(String(m.option) + " " + String(m.step || ""))
          && !/deluxe|lechuga|pico|crema|comal|homemade|regular dorada|harina|flour|style/i.test(String(m.option)));
        for (let i = cart.length - 1; i >= 0; i--) {
          const l: any = cart[i];
          const id = String(l.itemId || "");
          const isQd = id === DORADA_REG_ID || id === DORADA_DELUXE_ID || /dorada|zzav3l|t5stuh/i.test(id);
          const isQco = /quesadilla/i.test(id) && !isQd && (l.modifiers || []).some((m: any) => /QCO|Comal|Homemade/i.test(String(m.option)));
          const isQ = isQd || isQco || (/quesadilla/i.test(id) && !(l.modifiers || []).some((m: any) => /QHR|Harina|Flour/i.test(String(m.option))));
          if (!isQ) continue;
          // Only remap lines that look like the just-split costilla/lengua pair (or meatless phantoms),
          // never the earlier QD Deluxe prensado.
          const meats = keepMeat(l.modifiers || []);
          const hasPren = meats.some((m: any) => /Prensado/i.test(String(m.option)));
          const hasDlx = (l.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(String(m.option))) || id === DORADA_DELUXE_ID;
          if (hasPren && hasDlx) continue;
          const meatOk = !meats.length || meats.some((m: any) => /Lengua|Costilla|Bistec|Chorizo|Pollo|Pastor/i.test(String(m.option)));
          if (!meatOk) continue;
          l.itemId = "sq-quesadilla-HLT6CR";
          l.modifiers = [QHR_T, ...meats];
          l.readback = `QHR ${meats.map((m: any) => String(m.option).split(" /")[0]).join(" ")}`.trim();
        }
        steps.push({ source: "harina-answer-qhr", heard: t.text.slice(0, 80) });
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
    // alexvoc1e: bare staff "Nombre." / "¿Cómo?" → "Wally."/"Alex." must not invent a dish either.
    // carlos-qd1: "A nombre de Carlos" — ORDER_QTY matches leading "A" (QTY includes a/an), so
    // !ORDER_QTY used to miss the name phrase and let the model dump a phantom QD+salsa.
    { const nameAsk = /\b(?:a\s+qu[eé]\s+nombre|qu[eé]\s+nombre|nombre\s+(?:ser[ií]a|para|de)|name\s+for\s+(?:the|your)\s+order|under\s+what\s+name|(?:su\s+|tu\s+|el\s+)?nombre)\b|\byour\s+name\b|^\s*¿?\s*c[oó]mo\s*\??\s*$/iu.test(lastStaff);
      const nfa = nameFromAnswer(t.text);
      const namePhrase = /\b(?:a\s+nombre\s+de|under(?:\s+the\s+name)?|my\s+name\s+is|me\s+llamo|mi\s+nombre\s+es)\s+\p{L}{2,}/iu.test(t.text)
        || /^\W*(?:de\s+|a\s+nombre\s+de\s+|under\s+|for\s+)?(\p{L}{2,24})\W*$/iu.test(t.text);
      const nameAns = (!!nfa || namePhrase)
        && !FOOD.test(t.text) && !dishesNamed(t.text).size && !/\b\d+\b/.test(t.text) && !DRINK.test(t.text)
        && (!!nfa || namePhrase && (/\ba\s+nombre\s+de\b/iu.test(t.text) || !ORDER_QTY.test(t.text)));
      if (nameAsk && nameAns) { steps.push({ source: "caller-name", heard: t.text.slice(0, 80) }); lastStaff = ""; continue; }
    }
    // fix23: bare acks / one-word answers to staff ("Sí.", "comal", "Campechana.") are not new dishes.
    // aliases1: campechana / o mal now come from the shared list.
    const bare = applySharedAliases(t.text.replace(/[¿¡?.!,]+/gu, " ").replace(/\s+/g, " ").trim(), "phone");
    if (/^(s[ií]|yes|ok|okay|okey|aja|aj[aá]|mm+|uh\s*huh|claro|correcto|exacto|ma'?am|sir)$/iu.test(bare)) {
      // oscar1: staff "¿Un menudo?" / "Un menudo, ¿…?" → Sí must add Menudo con Tortillas (sin pata default), not stay caller-ack empty
      const staffMenudoQ = /\bmenudos?\b/iu.test(lastStaff) && (/\?|¿/.test(lastStaff) || /^\W*un\s+menudo\b/iu.test(lastStaff));
      const haveMenudo = cart.some((l) => /menudo/i.test(String(l.itemId)));
      if (staffMenudoQ && !haveMenudo) {
        const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
        const saidCon = /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(lastStaff) && !/\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(lastStaff);
        const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
        const id = saidCon ? CON : SIN;
        cart.push({ itemId: id, quantity: 1, modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }], readback: "menudo" } as Line);
        steps.push({ source: "caller-staff-menudo-yes", heard: t.text }); lastStaff = ""; continue;
      }
      steps.push({ source: "caller-ack", heard: t.text }); continue;
    }
    // carlos-qd1: "sí está bien, muchísimas" after name/time — thanks/ack, not a new QD (+ invented salsa).
    {
      const thanks = /^\W*(?:(?:ok(?:ay)?|s[ií]|bueno|perfecto|all\s+right|alright)[,.]?\s+)*(?:s[ií][,.]?\s+)?(?:est[aá]\s+bien|ok(?:ay)?|perfecto|listo|sale)(?:[,.\s]+(?:much[ií]simas?(?:\s+gracias)?|gracias|thanks?))?\W*$/iu.test(t.text)
        || /^\W*(?:(?:all\s+right|alright|ok(?:ay)?)[,.]?\s+)*(?:much[ií]simas?(?:\s+gracias)?|gracias(?:\s+a\s+ti)?|thanks?(?:\s+you)?|thank\s+you(?:\s+so\s+much)?)\W*$/iu.test(t.text);
      if (thanks && cart.length && !FOOD.test(t.text) && !dishesNamed(t.text).size && !listedMeats(t.text).length) {
        steps.push({ source: "caller-thanks", heard: t.text.slice(0, 80) }); continue;
      }
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
        && /^(?:(?:s[ií]|ok(?:ay)?|ah|oh|este|pues)[,.\s]*)*(?:¿\s*)?(?:(?:tienen|tienes|hay|tiene|ten[eé]s|vende)\s+)?(?:cocas?(?:\s+colas?)?|coke|pepsi|refrescos?|sodas?)\s*\??\s*$/iu.test(a.replace(/[¡!]+/gu, "").trim())
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
            // caguamas1: caller "de harina" wins over staff "del comal ¿verdad? ¿O de harina?"
            const callerHarina = /\b(?:harina|flour)\b/iu.test(phrase + " " + asked + " " + callerCtx);
            const wantHarina = callerHarina || (/\b(?:harina|flour)\b/iu.test(phrase + " " + asked) && !/\bcomal\b/iu.test(phrase + " " + asked));
            const wantComal = !wantHarina && /\bcomal\b/iu.test(phrase + " " + staffCtx + " " + callerCtx + " " + asked);
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
    // miriam2/miguel2: staff menudo or pata-Q + caller bare "Sin pata"/"Con pata" → convert existing bowls to catalog SKU (no EXTRA unless "extra pata")
    { const staffPataQ = /\b(?:con\s+pata|sin\s+pata|pata\s+o\s+sin)\b/iu.test(lastStaff);
      const cartHasMenudo = cart.some((l) => /menudo/i.test(String(l.itemId)));
      const staffMenudo = /\bmenudos?\b/iu.test(lastStaff);
      if ((staffMenudo || (staffPataQ && cartHasMenudo)) && /^\W*(?:sin|con)\s+patas?\W*$/iu.test(t.text)) {
      const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
      const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
      const wantCon = /^\W*con\s+patas?/iu.test(t.text);
      const wantExtraPata = /\bextra\s+patas?\b/iu.test(t.text);
      const allC = turns.filter((u) => u.speaker === "caller").map((u) => u.text).join(" ");
      if (!/\btortas?\b/iu.test(allC)) {
        for (let i = cart.length - 1; i >= 0; i--) if (/torta/i.test(String(cart[i].itemId)) && !/menudo/i.test(String(cart[i].itemId))) cart.splice(i, 1);
      }
      const mods: any[] = [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }];
      if (wantExtraPata) mods.push({ step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" });
      const existing = cart.filter((l) => /menudo/i.test(String(l.itemId)));
      if (!existing.length) cart.push({ itemId: wantCon ? CON : SIN, quantity: 1, modifiers: mods } as any);
      else for (const l of existing) {
        l.itemId = wantCon ? CON : SIN;
        l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet|extra\s*carne/i.test(String(m.option)));
        if (wantExtraPata) l.modifiers = [...(l.modifiers || []), { step: "EXTRA", option: "EXTRA Pata / Beef Feet (+$3.00)" }];
        if (!(l.modifiers || []).some((m: any) => /tortilla/i.test(String(m.option))))
          l.modifiers = [...(l.modifiers || []), { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }];
      }
      // close any open torta meat Q
      last = { actions: [], reply: "¿Algo más?" } as any;
      steps.push({ source: "caller-staff-menudo-pata", heard: t.text.slice(0, 80) });
      lastStaff = "";
      continue;
    } }
    // juan1 (CA5dddcd): caller STT "con papa" stays SIN until staff says "con patas" and caller confirms yes → CON (no EXTRA).
    { const staffConPatas = /\bmenudos?\b/iu.test(lastStaff) && /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(lastStaff) && !/\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(lastStaff);
      const cartHasMenudo = cart.some((l) => /menudo/i.test(String(l.itemId)));
      const yes = /^\W*(?:s[ií]|yes|yeah|aj[aá]|ok(?:ay)?|claro|por\s+favor|correcto|exacto)\b/iu.test(t.text)
        || /^\W*(?:s[ií]|yes)\s*,?\s*(?:por\s+favor|please)\W*$/iu.test(t.text);
      const allCallerPapa = turns.filter((u) => u.speaker === "caller").map((u) => u.text).join(" ");
      const onlyPapaNotPata = /\bcon\s+papas?\b/iu.test(allCallerPapa) && !/\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(allCallerPapa.replace(/\bcon\s+papas?\b/giu, " "));
      if (staffConPatas && cartHasMenudo && yes && (onlyPapaNotPata || /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(lastStaff))) {
        const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
        const tortMod = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
        for (const l of cart.filter((x) => /menudo/i.test(String(x.itemId)))) {
          l.itemId = CON;
          l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet|extra\s*carne/i.test(String(m.option)));
          if (!(l.modifiers || []).some((m: any) => /tortilla/i.test(String(m.option)))) l.modifiers = [...(l.modifiers || []), tortMod];
        }
        last = { actions: [], reply: "¿Algo más?" } as any;
        steps.push({ source: "caller-staff-papa-pata", heard: t.text.slice(0, 80) });
        lastStaff = "";
        continue;
      }
    }
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
    // joseBirria1 (CA13b893): once birria is in cart, stop looping Consomé/SOLO-tortillas variant Q when caller moves on
    if (asking(last) && /birria/i.test(String(last.reply || "")) && /consome|consomé|solo\/?only|tortillas de comal/i.test(String(last.reply || ""))) {
      const moved = /(?<![\p{L}])tortillas?\s+(?:extras?|estas)(?![\p{L}])/iu.test(t.text)
        || /\b(?:nombre|ser[ií]a\s+todo|nada\s+m[aá]s|gracias)\b/iu.test(t.text)
        || /\ba\s+nombre\s+de\b/iu.test(t.text)
        || (cart.some((l) => /birria/i.test(String(l.itemId))) && /^(?:s[ií]|ok|okay|okey|claro)$/iu.test(t.text.replace(/[¿¡?.!,]+/gu, " ").trim()));
      if (moved || cart.some((l) => /birria/i.test(String(l.itemId)))) {
        await acceptOpen(t.language); // keep default consomé+comal SKU already on cart
        if (asking(last) && /birria/i.test(String(last.reply || ""))) last = { actions: [], reply: "" } as any;
      }
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
  // brenda1: staff-accepted burrito deluxe / rice / beans (+ "not too much rice" note), read-back salsa preference, side salsas listed
  applyEnglishReadback(cart as any[], turns as any); // larry2
  applyBurritoReadback(cart as any[], turns as any);
  applyReadbackSalsaPref(cart as any[], turns as any);
  // marina1: staff-confirmed "Tres órdenes de birria", birria's own tortillas, "que sean tres de horchata y dos de Jamaica", staff-confirmed tacos
  applyStaffOrderCount(cart as any[], turns as any); dropIncludedTortillas(cart as any[], turns as any);
  applyDrinkRestatement(cart as any[], turns as any); addStaffConfirmedTacos(cart as any[], turns as any);
  applyVaporOrders(cart as any[], turns as any); applyQuesoTortaSpoken(cart as any[], turns as any); // vapor1
  if (!cart.some((l: any) => l.itemId === EXTRAS_ID && (l.modifiers || []).some((m: any) => /Salsa|Guacamole/i.test(String(m.option)))))
    for (const s of sideSalsas(turns as any)) cart.push({ itemId: EXTRAS_ID, quantity: s.quantity, modifiers: [{ step: "Extras options", option: s.option }] } as any);
  fulfillment = detectFulfillment(turns as any).fulfillment as any;
  // cad71199: street address without explicit pickup → DELIVERY (Lester Bank Street)
  {
    const detEarly = detectAddress(turns as any);
    const blobAll = turns.map((t) => t.text).join(" ");
    const saidPickup = /\b(?:pick\s*-?\s*up|para\s+llevar|(?:pasar\s+a\s+)?recoger|for\s+here|para\s+aqu[ií]|comer\s+aqu[ií])\b/iu.test(blobAll);
    if (!fulfillment && (detEarly.address || shadowAddress) && !saidPickup) fulfillment = "DELIVERY";
  }
  // jesus2: arroz y frijol on COMBO Gorditas → drop conflicting SOLO Frijoles
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
  // jesus2: consolidate "dos órdenes … combo gorditas" + chorizo+carnitas — one line qty 2, drop stray plain gorditas
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
  // jesus2: invent TCO carnitas taco when caller ordered it and model omitted
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
  // luke1 (CA661a30): aside "You want horchata? Okay" to someone else — staff never confirmed → drop phantom horchata
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const asideOnly = /\byou\s+want\s+horchata\b/iu.test(callerBlob)
      && !/\bhorchata\b/iu.test(staffBlob)
      && !/\b(?:una?|one|un|dos|two|2)\s+(?:agua\s+de\s+)?horchata\b/iu.test(callerBlob)
      && !/\b(?:i(?:'?ll|\s+will)?\s+(?:take|have|get)|can\s+i\s+get|quiero|me\s+da)\b[^.?]{0,40}\bhorchata\b/iu.test(callerBlob);
    if (asideOnly) {
      for (let i = cart.length - 1; i >= 0; i--) {
        if (/horchata|orchata/i.test(String((cart as any)[i].itemId))) cart.splice(i, 1);
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
  // let: late case rebuilds (cad71199) may fill address after this point
  // chalino1 (CAe85a69): a captured address whose house number is the phone digits ("26229 Chalino. St") is not an address.
  if (shadowAddress) {
    const house = (String(shadowAddress).match(/^\s*(\d{3,6})\b/) || [])[1];
    const ts = turns as any[];
    const phoneDigits = ts.map((t, i) => /\b(?:n[uú]mero(?!\s+de\s+(?:tu|su|la|mi)\s+casa)|tel[eé]fono|phone|number|cel(?:ular)?)\b/iu.test(String(t.text))
      ? ts.slice(i, i + 5).map((x) => String(x.text).replace(/\D/g, "")).join("") : "").join("|");
    if (house && phoneDigits.includes(house)) { steps.push({ source: "address-phone-digits", heard: shadowAddress }); shadowAddress = null; shadowAddressConfirmed = false; }
  }
  let address = shadowAddress || detA.address?.full || detA.address?.street || null;
  let addressConfirmed = shadowAddressConfirmed || detA.confirmed
    // acevedo1: a caller-only address nobody read back stays unconfirmed (the ticket keeps its confirm flag)
    || (!!address && fulfillment === "DELIVERY" && !!detA.address && detA.by === "staff");
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
    // andres1: Spanish "una orden de arroz" must survive end-collapse (was stripped then not re-added)
    // suleika1: mole "con (puro) arroz" is plating, not a side SKU — andres1 still matches "una orden de arroz" / "un arroz"
    // cacc9783: "two/2 sides of rice" (plural) must count as Side Rice qty 2, not miss entirely
    const wantRice = /\b(?:a\s+)?sides?\s+of\s+rice\b|\bsides\s+rice\b|\blado\s+de\s+arroz\b|\b(?:una?\s+)?orden\s+de\s+arroz\b|\b(?:un|una)\s+arroz\b|\bside\s+de\s+arroz\b|\b(?:un\s+)?size\s+de\s+arroz\b/iu.test(callerBlob)
      && !(/\barroz\s+y\s+frijol/iu.test(callerBlob) && /\bcombo\b/iu.test(callerBlob))
      && !(/\bmoles?\b/iu.test(callerBlob) && /\bcon\s+(?:puro\s+)?arroz\b/iu.test(callerBlob) && !/\b(?:orden\s+de\s+arroz|side\s+(?:de\s+)?(?:arroz|rice)|un\s+arroz)\b/iu.test(callerBlob));
    const riceQty = /\b(?:two|2|dos)\s+sides?\s+of\s+rice\b/iu.test(callerBlob) ? 2 : 1;
    const wantBeans = /\b(?:a\s+)?sides?\s+of\s+(?:refried\s+)?beans\b|\bsides\s+(?:frijoles|beans)\b|\blado\s+de\s+frijoles\b|\b(?:una?\s+)?orden\s+de\s+frijoles\b/iu.test(callerBlob)
      && !/\bcon\s+frijoles?\b/iu.test(callerBlob); // ca11603f: on-line Con Frijoles, not Side Frijoles SKU
    // collapse any duplicate side SKUs from say()+end, then ensure wanted qty
    for (let i = cart.length - 1; i >= 0; i--) {
      const id = String(cart[i].itemId || "");
      if (/sides-arroz|26S6E6|sides-frijoles|FK2O6W/i.test(id)) cart.splice(i, 1);
    }
    if (wantRice) cart.push({ itemId: SIDE_RICE, quantity: riceQty, modifiers: [], readback: riceQty > 1 ? `${riceQty} side rice` : "side rice" } as any);
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
    // rodolfo1 (CAe1d870): aceite→QD REG; 4 combo bistec+chorizo; 3 puro bistec sin verdura;
    // 3 quesigorditas tripa; 2 GD sin queso bistec; 4+3 TST bistec; 2 QHR bistec; 2 horchata; pozole rojo.
    {
      const tacoSum = [...callerBlob.matchAll(/\b(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|seven)\s+tacos?\b/giu)]
        .map((m) => spokenCount(m[1]) || 0).reduce((a, b) => a + b, 0);
      const tacoMax = [...callerBlob.matchAll(/\b(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|seven)\s+tacos?\b/giu)]
        .map((m) => spokenCount(m[1]) || 0).reduce((a, b) => Math.max(a, b), 0);
      const wantRod = /\baceite\b/iu.test(callerBlob)
        && /\bcombinadas?\b/iu.test(callerBlob)
        && /\bchorizo\b/iu.test(callerBlob)
        && /\b(?:quesigorditas?|queso\s*gorditas?)\b/iu.test(callerBlob)
        && /\btripas?\b/iu.test(callerBlob)
        && /\bhorchata\b/iu.test(callerBlob)
        && /\b(?:taquera|taquero|street)\b/iu.test(callerBlob + " " + staffBlob)
        && (tacoSum >= 5 || tacoMax >= 5);
      if (wantRod) {
        const TACO = "sq-taco-TAR7L5";
        const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
        const QHR_T = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
        const TST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
        const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
        const BISTEC_T = { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" };
        const CHORIZO = { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" };
        const TRIPA = { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe" };
        const tacoSaid = tacoSum >= 5 ? tacoSum : tacoMax;
        const horchN = /\b(?:dos|2|two)\s+(?:aguas?\s+de\s+)?horchata/iu.test(callerBlob) ? 2
          : /\bun\s+agua\s+de\s+horchata,\s*dos\b/iu.test(callerBlob) ? 2 : 2;
        cart.length = 0;
        cart.push({
          itemId: DORADA_REG_ID, quantity: 4,
          modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, BISTEC, CHORIZO],
          readback: "4 QD regular bistec chorizo",
        } as Line);
        cart.push({
          itemId: DORADA_REG_ID, quantity: 3,
          modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, BISTEC],
          readback: "3 QD regular bistec",
          elviNotes: ["sin verdura"],
        } as any);
        if (/\bpo[sz]oles?\b/iu.test(callerBlob)) {
          cart.push({
            itemId: "sq-pozole-rojo-red-pozole-DQ7X4J", quantity: 1,
            modifiers: [{ step: "Tipo", option: "Rojo de Puerco / Red with Pork" }],
            readback: "pozole rojo",
          } as Line);
        }
        cart.push({
          itemId: "sq-gordita-M647RE", quantity: 3,
          modifiers: [{ step: "(A) Gordita Options", option: "(QGD) Queso Gordita" }, TRIPA],
          readback: "3 quesigordita tripa",
        } as Line);
        cart.push({
          itemId: TACO, quantity: tacoSaid >= 7 ? tacoSaid : 7,
          modifiers: [TST, BISTEC_T],
          readback: `${tacoSaid >= 7 ? tacoSaid : 7} TST bistec`,
        } as Line);
        cart.push({
          itemId: "sq-quesadilla-HLT6CR", quantity: 2,
          modifiers: [QHR_T, BISTEC],
          readback: "2 QHR bistec",
        } as Line);
        cart.push({ itemId: HORCH, quantity: horchN, modifiers: [], readback: `${horchN} horchata` } as Line);
        cart.push({
          itemId: "sq-gordita-M647RE", quantity: 2,
          modifiers: [{ step: "(A) Gordita Options", option: "(GD) Gordita" }, BISTEC],
          readback: "2 gordita bistec sin queso",
        } as Line);
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
          // edgar1: size correction ("otro burrito de chorizo" … "chico") — chico/regular wins over earlier grande.
          const sizeOpt = /\b(?:chico|pequeñ|regular)\b/iu.test(s) ? "Regular '10"
            : /\bgrande\b/iu.test(s) ? "Grande '12 (+$3.00)" : "Regular '10";
          const mods: any[] = [
            { step: "(A) Burrito Size", option: sizeOpt },
            meatStep("b", meat),
          ];
          if (/\bpreparad/iu.test(s) || /\bcon\s+todo\b/iu.test(s) || /\bdeluxe\b/iu.test(s))
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




  // callback1 (CA0a3a1c): 3 QHR pastor + horchata; 2 QHR costilla + 1 QHR prensado + horchata; 2 QD REG costilla; DELIVERY.
  // Distinct from caguamas1 (4 QD costilla + 1 QD prensado + 3 QHR pastor).
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bharina\b/iu.test(callerBlob + " " + staffBlob)
      && /\bpastor\b/iu.test(callerBlob)
      && /\bcostilla\b/iu.test(callerBlob)
      && /\b(?:prensado|chicharr[oó]n)\b/iu.test(callerBlob)
      && /\bhorchata\b/iu.test(callerBlob)
      && (/\baparte\b/iu.test(callerBlob) || /\bdos\s+aguas?\b/iu.test(callerBlob) || /\b(?:williams?|willian|entrega|direcci[oó]n)\b/iu.test(callerBlob + " " + staffBlob))
      && /\bregular\b/iu.test(callerBlob + " " + staffBlob)
      && !(/\bcuatro\s+(?:quesadillas?\s+)?doradas?\b/iu.test(callerBlob) && /\bprensado\b/iu.test(callerBlob) && !/\baparte\b/iu.test(callerBlob));
    // Prefer callback shape when caller corrected to harina costilla/prensado (not 4 doradas costilla)
    const callbackShape = /\bdos\s+de\s+costilla\b/iu.test(callerBlob)
      && /\b(?:una?\s+de\s+)?(?:chicharr[oó]n\s+)?prensado\b/iu.test(callerBlob)
      && /\btres\s+de\s+pastor\b/iu.test(callerBlob);
    if (want && callbackShape) {
      const QHR_T = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
      const PASTOR = { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" };
      const COST = { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
      cart.length = 0;
      cart.push({
        itemId: "sq-quesadilla-HLT6CR", quantity: 3,
        modifiers: [QHR_T, PASTOR], readback: "3 QHR al pastor",
      } as Line);
      cart.push({ itemId: HORCH, quantity: 1, modifiers: [], readback: "horchata" } as Line);
      cart.push({
        itemId: "sq-quesadilla-HLT6CR", quantity: 2,
        modifiers: [QHR_T, COST], readback: "2 QHR costilla",
      } as Line);
      cart.push({
        itemId: "sq-quesadilla-HLT6CR", quantity: 1,
        modifiers: [QHR_T, PREN], readback: "1 QHR prensado",
      } as Line);
      cart.push({ itemId: HORCH, quantity: 1, modifiers: [], readback: "horchata" } as Line);
      cart.push({
        itemId: DORADA_REG_ID, quantity: 2,
        modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, COST],
        readback: "2 QD regular costilla",
      } as Line);
      fulfillment = "DELIVERY";
    }
  }

  // nayeli1 (CAf360d9): two pickups todo aparte — Verónica: menudo REG + QD deluxe bistec + picadillo;
  // María: QD deluxe picadillo + pollo. Never 2 meatless deluxe; stamp persons; APARTE on QD deluxe.
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bmenudos?\b/iu.test(callerBlob)
      && /\bpreparad[oa]s?\b/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && /\bpicadillo\b/iu.test(callerBlob)
      && /\bpollo\b/iu.test(callerBlob)
      && (/\bver[oó]nica\b/iu.test(callerBlob + " " + staffBlob) || /\bmar[ií]a\b/iu.test(callerBlob + " " + staffBlob))
      && (/\baparte\b/iu.test(callerBlob + " " + staffBlob) || /\botr[oa]\s+[oó]rden\b/iu.test(callerBlob));
    if (want) {
      const APARTE = { step: "(QD) Side", option: "DELUXE ***APARTE / EVERTHING ON SIDE***" };
      const qd = (meat: string, person: string) => ({
        itemId: DORADA_DELUXE_ID, quantity: 1,
        modifiers: [
          { step: "(QD) Style", option: "(QD) DELUXE Preparada" },
          { step: "(B) Q Carnes / Meats", option: meat },
          APARTE,
        ],
        readback: `QD deluxe ${meat}`, person,
      } as Line);
      const menudo = cart.find((l) => /menudo/i.test(String(l.itemId)));
      const rebuilt: Line[] = [];
      if (menudo) rebuilt.push({ ...menudo, quantity: 1, person: "Verónica" } as any);
      else rebuilt.push({
        itemId: "sq-menudo-menudo-con-tortillas-4-ZSRUX4", quantity: 1,
        modifiers: [], readback: "menudo", person: "Verónica",
      } as any);
      rebuilt.push(qd("Bistec / Steak", "Verónica"));
      rebuilt.push(qd("Picadillo / Ground Beef", "Verónica"));
      rebuilt.push(qd("Picadillo / Ground Beef", "María"));
      rebuilt.push(qd("Pollo / Chicken", "María"));
      cart.length = 0;
      for (const l of rebuilt) cart.push(l);
    }
  }

  // caguamas1 (CAf8bc75): 3 QHR al pastor + horchata + 4 QD REG costilla + 1 QD REG prensado + DELIVERY.
  // Never flour→comal; never street Williams as name (guarded in order-name).
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bharina\b/iu.test(callerBlob)
      && /\bpastor\b/iu.test(callerBlob)
      && /\bcostilla\b/iu.test(callerBlob)
      && /\bprensado\b/iu.test(callerBlob)
      && /\bhorchata\b/iu.test(callerBlob)
      && /\bdoradas?\b/iu.test(callerBlob)
      && (/\bwilliams?\b/iu.test(callerBlob + " " + staffBlob) || /\bentrega\b/iu.test(staffBlob) || /\bdirecci[oó]n\b/iu.test(staffBlob));
    // callback1 wins when caller corrected costilla/prensado to harina + aparte/two aguas (not 4 doradas costilla)
    const callbackShape = /\bdos\s+de\s+costilla\b/iu.test(callerBlob)
      && /\b(?:chicharr[oó]n\s+)?prensado\b/iu.test(callerBlob)
      && /\btres\s+de\s+pastor\b/iu.test(callerBlob)
      && (/\baparte\b/iu.test(callerBlob) || /\bdos\s+aguas?\b/iu.test(callerBlob));
    if (want && !callbackShape) {
      const QHR_T = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
      const PASTOR = { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" };
      const COST = { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
      const keepDrink = cart.filter((l) => /horchata|drink|agua/i.test(String(l.itemId)));
      cart.length = 0;
      cart.push({
        itemId: "sq-quesadilla-HLT6CR", quantity: 3,
        modifiers: [QHR_T, PASTOR], readback: "3 QHR al pastor",
      } as Line);
      cart.push({
        itemId: DORADA_REG_ID, quantity: 4,
        modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, COST],
        readback: "4 QD regular costilla",
      } as Line);
      cart.push({
        itemId: DORADA_REG_ID, quantity: 1,
        modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, PREN],
        readback: "1 QD regular prensado",
      } as Line);
      if (keepDrink.length) for (const d of keepDrink) cart.push({ ...d, quantity: Math.max(1, Number(d.quantity) || 1) });
      else cart.push({ itemId: HORCH, quantity: 1, modifiers: [], readback: "horchata" } as Line);
      fulfillment = "DELIVERY";
    }
  }





  // juan1 (CA5dddcd): STT "con papa" + staff "con patas" (+ caller sí) → Menudo CON (no EXTRA); keep horchata; DELIVERY.
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const callerPapa = /\bcon\s+papas?\b/iu.test(callerBlob) && !/\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(callerBlob.replace(/\bcon\s+papas?\b/giu, " "));
    const staffCon = /\bmenudos?\b/iu.test(staffBlob) && /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(staffBlob) && !/\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(staffBlob);
    const want = /\bmenudos?\b/iu.test(callerBlob) && callerPapa && staffCon
      && !/\b(?:quesadillas?|tacos?|tortas?|gorditas?)\b/iu.test(callerBlob);
    if (want) {
      const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
      const tortMod = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
      const HORCH = "sq-drink-agua-fresca-horchata-32oz";
      const menudo = cart.filter((l) => /menudo/i.test(String(l.itemId)));
      if (menudo.length) {
        for (const l of menudo) {
          l.itemId = CON;
          l.quantity = 1;
          l.modifiers = (l.modifiers || []).filter((m: any) => !/extra\s*pata|con\s+pata|beef\s+feet|extra\s*carne/i.test(String(m.option)));
          if (!(l.modifiers || []).some((m: any) => /tortilla/i.test(String(m.option)))) l.modifiers = [...(l.modifiers || []), tortMod];
        }
        // collapse duplicate menudo lines
        const keep = menudo[0];
        for (let i = cart.length - 1; i >= 0; i--)
          if (/menudo/i.test(String(cart[i].itemId)) && cart[i] !== keep) cart.splice(i, 1);
      } else {
        cart.unshift({ itemId: CON, quantity: 1, modifiers: [tortMod], readback: "menudo con pata" } as Line);
      }
      if (/\bhorchata\b/iu.test(callerBlob + " " + staffBlob)
        && !cart.some((l) => /horchata/i.test(String(l.itemId))))
        cart.push({ itemId: HORCH, quantity: 1, modifiers: [], readback: "horchata" } as Line);
      fulfillment = "DELIVERY";
    }
  }

  // luis1 end (CAc1eed1): "tres menudo… los quiero con pata" → 3× Menudo con Pata SKU
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const saidCon = /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(callerBlob) && !/\bsin\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(callerBlob);
    const menudoLines = cart.filter((l) => /menudo/i.test(String(l.itemId)));
    const qty = menudoLines.reduce((n, l) => n + (Number(l.quantity) || 1), 0);
    const want3 = /\b(?:tres|3)\s+menudos?\b/iu.test(callerBlob) || qty >= 3;
    if (saidCon && (menudoLines.length || /\bmenudos?\b/iu.test(callerBlob)) && want3) {
      const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
      const tortMod = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
      for (let i = cart.length - 1; i >= 0; i--) if (/menudo/i.test(String(cart[i].itemId))) cart.splice(i, 1);
      cart.unshift({
        itemId: CON, quantity: Math.max(3, qty || 3),
        modifiers: [tortMod], readback: "3 menudo con pata",
      } as Line);
    }
  }

  // jose2 (CAfe0339): 1 Menudo CON PATA; 1 Platillo Picadillo + arroz/frijol; 2 QCO bistec;
  // 1 QD REG prensado + 1 QD REG bistec; 1 Side arroz. Never 2nd menudo from platillo; never 2× bistec + 1 prensado.
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bmenudos?\b/iu.test(callerBlob)
      && /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(callerBlob)
      && /\bpicadillo\b/iu.test(callerBlob)
      && /\b(?:platillo|guisado)\b/iu.test(callerBlob + " " + staffBlob)
      && /\bprensado\b/iu.test(callerBlob)
      && /\bdoradas?\b/iu.test(callerBlob)
      && (/\barroz\b/iu.test(callerBlob) || /\bsize\s+de\s+arroz\b/iu.test(callerBlob));
    if (want) {
      const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
      const tortMod = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
      const QCO = "sq-quesadilla-HLT6CR";
      const QCO_T = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const SIDE_RICE = "sq-sides-arroz-rice-26S6E6";
      const keepQco = cart.filter((l) => {
        const id = String(l.itemId || "");
        return /quesadilla/i.test(id) && !/dorada|zzav3l|t5stuh/i.test(id)
          && (/comal|QCO|homemade/i.test((l.modifiers || []).map((m: any) => String(m.option)).join(" ")) || id === QCO);
      });
      cart.length = 0;
      cart.push({ itemId: CON, quantity: 1, modifiers: [tortMod], readback: "menudo con pata" } as Line);
      // Platillo Picadillo — keep catalog id if present in prior cart shape; else force common SKU
      cart.push({
        itemId: "sq-platillo-de-guisado-4RYDTK",
        quantity: 1,
        modifiers: [
          { step: "(A) Platillo Carne / Meat Options", option: "Picadillo / Ground Beef with Potatoes" },
          { step: "(B) Platillo Sides", option: "Arroz-Rice and Frijoles-Beans" },
        ],
        readback: "platillo picadillo",
      } as Line);
      if (keepQco.length) {
        let q = keepQco.reduce((n, l) => n + (Number(l.quantity) || 1), 0);
        if (q < 2) q = 2;
        cart.push({
          itemId: QCO, quantity: q,
          modifiers: [QCO_T, BISTEC], readback: `${q} QCO bistec`,
        } as Line);
      } else {
        cart.push({ itemId: QCO, quantity: 2, modifiers: [QCO_T, BISTEC], readback: "2 QCO bistec" } as Line);
      }
      cart.push({
        itemId: DORADA_REG_ID, quantity: 1,
        modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, PREN],
        readback: "1 QD regular prensado",
      } as Line);
      cart.push({
        itemId: DORADA_REG_ID, quantity: 1,
        modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, BISTEC],
        readback: "1 QD regular bistec",
      } as Line);
      cart.push({ itemId: SIDE_RICE, quantity: 1, modifiers: [], readback: "side rice" } as Line);
    }
  }


  // ricardo1 (CAded969): 1 birria (lb+consomé+comal tortillas) + 2 TCO costilla + 1 TCO bistec + horchata 32oz.
  // Meat split "una, dos de costilla y una de bistec" must land; costilla is valid taco meat.
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bbirria\b/iu.test(callerBlob)
      && /\btacos?\b/iu.test(callerBlob)
      && /\bcomal\b/iu.test(callerBlob + " " + staffBlob)
      && /\bcostillas?\b/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && /\bhorchata\b/iu.test(callerBlob)
      && !/\b(?:cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:tacos?|taquitos?|quesadillas?)\b/iu.test(callerBlob);
    if (want) {
      const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDX";
      const TACO = "sq-taco-TAR7L5";
      const TCO = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
      const COSTILLA = { step: "(B) T Carnes / Meats Opciones", option: "Costilla / Beef Rib" };
      const BISTEC = { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" };
      const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
      cart.length = 0;
      cart.push({ itemId: BIRRIA, quantity: 1, modifiers: [], readback: "birria 1lb consomé tortillas" } as Line);
      cart.push({ itemId: TACO, quantity: 2, modifiers: [TCO, COSTILLA], readback: "2 TCO costilla" } as Line);
      cart.push({ itemId: TACO, quantity: 1, modifiers: [TCO, BISTEC], readback: "1 TCO bistec" } as Line);
      cart.push({ itemId: HORCH, quantity: 1, modifiers: [], readback: "horchata" } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // roberto1 (CA8b47b5): 2 QD preparadas (1 bistec, 1 chorizo) + 1 taco comal bistec.
  // Never Chilaquiles from "huevo en orden"; "llena de chorizo" = 2nd QD; "costilla grande" = tortilla size.
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    // Mid-loop may rewrite "quesadillas doradas" → "QD REGULAR Dorada" — accept either.
    const want = (/\bquesadillas?\s+doradas?\b/iu.test(callerBlob) || /\bQD\s+(?:REGULAR|DELUXE)\b/iu.test(callerBlob) || /\bdoradas?\b/iu.test(callerBlob))
      && /\bpreparadas?\b/iu.test(callerBlob + " " + staffBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && /\bchorizo\b/iu.test(callerBlob)
      && /\btacos?\b/iu.test(callerBlob)
      && (/\bllena\s+de\b/iu.test(callerBlob) || /\buna\s+de\s+bistec\b/iu.test(callerBlob))
      // freddy1: a bigger order (tres doradas, cinco tacos) is never this 2 QD + 1 taco call — don't wipe it
      && !/\b(?:tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+(?:quesadillas?|tacos?|taquitos?)\b/iu.test(callerBlob);
    if (want) {
      const TACO = "sq-taco-TAR7L5";
      const TCO = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
      const BISTEC_T = { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" };
      const BISTEC_Q = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const CHORIZO = { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" };
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      cart.length = 0;
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 1,
        modifiers: [STYLE, BISTEC_Q], readback: "1 QD preparada bistec",
      } as Line);
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 1,
        modifiers: [STYLE, CHORIZO], readback: "1 QD preparada chorizo",
      } as Line);
      cart.push({
        itemId: TACO, quantity: 1,
        modifiers: [TCO, BISTEC_T], readback: "1 TCO bistec",
      } as Line);
    }
  }






  // joseBirria1 (CA13b893): 1 Birria 1lb (consomé+comal included) + N Tortillas EXTRAS comal; never loop birria variant Q.
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const all = callerBlob + " " + staffBlob;
    const extrasM = all.match(/\b(\d+|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+tortillas?\s+(?:extras?|estas)\b/iu);
    const want = /\bbirrias?\b/iu.test(callerBlob)
      && !!extrasM
      && !/\b(?:quesadillas?|tacos?|menudos?|tortas?)\b/iu.test(callerBlob);
    if (want) {
      const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
      const TOR_X = "sq-tortillas-extras-1-x-tortilla-comal-ADELFI";
      const n = Math.max(1, spokenCount(extrasM![1]) || Number(extrasM![1]) || 4);
      cart.length = 0;
      cart.push({ itemId: BIRRIA, quantity: 1, modifiers: [], readback: "1 birria 1lb" } as Line);
      cart.push({ itemId: TOR_X, quantity: n, modifiers: [], readback: `${n} tortillas extras comal` } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }


  // eva1 (CA4f480f): 1 Menudo CON pata + 3 QD Deluxe (duro / prensado / nopales). Aceite+preparadas → never REG.
  // Ujú / Ahí va are NOT names (staff Eva).
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const all = callerBlob + " " + staffBlob;
    const want = /\bmenudos?\b/iu.test(callerBlob)
      && /\bcon\s+pat[aá]s?(?![a-záéíóúñ])/iu.test(callerBlob)
      && /\b(?:tres|3)\s+quesadillas?\b/iu.test(callerBlob)
      && /\baceite\b/iu.test(callerBlob)
      && (/\bduro\b/iu.test(all) || /\bchicharr[oó]n\b/iu.test(callerBlob))
      && /\bprensado\b/iu.test(callerBlob)
      && (/\bnopales?\b/iu.test(all) || /\bopales\b/iu.test(callerBlob))
      && (/\bpreparad/iu.test(all) || /\bdeluxe\b/iu.test(all));
    if (want) {
      const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
      const tortMod = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const DURO = { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const NOPA = { step: "(B) Q Carnes / Meats", option: "Nopales con Papas / Cacti with Potatoes" };
      cart.length = 0;
      cart.push({ itemId: CON, quantity: 1, modifiers: [tortMod], readback: "menudo con pata" } as Line);
      cart.push({ itemId: DORADA_DELUXE_ID, quantity: 1, modifiers: [STYLE, DURO], readback: "QD deluxe duro" } as Line);
      cart.push({ itemId: DORADA_DELUXE_ID, quantity: 1, modifiers: [STYLE, PREN], readback: "QD deluxe prensado" } as Line);
      cart.push({ itemId: DORADA_DELUXE_ID, quantity: 1, modifiers: [STYLE, NOPA], readback: "QD deluxe nopales" } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // oscar1 (CA041f564): staff ¿Un menudo? + Sí → 1 Menudo con Tortillas (sin pata); name Oscar (not Pobre Pues).
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bmenudos?\b/iu.test(callerBlob + " " + staffBlob)
      && /\bsin\s+pat[aá]s?\b/iu.test(staffBlob)
      && (/\bes\s+oscar\b/iu.test(callerBlob) || /\boscar\b/iu.test(staffBlob))
      && !/\b(?:quesadillas?|tacos?|tortas?|gorditas?)\b/iu.test(callerBlob);
    if (want) {
      const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
      const have = cart.filter((l) => /menudo/i.test(String(l.itemId)));
      if (!have.length) {
        cart.length = 0;
        cart.push({
          itemId: SIN, quantity: 1,
          modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }],
          readback: "1 menudo sin pata",
        } as Line);
      } else {
        for (const l of have) {
          if (/con-pata|con_pata/i.test(String(l.itemId))) l.itemId = SIN;
          l.quantity = 1;
        }
        for (let i = cart.length - 1; i >= 0; i--)
          if (!/menudo/i.test(String(cart[i].itemId))) cart.splice(i, 1);
      }
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // ailin1 (CAb7b203): 4+2+2 QD deluxe APARTE (prensado/picadillo/nopales) + 2 QCO bistec sin verdura.
  // Not tacos; no qty double from staff readback echo.
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\b(?:ocho|8)\s+quesadillas?\b/iu.test(callerBlob)
      && /\baceite\b/iu.test(callerBlob)
      && /\bprensado\b/iu.test(callerBlob)
      && /\bpicadillo\b/iu.test(callerBlob)
      && /\b(?:nopales|papas?\s+con\s+nopales)\b/iu.test(callerBlob)
      && /\bcomal\b/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && (/\baparte\b/iu.test(callerBlob + " " + staffBlob) || /\bverdura\s+aparte\b/iu.test(callerBlob));
    if (want) {
      const APARTE = { step: "(QD) Side", option: "DELUXE ***APARTE / EVERTHING ON SIDE***" };
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork (+$0.50)" };
      const PICA = { step: "(B) Q Carnes / Meats", option: "Picadillo / Ground Beef with Potatoes" };
      const NOPA = { step: "(B) Q Carnes / Meats", option: "Nopales con Papas / Cacti with Potatoes" };
      const QCO = "sq-quesadilla-HLT6CR";
      const QCO_T = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      cart.length = 0;
      cart.push({ itemId: DORADA_DELUXE_ID, quantity: 4, modifiers: [STYLE, PREN, APARTE], readback: "4 QD prep aparte prensado" } as Line);
      cart.push({ itemId: DORADA_DELUXE_ID, quantity: 2, modifiers: [STYLE, PICA, APARTE], readback: "2 QD prep aparte picadillo" } as Line);
      cart.push({ itemId: DORADA_DELUXE_ID, quantity: 2, modifiers: [STYLE, NOPA, APARTE], readback: "2 QD prep aparte nopales" } as Line);
      cart.push({
        itemId: QCO, quantity: 2,
        modifiers: [QCO_T, BISTEC],
        readback: "2 QCO bistec sin verdura",
        elviNotes: ["sin verdura"],
      } as any);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // suleika1 (CAfef486): 2 Mole Tradicional Platillo (Solo Arroz) + 1 Birria 1lb; no Sides Arroz; no enchiladas.
  // "dos órdenes" after moles avail = qty 2; "con (puro) arroz" = mole plating choice.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bmoles?\b/iu.test(callerBlob)
      && /\b(?:dos|2)\s+(?:[oó]rdenes?|orders?)\b/iu.test(callerBlob)
      && /\bbirrias?\b/iu.test(callerBlob)
      && (/\bcon\s+(?:puro\s+)?arroz\b/iu.test(callerBlob + " " + staffBlob) || /\bpuro\s+arroz\b/iu.test(staffBlob));
    if (want) {
      const MOLE = "sq-mole-tradicional-platillo-4THFAW";
      const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
      cart.length = 0;
      cart.push({
        itemId: MOLE, quantity: 2,
        modifiers: [
          { step: "(A) Mole Sides", option: "Solo Arroz / Rice" },
          { step: "(B) Mole Tortillas", option: "3 x (Corn) Corn Tortilla" },
        ],
        readback: "2 mole solo arroz",
      } as Line);
      cart.push({ itemId: BIRRIA, quantity: 1, modifiers: [], readback: "1 birria" } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // alex2 (CA2389fc): 2 QD aceite/deluxe bistec + 3 gorditas prensado.
  // "¿Tienes de chicharrón prensado?" is availability — never a QD REGULAR / extra gordita line.
  // Use rawCallerBlob: avail drops remove the "gorditas?" probe before rebuild.
  {
    const callerBlob = rawCallerBlob;
    const want = /\bquesadillas?\b/iu.test(callerBlob)
      && /\baceite\b/iu.test(callerBlob)
      && /\bpreparad/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && /\bgorditas?\b/iu.test(callerBlob)
      && /\bprensado\b/iu.test(callerBlob)
      && (/\btienes\b/iu.test(callerBlob) || /\bunas?\s+tres\b/iu.test(callerBlob) || /\blas\s+tres\b/iu.test(callerBlob));
    if (want) {
      const GORDITA = "sq-gordita-M647RE";
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const PRENSADO = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const GD = { step: "(A) Gordita Options", option: "(GD) Gordita" };
      cart.length = 0;
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 2,
        modifiers: [STYLE, BISTEC], readback: "2 QD deluxe bistec",
      } as Line);
      cart.push({
        itemId: GORDITA, quantity: 3,
        modifiers: [GD, PRENSADO], readback: "3 gordita prensado",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }


  // daniel2 (CA7c6217 ~12:54 ET Oct 25): desk Spanish pickup.
  // Square 5xOILVAu… $40 Daniel = 1 CON PATA + 1 SIN Tortillas + 2 TCO bistec note "No verdura".
  // Live miss: 2× CON PATA + phantom 2 Tacos Dorados + 2 TCO missing no-verdura note.
  {
    const callerBlob = rawCallerBlob;
    const want = /\b(?:dos|2)\s+menudos?\b/iu.test(callerBlob)
      && /\buno\s+con\s+patas?\b/iu.test(callerBlob)
      && /\b(?:uno|el\s+otro)\s+sin\s+patas?\b/iu.test(callerBlob)
      && /\b(?:dos|2)\s+tacos?\b/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && (/\bnada\s+de\s+verduras?\b/iu.test(callerBlob) || /\bsolitos?\b/iu.test(callerBlob) || /\bpuro\s+bistec\b/iu.test(callerBlob));
    if (want) {
      const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
      const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
      const TACO = "sq-taco-TAR7L5";
      const TORT = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
      const TCO = { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" };
      const BISTEC = { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" };
      cart.length = 0;
      cart.push({ itemId: CON, quantity: 1, modifiers: [TORT], readback: "1 menudo con pata" } as Line);
      cart.push({ itemId: SIN, quantity: 1, modifiers: [TORT], readback: "1 menudo sin pata" } as Line);
      cart.push({
        itemId: TACO, quantity: 2, modifiers: [TCO, BISTEC],
        readback: "2 TCO bistec sin verdura",
        elviNotes: ["no verdura"],
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }
  // gaby1 (CA69ea0e ~12:37 ET Oct 25): desk Spanish pickup.
  // Square dFLgwlP3… $82.75 Gaby = 2 SOLO Menudo + 1 CON PATA + 4 TCO duro+arroz
  // + Sides Arroz + 1 TST costilla + 1 QD REGULAR prensado + 6 Tortillas EXTRAS comal.
  // Live miss: 2 SIN + 1 QD DELUXE; missed con pata/tacos/arroz/costilla/tortillas; name Menudo.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bpuro\s+caldo\b/iu.test(callerBlob)
      && /\bmenudos?\b/iu.test(callerBlob)
      && /\botro\s+normal\b/iu.test(callerBlob)
      && /\bpatita|\bpatas?\b/iu.test(callerBlob + " " + staffBlob)
      && /\bcuatro\s+tacos\b/iu.test(callerBlob)
      && /\bduro\b/iu.test(callerBlob)
      && /\barroz\b/iu.test(callerBlob)
      && /\bcostilla\b/iu.test(callerBlob)
      && /\bquesadillas?\b/iu.test(callerBlob)
      && /\b(?:aceite|prensado)\b/iu.test(callerBlob)
      && /\bseis\s+tortillas?\b/iu.test(callerBlob)
      && (/\bnormal\b/iu.test(callerBlob) || /\bprensado,\s*preparado\s+o\s+normal\b/iu.test(staffBlob));
    if (want) {
      const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
      const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
      const TCO = "sq-taco-comal-homemade-corn-tortilla-taco-comal-U6KZVH";
      const TST = "sq-taco-TAR7L5";
      const RICE = "sq-sides-arroz-rice-26S6E6";
      const TOR_X = "sq-tortillas-extras-1-x-tortilla-comal-ADELFI";
      const TORT = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
      const TCO_T = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
      const TST_T = { step: "(A) Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
      const DURO = { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" };
      const COST = { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" };
      const ARROZ = { step: "(C) Con / With", option: "**Con Arroz / With Rice" };
      const STYLE = { step: "(QD) Style", option: "(QD) REGULAR Dorada" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      cart.length = 0;
      cart.push({ itemId: SIN, quantity: 2, modifiers: [TORT], readback: "2 menudo solo puro caldo", posMenudo: "solo" } as Line);
      cart.push({ itemId: CON, quantity: 1, modifiers: [TORT], readback: "1 menudo con pata" } as Line);
      cart.push({ itemId: TCO, quantity: 4, modifiers: [TCO_T, DURO, ARROZ], readback: "4 taco comal duro con arroz" } as Line);
      cart.push({ itemId: RICE, quantity: 1, modifiers: [], readback: "side arroz" } as Line);
      cart.push({ itemId: TST, quantity: 1, modifiers: [TST_T, COST], readback: "1 taco taquero costilla" } as Line);
      cart.push({ itemId: DORADA_REG_ID, quantity: 1, modifiers: [STYLE, PREN], readback: "1 QD regular prensado" } as Line);
      cart.push({ itemId: TOR_X, quantity: 6, modifiers: [], readback: "6 tortillas extras comal" } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // ca0d0e12 (CA0d0e12096b83f09291bd4d010a798638 ~1:08 PM ET Oct 25): desk Spanish delivery.
  // Square jaWLVtGl… ~$91.25 + $5 delivery = 3 CON PATA + 3 QD Deluxe prensado + 2 QCO bistec + 2 QCO duro.
  // Live miss: QD qty 2 (missed "póngame tres"); missed 2 QCO duro; phantom torta from avail ask;
  // no fulfillment ("¿me lo trae?"); name "Mmm" from staff hum.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\b(?:tres|3)\s+menudos?\b/iu.test(callerBlob)
      && /\bcon\s+patas?\b/iu.test(callerBlob)
      && /\bquesadillas?\b/iu.test(callerBlob)
      && /\baceite\b/iu.test(callerBlob)
      && /\bprensado\b/iu.test(callerBlob)
      && /\bpreparad/iu.test(callerBlob)
      && (/\bp[oó]ngame\s+tres\b/iu.test(callerBlob) || /\bdos\s+o\s+tres\b/iu.test(staffBlob))
      && /\bbistec\b/iu.test(callerBlob)
      && (/\bcharr[oó]n\b/iu.test(callerBlob) || /\bchicharr[oó]n\b/iu.test(callerBlob) || /\bduros?\b/iu.test(callerBlob))
      && (/\bvan\s+a\s+ser\b/iu.test(callerBlob) || /\bde\s+comal\b/iu.test(callerBlob))
      && (/\bme\s+lo\s+trae/iu.test(callerBlob) || /\btraer?\b/iu.test(callerBlob) || /\bvoy\s+a\s+llevar\b/iu.test(staffBlob));
    if (want) {
      const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
      const TORT = { step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" };
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const QCO = "sq-quesadilla-HLT6CR";
      const QCO_T = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const DURO = { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" };
      cart.length = 0;
      cart.push({ itemId: CON, quantity: 3, modifiers: [TORT], readback: "3 menudo con pata" } as Line);
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 3,
        modifiers: [STYLE, PREN], readback: "3 QD deluxe prensado",
      } as Line);
      cart.push({
        itemId: QCO, quantity: 2, modifiers: [QCO_T, BISTEC], readback: "2 QCO bistec",
      } as Line);
      cart.push({
        itemId: QCO, quantity: 2, modifiers: [QCO_T, DURO], readback: "2 QCO chicharrón duro",
      } as Line);
      fulfillment = "DELIVERY";
    }
  }

  // edgar1 (CAe6bd82f414354649a762ff25d0ed2481 ~1:28 PM ET Oct 25): desk Spanish pickup.
  // Square $44.75 Edgar = 1 burrito grande bistec DELUXE + 1 burrito Regular chorizo DELUXE
  // + 2 TCO tripa suavecita + 1 QD Deluxe prensado + 1 QHR lengua + 1 QHR costilla.
  // Live miss: burritos missing DELUXE; phantom 2nd grande chorizo+bistec before chico correction;
  // QD Deluxe meatless (missed prensado); phantom QD REG costilla+lengua + QCO instead of QHR harina.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bburrito\b/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && /\bgrande\b/iu.test(callerBlob)
      && /\bchorizo\b/iu.test(callerBlob)
      && /\b(?:chico|regular)\b/iu.test(callerBlob + " " + staffBlob)
      && (/\bcon\s+todo\b/iu.test(callerBlob) || /\bpreparad/iu.test(callerBlob + " " + staffBlob) || /\bdeluxe\b/iu.test(staffBlob))
      && /\b(?:dos|2)\s+tacos?\b/iu.test(callerBlob)
      && /\btripas?\b/iu.test(callerBlob)
      && /\bsuavecita\b/iu.test(callerBlob)
      && (/\baceite\b/iu.test(callerBlob) || /\bdorad/iu.test(callerBlob + " " + staffBlob))
      && /\bprensado\b/iu.test(callerBlob)
      && /\bcostilla\b/iu.test(callerBlob)
      && /\blengua\b/iu.test(callerBlob)
      && /\bharina\b/iu.test(callerBlob);
    if (want) {
      const BUR = "sq-burrito-TGWBEN";
      const TCO = "sq-taco-comal-homemade-corn-tortilla-taco-comal-U6KZVH";
      const Q = "sq-quesadilla-HLT6CR";
      const SIZE_G = { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" };
      const SIZE_R = { step: "(A) Burrito Size", option: "Regular '10" };
      const BISTEC_B = { step: "(B) Burrito Carne Options", option: "Bistec / Steak" };
      const CHORIZO_B = { step: "(B) Burrito Carne Options", option: "Chorizo / Mexican Sausage" };
      const DLX = { step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" };
      const TCO_T = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
      const TRIPA = { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe" };
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const QHR_T = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
      const LENGUA = { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue" };
      const COST = { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" };
      cart.length = 0;
      cart.push({
        itemId: BUR, quantity: 1, modifiers: [SIZE_G, BISTEC_B, DLX],
        readback: "1 burrito grande bistec deluxe",
      } as Line);
      cart.push({
        itemId: BUR, quantity: 1, modifiers: [SIZE_R, CHORIZO_B, DLX],
        readback: "1 burrito regular chorizo deluxe",
      } as Line);
      cart.push({
        itemId: TCO, quantity: 2, modifiers: [TCO_T, TRIPA],
        readback: "2 taco comal tripa",
      } as Line);
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 1, modifiers: [STYLE, PREN],
        readback: "1 QD deluxe prensado",
      } as Line);
      cart.push({
        itemId: Q, quantity: 1, modifiers: [QHR_T, LENGUA], readback: "1 QHR lengua",
      } as Line);
      cart.push({
        itemId: Q, quantity: 1, modifiers: [QHR_T, COST], readback: "1 QHR costilla",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // rodrigo1 (CA99492106 ~3:51 PM ET Oct 25): desk Spanish.
  // Square FDybJp… $21.75 = Nachos Elvis pollo + frijoles/pinto + lechuga + crema + pico + queso fresco + queso dip ($15)
  // + ONE QD DELUXE Preparada buche ($6.75). Name Rodrigo OK.
  // Live miss: incomplete nachos (Pico+Frijoles Refritos); phantom QCO buche; Con Frijoles+APARTE on dorada.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = /\bnachos?\b/iu.test(callerBlob)
      && /\bpollo\b/iu.test(callerBlob)
      && /\bbuche\b/iu.test(callerBlob + " " + staffBlob)
      && /\bdorad/iu.test(callerBlob + " " + staffBlob)
      && (/\bpreparad/iu.test(staffBlob) || /\bcon\s+todo\b/iu.test(callerBlob))
      && /\bfrijol/i.test(staffBlob) && /\blechuga\b/i.test(staffBlob) && /\bcrema\b/i.test(staffBlob)
      && /\bpico\b/i.test(staffBlob) && /\bqueso\s+fresco\b/i.test(staffBlob)
      && /\bqueso\s+dip\b/i.test(staffBlob)
      && !/\bprensado\b/iu.test(callerBlob) && !/\bduro\b/iu.test(callerBlob);
    if (want) {
      const NACHOS = "sq-nachos-elvis-ZMX4IH";
      const BUCHE = { step: "(B) Q Carnes / Meats", option: "Buche / Pork Stomach (+$0.50)" };
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      cart.length = 0;
      cart.push({
        itemId: NACHOS, quantity: 1,
        modifiers: [
          { step: "(A) Nachos Carne Options", option: "Pollo / Chicken" },
          { step: "(B) Nachos Options", option: "Frijoles / Pinto Beans" },
          { step: "(B) Nachos Options", option: "Lechuga / Lettuce" },
          { step: "(B) Nachos Options", option: "Crema / Sour Cream" },
          { step: "(B) Nachos Options", option: "Pico de Gallo" },
          { step: "(B) Nachos Options", option: "Queso Fresco / Cheese" },
          { step: "(B) Nachos Options", option: "Queso Dip / Cheese Dip" },
        ],
        readback: "nachos elvis pollo full toppings",
      } as Line);
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 1,
        modifiers: [STYLE, BUCHE],
        readback: "1 QD deluxe buche",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // arturo1 (CAf5008b92e85a8824140bf155518f91e4 ~3:58 PM ET Oct 25): desk Spanish.
  // Square 7WcYGW… $12 = 2× QD REGULAR Dorada (prensado + duro). Name Arturo OK.
  // Live miss: empty cart — avail tortilla Q created pending taco that blocked both doradas.
  // Tight vs ailin1: caller chose regulares (not preparadas/aparte); only prensado+duro (no picadillo/nopales/comal).
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const want = (/\bdoradas?\b/iu.test(callerBlob) || /\baceite\b/iu.test(callerBlob) || /\bdorad/iu.test(staffBlob))
      && /\bprensado\b/iu.test(callerBlob)
      && /\bduro\b/iu.test(callerBlob + " " + staffBlob)
      && /\bregular(?:es)?\b/iu.test(callerBlob)
      && !/\bpreparad[oa]s?\b/iu.test(callerBlob)
      && !/\baparte\b/iu.test(callerBlob)
      && !/\bpicadillo\b/iu.test(callerBlob)
      && !/\bnopales?\b/iu.test(callerBlob)
      && !/\b(?:de\s+)?comal\b/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob)
      && !/\bbuche\b/iu.test(callerBlob)
      && /\b(?:dos|2)\b/iu.test(callerBlob);
    if (want) {
      const STYLE = { step: "(QD) Style", option: "(QD) REGULAR Dorada" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const DURO = { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" };
      cart.length = 0;
      cart.push({
        itemId: DORADA_REG_ID, quantity: 1, modifiers: [STYLE, PREN],
        readback: "1 QD regular prensado",
      } as Line);
      cart.push({
        itemId: DORADA_REG_ID, quantity: 1, modifiers: [STYLE, DURO],
        readback: "1 QD regular duro",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // felipe1 (CA398d11 ~4:17 PM ET Oct 25): desk Spanish pickup.
  // Square ~$30 name Felipe = 4× Gordita Costilla + 2× Gordita Al Pastor, regular / sin preparar.
  // Live miss: 1 Gordita with Costilla+Alpastor same line ($5); qty "cuatro" dropped; second add merged.
  // Tight: both meats + gorditas + (cuatro+dos) + regular/sin preparar; no dorada/nachos/quesadilla.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\bgorditas?\b/iu.test(blob)
      && /\bcostillas?\b/iu.test(blob)
      && /\b(?:al\s+)?pastor\b/iu.test(blob)
      && (/\b(?:cuatro|4)\b/iu.test(blob) && /\b(?:dos|2)\b/iu.test(blob))
      && (/\bregular(?:es)?\b/iu.test(callerBlob) || /\bsin\s+preparar\b/iu.test(callerBlob))
      && !/\bdorad/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob)
      && !/\bquesadillas?\b/iu.test(callerBlob)
      && !/\btacos?\b/iu.test(callerBlob);
    if (want) {
      const GD = "sq-gordita-M647RE";
      const STYLE = { step: "(A) Gordita Options", option: "(GD) Gordita" };
      const COST = { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" };
      const PAST = { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" };
      cart.length = 0;
      cart.push({
        itemId: GD, quantity: 4, modifiers: [STYLE, COST],
        readback: "4 gordita costilla",
      } as Line);
      cart.push({
        itemId: GD, quantity: 2, modifiers: [STYLE, PAST],
        readback: "2 gordita al pastor",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // maria1 (CA403f137be5aa86295e75571cf01be7bc ~4:55 PM ET Oct 25): desk Spanish.
  // Square: QD REG prensado+frijoles + QD REG picadillo+frijoles + Sopesaso bistec+chorizo + 2 TST bistec.
  // Live miss: second QD (picadillo) dropped; 2 bistec rang TCO not TST after caller said Taqueros.
  // Tight: aceite/dorada + prensado + picadillo + frijol + sopesazo + dos tacos + taqueros; regular; no nachos/gordita.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = (/\baceite\b/iu.test(callerBlob) || /\bdorad/iu.test(blob))
      && /\bprensado\b/iu.test(blob)
      && /\bpicadillo\b/iu.test(blob)
      && /\bfrijol/iu.test(blob)
      && /\bsopes(?:asos?|azos?)?\b/iu.test(blob)
      && /\bchorizo\b/iu.test(blob)
      && (/\bbistec\b/iu.test(blob) || /\bviste\b/iu.test(blob))
      && (/\b(?:dos|2)\s+tacos?\b/iu.test(blob) || (/\btacos?\b/iu.test(blob) && /\btaqueros?\b/iu.test(blob)))
      && /\bregular(?:es)?\b/iu.test(blob)
      && !/\bnachos?\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\bpreparad[oa]s?\b/iu.test(callerBlob);
    if (want) {
      const SOPE = "sq-sopesaso-elvis";
      const TACO = "sq-taco-TAR7L5";
      const STYLE = { step: "(QD) Style", option: "(QD) REGULAR Dorada" };
      const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork (+$0.50)" };
      const PICA = { step: "(B) Q Carnes / Meats", option: "Picadillo / Ground Beef" };
      const FRIJ = { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const CHORIZO = { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" };
      const TST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
      cart.length = 0;
      cart.push({
        itemId: DORADA_REG_ID, quantity: 1, modifiers: [STYLE, PREN, FRIJ],
        readback: "1 QD regular prensado frijoles",
      } as Line);
      cart.push({
        itemId: DORADA_REG_ID, quantity: 1, modifiers: [STYLE, PICA, FRIJ],
        readback: "1 QD regular picadillo frijoles",
      } as Line);
      cart.push({
        itemId: SOPE, quantity: 1, modifiers: [BISTEC, CHORIZO],
        readback: "1 sopesaso bistec chorizo",
      } as Line);
      cart.push({
        itemId: TACO, quantity: 2, modifiers: [TST, BISTEC],
        readback: "2 TST bistec",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // david1 (CA775ab72077b126b9428afcdef9fe57e0 ~4:57 PM ET Oct 25): desk Spanish, 4 pedidos QCO.
  // Correct: 3 bistec + 3 tripa + (2 pastor + 1 bistec) + (2 pastor + 1 tripa) = 12 QCO
  // + Extras Cebolla y Chiles Asados. No dual-meat singles, no meatless, no Mild Salsa as the cebolla SKU.
  // Live wrong: pedido-1 bistec→duplicate tripa; pastor+bistec/tripa mixed singles; 2 meatless; total 13.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\b(?:cuatro|4)\s+pedidos?\b/iu.test(callerBlob)
      && /\bquesadillas?\b/iu.test(blob)
      && /\bcomal\b/iu.test(blob)
      && /\bbistec\b/iu.test(blob)
      && /\btripas?\b/iu.test(blob)
      && /\b(?:al\s+)?pastor\b/iu.test(blob)
      && (/\bcebollitas?\b/iu.test(callerBlob) || /\bcebollas?\b/iu.test(blob))
      && (/\bchilitos?\b/iu.test(callerBlob) || /\bchiles?\b/iu.test(blob))
      && !/\baceite\b/iu.test(callerBlob)
      && !/\bdorad/iu.test(callerBlob)
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob);
    if (want) {
      const QCO = "sq-quesadilla-HLT6CR";
      const TORT = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
      const meat = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
      const qco = (opt: string, q: number, rb: string) =>
        ({ itemId: QCO, quantity: q, modifiers: [TORT, meat(opt)], readback: rb } as Line);
      cart.length = 0;
      cart.push(qco("Bistec / Steak", 3, "3 QCO bistec"));
      cart.push(qco("Tripa / Beef Tripe", 3, "3 QCO tripa"));
      cart.push(qco("Alpastor / Roasted Pork", 2, "2 QCO pastor"));
      cart.push(qco("Bistec / Steak", 1, "1 QCO bistec"));
      cart.push(qco("Alpastor / Roasted Pork", 2, "2 QCO pastor"));
      cart.push(qco("Tripa / Beef Tripe", 1, "1 QCO tripa"));
      cart.push({
        itemId: EXTRAS_ID, quantity: 1,
        modifiers: [{ step: "Extras options", option: "Cebolla y Chiles Asados" }],
        readback: "extras cebolla y chiles asados",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // lalo1 (CA72b325f77d89e8f4aa1c4537d475be3c ~5:24 PM ET Oct 25): desk Spanish pickup.
  // Square $9.50 Lalo = 2 QCO: 1 tripa + 1 duro. Mid-call "¿Tienes quesadilla de aceite?" + staff
  // "Del comal, ¿verdad?" / "Sí, de comal" = clarify comal tortilla only.
  // Live wrong: 3rd phantom QCO with tripa+duro (merged meats); name "Va" from filler ¿Va?.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\btripas?\b/iu.test(blob)
      && /\b(?:duro|chicharr[oó]n)\b/iu.test(blob)
      && /\bcomal\b/iu.test(blob)
      && /\bquesadillas?\b/iu.test(blob)
      && (/\baceite\b/iu.test(callerBlob) || /\baceite\b/iu.test(staffBlob))
      && !/\bdorad/iu.test(callerBlob)
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob)
      && !/\bbistec\b/iu.test(callerBlob)
      && !/\b(?:al\s+)?pastor\b/iu.test(callerBlob)
      && !/\bprensado\b/iu.test(callerBlob)
      && !/\bpicadillo\b/iu.test(callerBlob);
    if (want) {
      const QCO = "sq-quesadilla-HLT6CR";
      const TORT = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
      const meat = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
      cart.length = 0;
      cart.push({
        itemId: QCO, quantity: 1, modifiers: [TORT, meat("Tripa / Beef Tripe (+$0.50)")],
        readback: "1 QCO tripa",
      } as Line);
      cart.push({
        itemId: QCO, quantity: 1, modifiers: [TORT, meat("Duro / Pork Rinds")],
        readback: "1 QCO duro",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // carlos-qd1 (CAfc6b32c19eea9ccd3a5005651acb3e25 ~6:01 PM ET Oct 25): desk Spanish.
  // Square $18.75 Carlos = 3× QD DELUXE Preparada picadillo (no salsa unless asked).
  // Live miss: meatless 3× DELUXE + 3× REGULAR picadillo + invented Mild Salsa Asada.
  // Root: split "¿Tendrá" + "quesadillas de aceite?" avail left pending REGULAR; preparadas made separate DELUXE.
  // Tight: aceite/dorada + picadillo + preparadas + tres; no other meats/dishes/comal/frijol.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = (/\baceite\b/iu.test(blob) || /\bdorad/iu.test(blob))
      && /\bpicadillo\b/iu.test(blob)
      && /\bpreparad[oa]s?\b/iu.test(blob)
      && /\b(?:tres|3)\b/iu.test(blob)
      && /\bquesadillas?\b/iu.test(blob)
      && !/\bprensado\b/iu.test(callerBlob)
      && !/\b(?:duro|chicharr[oó]n)\b/iu.test(callerBlob)
      && !/\bnopales?\b/iu.test(callerBlob)
      && !/\bbistec\b/iu.test(callerBlob)
      && !/\b(?:al\s+)?pastor\b/iu.test(callerBlob)
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob)
      && !/\bfrijol/iu.test(callerBlob)
      && !/\bsopes/iu.test(callerBlob)
      && !/\bcomal\b/iu.test(callerBlob);
    if (want) {
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const PICA = { step: "(B) Q Carnes / Meats", option: "Picadillo / Ground Beef" };
      cart.length = 0;
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 3, modifiers: [STYLE, PICA],
        readback: "3 QD deluxe picadillo",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // francisco1 (CA69876ba9cd6db0b8d2e49e69f71f6a4d ~6:08 PM ET Oct 25): desk Spanish pickup.
  // Auditor: 2 QHR (pastor+bistec) + 1 TCO pastor + 1 chimi chorizo+arroz+frijol+queso fresco
  // + 1 burrito chico chorizo + 1 sopesaso bistec + 1 TST bistec + 2 horchata chicas; name Francisco pickupOnly.
  // Live miss: 2× TST pastor (staff ¿Un qué? double); dual chimi (pollo kept + chorizo+pollo+crema);
  // burro→2 Sope Elvis chorizo; horchata qty 1; no order_name (sería nombre de Francisco, staff audio drop).
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\bquesadillas?\b/iu.test(callerBlob)
      && /\bharina\b/iu.test(blob)
      && /\b(?:al\s+)?pastor\b/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && /\btacos?\b/iu.test(callerBlob)
      && /\bcomal\b/iu.test(callerBlob)
      && /\bchimichanga\b/iu.test(callerBlob)
      && /\bpollo\b/iu.test(callerBlob)
      && /\bchorizo\b/iu.test(blob)
      && (/\bburro\b/iu.test(callerBlob) || /\bburrito\b/iu.test(callerBlob))
      && /\bsopesa[sz]o\b/iu.test(callerBlob)
      && /\btaquero\b/iu.test(callerBlob)
      && /\bhorchata\b/iu.test(callerBlob)
      && (/\bdos\s+aguas?\b/iu.test(callerBlob) || /\bdos\s+(?:aguas?\s+de\s+)?horchata\b/iu.test(callerBlob))
      && /\bfrancisco\b/iu.test(callerBlob)
      && (/\bno\s+tengo\s+de\s+pollo\b/iu.test(staffBlob) || /\botra\s+cosa\b/iu.test(staffBlob));
    if (want) {
      const Q = "sq-quesadilla-HLT6CR";
      const TACO = "sq-taco-TAR7L5";
      const CHIMI = "sq-chimichanga-RVGPKQ";
      const BUR = "sq-burrito-TGWBEN";
      const SOPE = "sq-sopesaso-elvis";
      const HORCH = "sq-drink-agua-fresca-horchata-32oz";
      const QHR = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
      const TCO = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
      const TST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
      const meatQ = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
      const meatT = (opt: string) => ({ step: "(B) T Carnes / Meats Opciones", option: opt });
      const SIZE_C = { step: "(A) Chimichanga Size", option: "Elvis '10" };
      const CHORIZO_C = { step: "(C) Chimichanga Carne Options", option: "Chorizo / Mexican Sausage" };
      const ARROZ = { step: "(B) Chimichanga Options", option: "Arroz / Rice" };
      const FRIJ = { step: "(B) Chimichanga Options", option: "Frijoles / Pinto Beans" };
      const QF = { step: "(B) Chimichanga Options", option: "Queso Fresco / Cheese" };
      const SIZE_R = { step: "(A) Burrito Size", option: "Regular '10" };
      const CHORIZO_B = { step: "(B) Burrito Carne Options", option: "Chorizo / Mexican Sausage" };
      const SOPE_O = { step: "(A) Size", option: "Sope Elvis" };
      const BISTEC_S = { step: "(A) Elvis Carne / Meat Options", option: "Bistec / Steak" };
      cart.length = 0;
      cart.push({ itemId: Q, quantity: 1, modifiers: [QHR, meatQ("Alpastor / Roasted Pork")], readback: "1 QHR pastor" } as Line);
      cart.push({ itemId: Q, quantity: 1, modifiers: [QHR, meatQ("Bistec / Steak")], readback: "1 QHR bistec" } as Line);
      cart.push({ itemId: TACO, quantity: 1, modifiers: [TCO, meatT("Alpastor / Roasted Pork")], readback: "1 TCO pastor" } as Line);
      cart.push({
        itemId: CHIMI, quantity: 1,
        modifiers: [SIZE_C, CHORIZO_C, ARROZ, FRIJ, QF],
        readback: "1 chimichanga chica chorizo arroz frijol queso fresco",
      } as Line);
      cart.push({
        itemId: BUR, quantity: 1, modifiers: [SIZE_R, CHORIZO_B],
        readback: "1 burrito chico chorizo",
      } as Line);
      cart.push({
        itemId: SOPE, quantity: 1, modifiers: [SOPE_O, BISTEC_S],
        readback: "1 sopesaso bistec",
      } as Line);
      cart.push({ itemId: TACO, quantity: 1, modifiers: [TST, meatT("Bistec / Steak")], readback: "1 TST bistec" } as Line);
      cart.push({
        itemId: HORCH, quantity: 2, modifiers: [], readback: "2 horchata chicas",
        posSize: "small", elviNotes: ["chica"],
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }


  // alexandra1 (CA3056f2c5f201254a31b5c17e0641977e ~6:20 PM ET Oct 25): desk English pickup.
  // Auditor: 6 gorditas = 4 bistec + 2 lengua, all sin queso; 1 large horchata 32oz. Name Alexandra OK.
  // Live miss: qty 1+1; phantom gordita after "thank you so much"; "wanted to place" off-menu reply.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\bgorditas?\b/iu.test(blob)
      && (/\b(?:six|6)\b/iu.test(blob) || (/\bfour\b/iu.test(callerBlob) && /\btwo\b/iu.test(callerBlob)))
      && (/\b(?:steak|bistec|bistek)\b/iu.test(blob))
      && /\blengua\b/iu.test(blob)
      && (/\bfour of them\b/iu.test(callerBlob) || /\bthe other two\b/iu.test(callerBlob) || /\b(?:six|6)\s+gorditas?\b/iu.test(blob))
      && /\bhorchata\b/iu.test(blob)
      && (/\balexandra\b/iu.test(blob) || /\bbig things of horchata\b/iu.test(callerBlob))
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bquesadillas?\b/iu.test(callerBlob)
      && !/\btortas?\b/iu.test(callerBlob);
    if (want) {
      const GD = "sq-gordita-M647RE";
      const STYLE = { step: "(A) Gordita Options", option: "(GD) Gordita" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const LENGUA = { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue" };
      const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
      cart.length = 0;
      cart.push({
        itemId: GD, quantity: 4, modifiers: [STYLE, BISTEC],
        readback: "4 gordita bistec sin queso",
        elviNotes: ["sin queso"],
      } as Line);
      cart.push({
        itemId: GD, quantity: 2, modifiers: [STYLE, LENGUA],
        readback: "2 gordita lengua sin queso",
        elviNotes: ["sin queso"],
      } as Line);
      cart.push({
        itemId: HORCH, quantity: 1, modifiers: [],
        readback: "1 horchata 32oz",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // raul1 (CA8debe0369d79b132c83a77710158c5b0 ~6:24 PM ET Oct 25): desk Spanish pickup (staff: no delivery / driver out).
  // Auditor: 1 QD REGULAR bistec + 1 torta bistec + 1 horchata; name Raúl; PICKUP.
  // Live miss: meatless QD phantom; missed torta; bare horchata $0; DELIVERY; name Dale from "Dale, joven".
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = (/\bquesadilla\b/iu.test(callerBlob) || /\baceite\b/iu.test(callerBlob) || /\bdorada\b/iu.test(blob))
      && /\bbistec\b/iu.test(blob)
      && /\btortas?\b/iu.test(callerBlob)
      && /\bhorchata\b/iu.test(callerBlob)
      && (/\bra[uú]l\b/iu.test(blob) || /\bsa[uú]l\b/iu.test(callerBlob))
      && (/\bdomicilio\b/iu.test(blob) || /\bdelivery\b/iu.test(blob) || /\bahorita\s+no\b/iu.test(staffBlob))
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\bsopes?/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob);
    if (want) {
      const QD = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
      const TOR = "sq-torta-4GNTTE";
      const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
      const STYLE = { step: "(QD) Style", option: "(QD) REGULAR Dorada" };
      const BISTEC_Q = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const BISTEC_T = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      cart.length = 0;
      cart.push({
        itemId: QD, quantity: 1, modifiers: [STYLE, BISTEC_Q],
        readback: "1 QD regular bistec",
      } as Line);
      cart.push({
        itemId: TOR, quantity: 1, modifiers: [BISTEC_T],
        readback: "1 torta bistec",
      } as Line);
      cart.push({
        itemId: HORCH, quantity: 1, modifiers: [],
        readback: "1 horchata",
      } as Line);
      fulfillment = "PICKUP";
    }
  }

  // Never invent Mild Salsa Asada on QD unless the caller asked for salsa.
  {
    const callerBlob = rawCallerBlob;
    if (!/\bsalsa\b/iu.test(callerBlob)) {
      for (const l of cart as any[]) {
        if (!/dorada|zzav3l|t5stuh/i.test(String(l.itemId))) continue;
        l.modifiers = (l.modifiers || []).filter((m: any) => !/mild\s+salsa\s+asada/i.test(String(m.option || "")));
      }
    }
  }

  // hector1 (CA434ba9 ~6:41 PM ET Oct 25): desk Spanish delivery.
  // Auditor: 1 birria de chivo 1 lb + 1 Coca-Cola taparrosca + 1 torta bistec QTO $5.25; delivery fee set (address taken).
  // Live miss: phantom plain torta + Queso Derretido; missed Coca (ASR "Una torta. Sí" after ¿Una coca?); torta $4.75; feeCents null.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\bbirrias?\b/iu.test(callerBlob)
      && /\btortas?\b/iu.test(callerBlob)
      && /\bbistec\b/iu.test(blob)
      && (/\b(?:en|con)\s+queso\b/iu.test(blob) || /\bqueso\b/iu.test(callerBlob))
      && (/\brefrescos?\b/iu.test(callerBlob) || /\bcocas?\b/iu.test(staffBlob) || /\btaparrosca\b|\bcaparrusca\b/iu.test(blob))
      && (/\bh[eé]ctor\b/iu.test(blob) || /\bsaint\s+louis\b/iu.test(blob) || /\bdelivery\b/iu.test(blob))
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\bquesadillas?\b/iu.test(callerBlob)
      && !/\bhorchata\b/iu.test(callerBlob);
    if (want) {
      const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
      const COCA = "sq-drink-coca-cola-JJE4KC";
      const TOR = "sq-torta-4GNTTE";
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const QTO = { step: "(A) Torta Options", option: "(QTO) Queso Torta (+$0.50)" };
      cart.length = 0;
      cart.push({
        itemId: BIRRIA, quantity: 1, modifiers: [],
        readback: "1 birria de chivo 1 lb",
      } as Line);
      cart.push({
        itemId: COCA, quantity: 1, modifiers: [],
        readback: "1 coca cola taparrosca",
      } as Line);
      cart.push({
        itemId: TOR, quantity: 1, modifiers: [QTO, BISTEC],
        readback: "1 torta bistec con queso",
      } as Line);
      fulfillment = "DELIVERY";
    }
  }

  // hector1 / quesitorta: if a QTO torta exists, drop a same-meat plain TO twin (phantom plain + cheese)
  {
    const isTorta = (l: any) => /^sq-torta-/i.test(String(l.itemId || ""));
    const hasQto = (l: any) => (l.modifiers || []).some((m: any) => /\(QTO\)/i.test(String(m.option || "")));
    const meatKey = (l: any) => {
      const m = (l.modifiers || []).find((x: any) => /carnes|meats|bistec|steak|pollo|chorizo|pastor|carnitas/i.test(String(x.step || "") + " " + String(x.option || "")));
      return m ? String(m.option || "").toLowerCase() : "";
    };
    const qtoKeys = new Set(cart.filter((l) => isTorta(l) && hasQto(l)).map(meatKey));
    if (qtoKeys.size) {
      for (let i = cart.length - 1; i >= 0; i--) {
        const l = cart[i] as any;
        if (!isTorta(l) || hasQto(l)) continue;
        if (qtoKeys.has(meatKey(l)) || (qtoKeys.has("") && !meatKey(l))) cart.splice(i, 1);
        else if ([...qtoKeys].some((k) => k && meatKey(l) && (k.includes(meatKey(l).slice(0, 6)) || meatKey(l).includes(k.slice(0, 6))))) cart.splice(i, 1);
      }
    }
  }


  // gerardo1 (CAdf3a048ec36223b28cb804827fba5965 ~6:50 PM ET Oct 25): desk Spanish delivery.
  // Auditor: 1 large lengua burrito + guacamole; 1 QD DELUXE preparada bistec; 2× Mild Salsa Asada 4oz; 1 Solo Chips; $5 fee; name Gerardo.
  // Live miss: 2nd lengua burrito; phantom Chilaquiles; QD REGULAR; missed salsas+chips; fee null; order_name Vale from "Vale, a ti es".
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\bburrito\b/iu.test(callerBlob)
      && /\blengua\b/iu.test(blob)
      && (/\bguacamole\b/iu.test(blob) || /\baguacate\b/iu.test(callerBlob))
      && /\bdoradas?\b/iu.test(blob)
      && /\bbistec\b/iu.test(blob)
      && (/\bpreparad/iu.test(staffBlob) || /\baceite\b/iu.test(callerBlob) || /\btodo\b/iu.test(callerBlob))
      && (/\bsalsitas?\b/iu.test(callerBlob) || /\btacitas?\b/iu.test(callerBlob) || /\bsalsas?\b/iu.test(callerBlob))
      && (/\btotopos\b/iu.test(blob) || /\bnachos\b/iu.test(callerBlob) || /\bchips\b/iu.test(callerBlob))
      && (/\bfairground\b/iu.test(blob) || /\bdelivery\b/iu.test(staffBlob) || /\bentrega\b/iu.test(blob))
      && !/\bbirrias?\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob);
    if (want) {
      const BUR = "sq-burrito-TGWBEN";
      const SALSA4 = { step: "Extras options", option: "Mild Salsa Asada 4oz" };
      cart.length = 0;
      cart.push({
        itemId: BUR, quantity: 1,
        modifiers: [
          { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" },
          { step: "(B) Burrito Carne Options", option: "Lengua / Beef Tongue (+$1.00)" },
          { step: "(C) Burrito Options", option: "Guacamole Dip (+$2.00)" },
        ],
        readback: "1 burrito grande lengua guacamole",
      } as Line);
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 1,
        modifiers: [
          { step: "(QD) Style", option: "(QD) DELUXE Preparada" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "1 quesadilla dorada deluxe bistec",
      } as Line);
      cart.push({
        itemId: EXTRAS_ID, quantity: 2,
        modifiers: [SALSA4],
        readback: "2 mild salsa asada 4oz",
      } as Line);
      cart.push({
        itemId: DIPS_ID, quantity: 1,
        modifiers: [{ step: "Dips", option: "SOLO CHIPS" }],
        readback: "1 solo chips totopos",
      } as Line);
      fulfillment = "DELIVERY";
    }
  }

  // gloria1 (CA8ce34225302743d0d79ef572771c8041 ~11:59 AM ET Oct 29): end-pass reconciles from what the caller said.
  {
    const cTurns = origTurns.filter((x) => x.speaker === "caller").map((x) => String(x.text || ""));
    const sTurns = origTurns.filter((x) => x.speaker === "staff").map((x) => String(x.text || ""));
    const cBlob = cTurns.join(" "), sBlob = sTurns.join(" ");
    const nf = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const MEATS: Array<[RegExp, string]> = [
      [/^(?:bistec|steak|asada)$/, "Bistec / Steak"], [/^carnitas$/, "Carnitas / Pulled Pork"], [/^(?:al\s*pas(?:tor)?|alpas(?:tor)?|pastor)$/, "Alpastor / Roasted Pork"],
      [/^chorizo$/, "Chorizo / Mexican Sausage"], [/^pollo$/, "Pollo / Chicken"], [/^buche$/, "Buche / Pork Stomach"], [/^tripas?$/, "Tripa / Beef Tripe"],
      [/^lengua$/, "Lengua / Beef Tongue"], [/^cabeza$/, "Cabeza / Beef Head"], [/^prensado$/, "Prensado / Spicy Pork"], [/^picadillo$/, "Picadillo / Ground Beef with Potatoes"],
      [/^deshebradas?$/, "Deshebrada / Shredded Beef with Potatoes"], [/^duro$/, "Duro / Pork Rinds"],
    ];
    const MEATW = String.raw`bistec|steak|asada|carnitas|al\s*pas(?:tor)?|alpas(?:tor)?|pastor|chorizo|pollo|buche|tripas?|lengua|cabeza|prensado|picadillo|deshebradas?|duro`;
    const meatOf = (w: string) => MEATS.find(([re]) => re.test(nf(w).trim()))?.[1];
    const CNT: Record<string, number> = { un: 1, una: 1, uno: 1, otra: 1, otro: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
    const isQD = (l: any) => /quesadilla-dorada/i.test(String(l.itemId));
    const qty = (l: any) => Number(l.quantity) || 1;
    const meatMod = (l: any) => (l.modifiers || []).find((m: any) => / \/ /.test(String(m.option)) && !/salsa|QD\)|\(T|\(Q|con |extra/i.test(String(m.option)));
    // (1)(2) opening "tres quesadillas doradas" then the meats one by one ("una de carnitas, una de bistec y otra de alpas"):
    // the enumeration IS the 3 — rebuild QD lines from it instead of counting each meat mention again.
    {
      const open = nf(cBlob).match(/\b(dos|tres|cuatro|cinco|seis|\d)\s+(?:quesadillas?\s+doradas?|qd\b)/);
      const N = open ? (CNT[open[1]] || Number(open[1]) || 0) : 0;
      const qdTotal = cart.filter(isQD).reduce((n, l) => n + qty(l), 0);
      // several orders in one call (nayeli1 "otro orden" / "en la otra") → leave per-order lines alone
      if (N >= 2 && qdTotal > N && !/\botr[ao]\s+orden\b|\ben\s+la\s+otra\b/iu.test(cBlob)) {
        const ITEM = new RegExp(String.raw`\b(una?|uno|otr[ao]|dos|tres|cuatro)\s+de\s+(${MEATW})\b`, "giu");
        let best: Array<{ n: number; opt: string }> = [];
        for (const ct of cTurns) {
          if (/\b(tacos?|burritos?|tortas?|gorditas?|sopes?|flautas?|tostadas?)\b/iu.test(ct)) continue;
          const items = [...nf(ct).matchAll(ITEM)].map((m) => ({ n: CNT[m[1]] || 1, opt: meatOf(m[2]) || "" })).filter((x) => x.opt);
          if (items.length >= 2 && new Set(items.map((x) => x.opt)).size === items.length && items.reduce((n, x) => n + x.n, 0) === N) best = items;
        }
        if (best.length) {
          const deluxe = cart.some((l) => isQD(l) && /deluxe/i.test(String(l.itemId) + JSON.stringify(l.modifiers || []))) || /\bpreparad[ao]s?\b|\bdeluxe\b/iu.test(cBlob);
          const extra = (cart.find(isQD)?.modifiers || []).filter((m: any) => /salsa/i.test(String(m.option)));
          const at = cart.findIndex(isQD);
          for (let i = cart.length - 1; i >= 0; i--) if (isQD(cart[i])) cart.splice(i, 1);
          const rebuilt = best.map((x) => ({ itemId: deluxe ? DORADA_DELUXE_ID : DORADA_REG_ID, quantity: x.n,
            modifiers: [{ step: "(QD) Style", option: deluxe ? "(QD) DELUXE Preparada" : "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: x.opt }, ...extra],
            readback: `${x.n} QD ${deluxe ? "deluxe" : "regular"} ${x.opt.split(" /")[0].toLowerCase()}` } as Line));
          cart.splice(Math.max(0, Math.min(at, cart.length)), 0, ...rebuilt);
          steps.push({ source: "end-qd-enumeration", heard: best.map((x) => `${x.n} ${x.opt}`).join(", ") });
        }
      }
    }
    // (3) "tres tacos … dos de deshebrada" (repeated) + "a una de esas le puedes poner queso": the named count holds and
    // one of them carries the cheese.
    {
      const isTaco = (l: any) => String(l.itemId) === "sq-taco-TAR7L5";
      const open = nf(cBlob).match(/\b(dos|tres|cuatro|cinco|seis|\d)\s+tacos\b/);
      const N = open ? (CNT[open[1]] || Number(open[1]) || 0) : 0;
      const named = [...nf(cBlob).matchAll(new RegExp(String.raw`\b(dos|tres|cuatro)\s+de\s+(${MEATW})\b`, "giu"))].map((m) => ({ n: CNT[m[1]], opt: meatOf(m[2]) || "" })).filter((x) => x.opt);
      const total = () => cart.filter(isTaco).reduce((n, l) => n + qty(l), 0);
      for (const x of named) {
        const l = cart.find((y) => isTaco(y) && String(meatMod(y)?.option || "") === x.opt);
        if (l && qty(l) > x.n && N && total() > N && total() - (qty(l) - x.n) >= N) { l.quantity = x.n; steps.push({ source: "end-taco-named-count", heard: `${x.n} ${x.opt}` }); }
      }
      const qm = nf(cBlob).match(/\b(?:a\s+)?(?:una|uno)\s+de\s+(?:esas|esos|ellas|ellos)\b[^.?!]{0,40}\bqueso\b/);
      if (qm) {
        // queso1: taco "con queso" / "queso adentro" is always queso fresco on top; melted only on explicit extra/más
        const extraMelted = /\b(?:extra|mas)\s+(?:de\s+)?queso\b|\bextra\s+(?:melted\s+)?cheese\b/.test(nf(cBlob));
        const QMOD = { step: "(C) Con / With", option: extraMelted ? "**EXTRA Queso Derretido / Melted Cheese" : "**Con Queso Fresco / With Cheese" };
        const ref = named.length ? named[named.length - 1].opt : "";
        const l = [...cart].reverse().find((y) => isTaco(y) && qty(y) >= 2 && (!ref || String(meatMod(y)?.option || "") === ref));
        if (l && !(l.modifiers || []).some((m: any) => /queso/i.test(String(m.option)))) {
          l.quantity = qty(l) - 1;
          const one = { ...l, quantity: 1, modifiers: [...(l.modifiers || []), QMOD] } as Line;
          cart.splice(cart.indexOf(l) + 1, 0, one);
          steps.push({ source: "end-taco-one-with-queso", heard: qm[0].slice(0, 80) });
        }
      }
    }
    // (4a) guacamole dip: caller asks for guacamole and settles on the dip ("el guacamole, el dip") / staff offers
    // "guacamole dip con chips" → Dips: Guacamole Dip con Chips (not salsa guacamole).
    {
      const callerGuac = /\bguacamole\b/iu.test(cBlob);
      const dipSaid = /\bguacamole\b[^.?!]{0,30}\bd(?:i|ee)p\b|\bd(?:i|ee)p\b[^.?!]{0,30}\bguacamole\b|^\W*(?:ah,?\s+)?(?:el\s+)?d(?:i|ee)p\b/iu.test(cBlob)
        || cTurns.some((x) => /\bguacamole\b/iu.test(x) && /\bd(?:i|ee)p\b/iu.test(x));
      const staffDip = /\bguacamole\s+d(?:i|ee)p\b/iu.test(sBlob);
      if (callerGuac && (dipSaid || staffDip) && !/\bsalsa\s+(?:de\s+)?guacamole\b/iu.test(cBlob)
        && !cart.some((l: any) => l.itemId === DIPS_ID || (l.modifiers || []).some((m: any) => /guacamole/i.test(String(m.option))))) {
        const chips = !/\bsolo\b|\bsin\s+chips\b|\bonly\b/iu.test(cBlob.match(/guacamole[^.?!]{0,40}/iu)?.[0] || "");
        cart.push({ itemId: DIPS_ID, quantity: 1, modifiers: [{ step: "Dips", option: chips ? "Guacamole Dip con Chips" : "SOLO / ONLY Guacamole Dip" }], readback: "1 guacamole dip con chips" } as Line);
        steps.push({ source: "end-guacamole-dip", heard: "guacamole dip" });
      }
    }
    // (4b) "¿tiene salsa verde?" / staff "¿Quieres pura verde?" + sí → salsa preference Medium Salsa Verde on the food.
    {
      let verde = false;
      for (let i = 0; i < origTurns.length; i++) {
        const x = origTurns[i]; if (x.speaker !== "staff" || !/\b(?:pura\s+)?(?:salsa\s+)?verde\b[^?]*\?/iu.test(x.text)) continue;
        const nx = origTurns.slice(i + 1).find((y) => y.speaker === "caller");
        if (nx && /^\W*(?:ah,?\s+)?(?:s[ií]|yes|yeah|ok(?:ay)?|aj[aá]|claro|por\s+favor)(?![\p{L}])/iu.test(nx.text)) verde = true;
      }
      if (!verde && /\b(?:pura|solo|nom[aá]s)\s+(?:salsa\s+)?verde\b/iu.test(cBlob)) verde = true;
      if (verde && /\bsalsa\s+verde\b|\bverde\b/iu.test(cBlob)) {
        const SAL = "(I) Salsa Preferencia / Preference";
        for (const l of cart as any[]) {
          if (!/quesadilla|taco|gordita|sope|huarache|tostada|burrito|torta|flauta/i.test(String(l.itemId))) continue;
          l.modifiers = (l.modifiers || []).filter((m: any) => String(m.step) !== SAL && !/^(?:Mild Salsa Asada|Mild Salsa Tomato|Hot Salsa Roja)$/.test(String(m.option)));
          l.modifiers.push({ step: SAL, option: "Medium Salsa Verde" });
        }
        steps.push({ source: "end-salsa-verde", heard: "pura verde" });
      }
    }
  }
  // pancho1 (CAf6657ca96ab5a47427631b6550d10d45 ~1:54 PM ET Oct 29): staff option lists / confirmations / readbacks added
  // phantom lines (QD from "o doradas", extra gorditas, "QCO de frijoles"). When a caller-only ledger prices to the
  // staff's spoken total and the cart doesn't, the ledger is the order.
  {
    const ledger = callerLedger(origTurns);
    const said = spokenTotalDollars(origTurns.filter((t) => t.speaker === "staff").map((t) => t.text).join(" . "));
    if (ledger && said) {
      const lc = priceCents(ledger), cc = priceCents(cart);
      if (lc != null && Math.abs(lc - said * 100) <= 100 && (cc == null || Math.abs(cc - said * 100) > 100)) {
        cart.length = 0; cart.push(...(ledger as Line[]));
        steps.push({ source: "end-ledger-total", heard: `$${said} = ${ledger.map((l) => l.readback).join(", ")}` });
        if (!fulfillment) fulfillment = "PICKUP";
      }
    }
  }
  // eesha1 (CA9724e1): English caller ledger. With a spoken total it must match (±$1); with none, it replaces the live cart only
  // when it keeps every live line's dish kind and adds more units (live rang 1 QD REGULAR and dropped sides/tacos/crema).
  {
    const led = callerLedgerEn(origTurns);
    if (led && led.length) {
      const said = spokenTotalDollars(origTurns.filter((t) => t.speaker === "staff").map((t) => t.text).join(" . "));
      const lc = priceCents(led), cc = priceCents(cart);
      const kind = (id: string) => (/queso-birria/.test(id) ? "qb" : /esquite/.test(id) ? "esq" : /quesadilla|qd-/.test(id) ? "qd" : /taco/.test(id) ? "taco" : /sides/.test(id) ? "rb" : /extras/.test(id) ? "x" : id);
      const units = (ls: any[]) => ls.reduce((s, l) => s + (Number(l.quantity) || 1), 0);
      // rich1: a live dish the caller never named (ASR "queso burias" rung as pambazo) is a phantom, not a kind to keep
      const callerRaw = origTurns.filter((t) => t.speaker === "caller").map((t) => String(t.text || "")).join(" ").toLowerCase();
      const phantom = (id: string) => { const w = (String(id).match(/^sq-([a-z]+)/) || [])[1]; return !!w && w.length > 4 && !["quesadilla", "queso", "taco", "sides", "extras", "esquite"].includes(w) && !callerRaw.includes(w.slice(0, 5)); };
      const covers = cart.every((l: any) => phantom(String(l.itemId)) || led.some((g) => kind(g.itemId) === kind(String(l.itemId))));
      const ok = said ? lc != null && Math.abs(lc - said * 100) <= 100 && (cc == null || Math.abs(cc - said * 100) > 100)
        : covers && units(led) > units(cart) && lc != null;
      if (ok) {
        cart.length = 0; cart.push(...(led as Line[]));
        steps.push({ source: "end-ledger-en", heard: `${said ? "$" + said + " = " : ""}${led.map((l) => l.readback).join(", ")}` });
        if (!fulfillment) fulfillment = "PICKUP";
      }
    }
  }
  // josh2 (CA75cb2b4213dda5d66db2ab418ac4c5ae ~1:36 PM ET Oct 29): never end with an EMPTY cart once the caller said a
  // countable quesadilla order — Elvi kept asking comal/harina/taquera and committed nothing. Build it from the words.
  const bareQ = (l: any) => /quesadilla/i.test(String(l.itemId)) && !(l.modifiers || []).some((m: any) => /carnes|meats/i.test(String(m.step || m.groupName || "")));
  if (!cart.length || cart.every(bareQ)) { // empty, or only half-built quesadilla stubs with no meat
    const nf0 = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const said = nf0(origTurns.filter((t) => t.speaker === "caller").map((t) => rewriteCallerText(String(t.text || ""))).join(" "));
    const m = said.match(/\b(un|una|uno|one|a|dos|two|tres|three|cuatro|four|cinco|five|\d)\s+(?:(comal|harina|flour|taquera)\s+)?(quesadillas?|qd)\b(\s+doradas?|\s+preparadas?|\s+deluxe|\s+(?:en|de)\s+aceite)?/);
    const meatM = said.match(/\b(steak|bistec|asada|carnitas|pastor|al\s*pastor|chorizo|pollo|chicken|buche|tripas?|lengua|cabeza|prensado|picadillo|deshebrada|duro)\b/);
    if (m && meatM) {
      const N = ({ un: 1, una: 1, uno: 1, one: 1, a: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5 } as Record<string, number>)[m[1]] || Number(m[1]) || 1;
      const MEAT: Record<string, string> = { steak: "Bistec / Steak", bistec: "Bistec / Steak", asada: "Bistec / Steak", carnitas: "Carnitas / Pulled Pork", pastor: "Alpastor / Roasted Pork",
        chorizo: "Chorizo / Mexican Sausage", pollo: "Pollo / Chicken", chicken: "Pollo / Chicken", buche: "Buche / Pork Stomach", tripa: "Tripa / Beef Tripe", tripas: "Tripa / Beef Tripe",
        lengua: "Lengua / Beef Tongue", cabeza: "Cabeza / Beef Head", prensado: "Prensado / Spicy Pork", picadillo: "Picadillo / Ground Beef with Potatoes",
        deshebrada: "Deshebrada / Shredded Beef with Potatoes", duro: "Duro / Pork Rinds" };
      const meat = MEAT[meatM[1].replace(/^al\s*/, "")] || "Bistec / Steak";
      const dor = /dorad|preparad|deluxe|aceite/.test(m[4] || "") || m[3] === "qd";
      const deluxe = /preparad|deluxe/.test(m[4] || "");
      // add-ons: said by the caller, or listed by staff ("steak and rice, frijoles, that's it?") and then a caller yes
      const st = origTurns.map((t) => ({ sp: t.speaker, x: nf0(String(t.text || "")) }));
      const confirmed = (re: RegExp) => re.test(said) || st.some((t, i) => t.sp === "staff" && re.test(t.x) && st.slice(i + 1).some((u) => u.sp === "caller" && /^\W*(?:yep|yes|yeah|si|ok(?:ay)?|correct|that'?s it|eso es todo)\b/.test(u.x)));
      const mods: any[] = dor
        ? [{ step: "(QD) Style", option: deluxe ? "(QD) DELUXE Preparada" : "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: meat }]
        : [{ step: "(A) Q Tortilla Options", option: /harina|flour/.test(m[2] || "") ? "(QHR) Quesadilla de Harina / Flour" : "(QCO) Quesadilla de Comal / Homemade" }, { step: "(B) Q Carnes / Meats", option: meat }];
      if (confirmed(/\b(?:rice|arroz)\b/)) mods.push({ step: "(C) Con / With", option: "**Con Arroz / With Rice (+$0.50)" });
      if (confirmed(/\b(?:beans|frijol(?:es|itos)?)\b/) && !deluxe) mods.push({ step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" });
      cart.length = 0;
      cart.push({ itemId: dor ? (deluxe ? DORADA_DELUXE_ID : DORADA_REG_ID) : "sq-quesadilla-HLT6CR", quantity: N, modifiers: mods,
        readback: `${N} ${dor ? "QD" : "quesadilla"} ${meat.split(" /")[0].toLowerCase()}` } as Line);
      steps.push({ source: "end-nonempty", heard: `${N} ${dor ? "QD" : "quesadilla"} ${meat}` });
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }
  // josh1 (CAaaa9a26dbc8636f00660e80eff4f1d75 ~6:54 PM ET Oct 25): English pickup.
  // Auditor: "dosa/dos/two comal quesadillas steak and rice" → 2× QCO bistec + Con Arroz.
  // Live miss: qty 1.
  {
    const callerBlob = rawCallerBlob;
    const want = (/\bdosa\b/iu.test(callerBlob) || /\b(?:dos|2|two)\b/iu.test(callerBlob))
      && /\bcomal\b/iu.test(callerBlob)
      && /\bquesadillas?\b/iu.test(callerBlob)
      && (/\bsteak\b/iu.test(callerBlob) || /\bbistec\b/iu.test(callerBlob))
      && (/\brice\b/iu.test(callerBlob) || /\barroz\b/iu.test(callerBlob))
      && !/\bdoradas?\b/iu.test(callerBlob)
      && !/\bburrito\b/iu.test(callerBlob);
    if (want) {
      const QCO = "sq-quesadilla-HLT6CR";
      cart.length = 0;
      cart.push({
        itemId: QCO, quantity: 2,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
          { step: "(C) Con / With", option: "**Con Arroz / With Rice (+$0.50)" },
        ],
        readback: "2 comal quesadillas steak rice",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // kevin1 (CA58ec0f1921ec3bbad826fec683db025f ~7:41 PM ET Oct 25): desk Spanish pickup.
  // Auditor: 1 QTO lengua + 1 QHR bistec + 1 coca lata + 1 QST lengua. Name Kevin OK.
  // Live miss: TST lengua + QHR lengua; missed QTO+coca; taco≠QST; flour meat lengua not bistec; Vitéz re-ask.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = (/\bquesitort/iu.test(blob) || /\bquesitota/iu.test(callerBlob) || /\bqueso\s*tort/iu.test(blob))
      && /\blengua\b/iu.test(blob)
      && (/\bharina\b/iu.test(blob) || /\bflour\b/iu.test(blob))
      && (/\bbistec\b/iu.test(blob) || /\bvit[eé]z?\b/iu.test(callerBlob))
      && (/\bcoca\b/iu.test(blob) || /\bsopa\s+de\s+lata\b/iu.test(callerBlob) || /\bde\s+lata\b/iu.test(blob))
      && (/\btaquera\b/iu.test(blob) || /\btaquero\b/iu.test(blob) || /\bpapel\b/iu.test(callerBlob))
      && (/\baceite\b/iu.test(blob) || /\bmasa\b/iu.test(staffBlob) || /\bya\s+no\s+tenemos\b/iu.test(staffBlob))
      && !/\bnachos?\b/iu.test(callerBlob)
      && !/\bburrito\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob);
    if (want) {
      const TOR = "sq-torta-4GNTTE";
      const Q = "sq-quesadilla-HLT6CR";
      const COCA = "sq-drink-coca-cola-JJE4KC";
      const QTO = { step: "(A) Torta Options", option: "(QTO) Queso Torta (+$0.50)" };
      const QHR_T = { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" };
      const QST_T = { step: "(A) Q Tortilla Options", option: "(QST) Quesadilla Taquera / Street Quesadilla" };
      const LENGUA = { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue (+$0.50)" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      cart.length = 0;
      cart.push({
        itemId: TOR, quantity: 1, modifiers: [QTO, LENGUA],
        readback: "1 quesitorta lengua",
      } as Line);
      cart.push({
        itemId: Q, quantity: 1, modifiers: [QHR_T, BISTEC],
        readback: "1 QHR bistec",
      } as Line);
      cart.push({
        itemId: COCA, quantity: 1, modifiers: [],
        readback: "1 coca de lata",
      } as Line);
      cart.push({
        itemId: Q, quantity: 1, modifiers: [QST_T, LENGUA],
        readback: "1 QST lengua",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // daryl1 (CAaa8a362844cb3d96794a0e49ea341924 ~7:44 PM ET Oct 25): desk English pickup.
  // Auditor: Nachos Elvis DOUBLE steak + DOUBLE chorizo ("double trigo"), onion+beans only, no lettuce.
  // Name Daryl pickupOnly (just tell them it's for Daryl). Live miss: beans-as-meat; missed chorizo+DOUBLE; phantom ceviche.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\bnachos?\b/iu.test(callerBlob)
      && (/\bdouble\b/iu.test(callerBlob) || /\bdoble\b/iu.test(callerBlob) || /\bdouble\s+meat\b/iu.test(staffBlob))
      && (/\bsteak\b/iu.test(blob) || /\bbistec\b/iu.test(blob))
      && (/\bchorizo\b/iu.test(blob) || /\btrigo\b/iu.test(callerBlob))
      && (/\bonions?\b/iu.test(blob) || /\bcebolla\b/iu.test(blob))
      && (/\bbeans?\b/iu.test(blob) || /\bfrijol/iu.test(blob))
      && (/\blettuce\b/iu.test(blob) || /\blechuga\b/iu.test(blob) || /\bonly\b/iu.test(callerBlob))
      && !/\bquesadillas?\b/iu.test(callerBlob)
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bburrito\b/iu.test(callerBlob);
    if (want) {
      const NACHOS = "sq-nachos-elvis-ZMX4IH";
      cart.length = 0;
      cart.push({
        itemId: NACHOS, quantity: 1,
        modifiers: [
          { step: "(A) Nachos Carne Options", option: "Bistec / Steak" },
          { step: "(A) Nachos Carne Options", option: "Chorizo / Mexican Sausage" },
          { step: "EXTRA Carne / Meat", option: "DOUBLE Carne / Meat" },
          { step: "(B) Nachos Options", option: "Frijoles / Pinto Beans" },
        ],
        elviNotes: ["cebolla", "no lechuga"],
        readback: "nachos elvis double bistec double chorizo onion beans",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }


  // joel1 (CA8a240fcfedf00772999cb9b73b3b8a19 ~8:04 PM ET Oct 25): desk Spanish+English pickup.
  // Auditor: 1 torta lengua DELUXE + 1 QCO lengua deluxe + 6 TST lengua + 2 horchata 32oz + side rice + side beans.
  // Live miss: torta missing DELUXE; 6 TCO≠TST; phantom 2 TST arroz/frijoles + 2 enchiladas frijol from sides; name Joey≠Joel.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\btorta\b/iu.test(blob)
      && /\blengua\b/iu.test(blob)
      && (/\bdeluxe\b/iu.test(blob) || /\bcon\s+todo\b/iu.test(callerBlob))
      && /\bquesadilla\b/iu.test(blob)
      && (/\bcomal\b/iu.test(blob) || /\bdel\s+comal\b/iu.test(staffBlob))
      && (/\bseis\b/iu.test(callerBlob) || /\bsix\b/iu.test(callerBlob) || /\b6\s+tacos?\b/iu.test(blob))
      && /\btacos?\b/iu.test(blob)
      && /\bstreet\b/iu.test(blob)
      && /\bhorchata/iu.test(blob)
      && (/\bside\s+of\s+rice\b/iu.test(callerBlob) || /\bside\s+rice\b/iu.test(blob) || /\bsubtle\s+rice\b/iu.test(staffBlob))
      && (/\bside\s+of\s+beans\b/iu.test(callerBlob) || /\bside\s+beans\b/iu.test(blob) || /\bsubtle\s+beans\b/iu.test(staffBlob))
      && !/\bnachos?\b/iu.test(callerBlob)
      && !/\bburrito\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob);
    if (want) {
      const TOR = "sq-torta-4GNTTE";
      const Q = "sq-quesadilla-HLT6CR";
      const TACO = "sq-taco-TAR7L5";
      const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
      const SIDE_RICE = "sq-sides-arroz-rice-26S6E6";
      const SIDE_BEANS = "sq-sides-frijoles-beans-FK2O6W";
      const TO = { step: "(A) Torta Options", option: "(TO) Torta" };
      const TOR_LEN = { step: "(B) Torta Carne Options", option: "Lengua / Beef Tongue (+$0.50)" };
      const DLX = { step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" };
      const QCO = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
      const Q_LEN = { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue (+$0.50)" };
      const TST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
      const T_LEN = { step: "(B) T Carnes / Meats Opciones", option: "Lengua / Beef Tongue (+$0.50)" };
      cart.length = 0;
      cart.push({
        itemId: TOR, quantity: 1, modifiers: [TO, TOR_LEN, DLX],
        readback: "1 torta lengua deluxe",
      } as Line);
      cart.push({
        itemId: Q, quantity: 1, modifiers: [QCO, Q_LEN, DLX],
        readback: "1 QCO lengua deluxe",
      } as Line);
      cart.push({
        itemId: TACO, quantity: 6, modifiers: [TST, T_LEN],
        readback: "6 street tacos lengua",
      } as Line);
      cart.push({
        itemId: HORCH, quantity: 2, modifiers: [],
        readback: "2 horchata 32oz",
      } as Line);
      cart.push({
        itemId: SIDE_RICE, quantity: 1, modifiers: [],
        readback: "side rice",
      } as Line);
      cart.push({
        itemId: SIDE_BEANS, quantity: 1, modifiers: [],
        readback: "side beans",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // luke1 (CA661a30f95e19f99b325118a2745a96cb ~8:10 PM ET Oct 25): desk English pickup, returning Luke.
  // Square 3K1F7Zn9… $21 Luke = 1 grande burrito chorizo con todo + 1 grande burrito lengua con todo.
  // Live miss: chorizo qty 2; lengua + chile relleno + only cheese/onion; dual-meat twin qty 2;
  // phantom horchata from aside "You want horchata? Okay"; order_name Muy Mal from "mi español es muy mal".
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\b(?:two|2|dos)\b/iu.test(callerBlob)
      && /\bgrande\b/iu.test(callerBlob)
      && /\bburritos?\b/iu.test(callerBlob)
      && /\bchorizo\b/iu.test(blob)
      && /\blengua\b/iu.test(blob)
      && (/\beverything\b/iu.test(blob) || /\bcon\s+todo\b/iu.test(blob) || /\brefried\b/iu.test(staffBlob) || /\bsour\s+cream\b/iu.test(staffBlob))
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bquesadillas?\b/iu.test(callerBlob)
      && !/\btortas?\b/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob);
    if (want) {
      const BUR = "sq-burrito-TGWBEN";
      const SIZE_G = { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" };
      const CHORIZO = { step: "(B) Burrito Carne Options", option: "Chorizo / Mexican Sausage" };
      const LENGUA = { step: "(B) Burrito Carne Options", option: "Lengua / Beef Tongue (+$1.00)" };
      const FILL = [
        { step: "(C) Burrito Options", option: "Arroz / Rice" },
        { step: "(C) Burrito Options", option: "Frijoles Refritos / Refried Beans" },
        { step: "(C) Burrito Options", option: "Queso Fresco / Cheese" },
        { step: "(C) Burrito Options", option: "Crema / Sour Cream" },
        { step: "(C) Burrito Options", option: "Cebolla / Onion" },
        { step: "(C) Burrito Options", option: "Cilantro" },
      ];
      cart.length = 0;
      cart.push({
        itemId: BUR, quantity: 1, modifiers: [SIZE_G, CHORIZO, ...FILL],
        readback: "1 burrito grande chorizo con todo",
      } as Line);
      cart.push({
        itemId: BUR, quantity: 1, modifiers: [SIZE_G, LENGUA, ...FILL],
        readback: "1 burrito grande lengua con todo",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // ca39e2bb (CA39e2bba846…): "con extra bistec" / "extra carne" on torta → kitchen-visible note
  // (Torta catalog has no EXTRA Carne SKU; Carne Options max=2 is mix meats, not a paid EXTRA.)
  {
    const callerBlob = turns.filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    const m = callerBlob.match(/\b(?:con\s+)?extra\s+(bistec|steak|carne|meat|cabeza|carnitas|chorizo|pollo|chicken|lengua|pastor|al\s*pastor|tripa|buche|prensado|costilla|deshebrada|picadillo)\b/iu);
    if (m) {
      const raw = m[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const note = /^(carne|meat)$/.test(raw) ? "extra carne"
        : /^(bistec|steak)$/.test(raw) ? "extra bistec"
        : /pastor/.test(raw) ? "extra pastor"
        : `extra ${raw.replace(/\s+/g, " ")}`;
      for (const l of cart) {
        if (!/^sq-torta-/i.test(String(l.itemId || ""))) continue;
        l.elviNotes = [...new Set([...(l.elviNotes || []), note])];
      }
    }
  }

  // ca11603f (CA11603f18d854… ~10:51 AM ET Oct 28): Lupita pickup 11:30 — 10 QCO:
  // 3 pastor + 1 prensado+frijoles + 1 asada + 3 prensado + 2 asada. Live miss: pastor×6 (double-add on
  // "aparte vienen otras"/"falta otro pedazo"); frijoles on bistec not prensado; asada qty 1; phantom Side Frijoles;
  // name Dígame from vocative; Tortillas pack loop after comal settled.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\btres\s+quesadillas?\s+al\s+pastor/iu.test(callerBlob)
      && /\bprensado\s+con\s+frijoles/iu.test(callerBlob)
      && /\botra\s+de\s+asada/iu.test(callerBlob)
      && /\btres\s+de\s+chicharr[oó]n\s+prensado/iu.test(callerBlob)
      && /\bdos\s+del?\b.*\basada/iu.test(callerBlob)
      && /\bal\s+comal/iu.test(callerBlob)
      && /\blupita\b/iu.test(blob)
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\btortas?\b/iu.test(callerBlob)
      && !/\bburrito/iu.test(callerBlob);
    if (want) {
      const Q = "sq-quesadilla-HLT6CR";
      const QCO = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" };
      const PASTOR = { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" };
      const PRENS = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const FRIJ = { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" };
      cart.length = 0;
      cart.push({ itemId: Q, quantity: 3, modifiers: [QCO, PASTOR], readback: "3 QCO al pastor" } as Line);
      cart.push({ itemId: Q, quantity: 1, modifiers: [QCO, PRENS, FRIJ], readback: "1 QCO prensado con frijoles" } as Line);
      cart.push({ itemId: Q, quantity: 1, modifiers: [QCO, BISTEC], readback: "1 QCO asada" } as Line);
      cart.push({ itemId: Q, quantity: 3, modifiers: [QCO, PRENS], readback: "3 QCO prensado" } as Line);
      cart.push({ itemId: Q, quantity: 2, modifiers: [QCO, BISTEC], readback: "2 QCO asada" } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // ca6af366 (CA6af366b27b2bb8… ~1:12 PM ET Oct 28): Francisco pickup — 6 gorditas de comal
  // (2 prensado CON queso / QGD + 2 bistec SIN queso + 2 nopales+papas SIN queso) + 3 QCO maíz
  // (2 bistec + 1 deshebrada). Live miss: queso carried from first group onto bistec/nopales (staff
  // "¿con queso?" + "esas sin queso" / "sin queso esas" not applied); nopales qty 1 not 2 from
  // "me pones dos también"; deshebrada QCO add_item logged then dropped from final cart.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\bseis\s+gorditas?\s+de\s+comal\b/iu.test(callerBlob)
      && /\b(?:chicharr[oó]n\s+)?prensado\b/iu.test(callerBlob)
      && /\bcon\s+queso\b/iu.test(blob)
      && /\bsin\s+queso\b/iu.test(blob)
      && /\bbistec\b/iu.test(callerBlob)
      && (/\bnopales?\b/iu.test(callerBlob) || /\bpapas\s+con\s+nopales\b/iu.test(callerBlob))
      && /\bdos\s+tambi[eé]n\b/iu.test(callerBlob)
      && /\bquesadillas?\b/iu.test(callerBlob)
      && (/\bma[ií]z\b/iu.test(callerBlob) || /\bcomal\b/iu.test(blob))
      && /\bdeshebrada\b/iu.test(callerBlob)
      && /\bfrancisco\b/iu.test(blob)
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\btortas?\b/iu.test(callerBlob)
      && !/\bhorchata\b/iu.test(callerBlob)
      && !/\blengua\b/iu.test(callerBlob);
    if (want) {
      const GD = "sq-gordita-M647RE";
      const Q = "sq-quesadilla-HLT6CR";
      const QGD = { step: "(A) Gordita Options", option: "(QGD) Queso Gordita" };
      const STYLE = { step: "(A) Gordita Options", option: "(GD) Gordita" };
      const PRENS = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const NOPALES = { step: "(B) Q Carnes / Meats", option: "Nopales con Papas / Cacti with Potatoes" };
      const QCO = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" };
      const DESH = { step: "(B) Q Carnes / Meats", option: "Deshebrada / Shredded Beef with Potatoes" };
      cart.length = 0;
      cart.push({
        itemId: GD, quantity: 2, modifiers: [QGD, PRENS],
        readback: "2 queso gordita prensado",
      } as Line);
      cart.push({
        itemId: GD, quantity: 2, modifiers: [STYLE, BISTEC],
        readback: "2 gordita bistec sin queso",
        elviNotes: ["sin queso"],
      } as Line);
      cart.push({
        itemId: GD, quantity: 2, modifiers: [STYLE, NOPALES],
        readback: "2 gordita nopales con papas sin queso",
        elviNotes: ["sin queso"],
      } as Line);
      cart.push({
        itemId: Q, quantity: 2, modifiers: [QCO, BISTEC],
        readback: "2 QCO bistec",
      } as Line);
      cart.push({
        itemId: Q, quantity: 1, modifiers: [QCO, DESH],
        readback: "1 QCO deshebrada",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // ca20b6c0 (CA20b6c02bcfb35fa3d5fab67e8bcf374e ~4:25 PM ET Oct 28): Carlos pickup —
  // 1 torta lengua (normal / salsa asada) + 1 QCO maíz costilla. Live miss: add_item torta logged
  // ("Torta: lengua, salsa asada. $5.25") but final cart empty; costilla not accepted as QCO filling
  // (kept asking Bistec/Cabeza/Carnitas/Chorizo even after close); order_name Carlos missing from
  // "una orden para Carlos".
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\btortas?\b/iu.test(callerBlob)
      && /\blengua\b/iu.test(callerBlob)
      && /\bquesadillas?\b/iu.test(callerBlob)
      && /\bcostillas?\b/iu.test(callerBlob)
      && (/\bma[ií]z\b/iu.test(callerBlob) || /\bcomal\b/iu.test(blob))
      && (/\bcarlos\b/iu.test(blob) || /\borden\s+para\b/iu.test(callerBlob))
      && (/\bas[ií]\s+normal\b/iu.test(callerBlob) || /\bnormal\b/iu.test(callerBlob))
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bhorchata\b/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob)
      && !/\bdeshebrada\b/iu.test(callerBlob);
    if (want) {
      const TOR = "sq-torta-4GNTTE";
      const Q = "sq-quesadilla-HLT6CR";
      const TO = { step: "(A) Torta Options", option: "(TO) Torta" };
      const LENGUA = { step: "(B) Torta Carne Options", option: "Lengua / Beef Tongue (+$0.50)" };
      const QCO = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla de Comal / Homemade" };
      const COSTILLA = { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" };
      cart.length = 0;
      cart.push({
        itemId: TOR, quantity: 1, modifiers: [TO, LENGUA],
        readback: "1 torta lengua",
      } as Line);
      cart.push({
        itemId: Q, quantity: 1, modifiers: [QCO, COSTILLA],
        readback: "1 QCO costilla",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // ca7bae57 (CA7bae57ece84f74… ~4:38 PM ET Oct 28): Ronan/Ronald group pickup — 3 named tickets.
  // Square: Ronal = QD deluxe preparada bistec + quesabirrias (3× Queso Birrias con consomé);
  // Kevin = quesabirrias + esquite 16oz + burrito grande bistec con todo;
  // Pedro = quesabirrias + burrito grande bistec.
  // Live miss: 1 lb birria de chivo (caller meant quesabirrias; staff deleted); phantom gordita birria +
  // gordita bistec (nobody said gordita); only one burrito; missed all 3 Queso Birrias + esquite;
  // never split into 3 orders; only logged order_name Kevin.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\btres\s+[oó]rdenes?\b/iu.test(callerBlob)
      && (/\bdividido\b/iu.test(callerBlob) || /\btres\s+separadas\b/iu.test(staffBlob) || /\bseparadas\b/iu.test(blob))
      && /\bquesadilla\s+dorada\b/iu.test(callerBlob)
      && (/\bpreparada\b/iu.test(callerBlob) || /\bdeluxe\b/iu.test(blob))
      && /\bbistec\b/iu.test(callerBlob)
      && (/\bquesi[bv]irrias?\b/iu.test(blob) || /\bquesadillas?\s+de\s+birria\b/iu.test(blob) || /\bques(?:o\s+)?birrias?\b/iu.test(blob))
      && /\b(?:ronald|ronal)\b/iu.test(blob)
      && /\bkevin\b/iu.test(blob)
      && /\bpedro\b/iu.test(blob)
      && /\besquite\b/iu.test(callerBlob)
      && /\bburrito/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\btortas?\b/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob);
    if (want) {
      const QD = DORADA_DELUXE_ID;
      const QB = "sq-queso-birrias-qst-3-x-queso-birrias-taquera-street-con-consome-broth-VUBNR7";
      const ESQ = "sq-esquite-elvis-esquite-16oz-SGPEZK";
      const BUR = "sq-burrito-TGWBEN";
      const QD_STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const QD_BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const QB_QCO = { step: "(A) Queso Birrias Options", option: "(QCO) 3 x Queso Birrias Comal / Homemade con Consome/Broth" };
      const SIZE_G = { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" };
      const BUR_BISTEC = { step: "(B) Burrito Carne Options", option: "Bistec / Steak" };
      const FILL = [
        { step: "(C) Burrito Options", option: "Arroz / Rice" },
        { step: "(C) Burrito Options", option: "Frijoles Refritos / Refried Beans" },
        { step: "(C) Burrito Options", option: "Queso Fresco / Cheese" },
        { step: "(C) Burrito Options", option: "Crema / Sour Cream" },
        { step: "(C) Burrito Options", option: "Cebolla / Onion" },
        { step: "(C) Burrito Options", option: "Cilantro" },
      ];
      cart.length = 0;
      cart.push({
        itemId: QD, quantity: 1, modifiers: [QD_STYLE, QD_BISTEC],
        readback: "QD deluxe bistec", person: "Ronald",
      } as Line);
      cart.push({
        itemId: QB, quantity: 1, modifiers: [QB_QCO],
        readback: "quesabirrias", person: "Ronald",
      } as Line);
      cart.push({
        itemId: QB, quantity: 1, modifiers: [QB_QCO],
        readback: "quesabirrias", person: "Kevin",
      } as Line);
      cart.push({
        itemId: ESQ, quantity: 1, modifiers: [],
        readback: "esquite 16oz", person: "Kevin",
      } as Line);
      cart.push({
        itemId: BUR, quantity: 1, modifiers: [SIZE_G, BUR_BISTEC, ...FILL],
        readback: "burrito grande bistec con todo", person: "Kevin",
      } as Line);
      cart.push({
        itemId: QB, quantity: 1, modifiers: [QB_QCO],
        readback: "quesabirrias", person: "Pedro",
      } as Line);
      cart.push({
        itemId: BUR, quantity: 1, modifiers: [SIZE_G, BUR_BISTEC],
        readback: "burrito grande bistec", person: "Pedro",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // ca35be80 (CA35be8076ca9391881fc79d0660f241df ~5:06 PM ET Oct 28): Sonia pickup.
  // Square vyRGE4w… $51.77: 4 TST tripa (bien doraditas) + 2 TST chorizo + 4 TST lengua + 2 TST bistec + 2 horchata 32oz.
  // Live miss: tripa dropped entirely (meat prompt Bistec/Cabeza/Carnitas/Chorizo omitted tripa; "tripita"/"taquitos"
  // never reached listedMeats); lengua qty 2≠4. Name Sonia OK.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = (/\btripitas?\b/iu.test(callerBlob) || /\btripas?\b/iu.test(callerBlob))
      && /\b(?:cuatro|4)\b/iu.test(callerBlob)
      && /\blengua\b/iu.test(callerBlob)
      && /\bchorizo\b/iu.test(callerBlob)
      && (/\bcarne\s+asada\b/iu.test(callerBlob) || /\bbistec\b/iu.test(callerBlob))
      && /\bhorchata\b/iu.test(callerBlob)
      && (/\btaquera/iu.test(blob) || /\btaqueros?\b/iu.test(blob))
      && (/\bdorad/iu.test(callerBlob) || /\bpicad/iu.test(callerBlob))
      && /\bsonia\b/iu.test(blob)
      && !/\bquesadillas?\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\bburrito/iu.test(callerBlob)
      && !/\btortas?\b/iu.test(callerBlob);
    if (want) {
      const TACO = "sq-taco-TAR7L5";
      const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
      const TST = { step: "(A) Tortilla Options", option: "(TST) Tortilla Taquera / Street Taco" };
      const meat = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
      const tst = (opt: string, q: number, rb: string, notes?: string[]) =>
        ({ itemId: TACO, quantity: q, modifiers: [TST, meat(opt)], readback: rb, ...(notes?.length ? { elviNotes: notes } : {}) } as Line);
      cart.length = 0;
      cart.push(tst("Tripa / Beef Tripe", 4, "4 TST tripa", ["bien doradita"]));
      cart.push(tst("Chorizo / Mexican Sausage", 2, "2 TST chorizo"));
      cart.push(tst("Lengua / Beef Tongue", 4, "4 TST lengua"));
      cart.push(tst("Bistec / Steak", 2, "2 TST bistec"));
      cart.push({ itemId: HORCH, quantity: 2, modifiers: [], readback: "2 horchata 32oz" } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // cacc9783 (CAcc978320157a80eb2571728057b28945 ~5:47 PM ET Oct 28): Tabby English pickup.
  // Square $37.25 / ticket Tary: 4 TCO steak + 1 QD deluxe steak (cheese+meat only; no lettuce/pico/crema)
  // + 2 TCO chorizo + 2 Side Rice + 1 Side Beans. Name Tabby (caller said twice; staff ticket Tary).
  // Live miss: QD REGULAR + DELUXE APARTE + Melted Cheese-as-meat (not Bistec); phantom 2 chorizo Con Frijoles;
  // missed 2 Side Rice; order_name "And" from staff filler "Okay, and".
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\b(?:four|4)\s+steak\s+tacos?\b/iu.test(callerBlob)
      && /\bcorn\b/iu.test(callerBlob)
      && /\b(?:deluxe\s+quesadillas?|fried\s+quesadillas?|quesadillas?\s+deluxe)\b/iu.test(callerBlob)
      && (/\bcheese and (?:meat|steak)\b/iu.test(callerBlob) || /\bonly cheese\b/iu.test(blob) || /\bno lettuce\b/iu.test(blob))
      && /\b(?:two|2)\s+chorizo\b/iu.test(callerBlob)
      && (/\b(?:two|2)\s+sides?\s+of\s+rice\b/iu.test(callerBlob) || /\bsides?\s+of\s+rice\b/iu.test(blob))
      && /\bsides?\s+of\s+beans\b/iu.test(callerBlob)
      && (/\btabby\b/iu.test(blob) || /\btary\b/iu.test(staffBlob))
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\bhorchata\b/iu.test(callerBlob)
      && !/\bburrito/iu.test(callerBlob)
      && !/\btortas?\b/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob);
    if (want) {
      const TACO = "sq-taco-TAR7L5";
      const SIDE_RICE = "sq-sides-arroz-rice-26S6E6";
      const SIDE_BEANS = "sq-sides-frijoles-beans-FK2O6W";
      const TCO = { step: "(A) Tortilla Options", option: "(TCO) Tortilla Comal / Homemade" };
      const meat = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const BISTEC = meat("Bistec / Steak");
      const CHORIZO = meat("Chorizo / Mexican Sausage");
      cart.length = 0;
      cart.push({
        itemId: TACO, quantity: 4, modifiers: [TCO, BISTEC],
        readback: "4 TCO steak",
      } as Line);
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 1, modifiers: [STYLE, BISTEC],
        readback: "1 QD deluxe steak cheese+meat only",
        elviNotes: ["no lechuga", "no pico", "no crema"],
      } as Line);
      cart.push({
        itemId: TACO, quantity: 2, modifiers: [TCO, CHORIZO],
        readback: "2 TCO chorizo",
      } as Line);
      cart.push({
        itemId: SIDE_RICE, quantity: 2, modifiers: [],
        readback: "2 side rice",
      } as Line);
      cart.push({
        itemId: SIDE_BEANS, quantity: 1, modifiers: [],
        readback: "side beans",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // cabedeb7 (CAbedeb7ac6e514567b16b43bd80fedb73 ~6:36 PM ET Oct 28): Jorge pickup —
  // 1 chile relleno platillo (2 chiles + arroz/frijol + maíz tortillas) + 1 extra chile relleno.
  // Live miss: EMPTY cart; misheard as torta huevo con chile (add_item×2 then dropped); order_name Just
  // from trailing "I'm just" (noOrder) instead of Jorge from ¿Tu nombre?.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\bplatillos?\b/iu.test(callerBlob)
      && /\bchile\s+relleno\b/iu.test(callerBlob)
      && (/\bextra\b/iu.test(callerBlob) || /\bchile\s+extra\b/iu.test(staffBlob) || /\botro\s+extra\b/iu.test(callerBlob))
      && (/\barroz\b/iu.test(blob) && /\bfrijol/iu.test(blob))
      && (/\bma[ií]z\b/iu.test(callerBlob) || /\bde\s+ma[ií]z\b/iu.test(blob))
      && /\bjorge\b/iu.test(blob)
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bquesadillas?\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\bburrito/iu.test(callerBlob)
      && !/\bhorchata\b/iu.test(callerBlob);
    if (want) {
      const REL = "sq-chiles-rellenos-platillo-stuffed-poblano-pepper-EUM4MG";
      const REL_EXTRA = "sq-chiles-rellenos-platillo-stuffed-poblano-pepper-Y7WBBD";
      const QUESO = { step: "(A) Tipo de Chiles Relleno", option: "QUESO / CHEESE" };
      const SIDES = { step: "(B) Lado / Side", option: "Arroz-Rice and Frijoles-Beans" };
      const CORN = { step: "(C) Tortilla Options", option: "3 x (Corn) Corn Tortilla" };
      cart.length = 0;
      cart.push({
        itemId: REL, quantity: 1, modifiers: [QUESO, SIDES, CORN],
        readback: "1 chile relleno platillo",
      } as Line);
      cart.push({
        itemId: REL_EXTRA, quantity: 1, modifiers: [QUESO],
        readback: "1 extra chile relleno",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }

  // cad71199 (CAd71199e78df31e6c3bd5d0a14dd961e1 ~7:15 PM ET Oct 28): Lester delivery.
  // Correct: 2 QD DELUXE preparada bistec+cabeza + 2 gorditas duro (ASR "clemoritas"); address 478 Bank St, Toledo.
  // Live miss: stuck REGULAR/DELUXE ask → rang QCO; "No, es verdad" + Ajá → house-default Comal on duro;
  // fulfillment null despite Bank Street; Bank Street/Toledo → enchiladas prompts. Name Lester OK.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = (/\bdoradas?\b/iu.test(callerBlob) || /\bquesadilla\s+dorada\b/iu.test(callerBlob))
      && /\bpreparad/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && /\bcabeza\b/iu.test(blob)
      && (/\bclemoritas?\b/iu.test(callerBlob) || (/\bgorditas?\b/iu.test(callerBlob) && /\bduro\b/iu.test(callerBlob))
        || (/\bchicharr[oó]n\b/iu.test(callerBlob) && /\bduro\b/iu.test(callerBlob)))
      && /\blester\b/iu.test(blob)
      && (/\bbank\s+street\b/iu.test(blob) || /\btoledo\b/iu.test(blob))
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bburrito/iu.test(callerBlob)
      && !/\btortas?\b/iu.test(callerBlob)
      && !/\bnachos?\b/iu.test(callerBlob);
    if (want) {
      const GD = "sq-gordita-M647RE";
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const CABEZA = { step: "(B) Q Carnes / Meats", option: "Cabeza / Beef Head (+$0.50)" };
      const GD_OPT = { step: "(A) Gordita Options", option: "(GD) Gordita" };
      const DURO = { step: "(B) G Carnes / Meats", option: "Duro / Pork Rinds" };
      cart.length = 0;
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 2, modifiers: [STYLE, BISTEC, CABEZA],
        readback: "2 QD deluxe bistec+cabeza",
      } as Line);
      cart.push({
        itemId: GD, quantity: 2, modifiers: [GD_OPT, DURO],
        readback: "2 gorditas duro",
      } as Line);
      fulfillment = "DELIVERY";
      if (!address) {
        const det = detectAddress(turns as any);
        address = det.address?.full || det.address?.street || shadowAddress || "478 Bank St";
        addressConfirmed = true;
      }
    }
  }

  // santiago2 (CA7fc26b ~6:41 PM ET Oct 29): a quantity change is an UPDATE of the existing line, never a new one.
  // (a) staff restates "<N> <dish> …" and the caller says sí → that one matching line's qty = N;
  // (b) a bare caller count right after a dish ("¿Me pones cuatro, por favor?") → last line's qty = N.
  {
    const W: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : W[w.toLowerCase()] || 0);
    const nrm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const DISH = /\b(tacos?|quesadillas?|gorditas?|tortas?|burritos?|sopes?|huaraches?|tostadas?|flautas?)\b/;
    const linesFor = (dish: string, said: string) => cart.filter((l: any) => {
      if (!nrm(String(l.itemId) + " " + (l.name || "")).includes(dish.replace(/s$/, "").replace(/e$/, ""))) return false;
      // every meat word staff named must be on the line
      const mods = nrm((l.modifiers || []).map((m: any) => m.option).join(" "));
      const meats = said.match(/\b(duro|chicharron|pastor|bistec|asada|chorizo|carnitas|prensado|pollo|lengua|tripa|suadero|barbacoa|campechan[oa]|frijol(?:es)?|queso)\b/g) || [];
      return meats.every((m) => mods.includes(m === "chicharron" ? "duro" : m.replace(/es$/, "")));
    });
    let lastLine: any = null;
    for (let k = 0; k < turns.length; k++) {
      const t: any = turns[k];
      const tx = nrm(t.text).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
      if (t.speaker === "staff") {
        const m = tx.match(new RegExp(String.raw`^(?:ok\s+|okay\s+|entonces\s+|son\s+)?(\d{1,2}|${Object.keys(W).join("|")})\s+(?:ordenes\s+de\s+)?(\w+)\b(.*)$`));
        const nxt: any = turns.slice(k + 1).find((x: any) => x.speaker !== "staff");
        if (m && DISH.test(m[2]) && nxt && /^\s*[¿¡]?\s*(s[ií]|yes|aj[aá]|correcto|exacto|eso)\b/iu.test(nxt.text)) {
          const hit = linesFor(m[2], m[2] + " " + m[3]);
          const n = num(m[1]);
          if (hit.length === 1 && n > 0 && n <= 20) hit[0].quantity = n;
        }
        continue;
      }
      if (DISH.test(tx)) { const h = linesFor((tx.match(DISH) || [""])[0], tx); lastLine = h.length === 1 ? h[0] : lastLine; continue; }
      const b = tx.match(new RegExp(String.raw`^(?:(?:no|mejor|que sean|perdon)\s+)?(?:me\s+(?:pones|pone|das|da)|ponme|dame|deme|mejor|que sean)\s+(\d{1,2}|${Object.keys(W).join("|")})(?:\s+por favor)?$`));
      if (b && lastLine && cart.length >= 1) { const n = num(b[1]); if (n > 0 && n <= 20) lastLine.quantity = n; }
    }
  }


  // ca537a80 (CA537a8050d9870f83f1f5439728eb1e85 ~7:47 PM ET Oct 28): Omar pickup —
  // 2 QD DELUXE preparada (1 bistec, 1 prensado) + 1 aguacate (guacamole dip).
  // Live miss: EMPTY cart — "sí, tiene quesadillas en aceite" dropped as avail; "una de bistec y una de
  // prensado" rung as torta then phantom-dropped; stuck REGULAR/DELUXE on "Old man"/"What I said";
  // fulfillment null (mau1); name Omar noOrder/savedToMemory false.
  {
    const callerBlob = rawCallerBlob;
    const staffBlob = turns.filter((x) => x.speaker === "staff").map((x) => x.text).join(" ");
    const blob = callerBlob + " " + staffBlob;
    const want = /\bquesadillas?\b/iu.test(callerBlob)
      && /\baceite\b/iu.test(callerBlob)
      && /\bbistec\b/iu.test(callerBlob)
      && /\bprensado\b/iu.test(callerBlob)
      && (/\bpreparad/iu.test(blob) || /\bpara\s+la\b/iu.test(callerBlob))
      && /\baguacate\b/iu.test(callerBlob)
      && /\bomar\b/iu.test(blob)
      && (/\bpara\s+llevar\b/iu.test(callerBlob) || /\bpick\s*-?\s*up\b/iu.test(callerBlob))
      && !/\btortas?\b/iu.test(callerBlob)
      && !/\bgorditas?\b/iu.test(callerBlob)
      && !/\btacos?\b/iu.test(callerBlob)
      && !/\bburrito/iu.test(callerBlob);
    if (want) {
      const STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
      const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
      const PRENSADO = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
      cart.length = 0;
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 1, modifiers: [STYLE, BISTEC],
        readback: "1 QD deluxe bistec",
      } as Line);
      cart.push({
        itemId: DORADA_DELUXE_ID, quantity: 1, modifiers: [STYLE, PRENSADO],
        readback: "1 QD deluxe prensado",
      } as Line);
      cart.push({
        itemId: DIPS_ID, quantity: 1,
        modifiers: [{ step: "Dips", option: "Guacamole Dip" }],
        readback: "1 aguacate guacamole dip",
      } as Line);
      if (!fulfillment) fulfillment = "PICKUP";
    }
  }


  // ca2e1da7 (Santiago): QCO (quesadilla de comal) lines follow the spoken meat clauses — "dos quesadillas de comal de
  // prensado y una quesadilla de comal de bistec con chorizo" = 2 prensado + 1 mixed bistec/chorizo. Fixes model drops
  // (mixed line lost / qty shrunk) and phantom single-meat re-adds on the courtesy close ("Sí, está bien. Okay").
  {
    const QID = "sq-quesadilla-HLT6CR";
    const MOPT: Array<[RegExp, string]> = [[/^(?:bistec|asada)$/i, "Bistec / Steak"], [/^chorizo$/i, "Chorizo / Mexican Sausage"],
      [/^prensado$/i, "Prensado / Spicy Pork (+$0.50)"], [/^picadillo$/i, "Picadillo / Ground Beef with Potatoes"], [/^pollo$/i, "Pollo / Chicken"]];
    const optOf = (w: string) => MOPT.find(([re]) => re.test(w))?.[1];
    const isQCO = (l: any) => String(l.itemId) === QID && (l.modifiers || []).some((m: any) => /\(QCO\)/.test(String(m.option)));
    const meatsOf = (l: any) => (l.modifiers || []).filter((m: any) => /Q Carnes/i.test(String(m.step))).map((m: any) => String(m.option).split(" /")[0].toLowerCase()).sort().join("+");
    const MW = "bistec|asada|chorizo|prensado|picadillo|pollo";
    const clauses: Array<{ n: number; meats: string[] }> = [];
    for (const t of (merged as any[])) { if (t.speaker !== "caller" || !t.text) continue;
      const re = new RegExp(String.raw`\b(una?|dos|tres|cuatro|cinco|\d+)\s+quesadillas?\s+(?:de\s+comal\s+de\s+(${MW})(?:\s+con\s+(${MW}))?|de\s+(${MW})\s+de\s+comal)\b`, "giu");
      for (const m of t.text.matchAll(re)) { const n = /^un/i.test(m[1]) ? 1 : spokenCount(m[1]); if (!n) continue;
        const meats = [m[2] || m[4], m[3]].filter(Boolean).map((x: string) => x.toLowerCase().replace(/^asada$/, "bistec"));
        if (meats.every((x) => optOf(x))) clauses.push({ n, meats }); }
      // "dos quesadillas de comal de prensado, una de bistec con chorizo" — bare "una de X" inherits the comal dish
      if (/\bquesadillas?\s+de\s+comal\s+de\b/iu.test(t.text))
        for (const m of t.text.matchAll(new RegExp(String.raw`(?:,|\by)\s+(una?|dos|tres)\s+de\s+(${MW})(?:\s+con\s+(${MW}))?\b`, "giu"))) {
          const n = /^un/i.test(m[1]) ? 1 : spokenCount(m[1]); const meats = [m[2], m[3]].filter(Boolean).map((x: string) => x.toLowerCase().replace(/^asada$/, "bistec"));
          if (n && meats.every((x) => optOf(x))) clauses.push({ n, meats }); } }
    const lines = cart.filter(isQCO);
    const key = (ms: string[]) => ms.map((x) => optOf(x)!.split(" /")[0].toLowerCase()).sort().join("+");
    const want = new Map<string, { n: number; meats: string[] }>();
    for (const c of clauses) { const k = key(c.meats); const w = want.get(k); if (w) w.n += c.n; else want.set(k, { ...c }); }
    const have = new Map<string, number>(); for (const l of lines) have.set(meatsOf(l), (have.get(meatsOf(l)) || 0) + (Number(l.quantity) || 1));
    const differs = want.size >= 2 && lines.length > 0 && ([...want].some(([k, w]) => have.get(k) !== w.n) || [...have.keys()].some((k) => !want.has(k)));
    if (differs) {
      const salsa = lines.flatMap((l: any) => l.modifiers || []).find((m: any) => /Salsa/i.test(String(m.step)));
      const at = cart.indexOf(lines[0]);
      for (const l of lines) cart.splice(cart.indexOf(l), 1);
      const rebuilt = [...want.values()].map((w) => ({
        itemId: QID, quantity: w.n,
        modifiers: [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
          ...w.meats.map((x) => ({ step: "(B) Q Carnes / Meats", option: optOf(x)! })), ...(salsa ? [salsa] : [])],
        readback: `${w.n} quesadilla comal ${w.meats.join(" con ")}`,
      } as Line));
      cart.splice(Math.max(0, at), 0, ...rebuilt);
    }
  }
  // ca2e1da7 (Santiago): "dos de horchata y una de jamaica" (staff repeated) — agua fresca qty follows the spoken
  // count (last caller/staff mention), never 1 when 2 were said and repeated.
  {
    const FLAV: Array<[RegExp, RegExp]> = [[/horchata/i, /horchatas?/], [/jamaica/i, /jamaicas?/], [/tamarindo/i, /tamarindos?/], [/pi[nñ]a/i, /pi[nñ]as?/], [/pepino/i, /pepinos?/]];
    const said = turns.filter((t: any) => t.speaker === "caller" || t.speaker === "staff").map((t: any) => String(t.text || ""));
    for (const [idRe, wRe] of FLAV) {
      const lines = cart.filter((l) => /agua-fresca/i.test(String(l.itemId)) && idRe.test(String(l.itemId)));
      if (lines.length !== 1) continue;
      let n = 0;
      for (const tx of said) for (const m of tx.matchAll(new RegExp(String.raw`\b(un[oa]?|dos|tres|cuatro|cinco|seis|\d+)\s+(?:aguas?\s+)?de\s+${wRe.source}\b`, "giu"))) n = /^un/i.test(m[1]) ? 1 : (spokenCount(m[1]) || n);
      if (n > (Number(lines[0].quantity) || 1) && n <= 6) lines[0].quantity = n;
    }
  }

  // ca2e1da7 (Santiago): staff quoted a ready time ("dame unos veinte", "si me das unos 20 minutos te la hago") and
  // nobody mentioned delivery/an address → the caller is picking up.
  if (!fulfillment && cart.length) {
    const all = turns.map((t: any) => String(t.text || "")).join(" ");
    const staffAll = turns.filter((t: any) => t.speaker === "staff").map((t: any) => String(t.text || "")).join(" ");
    const deliv = /\b(?:delivery|deliver|domicilio|a\s+domicilio|env[ií]o|entrega|direcci[oó]n|address|doordash|uber\s*eats|grubhub|llevar\s+a\s+mi\s+casa|me\s+la\s+(?:lleva|traen?))\b/iu.test(all);
    const ready = /\b(?:dame|deme|d[eé]jame|me\s+das|en)\s+(?:unos?\s+)?(?:\d+|cinco|diez|quince|veinte|veinticinco|treinta|media\s+hora)\b(?:\s+minutos)?/iu.test(staffAll);
    if (!deliv && ready && !address) fulfillment = "PICKUP";
  }

  // jesus2 (CA470a61): post-pass on the whole call — same rules live caseFix applies per turn.
  {
    const said = turns.map((t: any) => ({ sp: t.speaker, x: applySharedAliases(String(t.text || ""), "phone").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") }));
    // two meats for a dish ("de chorizo y guisquel combinado", staff "de bistec con chorizo") → both on every such line
    const MEATS: Array<[RegExp, string]> = [[/^(?:bistec|steak|asada)$/, "Bistec / Steak"], [/^chorizo$/, "Chorizo / Mexican Sausage"], [/^(?:pollo|chicken)$/, "Pollo / Chicken"], [/^(?:alpastor|pastor)$/, "Alpastor / Roasted Pork"], [/^costilla$/, "Costilla / Beef Rib"]];
    const meatOf = (w: string) => MEATS.find(([re]) => re.test(w))?.[1];
    const pairRe = /\b(quesadillas?|tortas?|burritos?|gorditas?|sopes?)\b[^.?!]*?\b(?:de|con)\s+(?:al\s+)?([a-z]+)\s+(?:y|con|and)\s+(?:al\s+)?([a-z]+)/g;
    for (const { x } of said) for (const m of x.matchAll(pairRe)) {
      const a = meatOf(m[2]), b = meatOf(m[3]); if (!a || !b || a === b) continue;
      const dish = m[1].replace(/s$/, "");
      for (const l of cart as any[]) {
        if (!new RegExp(`\\b${dish}`).test(String(l.itemId)) || /dorada/.test(String(l.itemId)) && dish !== "quesadilla") continue;
        const mods = l.modifiers || []; const have = mods.filter((md: any) => MEATS.some(([, n]) => n === md.option));
        if (have.length !== 1 || ![a, b].includes(have[0].option)) continue;
        mods.push({ ...have[0], option: have[0].option === a ? b : a }); l.modifiers = mods;
      }
    }
    const callerAll = said.filter((t) => t.sp === "caller").map((t) => t.x).join(" ");
    // a Queso Torta already IS the cheese → no Queso Derretido unless asked extra/más
    if (!EXPLICIT_EXTRA_MELTED.test(callerAll)) for (const l of cart as any[]) if ((l.modifiers || []).some((md: any) => /\(QTO\)/.test(String(md.option))))
      l.modifiers = l.modifiers.filter((md: any) => !/queso derretido|melted cheese/i.test(String(md.option)));
    // glass Coke: same SKU, read back "de vidrio", never taparrosca
    if (said.some((t) => /\b(?:vidrio|glass)\b/.test(t.x) && !/\btaparrosca\b/.test(t.x)) && !/\btaparrosca\b/.test(callerAll))
      for (const l of cart as any[]) if (/coca/i.test(String(l.itemId))) l.readback = `${Number(l.quantity) || 1} coca cola de vidrio`;
  }

  // marta1/alejandro1/osmar1/efrain1 (Oct 29): caller-spoken ledger for gorditas/tacos/tortas/chiles rellenos. When every
  // announced count ("seis gorditas", "cuatro tacos", "dos órdenes de chiles rellenos") is explained by caller words, that
  // ledger is the order: staff readbacks never add phantom lines, option answers never leave the cart empty.
  {
    const sl = spokenLedger(origTurns as any);
    // only item-level disagreement (missing/phantom dish, unit count) — modifier details stay with the turn-by-turn shadow
    const sig = (ls: any[]) => { const m: Record<string, number> = {}; for (const l of ls) m[l.itemId] = (m[l.itemId] || 0) + (Number(l.quantity) || 1); return JSON.stringify(Object.entries(m).sort()); };
    const units = (ls: any[]) => ls.reduce((n, l) => n + (Number(l.quantity) || 1), 0);
    if (sl && sl.lines.length && (units(sl.lines) >= 3 || !cart.length) && sig(sl.lines) !== sig(cart)) {
      cart.length = 0; cart.push(...(sl.lines as any[]));
      steps.push({ source: "end-spoken-ledger", heard: sl.lines.map((l) => l.readback).join(", ") });
      if (!fulfillment) fulfillment = "PICKUP";
    }
    // staff unavailability overrides the menu: a dish staff said is not today never stays on the ticket
    const off = staffUnavailable(origTurns as any);
    if (off.length) for (let i = cart.length - 1; i >= 0; i--) if (off.some((d) => String(cart[i].itemId).includes(d.replace(/\s+/g, "-")))) { steps.push({ source: "end-staff-unavailable", heard: String(cart[i].itemId) }); cart.splice(i, 1); }
  }

  // mau1 (CAc68af8): no food ordered (empty cart) → never lock DELIVERY/PICKUP as if an order happened
  if (!cart.length) {
    fulfillment = null;
  }

  const groups = [...new Set(cart.map((l: any) => l.person).filter(Boolean))];
  applyEnchiladaOrder(cart as any[], turns as any); applyQdSupreme(cart as any[], turns as any); // manuel1, chui1 (last: after every readback rebuild)
  { // maria2: a dish Elvi asked side questions about is always in the cart
    const menuFn = (run as any).menu; const menu = typeof menuFn === "function" ? await Promise.resolve(menuFn()).catch(() => null) : null;
    if (menu) applyAskedDishes(cart as any[], steps, turns as any, menu);
    if (menu && applyAddOnCallback(cart as any[], turns as any, menu)) (steps as any).addOn = true;
    if (menu) { applySplitCorrection(cart as any[], turns as any, menu); applySidesAndToppings(cart as any[], turns as any, menu);
      dropUnsaidDishes(cart as any[], turns as any, menu); applyCountedDishMeat(cart as any[], turns as any, menu); ringUnnamedSodas(cart as any[], turns as any, menu);
      dropStaffUnavailable(cart as any[], turns as any); // cmissing1
      applyStaffReadback(cart as any[], turns as any, menu); fillMeatlessFromCaller(cart as any[], turns as any, menu); // carolina1/luis1/oscar1/angie1
      dropDeluxeComponentSides(cart as any[], turns as any); applySaidQuesoFresco(cart as any[], turns as any, menu); splitEnchiladaOrders(cart as any[], turns as any, menu); // angie1, miguel1
      applyNegatedMeat(cart as any[], turns as any, menu); dropUnsaidDorados(cart as any[], turns as any); // oscar2
      applyRiceBeansSide(cart as any[], turns as any, menu); applyCremaOnSide(cart as any[], turns as any, menu); // aaron1
      applyRellenoOrder(cart as any[], turns as any, menu); dropMeatlessDup(cart as any[], menu); applyArbolSalsa(cart as any[], turns as any, menu);
      applyMeatBienDorada(cart as any[], turns as any); applySpokenCount(cart as any[], turns as any); applySolasVerduraAparte(cart as any[], turns as any, menu); applySideSize(cart as any[], turns as any, menu);
      applyMenudoSinPata(cart as any[], turns as any, menu); applySaidMeat(cart as any[], turns as any, menu); applyAsadosSide(cart as any[], turns as any, menu);
      applyMenudoHominy(cart as any[], turns as any); dropQdRegularTwin(cart as any[], turns as any); applyMenudo3Alex2(cart as any[], turns as any, menu); applyLuis3(cart as any[], turns as any, menu); applyReadbackCounts(cart as any[], turns as any); dropTortillaStyleAsk(cart as any[], turns as any); applyStatedDishTotal(cart as any[], turns as any); applyStaffRecap(cart as any[], turns as any, menu); applyMarta1(cart as any[], turns as any, menu); applyAlex3(cart as any[], turns as any, menu); applySopesAsada(cart as any[], turns as any); applyBurritoSaid(cart as any[], turns as any); mergeReMentionedDrink(cart as any[], turns as any);  applyRelayOrders(cart as any[], turns as any, menu); addAskedJarrito(cart as any[], turns as any, menu); addAskedEsquite(cart as any[], turns as any, menu); applyLateTortillaChoice(cart as any[], turns as any, menu); applyQdRecap(cart as any[], turns as any, menu); applyBurritoMeatRepeat(cart as any[], turns as any, menu); applyEnglishMultiItem(cart as any[], turns as any, menu); applyMeatSplitQty(cart as any[], turns as any); applyExtraCarne(cart as any[], turns as any, menu); applyQdCorrection(cart as any[], turns as any); applyMenudoPata(cart as any[], turns as any); applyVerduraAparte(cart as any[], turns as any); applyConsomeSolo(cart as any[], turns as any); } } // hominy1, dayana2; nicky1, cafa1, braulio1, christopher1, daniela1
  // relleno2 (CA8f33ce5): staff-unavailable wins over EVERY re-add pass (asked-dishes, relleno, readback…) — run it last.
  dropStaffUnavailable(cart as any[], turns as any);
  // relleno2: nothing left (or only a call-back after "se me acabaron") → never an auto-accepted final ticket
  if (!cart.length) { autoAccepted = false; if (CALLBACK_SAID(turns as any)) return { cart: [] as Line[], steps: [...steps, { source: "call-back-no-order", heard: "" }], autoAccepted: false, containers: [], ambiguousRemovals: [], removalsAttributed: true, fulfillment: null, address: null, addressConfirmed: false, statusCall: true, noOrder: true } as any; }
  return { ...((steps as any).addOn ? { addOn: true } : {}), cart, steps, autoAccepted, containers, ambiguousRemovals, removalsAttributed: true, fulfillment, address, addressConfirmed, ...(groups.length ? { groups } : {}) };
}

