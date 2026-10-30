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

// ---- marina1 (CAb3acddf, Oct 30 12:03 PM ET, Spanish delivery): 3 birria de chivo, 2×5 tacos taqueros de asada, 3 horchatas, 2 jamaicas.
type T = Array<{ speaker: string; text: string }>;
const N: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const nOf = (w: string) => N[w.toLowerCase()] ?? (Number(w) || 0);
const NW = "(\\d+|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce)";
/** Staff confirms the caller's count ("Tres, tres de birria" → "Tres órdenes de birria"): that dish's total is that count. */
export function applyStaffOrderCount(cart: any[], turns: T): void {
  for (let i = 1; i < turns.length; i++) {
    const t = turns[i]; if (t.speaker !== "staff") continue;
    const m = t.text.match(new RegExp(`^\\W*${NW}\\s+[oó]rden(?:es)?\\s+de\\s+(birria|menudo|pozole|barbacoa)\\b`, "iu"));
    if (!m) continue;
    const n = nOf(m[1]), prev = turns.slice(Math.max(0, i - 2), i).filter((u) => u.speaker === "caller").map((u) => u.text).join(" ");
    if (n < 1 || !new RegExp(`\\b${m[1]}\\b`, "iu").test(prev)) continue; // the caller said that number
    const ls = cart.filter((l) => String(l.itemId).toLowerCase().startsWith(`sq-${m[2].toLowerCase()}`));
    if (!ls.length) continue;
    ls[0].quantity = n; for (const l of ls.slice(1)) cart.splice(cart.indexOf(l), 1);
  }
}
/** A plate whose item already includes tortillas (birria "y tortillas de comal", menudo con tortillas) — separate tortilla orders the caller never asked for are its tortillas. */
export function dropIncludedTortillas(cart: any[], turns: T): void {
  if (!cart.some((l) => /^sq-(?:birria|menudo|pozole)/i.test(String(l.itemId)) && /tortillas/i.test(String(l.itemId)))) return;
  if (turns.some((t) => t.speaker === "caller" && /\btortillas?\b/iu.test(t.text))) return;
  for (let i = cart.length - 1; i >= 0; i--) if (/^sq-tortillas/i.test(String(cart[i].itemId))) cart.splice(i, 1);
}
/** "Que sean tres de horchata y dos de Jamaica" — the caller's final restatement sets the totals per agua. */
export function applyDrinkRestatement(cart: any[], turns: T): void {
  const last = [...turns].reverse().find((t) => t.speaker === "caller" && /\b(?:que\s+sean|ser[ií]an|en\s+total|total)\b/iu.test(t.text) && /\b(?:horchata|jamaica|tamarindo|pi[ñn]a|mel[oó]n|lim[oó]n)\b/iu.test(t.text));
  if (!last) return;
  const tail = last.text.slice(last.text.search(/\b(?:que\s+sean|ser[ií]an|en\s+total|total)\b/iu));
  for (const m of tail.matchAll(new RegExp(`\\b${NW}\\s+(?:de\\s+)?(horchata|jamaica|tamarindo|pi[ñn]a|mel[oó]n|lim[oó]n)s?\\b`, "giu"))) {
    const n = nOf(m[1]), key = m[2].toLowerCase().replace("ñ", "n").replace(/[óò]/, "o");
    const ls = cart.filter((l) => new RegExp(`agua-fresca-${key}`, "i").test(String(l.itemId)));
    if (!ls.length || n < 1) continue;
    ls[0].quantity = n; for (const l of ls.slice(1)) cart.splice(cart.indexOf(l), 1);
  }
}
const TACO_ID = "sq-taco-TAR7L5";
const TMEAT: Array<[RegExp, string]> = [[/asada|bistec/iu, "Bistec / Steak"], [/pastor/iu, "Alpastor / Roasted Pork"], [/chorizo/iu, "Chorizo / Mexican Sausage"], [/lengua/iu, "Lengua / Beef Tongue (+$0.50)"]];
/** Tacos only staff confirmed ("Cinco de asada." … "otra orden de cinco tacos") when Elvi has none: add them; chiquitos/taquero → TST, comal → TCO. */
export function addStaffConfirmedTacos(cart: any[], turns: T): void {
  if (cart.some((l) => /taco/i.test(String(l.itemId)))) return;
  const all = turns.map((t) => t.text).join(" ");
  if (!/\btacos?\b/iu.test(all)) return;
  let meat = "", total = 0;
  for (const t of turns) {
    if (t.speaker !== "staff") continue;
    const m = t.text.match(new RegExp(`\\b${NW}\\s+(?:tacos?\\s+)?de\\s+(asada|bistec|pastor|chorizo|lengua)\\b`, "iu"));
    if (m) { const mm = TMEAT.find(([re]) => re.test(m[2])); if (mm) { meat = mm[1]; total += nOf(m[1]); } continue; }
    const o = t.text.match(new RegExp(`\\botra\\s+orden\\s+de\\s+${NW}\\s+tacos?\\b`, "iu"));
    if (o && meat) total += nOf(o[1]);
  }
  if (!meat || total < 1) return;
  const street = /\b(?:chiquitos?|taquer[oa]s?|street|peque[ñn]os?)\b/iu.test(turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" "));
  cart.push({ itemId: TACO_ID, quantity: total, modifiers: [{ step: "(A) T Tortilla Options", option: street ? "(TST) Taco Taquero / Street Taco" : "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "(B) T Carnes / Meats Opciones", option: meat }] });
}
