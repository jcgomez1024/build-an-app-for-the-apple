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
  // alexvoc1: a caller turn listing counts for 2+ flavors ("tres de horchata y dos de Jamaica") restates totals too.
  const PAIR = new RegExp(`\\b${NW}\\s+(?:de\\s+)?(?:horchata|jamaica|tamarindo|pi[ñn]a|mel[oó]n|lim[oó]n)s?\\b`, "giu");
  const KW = /\b(?:que\s+sean|ser[ií]an|en\s+total|total)\b/iu;
  const last = [...turns].reverse().find((t) => t.speaker === "caller" && /\b(?:horchata|jamaica|tamarindo|pi[ñn]a|mel[oó]n|lim[oó]n)\b/iu.test(t.text) && (KW.test(t.text) || (t.text.match(PAIR) || []).length >= 2));
  if (!last) return;
  const tail = KW.test(last.text) ? last.text.slice(last.text.search(KW)) : last.text;
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
// larry2 (CA04884ea, Oct 30 12:42 PM ET): English staff read-back "So I got your two onions and peppers, two street tacos,
// two burrito grande, steak, rice and beans, deluxe, and then eight quesadilla flour steak and your quesadillas. One homemade.
// And one flower." → ring read-back lines the cart is missing (side, grande burritos, plain quesadillas by tortilla).
const QID = "sq-quesadilla-HLT6CR", BID = "sq-burrito-TGWBEN", XID = "sq-extras-mild-salsa-asada-2oz-T6PGNT";
const EN = "(\\d+|one|two|three|four|five|six)";
const BMEAT: Array<[RegExp, string]> = [[/steak/iu, "Bistec / Steak"], ...TMEAT, [/chicken|pollo/iu, "Pollo / Chicken"], [/carnitas/iu, "Carnitas / Fried Pork"]];
export function staffReadback(turns: T): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.speaker !== "staff" || !/\b(?:so\s+)?i\s+(?:got|have)\s+(?:your|you)\b/iu.test(t.text)) continue;
    let s = t.text; for (let j = i + 1; j < turns.length && turns[j].speaker === "staff"; j++) s += " " + turns[j].text;
    return s;
  }
  return "";
}
export function applyEnglishReadback(cart: any[], turns: T): void {
  const rb = staffReadback(turns); if (!rb) return;
  const side = rb.match(new RegExp(`\\b${EN}\\s+(?:grilled\\s+)?onions?\\s+(?:and|&)\\s+peppers?\\b`, "iu"));
  const had = side && cart.find((l) => l.itemId === XID && (l.modifiers || []).some((m: any) => /cebolla y chiles asados/i.test(String(m.option))));
  if (had) had.quantity = nOf(side![1]) || had.quantity;
  else if (side) cart.push({ itemId: XID, quantity: nOf(side[1]) || 1, modifiers: [{ step: "Extras options", option: "Cebolla y Chiles Asados" }] });
  const bur = rb.match(new RegExp(`\\b${EN}\\s+(?:burritos?\\s+grandes?|grande\\s+burritos?)\\b([^.]*)`, "iu"));
  if (bur && !cart.some((l) => l.itemId === BID)) {
    const rest = bur[2].split(/\band\s+then\b/iu)[0];
    const mods: any[] = [{ step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" }];
    const mm = BMEAT.find(([re]) => re.test(rest)); if (mm) mods.push({ step: "(B) Burrito Carne Options", option: mm[1] });
    if (/\brice\b/iu.test(rest)) mods.push({ step: "(C) Burrito Options", option: "Arroz / Rice" });
    if (/\bbeans\b/iu.test(rest)) mods.push({ step: "(C) Burrito Options", option: "Frijoles Refritos / Refried Beans" });
    if (/\bdeluxe\b/iu.test(rest)) mods.push({ ...DELUXE });
    cart.push({ itemId: BID, quantity: nOf(bur[1]) || 1, modifiers: mods });
  }
  // "your quesadillas. One homemade. And one flower." — plain quesadillas listed by tortilla only
  const qs = rb.match(/\byour\s+quesadillas?\b[.,]?((?:\s*(?:and\s+)?(?:\d+|one|two|three|four)\s+(?:homemade|comal|flour|flower|harina|street)\b[.,]?)+)/iu);
  if (qs) {
    const qn = cart.filter((l) => l.itemId === QID).reduce((a, l) => a + (l.quantity || 1), 0);
    const plain = [...qs[1].matchAll(/(\d+|one|two|three|four)\s+(homemade|comal|flour|flower|harina|street)/giu)];
    const want = plain.reduce((a, m) => a + nOf(m[1]), 0);
    const told = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ").match(new RegExp(`\\b${EN}\\s+(?:of\\s+(?:the|your)\\s+)?quesadillas?\\b`, "giu")) || [];
    const callerTotal = told.reduce((a, s) => a + nOf(s.split(/\s+/)[0]), 0);
    if (want && qn + want <= Math.max(callerTotal, qn + want))
      for (const m of plain) {
        const w = m[2].toLowerCase(); const opt = /flour|flower|harina/.test(w) ? "(QHR) Quesadilla Harina / Flour (+$0.75)" : /street/.test(w) ? "(QST) Quesadilla Taquera / Street Quesadilla" : "(QCO) Quesadilla Comal / Homemade (+$1.00)";
        cart.push({ itemId: QID, quantity: nOf(m[1]) || 1, modifiers: [{ step: "(A) Q Tortilla Options", option: opt }] });
      }
  }
}

// alexvoc1 (CA12e9407, Oct 30 12:55 PM ET): "¿ahí va?" … "ahorita la llevamos ya pa allá. Entonces fueron las tres birrias…" —
// a status / confirmation call about an order already placed, with no new-order words from the caller.
const STATUS = /\b(?:ya\s+va\s+(?:pa|para)\s+all[aá]|(?:la|se\s+la|te\s+la|se\s+lo)\s+llevamos|ya\s+(?:viene|sali[oó]|va\s+en\s+camino)|en\s+camino|on\s+(?:its|it's|the)\s+way|already\s+(?:left|out)|where'?s\s+my\s+order|d[oó]nde\s+(?:va|est[aá])\s+mi\s+(?:orden|pedido|comida)|(?:ya\s+)?(?:me|le|te)\s+lleg[oó])\b/iu;
const NEW_ORDER = /\b(?:quiero|quisiera|me\s+(?:da|das|pone|puede|regala)|ponme|dame|agr[eé]g|a[ñn]ad|tambi[eé]n\s+(?:quiero|me)|i\s+(?:want|need|would\s+like)|i'?d\s+like|can\s+i\s+(?:get|have|order)|let\s+me\s+(?:get|have)|put\s+in\s+(?:an?|my)\s+order|para\s+ordenar|hacer\s+(?:un|una)\s+(?:orden|pedido)|pedir|place\s+an?\s+order|otr[ao]\s+orden)\b/iu;
export function isStatusFollowUpCall(turns: Array<{ speaker: string; text: string; end?: number }>): boolean {
  if (!turns.some((t) => STATUS.test(t.text))) return false;
  if (turns.some((t) => t.speaker === "caller" && NEW_ORDER.test(t.text))) return false;
  if (turns.some((t) => t.speaker === "staff" && /\b(?:qu[eé]\s+(?:le|te)\s+(?:vamos\s+a\s+dar|damos|doy|sirvo)|qu[eé]\s+(?:va|vas)\s+a\s+(?:querer|ordenar|llevar)|what\s+can\s+i\s+(?:get|do)\s+for\s+you|what\s+would\s+you\s+like)\b/iu.test(t.text))) return false;
  const dur = Math.max(0, ...turns.map((t) => Number(t.end) || 0));
  return dur > 0 && dur <= 120;
}

// vapor1 (CA331ca94, Oct 30 1:53 PM ET, Víctor): "dos órdenes de tacos al vapor … uno de papa, uno de frijol y tres de prensado,
// y luego cuatro de prensado y uno de frijoles" → 2 × Tacos al Vapor (5 each, per-order filling mix), never Taco de Comal.
export const VAPOR_ID = "sq-tacos-al-vapor-steamed-tacos-QYJLW5";
export const VAPOR_WORDS = /\btacos?\s+(?:al|de)\s+vapor\b|\bal\s+vapor\b|\bde\s+vapor\b|\bsudad[oi]s?\b|\bde\s+canasta\b|\bsteamed\s+tacos?\b/iu;
const VFILL: Array<[RegExp, string, string]> = [[/^papas?$/iu, "Papas / Potatoes", "papa"], [/^frijol(?:es)?$/iu, "Frijoles / Beans", "frijol"],
  [/^prensados?$/iu, "Prensado / Pork", "prensado"], [/^pollo$/iu, "Pollo / Chicken", "pollo"], [/^queso$/iu, "Queso / Cheese", "queso"]];
const VNUM: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10 };
const vn = (w: string) => VNUM[w.toLowerCase()] ?? (Number(w) || 0);
const VPAIR = /\b(\d{1,2}|un[oa]?|dos|tres|cuatro|cinco)\s+(?:de\s+)?(papas?|frijol(?:es)?|prensados?|pollo|queso)\b/giu;
const VPAIR2 = /\b(prensados?|papas?|frijol(?:es)?|pollo|queso)\s+(\d{1,2}|un[oa]?|dos|tres|cuatro|cinco)\b(?!\s+de)/giu;
function vaporChunks(text: string): Array<Array<[string, number]>> | null {
  const pairs: Array<{ i: number; f: string; n: number }> = [];
  for (const m of text.matchAll(VPAIR)) pairs.push({ i: m.index!, f: m[2], n: vn(m[1]) });
  for (const m of text.matchAll(VPAIR2)) if (!pairs.some((p) => Math.abs(p.i - m.index!) < 12)) pairs.push({ i: m.index!, f: m[1], n: vn(m[2]) });
  pairs.sort((a, b) => a.i - b.i);
  const out: Array<Array<[string, number]>> = []; let cur: Array<[string, number]> = [], sum = 0;
  for (const p of pairs) {
    const f = VFILL.find(([re]) => re.test(p.f)); if (!f || !p.n) return null;
    const ex = cur.find((c) => c[0] === f[1]); if (ex) ex[1] += p.n; else cur.push([f[1], p.n]); sum += p.n;
    if (sum === 5) { out.push(cur); cur = []; sum = 0; } else if (sum > 5) return null;
  }
  return cur.length || !out.length ? null : out;
}
export function vaporOrderCount(turns: T): number {
  let n = 0;
  for (const t of turns) if (t.speaker === "caller" && VAPOR_WORDS.test(t.text)) for (const m of t.text.matchAll(/\b(\d{1,2}|un[oa]?|dos|tres|cuatro|cinco|seis)\s+[oó]rden(?:es)?\b(?:\s+de\s+(?:tacos?\s+)?(?:al\s+vapor|de\s+vapor|sudados?|de\s+canasta))?/giu)) n = Math.max(n, vn(m[1]));
  return n;
}
/** Live + replay: rebuild Tacos al Vapor orders (5 per order) from the latest turn whose filling counts split into whole orders. */
export function applyVaporOrders(cart: any[], turns: T): void {
  // only when the CALLER orders vapor (a staff special-of-the-day list is not an order)
  if (!turns.some((t) => t.speaker === "caller" && VAPOR_WORDS.test(t.text))) return;
  const want = vaporOrderCount(turns);
  let groups: Array<Array<[string, number]>> | null = null;
  for (let i = turns.length - 1; i >= 0 && !groups; i--) {
    const g = vaporChunks(turns[i].text); if (g && (!want || g.length === want)) groups = g;
  }
  if (!groups) {
    const g = vaporChunks(turns.map((t) => t.text).join(" ")); if (g && (!want || g.length === want)) groups = g;
  }
  const fillRe = /papa|potato|frijol|bean|prensado|pork|pollo|chicken|queso|cheese/i;
  const said = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
  const tortSaid = /\b(?:comal|harina|flour|taquer[oa]s?|street|dorad[oa]s?|hech[oa]s?\s+a\s+mano)\b/iu.test(said);
  for (let i = cart.length - 1; i >= 0; i--) {
    const l = cart[i]; if (l.itemId === VAPOR_ID) { if (groups || want) cart.splice(i, 1); continue; }
    if (tortSaid || !/^sq-taco-/i.test(String(l.itemId))) continue;
    const meats = (l.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => !/^\s*\(T\w*\)|tortilla|salsa|cebolla|cilantro/i.test(o));
    if (meats.every((o: string) => fillRe.test(o))) cart.splice(i, 1);
  }
  const step = "(A) Tacos al Vapor Carne Options (ONLINE)";
  if (groups) for (const g0 of groups) {
    const g = [...g0].sort((a, b) => VFILL.findIndex(([, x]) => x === a[0]) - VFILL.findIndex(([, x]) => x === b[0]));
    const note = "vapor: " + g.map(([o, n]) => `${n} ${VFILL.find(([, x]) => x === o)![2]}`).join(", ");
    cart.push({ itemId: VAPOR_ID, quantity: 1, modifiers: g.slice(0, 3).map(([o]) => ({ step, option: o })), elviNotes: [note] });
  }
  else if (want) cart.push({ itemId: VAPOR_ID, quantity: want, modifiers: [] });
}

// vapor1: "una quesitoto de chorizo" / "quesitorta" / "queso torta de X" → (QTO) Queso Torta with the meat, when the cart lacks it.
const TORTA_ID = "sq-torta-4GNTTE";
const QT_MEAT: Array<[RegExp, string]> = [[/^(?:bistec|asada|steak)$/iu, "Bistec / Steak"], [/^chorizo$/iu, "Chorizo / Mexican Sausage"], [/^pollo|chicken$/iu, "Pollo / Chicken"],
  [/^(?:al\s*)?pastor$/iu, "Alpastor / Roasted Pork"], [/^carnitas$/iu, "Carnitas / Pulled Pork"], [/^buche$/iu, "Buche / Pork Stomach"], [/^tripas?$/iu, "Tripa / Beef Tripe"],
  [/^lengua$/iu, "Lengua / Beef Tongue"], [/^cabeza$/iu, "Cabeza / Beef Head"], [/^prensado$/iu, "Prensado / Spicy Pork"], [/^milanesa$/iu, "Milanesa / Breaded Steak"]];
export const QUESITORTA = /\b(?:quesitort[ao]s?|quesitot[ao]s?|queso\s*tortas?)\b/iu;
export function applyQuesoTortaSpoken(cart: any[], turns: T): void {
  for (const t of turns) {
    if (t.speaker !== "caller") continue;
    for (const m of t.text.matchAll(/\b(\d{1,2}|un[oa]?|dos|tres|cuatro)?\s*(?:quesitort[ao]s?|quesitot[ao]s?|queso\s*tortas?)\s+de\s+(al\s+pastor|\p{L}+)/giu)) {
      const meat = QT_MEAT.find(([re]) => re.test(m[2]))?.[1]; if (!meat) continue;
      const has = cart.some((l) => String(l.itemId).startsWith("sq-torta-") && (l.modifiers || []).some((x: any) => /QTO/.test(String(x.option))) && (l.modifiers || []).some((x: any) => String(x.option) === meat));
      if (has) continue;
      cart.push({ itemId: TORTA_ID, quantity: m[1] ? vn(m[1]) || 1 : 1, modifiers: [{ step: "(A) Torta Options", option: "(QTO) Queso Torta (+$0.50)" }, { step: "(B) Q Carnes / Meats", option: meat }] });
    }
  }
}
