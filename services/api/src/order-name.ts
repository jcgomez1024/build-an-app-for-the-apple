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
export function nameFromAnswer(text: string): string | null {
  let s = String(text || "").trim();
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
