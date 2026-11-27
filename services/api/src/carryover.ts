// Each dish keeps only the style and meat the caller gave it.
// A tortilla style or a meat said for one dish must not ride onto the next dish.
// "igual", "también", "lo mismo", and "todas" are the only reasons a style or a meat repeats.
// "X con Y" stays one line. "una de X y una de Y" stays two lines.
// A staff style question is not the style. A yes answers one stated style. It does not answer a choice,
// and it does not override a style the caller already stated. An unanswered guess is not the style.
// Plain tortillas stay comal. "chicos" or "los normales" change a taco only, because that family has the small shell.
// A dorada stays dorada (regular or deluxe as said). A comal quesadilla stays comal.
// "con frijoles" stays on the items it was said for.
// An opening total is not the first meat's quantity when per-meat counts follow.
// A repeated count of the same line stays the count. "otra" / "otras N" adds.

import { staffUnavailable } from "./spoken-ledger.js";

type Turn = { speaker?: string; text?: string };
type Kind = "taco" | "quesadilla" | "qd" | "gordita" | "torta" | "burrito";
type Style = "" | "comal" | "harina" | "taquero";
type Qd = "" | "regular" | "preparada";
export type Want = {
  kind: Kind; meats: string[]; n: number; style: Style; qd: Qd;
  frij: boolean; xqueso: boolean; deluxe: boolean; aparte: boolean;
  queso: boolean; grande: boolean; todo: boolean; fried: boolean;
};

const plain = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const numOf = (w: string) => Number(w) || NUM[w] || 0;
const NUMW = "\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten|twelve";
const PREP = /\b(?:preparadas?|deluxe|con todo|de todo|with everything|everything on)\b/;
const REGU = /\b(?:regulares?|normales?|sencillas?)\b/;
const MEATS: Array<[RegExp, string]> = [
  [/\bbistec?k?\b|\bsteak\b|\basada\b/, "bistec"], [/\b(?:al )?pastor\b/, "alpastor"], [/\bcostillas?\b/, "costilla"],
  [/\btripas?\b/, "tripa"], [/\bcabezas?\b/, "cabeza"], [/\bprensados?\b/, "prensado"], [/\blenguas?\b/, "lengua"],
  [/\bchorizo\b/, "chorizo"], [/\bpollo\b|\bchicken\b/, "pollo"], [/\bcarnitas\b/, "carnitas"],
  [/\bbuches?\b/, "buche"], [/\bbirrias?\b/, "birria"], [/\bdeshebradas?\b/, "deshebrada"], [/\bpicadillo\b/, "picadillo"],
  [/\bduros?\b/, "duro"], [/\bnopales\b/, "nopales"], [/\bhuevos?\b/, "huevo"],
];

