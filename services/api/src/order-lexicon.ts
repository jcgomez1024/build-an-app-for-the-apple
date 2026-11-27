// Shared order-pipeline lexicon. Each helper keeps the answer of the copy it replaced.
// The yes detectors are different on purpose. They are not one predicate.

export const NUM_TO_SIX: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
};
/** list-repair and second-groups: Number first, then the word, else 0. No case fold. */
export const numToSix = (w: string) => Number(w) || NUM_TO_SIX[w] || 0;

export const SPANISH_1_10: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

export const SPANISH_1_8: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
};

export const NUM_A_TEN: Record<string, number> = {
  un: 1, una: 1, uno: 1, one: 1, a: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4,
  cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10,
};

/** Bare yes used by the list repairs. "por favor" counts. "yep" does not. */
export const YES_LIST = /^(?:si|yes|yeah|ok(?:ay)?|aja|claro|por favor|eso)\b/;
/** Name confirmation. Accented sí, and a trailing letter does not count. */
export const YES_NAME = /^\s*(s[ií]|sip|claro|correcto|as[ií] es|exacto|ajá|aja|yes|yeah|yep|yup|correct|that'?s right|right|sure|ok(ay)?)(?![\p{L}])/iu;
/** Caller-count yes. "yep" counts. "por favor" does not. */
export const YES_COUNT = /^(?:yep|yeah|yes|si|aja|ok|okay|claro|correcto|right|sure)\b/;

const AVQ = /^(?:(?:y|e|eh|ah|em|este|oiga|oye|disculpe|hola|bueno|si)\s+)*(?:y\s+)?(?:tienes?|tienen|hay|venden|manejan|hacen|hace|preparan|prepara|sirven|sirve|ofrecen|ofrece)\b/;
const AVQ_EN = /^(?:(?:hi|hey|hello|yes|yeah|ok(?:ay)?|so|and|oh|um|uh|but|no|i\s+was\s+(?:calling|wondering|checking)\s+(?:to\s+(?:see|ask|check)\s+)?(?:if|whether)|calling\s+to\s+see\s+if|just\s+wondering\s+if|i\s+wanted\s+to\s+(?:see|know|ask)\s+if)\s+)*(?:(?:do|does)\s+)?(?:you|y'?all)(?:\s+guys)?(?:\s+still)?\s+(?:have|got|carry|sell|make|serve)\b|^(?:(?:ok(?:ay)?|and|so|oh|um|hi|hey)\s+)*(?:how|what)\s+about\b|^(?:(?:ok(?:ay)?|and|so|oh|um|hi|hey)\s+)*(?:is|are)\s+there\b|^(?:(?:ok(?:ay)?|and|so|oh|um|hi|hey)\s+)*(?:got\s+)?any\s+[a-z ]{2,30}(?:\s+today|\s+tonight|\s+left)?$/;
const ORDER_EN = /\b(?:can\s+i\s+(?:get|have|order)|could\s+i\s+(?:get|have)|i'?ll\s+(?:take|have|get)|i\s+(?:want|need)|i'?d\s+like|let\s+me\s+(?:get|have)|give\s+me|get\s+me|order\s+of|for\s+pickup|to\s+go)\b/;
const foldAvail = (x: string) => String(x || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();

/** "¿tienes pollo a la crema?" / "calling to see if you guys have pozole" — asks, orders nothing. */
export function isAvailQ(x: string): boolean {
  const y = foldAvail(x).replace(/\bi\s+was\s+calling\s+to\s+see\s+if\b/, "calling to see if");
  if (/\b(?:me\s+da|dame|deme|me\s+pone|ponme|pongame|quiero|quisiera|me\s+das|una\s+orden)\b/.test(y) || ORDER_EN.test(y)) return false;
  if (/\b(?:pregunta|duda|question)\b/.test(y) && /\b(?:tienes?|tienen|hay|venden|manejan)\b/.test(y)) return true;
  if (/\b(?:\d+|one|two|three|four|five|six|dos|tres|cuatro)\s+[a-z]/.test(y) && !AVQ.test(y)) return false;
  return AVQ.test(y) || AVQ_EN.test(y.replace(/^(?:(?:but|no|hi|hey|ok(?:ay)?)\s+)+/, "").replace(/^i\s+was\s+/, "i was "));
}

/** "¿tiene/tienen/hay X?" and "una pregunta, ¿tiene X?" ask. An order verb does not. */
export const ASK_ORDER = /\b(?:quiero|quisiera|quer[ií]a|dame|deme|ponme|p[oó]ngame|me\s+(?:da|das|pone|pones)|me\s+puedes?\s+poner|i\s+want|give\s+me|i'?ll\s+take)\b/iu;
export function isAvailabilityAsk(text: string): boolean {
  const t = String(text || "");
  if (ASK_ORDER.test(t) && !/\b(?:pregunta|duda|question)\b/iu.test(t)
    && !/^\W*(?:(?:ah|oh|este|bueno|pues|s[ií])[,.\s]+){0,4}(?:me\s+)?(?:pone|pones|pongo|ponme|p[oó]ngame)\s+(?:un[oa]?)?\s*,?\s*(?:s[ií]\s+)?(?:tiene|tienen|tienes|hay)\b/iu.test(t)) return false;
  if (/\b(?:tiene|tienen|tienes|hay|vende[ns]?|manejan|do\s+you\s+(?:guys\s+)?have|got\s+any)\b/iu.test(t) && /[?¿]/.test(t)) return true;
  return /\b(?:pregunta|duda|question)\b/iu.test(t) && /\b(?:tiene|tienen|tienes|hay)\b/iu.test(t);
}
