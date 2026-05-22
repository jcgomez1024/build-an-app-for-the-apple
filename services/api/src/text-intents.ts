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
