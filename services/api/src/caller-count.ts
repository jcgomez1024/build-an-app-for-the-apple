// The caller's own spoken count for a dish, used before a staff readback may write a quantity.
// Counts are keyed by dish + catalog style (tortilla or dorada/preparada) + meat, so a later line of the
// same meat in another style does not replace an earlier count. A bare "Una quesadilla" carries onto the
// next caller turn that names the meat and gives no new number. A staff count question ("Two?" / "¿Dos?" /
// "¿Son dos?") answered yes is the caller's count for the line just discussed. A full order readback the
// caller only confirms does not replace a different number they already said.
import { makeItN } from "./modifier-turns.js";
import { frozenPhoneMenu } from "./phone-menu.js";

type Turn = { speaker?: string; text?: string };
const plain = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };
const numOf = (w: string) => Number(w) || NUM[w] || 0;
const NUMW = "\\d+|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six";
const MEATS: Array<[RegExp, string]> = [[/\bbistec?k?\b|\bsteak\b|\basada\b/, "bistec"], [/\b(?:al )?pastor\b/, "alpastor"], [/\bcostillas?\b/, "costilla"], [/\btripas?\b/, "tripa"],
  [/\bcabezas?\b/, "cabeza"], [/\bprensado\b/, "prensado"], [/\blenguas?\b/, "lengua"], [/\bchorizo\b/, "chorizo"], [/\bpollo\b|\bchicken\b/, "pollo"], [/\bcarnitas\b/, "carnitas"],
  [/\bbuche\b/, "buche"], [/\bbirria\b/, "birria"], [/\bdeshebrada\b/, "deshebrada"], [/\bpicadillo\b/, "picadillo"]];
const DISHES: Array<[RegExp, string]> = [[/\bquesadillas?\b|\bqds?\b|\bdoradas?\b/, "quesadilla"], [/\btacos?\b/, "taco"], [/\btortas?\b/, "torta"], [/\bgorditas?\b/, "gordita"], [/\bburritos?\b/, "burrito"],
  [/\bsopes?\b/, "sope"], [/\b(?:huaraches?|guaraches?)\b/, "huarache"], [/\bmenudos?\b/, "menudo"], [/\bpo[sz]oles?\b/, "pozole"], [/\bbirrias?\b/, "birria"], [/\benchiladas?\b/, "enchilada"], [/\btamales?\b/, "tamal"]];
const STOP = new Set(["quesadilla", "quesadillas", "taco", "tacos", "torta", "tortas", "gordita", "gorditas", "burrito", "burritos", "option", "options", "the", "and", "con", "para", "from", "with", "your", "yeah", "yep", "yes", "those", "them", "this", "that", "else", "anything"]);
const YES = /^(?:yep|yeah|yes|si|aja|ok|okay|claro|correcto|right|sure)\b/;
const NO = /^(?:no|nah|nope|nel)\b/;
const meatIn = (p: string) => { const text = plain(p).replace(/\balpastor\b/g, "al pastor"); let best: [number, string] | null = null; for (const [re, key] of MEATS) { const match = text.match(re); if (match && (!best || (match.index || 0) < best[0])) best = [match.index || 0, key]; } return best?.[1] || null; };
const dishIn = (p: string) => { const text = plain(p); let best: [number, string] | null = null; for (const [re, key] of DISHES) { const match = text.match(re); if (match && (!best || (match.index || 0) < best[0])) best = [match.index || 0, key]; } return best?.[1] || null; };
const words = (p: string) => plain(p).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.startsWith(a)) || (b.length >= 5 && a.startsWith(b)) || (Math.min(a.length, b.length) >= 5 && a.slice(0, 5) === b.slice(0, 5));
const isDuplicate = (p: string) => /\botra\s+orden\s+igual\b|\bunas?\s+\w+\s+igual\b|\b(?:otra|otro)\s+igual\b/.test(p) || (/\bigual\b/.test(p) && /\buna\s+y\s+una\b/.test(p));