export function hearOrder(text: string): string {
  let s = String(text || "");
  s = s.replace(/\bde\s+viste(?!\p{L})/giu, "de bistec");
  s = s.replace(/\bviste(?!\p{L})/giu, "bistec");
  s = s.replace(/\bvit[eé]z?(?!\p{L})/giu, "bistec");
  s = s.replace(/\bbizco\b/giu, "bistec");
  s = s.replace(/\btaquitos\b/giu, "tacos taqueros");
  s = s.replace(/\b(quesadillas?)\s+fried\b|\bfried\s+(quesadillas?)\b/giu, "$1 en aceite");
  s = s.replace(/\bdeep\s+fried\b/giu, "en aceite");
  s = s.replace(/\bdurad[ao]s?\b/giu, "doradas");
  s = s.replace(/\b(?:de|del)\s+comas\b/giu, "de comal");
  s = s.replace(/\bde\s+harin\b/giu, "de harina");
  s = s.replace(/\bquesitortas?\b/giu, "queso torta");
  s = s.replace(/\bchicharr[oó]n\s+(prensado|duro)\b/giu, "$1");
  s = s.replace(/\bpapas\s+con\s+nopales\b|\bnopales\s+con\s+papas\b/giu, "nopales");
  s = s.replace(/\bhuevo\s+con\s+chile\b/giu, "huevo");
  return plain(s);
}
function meatHits(text: string): string[] {
  const p = hearOrder(text).replace(/\bcon\s+frijoles\b/g, " ").replace(/\b(?:sin|no|without)\s+frijoles\b/g, " ");
  const out: Array<{ at: number; meat: string }> = [];
  for (const [re, key] of MEATS) {
    const r = new RegExp(re.source, "g");
    for (const m of p.matchAll(r)) if (!out.some((x) => x.meat === key)) out.push({ at: m.index || 0, meat: key });
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.meat).slice(0, 2);
}
function kindIn(text: string): Kind | null {
  const p = hearOrder(text);
  if (/\bqueso\s+gorditas?\b|\bgorditas?\b/.test(p)) return "gordita";
  if (/\bquesadillas?\b/.test(p)) return "quesadilla";
  if (/\btacos?\b/.test(p)) return "taco";
  if (/\bqueso\s+tortas?\b|\btortas?\b/.test(p)) return "torta";
  if (/\bburritos?\b/.test(p)) return "burrito";
  return null;
}
function friedWord(text: string): boolean {
  return /\b(?:doradas?|doraditas?|en aceite|de aceite|fritas?|fried)\b/.test(hearOrder(text));
}
function styleIn(text: string, kind: Kind | null): Style {
  const p = hearOrder(text);
  if (/\bharina\b|\bflour\b/.test(p)) return "harina";
  if (/\bcomal\b|\bhomemade\b|\bhecha a mano\b|\bde maiz\b|\btortilla de maiz\b/.test(p)) return "comal";
  if (/\btaquer|\bstreet\b/.test(p)) return "taquero";
  if (kind === "taco" && /\bchicos\b|\blos normales\b|\btortilla normal\b/.test(p)) return "taquero";
  if ((kind === "taco" || kind === "quesadilla") && /\bde la grande\b|\btortilla grande\b/.test(p)) return "comal";
  return "";
}
function bareYes(text: string): boolean {
  return /^(?:si|uju|ujum|aja|ok|okay|claro|yes|yeah|yep|eso|sale|va|correcto|exacto)(?:\s+(?:senor|senora|gracias|por favor|buddy|sir|please))?$/.test(hearOrder(text));
}
function choiceQuestion(raw: string): boolean {
  const s = hearOrder(raw);
  const styles = [/\bcomal\b/.test(s), /\bharina\b|\bflour\b/.test(s), /\btaquer|\bstreet\b/.test(s), /\bdorad|\baceite\b/.test(s)].filter(Boolean).length;
  if (styles >= 2) return true;
  return REGU.test(s) && PREP.test(s);
}
function priceInquiry(text: string, nextStaff: string): boolean {
  const p = hearOrder(text);
  const staff = hearOrder(nextStaff);
  if (/\b(?:a como|cuanto cuest|cuanto son|cuanto val|how much)\b/.test(p) && !/\b(?:me pone|ponme)\b/.test(p)) return true;
  return /\b(?:cincuenta|dolares|dollars)\b/.test(staff) && !/\b(?:me pone|ponme|entonces)\b/.test(p);
}
function sameMeats(a: string[], b: string[]): boolean {
  return [...a].sort().join() === [...b].sort().join();
}
type Ctx = { kind: Kind | null; style: Style; fried: boolean; qd: Qd; queso: boolean; frij: boolean; xqueso: boolean; deluxe: boolean; aparte: boolean; grande: boolean; todo: boolean };
type Hold = Ctx & { n: number };

function segments(text: string): string[] {
  const re = new RegExp(`\\b(${NUMW})\\b`, "g");
  const hits = [...hearOrder(text).matchAll(re)];
  if (!hits.length) return [hearOrder(text)];
  return hits.map((h, i) => hearOrder(text).slice(h.index || 0, hits[i + 1]?.index ?? hearOrder(text).length).trim());
}

