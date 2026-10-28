import { applySharedAliases } from "./aliases.js";
function normalizeIntentText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REPLACEMENT_PIVOTS = [
  "mejor dame",
  "mejor quiero",
  "en vez de eso dame",
  "en vez dame",
  "instead i want",
  "instead give me",
  "instead get me",
  "rather i want",
  "rather give me",
  "cambio a",
  "i want",
  "quiero",
  "dame",
  "give me",
  "get me",
  "instead",
  "rather",
  "mejor",
];

const EMPTY_REPLACEMENT_RE = /^(?:something\s+else|another\s+item|different\s+item|otra\s+cosa|otro\s+producto|otro\s+item|eso|esto|that|this)$/;

export function extractReplacementBuildText(text: string): string {
  const normalized = normalizeIntentText(text);
  if (!normalized) return "";
  let bestIndex = -1;
  let bestPivot = "";
  for (const pivot of REPLACEMENT_PIVOTS) {
    const index = normalized.lastIndexOf(pivot);
    if (index >= 0 && index + pivot.length > bestIndex + bestPivot.length) {
      bestIndex = index;
      bestPivot = pivot;
    }
  }
  if (bestIndex < 0) return "";
  const replacement = normalized
    .slice(bestIndex + bestPivot.length)
    .replace(/^(?:a|an|one|un|una|uno|por\s+favor|please|me)\s+/, "")
    .trim();
  if (!replacement || EMPTY_REPLACEMENT_RE.test(replacement)) {
    return "";
  }
  return replacement;
}

/**
 * Caller words for meats -> the names Square uses, for every item (not only combos).
 * "Salsa asada" / "mild asada" is a salsa, so asada there is left alone.
 */
/**
 * fix18: phone/voice filler before the order ("Hola, buenas tardes. Quiero tres tacos…", "Me das dos gorditas…",
 * "Hi, can I get…") hid the quantity and could match other dishes ("das" → Enchiladas). Strip it first.
 */
