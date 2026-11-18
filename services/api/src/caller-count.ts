// The caller's own spoken count for a dish, used before a staff readback may write a quantity.
// Counts are keyed by dish + catalog style (tortilla or dorada/preparada) + meat, so a later line of the
// same meat in another style does not replace an earlier count. A bare "Una quesadilla" carries onto the
// next caller turn that names the meat and gives no new number. A staff count question ("Two?" / "¿Dos?" /
// "¿Son dos?") answered yes is the caller's count for the line just discussed. A full order readback the
// caller only confirms does not replace a different number they already said.
import { compoundForms } from "./menu-names.js";
import { ambiguousMakeIt, ambiguousMore, catalogMeatKey, makeItN, openLineKeys } from "./modifier-turns.js";
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
const meatIn = (p: string) => { const text = plain(p).replace(/\balpastor\b/g, "al pastor"); let best: [number, string] | null = null; for (const [re, key] of MEATS) { const match = text.match(re); if (match && (!best || (match.index || 0) < best[0])) best = [match.index || 0, key]; } if (best) return best[1]; for (const word of text.split(" ")) { const key = catalogMeatKey(word); if (key && key !== word && MEATS.some((row) => row[1] === key)) return key; } return null; };
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
  const seen = new Set<string>();
  const addWord = (word: string) => {
    if (!word || seen.has(word)) return;
    seen.add(word);
    out.add(word);
    if (word.endsWith("s") && word.length > 4) addWord(word.slice(0, -1));
    for (const part of compoundForms(word)) addWord(part);
  };
  for (const word of list) addWord(word);
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
const OTRA_CANCEL = /\b(no\s+mejor\s+no|no\s+ya\s+no|mejor\s+no)\b/;
const NEW_ITEM_REST = /^(?:(?:dame|deme|ponme|mejor|y)\s+)*(?:\d+|un|una|uno|dos|tres|cuatro|cinco|one|two|three)\s+de\s+\S+/;
/** Cancel only when the phrase opens the turn and the rest is empty or a new item. A topping keeps the line. */
export function leadingCancel(text: string): string | null {
  const match = plain(text).match(/^(?:y\s+)?(?:no\s+mejor\s+no|no\s+ya\s+no|mejor\s+no)\b\s*(.*)$/);
  if (!match) return null;
  const rest = match[1].replace(/^(?:y\s+)/, "").trim();
  if (rest && !NEW_ITEM_REST.test(rest)) return null;
  return rest;
}
function nextCallerCancels(turns: Turn[], index: number): boolean {
  for (let j = index + 1; j < turns.length; j++) {
    if (turns[j].speaker && turns[j].speaker !== "caller") {
      if (/[?¿]/.test(String(turns[j].text || ""))) return false;
      continue;
    }
    return leadingCancel(String(turns[j].text || "")) !== null;
  }
  return false;
}
/** The leading otra/otro/another clause, only when de, a dish, or a known meat follows. The rest of the turn stays separate. */
export function peelAnother(text: string): { dish: string | null; meat: string | null; said: string; rest: string; cancel?: boolean } | null {
  const cleaned = plain(text).replace(/\b(?:por favor|please)\b/g, " ").replace(/[,]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:orden|order)\b/.test(cleaned)) return null;
  const opened = cleaned.match(/^(?:y\s+|and\s+)?(?:otra|otro|another)\b\s*(.*)$/);
  if (!opened) return null;
  let tail = opened[1].trim();
  if (/\blo mismo\b|\bthe same\b/.test(cleaned)) return null;
  const cancel = cleaned.match(OTRA_CANCEL);
  if (cancel) {
    const rest = cleaned.slice((cancel.index || 0) + cancel[0].length).replace(/^(?:\s*y\s+|\s+)/, "").trim();
    if (!rest || NEW_ITEM_REST.test(rest)) return { dish: null, meat: null, said: "", rest, cancel: true };
  }
  if (/^(?:mas|more)$/.test(tail)) return null;
  if (/^(?:mas|more)\s+/.test(tail)) {
    const after = tail.replace(/^(?:mas|more)\s+/, "");
    const head = after.split(" ")[0] || "";
    if (head !== "de" && head !== "of" && !dishIn(head) && !meatIn(head)) return null;
    tail = after;
  }
  const first = tail.split(" ")[0] || "";
  if (first !== "de" && first !== "of" && !dishIn(first) && !meatIn(first)) return null;
  const tokens = tail.split(" ").filter(Boolean);
  let end = tokens.length;
  const nextCount = /^(?:\d+|un|una|uno|dos|tres|cuatro|cinco|one|two|three|four|five)$/;
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    if ((word === "y" || word === "and") && i > 0) { end = i; break; }
    if (nextCount.test(word) && i > 0 && meatIn(tokens.slice(0, i).join(" "))) { end = i; break; }
    if (word === "con" || word === "with" || word === "sin" || word === "without") {
      if (!meatIn(tokens.slice(0, i).join(" "))) return null;
      end = i;
      break;
    }
  }
  const clause = tokens.slice(0, end).join(" ");
  const meat = meatIn(clause);
  if (!meat && first !== "de" && first !== "of") return null;
  const said = clause.match(/\b(?:de|of)\s+([a-z]+)/)?.[1] || clause.split(" ").find((word) => meatIn(word)) || first;
  const namedDish = dishIn(clause);
  return { dish: namedDish && namedDish === meat ? null : namedDish, meat, said, rest: tokens.slice(end).join(" ").replace(/^(?:y|and)\s+/, "") };
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