/** What the caller assigned to each dish. */
export function carryoverWants(turns: Turn[]): Want[] {
  const wants: Want[] = [];
  let ctx: Ctx = { kind: null, style: "", fried: false, qd: "", queso: false, frij: false, xqueso: false, deluxe: false, aparte: false, grande: false, todo: false };
  let hold: Hold | null = null;
  let pendingCount: { n: number; meats: string[] } | null = null;
  const find = (w: Want) => wants.find((x) => x.kind === w.kind && sameMeats(x.meats, w.meats) && x.style === w.style && x.qd === w.qd && x.queso === w.queso && x.grande === w.grande);
  const put = (w: Want, mode: "add" | "max") => {
    if (!w.n || w.n > 24 || !w.meats.length) return;
    const hit = find(w);
    if (!hit) wants.push({ ...w, meats: [...w.meats] });
    else if (mode === "add") hit.n += w.n;
    else hit.n = Math.max(hit.n, w.n);
    if (hit || wants.length) {
      const row = hit || wants[wants.length - 1];
      row.frij = row.frij || w.frij;
      row.xqueso = row.xqueso || w.xqueso;
      row.deluxe = row.deluxe || w.deluxe;
      row.aparte = row.aparte || w.aparte;
      row.todo = row.todo || w.todo;
      row.fried = row.fried || w.fried;
      if (w.qd === "preparada") row.qd = "preparada";
      if (w.qd === "regular" && row.qd !== "preparada") row.qd = "regular";
    }
  };
  const resolvedKind = (dish: Kind | null, seg: string, ownStyle: Style): Kind | null => {
    const kind = dish || ctx.kind;
    if (!kind) return null;
    // A quesadilla is the dorada only when this dish was named fried. An unstated shell is not guessed.
    if (kind === "quesadilla" && !ownStyle && (friedWord(seg) || ctx.fried)) return "qd";
    return kind;
  };

  const list = turns || [];
  for (let i = 0; i < list.length; i++) {
    const turn = list[i];
    if (turn.speaker && turn.speaker !== "caller") continue;
    const raw = String(turn.text || "");
    const nextStaff = String(list.slice(i + 1).find((t) => t.speaker === "staff")?.text || "");
    const prevStaffRaw = String([...list.slice(0, i)].reverse().find((t) => t.speaker === "staff")?.text || "");
    const text = hearOrder(raw);
    if (!text) continue;
    if (/^(?:tendras|tienes|tiene|hay|do you have)\b/.test(text) && !/\b(?:me pone|ponme|quiero|dame|deme)\b/.test(text)) continue;
    if (priceInquiry(raw, nextStaff)) {
      const k = kindIn(text);
      const st = styleIn(text, k);
      if (k && k !== ctx.kind) { ctx = { ...ctx, kind: k, style: st, fried: friedWord(text), frij: false, xqueso: false }; }
      else { if (st) ctx.style = st; if (friedWord(text)) ctx.fried = true; if (k) ctx.kind = k; }
      continue;
    }
    if (bareYes(text)) {
      const staff = hearOrder(prevStaffRaw);
      if (!staff || choiceQuestion(prevStaffRaw)) continue;
      const st = styleIn(staff, ctx.kind);
      if (st && ctx.style && st !== ctx.style) continue;
      if (st && !friedWord(staff)) {
        ctx.style = st;
        ctx.fried = false;
        for (const w of wants) if (!w.fried && (w.kind === "qd" || (w.kind === "quesadilla" && !w.style))) { w.kind = "quesadilla"; w.style = st; w.qd = ""; }
      }
      if (friedWord(staff)) ctx.fried = true;
      if (PREP.test(staff) && !REGU.test(staff)) {
        ctx.qd = "preparada";
        for (const w of wants) if (w.kind === "qd" && w.qd !== "regular") w.qd = "preparada";
        for (const w of wants) if (w.kind === "gordita") w.deluxe = true;
      }
      if (REGU.test(staff) && !PREP.test(staff)) {
        ctx.qd = "regular";
        for (const w of wants) if (w.kind === "qd") w.qd = "regular";
      }
      const meats = meatHits(staff);
      const k = kindIn(staff) || ctx.kind;
      const n = numOf((staff.match(new RegExp(`\\b(${NUMW})\\b`)) || [])[1] || "") || hold?.n || 0;
      if (k && meats.length && n && !wants.some((w) => (w.kind === k || (k === "quesadilla" && w.kind === "qd")) && sameMeats(w.meats, meats))) {
        const kind = k === "quesadilla" && (ctx.fried || friedWord(staff)) ? "qd" : k === "quesadilla" && !st && !ctx.style ? "qd" : k;
        put({ kind, meats, n, style: kind === "qd" ? "" : (st || ctx.style), qd: kind === "qd" ? ctx.qd : "", frij: /\bcon frijoles\b|\bfrijoles con\b/.test(staff), xqueso: ctx.xqueso, deluxe: ctx.deluxe || ctx.qd === "preparada", aparte: ctx.aparte, queso: ctx.queso, grande: ctx.grande, todo: ctx.todo, fried: kind === "qd" }, "max");
      }
      continue;
    }
    if (/^(?:no|nel)\b/.test(text) && REGU.test(text) && !PREP.test(text)) {
      ctx.qd = "regular";
      const recent = [...wants].reverse().find((w) => w.kind === "qd");
      if (recent) recent.qd = "regular";
      continue;
    }
    if (/\btodas con frijoles\b|\btodos con frijoles\b/.test(text)) {
      const ex = /\bmenos\b/.test(text) ? meatHits(text.replace(/\bcon frijoles\b/g, " ")) : [];
      for (const w of wants) if (w.kind === "qd" || w.kind === "quesadilla" || w.kind === ctx.kind) w.frij = !(ex.length && w.meats.some((m) => ex.includes(m)));
      continue;
    }
    const inherit = /\bigual\b|\blo mismo\b|\btodas\b|\btodos\b|\btodo de\b/.test(text);
    const tambien = /\btambien\b/.test(text);
    if ((inherit || tambien) && meatHits(text).length === 1 && !kindIn(text) && !new RegExp(`\\b(?:${NUMW})\\b`).test(text)) {
      const meat = meatHits(text)[0];
      for (const w of wants) if (!w.meats.length || (inherit && w.kind === ctx.kind)) if (!w.meats.length) w.meats = [meat];
      if (hold) finishHold(hold, put, [meat], "", false);
      hold = null;
      continue;
    }
    const otras = text.match(new RegExp(`\\botr[ao]s?\\s+(${NUMW})\\b`));
    if (otras) {
      const n = numOf(otras[1]);
      const tail = text.slice((otras.index || 0) + otras[0].length);
      const src = [...wants].reverse().find((w) => w.kind === ctx.kind || w.kind === "qd" || w.kind === "quesadilla") || wants[wants.length - 1];
      if (src && n) {
        const meat = meatHits(tail)[0] || (tambien || inherit ? src.meats[0] : src.meats[0]);
        const qd: Qd = PREP.test(tail) && !REGU.test(tail) ? "preparada" : REGU.test(tail) ? "regular" : src.qd;
        const st = styleIn(tail, src.kind);
        const kind: Kind = friedWord(tail) || (src.kind === "qd" && !st) ? "qd" : st && src.kind === "qd" ? "quesadilla" : src.kind;
        put({ ...src, kind, meats: meat ? [meat] : src.meats, n, qd: kind === "qd" ? qd : "", style: kind === "qd" ? "" : (st || src.style), frij: /\bcon frijoles\b|\bfrijoles con\b/.test(tail) ? true : src.frij, fried: kind === "qd" && (src.fried || friedWord(tail)) }, "add");
        hold = null;
        continue;
      }
    }

    const born: Want[] = [];
    let opening: Hold | null = null;
    for (const seg of segments(text)) {
      const n = numOf((seg.match(new RegExp(`^(${NUMW})\\b`)) || [])[1] || "");
      const dish = kindIn(seg);
      const own = styleIn(seg, dish || ctx.kind);
      const meats = meatHits(seg);
      if (dish && dish !== ctx.kind && !inherit && !tambien) {
        ctx = { ...ctx, kind: dish, style: own, fried: friedWord(seg), frij: false, xqueso: false, qd: "", deluxe: false, aparte: false };
      }
      if (dish) ctx.kind = dish;
      if (own) ctx.style = own;
      if (friedWord(seg)) ctx.fried = true;
      const prep = PREP.test(text) && !REGU.test(text) && ctx.kind !== "burrito";
      const regular = REGU.test(seg) && !prep;
      if (prep && ctx.kind !== "burrito") ctx.qd = "preparada";
      if (regular) ctx.qd = "regular";
      if (/\bcon queso\b|\bqueso gordita\b/.test(seg) && ctx.kind === "gordita" && !/\bsin queso\b/.test(seg)) ctx.queso = true;
      if (/\bqueso torta\b/.test(seg)) ctx.queso = true;
      if (ctx.kind === "burrito" && /\bgrandes?\b|\blarge\b/.test(seg)) ctx.grande = true;
      if (ctx.kind === "burrito" && /\bcon todo\b|\bwith everything\b|\beverything on\b/.test(seg)) ctx.todo = true;
      if (ctx.kind === "gordita" && prep) ctx.deluxe = true;
      const frij = /\bcon frijoles\b|\bfrijoles con\b/.test(seg);
      const xqueso = /\bextra queso\b/.test(seg);
      const aparte = /\b(?:verduras?|lechuga|toppings|everything|todo)\b(?:[^.]{0,40})aparte\b|\baparte\b(?:[^.]{0,24})(?:verduras?|lechuga)|\bon the side\b/.test(seg);
      if (!n) {
        if (own && !friedWord(seg)) {
          ctx.style = own; ctx.fried = false;
          const row = [...wants].reverse().find((w) => !w.fried && (w.kind === "qd" || w.kind === "quesadilla" || w.kind === "taco"));
          if (row?.kind === "qd" || (row && !row.style)) { if (row) { row.kind = row.kind === "taco" ? "taco" : "quesadilla"; row.style = own; row.qd = ""; row.fried = false; } }
        }
        if (prep && ctx.kind !== "burrito") { const row = [...wants].reverse().find((w) => w.kind === "qd" || w.kind === "gordita"); if (row?.kind === "qd") row.qd = "preparada"; if (row?.kind === "gordita") row.deluxe = true; ctx.qd = "preparada"; ctx.deluxe = true; }
        if (regular && !/\btaco\b/.test(seg)) { const row = [...wants].reverse().find((w) => w.kind === "qd"); if (row) row.qd = "regular"; ctx.qd = "regular"; }
        if (meats.length && hold) { finishHold(hold, put, meats, own, friedWord(seg)); hold = null; if (frij) { const row = wants[wants.length - 1]; if (row) row.frij = true; } }
        if (/\bcon todo\b|\bwith everything\b|\beverything on\b/.test(seg)) for (const w of wants) if (w.kind === "burrito") w.todo = true;
        if (pendingCount && (dish || ctx.kind)) {
          const kind = resolvedKind(dish, seg, own) || ctx.kind;
          if (kind) put({ kind, meats: pendingCount.meats, n: pendingCount.n, style: kind === "qd" ? "" : (own || ctx.style), qd: kind === "qd" ? (prep ? "preparada" : ctx.qd) : "", frij, xqueso, deluxe: prep, aparte, queso: ctx.queso, grande: ctx.grande, todo: ctx.kind === "burrito" && /\bcon todo\b|\bwith everything\b/.test(text), fried: kind === "qd" }, "max");
          pendingCount = null;
        }
        continue;
      }
      if (n && meats.length && !dish && !ctx.kind) pendingCount = { n, meats };
      const kind = resolvedKind(dish, seg, own);
      if (!kind) continue;
      if (!meats.length) { opening = { ...ctx, kind: dish || ctx.kind, n, style: own || ctx.style, fried: friedWord(seg) || ctx.fried, qd: ctx.qd }; pendingCount = null; continue; }
      pendingCount = null;
      const style = kind === "qd" ? "" : (own || (dish && dish !== "quesadilla" ? "" : ctx.style));
      const tacoStyle: Style = kind === "taco" && !style && /\bchicos\b|\blos normales\b|\btortilla normal\b/.test(seg) ? "taquero" : style;
      born.push({
        kind, meats, n, style: kind === "taco" ? (own || tacoStyle || (dish ? "" : ctx.style)) : kind === "qd" ? "" : (own || (dish ? ctx.style : ctx.style)),
        qd: kind === "qd" ? (prep ? "preparada" : regular ? "regular" : ctx.qd) : "",
        frij, xqueso, deluxe: kind === "gordita" ? prep || ctx.deluxe : prep,
        aparte, queso: (kind === "gordita" && ctx.queso && !/\bsin queso\b/.test(seg)) || (kind === "torta" && /\bqueso torta\b/.test(seg)),
        grande: kind === "burrito" && (/\bgrandes?\b|\blarge\b/.test(seg) || ctx.grande),
        todo: kind === "burrito" && (/\bcon todo\b|\bwith everything\b|\beverything on\b/.test(seg) || ctx.todo),
        fried: kind === "qd" && (friedWord(seg) || ctx.fried),
      });
    }
    const budget = opening || hold;
    const bornSum = born.reduce((s, w) => s + w.n, 0);
    const filling = !!budget && !!born.length && budget.kind === (born[0].kind === "qd" ? "quesadilla" : born[0].kind) && (bornSum === budget.n || (born.length >= 2 && bornSum <= budget.n));
    if (filling) hold = null;
    else if (opening && !born.length) hold = opening;
    else hold = null;
    for (const w of born) put(w, filling || /\botr[ao]\b|\bademas\b|\bmas\b/.test(text) ? "add" : "max");
    if (/\bsin queso\b/.test(text)) for (const w of born) if (w.kind === "gordita") w.queso = false;
    if (/\bcon queso\b|\bponer queso\b|\bque si gordita\b/.test(text) && !/\bsin queso\b/.test(text) && (ctx.kind === "gordita" || kindIn(text) === "gordita")) for (const w of wants) if (w.kind === "gordita") w.queso = true;
  }
  return wants.filter((w) => w.meats.length && w.n > 0);
}

