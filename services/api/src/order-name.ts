// ordername1: the name on each phone order. Elvi asks before wrapping up ("¿A nombre de quién?") or lightly confirms a
// saved one ("¿Sigue a nombre de X?"), accepts corrections, and the name goes on the Square order + caller memory as an
// Elvi-heard name (staff-entered names always win). Listen-only calls: pulled from the staff's "¿a nombre de quién?".
import { cleanFullName, cleanFirstName, planCallerName, saveCallerName, savedCallerName, onNameSaved } from "./caller-memory.js";
import { addressesIn } from "./delivery.js";

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
const LEAD = /^(?:[\s,.!]*(?:no|nop|nope|s[ií]|yes|yeah|ok(?:ey|ay)?|bueno|pues|este|um+|eh+|ah+|mm+|perd[oó]n|sorry|de|del)\b)*[\s,.!]*/iu;
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
  const pick = s.match(/(?<![\p{L}])(?:(?:es\s+)?para\s+|(?:it'?s\s+)?for\s+|la\s+va\s+a\s+recoger(?:\s+(?:el|la|un[oa]?))?\s+|lo\s+recoge\s+|la\s+recoge\s+|picking\s+up\s+(?:under\s+|for\s+)?|pickup\s+(?:under\s+|for\s+)?|under\s+(?:the\s+name\s+)?)(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/iu);
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
  // juana1: "soy la mamá de Yasmín… siempre pongo el de Yasmín… de Yasmín Miranda"
  {
    const mama = s.match(/\b(?:mam[aá]|mama)\s+de\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u)
      || s.match(/\bsiempre\s+pongo\s+el\s+de\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u)
      // not "a/al nombre de First Last" (self / ticket ask answer — ordername1 Alfa Bravo)
      || s.match(/(?<!nombre\s)\bde\s+(\p{Lu}[\p{L}'-]+\s+\p{Lu}[\p{L}'-]+)\b/u); // "de Yasmín Miranda"
    if (mama && !NOT_NAMES.test(mama[1].split(" ")[0])) {
      const n = cleanFullName(mama[1]);
      if (n) return n;
    }
  }
  // josePickup1 (CAfa0e72): "sería nombre de José" / "el nombre sería de José" = pickup/ticket only (not "a nombre de" = self)
  // ca7bae57: "Eso sería nombre Ronald" (no "de") — still pickup/ticket name
  {
    const sn = s.match(/\bser[ií]a\s+(?:el\s+)?nombre\s+(?:de\s+)?(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u)
      || s.match(/\b(?:el\s+)?nombre\s+ser[ií]a\s+(?:de\s+)?(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u);
    if (sn && !NOT_NAMES.test(sn[1].split(" ")[0])) {
      const n = cleanFullName(sn[1]);
      if (n) return n;
    }
  }
  return null;
}
const orderOnly = new Map<string, number>(); // folded first name → marked-at ms
const foldName = (n: string) => (cleanFirstName(n) || n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function markOrderOnlyName(name: string, now = Date.now()) { orderOnly.set(foldName(name), now); }
export function isOrderOnlyName(name: string, now = Date.now()): boolean { const t = orderOnly.get(foldName(name)); return t != null && now - t < 30 * 60_000; }
export function nameFromAnswer(text: string): string | null {
  let s = String(text || "").trim();
  // joel1: spelled letters beat everything else in the answer ("J O E L" → Joel, not Joey)
  {
    const sp = nameFromSpelledLetters(s);
    if (sp) return sp;
  }
  // luke1 (CA661a30): "Mi español es muy mal" / bare "muy mal" — phrase junk, never a name
  if (/\bmi\s+espa[nñ]ol\b/iu.test(s) || /^\s*muy\s+mal\s*[.!]?\s*$/iu.test(s) || /\bes\s+muy\s+mal\b/iu.test(s)) return null;
  // cabedeb7: trailing "I'm just" / bare Just — never order_name (same junk as And/Dale)
  if (/\bi['’]?m\s+just\b/iu.test(s) || /^\s*just\s*[.!,]?\s*$/iu.test(s)) return null;
  // daryl1 / shannon1 class: "it's for Daryl" / "for Shannon" / "para Luis" → bare name (never "For Daryl")
  {
    const tp = thirdPersonName(s);
    if (tp) return tp;
  }
  const th = [...s.matchAll(THIRD)].pop();
  if (th && !NOT_NAMES.test(th[1].split(" ")[0])) { const n = cleanFullName(th[1]); if (n) return n; }
  // josePickup1: "sería nombre de José" must yield José (thirdPersonName marks pickupOnly)
  {
    const sn = s.match(/\bser[ií]a\s+(?:el\s+)?nombre\s+de\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u)
      || s.match(/\b(?:el\s+)?nombre\s+ser[ií]a\s+(?:de\s+)?(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u);
    if (sn && !NOT_NAMES.test(sn[1].split(" ")[0])) { const n = cleanFullName(sn[1]); if (n) return n; }
  }
  // jesus1: "¿Ves, Jesús, por favor?" / "Ves, Jesús" — strip discourse filler before the real name
  s = s.replace(/^\s*[¿¡]?\s*(?:ves|vea|mira|oye|oiga|diga|dime|d[ií]game)\s*[,.]?\s+/iu, "");
  // Soft request with a name: "¿Jesús, por favor?" (after Ves strip) is an answer; bare ¿Guino? stays a question (gino1)
  {
    const soft = s.match(/^\s*¿\s*([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)\s*,?\s*(?:por\s+favor|please)\s*\?\s*$/u);
    if (soft && !NOT_NAMES.test(soft[1].split(" ")[0])) { const n = cleanFullName(soft[1]); if (n) return n; }
  }
  if (/^\s*¿[^?]*\?\s*$/u.test(s)) return null; // name3p1/gino1: a name question (¿Guino?) is not a name answer
  // jorge1: price/time questions must never become a name ("Okey, ¿cuánto sería?" → junk "Ey Cuánto Sería")
  if (/\b(?:cu[aá]nto|cu[aá]l|qui[eé]n|d[oó]nde|cu[aá]ndo|which|who|what|where|when|how|how\s+much|cuanto)\b/iu.test(s) || /\b(?:en\s+)?(?:cu[aá]nto\s+tiempo|how\s+long|minutos?)\b/iu.test(s)) return null;
  // rodolfo1: end-of-call ASR "Sí, sí sé Apple." / bare "Sé" is never a name (callers.json keeps Rodolfo)
  if (/\bs[eé]\b/iu.test(s) && (/\bapple\b/iu.test(s) || /^\s*s[eé]\s*$/iu.test(s) || /\bs[eé]\s+\p{Lu}/u.test(s))) return null;
  if (/[¿?]/.test(s) && /\b(?:ser[ií]a|cuesta|cost|price|precio|tiempo)\b/iu.test(s)) return null;
  const ph = s.match(new RegExp(PHRASE.source + "(.+)$", "iu"));
  if (ph) {
    // jorge1: "A nombre de Jorge. Jorge va a pasar por ellos." → take Jorge before pickup clause
    let rest = ph[1].split(/[.!?]|\s+va\s+a\s+pasar\b/iu)[0] || ph[1];
    // gaby1: "Sí, soy Gaby, le mandé un mensaje…" → Gaby (not whole clause → null)
    {
      const named = rest.match(/^\s*(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u);
      if (named) rest = named[1];
    }
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
    while (ws.length && /^(ves|vea|mira|oye|oiga|diga|dime|d[ií]game)$/iu.test(ws[0])) ws.shift();
    s = ws.join(" ");
  }
  // mau1 (CAc68af8): "Soy yo, que Mau" / "que Mau" / "El que Mau" — yo/que/soy are fillers, not the name
  {
    const m = s.match(/\bsoy\s+yo\s*,?\s+que\s+(\p{Lu}[\p{L}'-]+)/iu)
      || s.match(/\b(?:el\s+)?que\s+(\p{Lu}[\p{L}'-]+)\s*$/iu)
      || s.match(/^\s*yo\s*,?\s+que\s+(\p{Lu}[\p{L}'-]+)/iu);
    if (m && !NOT_NAMES.test(m[1])) {
      const n = cleanFullName(m[1]);
      if (n) return n;
    }
    const ws = s.split(" ").filter(Boolean).filter((w) => !/^(yo|que|soy)$/iu.test(w));
    s = ws.join(" ");
  }
  // gerardo1 (CAdf3a04): "Tú digo Gerardo" / "te digo Gerardo" after ¿tu nombre?
  {
    const m = s.match(/\b(?:t[uú]\s+|te\s+)?digo\s+(\p{Lu}[\p{L}'-]+)/iu);
    if (m && !NOT_NAMES.test(m[1])) {
      const n = cleanFullName(m[1]);
      if (n) return n;
    }
  }
  // juana1: long "mamá de Yasmín… de Yasmín Miranda" before words.length>3 bail
  {
    const mama = s.match(/\b(?:mam[aá]|mama)\s+de\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u)
      || s.match(/\bsiempre\s+pongo\s+el\s+de\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u)
      || s.match(/\bde\s+(\p{Lu}[\p{L}'-]+\s+\p{Lu}[\p{L}'-]+)\b/u);
    if (mama && !NOT_NAMES.test(mama[1].split(" ")[0])) {
      const n = cleanFullName(mama[1]);
      if (n) return n;
    }
  }
  // raul1 (CA8debe0): "Saúl Becerra, ¿no tiene servicio a domicilio?" — leading name + delivery ask
  {
    const leadDeliv = s.match(/^(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)\s*,?\s+(?:(?:¿\s*)?(?:no\s+)?(?:tiene|tienen|hay|do\s+you|does)\b|(?:servicio\s+a\s+)?domicilio\b|delivery\b)/u);
    if (leadDeliv && !NOT_NAMES.test(leadDeliv[1].split(" ")[0])) {
      const n = cleanFullName(leadDeliv[1]);
      if (n) return n;
    }
    s = s.replace(/,?\s*(?:¿\s*)?(?:no\s+)?(?:tiene|tienen|hay)\s+(?:servicio\s+(?:a\s+)?)?domicilio\b.*$/iu, "")
      .replace(/,?\s*(?:¿\s*)?(?:do\s+you\s+(?:have|deliver)|is\s+there\s+delivery|delivery\b).*$/iu, "")
      .replace(/\s+/g, " ").trim();
  }
  // ca11603f (CA11603f18d854…): "A Lupita, y si puedo pasar… a las once…" — name before pickup/time clause
  {
    const leadPickup = s.match(/^(?:A\s+)?(\p{Lu}[\p{L}'-]{2,}(?:\s+\p{Lu}[\p{L}'-]+)?)\s*,?\s+(?:y\s+)?(?:si\s+)?(?:puedo|puedes|pasar|paso|pue\b|a\s+las|para\s+las|va\s+a\s+pasar)/iu);
    if (leadPickup && !NOT_NAMES.test(leadPickup[1].split(" ")[0])) {
      const n = cleanFullName(leadPickup[1]);
      if (n) return n;
    }
  }
  // ca11603f: strip leading article "A" before a capitalized name ("A Lupita")
  s = s.replace(/^\s*A\s+(?=\p{Lu})/u, "");
  let words = s.split(" ").filter(Boolean);
  if (!words.length || words.length > 3) return null;
  // callback1: "era para unos, para…" / "unos para" = relay/pickup-for-others, never caller identity
  if (/\b(?:era|es|ser[ií]a)\s+para\s+unos?\b/iu.test(s) || /^unos?\s+para\b/iu.test(s) || /^para\s+unos?\b/iu.test(s)) return null;
  if (words.some((w) => /^(unos?|unas?)$/iu.test(w)) && words.some((w) => /^para$/iu.test(w))) return null;
  if (/^(s[ií]|no|yes|ok|okay|bueno|gracias|muchas|thanks|nada|todo|eso|de|ser[ií]a|qu[eé]|algo)$/iu.test(words[0])) return null;
  // oscar1 (CA041f564): "pues, pobre, pues" goodbye never a name (same class as Hasta Luego)
  if (/^(?:pues|pobre)(?:\s+(?:pues|pobre))+$/iu.test(s) || /\bpobre\b/iu.test(s) && /\bpues\b/iu.test(s) && !/\b(?:me\s+llamo|mi\s+nombre|soy|a\s+nombre)\b/iu.test(s)) return null;
  // suleika1/close1: "Sería todo" / "Nada más" are closings, never a name
  if (words.some((w) => /^(todo|nada|m[aá]s)$/iu.test(w))) return null;
  // cacc9783 (Tabby): "That's it." after name ask — never a name (apostrophe → "That s it")
  if (/^that\b/iu.test(words[0]) && words.some((w) => /^it$/iu.test(w))) return null;
  // rec1: "Okay, está bien, gracias" is not a name
  if (words.some((w) => /^(est[aá]|bien|perfecto|vale|claro|listo|sale|[aá]ndale|correcto|igualmente|fine|good|great|alright|sure|right|perfect)$/iu.test(w))) return null;
  // carlos1: "Okay, muchas gracias" → leftover "muchas" (or "muchas gracias") is gratitude, never a name
  if (words.every((w) => /^(muchas|gracias|thanks?|thank|you|ok(?:ay)?|please|porfa|por|favor|de|nada|igualmente)$/iu.test(w))) return null;
  // jose2/close: "Hasta luego" / bye / nos vemos — never customerName / lastPickupName
  // lalo1 (CA72b325): caller filler "¿Va?" / "Va" at call end — never a name (same junk class as Ujú / Aquí / Vámonos)
  if (/^v[aá]$/iu.test(words[0]) || /^v[aá]\s*[.?¿¡]*$/iu.test(words.join(" "))) return null;
  // felipe1 (CA398d11): "Vámonos[, gracias]" staff goodbye vocative — never a name (same class as Hasta Luego / Pobre Pues)
  if (/^(hasta(\s+luego)?|nos\s+vemos|see\s+you(?:\s+later)?|good\s*bye|bye(\s*bye)?|cu[ií]date|que\s+le\s+vaya(?:\s+bien)?|chao|chau|adi[oó]s|v[aá]monos(?:\s*,?\s*gracias)?)$/iu.test(words.join(" "))) return null;
  if (/^(hasta|bye|goodbye|adi[oó]s|chao|chau|v[aá]monos)$/iu.test(words[0])) return null;
  // ca11603f/daryl1: strip leading A/For/Para before NOT_NAMES so "A Lupita" → Lupita (A is in NOT_NAMES)
  while (words.length >= 2 && /^(?:for|para|a)$/iu.test(words[0]) && /^\p{Lu}/u.test(words[1])) words = words.slice(1);
  if (!words.length || NOT_NAMES.test(words[0])) return null;
  // joseA1: "Ah, es en" / bare prepositions are not names
  if (words.length === 1 && words[0].length <= 2) return null;
  if (!words.length || NOT_NAMES.test(words[0])) return null;
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
// cacc9783 (Tabby): "Your name, please." — na-?name never matched "name" (only naname/na-name). Use n(?:a-)?ame.
const STAFF_ASK = /(a\s+nombre\s+de\s+qui[eé]n|(?:el\s+)?nombre\s+de\s+qui[eé]n|su\s+nombre|tu\s+nombre|c[oó]mo\s+te\s+llamas|^\s*¿?\s*(?:y\s+)?(?:el\s+)?nombre\s*[.?¿]?\s*$|your\s+n(?:a-)?ame\b|\bname\s*[?]?\s*$|c[oó]mo\s+se\s+llama|qu[eé]\s+nombre|bajo\s+qu[eé]\s+nombre|what(?:'s| is)\s+(?:the|your)\s+n(?:a-)?ame\b|name\s+for\s+(?:the|your)\s+order|under\s+what\s+name|can\s+i\s+(?:get|have)\s+(?:a|the|your)\s+n(?:a-)?ame\b|^\s*¿?\s*c[oó]mo\s*\??\s*$)/iu;
/** miguelPickup1 (CAa4bd2b): staff "¿…la va a recoger?" / who's picking up — answer is ticket/pickup name (beats prior vocative). */
const PICKUP_WHO_ASK = /(?:la|lo)\s+va\s+a\s+recoger|va\s+a\s+recoger\s*[.?¿]|qui[eé]n\s+(?:la|lo)\s+(?:va\s+a\s+)?recoger|qui[eé]n\s+(?:la|lo)\s+recoge|who(?:['']?s|\s+is)\s+picking\s+up|who\s+will\s+(?:be\s+)?pick(?:ing)?\s+up|name\s+(?:for\s+)?(?:the\s+)?pickup|(?:ponemos|poner|pone)\s+la\s+orden\s+que\s+la\s+va\s+a\s+recoger/iu;
export function isPickupWhoAsk(text: string): boolean { return PICKUP_WHO_ASK.test(String(text || "")); }
/** Listen-only: the caller's answer right after the staff asked for the name. */
export function nameFromStaffAsk(turns: Array<{ speaker: "caller" | "staff"; text: string }>): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "staff" || !(STAFF_ASK.test(turns[i].text) || PICKUP_WHO_ASK.test(turns[i].text))) continue;
    // gaby1: "¿Quieres pura, pura, cómo se llama?" = dish name, not customer name ask
    if (/c[oó]mo\s+se\s+llama/iu.test(turns[i].text)
      && !/\b(?:tu\s+nombre|su\s+nombre|a\s+nombre|your\s+name|me\s+llamo)\b/iu.test(turns[i].text)
      && /\b(?:pura|puro|esto|esa|ese|aquel|menudo|taco|quesadilla|birria|mole|caldo)\b/iu.test(turns[i].text)) continue;
    // alexvoc1: Wally (ASR) then Alex — take the LAST valid caller answer in the next few turns (incl. after "¿Cómo?").
    let lastCaller: string | null = null;
    let spelledCaller: string | null = null;
    let staffEcho: string | null = null;
    let staffEchoHits = 0;
    let aNombreDe: string | null = null;
    let fullCaller: string | null = null;
    for (const t of turns.slice(i + 1, i + 10)) {
      if (t.speaker === "caller") {
        const spelled = nameFromSpelledLetters(t.text);
        let n = spelled || nameFromAnswer(t.text);
        // suleika1: after ¿Tu nombre?, "¿Zuleika?" is the answer (gino1 bare ¿Guino? only blocked outside ask)
        if (!n) {
          const bare = t.text.match(/^\s*¿\s*([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)\s*\?\s*$/u);
          if (bare && !NOT_NAMES.test(bare[1].split(" ")[0])) n = cleanFullName(bare[1]);
        }
        if (n) {
          lastCaller = n;
          if (spelled) spelledCaller = spelled; // joel1: J O E L beats staff Joey/Jane echo
          // carlos1: prefer explicit "A nombre de Carlos" over later gratitude leftovers
          if (/(?:a\s+nombre\s+de|(?:el|su|mi)\s+nombre\s+(?:de|es)|me\s+llamo|my\s+name\s+is)\s+/iu.test(t.text)) aNombreDe = n;
          // marina1: "Marina Aguilar" then a garbled "Marine" — the full spoken name wins over a later fragment of it
          if (/\s/.test(n)) fullCaller = n;
          else if (fullCaller && foldName(n).slice(0, 3) === foldName(fullCaller).slice(0, 3)) lastCaller = fullCaller;
        }
      }
      // victor1/alex1/jose1/gino1: staff echo after junk ASR —
      // "Name, okey/okay", "Name. Capital…", "Name, Name.", "Name, dame … minutos",
      // or mid-turn "Okay, muy bien, Name. Dame unos minutos."
      if (t.speaker === "staff") {
        const echo =
          t.text.match(/^\s*([\p{Lu}][\p{Ll}áéíóúñ]+)(?:\s*,\s*\1\b|\s*,\s*(?:okey|okay|ok|listo|bueno|perfecto|muy\s+bien)\b|\s*[.]\s+[\p{Lu}]|\s*,\s*(?:dame|deme)\s+(?:unos?\s+)?(?:\p{L}+\s+)?minutos)/u) ||
          t.text.match(/^\s*(?:ok(?:ay)?|okay|s[ií]|yes|muy\s+bien)\s*,?\s+(?:muy\s+bien\s*,?\s+)?([\p{Lu}][\p{Ll}áéíóúñ]+)\b/iu) ||
          // gerardo1 (CAdf3a04): "Gerardo, sale Gerardo, dame unos 15…"
          t.text.match(/^\s*([\p{Lu}][\p{Ll}áéíóúñ]+)\s*,\s*sale(?:\s+\1)?\b/u) ||
          // eva1: "Eva, muy bien, Eva."
          t.text.match(/^\s*([\p{Lu}][\p{Ll}áéíóúñ]+)\s*,\s*muy\s+bien\b/u) ||
          // suleika1: "Dame … veinte, Zuleika, por favor."
          t.text.match(/,\s*([\p{Lu}][\p{Ll}áéíóúñ]+)\s*,?\s*(?:por\s+favor|please)\s*[.]?\s*$/u) ||
          // raul1: bare "Raúl." / "Ahorita no, Raúl." / "…minutos, Raúl, por lo menos"
          t.text.match(/^\s*([\p{Lu}][\p{Ll}áéíóúñ]+)\s*[.!]\s*$/u) ||
          t.text.match(/,\s*([\p{Lu}][\p{Ll}áéíóúñ]+)\s*[.!]\s*$/u) ||
          t.text.match(/,\s*([\p{Lu}][\p{Ll}áéíóúñ]+)\s*,?\s*(?:por\s+lo\s+menos)\b/u);
        if (echo && !NOT_NAMES.test(echo[1])) {
          const n = cleanFirstName(echo[1]);
          // gino1: last staff confirm wins (Gino over earlier ¿Guino?)
          if (n) { staffEcho = n; staffEchoHits += 1; }
        }
      }
    }
    // joel1: spelled "J O E L" beats staff mis-repeat Joey/Jane (close-stem would otherwise win)
    if (spelledCaller) return spelledCaller;
    // carlos1: "A nombre de X" beats a later junk/gratitude turn
    if (aNombreDe) return aNombreDe;
    // rodolfo1: staff confirmed "Rodolfo" — keep it over later ASR junk ("Sé Apple") even when stems differ
    if (staffEcho && lastCaller && foldName(staffEcho) !== foldName(lastCaller)) {
      const junk = /^(s[eé]|apple|aqu[ií]|uj[uú]|ah[ií]|cu[aá]l)$/iu.test(foldName(lastCaller).split(/\s+/)[0] || "") || /\bapple\b/iu.test(lastCaller);
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
      // raul1: staff corrected Saúl→Raúl (edit distance 1) or repeated confirm ≥2×
      const ed1 = a.length === b.length && [...a].filter((ch, i) => ch !== b[i]).length === 1;
      if (close || ed1 || staffEchoHits >= 2) return staffEcho;
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
    const m = turns[i].text.match(STAFF_ASK) || turns[i].text.match(PICKUP_WHO_ASK);
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
  // miguelPickup1: staff pickup-who ask with no inline name → next bare caller name (also covered by main loop)
  for (let i = 0; i < turns.length - 1; i++) {
    if (turns[i].speaker !== "staff" || !PICKUP_WHO_ASK.test(turns[i].text)) continue;
    for (const t of turns.slice(i + 1, i + 6)) {
      if (t.speaker !== "caller") continue;
      let n = nameFromAnswer(t.text);
      if (!n) {
        const bare = t.text.match(/^\s*¿\s*([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)\s*\?\s*$/u);
        if (bare && !NOT_NAMES.test(bare[1].split(" ")[0])) n = cleanFullName(bare[1]);
      }
      if (n) return n;
    }
  }
  return null;
}
/** Listen-only: save the heard name only when the number has no saved name. */
export function rememberHeardNameIfNone(phone: string, name: string): boolean {
  if (isNumberName(name)) return false; // chalino1: digits/number words never saved as a name
  if (isOrderOnlyName(name)) return false; // shannon1 / name3p2: ticket/pickup only
  if (savedCallerName(phone)) return false;
  const saved = saveCallerName(phone, name, "elvi");
  if (saved) onNameSaved?.(phone, saved, "elvi");
  return !!saved;
}

// sopesaso1: staff calling the caller by name at the close ("dame veinte, Martín", "gracias, Ana"). Not vocatives.
const NOT_NAMES = /^(cu[aá]nt[oa]s?|cu[aá]les|c[oó]mo|d[oó]nde|cu[aá]ndo|qui[eé]n(?:es)?|perd[oó]n(?:e|eme|ame)?|disculp[ae]|disc[uú]lp(?:e|a)(?:me|nos)?|permiso|what|how|where|when|who|which|ah|oh|eh|ey|uh|um|hmm|mmm+|mm+|hasta|aqu[ií]|uj[uú]|ah[ií]|cu[aá]l|cu[aá]nto|aja|aj[aá]|uy|ay|en|al|del|la|el|un|una|unos?|unas?|los|las|para|por|con|sin|de|a|son|s[eé]|apple|mexican[oa]?s?|mexican|american[oa]?s?|american|latin[oa]s?|hispan(?:ic|[oa]s?)|chicano|chicana|español|spanish|english|ingl[eé]s|vegetarian[oa]?|vegan[oa]?|pinto|refritos?|fried|berros|verdes?|rojos?|rojas?|rojo|roja|verde|blanco|blanca|negro|negra|grande|chico|chica|regular|normal(?:es)?|sencill[oa]s?|deluxe|dorada|comal|harina|ma[ií]z|arroz|rice|beans|frijoles|asada|pastor|bistec|steak|chicken|pollo|birria|menudo|tacos?|taqueros?|nachos?|flautas?|tostadas?|caguamas?|aguas?|tortillas?|quesadillas?|moles?|enchiladas?|tortas?|gorditas?|sopes?(?:asos?)?|burritos?|barbacoa|consom[eé]|platillo|caldo|pata|chorizo|carnitas|tripas?|cabeza|lengua|prensado|costillas?|buche|suadero|carnitas?|deshebrada|picadillo|alpastor|nopales|vegetal|campechana|duro|sorry|please|yes|yeah|welcome|bye|adiós|adios|hola|hello|hi|hey|esperame|espérame|sure|right|thanks|thank|mano|manito|amigo|amiga|joven|señor|señora|senor|senora|seño|jefe|jefa|compa|compadre|porfa|mija|mijo|nena|beb[eé]|mi\s*hijo|güero|guero|bro|buddy|sir|ma'?am|okey|okay|ok|gracias|muchas|de|nada|igualmente|please|porfa|bueno|perfecto|listo|pues|hermano|carnal|muchacho|muchacha|reina|rey|corazón|amor|papi|mami|boss|man|dude|friend|honey|hon|pobre|dale|vale|and|just|muy|mal|so|look|yo|v[aá]monos|va|cocina|elvis|elvi|entonces|luego|ahora|ves|vea|diga|dime|d[ií]game|perm[ií]tame|veinte|diez|quince|treinta|dame|deme|[oó]rale|[aá]ndale|sale|vaya|mira|mire|m[aá]ndeme|m[aá]ndame|mande|oiga|oye|este|bueno|s[ií]|sip|no|nop|ya|aj[aá]|claro|qu[eé]|ser[ií]a|algo)$/iu;
/** joel1 (CA8a240f): caller spells "J O E L" / "J.O.E.L." after staff mishears — joins to Joel. */
export function nameFromSpelledLetters(text: string): string | null {
  let s = String(text || "").trim();
  s = s.replace(/^[¿¡]+|[.!?¡¿]+$/gu, "").trim();
  s = s.replace(/^(?:it'?s|name\s+is|the\s+name\s+is|mi\s+nombre\s+es)\s+/iu, "").trim();
  const parts = s.split(/[\s./\-]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 14) return null;
  if (!parts.every((p) => /^[A-Za-zÁÉÍÓÚÑáéíóúñ]$/u.test(p))) return null;
  const joined = parts.map((p) => p.toUpperCase()).join("");
  const name = joined.charAt(0) + joined.slice(1).toLowerCase();
  if (NOT_NAMES.test(name)) return null;
  // gustavo1 (CAb35dd6f, "y y y me pone…" → "Yyy"): stutters/fillers aren't spelling — one repeated letter, 3+ in a row, or no vowel.
  if (new Set(joined).size === 1 || /(.)\1\1/i.test(joined) || !/[AEIOUÁÉÍÓÚ]/i.test(joined)) return null;
  return cleanFullName(name) || name;
}


/** ca39e2bb (CA39e2bba846…): staff→kitchen shout ("gordo, Guillermo, una quesitorta") — never ticket/caller name. */
const KITCHEN_NICK = String.raw`gordo|gordita|flaco|flaca|chaparro|chaparra|g[uü]ero|guero|negro|negra|carnal|compa|compadre|mano|manito|jefe|jefa|cocina|cook`;
const KITCHEN_FOOD = String.raw`ques[oi]?tortas?|tortas?|tacos?|taqueros?|quesadillas?|gorditas?|burritos?|sopes?(?:asos?)?|nachos?|menudos?|birrias?|horchatas?|cocas?|doradas?|enchiladas?|huaraches?|pambazos?|chimichangas?|flautas?|tostadas?`;
function isKitchenVocativeHit(text: string, name: string): boolean {
  const n = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!n) return false;
  // nickname, Name, una food
  if (new RegExp(String.raw`\b(?:${KITCHEN_NICK})\b[,.\s]+${n}\b[,.\s]+(?:una?|unos?|unas?|dos|tres|cuatro|\d+)\s+(?:${KITCHEN_FOOD})\b`, "iu").test(text))
    return true;
  // Name, una quesitorta / una torta… (kitchen yelling the order after coworker name)
  if (new RegExp(String.raw`\b${n}\b\s*,\s*(?:una?|unos?|unas?)\s+(?:${KITCHEN_FOOD})\b`, "iu").test(text))
    return true;
  // bolillos/stock ask + Name + food (same shout class)
  if (/\bbolillos?\b/iu.test(text)
    && new RegExp(String.raw`\b${n}\b`, "iu").test(text)
    && new RegExp(String.raw`(?:una?|unos?)\s+(?:${KITCHEN_FOOD})\b`, "iu").test(text))
    return true;
  return false;
}

// alexvoc1 (CA12e9407, Oct 30 12:55 PM ET): staff "…Alex, ¿no?" → caller "Quién sabe, yo soy otro grupo" — a denied
// vocative is never the name. Blank it in that staff turn and look again.
const DENY_NAME = /\b(?:qui[eé]n\s+sabe|soy\s+otr[oa]|no\s+soy|otro\s+grupo|no\s+me\s+llamo|se\s+equivoc|equivocad[oa]|not\s+me|that'?s\s+not\s+me|i'?m\s+not|wrong\s+(?:person|guy|number)|my\s+name\s+is\s+not)\b/iu;
export function nameFromStaffVocative(turns: Array<{ speaker: "caller" | "staff"; text: string }>): string | null {
  let ts = turns;
  for (let k = 0; k < 4; k++) {
    const n = nameFromStaffVocativeRaw(ts); if (!n) return null;
    const re = new RegExp(`\\b${n.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu");
    const i = ts.findIndex((t) => t.speaker === "staff" && re.test(t.text));
    const next = i >= 0 ? ts.slice(i + 1).find((t) => t.speaker === "caller") : undefined;
    if (!next || !DENY_NAME.test(next.text)) return n;
    ts = ts.map((t, j) => (j === i ? { ...t, text: t.text.replace(new RegExp(re.source, "giu"), "") } : t));
  }
  return null;
}
export function deniedVocative(turns: Array<{ speaker: "caller" | "staff"; text: string }>, name: string): boolean {
  const esc = name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); const re = new RegExp(`\\b${esc}\\b`, "iu");
  return turns.some((t, i) => t.speaker === "staff" && re.test(t.text) && DENY_NAME.test(turns.slice(i + 1).find((u) => u.speaker === "caller")?.text || ""))
    && !turns.some((t) => t.speaker === "caller" && new RegExp(`\\b(?:soy|me\\s+llamo|i'?m|my\\s+name\\s+is|this\\s+is|habla)\\s+${esc}\\b`, "iu").test(t.text));
}
function nameFromStaffVocativeRaw(turns: Array<{ speaker: "caller" | "staff"; text: string }>): string | null {
  // luke1 (CA661a30): staff close "Okay, okay, look," = ASR for returning caller Luke (ticket name)
  // cacc9783 (Tabby): staff "Okay, and" is conjunction filler (NOT_NAMES and) — never order_name And
  for (const turn of turns) {
    if (turn.speaker !== "staff") continue;
    const m = turn.text.match(/^\s*(?:ok(?:ay)?\s*,\s*)+([\p{L}]+)[,.]?\s*$/iu);
    if (m) {
      const w = m[1];
      const folded = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (folded === "look" || folded === "luke") {
        const n = cleanFirstName("Luke");
        if (n) return n;
      }
      if (!NOT_NAMES.test(w)) {
        const n = cleanFirstName(w);
        if (n) return n;
      }
    }
  }
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
  // pablo1 (CAf8d98c): "Taqueros, ¿verdad?" is a tortilla/SKU check — NOT_NAMES blocks Taqueros so trailing ", Pablo" wins
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "staff") continue;
    for (const m of turns[i].text.matchAll(/(?:^|[¿?\s.!])(\p{Lu}[\p{Ll}áéíóúñ]+)\s*,\s*¿?\s*verdad\s*\??/gu)) {
      const w = m[1];
      if (NOT_NAMES.test(w)) continue;
      if (isKitchenVocativeHit(turns[i].text, w)) continue; // ca39e2bb kitchen shout
      const n = cleanFirstName(w);
      if (n) return n;
    }
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "staff") continue;
    for (const m of turns[i].text.matchAll(/,\s*(\p{Lu}[\p{Ll}áéíóúñ]+)(?=\s*[.!?]|\s*$)/gu)) { // cleanup1: not before a comma
      const w = m[1];
      if (NOT_NAMES.test(w)) continue;
      if (isKitchenVocativeHit(turns[i].text, w)) continue; // ca39e2bb kitchen shout
      const n = cleanFirstName(w);
      if (n) return n;
    }
    // victor1: "Víctor, okey, Víctor, te tengo…" — name leads the staff turn
    for (const m of turns[i].text.matchAll(/(?:^|[¿?\s.!])(\p{Lu}[\p{Ll}áéíóúñ]+)\s*,/gu)) {
      const w = m[1];
      if (NOT_NAMES.test(w)) continue;
      if (isKitchenVocativeHit(turns[i].text, w)) continue; // ca39e2bb kitchen shout
      const n = cleanFirstName(w);
      if (n) return n;
    }
  }
  return null;
}

/** Street words from addresses in the call — never treat as customerName (caguamas1 Williams). */
function streetTokensFromTurns(turns: Array<{ speaker: string; text: string }>): Set<string> {
  const blob = turns.map((t) => t.text).join(" ");
  const toks = new Set<string>();
  for (const a of addressesIn(blob)) {
    for (const w of String(a.street || "").split(/\s+/)) {
      const t = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
      if (t.length >= 3 && !/^(street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|court|ct|way|place|pl|ohio|oh)$/.test(t))
        toks.add(t);
    }
  }
  for (const m of blob.matchAll(/\b([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,})\s+(\d{2,6})\b/gu)) {
    toks.add(m[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  }
  for (const m of blob.matchAll(/\b(\d{2,6})\s+(?:la\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,})\b/gu)) {
    toks.add(m[2].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  }
  // staff readback "Williams, quinientos" / "544 La Williams"
  for (const m of blob.matchAll(/\b([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,})\s*,\s*(?:quinientos|cuatrocientos|trescientos|\d{2,6})\b/gu)) {
    toks.add(m[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  }
  return toks;
}

/** Listen-only name: answer to "¿a nombre de quién?" first, else staff addressing the caller by name. */
export const nameFromTranscript = (turns: Array<{ speaker: "caller" | "staff"; text: string }>) => nameFromStaffAsk(turns) || nameFromStaffVocative(turns);
/** name3p2: same, plus whether the caller gave it in the third person (then it must not be saved to their phone). */
/** eesha1 (CA9724e1): the caller spelling a name ("two Es, S H A" / "double E S H A" / "E-E-S-H-A") beats how staff says it (Isha). */
export function spelledNameFromCall(turns: Array<{ speaker: "caller" | "staff"; text: string }>): string | null {
  const NUM: Record<string, number> = { two: 2, double: 2, three: 3, triple: 3, dos: 2, doble: 2 };
  let found: string | null = null;
  for (const t of turns) {
    if (t.speaker !== "caller") continue;
    let s = String(t.text || "");
    // "two Es, two Es" said twice → once
    s = s.replace(/\b(two|double|three|triple|dos|doble)\s+([A-Za-z])(?:'?s)?\b(?:[,\s]+\1\s+\2(?:'?s)?\b)+/giu, "$1 $2");
    s = s.replace(/\b(two|double|three|triple|dos|doble)\s+([A-Za-z])(?:'?s)?(?![A-Za-z])/giu, (_m, n, l) => Array(NUM[n.toLowerCase()] || 2).fill(l.toUpperCase()).join(" "));
    s = s.replace(/(?<![A-Za-z])([A-Za-z])-(?=[A-Za-z](?![A-Za-z]))/g, "$1 ");
    for (const m of s.matchAll(/(?:^|[^A-Za-z])((?:[A-Za-z][\s.,]+){2,13}[A-Za-z])(?![A-Za-z])/g)) {
      const letters = m[1].split(/[\s.,]+/).filter(Boolean);
      if (letters.length < 3 || !letters.every((p) => /^[A-Za-z]$/.test(p))) continue;
      if (letters.join("").toLowerCase() === "abc") continue;
      const n = nameFromSpelledLetters(letters.join(" "));
      if (n) found = n;
    }
  }
  return found;
}
// osmar1 (CA20f62b): 2+ distinct "a nombre de X" sub-orders → group order: ticket labels only, never caller memory.
// alejandro1 (CA6e99c9): a bare "Alejandro." from the caller near the end (after the name-ask audio drop) is his self-given name.
const NOT_NAME = /^(?:okay|ok|bueno|gracias|nada|s[ií]|no|hola|igual|una?|dos|tres|cuatro|eso|perfecto|claro|listo|adi[oó]s|ándale|andale|exacto|mande|mire|mira|m[aá]ndeme|m[aá]ndame)$/iu;
export function groupOrderNames(turns: Array<{ speaker: "caller" | "staff"; text: string }>): string[] {
  const out = new Map<string, string>();
  for (const t of turns) if (t.speaker === "caller") for (const m of String(t.text).matchAll(/\ba\s+nombre\s+de\s+([A-ZÁÉÍÓÚÑ][\p{L}]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}]+)?)/gu)) out.set(foldName(m[1]), m[1]);
  return [...out.values()];
}
/** oscar2 (CAc49c8f0): staff "¿me puede dar su apellido?" → "O Martínez" — the surname joins the first name given earlier ("Oscar Martínez"). */
export function withSurname(turns: Array<{ speaker: "caller" | "staff"; text: string }>, name: string | null | undefined): string | null {
  if (!name) return name ?? null;
  const i = turns.findIndex((t) => t.speaker === "staff" && /\b(?:apellido|last\s+name|surname)\b/iu.test(t.text));
  if (i < 0) return name;
  const ans = turns.slice(i + 1).find((t) => t.speaker === "caller" && !/^\s*¿?\s*(?:mand[eé]|qu[eé]|c[oó]mo|perd[oó]n|what)(?!\p{L})/iu.test(t.text));
  if (!ans) return name;
  const w = (ans.text.match(/\p{Lu}[\p{L}'-]+/gu) || []).filter((x) => !NOT_NAMES.test(x) && !/^(?:Es|Soy|Mi|Apellido|Se)$/u.test(x));
  if (!w.length) return name;
  const first = turns.slice(0, i).map((t) => t.text).join(" ").match(new RegExp(`\\b(${name.split(/\s+/)[0].replace(/[^\p{L}]/gu, "")})\\b`, "iu")) ? name.split(/\s+/)[0] : null;
  const prior = first || [...turns.slice(0, i)].reverse().find((t) => t.speaker === "caller" && nameFromAnswer(t.text))?.text;
  const fn = first || (prior ? nameFromAnswer(prior) : null);
  const sur = w[w.length - 1];
  if (fn && w.length >= 2 && w[0].toLowerCase() === fn.toLowerCase()) return `${fn} ${sur}`;
  if (fn && fn.toLowerCase() !== sur.toLowerCase()) return `${fn} ${sur}`;
  return name;
}
// dayana2 (CAa2bf38): caller "Oh, Dayana." / staff "¿qué te vamos a poner, Diana?" → the caller's own spelling wins over the
// staff's variant (same first letter, edit distance ≤ 2).
const editDist = (a: string, b: string) => { const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } }
  return d[b.length]; };
export function callerOwnSpelling(turns: Array<{ speaker: "caller" | "staff"; text: string }>, name: string): string | null {
  const f = foldName(name); if (f.length < 4) return null;
  // the caller said the staff form themselves (marina1 "Marina Aguilar" → later garble "Marine") → keep it
  if (turns.some((t) => t.speaker === "caller" && (String(t.text).match(/\p{L}+/gu) || []).some((w) => foldName(w) === f))) return null;
  // only a short name-answer turn ("Oh, Dayana."), never a word inside a sentence (eva1 "Está", marina1)
  for (const t of turns) { if (t.speaker !== "caller" || String(t.text).trim().split(/\s+/).length > 3) continue;
    for (const w of String(t.text).match(/\p{Lu}[\p{L}]+/gu) || []) { const g = foldName(w);
      if (g !== f && g[0] === f[0] && g.length >= 4 && editDist(g, f) <= 2 && !NOT_NAMES.test(w) && !NOT_NAME.test(w)) return w; } }
  return null;
}
export function nameFromTranscriptInfo(turns: Array<{ speaker: "caller" | "staff"; text: string }>): ReturnType<typeof nameFromTranscriptInfo0> {
  let r = nameFromTranscriptInfo0(turns); if (!r) return r;
  if (r.source === "vocative" || r.source === "staff-ask") { const own = callerOwnSpelling(turns, r.name.split(/\s+/)[0]); if (own) r = { ...r, name: [own, ...r.name.split(/\s+/).slice(1)].join(" ") }; }
  const full = withSurname(turns, r.name); return full && full !== r.name ? { ...r, name: full } : r;
}
function nameFromTranscriptInfo0(turns: Array<{ speaker: "caller" | "staff"; text: string }>): { name: string; thirdPerson: boolean; source: "staff-ask" | "vocative" | "volunteer" | "spelled"; group?: string[] } | null {
  const group = groupOrderNames(turns);
  let r = nameFromTranscriptInfoBase(turns);
  // chalino1 (CAe85a69, Oct 30 6:54 PM ET): the phone digits said after the name ask ("seis", "dos noventa y cuatro")
  // became the name "Seis". Number words / digits are never names → the staff read-back ("Chalino, muy bien") instead.
  if (r && isNumberName(r.name)) r = readBackName(turns);
  if (group.length >= 2) return r ? { ...r, group } : { name: group[0], thirdPerson: true, source: "volunteer", group };
  if (r) return r;
  const callerTurns = turns.filter((t) => t.speaker === "caller");
  for (const t of callerTurns.slice(-3)) {
    const m = String(t.text).trim().match(/^([A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}){0,2})\.?$/u);
    if (m && !NOT_NAME.test(m[1].split(/\s+/)[0])) return { name: m[1], thirdPerson: false, source: "volunteer" };
  }
  return null;
}
function nameFromTranscriptInfoBase(turns: Array<{ speaker: "caller" | "staff"; text: string }>): { name: string; thirdPerson: boolean; source: "staff-ask" | "vocative" | "volunteer" | "spelled" } | null {
  const spelled0 = spelledNameFromCall(turns);
  // gustavo1: "a nombre de Gustavo" + staff "Gustavo, muy bien" beats a spelled result that isn't that name.
  const askConf = spelled0 ? nameFromStaffAsk(turns) : null;
  const confirmed = !!askConf && turns.some((t) => t.speaker === "staff" && foldName(t.text).includes(foldName(askConf)));
  const spelled = spelled0 && confirmed && !foldName(askConf!).startsWith(foldName(spelled0)) && !foldName(spelled0).startsWith(foldName(askConf!)) ? null : spelled0;
  if (spelled) return { name: spelled, thirdPerson: false, source: "spelled" };
  const fromAsk = nameFromStaffAsk(turns);
  const fromVoc = fromAsk ? null : nameFromStaffVocative(turns);
  // joseA1: volunteered "Es José Acevedo" — prefer full volunteer over staff vocative ("Gracias, José")
  // francisco1 (CA69876b): "Ah, sería nombre de Francisco" with no staff ¿Nombre? (audio drop) — still volunteer pickup name
  let fromVol: string | null = null;
  // agustin1: group order — caller assigns sub-orders to 3+ different "para X" names → those are ticket labels, not the caller's pickup name
  const paraNames = new Set(turns.filter((t) => t.speaker === "caller").map((t) => thirdPersonName(t.text)).filter((n): n is string => !!n).map((n) => foldName(n)));
  const groupPara = paraNames.size >= 3;
  for (const t of turns) {
    if (t.speaker !== "caller") continue;
    // luke1: "Mi español es muy mal" is not a volunteer name (PHRASE bare "es " would yield Muy Mal)
    if (/\bmi\s+espa[nñ]ol\b/iu.test(t.text) || /\bes\s+muy\s+mal\b/iu.test(t.text)) continue;
    // Verb match case-insensitive; name token must be a real capitalized name (reject "Ah, es en")
    const seriaNombre = /\bser[ií]a\s+(?:el\s+)?nombre\s+(?:de\b|(?=\s+\p{Lu}))/iu.test(t.text)
      || /\b(?:el\s+)?nombre\s+ser[ií]a\b/iu.test(t.text);
    // English volunteer: "Yeah, it's Josh." / "I'm Josh" / "my name is Josh" (josh1 CAaaa9a2)
    // ca20b6c0: "puedo aportar una orden para Carlos" / "una orden para X" = pickup ticket name
    const ordenPara = /\b(?:una?\s+)?(?:[oó]rden|pedido)\s+para\b/iu.test(t.text);
    if (!seriaNombre && !ordenPara && !/\b(?:(?:es|est[aá]|sigue)(?:\s+al?\s+nombre\s+de)?|mi\s+nombre\s+es|me\s+llamo|soy|my\s+name\s+is|i'?m|it'?s)\s+\S+/iu.test(t.text)) continue;
    // pickup-only: es para / it's for / orden para X (daryl1 / ca20b6c0) — never "For X" identity
    if (/\bes\s+para\b/iu.test(t.text) || /\bit'?s\s+for\b/iu.test(t.text) || ordenPara) {
      if (groupPara) continue;
      const n = thirdPersonName(t.text);
      if (n && n.trim().length >= 2 && !NOT_NAMES.test(n.split(/\s+/)[0]) && /^\p{Lu}/u.test(n)) {
        if (!fromVol || n.split(/\s+/).length > fromVol.split(/\s+/).length || (n.split(/\s+/).length === fromVol.split(/\s+/).length && n.length > fromVol.length))
          fromVol = n;
      }
      continue;
    }
    const n = seriaNombre ? (thirdPersonName(t.text) || nameFromAnswer(t.text)) : (thirdPersonName(t.text) || nameFromAnswer(t.text));
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
  // miguelPickup1 (CAa4bd2b): staff "¿…la va a recoger?" + caller "Miguel" → pickupOnly ticket name (beats vocative Juan).
  if (!thirdPerson) {
    const staffPickupWho = turns.some((t, i) => t.speaker === "staff" && PICKUP_WHO_ASK.test(t.text)
      && turns.slice(i + 1, i + 8).some((u) => {
        if (u.speaker !== "caller") return false;
        let n = nameFromAnswer(u.text);
        if (!n) {
          const bare = u.text.match(/^\s*¿\s*([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)\s*\?\s*$/u);
          if (bare && !NOT_NAMES.test(bare[1].split(" ")[0])) n = cleanFullName(bare[1]);
        }
        return !!n && foldName(n) === f;
      }));
    if (staffPickupWho) thirdPerson = true;
  }
  const source: "staff-ask" | "vocative" | "volunteer" = fromAsk ? "staff-ask" : fromVol ? "volunteer" : "vocative";
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
  // caguamas1: street token ≠ customer name (e.g. Williams from delivery address)
  const streets = streetTokensFromTurns(turns);
  if (streets.has(foldName(name.split(/\s+/)[0] || ""))) return null;
  return { name, thirdPerson, source };
}

const NUM_TOKEN = /^(?:\d+|cero|uno?|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veinti\p{L}+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?|mil|y|as[ií]|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and|oh)$/iu;
/** chalino1: "Seis", "Noventa Y Así", "2 6 2" — a number, never a name. */
export function isNumberName(name: string): boolean {
  const w = String(name || "").trim().split(/[\s.,-]+/).filter(Boolean);
  // cmissing1: sign-offs are never a name ("Bye" from "Bye." at the end of the call)
  if (w.length && w.every((x) => /^(?:bye|byebye|goodbye|bye-bye|thanks?|thank|you|later|see|ya|cheers|adios|adi[oó]s|gracias|okay|ok|hasta|luego|serious|seriously|yeah|yes|yep|yup|sure|really|what|right|hello|hi|hey|no|nope|uh|um|huh|si|s[ií]|bueno|claro|oye|mande|disc[uú]lp(?:e|a)(?:me|nos)?|perd[oó]n(?:e|eme|ame)?|con|permiso)$/i.test(x))) return true; // dayana1: Discúlpeme / Con permiso
  return !w.length || /\d/.test(name) || w.every((x) => NUM_TOKEN.test(x));
}
function readBackName(turns: Array<{ speaker: "caller" | "staff"; text: string }>): { name: string; thirdPerson: boolean; source: "staff-ask" } | null {
  const ask = /\b(?:tu|su)\s+nombre\b|\bnombre\b.*\?|\byour\s+name\b|\bname\s+for\b/iu;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker !== "staff" || !ask.test(turns[i].text)) continue;
    for (const t of turns.slice(i + 1, i + 5)) {
      const m = t.speaker === "staff" && String(t.text).trim().match(/^([A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,})\s*[,.]\s*(?:muy\s+bien|ok(?:ay)?|perfecto|gracias|listo|got\s+it|thank)/u);
      if (m && !isNumberName(m[1]) && !NOT_NAME.test(m[1]) && !NOT_NAMES.test(m[1])) return { name: m[1], thirdPerson: false, source: "staff-ask" };
    }
    for (const t of turns.slice(i + 1, i + 3)) {
      if (t.speaker !== "caller") continue;
      const c = [...String(t.text).matchAll(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,})\b/gu)].map((m) => m[1]).filter((x) => !isNumberName(x) && !NOT_NAME.test(x) && !NOT_NAMES.test(x));
      if (c.length === 1) return { name: c[0], thirdPerson: false, source: "staff-ask" };
    }
    return null;
  }
  return null;
}