function explicitCounts(turns: Turn[], cart?: any[]): Map<string, number> {
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
  const bareMore = (seg: string) => !seg.replace(/\b(?:mas|more|por|favor|please|ya)\b/g, " ").replace(/\by\b/g, " ").trim();
  const additive = (before: string, seg: string) => {
    const tail = before.trim().split(/\s+/).slice(-4).join(" ");
    if (/\b(?:otros|otras)\b/.test(tail)) return true;
    if (/\b(?:otra|otro|another)\b/.test(tail) && !/\borden\b/.test(tail)) return true;
    if (/\b(?:mas|more)\b/.test(tail)) return true;
    if (!/\b(?:mas|more)\b/.test(seg)) return false;
    return bareMore(seg) || !/\b(?:mas|more)\s*$/.test(seg);
  };
  // "más N X" adds onto the open line only when X is that dish or meat, or when nothing but más follows.
  const sameTarget = (seg: string, dish: string, meat: string) => {
    if (bareMore(seg)) return true;
    const body = seg.trim();
    const named = dishIn(body);
    const meatNamed = meatIn(body);
    if (named && named !== dish) return false;
    if (meatNamed && meatNamed !== meat) return false;
    return !!(named || meatNamed);
  };
  for (let ti = 0; ti < (turns || []).length; ti++) {
    const turn = turns[ti];
    if (turn.speaker && turn.speaker !== "caller") continue;
    const raw = String(turn.text || "");
    let p = plain(raw).replace(/\b(?:para|a|son|antes de|despues de)\s+las\s+dos(?:\s+de\s+la\s+(?:tarde|manana|noche)|\s+en\s+punto)?\b/g, " ").replace(/\s+/g, " ").trim();
    if (!p) continue;
    const otra = peelAnother(p);
    if (otra?.cancel) {
      if (!otra.rest) continue;
      p = otra.rest;
    } else if (ambiguousMore(turns, ti, cart)) continue;
    else if (/^(?:y\s+|dame\s+|deme\s+|and\s+)?(?:\d+|un|una|uno|dos|tres|cuatro|cinco|one|two|three)\s+(?:mas|more)(?:\s+por\s+favor|\s+please)?$/.test(p) && openLineKeys(turns, ti, cart).length === 1) {
      const keys = openLineKeys(turns, ti, cart);
      const n = numOf((p.match(/\b(\d+|un|una|uno|dos|tres|cuatro|cinco|one|two|three)\b/) || [])[1] || "");
      const [dish, spoken] = keys[0].split("|");
      const meat = meatIn(spoken) || spoken;
      if (n && dish && meat) { add(dish, openStyle, meat, n); open = dish; lastMeat = meat; }
      continue;
    }
    else if (/^(?:y\s+|dame\s+|deme\s+|and\s+)?(?:otra|otro|another)\s+(?:mas|more)(?:\s+por favor|\s+please)?$/.test(p) && open && lastMeat && !nextCallerCancels(turns, ti)) {
      add(open, openStyle, lastMeat, 1);
      continue;
    } else if (otra?.meat && nextCallerCancels(turns, ti)) {
      continue;
    } else if (otra?.meat) {
      const dish = otra.dish || open;
      if (dish) {
        const head = otra.rest ? p.slice(0, Math.max(0, p.lastIndexOf(otra.rest))) : p;
        const style = styleKey(head) || (otra.dish && otra.dish !== open ? "" : openStyle);
        add(dish, style, otra.meat, 1);
        open = dish;
        if (style) openStyle = style;
        lastMeat = otra.meat;
        if (!otra.rest) continue;
        p = otra.rest;
      }
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
    if (made && !dishIn(made.tail) && !meatIn(made.tail) && open && !ambiguousMakeIt(turns, ti)) {
      const keys = openLineKeys(turns, ti);
      const only = keys.length === 1 ? keys[0].split("|") : null;
      const lineMeat = only?.[1] ? meatIn(only[1]) || only[1] : "";
      if (only && (only[0] || open) && lineMeat) put(only[0] || open, openStyle, lineMeat, made.n);
      else if (lastMeat) put(open, openStyle, lastMeat, made.n);
      else put(open, openStyle || "", "", made.n);
    }
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
        if (additive(before, seg) && open && lastMeat && sameTarget(seg, open, lastMeat)) add(open, openStyle, lastMeat, n);
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
    if (!otra?.meat && !otra?.cancel && open) {
      for (const hit of p.matchAll(/\b(?:y\s+|and\s+)(?:otra|otro|another)\s+(?:de\s+([a-z]+)|([a-z]+)\s+de\s+([a-z]+))/g)) {
        const extra = meatIn(hit[3] || hit[1] || "");
        if (!extra) continue;
        const named = hit[2] ? dishIn(hit[2]) : null;
        add(named || open, openStyle, extra, 1);
        lastMeat = extra;
        if (named) open = named;
      }
    }
  }
  return counts;
}

/** Caller's spoken quantity for this dish, style and meat. Null when the caller never counted it. */
export function callerSpokenQty(turns: Turn[], dish: string, meat: string | null, itemText = "", cart?: any[]): number | null {
  const wantDish = dishIn(dish) || plain(dish).replace(/s$/, "");
  const wantMeat = meat ? meatIn(meat) || plain(meat) : "";
  const wantStyle = styleKey(itemText);
  const counts = explicitCounts(turns, cart);
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

const COUNT_SKIP = new Set(["favor", "please", "gracias", "tambien", "entonces", "queso", "cebolla", "cilantro", "salsa", "crema", "nopales", "aguacate", "verdura", "repollo", "limon"]);
function countHint(text: string): boolean {
  const p = plain(text);
  const word = "dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|one|two|three|four|five|six|seven|eight|nine|ten|twenty";
  const any = `una|uno|un|${word}|\\d+`;
  const hit = (re: RegExp) => {
    for (const m of p.matchAll(new RegExp(re.source, "gi"))) {
      if (m[1]) return true;
    }
    return false;
  };
  if (hit(new RegExp(`\\b(${any})\\s+extra\\b`, "i"))) return true;
  if (hit(new RegExp(`\\bagregale\\s+(${any})\\b`, "i"))) return true;
  if (hit(new RegExp(`\\bsubele\\s+a\\s+(${any})\\b`, "i"))) return true;
  if (hit(new RegExp(`\\b(${any})\\s+menos\\b`, "i"))) return true;
  if (hit(new RegExp(`\\bquitale\\s+(${any})\\b`, "i"))) return true;
  if (/\bponle\s+otro\b/.test(p)) return true;
  if (hit(new RegExp(`\\blets?\\s+do\\s+(${any})\\b`, "i")) || hit(new RegExp(`\\blet\\s+s\\s+do\\s+(${any})\\b`, "i"))) return true;
  if (!/\ben\s+total\b/.test(p) || /\b(?:pesos?|dolares?|dollars?|euros?|bucks?|centavos?)\b/.test(p)) return false;
  const before = p.slice(0, p.search(/\ben\s+total\b/));
  const said = (before.match(/(\d+|[a-z]+)\s*$/) || [])[1] || "";
  const small: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, veinte: 20, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20 };
  const value = /^\d+$/.test(said) ? Number(said) : small[said];
  return value != null && value >= 1 && value <= 20;
}
function missedSideWords(text: string, keys: string[]): string[] {
  const out: string[] = [];
  const take = (part: string, english: boolean) => {
    const lead = english ? /^(?:a|an|some|unos|unas|un|una|orden\s+de)\s+([a-z]{4,})/ : /^(?:unos|unas|un|una|orden\s+de)\s+([a-z]{4,})/;
    const named = part.match(lead);
    if (!named || COUNT_SKIP.has(named[1]) || dishIn(named[1]) || meatIn(named[1])) return;
    if (keys.some((key) => key.includes(named[1]))) return;
    out.push(named[1]);
  };
  const body = plain(text);
  for (const part of body.split(/\s+y\s+/).slice(1)) take(part, false);
  for (const part of body.split(/\s+and\s+/).slice(1)) take(part, true);
  return out;
}
function meatsNamed(text: string): string[] {
  const body = plain(text);
  const found: string[] = [];
  for (const [re, key] of MEATS) if (re.test(body) && !found.includes(key)) found.push(key);
  return found;
}
function namingAnswer(text: string): boolean {
  if (/[?¿]/.test(text)) return false;
  const p = plain(text);
  if (/\b(?:no|not|perdon|mejor)\b/.test(p)) return false;
  return meatsNamed(text).length === 1;
}
function keyCovers(key: string, wantDish: string, wantMeat: string): boolean {
  const [od, om] = key.split("|");
  const meat = om ? meatIn(om) || om : "";
  if (wantDish && od && od !== wantDish) return false;
  if (wantMeat && meat && meat !== wantMeat) return false;
  if (wantDish && od === wantDish) return !wantMeat || !meat || meat === wantMeat;
  if (wantMeat && meat === wantMeat) return !wantDish || !od || od === wantDish;
  return false;
}
function unresolvedFor(turns: Turn[], wantDish: string, wantMeat: string): boolean {
  const pending = new Set<string>();
  const missed = new Set<string>();
  let waitAnswer = false;
  const clearOthers = (text: string) => {
    const namedDish = dishIn(text);
    const namedMeat = meatIn(text);
    if (!namedMeat || !pending.size) return;
    const matches = [...pending].filter((key) => {
      const [od, om] = key.split("|");
      const meat = om ? meatIn(om) || om : "";
      if (meat !== namedMeat) return false;
      if (namedDish && od && od !== namedDish) return false;
      return true;
    });
    if (matches.length !== 1) return;
    for (const key of [...pending]) if (key !== matches[0]) pending.delete(key);
  };
  for (let i = 0; i < (turns || []).length; i++) {
    const turn = turns[i];
    if (turn?.speaker && turn.speaker !== "caller") continue;
    const text = String(turn.text || "");
    if (waitAnswer) {
      waitAnswer = false;
      if (namingAnswer(text)) clearOthers(text);
    }
    const bare = makeItN(text);
    const bareTail = bare ? plain(bare.tail) : "";
    const bareCount = (!!bare && !dishIn(bareTail) && !meatIn(bareTail)) || ambiguousMore(turns, i);
    const keys = openLineKeys(turns, i);
    const missedHere = missedSideWords(plain(text), keys);
    const missedBefore: string[] = [];
    for (let j = 0; j < i; j++) {
      if (turns[j]?.speaker && turns[j].speaker !== "caller") continue;
      missedBefore.push(...missedSideWords(plain(String(turns[j].text || "")), keys));
    }
    const hinted = countHint(plain(text));
    const unclear = ambiguousMakeIt(turns, i) || ambiguousMore(turns, i) || (bareCount && (missedHere.length || missedBefore.length)) || hinted;
    if (!unclear) continue;
    if (hinted || ambiguousMakeIt(turns, i) || ambiguousMore(turns, i) || bareCount) for (const key of keys) pending.add(key);
    for (const word of [...missedHere, ...missedBefore]) missed.add(word);
    waitAnswer = true;
  }
  if ([...pending].some((key) => keyCovers(key, wantDish, wantMeat))) return true;
  return (!!wantDish && missed.has(wantDish)) || (!!wantMeat && missed.has(wantMeat));
}
/** Quantity a staff readback may write. The caller count wins; a missing caller count keeps the cart quantity. */
export function staffQuantity(turns: Turn[], dish: string, meat: string | null, staffQty: number, cartQty: number, itemText = "", cart?: any[]): { quantity: number; flag: boolean } {
  const said = callerSpokenQty(turns, dish, meat, itemText, cart);
  const wantDish = dishIn(dish) || plain(dish).replace(/s$/, "");
  const wantMeat = meat ? meatIn(meat) || plain(meat) : "";
  const asked = unresolvedFor(turns, wantDish, wantMeat);
  if (said != null && said === staffQty) return { quantity: staffQty, flag: asked };
  if (said != null) return { quantity: said, flag: true };
  return { quantity: cartQty, flag: asked || cartQty !== staffQty };
}