function finishHold(hold: Hold, put: (w: Want, mode: "add" | "max") => void, meats: string[], style: Style, friedNow: boolean) {
  const useStyle = style || hold.style;
  const useFried = (friedNow || hold.fried) && !useStyle;
  const kind: Kind = hold.kind === "quesadilla" && useFried ? "qd" : (hold.kind || "quesadilla");
  put({ kind, meats, n: hold.n, style: kind === "qd" ? "" : useStyle, qd: kind === "qd" ? hold.qd : "", frij: hold.frij, xqueso: hold.xqueso, deluxe: hold.deluxe, aparte: hold.aparte, queso: hold.queso, grande: hold.grande, todo: hold.todo, fried: kind === "qd" }, "max");
}

const oname = (o: any) => typeof o === "string" ? o : String(o?.name || "");
function lineKind(id: string): Kind | null {
  if (/^sq-qd-/.test(id)) return "qd";
  if (/^sq-quesadilla-/.test(id)) return "quesadilla";
  if (/^sq-taco-/.test(id)) return "taco";
  if (/^sq-gordita-/.test(id)) return "gordita";
  if (/^sq-torta-/.test(id)) return "torta";
  if (/^sq-burrito-/.test(id)) return "burrito";
  return null;
}
function lineMeats(line: any): string[] {
  const out: string[] = [];
  for (const m of line?.modifiers || []) {
    if (!/carne|meat/i.test(String(m.step || ""))) continue;
    for (const k of meatHits(String(m.option || ""))) if (!out.includes(k)) out.push(k);
  }
  return out;
}
function optionNamed(item: any, groupRe: RegExp, pick: (name: string) => boolean): { step: string; option: string } | null {
  for (const g of item?.modifierGroups || []) {
    if (!groupRe.test(String(g.name || ""))) continue;
    const name = (g.options || []).map(oname).find(pick);
    if (name) return { step: String(g.name), option: name };
  }
  return null;
}
const QD_DLX = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const QD_REG = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
const TOR12 = "sq-tortillas-12-x-tortilla-comal-handmade-VGID3H";
const TOR6 = "sq-tortillas-6-x-tortilla-comal-handmade-YQG6N4";