type StyleOpt = { key: string; words: string[]; distinctive: string[] };
let styleCache: StyleOpt[] | null = null;
let pairCache: Map<string, Set<string>> | null = null;

function catalog(): any[] {
  try { return frozenPhoneMenu(); } catch { return []; }
}
function optionName(option: any): string {
  return String(typeof option === "string" ? option : option?.name || "");
}
function pushStyleGroup(out: StyleOpt[], names: string[]) {
  const parsed = names.map((name) => words(name)).filter((tokens) => tokens.length);
  if (!parsed.length) return;
  const common = parsed[0].filter((word) => parsed.every((tokens) => tokens.includes(word)));
  for (const tokens of parsed) {
    const distinctive = tokens.filter((word) => !common.includes(word));
    const basis = distinctive.length ? distinctive : tokens;
    out.push({ key: basis.slice().sort((a, b) => b.length - a.length)[0], words: tokens, distinctive });
  }
}
function styleOptions(): StyleOpt[] {
  if (styleCache) return styleCache;
  const out: StyleOpt[] = [];
  const dorada: string[] = [];
  const groups = new Map<string, string[]>();
  for (const item of catalog()) {
    if (/^sq-qd-/.test(String(item?.id || ""))) dorada.push(String(item?.name || ""));
    for (const group of item?.modifierGroups || []) {
      const name = String(group?.name || "");
      if (!/tortilla options|tortilla shell/i.test(name)) continue;
      const key = name.replace(/[^a-z]/gi, "").toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      for (const option of group.options || []) groups.get(key)!.push(optionName(option));
    }
  }
  for (const names of groups.values()) pushStyleGroup(out, names);
  pushStyleGroup(out, dorada);
  styleCache = out;
  return out;
}
function translations(): Map<string, Set<string>> {
  if (pairCache) return pairCache;
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a)!.add(b); map.get(b)!.add(a);
  };
  for (const item of catalog()) for (const group of item?.modifierGroups || []) for (const option of group.options || []) {
    const halves = optionName(option).split("/").map((part) => words(part));
    if (halves.length < 2 || !halves[0].length || !halves[1].length) continue;
    for (const left of halves[0]) for (const right of halves[1]) add(left, right);
  }
  pairCache = map;
  return map;
}
function expand(list: string[]): Set<string> {
  const out = new Set<string>();
  for (const word of list) {
    out.add(word);
    if (word.endsWith("s") && word.length > 4) out.add(word.slice(0, -1));
  }
  const pairs = translations();
  for (const word of [...out]) for (const alt of pairs.get(word) || []) out.add(alt);
  return out;
}
function foldStyleWords(text: string): string {
  return plain(text).replace(/\bnormal(?:es)?\b|\bsencill[ao]s?\b/g, " regular ").replace(/\bpreparad[ao]s?\b/g, " deluxe ");
}
function styleKey(text: string): string {
  const tokens = words(foldStyleWords(text));
  let best: { key: string; rank: number; size: number } | null = null;
  for (const opt of styleOptions()) {
    const strong = opt.distinctive.filter((word) => tokens.some((token) => sameWord(token, word)));
    const weak = opt.words.filter((word) => tokens.some((token) => sameWord(token, word)));
    if (!strong.length && !weak.length) continue;
    const len = Math.max(...(strong.length ? strong : weak).map((word) => word.length));
    const rank = (strong.length ? 200 : 100) + len;
    if (!best || rank > best.rank || (rank === best.rank && opt.words.length < best.size)) best = { key: opt.key, rank, size: opt.words.length };
  }
  return best?.key || "";
}
function countQuestion(raw: string): { n: number; topic: string } | null {
  if (!/[?¿]/.test(String(raw || ""))) return null;
  if (/\b(?:te tengo|le tengo|so i (?:got|have)|i (?:got|have)|entonces)\b/i.test(raw)) return null;
  const p = plain(raw);
  if ((p.match(/\b(?:tacos?|quesadillas?|tortas?|gorditas?|burritos?)\b/g) || []).length >= 2) return null;
  const m = p.match(new RegExp(`^(?:son|serian|is it|about)?\\s*(${NUMW})(?:\\s+(.*))?$`));
  if (!m || /\b(?:y|and)\b/.test(m[2] || "")) return null;
  const n = numOf(m[1]);
  return n ? { n, topic: (m[2] || "").trim() } : null;
}
function topicBefore(turns: Turn[], index: number): string {
  const bits: string[] = [];
  for (let j = index - 1; j >= 0 && j >= index - 4; j--) {
    const p = plain(turns[j]?.text || "");
    if (!p || YES.test(p)) continue;
    bits.unshift(p);
  }
  return bits.join(" ");
}
type Asked = { n: number; topic: string };
function askedCounts(turns: Turn[]): Asked[] {
  const out: Asked[] = [];
  for (let i = 0; i < (turns || []).length; i++) {
    const turn = turns[i];
    if (turn?.speaker === "caller") continue;
    const asked = countQuestion(String(turn?.text || ""));
    if (!asked) continue;
    const next = turns.slice(i + 1).find((item) => item?.speaker === "caller");
    if (!next || NO.test(plain(next.text || "")) || !YES.test(plain(next.text || ""))) continue;
    out.push({ n: asked.n, topic: asked.topic || topicBefore(turns, i) });
  }
  return out;
}
function topicMatches(topic: string, itemText: string, dish: string, meat: string): boolean {
  const tokens = (text: string) => plain(text).split(" ").filter((word) => word.length >= 4);
  const topicWords = expand(tokens(topic));
  const itemWords = expand(tokens(`${itemText} ${dish} ${meat}`));
  for (const word of topicWords) if (itemWords.has(word)) return true;
  return false;
}