const LEAD_FILLER = /^(?:(?:hola|hi|hello|hey|oye|oiga|bueno|okay|ok)\b[\s,.!]*|(?:buenas\s+(?:tardes|noches)|buenos\s+d[ií]as|good\s+(?:morning|afternoon|evening))\b[\s,.!]*|(?:yo\s+)?(?:quiero|quisiera|queria|quería|dame|deme|me\s+(?:das|da|pones|pone|regalas|haces|(?:puedes|puede|podr[ií]as?)\s+(?:tomar|dar|poner|traer|hacer|preparar|apuntar)(?:\s+(?:la\s+orden\s+de|una\s+orden\s+de|un\s+pedido\s+de))?)|(?:puedes|puede|podr[ií]as?)\s+(?:darme|ponerme|prepararme|traerme|hacerme)|can\s+i\s+(?:get|have)|could\s+i\s+(?:get|have)|may\s+i\s+have|i(?:'d|\s+would)\s+like|i\s+want|let\s+me\s+get|i'?ll\s+(?:have|take|get))\b[\s,]*)/iu;
export function stripLeadFiller(text: string) {
  let t = String(text || "").replace(/^[\s.,!¡¿]+/, "");
  for (let i = 0; i < 6; i += 1) {
    const n = t.replace(LEAD_FILLER, "").replace(/^[\s.,!¡¿]+/, "");
    if (n === t) break;
    t = n;
  }
  t = t.replace(/[\s,]*\b(?:please|por\s+favor)\b[\s.!?]*$/iu, "");
  // Keep the original when stripping would leave nothing ("hola" alone is not an order).
  return t.trim() ? t : String(text || "");
}

export function normalizeSpokenCatalogAliases(text: string) {
  // aliases1: shared phone+app spoken aliases (data/aliases/aliases.json) run first.
  // aceite1: "quesadilla(s) de bistec en aceite / frita(s)" = the fried (QD) Quesadilla Dorada, not a comal quesadilla.
  // relleno1: speech-to-text spellings of "chiles rellenos" ("chili rainos", "chile reyenos", "chilly rellanos")
  const relleno = (x: string) => x.replace(/\bchil(?:i|e|ly|lie)?(e?s)?[\s-]+(?:r[ae]i?y?[e]?n[oa]s|re[ly]{1,2}[ae]n[oa]s|rey[ae]n[oa]s|rain[oa]s|rayn?[oa]s|reinos|rellen[oa]s?)\b/giu, "chiles rellenos");
  const fried = (x: string) => x.replace(/\b(quesadillas?)\b((?:\s+(?!y\b|and\b)[\p{L}]+){0,4}?)\s+(?:en\s+aceite|fritas?|frit[oa]s?)\b/giu, (_m, q: string, mid: string) => `${q} ${/s$/i.test(q) ? "doradas" : "dorada"}${mid}`);
  return applySharedAliases(relleno(fried(stripLeadFiller(String(text || "")))), "app")
    .replace(/\b[oh]?orchatas?\b/gi, "horchata") // horchata1: STT "orchata"
    // larry1: "the quesadilla with the dip/dippy / to dip / with consomé" = Queso Birrias; "quesabirria(s)" too.
    .replace(/\bquesadillas?\s+(?:with|con)\s+(?:the\s+|el\s+)?(?:dippy|dip(?:ping)?(?:\s+(?:sauce|stuff))?|stuff\s+to\s+dip(?:\s+in(?:\s+it)?)?|consom[eé]|broth|caldito)\b(?:[,\s]+the\s+stuff\s+to\s+dip(?:\s+in(?:\s+it)?)?)?/gi, "Queso Birrias de comal")
    .replace(/\bquesa\s?birrias?\b/gi, "Queso Birrias")
    // ca7bae57: staff "quesibirrias"/"quesivirrias" + "quesadilla de birria" → Queso Birrias
    .replace(/\bquesi[bv]irrias?\b/gi, "Queso Birrias")
    .replace(/\bquesadillas?\s+de\s+birria\b/gi, "Queso Birrias")
    // larry1: grilled onions and peppers side = Extras "Cebolla y Chiles Asados".
    .replace(/\b(?:grilled\s+)?onions?\s+(?:and|&|y)\s+(?:green\s+)?peppers?\b|\bcebollas?\s+y\s+chiles?(?:\s+asados?)?\b/gi, "cebolla y chiles asados")
    // cheyenne1: "hecha a mano" / "de hecha mano" / "handmade" = the Comal (homemade) tortilla
    .replace(/(?:(?:de\s+)?(?:la\s+)?(?:tortilla\s+)?(?:grande\s+)?)?\bhech[oa]s?\s+(?:a\s+)?mano\b|\bhand\s*-?\s*made\b|\bmade\s+by\s+hand\b/gi, "de comal")
    .replace(/\b(al|el)\s+pastor\b/gi, "alpastor")
    .replace(/(?<!\bal)(?<!\balpastor)\bpastor\b/gi, "alpastor")
    .replace(/\bcarne\s+asada\b/gi, "bistec")
    .replace(/\b(salsa|mild)(\s+(de\s+)?)asada\b/gi, "$1$2__SALSA_ASADA__")
    .replace(/\basada\b/gi, "bistec")
    .replace(/__SALSA_ASADA__/g, "asada")
    // "duro" alone can match the Cueritos item, so name the option the way Square does.
    // fix11: bare "chicharrón" is ambiguous (Duro vs Prensado) and is asked in pre-turn.ts; qualified ones map here.
    .replace(/\bchicharr[oó]n(es)?\s+(del\s+|de\s+)?duros?\b/gi, "pork rinds")
    .replace(/\bchicharr[oó]n(es)?\s+(en\s+)?(chile\s+)?verdes?\b/gi, "pork rinds")
    .replace(/\bchicharr[oó]n(es)?\s+prensados?\b/gi, "prensado")
    .replace(/\bchicharr[oó]n(es)?\s+(en\s+)?(chile\s+)?roj[oa]s?\b/gi, "prensado")
    .replace(/\b(de|con|of|with)\s+duros?\b(?![\s\S]*cuerito)/gi, "$1 pork rinds")
    // fix18: the single Gordita is listed singular; "dos gorditas de chorizo" is 2 Gorditas (combo/pack only when said).
    .replace(/^[\s\S]*$/, (t) => (/\b(combos?|packs?|meals?|paquetes?)\b/i.test(t) ? t : t.replace(/\b(gordita|torta)s\b/gi, "$1")))
    .replace(/\bcarnita\b/gi, "carnitas")
    .replace(/\bchoriso\b/gi, "chorizo")
    .replace(/\bpoyo\b/gi, "pollo")
    .replace(/\bunesquites?\b/gi, "un esquite")
    // Speech-to-text spellings of "jarrito".
    .replace(/\b(jurritos?|juritos?|harritos?|haritos?|jaritos?|jaritto|yarritos?|charritos?|hurritos?|jarr?ito)\b/gi, "jarrito")
    .replace(/\bmango\s+gelatos?\b/gi, "mango jarrito")
    .replace(/\bdearina\b/gi, "de harina")
    // Speech-to-text spellings of "pambazo".
    .replace(/\b(pampazos?|panbazos?|pan\s+(?:v|b)azos?|pam\s+bazos?)\b/gi, "pambazo")
    // "a side of rice" / "orden de frijoles" is the Sides item, not a combo's side choice.
    .replace(/^[\s\S]*$/, (t) => (/\b(tacos?|quesadillas?|combo|burritos?|tortas?|gorditas?|platillo|plate|fiesta|pan|charola|bandeja|tray)\b/i.test(t)
      ? t
      : t.replace(/\b(?:a\s+)?(?:side|sides|orden|order)\s+(?:of|de)\s+(rice|beans|arroz|frijoles)\b/gi, "sides $1")))
    // "Street corn" / "elote en vaso" is the Esquite, unless a taco/quesadilla is named.
    .replace(/^[\s\S]*$/, (t) => (/\b(tacos?|quesadillas?|combo)\b/i.test(t)
      ? t
      : t.replace(/\b(esquites?\s+)?(mexican\s+)?(street\s+corn|corn\s+in\s+a\s+cup|elotes?(\s+en\s+vaso)?|esquites?)\b/gi, "esquite")
          .replace(/^([\s\S]*\besquite\b[\s\S]*)$/i, (e) => e
            .replace(/\b(sin|no|without)\s+(el\s+)?taj[ií]n\b/gi, "no tajin chilli")
            .replace(/\b(con|with)\s+(el\s+)?taj[ií]n\b/gi, "tajin chilli powder"))))
    // Tortilla words (tacos / quesadillas only). Comal stays the website's preselect; these pick explicitly.
    .replace(/^[\s\S]*$/, (t) => (/\b(tacos?|quesadillas?|combo)\b/i.test(t)
      ? t
          .replace(/\b(de\s+ma[ií]z|street\s+corn|corn\s+tortillas?|tortillas?\s+de\s+ma[ií]z|chiquit[oa]s?|taquer[oa]s?|peque[nñ][oa]s?)\b/gi, "street")
          .replace(/\b(hech[oa]s?\s+a\s+mano|handmade|hand\s+made|tortillas?\s+grandes?|grandes?\s+de\s+comal)\b/gi, "comal")
      : t))
    // Bottled water ("a water" was fuzzy-matching Huarache).
    .replace(/\b(a\s+|one\s+|bottled\s+)?water(\s+bottle)?\b(?![\s\S]*\b(mineral|sparkling)\b)/gi, (m) => (/\b(mineral|sparkling)\b/i.test(m) ? m : "agua water bottle"))
    // Politeness words are not menu words ("por favor" was fuzzy-matching an item).
    .replace(/[,\s]*\b(por\s+favor|please)\b[.!]?/gi, "")
    .trim();
}
