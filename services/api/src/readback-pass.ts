// brenda1 (CA6995b9c, Oct 30 12:14 PM ET): per-turn guards + staff read-back end-pass for English staff-answered calls.
const DISH = /\b(?:tacos?|quesadillas?|burritos?|tortas?|gorditas?|huaraches?|sopes?|pozole|menudo|mole|platillos?|enchiladas?|tamales?|tostadas?|nachos?|birria|pambazos?|flautas?|doradas?|chiles?\s+rellenos?|combos?|aguas?|horchata|jamaica|jarritos?|sodas?|drinks?)\b/iu;
const COUNT = /\b(?:\d+|one|two|three|four|five|six|un[oa]?|dos|tres|cuatro|cinco|seis)\b/iu;
/** "this is the Elvis, right?" / "¿es Cocina Elvis?" — confirming the restaurant, not ordering. */
export function restaurantConfirm(text: string): boolean {
  const t = String(text || "");
  return /\b(?:is\s+this|this\s+is|es|aqu[ií]\s+es|hablo\s+(?:a|con))\s+(?:the\s+|la\s+|el\s+)?(?:cocina\s+)?elvis\b/iu.test(t) && !DISH.test(t) && !COUNT.test(t.replace(/\bone\s+sec/iu, ""));
}
const SALSA_W = /\b(?:salsas?|sauces?|green|verdes?|red|rojas?|avocado|aguacate|guacamole|mild|medium|hot|picante)\b/iu;
/** "as far as the salsa… two green, one red, and the avocado salsa" — side salsas only, no dish. */
export function salsaOnlyTurn(text: string): boolean {
  const t = String(text || "");
  return SALSA_W.test(t) && !DISH.test(t);
}
/** Answer to staff's sides/toppings question ("Rice and beans is fine?" → "yeah, not too much rice") or a "more lengua" aside — changes, never a new dish. */
export function sideAnswerTurn(text: string, lastStaff: string): boolean {
  const t = String(text || "");
  if (DISH.test(t)) return false;
  if (/\b(?:a\s+lot\s+of|more|extra|m[aá]s)\s+(?:of\s+(?:the\s+)?)?(?:lengua|tripas?|bistec|steak|asada|pastor|carnitas|chorizo|pollo|chicken|cabeza|buche|barbacoa|meat|carne)\b/iu.test(t) && !COUNT.test(t)) return true;
  return /\b(?:rice|beans|deluxe|lettuce|pickles?|sour\s+cream|everything|arroz|frijol(?:es)?|lechuga|crema|con\s+todo)\b/iu.test(lastStaff || "") && !COUNT.test(t);
}
const FLAVORS: Array<[RegExp, string]> = [
  [/\b(?:green|verdes?)\b/iu, "Medium Salsa Verde 2oz"],
  [/\b(?:red|rojas?|hot)\b/iu, "Hot Salsa Roja 2oz"],
  [/\b(?:avocado|aguacate|guacamole)\b/iu, "Guacamole Salsa 2oz"],
  [/\b(?:mild|asada)\b/iu, "Mild Salsa Asada 2oz"],
  [/\b(?:tomato|tomate)\b/iu, "Mild Salsa Tomato 2oz"],
];
const NUMS: Record<string, number> = { one: 1, a: 1, an: 1, un: 1, una: 1, uno: 1, two: 2, dos: 2, three: 3, tres: 3, four: 4, cuatro: 4, five: 5, cinco: 5 };
const num = (w: string) => NUMS[w.toLowerCase()] ?? (Number(w) || 0);
/** Side salsas the caller listed ("two green, one red, and maybe two avocado"): per flavor, the largest count said (repeats aren't more). */
export function sideSalsas(turns: Array<{ speaker: string; text: string }>): Array<{ option: string; quantity: number }> {
  const out = new Map<string, number>();
  let ctx = false;
  for (const t of turns) {
    if (t.speaker !== "caller") continue;
    const x = String(t.text || "");
    if (/\b(?:salsas?|sauces?)\b/iu.test(x)) ctx = true;
    if (!ctx || DISH.test(x)) continue;
    // nearest count said before each flavor in the turn ("maybe, two, avocado slices" → 2); none → 1
    let n = 0;
    for (const w of x.split(/[^\p{L}\d]+/u).filter(Boolean)) {
      if (/^(?:\d+|one|two|three|four|five|un[oa]?|dos|tres|cuatro|cinco)$/iu.test(w)) { n = num(w); continue; }
      const f = FLAVORS.find(([re]) => re.test(w));
      if (!f) continue;
      out.set(f[1], Math.max(out.get(f[1]) || 0, n || 1)); n = 0;
    }
  }
  return [...out].map(([option, quantity]) => ({ option, quantity }));
}
const s0 = (turns: Array<{ speaker: string; text: string }>, i: number) => turns.slice(Math.max(0, i - 1), i + 1).map((t) => t.text).join(" ");
const DELUXE = { step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" };
/** Staff read-back / accepted offers on burritos: deluxe, rice, beans, "just a little bit of rice". */
export function applyBurritoReadback(cart: any[], turns: Array<{ speaker: string; text: string }>): boolean {
  const bur = cart.filter((l) => /burrito/i.test(String(l.itemId)));
  if (!bur.length) return false;
  let deluxe = false, rice = false, beans = false, light = false;
  const first = turns.findIndex((t) => /\bburritos?\b/iu.test(t.text));
  if (first < 0) return false;
  for (let i = first; i < turns.length; i++) {
    const t = turns[i]; if (t.speaker !== "staff") continue;
    // only staff lines about the burrito (offer right after it, or a read-back that names it)
    if (!/\bburritos?\b|\bdeluxe\b|\bwith\s+everything\b|\bis\s+fine\b/iu.test(s0(turns, i))) continue;
    const nextCaller = turns.slice(i + 1).find((u) => u.speaker === "caller")?.text || "";
    const declined = /^\W*(?:no|nah|nope)\b/iu.test(nextCaller);
    const s = t.text;
    if (/\bdeluxe\b/iu.test(s) && !declined) deluxe = true;
    if (/\brice\b|\barroz\b/iu.test(s) && !declined) rice = true;
    if (/\bbeans\b|\bfrijol/iu.test(s) && !declined) beans = true;
    if (/\b(?:little\s+bit\s+of|light|poco(?:\s+de)?|not\s+too\s+much)\s+(?:rice|arroz)\b/iu.test(s)) light = true;
  }
  for (const t of turns) if (t.speaker === "caller" && /\b(?:not\s+too\s+much|little\s+bit\s+of|light|less|poco(?:\s+de)?|poquito\s+de)\s+(?:rice|arroz)\b/iu.test(t.text)) light = true;
  let changed = false;
  for (const l of bur) {
    const mods: any[] = l.modifiers = l.modifiers || [];
    const has = (re: RegExp) => mods.some((m) => re.test(String(m.option)));
    if (deluxe && !has(/DELUXE/i)) { mods.push({ ...DELUXE }); changed = true; }
    if (rice && !has(/Arroz/i)) { mods.push({ step: "(C) Burrito Options", option: "Arroz / Rice" }); changed = true; }
    if (beans && !has(/Frijoles/i)) { mods.push({ step: "(C) Burrito Options", option: "Frijoles Refritos / Refried Beans" }); changed = true; }
    // a rice "filling" picked as the meat by the model is not the side
    if (light) { l.elviNotes = [...new Set([...(l.elviNotes || []), "poco arroz / light rice"])]; changed = true; }
  }
  return changed;
}
/** Staff read-back "two homemade quesadilla, tripa, salsa verde" → that dish's salsa preference. */
export function applyReadbackSalsaPref(cart: any[], turns: Array<{ speaker: string; text: string }>): void {
  const staff = turns.filter((t) => t.speaker === "staff").map((t) => t.text).join(" ");
  for (const m of staff.matchAll(/\b(quesadillas?|tacos?|gorditas?|tortas?|burritos?)\b([^.]{0,80}?)\bsalsa\s+(verde|roja|asada)\b/giu)) {
    if (/\b(?:quesadillas?|tacos?|gorditas?|tortas?|burritos?)\b/iu.test(m[2])) continue;
    const dish = m[1].toLowerCase().replace(/s$/, "");
    const opt = m[3].toLowerCase() === "verde" ? "Medium Salsa Verde" : m[3].toLowerCase() === "roja" ? "Hot Salsa Roja" : "Mild Salsa Asada";
    for (const l of cart) {
      if (!new RegExp(`sq-${dish}`, "i").test(String(l.itemId))) continue;
      const mods: any[] = l.modifiers = (l.modifiers || []).filter((x: any) => !/^(?:Mild Salsa Asada|Hot Salsa Roja|Medium Salsa Verde|Mild Salsa Tomato)$/i.test(String(x.option)));
      mods.push({ step: "(I) Salsa Preferencia / Preference", option: opt });
    }
  }
}