type Part = { dish: string; style: string; meat: string; n: number };
type Pending = { dish: string; n: number; style: string };

function explicitCounts(turns: Turn[]): Map<string, number> {
  const counts = new Map<string, number>();
  let open: string | null = null;
  let openStyle = "";
  let lastParts: Part[] = [];
  let copied = false;
  let pending: Pending | null = null;
  let lastMeat = "";
  const keyOf = (dish: string, style: string, meat: string) => `${dish}|${style}|${meat}`;
  const put = (dish: string, style: string, meat: string, n: number) => counts.set(keyOf(dish, style, meat), n);
  const add = (dish: string, style: string, meat: string, n: number) => counts.set(keyOf(dish, style, meat), (counts.get(keyOf(dish, style, meat)) || 0) + n);
  const additive = (before: string, seg: string) => {
    const tail = before.trim().split(/\s+/).slice(-4).join(" ");
    if (/\b(?:otros|otras)\b/.test(tail)) return true;
    if (/\b(?:otra|otro|another)\b/.test(tail) && !/\borden\b/.test(tail)) return true;
    if (/\b(?:mas|more)\b/.test(tail)) return true;
    return /\b(?:mas|more)\b/.test(seg) && !/\b(?:mas|more)\s*$/.test(seg);
  };
  for (const turn of turns || []) {
    if (turn.speaker && turn.speaker !== "caller") continue;
    const raw = String(turn.text || "");
    const p = plain(raw);
    if (!p) continue;
    const otra = p.match(/^(?:y\s+)?(?:otra|otro)\s+de\s+(.+)$/) || p.match(/^(?:and\s+)?another\s+(.+)$/);
    if (otra && !/\borden\b/.test(p) && open) {
      const otraMeat = meatIn(otra[1]);
      if (otraMeat) { add(open, openStyle, otraMeat, 1); continue; }
    }
    const numbered = [...p.matchAll(new RegExp(`\\b(${NUMW})\\b`, "g"))];
    const meat = meatIn(p);
    if (pending && !numbered.length && meat) {
      put(pending.dish, styleKey(p) || pending.style, meat, pending.n);
      pending = null;
      continue;
    }
    const named = dishIn(p);
    if (named) open = named;
    if (isDuplicate(p) && lastParts.length) {
      if (!copied) {
        for (const part of lastParts) counts.set(`${part.dish}|${part.style}|${part.meat}`, (counts.get(`${part.dish}|${part.style}|${part.meat}`) || 0) + part.n);
        copied = true;
      }
      if (!meat) continue;
    } else copied = false;
    const made = makeItN(raw);
    if (made && !dishIn(made.tail) && !meatIn(made.tail) && open) put(open, "", "", made.n);
    const parts: Part[] = [];
    let bare: Pending | null = null;
    for (let i = 0; i < numbered.length; i++) {
      const n = numOf(numbered[i][1]);
      if (!n) continue;
      const at = numbered[i].index || 0;
      const seg = p.slice(at + numbered[i][0].length, numbered[i + 1]?.index ?? p.length);
      const before = p.slice(0, at);
      const segDish = dishIn(seg);
      const segMeat = meatIn(seg);
      const segStyle = styleKey(seg);
      if (segDish && segDish !== open) openStyle = segStyle;
      else if (segStyle) openStyle = segStyle;
      if (segDish) open = segDish;
      const useDish = segDish || (segMeat ? open : null);
      if (!useDish || !segMeat) {
        if (additive(before, seg) && open && lastMeat) add(open, openStyle, lastMeat, n);
        else if (segDish && !segMeat) bare = { dish: segDish, n, style: segStyle || openStyle };
        continue;
      }
      const style = segStyle || openStyle;
      if (additive(before, seg)) add(useDish, style, segMeat, n);
      else put(useDish, style, segMeat, n);
      lastMeat = segMeat;
      parts.push({ dish: useDish, style, meat: segMeat, n });
    }
    pending = parts.length ? null : bare;
    if (parts.length >= 2) lastParts = parts;
    else if (parts.length === 1 && dishIn(p)) lastParts = parts;
  }
  return counts;
}