function hostFor(menu: any[], w: Want): any | null {
  if (w.kind === "qd") return (menu || []).find((m) => m.id === (w.qd === "preparada" || w.deluxe || w.aparte ? QD_DLX : QD_REG)) || null;
  return (menu || []).find((m) => lineKind(String(m.id)) === w.kind) || null;
}
function buildLine(w: Want, menu: any[]): any | null {
  const host = hostFor(menu, w);
  if (!host) return null;
  const mods: Array<{ step: string; option: string }> = [];
  if (w.kind === "taco" || w.kind === "quesadilla") {
    if (!w.style) return null;
    const code = w.kind === "taco" ? (w.style === "harina" ? "THR" : w.style === "taquero" ? "TST" : "TCO") : (w.style === "harina" ? "QHR" : w.style === "taquero" ? "QST" : "QCO");
    const g = optionNamed(host, /tortilla options/i, (n) => n.includes(`(${code})`));
    if (!g) return null;
    mods.push(g);
  }
  if (w.kind === "gordita") {
    const g = optionNamed(host, /gordita options/i, (n) => w.queso ? /\(QGD\)/.test(n) : /^\(GD\)/.test(n));
    if (g) mods.push(g);
    if (w.deluxe) { const d = optionNamed(host, /deluxe/i, (n) => /^DELUXE \(Lechuga/i.test(n)); if (d) mods.push(d); }
  }
  if (w.kind === "torta") {
    const g = optionNamed(host, /torta options/i, (n) => w.queso ? /\(QTO\)/.test(n) : /^\(TO\)/.test(n));
    if (g) mods.push(g);
  }
  if (w.kind === "burrito") {
    const g = optionNamed(host, /size/i, (n) => w.grande ? /Grande/i.test(n) : /Regular/i.test(n));
    if (g) mods.push(g);
    if (w.todo) {
      const crema = optionNamed(host, /^\(C\)/i, (n) => /^Crema\b/i.test(n));
      const queso = optionNamed(host, /^\(C\)/i, (n) => /^Queso Fresco\b/i.test(n));
      if (crema) mods.push(crema);
      if (queso) mods.push(queso);
    }
  }
  if (w.kind === "qd") mods.push({ step: "(QD) Style", option: w.qd === "preparada" || w.deluxe || w.aparte ? "(QD) DELUXE Preparada" : "(QD) REGULAR Dorada" });
  for (const meat of w.meats) {
    const g = optionNamed(host, /carne|meat/i, (n) => meatHits(n).includes(meat));
    if (!g) return null;
    mods.push(g);
  }
  if (w.frij) { const g = optionNamed(host, /con\s*\/\s*with/i, (n) => /^\*\*Con Frijoles/i.test(n)); if (g) mods.push(g); }
  if (w.xqueso) { const g = optionNamed(host, /con\s*\/\s*with/i, (n) => /EXTRA Queso Derretido/i.test(n)); if (g) mods.push(g); }
  if (w.aparte && w.kind === "qd") mods.push({ step: "(QD) Side", option: "DELUXE ***APARTE / EVERTHING ON SIDE*** (+$1.50)" });
  const id = w.kind === "qd" ? (w.qd === "preparada" || w.deluxe || w.aparte ? QD_DLX : QD_REG) : host.id;
  return { itemId: id, quantity: w.n, modifiers: mods, readback: `${w.n} ${w.kind} ${w.meats.join(" ")}`.trim() };
}
function ensureMod(line: any, mod: { step: string; option: string } | null): boolean {
  if (!mod) return false;
  const mods = line.modifiers || [];
  if (mods.some((m: any) => m.option === mod.option)) return false;
  if (/tortilla options/i.test(mod.step)) line.modifiers = mods.filter((m: any) => !/tortilla options/i.test(String(m.step)) && !/\((?:QCO|QHR|QST|TCO|THR|TST)\)/.test(String(m.option)));
  line.modifiers = [...(line.modifiers || []), mod];
  return true;
}

function plainTortillas(cart: any[], turns: Turn[]): boolean {
  const caller = (turns || []).filter((t) => !t.speaker || t.speaker === "caller").map((t) => hearOrder(String(t.text || ""))).join(" | ");
  if (!/\b(?:docena|dieciocho|doce y seis)\b/.test(caller) || !/\btortillas?\b/.test(caller)) return false;
  if (/\bharina\b|\bflour\b|\btaquer|\bstreet\b/.test(caller)) return false;
  let changed = false;
  for (const line of cart) {
    const id = String(line?.itemId || "");
    if (/^sq-tortillas-/.test(id) && /harina|taquera|street/.test(id)) { line.itemId = /-12-/.test(id) ? TOR12 : TOR6; changed = true; }
  }
  const has = (id: string) => cart.some((l) => l.itemId === id);
  if (!has(TOR12)) { cart.push({ itemId: TOR12, quantity: 1, modifiers: [], readback: "12 tortillas comal" }); changed = true; }
  if (/\bdocena y media\b|\buna y media\b|\bdoce y seis\b|\bdieciocho\b/.test(caller) && !has(TOR6)) {
    cart.push({ itemId: TOR6, quantity: 1, modifiers: [], readback: "6 tortillas comal" }); changed = true;
  }
  return changed;
}
function cebollaSide(cart: any[], turns: Turn[], menu: any[]): boolean {
  const caller = (turns || []).filter((t) => !t.speaker || t.speaker === "caller").map((t) => hearOrder(String(t.text || ""))).join(" | ");
  if (!/\bcebollitas? asad|\bcebollas? asad|\bpeppers and onions\b|\bchilitos asad/.test(caller)) return false;
  const ex = (menu || []).find((m) => /^sq-extras-cebolla-y-chiles-asados/.test(String(m.id)));
  if (!ex) return false;
  if (cart.some((l) => /^sq-extras-cebolla-y-chiles-asados/.test(String(l.itemId)))) return false;
  const m = caller.match(new RegExp(`\\b(${NUMW})\\s+(?:orders?|ordenes|paquet(?:it)?os)\\s+(?:of\\s+)?(?:the\\s+)?(?:peppers|cebolla|chiles)`));
  cart.push({ itemId: ex.id, quantity: m ? numOf(m[1]) || 1 : 1, modifiers: [], readback: "cebolla y chiles asados" });
  return true;
}

/** Correct a carried style or meat, and add a line only when that dish and meat are still missing. */
export function applyCarryover(cart: any[], turns: Turn[], menu: any[]): boolean {
  if (!Array.isArray(cart) || !Array.isArray(turns) || !Array.isArray(menu)) return false;
  let changed = plainTortillas(cart, turns) || cebollaSide(cart, turns, menu);
  if (cart.some((l) => /^sq-combo-quesadillas/.test(String(l?.itemId || "")))) return changed;
  const unavailable = staffUnavailable(turns as any).join(" ");
  const wants = carryoverWants(turns).filter((w) => !(unavailable && new RegExp(`\\b${w.kind}`).test(unavailable)));
  const lines = () => cart.filter((l) => lineKind(String(l?.itemId || "")));
  for (const w of wants) {
    const allSame = lines().filter((l) => lineKind(String(l.itemId)) === w.kind && sameMeats(lineMeats(l), w.meats));
    const variety = (l: any) => w.kind !== "qd" || !w.qd || (w.qd === "preparada" ? /deluxe|preparada/i.test(String(l.itemId)) : !/deluxe|preparada/i.test(String(l.itemId)));
    const otherWanted = w.kind === "qd" && !!w.qd && wants.some((o) => o !== w && o.kind === "qd" && sameMeats(o.meats, w.meats) && !!o.qd && o.qd !== w.qd);
    const same = otherWanted ? allSame.filter(variety) : allSame;
    const have = same.reduce((s, l) => s + (Number(l.quantity) || 1), 0);
    for (const line of same) {
      if (w.kind === "qd" && w.qd === "preparada") {
        const deluxeAlready = /deluxe|preparada/i.test(String(line.itemId)) || (line.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(String(m.option)));
        const already = same.filter((l) => /deluxe|preparada/i.test(String(l.itemId))).reduce((s, l) => s + (Number(l.quantity) || 1), 0);
        if (!otherWanted && !deluxeAlready && already < w.n) {
          line.itemId = QD_DLX;
          line.modifiers = (line.modifiers || []).filter((m: any) => !/\(QD\)/i.test(String(m.option)));
          line.modifiers.unshift({ step: "(QD) Style", option: "(QD) DELUXE Preparada" });
          changed = true;
        }
      }
      const host = hostFor(menu, w);
      if (w.frij && ensureMod(line, optionNamed(host, /con\s*\/\s*with/i, (n) => /^\*\*Con Frijoles/i.test(n)))) changed = true;
      if (w.xqueso && ensureMod(line, optionNamed(host, /con\s*\/\s*with/i, (n) => /EXTRA Queso Derretido/i.test(n)))) changed = true;
      if (w.kind === "gordita" && w.queso && ensureMod(line, optionNamed(host, /gordita options/i, (n) => /\(QGD\)/.test(n)))) changed = true;
      if (w.kind === "gordita" && w.deluxe && ensureMod(line, optionNamed(host, /deluxe/i, (n) => /^DELUXE \(Lechuga/i.test(n)))) changed = true;
      if (w.kind === "torta" && w.queso && ensureMod(line, optionNamed(host, /torta options/i, (n) => /\(QTO\)/.test(n)))) changed = true;
      if (w.aparte && w.kind === "qd" && ensureMod(line, { step: "(QD) Side", option: "DELUXE ***APARTE / EVERTHING ON SIDE*** (+$1.50)" })) changed = true;
      if (w.kind === "burrito" && w.grande && ensureMod(line, optionNamed(host, /size/i, (n) => /Grande/i.test(n)))) changed = true;
      if (w.kind === "burrito" && w.todo) {
        if (ensureMod(line, optionNamed(host, /^\(C\)/i, (n) => /^Crema\b/i.test(n)))) changed = true;
        if (ensureMod(line, optionNamed(host, /^\(C\)/i, (n) => /^Queso Fresco\b/i.test(n)))) changed = true;
      }
    }
    if (have >= w.n || !otherWanted || allSame.length === same.length) continue;
    const familyNow = lines().filter((l) => lineKind(String(l.itemId)) === w.kind).reduce((s, l) => s + (Number(l.quantity) || 1), 0);
    const familyWant = wants.filter((x) => x.kind === w.kind).reduce((s, x) => s + x.n, 0);
    if (familyNow >= familyWant) continue;
    const line = buildLine({ ...w, n: Math.min(w.n - have, familyWant - familyNow) }, menu);
    if (!line) continue;
    cart.push(line);
    changed = true;
  }
  return changed;
}
