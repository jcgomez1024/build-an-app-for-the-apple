// marta1/alejandro1/osmar1/efrain1 (Oct 29 ~7:22–7:56 PM ET): caller-spoken ledger for gorditas, tacos, tortas and
// chiles rellenos. Only caller counts add items ("N gorditas" then "uno de X, uno de Y…" until N is filled); staff
// confirmations/readbacks never add lines. Option answers ("sin queso", "de comal", "de maíz", "más arroz que
// frijoles", "cebollita asada y chiles") attach to the group they answer. "a nombre de X" assigns people. A side salsa
// ("más salsita aparte" + "de cuatro") is an Extras line. Returns null unless every announced count is fully explained
// and the call names no dish this ledger does not model.
export type SpokenLine = { itemId: string; quantity: number; modifiers: Array<{ step: string; option: string }>; readback: string; elviNotes?: string[]; person?: string };
type T = { speaker: string; text: string };
const nf = (x: string) => String(x || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
// ASR aliases for dish nouns / meats heard on the phone line
const ALIAS: Array<[RegExp, string]> = [
  [/\bnuditos\b/g, "gorditas"], [/\bgorditos\b/g, "gorditas"], [/\bde\s+cebrada\b/g, "de deshebrada"], [/\bcebrada\b/g, "deshebrada"],
  [/\blasada\b/g, "la asada"], [/\bquesi[bv]irrias?\b|\bquesa[bv]irrias?\b|\bquesadillas?\s+de\s+birrias?\b/g, "queso birrias"], [/\b(?:misteados?|mixteados?|mezclados?|surtidos?)\b/g, "mezclados"], [/\bpapas\s+con\s+razas\b/g, "papas con rajas"], [/\bde\s+razas\b/g, "de rajas"], [/\bchicharron\s+prensado\b/g, "prensado"], [/\bchicharron\s+duro\b/g, "duro"], [/\b(de\s+)+(al\s+)?(de\s+)+/g, "de "],
];
const CNT: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const NUM = "un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\\d+";
const n = (w: string) => CNT[w] || Number(w) || 1;
const MEATS: Array<[string, string]> = [
  ["nopales con papas", "Nopales con Papas / Cacti with Potatoes"], ["papas con rajas", "Papas Con Rajas / Poblano with Potatoes"], ["huevo con chile", "Huevo con Chile / Spicy Egg"],
  ["bistec", "Bistec / Steak"], ["asada", "Bistec / Steak"], ["cabeza", "Cabeza / Beef Head"], ["carnitas", "Carnitas / Pulled Pork"], ["chorizo", "Chorizo / Mexican Sausage"],
  ["costilla", "Costilla / Beef Rib"], ["pollo", "Pollo / Chicken"], ["pastor", "Alpastor / Roasted Pork"], ["buche", "Buche / Pork Stomach"], ["lengua", "Lengua / Beef Tongue"],
  ["tripa", "Tripa / Beef Tripe"], ["prensado", "Prensado / Spicy Pork"], ["duro", "Duro / Pork Rinds"], ["deshebrada", "Deshebrada / Shredded Beef with Potatoes"],
  ["picadillo", "Picadillo / Ground Beef with Potatoes"],
];
const MW = MEATS.map(([k]) => k.replace(/ /g, "\\s+")).join("|") + "|tripas";
const meat = (w: string) => { const k = w.replace(/\s+/g, " ").replace(/^tripas$/, "tripa"); return (MEATS.find(([m]) => m === k) || [])[1]; };
type Dish = "g" | "t" | "to" | "cr" | "q";
const DISH: Record<Dish, { id: string; meatStep: string; base?: { step: string; option: string } }> = {
  g: { id: "sq-gordita-M647RE", meatStep: "(B) Q Carnes / Meats", base: { step: "(A) Gordita Options", option: "(GD) Gordita" } },
  t: { id: "sq-taco-TAR7L5", meatStep: "(B) T Carnes / Meats Opciones" },
  to: { id: "sq-torta-4GNTTE", meatStep: "(B) Torta Carne Options", base: { step: "(A) Torta Options", option: "(TO) Torta" } },
  q: { id: "sq-quesadilla-HLT6CR", meatStep: "(B) Q Carnes / Meats" },
  cr: { id: "sq-chiles-rellenos-platillo-stuffed-poblano-pepper-EUM4MG", meatStep: "" },
};
const dishOf = (w: string): Dish => (/^quesadill/.test(w) ? "q" : /^gordit/.test(w) ? "g" : /^taco/.test(w) ? "t" : /^torta/.test(w) ? "to" : "cr");
const DISHW = "quesadillas?|gorditas?|tacos?|tortas?|(?:ordenes\\s+de\\s+)?chiles?\\s+rellenos?";
const OTHER = /\b(?:burritos?|sopes?|tostadas?|flautas?|menudo|caldo|pozole|huaraches?|doradas?|aguas?|coca|refrescos?|sodas?|nachos|tamales?|enchiladas?|chilaquiles|especial|combo|birrias?|mole|platillo|pambazos?|esquites?|elotes?)\b/;
const QB_ID = "sq-queso-birrias-qst-3-x-queso-birrias-taquera-street-con-consome-broth-VUBNR7";
// no flavor said ("mezclados") → the Jarrito line carries the mixed note; staff picks the flavors
const JARRITO_ID = "sq-drink-jarrito-mandarina-mandarin-I4GNSG";
const AVQ = /^(?:(?:y|e|eh|ah|em|este|oiga|oye|disculpe|hola|bueno|si)\s+)*(?:y\s+)?(?:tienes?|tienen|hay|venden|manejan|hacen|hace|preparan|prepara|sirven|sirve|ofrecen|ofrece)\b/;
/** "¿tienes pollo a la crema? Ajá" / "tiene quesadilla de birria" — asks, orders nothing (no order verb or count+dish). */
// cmissing1 (CA8e3de9a): English "calling to see if you guys have pozole verde", "how about ceviche?", "what about X?",
// "is there X?", "any X today?" — asks, orders nothing (same rule as the Spanish ¿tiene/hay).
const AVQ_EN = /^(?:(?:hi|hey|hello|yes|yeah|ok(?:ay)?|so|and|oh|um|uh|but|no|i\s+was\s+(?:calling|wondering|checking)\s+(?:to\s+(?:see|ask|check)\s+)?(?:if|whether)|calling\s+to\s+see\s+if|just\s+wondering\s+if|i\s+wanted\s+to\s+(?:see|know|ask)\s+if)\s+)*(?:(?:do|does)\s+)?(?:you|y'?all)(?:\s+guys)?(?:\s+still)?\s+(?:have|got|carry|sell|make|serve)\b|^(?:(?:ok(?:ay)?|and|so|oh|um|hi|hey)\s+)*(?:how|what)\s+about\b|^(?:(?:ok(?:ay)?|and|so|oh|um|hi|hey)\s+)*(?:is|are)\s+there\b|^(?:(?:ok(?:ay)?|and|so|oh|um|hi|hey)\s+)*(?:got\s+)?any\s+[a-z ]{2,30}(?:\s+today|\s+tonight|\s+left)?$/;
const ORDER_EN = /\b(?:can\s+i\s+(?:get|have|order)|could\s+i\s+(?:get|have)|i'?ll\s+(?:take|have|get)|i\s+(?:want|need)|i'?d\s+like|let\s+me\s+(?:get|have)|give\s+me|get\s+me|order\s+of|for\s+pickup|to\s+go)\b/;
export function isAvailQ(x: string): boolean {
  const y = nf(x).replace(/\bi\s+was\s+calling\s+to\s+see\s+if\b/, "calling to see if");
  if (/\b(?:me\s+da|dame|deme|me\s+pone|ponme|pongame|quiero|quisiera|me\s+das|una\s+orden)\b/.test(y) || ORDER_EN.test(y)) return false;
  // jonathan2: "una pregunta, ¿tiene tacos dorados?" — pregunta + tiene/hay asks, orders nothing
  if (/\b(?:pregunta|duda|question)\b/.test(y) && /\b(?:tienes?|tienen|hay|venden|manejan)\b/.test(y)) return true;
  // a "how about X" after the caller already ordered is a suggestion ask, still no add: no count words allowed
  if (/\b(?:\d+|one|two|three|four|five|six|dos|tres|cuatro)\s+[a-z]/.test(y) && !AVQ.test(y)) return false;
  return AVQ.test(y) || AVQ_EN.test(y.replace(/^(?:(?:but|no|hi|hey|ok(?:ay)?)\s+)+/, "").replace(/^i\s+was\s+/, "i was "));
}
/** Thanks / ok / bueno with no order and no count. An acknowledgement never adds a line. */
export function isAck(x: string): boolean {
  const y = nf(x);
  if (!y || /\b(?:quiero|dame|deme|me\s+da|me\s+pone|ponme|ordeno|i'?ll|i\s+want|give\s+me|can\s+i)\b/.test(y)) return false;
  if (/\b(?:\d+|dos|tres|cuatro|cinco|seis|one|two|three|four|five|six)\b/.test(y)) return false;
  if (!/\b(?:gracias|thanks|thank)\b/.test(y)) return false;
  return /^(?:(?:ah|oh|ok(?:ay)?|bueno|gracias|thanks|thank(?:\s+you)?|vale|sale|perfecto|listo|bye|adios)\s*)+$/.test(y);
}
/** A caller turn whose food words are all in the staff's last lines ("Coctel de camarón." after staff "cóctel de camarón"). */
export function isEchoOfStaff(x: string, staff: string): boolean {
  const y = nf(x).replace(/\b(?:dice|dices|eh|ah|aja|ok|si|y|este|pues)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!y || !staff.trim()) return false;
  const words = y.split(" ").filter((w) => w.length > 2 && !/^(?:del?|las?|los?|con|una?|uno)$/.test(w));
  if (!words.length || words.length > 6) return false;
  const st = nf(staff);
  // only a staff menu listing ("tenemos enchiladas, tacos al vapor, … cóctel de camarón") — not a question being answered
  if (!/\b(?:tenemos|hay|tambien|manejamos|nomas|solo)\b/.test(st) || /\b(?:o|cual|cuales|que|cuantos?|quieres?|gusta)\b/.test(st)) return false;
  const stem = (w: string) => w.replace(/(?:es|s)$/, "");
  return words.every((w) => new RegExp(`\\b${stem(w)}`).test(st)) && !/\b(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\b/.test(y);
}
type Item = { dish: Dish; meat?: string; also?: string[]; n: number; grp: number; notes: string[]; plate: number; person?: string };
type Grp = { dish: Dish; want: number; grp: number; open?: boolean; sinQueso?: boolean; style?: string; side?: string; tort?: string; cebolla?: boolean };
type MeatN = { n: number; meat: string };
/** Counted meats in one clause ("tres de bistec", "una costilla", "un taco de comal de lengua"). "de X no" is not a count. */
function meatCounts(s: string): MeatN[] {
  const out: MeatN[] = [];
  const re = new RegExp(`\\b(${NUM})\\s+(?:(?:tacos?|gorditas?|tortas?|quesadillas?)\\s+)?(?:de\\s+)?(?:(?:comal|harina|maiz|taquer\\w*|street)\\s+de\\s+)?(${MW})\\b`, "g");
  for (const m of s.matchAll(re)) {
    const mt = meat(m[2]); if (!mt) continue;
    if (/^\s+no\b/.test(s.slice((m.index || 0) + m[0].length))) continue;
    const prev = out.find((p) => p.meat === mt);
    if (prev) prev.n = Math.max(prev.n, n(m[1])); else out.push({ n: n(m[1]), meat: mt });
  }
  return out;
}
/** Meats with no count of their own glued to a counted meat: "bistec y chorizo", "bistec chorizo", "bistec con chorizo".
 *  "y dos de chorizo" / "y una costilla" is its own count, not a second meat on the same items. */
function companionMeats(after: string): string[] {
  const out: string[] = [];
  let rest = after;
  for (;;) {
    if (new RegExp(`^\\s+(?:y\\s+|e\\s+|and\\s+)?(?:${NUM})\\b`).test(rest)) break;
    const m = rest.match(new RegExp(`^(?:\\s+y\\s+|\\s+e\\s+|\\s+and\\s+|\\s+con\\s+|\\s+)(${MW})\\b`));
    if (!m) break;
    const mt = meat(m[1]);
    if (!mt || out.includes(mt)) break;
    out.push(mt);
    rest = rest.slice(m[0].length);
  }
  return out;
}
type RecapPart = { n: number; meats: string[] };
/** Staff recap clauses. A dish word sticks to the counts in that clause; a meat with no count stays on the count before it. */
function recapParts(s: string): Array<{ dish: Dish | null; part: RecapPart }> {
  const re = new RegExp(`\\b(${NUM})\\s+(?:(${DISHW})\\s+)?(?:(?:de\\s+)?(?:comal|harina|maiz|taquer\\w*|street|normal\\w*)\\s+)?(?:de\\s+)?(${MW})\\b`, "g");
  const all: Array<{ dish: Dish | null; part: RecapPart }> = [];
  let last: Dish | null = null;
  for (const m of s.matchAll(re)) {
    const end = (m.index || 0) + m[0].length;
    if (/^\s+no\b/.test(s.slice(end))) continue;
    const d = m[2] ? dishOf(m[2].replace(/^ordenes\s+de\s+/, "")) : null;
    if (d) last = d;
    const first = meat(m[3]); if (!first) continue;
    const meats = [first, ...companionMeats(s.slice(end)).filter((x) => x !== first)];
    all.push({ dish: d || last, part: { n: n(m[1]), meats } });
  }
  return all;
}
/** Parts that belong to this dish. A recap that names two dishes does not pour the other dish's meat onto this one. */
function recapFor(s: string, dish: Dish): RecapPart[] | null {
  const all = recapParts(s);
  if (!all.length) return null;
  const named = new Set(all.map((a) => a.dish).filter((d): d is Dish => !!d));
  const mine = named.size >= 2 || (named.size === 1 && !named.has(dish)) ? all.filter((a) => a.dish === dish) : all;
  const parts = mine.map((a) => a.part);
  if (parts.length >= 2 || parts.some((p) => p.meats.length >= 2)) return parts;
  return null;
}
/** "cinco tacos de bistec, no, tres de bistec y una costilla" — the list after "no" replaces the announcement. */
function meatRewrite(after: string): MeatN[] | null {
  const m = after.match(/\bno\b([\s\S]*)$/); if (!m) return null;
  const parts = meatCounts(m[1]); return parts.length ? parts : null;
}
/** One tortilla in a staff statement. "de comal" / "Taqueroso de Comal" is homemade; "¿comal o harina?" is not a choice. */
function specStyle(raw: string): "comal" | "taquero" | "harina" | null {
  const one = (sentence: string): "comal" | "taquero" | "harina" | null => {
    const sp = nf(sentence);
    // "¿Del comal?" / "¿comal o harina?" is a guess, not the tortilla.
    // "Taqueroso de Comal." is homemade even though the word also starts with taquer.
    if (/\?/.test(sentence)) return null;
    const comal = /\bcomal\b/.test(sp), taq = /\b(?:taquer\w*|street)\b/.test(sp), har = /\b(?:harina|flour)\b/.test(sp);
    const nStyles = [comal, taq, har].filter(Boolean).length;
    if (/\b(?:de|del)\s+comal\b/.test(sp)) return "comal";
    if (nStyles === 1) return comal ? "comal" : taq ? "taquero" : "harina";
    return null;
  };
  for (const s of String(raw || "").split(/(?<=[.?!])\s+/)) { const hit = one(s); if (hit) return hit; }
  return null;
}

export function spokenLedger(turns: T[]): { lines: SpokenLine[]; people: string[] } | null {
  const items: Item[] = []; const groups: Grp[] = [];
  let cur: Grp | null = null, plate = 1, salsa: { oz: 2 | 4 | null; flavor: string } | null = null, lastStaff = "", prevStaff = "";
  let pendingStyle: "comal" | "taquero" | "harina" | null = null;
  let pendingRecap: RecapPart[] | null = null;
  let qb: { n: number; style?: string } | null = null, qbAsked = false, jar: { n: number; mixed: boolean } | null = null, jarAsk = false;
  const fill = (g: Grp) => items.filter((i) => i.grp === g.grp).reduce((s, i) => s + i.n, 0);
  for (const t of turns) {
    let x = nf(t.text); for (const [re, to] of ALIAS) x = x.replace(re, to);
    if (t.speaker !== "caller") {
      prevStaff = lastStaff; lastStaff = x;
      if (qb && /\bqueso\s+birrias\s+del\s+comal\b/.test(x)) qb.style = qb.style || "comal";
      if (/\bcuantos\s+jarritos\b/.test(x)) jarAsk = true;
      if (/\btodo\s+va\s+sin\s+queso\b/.test(x)) groups.forEach((g) => (g.sinQueso = true));
      const st = specStyle(t.text); if (st) pendingStyle = st;
      // "tres de bistec y dos de costilla" — held until the caller affirms it.
      // A recap that also names another dish ("dos gorditas de prensado y dos tacos … de bistec y chorizo")
      // only rewrites this dish; the other dish's meat is not copied onto it.
      if (cur && cur.dish !== "cr") { const parts = recapFor(x, cur.dish); if (parts) pendingRecap = parts; }
      continue;
    }
    const bareYes = /^(?:si|aja|claro|ok|okay|correcto|exacto|perfecto|eso es|asi es|yes|yeah|sale|va)$/.test(x);
    const recapNow = cur ? recapFor(lastStaff, cur.dish) : null;
    if (/^(?:no|nel|nop)\b/.test(x) && pendingRecap && recapNow) pendingRecap = null;
    // affirmed staff count replaces the caller's earlier split; staff "de comal" sets the tortilla when the caller never named one
    if (bareYes && cur && cur.dish !== "cr" && pendingRecap && recapNow) {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].grp === cur.grp) items.splice(i, 1);
      for (const p of pendingRecap) items.push({ dish: cur.dish, meat: p.meats[0], also: p.meats.slice(1), n: p.n, grp: cur.grp, notes: [], plate });
      cur.want = pendingRecap.reduce((s, p) => s + p.n, 0);
      if (pendingStyle) cur.style = pendingStyle;
      pendingRecap = null;
      continue;
    }
    // anthony1: caller repeating the staff's menu list ("Tacos al vapor, enchilada, dice" / "Coctel de camarón") orders nothing
    if (isEchoOfStaff(x, lastStaff + " " + prevStaff)) continue;
    // anthony1: "¿tiene quesadilla de birria?" → "Sí" → "¿me da una orden de esa? De quesadilla" = 1 Queso Birrias
    if (/\bqueso\s+birrias\b/.test(x) && isAvailQ(x)) { qbAsked = true; continue; }
    if (qbAsked && !qb && /\b(?:una\s+orden|uno|una)\s+de\s+(?:esa|esas|esos|ese)\b/.test(x)) { qb = { n: 1, style: /\bcomal\b/.test(x) ? "comal" : undefined }; continue; }
    if (/\bqueso\s+birrias\b/.test(x) && !isAvailQ(x)) { const m = x.match(new RegExp(`\\b(${NUM})\\s+(?:ordenes?\\s+de\\s+)?queso\\s+birrias\\b`)); qb = { n: m ? n(m[1]) : 1, style: /\bcomal\b/.test(x) ? "comal" : qb?.style }; continue; }
    // jarritos: "jarrito" + "¿cuántos jarritos?" → "cuatro" → "¿mezclados?" → "sí, mezclado"
    if (/\bjarritos?\b/.test(x)) { const m = x.match(new RegExp(`\\b(${NUM})\\s+jarritos?\\b`)); jar = jar || { n: 0, mixed: false }; if (m) jar.n = n(m[1]); }
    if (jarAsk && jar && !jar.n) { const m = x.match(new RegExp(`^(?:\\S+\\s+){0,2}?(${NUM})\\b`)); if (m) { jar.n = n(m[1]); jarAsk = false; continue; } }
    if (jar && /\bmezclados\b/.test(x + " " + (/^\s*(?:si|aja|ok|claro)\b/.test(x) ? lastStaff : ""))) { jar.mixed = true; if (!new RegExp(`\\b(?:${DISHW})\\b`).test(x)) continue; }
    // "Sí, normales, taqueros" answers "¿Del comal?" by naming the street taco. A bare sí to a comal statement keeps comal.
    if (cur && cur.dish === "t" && /\b(?:taquer\w*|street)\b/.test(x)) cur.style = "taquero";
    else if (cur && cur.dish === "t" && /\bnormales?\b/.test(x) && /\b(?:tacos?|comal|taquer)\b/.test(x + " " + lastStaff)) cur.style = "taquero";
    else if (cur && /\bcomal\b/.test(lastStaff) && /^\s*(?:si|aja|claro|ok|okay)\b/.test(x) && cur.dish !== "cr" && !/\b(?:taquer\w*|street|normales?)\b/.test(x)) cur.style = cur.style || "comal";
    // anthony1: a pure availability question ("¿tienes pollo a la crema? Ajá") orders nothing
    if (isAvailQ(x) && !new RegExp(`\\b(?:${NUM})\\s+(?:${DISHW})\\b`).test(x)) continue;
    // an unanswered staff menu list in a caller turn ("¿qué más tienes?") adds nothing
    if (/\bque\s+(?:mas\s+)?tienes?\b/.test(x) && !new RegExp(`\\b(?:${NUM})\\s+de\\b`).test(x)) continue;
    const bad = x.match(OTHER); if (bad && !/\bno\s+hicieron\b|\bhoy\s+no\b|\btienes?\b|\bdices\b|\bhay\b/.test(x)) return null;
    if (/\b(?:en\s+)?otro\s+plato\b/.test(x)) plate++;
    // new announced group: "seis gorditas", "dos tortas al pastor", "dos ordenes de chiles rellenos"
    const ann = x.match(new RegExp(`\\b(${NUM})\\s+(${DISHW})\\b(?:\\s+(?:ah|eh|este))?(?:\\s+(?:de\\s+tortilla\\s+de\\s+comal\\s+)?(?:al|de)\\s+(${MW}))?`));
    // paco1: an open "una X de A, otra de B, otra de C" list (same turn) grows one line per una/otra; quesadillas only join
    // the ledger through such a list (their counted orders stay with the turn-by-turn shadow)
    const openList = !!ann && n(ann[1]) === 1 && dishOf(ann[2]) === "q" && (x.slice((ann.index || 0) + ann[0].length).match(/\botr[ao]s?\s+de\b/g) || []).length >= 2;
    // quesadillas outside an open una/otra list (counted, other dishes in the call) are not modeled → whole ledger off
    if (/\bquesadillas?\b/.test(x) && !openList && !groups.some((g) => g.dish === "q") && !/\btienen?\b|\btienes\b|\bhay\b/.test(x)) return null;
    if (groups.length && !groups.every((g) => g.dish === "q") && (openList || /\bquesadillas?\b/.test(x) && groups.some((g) => g.dish === "q"))) return null;
    if (ann && dishOf(ann[2]) === "q" && !openList && !groups.some((g) => g.dish === "q")) { /* not modeled */ }
    else if (ann && !/\bcuantos\s+lleva\b/.test(x)) {
      const dish = dishOf(ann[2].replace(/^ordenes\s+de\s+/, "")), want = n(ann[1]), mt = ann[3] ? meat(ann[3]) : undefined;
      // "cinco tacos de bistec, no, tres de bistec y una costilla" rewrites the announcement; it does not keep 5 of the first meat
      const rw = openList ? null : meatRewrite(x.slice((ann.index || 0) + ann[0].length));
      if (rw) {
        cur = { dish, want: rw.reduce((s, p) => s + p.n, 0), grp: groups.length + 1 };
        groups.push(cur);
        for (const p of rw) items.push({ dish, meat: p.meat, n: p.n, grp: cur.grp, notes: [], plate });
      } else {
      // restatement ("dos tortas." … "dos, dos tortas de" … "dos tortas al pastor"; "los cuatro tacos a nombre de…")
      const same = groups.find((g) => g.dish === dish && g.want === want && (!mt || !items.some((i) => i.grp === g.grp) || items.some((i) => i.grp === g.grp && i.meat === mt)));
      const also = mt ? companionMeats(x.slice((ann.index || 0) + ann[0].length)).filter((m) => m !== mt) : [];
      if (same) { cur = same; if (mt && !items.some((i) => i.grp === same.grp)) items.push({ dish, meat: mt, also, n: want, grp: same.grp, notes: [], plate }); }
      else { cur = { dish, want, grp: groups.length + 1, open: openList }; groups.push(cur); }
      // anthony1: "ocho gorditas de asada. Cuatro y cuatro" — a split count after the meat means only the first part is that meat
      const split = ann[3] ? x.slice((ann.index || 0) + ann[0].length).match(new RegExp(`^\\s*(${NUM})\\s+y\\s+(${NUM})\\b`)) : null;
      if (!same && split && n(split[1]) + n(split[2]) === cur.want) items.push({ dish: cur.dish, meat: meat(ann[3]), n: n(split[1]), grp: cur.grp, notes: [], plate });
      else if (same) { /* restated */ } else if (ann[3]) items.push({ dish: cur.dish, meat: meat(ann[3]), also, n: cur.want, grp: cur.grp, notes: [], plate });
      else if (cur.dish === "cr") items.push({ dish: "cr", n: cur.want, grp: cur.grp, notes: [], plate });
      }
    }
    if (cur) {
      const g: Grp = cur;
      // "uno de nopales con papas", "dos de pastor y dos de cabeza", "una de prensado con nopales", "igual de prensado …"
      const rest = ann ? x.slice((ann.index || 0) + ann[0].length) : x;
      for (const m of rest.matchAll(new RegExp(`\\b(?:(${NUM})\\s+(?:de\\s+|del\\s+|(?=(?:al\\s+)?(?:pastor|asada|bistec|carnitas|chorizo)\\b))|igual\\s+de\\s+|(otr[ao]s?)\\s+(?:de\\s+)?)(?:la\\s+|al\\s+)?(${MW})(\\s+con\\s+nopales)?\\b`, "g"))) {
        // paco1: every "una de / otra de" in an open (una …) list is its own line
        if (m[2] && !g.open) continue;
        if (g.open && fill(g) >= g.want && (m[2] || m[1])) g.want += m[1] ? n(m[1]) : 1;
        if (fill(g) >= g.want) break;
        // restatement inside a split ("cuatro de asada y cuatro pastor" after 4 asada already) is not more asada
        if (m[1] && n(m[1]) > 1 && !g.open && items.some((i) => i.grp === g.grp && i.plate === plate && i.meat === meat(m[3]) && i.n === n(m[1]))) continue;
        const q = Math.min(m[1] ? n(m[1]) : 1, g.want - fill(g));
        items.push({ dish: g.dish, meat: meat(m[3]), n: q, grp: g.grp, notes: m[4] ? ["con nopales"] : [], plate });
      }
      if (/\bsin\s+queso\b/.test(x)) g.sinQueso = true;
      if (/\b(?:tortilla\s+de\s+)?comal\b/.test(x)) g.style = "comal";
      if (/\bharina\b/.test(x) && g.dish !== "cr") g.style = "harina";
      if (g.dish === "cr") {
        if (/\bmaiz\b/.test(x)) g.tort = "corn"; else if (/\bharina\b/.test(x)) g.tort = "flour";
        if (/\bmas\s+arroz\s+que\s+frijol/.test(x)) { g.side = "both"; items.filter((i) => i.grp === g.grp).forEach((i) => i.notes.push("más arroz que frijoles")); }
        else if (/\bsolo\s+arroz\b/.test(x)) g.side = "rice"; else if (/\bsolo\s+frijol/.test(x)) g.side = "beans";
        else if (/\barroz\s+y\s+frijol/.test(lastStaff) && /^\s*(?:si|claro|ok)/.test(x)) g.side = "both";
      }
      if (/\bcebollit?a(?:s)?\s+asada|\bcebolla\s+y\s+chiles\b/.test(x)) g.cebolla = true;
      if (/\bcon\s+frijol(?:es|itos)?\b/.test(x) && g.dish !== "cr") items.filter((i) => i.grp === g.grp).forEach((i) => i.notes.includes("frijoles") || i.notes.push("frijoles"));
    }
    // side salsa: "más salsita aparte" / "¿tiene de la asada?" / "de cuatro" (answer to "¿cuatro onzas o dos onzas?")
    if (/\b(?:mas\s+)?salsit?a\b.*\baparte\b|\baparte\b.*\bsalsit?a\b/.test(x)) salsa = salsa || { oz: null, flavor: "asada" };
    if (salsa && /\bverde\b/.test(x)) salsa.flavor = "verde";
    if (salsa && /\bde\s+cuatro\b/.test(x) && /\bonzas\b/.test(lastStaff)) salsa.oz = 4;
    if (salsa && /\bde\s+dos\b/.test(x) && /\bonzas\b/.test(lastStaff)) salsa.oz = 2;
    // people: "los cuatro tacos a nombre de Osmar Lira", "esa es a nombre de Ulises Sanchez, las tortas"
    const who = String(t.text).match(/\ba\s+nombre\s+de\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u);
    if (who) {
      const d = x.match(/\b(gorditas|tacos|tortas|chiles)\b/);
      const tgt = d ? items.filter((i) => i.dish === dishOf(d[1])) : items.filter((i) => !i.person);
      tgt.forEach((i) => (i.person = who[1]));
    }
  }
  if (jar && !jar.n) return null;
  if (!groups.length || groups.some((g) => fill(g) !== g.want)) return null;
  const lines: SpokenLine[] = [];
  for (const it of items) {
    const g = groups.find((x) => x.grp === it.grp)!; const D = DISH[it.dish];
    const mods: Array<{ step: string; option: string }> = []; const notes = [...it.notes.filter((x) => x !== "frijoles")];
    let rb = "";
    if (it.dish === "cr") {
      mods.push({ step: "(A) Tipo de Chiles Relleno", option: "QUESO / CHEESE" },
        { step: "(B) Lado / Side", option: g.side === "rice" ? "SOLO Arroz / ONLY Rice" : g.side === "beans" ? "SOLO Frijoles / ONLY Beans" : "Arroz-Rice and Frijoles-Beans" },
        { step: "(C) Tortilla Options", option: g.tort === "flour" ? "3 x (Flour) Harina Tortilla" : "3 x (Corn) Corn Tortilla" });
      rb = `${it.n} chile relleno de queso`;
    } else {
      if (D.base) mods.push(D.base);
      if (it.dish === "q") mods.push({ step: "(A) Q Tortilla Options", option: g.style === "harina" ? "(QHR) Quesadilla Harina / Flour (+$0.75)" : g.style === "comal" ? "(QCO) Quesadilla Comal / Homemade (+$1.00)" : "(QST) Quesadilla Taquera / Street Quesadilla" });
      if (it.dish === "t") mods.push({ step: "(A) T Tortilla Options", option: g.style === "harina" ? "(THR) Taco Harina / Flour (+$0.50)" : g.style === "comal" ? "(TCO) Taco Comal / Homemade (+$1.00)" : "(TST) Taco Taquero / Street Taco" });
      const meats = [it.meat, ...(it.also || [])].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
      for (const mt of meats) mods.push({ step: D.meatStep, option: mt });
      if (it.notes.includes("frijoles")) mods.push({ step: "(C) Con / With", option: "**Con Frijoles / With Beans" });
      if (g.cebolla) mods.push({ step: "(F) GQT Extras", option: "**EXTRA Cebolla y Chiles Asados" });
      if (g.sinQueso) notes.push("sin queso");
      if (groups.some((x) => x.dish === it.dish) && items.some((i) => i.plate > 1)) notes.push(`plato ${it.plate}`);
      rb = `${it.n} ${{ g: "gordita", t: "taco", to: "torta", q: "quesadilla" }[it.dish as "g"]} ${meats.map((m) => String(m).split(" /")[0].toLowerCase()).join(" y ")}`.trim();
    }
    lines.push({ itemId: D.id, quantity: it.n, modifiers: mods, readback: rb, ...(notes.length ? { elviNotes: notes } : {}), ...(it.person ? { person: it.person } : {}) });
  }
  if (qb) lines.push({ itemId: QB_ID, quantity: qb.n, modifiers: [{ step: "(A) Queso Birrias Options", option: qb.style === "taquera" ? "(QST) 3 x Queso Birrias Taquera / Street con Consome/Broth" : "(QCO) 3 x Queso Birrias Comal / Homemade con Consome/Broth" }], readback: `${qb.n} queso birrias${qb.style === "comal" ? " del comal" : ""}` });
  if (jar && jar.n) lines.push({ itemId: JARRITO_ID, quantity: jar.n, modifiers: [], readback: `${jar.n} jarritos${jar.mixed ? " mezclados" : ""}`, ...(jar.mixed ? { elviNotes: ["sabores mezclados / mixed flavors"] } : {}) });
  if (salsa && salsa.oz) lines.push({ itemId: "sq-extras-mild-salsa-asada-2oz-T6PGNT", quantity: 1, modifiers: [{ step: "Extras options", option: `${salsa.flavor === "verde" ? "Medium Salsa Verde" : "Mild Salsa Asada"} ${salsa.oz}oz` }], readback: `1 salsa ${salsa.flavor} ${salsa.oz}oz` });
  const people = [...new Set(items.map((i) => i.person).filter((p): p is string => !!p))];
  return { lines, people };
}

/** Dishes staff said are not available today ("eso es hasta mañana", "no hay", "se acabó"), from the caller's question. */
// relleno2: "se me acabaron", "se acabó", "ya no hay/tengo/queda", "no me quedan", "se terminaron", "agotado" (plus the older list)
export const UNAVAIL_ES = /\bhasta\s+manana\b|\bno\s+hay\b|\bse\s+(?:(?:me|nos|le|les)\s+)?(?:acab|termin)(?:o|a|aron|an)\b|\bya\s+no\s+(?:hay|tengo|tenemos|queda|quedan|(?:me|nos)\s+queda(?:n)?)\b|\bno\s+(?:me|nos)\s+queda(?:n)?\b|\bno\s+(?:tenemos|tengo)\b(?!\s+(?:de\s+)?(?:chorizo|bistec|steak|asada|pastor|alpastor|pollo|carnitas|cabeza|lengua|tripa|buche|prensado|costilla|deshebrada|picadillo|duro|chicharron|queso|papa|frijol|nopal|hongo|flor|rajas|huevo|camaron|pescado)\w*\b)|\bagotad[oa]s?\b|\bmanana\s+si\b|^no\s+(?:hoy|ahorita)\b|\bhoy\s+no\b/;
/** A staff "unavailable" dish key ("chile relleno", "pozole verde") matches a menu id when every word stem is in it. */
export function unavailMatchesId(d: string, id: string): boolean {
  const x = String(id || "").toLowerCase(); const ws = d.split(/\s+/).filter((w) => w.length >= 3);
  return ws.length > 0 && ws.every((w) => x.includes(w.replace(/(?:es|s)$/, "").slice(0, Math.max(4, w.length - 2))));
}
/** Index of the last staff turn that declared dish d unavailable (−1 if none). */
export function staffUnavailableAt(turns: T[], d: string): number {
  for (let i = turns.length - 1; i >= 1; i--) if (turns[i].speaker === "staff" && staffUnavailable(turns.slice(0, i + 1)).includes(d) && !staffUnavailable(turns.slice(0, i)).includes(d)) return i;
  return -1;
}
export function staffUnavailable(turns: T[]): string[] {
  const out = new Set<string>();
  for (let i = 1; i < turns.length; i++) {
    const s = turns[i]; if (s.speaker !== "staff") continue;
    const x = nf(s.text);
    const en = /^(?:no\s+)?we\s+(?:don'?t|do\s+not)\b|\bnot\s+today\b|\b(?:don'?t|do\s+not)\s+have\b|\bsold\s+out\b|\bran\s+out\b|\bwe'?re\s+out\s+of\b|\bnot\s+(?:available|right\s+now)\b/.test(x);
    if (!en && !UNAVAIL_ES.test(x)) continue;
    // cmissing1: the dish the caller just asked about ("how about ceviche?" → staff "Not today.")
    const ask = turns[i - 1]?.speaker === "caller" && isAvailQ(turns[i - 1].text) ? turns[i - 1] : null;
    if (ask) { const w = nf(ask.text).replace(/\b(?:today|tonight|hoy|left|still|guys|you|have|got|any|about|how|what|is|are|there|do|does|tienen?|tienes|hay|calling|see|if|i|was|to|hi|but|no|okay|ok|the|some|y|el|la|los|las|de)\b/g, " ").trim().split(/\s+/).find((w) => w.length >= 4);
      if (w) out.add(w.replace(/s$/, "")); }
    // lupita2 (CAbcdfda): "tengo pozole rojo … Sí, hay menudo todavía … De arriba se acabó." — only the clause that says sold-out names the
    // dish; with no dish in that clause, dishes staff affirmed in the window ("tengo/hay/tenemos X", "sí hay X") are never off.
    const clauses = String(s.text).split(/(?<=[.!?;])\s+/).map(nf).filter((c) => en || UNAVAIL_ES.test(c));
    const DISH_ANY = /\b(?:enchiladas?|tacos?\s+al\s+vapor|tamales?|pozole|menudo|mole|chilaquiles|birria|caldo|guisados?|tostadas?|flautas?|chiles?\s+rellenos?|sopes?|huaraches?|ceviche|cocteles?|camarones|pambazos?|tlayudas?|alambres?|molcajetes?|fajitas?|chicharron(?:es)?|elotes?|esquites?|champurrado|atole|horchata|jamaica|tamarindo|flan|churros?)\b/;
    const win = turns.slice(Math.max(0, i - 3), i + 1).map((t) => nf(t.text)).join(" ");
    const prev0 = clauses.some((c) => DISH_ANY.test(c)) ? clauses.join(" ") : win;
    const affirmed = (d: string) => new RegExp(String.raw`\b(?:tengo|tenemos|si\s+hay|hay|todavia\s+hay|queda|quedan)\s+(?:\w+\s+){0,2}` + d.slice(0, 5)).test(win) && !clauses.some((c) => c.includes(d.slice(0, 5)));
    const prev = prev0;
    for (const m of prev.matchAll(/\b(enchiladas?|tacos?\s+al\s+vapor|tamales?|pozole|menudo|mole|chilaquiles|birria|caldo|guisados?|tostadas?|flautas?)\b/g)) out.add(m[1].replace(/s$/, "").replace(/^taco al vapor$/, "tacos al vapor"));
    const notADish = new Set(["disculpa", "perdon", "sorry", "hoy", "ahora", "nada", "eso", "esto", "aqui", "todavia", "senor", "senora", "problema"]);
    const addNamed = (word: string) => {
      const stem = word.replace(/s$/, "");
      if (!notADish.has(stem) && !notADish.has(word)) out.add(stem);
    };
    for (const clause of clauses) {
      for (const m of clause.matchAll(/\bno\s+hay\s+([a-z]{4,14})\b/g)) addNamed(m[1]);
      for (const m of clause.matchAll(/\b([a-z]{4,14})\s+(?:are|is)\s+unavailable\b/g)) addNamed(m[1]);
    }
    // relleno2 (CA8f33ce5): "Chile relleno se me acabaron" — more dishes, said in the staff turn or the ask just before it
    for (const m of prev.matchAll(/\b(chiles?\s+rellenos?|sopes?|huaraches?|ceviche|cocteles?|camarones|tamales?|pambazos?|tlayudas?|alambres?|molcajetes?|fajitas?|chicharron(?:es)?|elotes?|esquites?|champurrado|atole|horchata|jamaica|tamarindo|flan|churros?)\b/g))
      out.add(m[1].replace(/^chiles?\s+rellenos?$/, "chile relleno").replace(/es$/, (e) => (/(?:camarones|chicharrones)$/.test(m[1]) ? "es" : e)).replace(/(?<=[aeiou])s$/, ""));
    for (const d of [...out]) if (!ask && affirmed(d)) out.delete(d);
  }
  return [...out];
}

/** gio1: "una de tripa y (una) de bistec" — each named meat is ONE unit; an announced "dos quesadillas" is shared across the split
 * lines, never stamped on each/one. Returns the meats split this way (normalized), or null. */
export function unaSplitMeats(text: string): string[] | null {
  const x = nf(text);
  const m = x.match(/\buna?\s+de\s+([a-z]+(?:\s+con\s+[a-z]+)?)((?:\s*,?\s*(?:y\s+)?(?:una?\s+|otr[ao]\s+)?de\s+[a-z]+(?:\s+con\s+[a-z]+)?)+)/);
  if (!m) return null;
  const rest = [...m[2].matchAll(/de\s+([a-z]+(?:\s+con\s+[a-z]+)?)/g)].map((r) => r[1]);
  const meats = [m[1], ...rest].filter((w) => !/^(comal|harina|maiz|todo|eso|esas?|esos?|dos|tres|cuatro|aceite)$/.test(w));
  return meats.length >= 2 ? meats : null;
}
/** Set qty 1 on lines whose meat option is one of the una-split meats. Mutates & returns whether anything changed. */
export function applyUnaSplit(lines: any[], meats: string[]): boolean {
  let ch = false;
  for (const l of lines) {
    const opt = nf((l.modifiers || []).map((o: any) => String(o.option || "")).join(" "));
    if (meats.some((w) => new RegExp(`\\b${w.split(" ")[0]}\\b`).test(opt)) && Number(l.quantity) > 1) { l.quantity = 1; ch = true; }
  }
  return ch;
}
