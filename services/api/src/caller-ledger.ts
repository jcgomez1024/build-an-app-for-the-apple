// pancho1 (CAf6657ca96ab5a47427631b6550d10d45 ~1:54 PM ET Oct 29): a caller-only ledger for quesadilla/gordita calls.
// Staff option lists ("de maíz en el comal, de harina o doradas"), confirmations ("una de costilla con frijoles") and the
// final readback never add items; only caller counts do. "<meat> con frijoles" is the paid add-on, never a frijol filling.
// The shadow end-pass uses the ledger only when it prices to the staff's spoken total and the live cart does not.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type LedgerLine = { itemId: string; quantity: number; modifiers: Array<{ step: string; option: string }>; readback: string; elviNotes?: string[] };
const nf = (x: string) => String(x || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[¿?¡!.,;]/g, " ").replace(/\s+/g, " ").trim();
const QCO_ID = "sq-quesadilla-HLT6CR", GORD_ID = "sq-gordita-M647RE";
const CNT: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8 };
const MEAT: Record<string, string> = {
  bistec: "Bistec / Steak", asada: "Bistec / Steak", carnitas: "Carnitas / Pulled Pork", costilla: "Costilla / Beef Rib", pastor: "Alpastor / Roasted Pork",
  chorizo: "Chorizo / Mexican Sausage", pollo: "Pollo / Chicken", buche: "Buche / Pork Stomach", tripa: "Tripa / Beef Tripe", lengua: "Lengua / Beef Tongue",
  cabeza: "Cabeza / Beef Head", prensado: "Prensado / Spicy Pork", picadillo: "Picadillo / Ground Beef with Potatoes", deshebrada: "Deshebrada / Shredded Beef with Potatoes" };
const MW = "bistec|asada|carnitas|costilla|pastor|chorizo|pollo|buche|tripas?|lengua|cabeza|prensado|picadillo|deshebrada";
const meatOf = (w: string) => MEAT[w.replace(/s$/, "") === "tripa" ? "tripa" : w] || MEAT[w];
const OTHER = /\b(?:tacos?|burritos?|tortas?|sopes?|sopesaso|tostadas?|flautas?|menudo|caldo|pozole|huaraches?|doradas?|preparadas?|aguas?|coca|refrescos?|sodas?|dips?|nachos|tamales?|enchiladas?|chilaquiles|especial|combo)\b/;

type Item = { dish: "q" | "g"; meat: string; frij: boolean; qgd: boolean; style?: "comal" | "harina"; n: number; grp: number };

