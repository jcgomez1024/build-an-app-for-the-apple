// pancho1 (CAf6657ca96ab5a47427631b6550d10d45 ~1:54 PM ET Oct 29): a caller-only ledger for quesadilla/gordita calls.
// Staff option lists ("de maíz en el comal, de harina o doradas"), confirmations ("una de costilla con frijoles") and the
// final readback never add items; only caller counts do. "<meat> con frijoles" is the paid add-on, never a frijol filling.
// The shadow end-pass uses the ledger only when it prices to the staff's spoken total and the live cart does not.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type LedgerLine = { itemId: string; quantity: number; modifiers: Array<{ step: string; option: string }>; readback: string };
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