/** Caller's spoken quantity for this dish, style and meat. Null when the caller never counted it. */
export function callerSpokenQty(turns: Turn[], dish: string, meat: string | null, itemText = ""): number | null {
  const wantDish = dishIn(dish) || plain(dish).replace(/s$/, "");
  const wantMeat = meat ? meatIn(meat) || plain(meat) : "";
  const wantStyle = styleKey(itemText);
  const counts = explicitCounts(turns);
  if (!wantMeat) {
    const put = counts.get(`${wantDish}||`) || null;
    if (put) return put;
  } else {
    const exact = counts.get(`${wantDish}|${wantStyle}|${wantMeat}`);
    if (exact) return exact;
    if (wantStyle && counts.get(`${wantDish}||${wantMeat}`)) return counts.get(`${wantDish}||${wantMeat}`) || null;
    if (!wantStyle) {
      const hits = [...counts.entries()].filter(([key]) => key.startsWith(`${wantDish}|`) && key.endsWith(`|${wantMeat}`));
      if (hits.length === 1) return hits[0][1];
    }
  }
  const asked = askedCounts(turns).filter((row) => topicMatches(row.topic, itemText, wantDish, wantMeat));
  return asked.length ? asked[asked.length - 1].n : null;
}

/** Quantity a staff readback may write. The caller count wins; a missing caller count keeps the cart quantity. */
export function staffQuantity(turns: Turn[], dish: string, meat: string | null, staffQty: number, cartQty: number, itemText = ""): { quantity: number; flag: boolean } {
  const said = callerSpokenQty(turns, dish, meat, itemText);
  if (said != null && said === staffQty) return { quantity: staffQty, flag: false };
  if (said != null) return { quantity: said, flag: true };
  return { quantity: cartQty, flag: cartQty !== staffQty };
}
