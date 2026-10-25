// ordername1: the name on each phone order. Elvi asks before wrapping up ("¿A nombre de quién?") or lightly confirms a
// saved one ("¿Sigue a nombre de X?"), accepts corrections, and the name goes on the Square order + caller memory as an
// Elvi-heard name (staff-entered names always win). Listen-only calls: pulled from the staff's "¿a nombre de quién?".
import { cleanFullName, cleanFirstName, planCallerName, saveCallerName, savedCallerName, onNameSaved } from "./caller-memory.js";

type Lang = "es" | "en";
export const ASK_NAME = { es: "¿A nombre de quién?", en: "What name for the order?" } as const;
export const confirmNameText = (lang: Lang, first: string) => (lang === "en" ? `Still under ${first}?` : `¿Sigue a nombre de ${first}?`);
export const nameAckText = (lang: Lang, first: string) =>
  lang === "en" ? `Thanks, ${first}. Review your order and check out when you're ready.` : `Gracias, ${first}. Revisa tu orden y cuando estés listo, pasa a pagar.`;
/** Elvi's last reply was a name question → "ask" or "confirm" (with the name confirmed). */
export function nameQuestionIn(reply: string): { kind: "ask" } | { kind: "confirm"; name: string } | null {
  const r = String(reply || "").trim();
  if (/(¿A nombre de quién\?|What name for the order\?)\s*$/.test(r)) return { kind: "ask" };
  const m = r.match(/(?:¿Sigue a nombre de|Still under)\s+([^?]+)\?\s*$/u);
  return m ? { kind: "confirm", name: m[1].trim() } : null;
}
const YES = /^\s*(s[ií]|sip|claro|correcto|as[ií] es|exacto|ajá|aja|yes|yeah|yep|yup|correct|that'?s right|right|sure|ok(ay)?)(?![\p{L}])/iu;
const NO = /^\s*(no|nop|nope)(?![\p{L}])/iu;
const LEAD = /^(?:[\s,.!]*(?:no|nop|nope|s[ií]|yes|yeah|ok(?:ey|ay)?|bueno|pues|este|um+|eh+|ah+|mm+|perd[oó]n|sorry|de|del))*[\s,.!]*/iu;
const PHRASE = /(?<![\p{L}])(?:(?:es\s+|est[aá]\s+|sigue\s+)?al?\s+nombre\s+de|mi\s+nombre\s+es|me\s+llamo|soy|es\s+para|para|ponle|p[oó]ngalo\s+a|it'?s\s+under|under(?:\s+the\s+name)?|put\s+it\s+under|my\s+name\s+is|i'?m|it'?s|es)\s+/iu;
const TAIL = /[\s,.!]*(?:gracias|thanks?|thank you|por favor|please)?[\s.!?]*$/iu;
/** A name in a short answer ("Ana", "a nombre de Ana López", "no, es Luis"). Null for yes/no or junk. */
// name3p1: third-person name inside a longer answer ("es una señora que trabaja conmigo, se llama Ana.")
const THIRD = /(?<![\p{L}])(?:se\s+llama|(?:her|his|the)\s+name\s+is|el\s+nombre\s+es)\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/gu;
/** name3p2: the name in a third-person answer ("se llama Ana") — for the order only, never the caller's record. */
export function thirdPersonName(text: string): string | null {
  const s = String(text || "");
  const th = [...s.matchAll(THIRD)].pop();
  if (th && !NOT_NAMES.test(th[1].split(" ")[0])) return cleanFullName(th[1]) || null;
  // name3p3 / luis1 / shannon1 (Carlos via Auditor): "para Luis" / "for Shannon" / "la va a recoger" /
  // "Shannon is picking up" → Square ticket/pickup name ONLY — never caller contact identity.
  const pick = s.match(/(?<![\p{L}])(?:(?:es\s+)?para\s+|(?:it'?s\s+)?for\s+|la\s+va\s+a\s+recoger(?:\s+(?:el|la|un[oa]?))?\s+|lo\s+recoge\s+|la\s+recoge\s+|picking\s+up\s+(?:under\s+|for\s+)?|pickup\s+(?:under\s+|for\s+)?|under\s+(?:the\s+name\s+)?)(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u);
  if (pick && !/^(llevar|hoy|ma[nñ]ana|ahora|recoger|pickup|entrega|domicilio|pedido|orden|un|una|el|la|los|las|mi|tu|su|unos?|unas?|me|here|pickup|tonight|today|tomorrow)\b/iu.test(pick[1]) && !NOT_NAMES.test(pick[1].split(" ")[0]))
    return cleanFullName(pick[1]) || null;
  const pickBy = s.match(/(?<![\p{L}])(\p{Lu}[\p{L}'-]+)(?:\s+\p{Lu}[\p{L}'-]+)?\s+(?:is|will\s+(?:be\s+)?)\s+(?:picking\s+up|coming\s+(?:by|in)\s+for\s+(?:it|the\s+order))/u);
  if (pickBy && !NOT_NAMES.test(pickBy[1]) ) return cleanFullName(pickBy[1]) || null;
  // luis7895 (Carlos 10/24): "De Luis." after ¿nombre de quién? is the customer — NOT third-person.
  // Pickup-only stays para/for/recoger/picking-up above.
  // jorge1: "Jorge va a pasar por ellos" / "va a pasar por ellos" = pickup/ticket only
  const passBy = s.match(/(?<![\p{L}])(\p{Lu}[\p{L}'-]+)(?:\s+\p{Lu}[\p{L}'-]+)?\s+va\s+a\s+pasar\s+por\b/u);
  if (passBy && !NOT_NAMES.test(passBy[1])) return cleanFullName(passBy[1]) || null;
  if (/\bva\s+a\s+pasar\s+por\b/iu.test(s)) {
    const named = s.match(/(?:a\s+nombre\s+de|para)\s+(\p{Lu}[\p{L}'-]+)/u);
    if (named && !NOT_NAMES.test(named[1])) return cleanFullName(named[1]) || null;
  }
  return null;
}
const orderOnly = new Map<string, number>(); // folded first name → marked-at ms
const foldName = (n: string) => (cleanFirstName(n) || n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function markOrderOnlyName(name: string, now = Date.now()) { orderOnly.set(foldName(name), now); }
export function isOrderOnlyName(name: string, now = Date.now()): boolean { const t = orderOnly.get(foldName(name)); return t != null && now - t < 30 * 60_000; }
export function nameFromAnswer(text: string): string | null {
  let s = String(text || "").trim();
  const th = [...s.matchAll(THIRD)].pop();
  if (th && !NOT_NAMES.test(th[1].split(" ")[0])) { const n = cleanFullName(th[1]); if (n) return n; }
  // jesus1: "¿Ves, Jesús, por favor?" / "Ves, Jesús" — strip discourse filler before the real name
  s = s.replace(/^\s*[¿¡]?\s*(?:ves|vea|mira|oye|oiga|diga|dime)\s*[,.]?\s+/iu, "");
  // Soft request with a name: "¿Jesús, por favor?" (after Ves strip) is an answer; bare ¿Guino? stays a question (gino1)
  {
    const soft = s.match(/^\s*¿\s*([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)\s*,?\s*(?:por\s+favor|please)\s*\?\s*$/u);
    if (soft && !NOT_NAMES.test(soft[1].split(" ")[0])) { const n = cleanFullName(soft[1]); if (n) return n; }
  }
  if (/^\s*¿[^?]*\?\s*$/u.test(s)) return null; // name3p1/gino1: a name question (¿Guino?) is not a name answer
  // jorge1: price/time questions must never become a name ("Okey, ¿cuánto sería?" → junk "Ey Cuánto Sería")
  if (/\b(?:cu[aá]nto|how\s+much|cuanto)\b/iu.test(s) || /\b(?:en\s+)?(?:cu[aá]nto\s+tiempo|how\s+long|minutos?)\b/iu.test(s)) return null;
  // rodolfo1: end-of-call ASR "Sí, sí sé Apple." / bare "Sé" is never a name (callers.json keeps Rodolfo)
  if (/\bs[eé]\b/iu.test(s) && (/\bapple\b/iu.test(s) || /^\s*s[eé]\s*$/iu.test(s) || /\bs[eé]\s+\p{Lu}/u.test(s))) return null;
  if (/[¿?]/.test(s) && /\b(?:ser[ií]a|cuesta|cost|price|precio|tiempo)\b/iu.test(s)) return null;
  const ph = s.match(new RegExp(PHRASE.source + "(.+)$", "iu"));
  if (ph) {
    // jorge1: "A nombre de Jorge. Jorge va a pasar por ellos." → take Jorge before pickup clause
    let rest = ph[1].split(/[.!?]|\s+va\s+a\s+pasar\b/iu)[0] || ph[1];
    s = rest;
  } else s = s.replace(LEAD, "");
  s = s.replace(TAIL, "").replace(/[.,!?¿¡"“”']/g, " ").replace(/\s+/g, " ").trim();
  // freddy1: "Freddy, y van a ser otra orden…" — leading name before order continuation
  {
    const leadName = s.match(/^(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)\s*,?\s+(?:y|e|and)\b/u)
      || s.match(/^(\p{Lu}[\p{L}'-]+)\s*,\s*(?:va\s+a\s+ser|van\s+a|quiero|dame|me\s+pone|otra\s+orden)/iu);
    if (leadName && !NOT_NAMES.test(leadName[1].split(" ")[0])) {
      const n = cleanFullName(leadName[1]);
      if (n) return n;
    }
  }
  // jesus1: drop leading filler tokens still stuck on ("Ves Jesús" → "Jesús")
  {
    const ws = s.split(" ").filter(Boolean);
    while (ws.length && /^(ves|vea|mira|oye|oiga|diga|dime)$/iu.test(ws[0])) ws.shift();
    s = ws.join(" ");
  }
  const words = s.split(" ").filter(Boolean);
  if (!words.length || words.length > 3) return null;
  if (/^(s[ií]|no|yes|ok|okay|bueno|gracias|muchas|thanks|nada|todo|eso|de|ser[ií]a|qu[eé]|algo)$/iu.test(words[0])) return null;
  // suleika1/close1: "Sería todo" / "Nada más" are closings, never a name
  if (words.some((w) => /^(todo|nada|m[aá]s)$/iu.test(w))) return null;
  // rec1: "Okay, está bien, gracias" is not a name
  if (words.some((w) => /^(est[aá]|bien|perfecto|vale|claro|listo|sale|[aá]ndale|correcto|igualmente|fine|good|great|alright|sure|right|perfect)$/iu.test(w))) return null;
  // carlos1: "Okay, muchas gracias" → leftover "muchas" (or "muchas gracias") is gratitude, never a name
  if (words.every((w) => /^(muchas|gracias|thanks?|thank|you|ok(?:ay)?|please|porfa|por|favor|de|nada|igualmente)$/iu.test(w))) return null;
  if (NOT_NAMES.test(words[0])) return null;
  // joseA1: "Ah, es en" / bare prepositions are not names
  if (words.length === 1 && words[0].length <= 2) return null;
  return cleanFullName(words.join(" "));
}
/** Caller's answer to a name question → the order name (confirmed or corrected), or null to ask again. */
export function resolveNameAnswer(answer: string, q: { kind: "ask" } | { kind: "confirm"; name: string }, saved?: string | null): { name: string; corrected: boolean } | null {
  const said = nameFromAnswer(answer);
  if (q.kind === "confirm") {
    if (said && (!saved || cleanFirstName(said) !== cleanFirstName(saved) || NO.test(answer))) return { name: said, corrected: cleanFirstName(said) !== cleanFirstName(saved || q.name) };
    if (YES.test(answer) || (said && cleanFirstName(said) === cleanFirstName(q.name))) return { name: saved || q.name, corrected: false };
    return null; // "no" alone → ask for the name
  }
  return said ? { name: said, corrected: false } : null;
}
/** What Elvi asks before wrapping up, given the caller's saved name (if any). */
export function wrapUpNameQuestion(lang: Lang, saved: string | null | undefined): string {
  const first = cleanFirstName(saved || "");
  return first ? confirmNameText(lang, first) : ASK_NAME[lang];
}
/** Save the order name as Elvi-heard ("elvi"); a staff-entered (manual) name is never overwritten. */
export function rememberOrderName(phone: string, name: string): { saved: boolean; reason: string } {
  if (isOrderOnlyName(name)) return { saved: false, reason: "third-person" }; // name3p2
  const plan = planCallerName(phone, name, "elvi");
  if (!plan.save) return { saved: false, reason: plan.reason };
  const saved = saveCallerName(phone, name, "elvi");
  if (saved) onNameSaved?.(phone, saved, "elvi");
  return { saved: !!saved, reason: saved ? "ok" : "save-refused" };
}
const STAFF_ASK = /(a\s+nombre\s+de\s+qui[eé]n|(?:el\s+)?nombre\s+de\s+qui[eé]n|su\s+nombre|tu\s+nombre|c[oó]mo\s+te\s+llamas|^\s*¿?\s*(?:y\s+)?(?:el\s+)?nombre\s*[.?¿]?\s*$|your\s+name|\bname\s*[?]?\s*$|c[oó]mo\s+se\s+llama|qu[eé]\s+nombre|bajo\s+qu[eé]\s+nombre|what(?:'s| is)\s+(?:the|your)\s+name|name\s+for\s+the\s+order|under\s+what\s+name|can\s+i\s+(?:get|have)\s+(?:a|the|your)\s+name|^\s*¿?\s*c[oó]mo\s*\??\s*$)/iu;
/** Listen-only: the caller's answer right after the staff asked for the name. */
export function nameFromStaffAsk(turns: Array<{ speaker: "caller" | "staff"; text: string }>): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "staff" || !STAFF_ASK.test(turns[i].text)) continue;
    // alex1: Wally (ASR) then Alex — take the LAST valid caller answer in the next few turns (incl. after "¿Cómo?").
    let lastCaller: string | null = null;
    let staffEcho: string | null = null;
    let aNombreDe: string | null = null;
    for (const t of turns.slice(i + 1, i + 10)) {
      if (t.speaker === "caller") {
        let n = nameFromAnswer(t.text);
        // suleika1: after ¿Tu nombre?, "¿Zuleika?" is the answer (gino1 bare ¿Guino? only blocked outside ask)
        if (!n) {
          const bare = t.text.match(/^\s*¿\s*([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)\s*\?\s*$/u);
          if (bare && !NOT_NAMES.test(bare[1].split(" ")[0])) n = cleanFullName(bare[1]);
        }
        if (n) {
          lastCaller = n;
          // carlos1: prefer explicit "A nombre de Carlos" over later gratitude leftovers
          if (/(?:a\s+nombre\s+de|mi\s+nombre\s+es|me\s+llamo|my\s+name\s+is)\s+/iu.test(t.text)) aNombreDe = n;
        }
      }
      // victor1/alex1/jose1/gino1: staff echo after junk ASR —
      // "Name, okey/okay", "Name. Capital…", "Name, Name.", "Name, dame … minutos",
      // or mid-turn "Okay, muy bien, Name. Dame unos minutos."
      if (t.speaker === "staff") {
        const echo =
          t.text.match(/^\s*([\p{Lu}][\p{Ll}áéíóúñ]+)(?:\s*,\s*\1\b|\s*,\s*(?:okey|okay|ok|listo|bueno|perfecto)\b|\s*[.]\s+[\p{Lu}]|\s*,\s*(?:dame|deme)\s+(?:unos?\s+)?(?:\p{L}+\s+)?minutos)/u) ||
          t.text.match(/^\s*(?:ok(?:ay)?|okay|s[ií]|yes|muy\s+bien)\s*,?\s+(?:muy\s+bien\s*,?\s+)?([\p{Lu}][\p{Ll}áéíóúñ]+)\b/iu) ||
          // suleika1: "Dame … veinte, Zuleika, por favor."
          t.text.match(/,\s*([\p{Lu}][\p{Ll}áéíóúñ]+)\s*,?\s*(?:por\s+favor|please)\s*[.]?\s*$/u);
        if (echo && !NOT_NAMES.test(echo[1])) {
          const n = cleanFirstName(echo[1]);
          // gino1: last staff confirm wins (Gino over earlier ¿Guino?)
          if (n) staffEcho = n;
        }
      }
    }
    // carlos1: "A nombre de X" beats a later junk/gratitude turn
    if (aNombreDe) return aNombreDe;
    // rodolfo1: staff confirmed "Rodolfo" — keep it over later ASR junk ("Sé Apple") even when stems differ
    if (staffEcho && lastCaller && foldName(staffEcho) !== foldName(lastCaller)) {
      const junk = /^(s[eé]|apple)$/iu.test(foldName(lastCaller).split(/\s+/)[0] || "") || /\bapple\b/iu.test(lastCaller);
      if (junk) return staffEcho;
    }
    // gino1: staff echo/confirm ("Gino, Gino." / "Okay, muy bien, Gino") beats unclear caller ASR ("Guino")
    // Only override when names are close (shared stem) — not "Luis" vs filler "Entonces" from "muy bien, entonces…"
    if (staffEcho && !lastCaller) return staffEcho;
    if (staffEcho && lastCaller) {
      const a = foldName(staffEcho), b = foldName(lastCaller);
      if (a === b) return staffEcho;
      const close = a.slice(0, 2) === b.slice(0, 2) || a.includes(b.slice(0, 3)) || b.includes(a.slice(0, 3))
        || (a[0] === b[0] && Math.abs(a.length - b.length) <= 1); // gino1: Guino → Gino
      if (close) return staffEcho;
    }
    if (lastCaller) return lastCaller;
    if (staffEcho) return staffEcho;
    // rec1: the transcript can put the answer just BEFORE the ask (overlap): "…sería todo. Zed." / "¿Tu nombre?"
    const prev = turns[i - 1];
    if (prev?.speaker === "caller") { const last = prev.text.trim().split(/(?<=[.!?])\s+/).pop() || ""; const n = last.split(/\s+/).length <= 2 && /^\p{Lu}/u.test(last) ? nameFromAnswer(last) : null; if (n) return n; }
  }
  // name3p1: diarization can put the staff's "¿tu nombre?" inside a caller turn; read what follows it
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "caller") continue;
    const m = turns[i].text.match(STAFF_ASK);
    if (!m || m.index == null) continue;
    const after = turns[i].text.slice(m.index + m[0].length).replace(/^[\s?¿.,]+/, "");
    const n = after ? nameFromAnswer(after) : null;
    if (n) return n;
  }
  // miguel1: staff "Ah, es para" (incomplete) → next caller "Miguel Gutiérrez" is the pickup name
  for (let i = 0; i < turns.length - 1; i++) {
    if (turns[i].speaker !== "staff" || !/\bes\s+para\s*$/iu.test(turns[i].text.trim())) continue;
    const n = nameFromAnswer(turns[i + 1].text);
    if (n && turns[i + 1].speaker === "caller") return n;
  }
  return null;
}
/** Listen-only: save the heard name only when the number has no saved name. */
export function rememberHeardNameIfNone(phone: string, name: string): boolean {
  if (isOrderOnlyName(name)) return false; // shannon1 / name3p2: ticket/pickup only
  if (savedCallerName(phone)) return false;
  const saved = saveCallerName(phone, name, "elvi");
  if (saved) onNameSaved?.(phone, saved, "elvi");
  return !!saved;
}

// sopesaso1: staff calling the caller by name at the close ("dame veinte, Martín", "gracias, Ana"). Not vocatives.
const NOT_NAMES = /^(ah|oh|eh|ey|uh|um|hmm|cu[aá]nto|aja|aj[aá]|uy|ay|en|al|del|la|el|un|una|los|las|para|por|con|sin|de|a|son|s[eé]|apple|mexican[oa]?s?|mexican|american[oa]?s?|american|latin[oa]s?|hispan(?:ic|[oa]s?)|chicano|chicana|español|spanish|english|ingl[eé]s|vegetarian[oa]?|vegan[oa]?|pinto|refritos?|fried|berros|verdes?|rojos?|rojas?|rojo|roja|verde|blanco|blanca|negro|negra|grande|chico|chica|regular|deluxe|dorada|comal|harina|ma[ií]z|arroz|rice|beans|frijoles|asada|pastor|bistec|steak|chicken|pollo|birria|chorizo|carnitas|tripas?|cabeza|lengua|prensado|costillas?|buche|suadero|carnitas?|deshebrada|picadillo|alpastor|nopales|vegetal|campechana|duro|sorry|please|yes|yeah|welcome|bye|adiós|adios|hola|hello|hi|sure|right|thanks|thank|mano|manito|amigo|amiga|joven|señor|señora|senor|senora|seño|jefe|jefa|compa|compadre|porfa|mija|mijo|mi\s*hijo|güero|guero|bro|buddy|sir|ma'?am|okey|okay|ok|gracias|muchas|de|nada|igualmente|please|porfa|bueno|perfecto|listo|pues|hermano|carnal|muchacho|muchacha|reina|rey|corazón|amor|papi|mami|boss|man|dude|friend|honey|hon|cocina|elvis|elvi|entonces|luego|ahora|ves|vea|diga|dime|veinte|diez|quince|treinta|dame|deme|[oó]rale|[aá]ndale|sale|vaya|mira|oiga|oye|este|bueno|s[ií]|sip|no|nop|ya|aj[aá]|claro|qu[eé]|ser[ií]a|algo)$/iu;
export function nameFromStaffVocative(turns: Array<{ speaker: "caller" | "staff"; text: string }>): string | null {
  // agustin1: staff greeting / address ("Buenas tardes, Agustín" / "ahora sí, Agustín, dime") beats later ASR food echoes ("Berros," ← Verdes)
  for (const turn of turns) {
    if (turn.speaker !== "staff") continue;
    for (const m of turn.text.matchAll(/(?:Buenas\s+(?:tardes|días|noches)|ahora\s+s[ií]|a\s+ver(?:\s+ahora\s+s[ií])?)[,]?\s+(\p{Lu}[\p{Ll}áéíóúñ]+)(?=\s*[,.]|\s|$)/gu)) {
      const w = m[1];
      if (NOT_NAMES.test(w)) continue;
      const n = cleanFirstName(w);
      if (n) return n;
    }
  }
  // cecilia1: "Cecilia, ¿verdad?" wins over later "¿Qué, qué más, señora?" leading-comma false positives
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "staff") continue;
    for (const m of turns[i].text.matchAll(/(?:^|[¿?\s.!])(\p{Lu}[\p{Ll}áéíóúñ]+)\s*,\s*¿?\s*verdad\s*\??/gu)) {
      const w = m[1];
      if (NOT_NAMES.test(w)) continue;
      const n = cleanFirstName(w);
      if (n) return n;
    }
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "staff") continue;
    for (const m of turns[i].text.matchAll(/,\s*(\p{Lu}[\p{Ll}áéíóúñ]+)(?=\s*[.!?]|\s*$)/gu)) { // cleanup1: not before a comma
      const w = m[1];
      if (NOT_NAMES.test(w)) continue;
      const n = cleanFirstName(w);
      if (n) return n;
    }
    // victor1: "Víctor, okey, Víctor, te tengo…" — name leads the staff turn
    for (const m of turns[i].text.matchAll(/(?:^|[¿?\s.!])(\p{Lu}[\p{Ll}áéíóúñ]+)\s*,/gu)) {
      const w = m[1];
      if (NOT_NAMES.test(w)) continue;
      const n = cleanFirstName(w);
      if (n) return n;
    }
  }
  return null;
}
/** Listen-only name: answer to "¿a nombre de quién?" first, else staff addressing the caller by name. */
export const nameFromTranscript = (turns: Array<{ speaker: "caller" | "staff"; text: string }>) => nameFromStaffAsk(turns) || nameFromStaffVocative(turns);
/** name3p2: same, plus whether the caller gave it in the third person (then it must not be saved to their phone). */
export function nameFromTranscriptInfo(turns: Array<{ speaker: "caller" | "staff"; text: string }>): { name: string; thirdPerson: boolean; source: "staff-ask" | "vocative" | "volunteer" } | null {
  const fromAsk = nameFromStaffAsk(turns);
  const fromVoc = fromAsk ? null : nameFromStaffVocative(turns);
  // joseA1: volunteered "Es José Acevedo" — prefer full volunteer over staff vocative ("Gracias, José")
  let fromVol: string | null = null;
  for (const t of turns) {
    if (t.speaker !== "caller") continue;
    // Verb match case-insensitive; name token must be a real capitalized name (reject "Ah, es en")
    if (!/\b(?:(?:es|est[aá]|sigue)(?:\s+al?\s+nombre\s+de)?|mi\s+nombre\s+es|me\s+llamo|soy)\s+\S+/iu.test(t.text)) continue;
    if (/\bes\s+para\b/iu.test(t.text)) continue; // pickup-only
    const n = nameFromAnswer(t.text);
    // joseA1: "Ah, es en" → null/En lose to "Es José Acevedo"
    if (!n || n.trim().length < 3 || NOT_NAMES.test(n.split(/\s+/)[0])) continue;
    if (!/^\p{Lu}/u.test(n)) continue;
    if (!fromVol || n.split(/\s+/).length > fromVol.split(/\s+/).length || (n.split(/\s+/).length === fromVol.split(/\s+/).length && n.length > fromVol.length))
      fromVol = n;
  }
  const name = fromAsk || fromVol || fromVoc;
  if (!name) return null;
  const f = foldName(name);
  // Pickup-only: para/for/recoger/picking-up. Bare "Chuy." / "De Luis." after name-ask = customer (ticket + name log).
  let thirdPerson = turns.some((t) => t.speaker === "caller" && (() => { const n = thirdPersonName(t.text); return !!n && foldName(n) === f; })());
  // jorge1: "A nombre de Jorge. Jorge va a pasar por ellos." = pickup/ticket only, not caller identity
  if (!thirdPerson && turns.some((t) => t.speaker === "caller" && /\bva\s+a\s+pasar\s+por\b/iu.test(t.text)
    && (foldName(nameFromAnswer(t.text) || "") === f || foldName(thirdPersonName(t.text) || "") === f
      || new RegExp(String.raw`\b${f}\b`, "iu").test(t.text)))) {
    thirdPerson = true;
  }
  // miguel1 (CA807990d6): "pasa ahí mi esposo" + staff "Ah, es para" + "Miguel Gutiérrez" → ticket/pickup only, never caller contact.
  if (!thirdPerson) {
    const spousePickup = turns.some((t) => t.speaker === "caller" && /\b(?:mi\s+)?(?:esposo|esposa|marido|mujer|husband|wife)\b/iu.test(t.text));
    const staffEsPara = turns.some((t, i) => t.speaker === "staff" && /\bes\s+para\b/iu.test(t.text) && (!/\bes\s+para\s+\p{Lu}/u.test(t.text) || foldName(thirdPersonName(t.text) || "") === f) && turns.slice(i).some((u) => u.speaker === "caller" && foldName(nameFromAnswer(u.text) || "") === f));
    if (spousePickup || staffEsPara) thirdPerson = true;
  }
  const source: "staff-ask" | "vocative" | "volunteer" = fromAsk ? "staff-ask" : fromVoc ? "vocative" : "volunteer";
  // agustin1b: factory group — "para Tony/Sandro/…" are pickup/ticket names only; staff-greeted caller name is not third-person even if "para <same>" appears on their own sub-order
  {
    const paraNames = new Set<string>();
    for (const turn of turns) {
      if (turn.speaker !== "caller") continue;
      for (const m of turn.text.matchAll(/\b(?:esa\s+(?:ser[ií]a|es)\s+|esa\s+orden\s+(?:ser[ií]a\s+)?(?:es\s+)?|ese\s+es\s+|es\s+)?para\s+(?:el\s+|la\s+)?(\p{Lu}[\p{Ll}áéíóúñ]+)/gu)) {
        const pn = cleanFirstName(m[1]);
        if (pn && !NOT_NAMES.test(pn)) paraNames.add(foldName(pn));
      }
      for (const m of turn.text.matchAll(/\bpara\s+el\s+(chaparro)\b/giu)) {
        paraNames.add(foldName(m[1]));
      }
    }
    if (paraNames.size >= 2) {
      for (const pn of paraNames) {
        // mark ticket-only for everyone except the resolved caller name
        if (pn !== f) {
          // find an original casing to mark
          for (const turn of turns) {
            if (turn.speaker !== "caller") continue;
            const m = turn.text.match(new RegExp(String.raw`\bpara\s+(?:el\s+|la\s+)?(\p{Lu}[\p{Ll}áéíóúñ]+)`, "u"));
            // mark via fold match below
          }
        }
      }
      // Prefer staff greeting name over a late false vocative; clear thirdPerson when name matches staff greeting
      if (fromVoc && foldName(fromVoc) === f) thirdPerson = false;
      // Mark all para-* names that are NOT the caller as order-only
      for (const turn of turns) {
        if (turn.speaker !== "caller") continue;
        for (const m of turn.text.matchAll(/\bpara\s+(?:el\s+|la\s+)?(\p{Lu}[\p{Ll}áéíóúñ]+|chaparro)\b/giu)) {
          const raw = m[1];
          const pn = cleanFirstName(/^[a-z]/.test(raw) ? raw[0].toUpperCase() + raw.slice(1).toLowerCase() : raw);
          if (pn && foldName(pn) !== f) markOrderOnlyName(pn);
        }
      }
    }
  }
  if (thirdPerson) markOrderOnlyName(name);
  return { name, thirdPerson, source };
}