/** Caller-only ledger, or null when the call has anything this ledger does not model. */
export function callerLedger(turns: Array<{ speaker: string; text: string }>): LedgerLine[] | null {
  const items: Item[] = [];
  let last: "q" | "g" | null = null, pending: { n: number; dish: "q" | "g" } | null = null, grp = 0, qStyle: "comal" | "harina" | undefined;
  for (const t of turns) {
    if (t.speaker !== "caller") continue;
    const x = nf(t.text);
    if (OTHER.test(x)) return null;
    const style = /\bcomal\b|\bmaiz\b/.test(x) ? "comal" : /\bharina\b|\bflour\b/.test(x) ? "harina" : undefined;
    const frij = /\bcon\s+frijol(?:es|itos)?\b/.test(x);
    let added: Item[] = [];
    const dishOf = (w: string) => (/^gordit/.test(w) ? "g" : "q") as "q" | "g";
    // "dos quesadillas de bistec (con frijoles)"
    const full = [...x.matchAll(new RegExp(String.raw`\b(un|una|uno|dos|tres|cuatro|cinco|seis|\d)\s+(quesadillas?|gorditas?)\s+de\s+(${MW})\b`, "g"))];
    for (const m of full) { const d = dishOf(m[2]); grp++; added.push({ dish: d, meat: meatOf(m[3]), frij: false, qgd: false, n: CNT[m[1]] || Number(m[1]) || 1, grp }); last = d; pending = null; }
    if (!full.length) {
      const bare = x.match(/\b(?:otr[ao]s\s+)?(un|una|dos|tres|cuatro|cinco|seis|\d)\s+(quesadillas?|gorditas?)\b/) || x.match(/\botr[ao]s\s+(dos|tres|cuatro|cinco|seis|\d)\b/);
      if (bare) { const d = bare[2] ? dishOf(bare[2]) : last; if (d) { pending = { n: CNT[bare[1]] || Number(bare[1]) || 1, dish: d }; last = d; } }
      const en = [...x.matchAll(new RegExp(String.raw`\b(un|una|uno|otr[ao])\s+de\s+(${MW})\b`, "g"))];
      if (pending && en.length) {
        grp++;
        for (const m of en.slice(0, pending.n)) added.push({ dish: pending.dish, meat: meatOf(m[2]), frij: false, qgd: false, n: 1, grp });
        pending = null;
      }
    }
    if (added.length) {
      for (const a of added) { if (frij) a.frij = true; if (a.dish === "q") a.style = style || qStyle; }
      items.push(...added);
    } else {
      // no new item: a style / "con frijoles" answer for the latest group, or a clarification ("de bistec con frijoles también")
      const lastGrp = items.filter((i) => i.grp === grp);
      const clar = x.match(new RegExp(String.raw`^(?:y\s+)?(?:la\s+otra\s+)?de\s+(${MW})\b`));
      if (clar) { const it = lastGrp.find((i) => i.meat === meatOf(clar[1])); if (it && frij) it.frij = true; }
      else if (frij) lastGrp.forEach((i) => (i.frij = true));
      // "a la de bistec, ¿me le puede poner queso?" → that gordita is a QGD (a quesadilla already has cheese → no-op)
      const ala = x.match(new RegExp(String.raw`\ba\s+la\s+de\s+(${MW})\b`));
      if (ala && /\bqueso\b/.test(x)) { const it = [...items].reverse().find((i) => i.meat === meatOf(ala[1])); if (it?.dish === "g") it.qgd = true; }
    }
    if (style) { qStyle = style; items.filter((i) => i.dish === "q" && !i.style).forEach((i) => (i.style = style)); }
  }
  if (!items.length || items.some((i) => !i.meat)) return null;
  if (items.some((i) => i.dish === "q" && !i.style)) { if (!qStyle) return null; items.forEach((i) => { if (i.dish === "q" && !i.style) i.style = qStyle; }); }
  // merge identical lines
  const out: LedgerLine[] = [];
  for (const i of items) {
    const mods = i.dish === "q"
      ? [{ step: "(A) Q Tortilla Options", option: i.style === "harina" ? "(QHR) Quesadilla Harina / Flour (+$0.75)" : "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: i.meat }]
      : [{ step: "(A) Gordita Options", option: i.qgd ? "(QGD) Queso Gordita (+$0.50)" : "(GD) Gordita" }, { step: "(B) Q Carnes / Meats", option: i.meat }];
    if (i.frij) mods.push({ step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" });
    const id = i.dish === "q" ? QCO_ID : GORD_ID, key = id + JSON.stringify(mods);
    const same = out.find((o) => o.itemId + JSON.stringify(o.modifiers) === key);
    if (same) { same.quantity += i.n; continue; }
    out.push({ itemId: id, quantity: i.n, modifiers: mods, readback: `${i.n} ${i.dish === "q" ? (i.style === "harina" ? "QHR" : "QCO") : i.qgd ? "QGD" : "gordita"} ${i.meat.split(" /")[0].toLowerCase()}${i.frij ? " con frijoles" : ""}` });
  }
  return out;
}

let products: any[] | null = null;
function catalog(): any[] {
  if (products) return products;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    products = (JSON.parse(fs.readFileSync(path.join(here, "../data/site-catalog.json"), "utf8")).products || []) as any[];
  } catch { products = []; }
  return products!;
}
const plain = (s: string) => nf(String(s || "").replace(/\(\+?\$[^)]*\)/g, "").replace(/\*+/g, ""));
/** Cart total in cents from the site catalog (base SKU + chosen option prices); null if any line can't be priced. */
export function priceCents(lines: Array<{ itemId: string; quantity?: number; modifiers?: any[] }>): number | null {
  let sum = 0;
  for (const l of lines) {
    const suf = String(l.itemId).split("-").pop() || "";
    const p = catalog().find((x: any) => (x.skus || []).some((s: any) => String(s.squareId || "").startsWith(suf)));
    if (!p) return null;
    let unit = Number(p.skus.find((s: any) => String(s.squareId).startsWith(suf))?.priceCents ?? p.skus[0].priceCents) || 0;
    const seen = new Set<string>();
    for (const m of l.modifiers || []) {
      const o = plain(m.option); if (seen.has(o)) continue; seen.add(o);
      for (const g of p.groups || []) { const c = (g.choices || []).find((c: any) => plain(c.name) === o); if (c) { unit += Number(c.priceCents) || 0; break; } }
    }
    sum += unit * (Number(l.quantity) || 1);
  }
  return sum;
}
const TENS: Record<string, number> = { diez: 10, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const ONES: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const TEENS: Record<string, number> = { once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
/** Staff's spoken order total in dollars ("van a ser cuarenta y uno", "son 41 dólares"), last one wins. */
export function spokenTotalDollars(staffText: string): number | null {
  const x = nf(staffText);
  const ms = [...x.matchAll(/\b(?:van\s+a\s+ser|ser[ia]+n?|son|es|total(?:\s+es)?|te\s+sale(?:\s+en)?)\s+(\d{1,3}(?:\s*(?:con|punto)\s*\d{1,2})?|(?:cien|ciento\s+\w+|[a-z]+)(?:\s+y\s+[a-z]+)?)\b(?:\s+(?:dolares|dollars|con\s+\w+))?/g)];
  for (const m of ms.reverse()) {
    const v = m[1];
    if (/^\d/.test(v)) { const n = Number(v.split(/\s/)[0]); if (n >= 5 && n < 500) return n; continue; }
    const [a, b] = v.split(/\s+y\s+/);
    const n = TEENS[a] ?? (TENS[a] != null ? TENS[a] + (b ? ONES[b] || 0 : 0) : null);
    if (n != null && n >= 5) return n;
  }
  return null;
}

// CAaf7c97: "¿a cómo tienes las quesadillas en comal?" → full unit price from the site catalog (base SKU + tortilla style), e.g. $4.50.
const PRICE_DISHES: Array<{ re: RegExp; name: string; es: string; en: string; styles?: Array<{ re: RegExp; opt: RegExp; es: string; en: string }> }> = [
  { re: /\bquesadillas?\b/, name: "Quesadilla", es: "la quesadilla", en: "the quesadilla", styles: [
    { re: /\bcomal\b|\bcomax\b|\bmaiz\b|\bhechas?\s+a\s+mano\b|homemade/, opt: /^\(QCO\)/, es: "de comal", en: "comal (homemade)" },
    { re: /\bharina\b|\bflour\b/, opt: /^\(QHR\)/, es: "de harina", en: "flour" },
    { re: /\btaquer[ao]s?\b|\bstreet\b/, opt: /^\(QST\)/, es: "taquera", en: "street" }] },
  { re: /\btacos?\b/, name: "Taco", es: "el taco", en: "the taco", styles: [
    { re: /\bcomal\b|\bmaiz\b|homemade/, opt: /^\(TCO\)/, es: "de comal", en: "comal (homemade)" },
    { re: /\bharina\b|\bflour\b/, opt: /^\(THR\)/, es: "de harina", en: "flour" },
    { re: /\btaquer[ao]s?\b|\bstreet\b/, opt: /^\(TST\)/, es: "taquero", en: "street" }] },
  { re: /\bgorditas?\b/, name: "Gordita", es: "la gordita", en: "the gordita" },
  { re: /\btortas?\b/, name: "Torta", es: "la torta", en: "the torta" },
  { re: /\bburritos?\b/, name: "Burrito", es: "el burrito", en: "the burrito" }];
const PRICE_Q = /\b(?:a\s+como|(?:que|cuanto)\s+(?:cuesta|vale|sale|cobra)n?|cuanto\s+(?:es|son)|precios?|how\s+much|price)\b/;
export function priceAnswer(text: string, lang: "es" | "en" = "es"): string | null {
  const x = nf(text);
  if (!PRICE_Q.test(x)) return null;
  const d = PRICE_DISHES.find((d) => d.re.test(x));
  if (!d) return null;
  const p = catalog().find((p: any) => String(p.name).trim().toLowerCase() === d.name.toLowerCase());
  if (!p || !p.skus?.length) return null;
  let cents = Number(p.skus[0].priceCents) || 0;
  const st = d.styles?.find((s) => s.re.test(x));
  if (st) { const c = (p.groups?.[0]?.choices || []).find((c: any) => st.opt.test(String(c.name))); if (c) cents += Number(c.priceCents) || 0; }
  const money = `$${(cents / 100).toFixed(2)}`;
  const label = lang === "en" ? `${st ? st.en + " " : ""}${d.en.replace(/^the /, "")}` : `${d.es}${st ? " " + st.es : ""}`;
  return lang === "en" ? `The ${label} is ${money}.` : `${label[0].toUpperCase() + label.slice(1)} está a ${money}.`;
}

// eesha1 (CA9724e14b637b408eb8048e12d8646967 ~5:12 PM ET Oct 29): English caller-only ledger for quesadillas (fried → QD,
// staff "deluxe?" + caller "yes" → DELUXE Preparada), steak tacos (corn/comal/flour/street; "just meat and cheese" → meat +
// Con Queso Fresco, no onion/cilantro), "rice and beans" sides and "sides of sour cream" (2oz Crema). Staff readbacks never add.
const EN_CNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6 };
const EN_MEAT: Record<string, string> = { steak: "Bistec / Steak", asada: "Bistec / Steak", bistec: "Bistec / Steak", chicken: "Pollo / Chicken", pollo: "Pollo / Chicken", pastor: "Alpastor / Roasted Pork", chorizo: "Chorizo / Mexican Sausage", carnitas: "Carnitas / Pulled Pork", rib: "Costilla / Beef Rib", costilla: "Costilla / Beef Rib", lengua: "Lengua / Beef Tongue", tongue: "Lengua / Beef Tongue", cabeza: "Cabeza / Beef Head", buche: "Buche / Pork Stomach" };
const EN_MW = Object.keys(EN_MEAT).join("|");
const EN_OTHER = /\b(?:burritos?|tortas?|sopes?|tostadas?|flautas?|menudo|nachos|tamales?|enchiladas?|gorditas?|combo|platter|drinks?|soda|coke|horchata|jamaica|chips|guac\w*|salsa)\b/;
export function callerLedgerEn(turns: Array<{ speaker: string; text: string }>): LedgerLine[] | null {
  type T = { kind: "qd" | "q" | "taco" | "rb" | "crema" | "qb" | "esq"; n: number; meat?: string; meats?: string[]; style?: "comal" | "harina" | "street"; deluxe?: boolean; cheeseOnly?: boolean; double?: boolean; flour?: boolean };
  const items: T[] = [];
  let lastStaff = "", last: T | null = null;
  const num = (w?: string) => (w ? EN_CNT[w] || 0 : 0);
  for (const t of turns) {
    const x = nf(t.text).replace(/\b(?:queso|quesa|keso)\s*[bv](?:u|i|ui)r+i?as?\b|\bquesa[bv]irrias?\b|\bquesi[bv]irrias?\b/g, "queso birrias").replace(/\b[a-z]+[ck]?[ht]orizo\b/g, "chorizo");
    if (t.speaker !== "caller") { lastStaff = x; continue; }
    if (EN_OTHER.test(x)) return null;
    // rich1: Queso Birrias (one order = 3 with consome); a repeated "the queso birrias" is the same order
    const qbm = x.match(/\b(?:(a|an|one|two|three|\d)\s+(?:orders?\s+of\s+)?)?(?:the\s+)?queso\s+birrias?\b/);
    if (qbm) {
      const ex = items.find((i) => i.kind === "qb");
      if (ex && !qbm[1]) last = ex;
      else { last = { kind: "qb", n: num(qbm[1]) || 1 }; items.push(last); }
      if (/\bflour\b/.test(x)) last.style = "harina"; else if (/\bstreet\b/.test(x)) last.style = "street"; else if (/\bcomal|homemade|corn\b/.test(x)) last.style = "comal";
    }
    // rich1: "large street corn" / "esquite" → Esquite 16oz (the only size)
    const esq = x.match(/\b(?:(a|an|one|two|three|\d)\s+)?(?:(?:large|big|small|medium)\s+)?(?:street\s+corn|esquites?|elotes?\s+en\s+vaso|corn\s+in\s+a\s+cup)\b/);
    if (esq) { items.push({ kind: "esq", n: num(esq[1]) || 1 }); }
    // staff asked flour / comal on the last qb or qd and the caller answered
    if (last && (last.kind === "qb" || last.kind === "qd") && !qbm && /\?/.test(lastStaff) || last && (last.kind === "qb" || last.kind === "qd") && !qbm && /^(?:yes\s*,?\s*)?(?:flour|comal|corn|street)\b/.test(x)) {
      if (/\bflour\b/.test(x) || /^(?:yes|yeah|yep)\b/.test(x) && /\bflour\b/.test(lastStaff) && !/\bcomal\b/.test(lastStaff)) { if (last.kind === "qb") last.style = "harina"; else last.flour = true; }
    }
    // "yes" to staff "did you want that deluxe?"
    if (/\bdeluxe\b/.test(lastStaff) && /^(?:yes|yeah|yep|sure|ok(?:ay)?)\b/.test(x) && last && (last.kind === "qd" || last.kind === "q")) { last.kind = "qd"; last.deluxe = true; }
    const q = x.match(new RegExp(String.raw`\b(?:(a|an|one|two|three|four|\d)\s+)?(fried\s+|crispy\s+)?(?:(${EN_MW})\s+)?(fried\s+)?quesadillas?(?:\s+(?:of|with)\s+(${EN_MW}))?`));
    const qdo = !q || !(q[3] || q[5]) ? x.match(/\b(?:(a|an|one|two|three|\d)\s*,?\s+)?(?:fried\s+)?quesadillas?\s+dorad[oa]s?\b|\b(a|an|one|two|three|\d)\s+qd\b/) : null;
    if (qdo) { last = { kind: "qd", n: num(qdo[1] || qdo[2]) || 1 }; if (/\bdeluxe|preparad/.test(x)) last.deluxe = true; items.push(last); }
    if (q && (q[3] || q[5]) && !qdo) { last = { kind: q[2] || q[4] ? "qd" : "q", n: num(q[1]) || 1, meat: EN_MEAT[q[3] || q[5]] }; if (/\bdeluxe\b/.test(x)) last.deluxe = true; items.push(last); }
    const tc = x.match(new RegExp(String.raw`\b(a|an|one|two|three|four|five|six|\d)\s+(${EN_MW})\s+tacos?\b|\b(a|an|one|two|three|four|five|six|\d)\s+tacos?\s+(?:of|with)\s+(${EN_MW})\b`));
    if (tc) { last = { kind: "taco", n: num(tc[1] || tc[3]) || 1, meat: EN_MEAT[tc[2] || tc[4]] }; items.push(last); }
    if (/\brice\s+and\s+beans?\b/.test(x)) {
      const m = x.match(/\b(a|an|one|two|three|four|\d)\s+(?:(?:side|order)s?\s+of\s+|of\s+(?:those|these|the)\s+)?rice\s+and\s+beans?/);
      const ex = items.find((i) => i.kind === "rb");
      if (ex) { if (m && num(m[1]) > ex.n) ex.n = num(m[1]); last = ex; }
      else { last = { kind: "rb", n: (m && num(m[1])) || 1 }; items.push(last); }
    }
    const cr = x.match(/\b(a|an|one|two|three|four|\d)\s+(?:sides?|orders?|cups?)\s+of\s+(?:sour\s+cream|crema)\b|\b(?:side|extra)\s+(?:of\s+)?(?:sour\s+cream|crema)\b/);
    if (cr) { const ex = items.find((i) => i.kind === "crema"); const n = num(cr[1]) || 1; if (ex) ex.n = Math.max(ex.n, n); else items.push({ kind: "crema", n }); }
    // rich1: "chorizo and steak on it" — up to two meats on the open QD (Q Carnes max 2)
    if (last && last.kind === "qd") {
      const ms = [...x.matchAll(new RegExp(String.raw`\b(${EN_MW})\b`, "g"))].map((m) => EN_MEAT[m[1]]).filter((v, i, a) => a.indexOf(v) === i);
      if (ms.length) { const all = [...(last.meats || (last.meat ? [last.meat] : []))]; for (const m of ms) if (!all.includes(m)) all.push(m); last.meats = all.slice(0, 2); last.meat = last.meats[0]; }
    }
    if (/\b(?:double|doble)\s+(?:the\s+)?(?:meat|carne)\b/.test(x) || /^(?:yes|yeah|yep|sure)\b/.test(x) && /\bdouble\s+meat\b/.test(lastStaff)) {
      const tgt = last && (last.kind === "qd" || last.kind === "qb" || last.kind === "taco" || last.kind === "q") ? last : null;
      if (tgt) tgt.double = true;
    }
    const taco = [...items].reverse().find((i) => i.kind === "taco");
    if (taco && last === taco || (taco && /\b(?:corn|flour|comal|street|cheese)\b/.test(x) && !q)) {
      if (taco) {
        if (/\bcorn\b|\bcomal\b/.test(x) && !/\bflour\s+(?:and|or)\s+corn\b/.test(x) || /\bcorn\s+tortillas?\b/.test(x)) taco.style = "comal";
        else if (/\bflour\b/.test(x) && !/\bcorn\b/.test(x)) taco.style = "harina";
        else if (/\bstreet\b/.test(x)) taco.style = "street";
        if (/\b(?:just|only)\s+(?:meat\s+and\s+)?cheese\b/.test(x)) taco.cheeseOnly = true;
      }
    }
  }
  if (!items.length) return null;
  const out: LedgerLine[] = [];
  for (const i of items) {
    if ((i.kind === "qd" || i.kind === "q" || i.kind === "taco") && !i.meat) return null;
    const DBL = { step: "EXTRA Carne / Meat", option: "DOUBLE Carne / Meat" };
    if (i.kind === "qb") {
      const sku = i.style === "harina" ? ["MHJN7R", "(QHR) 3 x Queso Birrias Harina / Flour con Consome/Broth"] : i.style === "street" ? ["VUBNR7", "(QST) 3 x Queso Birrias Taquera / Street con Consome/Broth"] : ["TDRF7R", "(QCO) 3 x Queso Birrias Comal / Homemade con Consome/Broth"];
      out.push({ itemId: `sq-queso-birrias-${sku[1].slice(1, 4).toLowerCase()}-${sku[0]}`, quantity: i.n, modifiers: [{ step: "(A) Queso Birrias Options", option: sku[1] }, ...(i.double ? [DBL] : [])], readback: `${i.n} Queso Birrias ${sku[1].slice(1, 4)}${i.double ? " double meat" : ""}` });
      continue;
    }
    if (i.kind === "esq") { out.push({ itemId: "sq-esquite-elvis-esquite-16oz-SGPEZK", quantity: i.n, modifiers: [{ step: "Esquite Elvis", option: "Esquite 16oz" }], readback: `${i.n} esquite 16oz` }); continue; }
    if (i.kind === "qd") out.push({ itemId: i.deluxe ? "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L" : "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: i.n, modifiers: [{ step: "(A) QD Options", option: i.deluxe ? "(QD) DELUXE Preparada" : "(QD) REGULAR Dorada" }, ...(i.meats || [i.meat!]).map((m) => ({ step: "(B) Q Carnes / Meats", option: m })), ...(i.double ? [DBL] : [])], readback: `${i.n} QD ${i.deluxe ? "DELUXE" : "REGULAR"} ${(i.meats || [i.meat!]).map((m) => m.split(" /")[0].toLowerCase()).join(" + ")}${i.double ? " double meat" : ""}${i.flour ? " harina" : ""}`, ...(i.flour ? { elviNotes: ["tortilla de harina / flour"] } : {}) });
    else if (i.kind === "q") return null; // plain quesadilla style handled by the Spanish ledger / live flow
    else if (i.kind === "taco") {
      if (!i.style) return null;
      const st = i.style === "comal" ? "(TCO) Taco Comal / Homemade (+$1.00)" : i.style === "harina" ? "(THR) Taco Harina / Flour (+$0.50)" : "(TST) Taco Taquero / Street Taco";
      const mods = [{ step: "(A) T Tortilla Options", option: st }, { step: "(B) T Carnes / Meats Opciones", option: i.meat! }];
      if (i.cheeseOnly) mods.push({ step: "(C) Con / With", option: "**Con Queso Fresco / With Cheese (+$0.50)" });
      out.push({ itemId: "sq-taco-TAR7L5", quantity: i.n, modifiers: mods, readback: `${i.n} ${st.slice(1, 4)} ${i.meat!.split(" /")[0].toLowerCase()}${i.cheeseOnly ? " solo carne + queso fresco" : ""}` });
    } else if (i.kind === "rb") out.push({ itemId: "sq-sides-arroz-rice-and-frijole-beans-I5HNHW", quantity: i.n, modifiers: [{ step: "Sides options", option: "Arroz-Rice and Frijole-Beans" }], readback: `${i.n} side arroz y frijoles` });
    else out.push({ itemId: "sq-extras-crema-sour-cream-2oz-KL2XTU", quantity: i.n, modifiers: [{ step: "Extras options", option: "Crema / Sour Cream 2oz" }], readback: `${i.n} side crema 2oz` });
  }
  return out;
}
