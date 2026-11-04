// adolfo2 (CA453699): "el combo de roast y frijoles" (STT for arroz) + staff "combo de arroz con frijoles" rang SOLO Frijoles,
// and an auto-accept on a goodbye applied DELUXE + salsa asada nobody chose.
type Turn = { speaker?: string; text: string };
type Line = { itemId: string; quantity?: number; modifiers?: { step: string; option: string }[] };
const nrm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
/** STT: "roast"/"rost"/"ros" right before "y/con frijol(es)" or after "combo de" = arroz. */
export function fixArrozStt(text: string): string {
  return String(text || "")
    .replace(/\b(?:roast|rost|ros|rose)\b(?=\s+(?:y|con|and|e)\s+frijol)/giu, "arroz")
    .replace(/(\bcombo\s+(?:de|con)\s+)(?:roast|rost|ros|rose)\b/giu, "$1arroz");
}
const BOTH = /\b(?:arroz|rice)\s+(?:y|con|and|e|&)\s+(?:frijol|beans)|\b(?:frijol(?:es)?|beans)\s+(?:y|con|and)\s+(?:arroz|rice)/;
const SOLO = /\b(?:solo|solamente|nom[aá]s|puro|only|just)\s+(?:de\s+)?(?:arroz|rice|frijol|beans)|\b(?:sin|no|without)\s+(?:el\s+|los\s+)?(?:arroz|rice|frijol|beans)/;
const BOTH_OPT = "Arroz - Rice and Frijoles Refritos - Refried Beans";
export function applyComboSidesBoth(cart: Line[], turns: Turn[]): void {
  const said = turns.map((t) => nrm(fixArrozStt(t.text)));
  if (!said.some((t) => BOTH.test(t)) || said.some((t) => SOLO.test(t))) return;
  for (const l of cart) for (const m of l.modifiers || [])
    if (/COMBO\s+Sides/i.test(m.step) && /^SOLO\b/i.test(m.option)) m.option = BOTH_OPT;
}
const DELUXE_SAID = /\b(?:deluxe|delux|preparad[oa]s?|con\s+tod[oi]|lechuga|lettuce|pico|crema|sour\s+cream|everything)\b/;
const SALSA_SAID = /\b(?:salsa|salsita|mild|medium|hot|picante|picosa|verde|roja|tomate|tomato|green|red)\b/;
/** Optional DELUXE / salsa-preference picks stay only if someone on the call said them. */
export function dropUnchosenToppings(cart: Line[], turns: Turn[]): void {
  const blob = turns.map((t) => nrm(t.text)).join(" ");
  const dx = DELUXE_SAID.test(blob), sx = SALSA_SAID.test(blob);
  for (const l of cart) if (l.modifiers) l.modifiers = l.modifiers.filter((m) =>
    !((!dx && /DELUXE\b.*Options/i.test(m.step) && /^DELUXE/i.test(m.option)) || (!sx && /Salsa\s+Preferencia/i.test(m.step))));
}
