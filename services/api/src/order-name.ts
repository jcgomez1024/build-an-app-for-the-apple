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
const LEAD = /^(?:[\s,.!]*(?:no|nop|nope|s[ií]|yes|yeah|ok(?:ay)?|bueno|pues|este|um+|eh+|ah+|mm+|perd[oó]n|sorry|de|del))*[\s,.!]*/iu;
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
  // name3p3 / luis1 (Carlos via Auditor): "para Luis" / "es para Luis" / "la va a recoger Luis" →
  // Square ticket/pickup name ONLY — never the caller's repeat-caller identity.
  const pick = s.match(/(?<![\p{L}])(?:(?:es\s+)?para\s+|la\s+va\s+a\s+recoger(?:\s+(?:el|la|un[oa]?))?\s+|lo\s+recoge\s+|la\s+recoge\s+|pickup\s+(?:under\s+|for\s+)?|under\s+(?:the\s+name\s+)?)(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u);
  if (pick && !/^(llevar|hoy|ma[nñ]ana|ahora|recoger|pickup|entrega|domicilio|pedido|orden|un|una|el|la|los|las|mi|tu|su|unos?|unas?)\b/iu.test(pick[1]) && !NOT_NAMES.test(pick[1].split(" ")[0]))
    return cleanFullName(pick[1]) || null;
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
  if (/^\s*¿[^?]*\?\s*$/u.test(s) && STAFF_ASK.test(s)) return null; // name3p1: a name question is not a name
  const ph = s.match(new RegExp(PHRASE.source + "(.+)$", "iu"));
  s = ph ? ph[1] : s.replace(LEAD, "");
  s = s.replace(TAIL, "").replace(/[.,!?¿¡"“”]/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter(Boolean);
  if (!words.length || words.length > 3) return null;
  if (/^(s[ií]|no|yes|ok|okay|bueno|gracias|thanks|nada|todo|eso)$/iu.test(words[0])) return null;
  // rec1: "Okay, está bien, gracias" is not a name
  if (words.some((w) => /^(est[aá]|bien|perfecto|vale|claro|listo|sale|[aá]ndale|correcto|igualmente|fine|good|great|alright|sure|right|perfect)$/iu.test(w))) return null;
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
const STAFF_ASK = /(a\s+nombre\s+de\s+qui[eé]n|su\s+nombre|tu\s+nombre|c[oó]mo\s+te\s+llamas|^\s*¿?\s*(?:y\s+)?(?:el\s+)?nombre\s*\?|your\s+name|\bname\s*\?\s*$|c[oó]mo\s+se\s+llama|qu[eé]\s+nombre|bajo\s+qu[eé]\s+nombre|what(?:'s| is)\s+(?:the|your)\s+name|name\s+for\s+the\s+order|under\s+what\s+name|can\s+i\s+(?:get|have)\s+(?:a|the|your)\s+name)/iu;
/** Listen-only: the caller's answer right after the staff asked for the name. */
export function nameFromStaffAsk(turns: Array<{ speaker: "caller" | "staff"; text: string }>): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "staff" || !STAFF_ASK.test(turns[i].text)) continue;
    for (const t of turns.slice(i + 1, i + 3)) if (t.speaker === "caller") { const n = nameFromAnswer(t.text); if (n) return n; }
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
  return null;
}
/** Listen-only: save the heard name only when the number has no saved name. */
export function rememberHeardNameIfNone(phone: string, name: string): boolean {
  if (savedCallerName(phone)) return false;
  const saved = saveCallerName(phone, name, "elvi");
  if (saved) onNameSaved?.(phone, saved, "elvi");
  return !!saved;
}

// sopesaso1: staff calling the caller by name at the close ("dame veinte, Martín", "gracias, Ana"). Not vocatives.
const NOT_NAMES = /^(mexican[oa]?s?|mexican|american[oa]?s?|american|latin[oa]s?|hispan(?:ic|[oa]s?)|chicano|chicana|español|spanish|english|ingl[eé]s|vegetarian[oa]?|vegan[oa]?|pinto|refritos?|fried|rojo|roja|verde|blanco|blanca|negro|negra|grande|chico|chica|regular|deluxe|dorada|comal|harina|ma[ií]z|arroz|rice|beans|frijoles|asada|pastor|bistec|steak|chicken|pollo|birria|chorizo|carnitas|sorry|please|yes|yeah|welcome|bye|adiós|adios|hola|hello|hi|sure|right|thanks|thank|mano|manito|amigo|amiga|joven|señor|señora|senor|senora|seño|jefe|jefa|compa|compadre|porfa|mija|mijo|mi\s*hijo|güero|guero|bro|buddy|sir|ma'?am|okey|okay|ok|gracias|bueno|perfecto|listo|pues|hermano|carnal|muchacho|muchacha|reina|rey|corazón|amor|papi|mami|boss|man|dude|friend|honey|hon|cocina|elvis|elvi|veinte|diez|quince|treinta)$/iu;
export function nameFromStaffVocative(turns: Array<{ speaker: "caller" | "staff"; text: string }>): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "staff") continue;
    // cecilia1: "Cecilia, ¿verdad?" / "¿Cecilia, verdad?" — staff confirming the caller's name
    for (const m of turns[i].text.matchAll(/(?:^|[¿?\s.!])(\p{Lu}[\p{Ll}áéíóúñ]+)\s*,\s*¿?\s*verdad\s*\??/gu)) {
      const w = m[1];
      if (NOT_NAMES.test(w)) continue;
      const n = cleanFirstName(w);
      if (n) return n;
    }
    for (const m of turns[i].text.matchAll(/,\s*(\p{Lu}[\p{Ll}áéíóúñ]+)(?=\s*[.!?]|\s*$)/gu)) { // cleanup1: not before a comma
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
export function nameFromTranscriptInfo(turns: Array<{ speaker: "caller" | "staff"; text: string }>): { name: string; thirdPerson: boolean } | null {
  const name = nameFromTranscript(turns);
  if (!name) return null;
  const f = foldName(name);
  const thirdPerson = turns.some((t) => t.speaker === "caller" && (() => { const n = thirdPersonName(t.text); return !!n && foldName(n) === f; })());
  return { name, thirdPerson };
}
