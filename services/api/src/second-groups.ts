// A later group must stay on the cart. "Otra orden", "otras N", "y para…", and
// "N de X y M de Y" add. They must not replace an earlier group or collapse into one line.
// A count said before a style question stays once the question is answered.
// A soup or side named at the end stays even when the main items were read back first.
// Nothing here removes a line. A short count is only raised.

import { isAvailQ, staffUnavailable } from "./spoken-ledger.js";

type Turn = { speaker?: string; text?: string };
type Kind = "taco" | "quesadilla" | "qd" | "gordita" | "torta" | "burrito" | "pozole" | "menudo" | "esquite";
type Style = "" | "comal" | "harina" | "taquero";
type Part = { kind: Kind; meat: string; style: Style; qd: "" | "preparada" | "regular"; queso: boolean; frij: boolean; n: number; explicit: boolean; added: number };

const plain = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const numOf = (w: string) => Number(w) || NUM[w] || 0;
const NUMW = "\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six";
const MEATS: Array<[RegExp, string]> = [
  [/\bbistec?k?\b|\bsteak\b|\basada\b/, "bistec"], [/\b(?:al )?pastor\b/, "alpastor"], [/\bcostillas?\b/, "costilla"],
  [/\btripas?\b/, "tripa"], [/\bcabezas?\b/, "cabeza"], [/\bprensado\b/, "prensado"], [/\blenguas?\b/, "lengua"],
  [/\bchorizo\b/, "chorizo"], [/\bpollo\b|\bchicken\b/, "pollo"], [/\bcarnitas\b|\bcarnitas?\b/, "carnitas"],
  [/\bbuches?\b/, "buche"], [/\bbirrias?\b/, "birria"], [/\bdeshebrada\b/, "deshebrada"], [/\bpicadillo\b/, "picadillo"],
  [/\bduros?\b|\bchicharron\b/, "duro"], [/\bnopales\b/, "nopales"], [/\bhuevo\b/, "huevo"],
];
const DISH: Array<[RegExp, Kind]> = [
  [/\bqueso\s+gorditas?\b|\bgorditas?\s+(?:de\s+|con\s+)?queso\b|\bgorditas?\b/, "gordita"],
  [/\bquesadillas?\b/, "quesadilla"], [/\btacos?\b/, "taco"], [/\btortas?\b/, "torta"], [/\bburritos?\b/, "burrito"],
  [/\bpo[sz]oles?\b/, "pozole"], [/\bmenudos?\b/, "menudo"], [/\besquites?\b/, "esquite"],
];
const PERSON_STOP = new Set(["llevar", "aqui", "aca", "alla", "comer", "hoy", "manana", "usted", "recoger", "pickup", "go"]);

function meatIn(text: string): string | null {
  const p = plain(text).replace(/\balpastor\b/g, "al pastor");
  let best: [number, string] | null = null;
  for (const [re, key] of MEATS) {
    const m = p.match(re);
    if (m && (!best || (m.index || 0) < best[0])) best = [m.index || 0, key];
  }
  return best?.[1] || null;
}
function kindIn(text: string): Kind | null {
  const p = plain(text).replace(/\bsopesazos?\b|\bsopesasos?\b/g, " ");
  let best: [number, Kind] | null = null;
  for (const [re, key] of DISH) {
    const m = p.match(re);
    if (m && (!best || (m.index || 0) < best[0])) best = [m.index || 0, key];
  }
  return best?.[1] || null;
}
function styleIn(text: string): Style {
  const p = plain(text);
  if (/\b(?:dorad|frit|fried|en\s+aceite|de\s+aceite)\b/.test(p)) return "";
  if (/\bcomal\b|\bhomemade\b|\bhecha a mano\b/.test(p)) return "comal";
  if (/\bharina\b|\bflour\b/.test(p)) return "harina";
  if (/\btaquer|\bstreet\b/.test(p)) return "taquero";
  return "";
}
function fried(text: string): boolean {
  return /\b(?:dorad[ao]s?|frit[ao]s?|fried|en\s+aceite|de\s+aceite)\b/.test(plain(text));
}
function quesoGordita(text: string): boolean {
  return /\bqueso\s+gorditas?\b|\bgorditas?\s+(?:de\s+|con\s+)?queso\b/.test(plain(text));
}
function frijoles(text: string): boolean {
  const p = plain(text);
  if (/\bfrijoles?\s+con\s+/.test(p)) return true;
  return /\b(?:con|de)\s+frijoles?\b/.test(p) && meatIn(p.replace(/\bfrijoles?\b/g, " ")) !== null;
}
function clean(text: string): string {
  return plain(text)
    .replace(/\b(?:para|a|son|antes de|despues de)\s+las\s+dos(?:\s+de\s+la\s+(?:tarde|manana|noche)|\s+en\s+punto)?\b/g, " ")
    .replace(/\b(?:\d+|un|una|dos|tres|cuatro|cinco|diez|veinte|twenty)\s+(?:minutos?|horas?|dolares?|pesos?|dollars?)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}
function bareYes(text: string): boolean {
  const p = plain(text);
  if (new RegExp(`\\b(?:${NUMW})\\b`).test(p) || meatIn(p) || kindIn(p)) return false;
  return /^(?:si|uju|ujum|aja|ok|okay|claro|yes|yeah|eso|sale|va|perfecto)(?:\s+(?:senor|senora|gracias|bueno))?$/.test(p);
}
function statedStyle(staff: string): Style {
  const sentences = String(staff || "").split(/(?<=[.!])\s+/).filter((s) => !/\?/.test(s));
  for (const s of sentences) {
    const styles = [/\bcomal\b/.test(plain(s)), /\bharina\b|\bflour\b/.test(plain(s)), /\btaquer|\bstreet\b/.test(plain(s))].filter(Boolean).length;
    if (styles === 1) return styleIn(s);
  }
  return "";
}
function isPriceOrAvail(text: string): boolean {
  const p = plain(text);
  if (/\b(?:a como|cuanto cuest|cuanto son|cuanto val|how much|how many dollars)\b/.test(p) && !/\b(?:me\s+pone|ponme|quiero|quisiera|can\s+i\s+get|let\s+me\s+get)\b/.test(p)) return true;
  if (isAvailQ(text) && !new RegExp(`\\b(?:${NUMW})\\s+(?:quesadillas?|tacos?|gorditas?|tortas?|burritos?)\\b`).test(p)) return true;
  return false;
}
function boundary(text: string): boolean {
  const p = plain(text);
  if (/\b(?:otr[ao]\s+orden|otro\s+(?:plato|pedido)|en\s+otro\s+plato|por\s+separado|another\s+order|la\s+otra\s+orden|otra\s+es\b|otra\s+va\b|el\s+segund[oa]|la\s+segunda|primer[oa]\s+orden)\b/.test(p)) return true;
  if (/\bpara\s+el\s+chaparro\b|\bpara\s+mi\s+(?:esposa|esposo|hijo|hija|mama|papa)\b/.test(p)) return true;
  const who = p.match(/\by\s+para\s+(?:el\s+|la\s+)?([a-z]{3,})\b/);
  return !!who && !PERSON_STOP.has(who[1]);
}

export type Want = Part;

/** Counted groups. Inside one group a repeated count stays the max. The next order adds. */
export function secondGroupWants(turns: Turn[]): Want[] {
  const groups: Part[][] = [[]];
  let open: { kind: Kind; style: Style; qd: Part["qd"]; queso: boolean } | null = null;
  let named: Kind | null = null;
  let eloteIsEsquite = (turns || []).some((t) => t.speaker === "staff" && /\besquites?\b/.test(plain(String(t.text || ""))));
  const cur = () => groups[groups.length - 1];
  const bump = () => { if (cur().length) groups.push([]); };
  const upsert = (p: Part) => {
    if (!p.n || p.n > 20 || !p.kind) return;
    const hit = cur().find((x) => x.kind === p.kind && x.meat === p.meat && x.qd === p.qd && x.queso === p.queso);
    if (hit) { hit.n = Math.max(hit.n, p.n); hit.frij = hit.frij || p.frij; hit.explicit = hit.explicit || p.explicit; if (p.style) hit.style = p.style; }
    else cur().push({ ...p });
    open = { kind: p.kind, style: p.style || open?.style || "", qd: p.qd || open?.qd || "", queso: p.queso };
    if (p.kind === "taco" || p.kind === "quesadilla" || p.kind === "qd" || p.kind === "gordita" || p.kind === "torta" || p.kind === "burrito") named = null;
  };
  const copyLast = (n: number) => {
    const prev = [...groups].reverse().find((g) => g.length);
    if (!prev || !n) return;
    if (cur().length) groups.push([]);
    const src = prev.length === 1 ? prev[0] : prev[prev.length - 1];
    upsert({ ...src, n, explicit: true, added: n });
  };
  const markDeluxe = (n: number | null) => {
    const own = cur().filter((p) => p.kind === "qd");
    const target = own.length ? own : ([...groups].reverse().find((g) => g.some((p) => p.kind === "qd")) || []).filter((p) => p.kind === "qd");
    for (const p of target) { p.qd = "preparada"; if (n) p.n = Math.max(p.n, n); }
    if (target.length) open = { kind: "qd", style: "", qd: "preparada", queso: false };
  };

  const list = turns || [];
  for (let i = 0; i < list.length; i++) {
    const turn = list[i];
    if (turn.speaker && turn.speaker !== "caller") continue;
    let text = clean(String(turn.text || ""));
    if (!text) continue;
    if (/\bpo[sz]ole\b/.test(text) && !/\bmenudo\b/.test(text)) named = "pozole";
    else if (/\bmenudos?\b/.test(text)) named = "menudo";
    if (bareYes(text)) {
      const staff = [...list.slice(Math.max(0, i - 3), i)].reverse().find((t) => t.speaker === "staff");
      const st = statedStyle(String(staff?.text || ""));
      if (st) for (const p of cur()) if (!p.style && (p.kind === "taco" || p.kind === "quesadilla")) p.style = st;
      continue;
    }
    if (isPriceOrAvail(text)) continue;
    if (/^(?:(?:ah|eh|y|este|oye)\s+)*(?:tendr[ae]s?|tiene[sn]?|hay)\b/.test(text) && !/\b(?:me\s+pone|ponme|quiero|dame|deme|ordenar)\b/.test(text)) continue;
    const nextCaller = list.slice(i + 1).find((t) => !t.speaker || t.speaker === "caller");
    if (new RegExp(`\\b(${NUMW})\\b`).test(text) && meatIn(text) && !kindIn(text) && nextCaller && kindIn(String(nextCaller.text || "")) && !meatIn(String(nextCaller.text || "").split(/\b(?:y|and)\b/)[0] || "")) {
      text = `${text} ${clean(String(nextCaller.text || ""))}`;
      i = list.indexOf(nextCaller);
    }
    const asked = /\?/.test(text) && !/\b(?:me\s+(?:puedes\s+|puede\s+)?(?:poner|pones|ponga|ordenar)|ponme|quiero|quisiera|dame|deme|can\s+i\s+get|let\s+me\s+get)\b/.test(text);
    if (asked) continue;
    const fromBoundary = boundary(text);
    if (fromBoundary) bump();
    const namedDish = kindIn(text);
    if (/\b(?:con\s+todo|with\s+everything|the\s+one\s+with\s+everything)\b/.test(text) && !/\bburrito\b/.test(text) && (!namedDish || namedDish === "quesadilla") && (open?.kind === "qd" || open?.kind === "quesadilla" || fried(text) || /\bdeluxe\b|\bpreparad/.test(text))) markDeluxe(null);
    const otras = text.match(new RegExp(`\\botr[ao]s\\s+(${NUMW})\\b`));
    const afterOtras = otras ? text.slice((otras.index || 0) + otras[0].length) : "";
    if (otras && !kindIn(afterOtras) && !meatIn(afterOtras)) copyLast(numOf(otras[1]));
    const deluxeN = text.match(new RegExp(`\\b(${NUMW})\\s+(?:deluxe|preparadas?)\\b`));
    if (deluxeN && !kindIn(text) && (open?.kind === "qd" || open?.kind === "quesadilla")) { markDeluxe(numOf(deluxeN[1])); continue; }
    const barePut = text.match(new RegExp(`^(?:(?:ah|eh|ok|si|y|este|mm)\\s+)*(?:me\\s+(?:puedes\\s+|puede\\s+|pueden\\s+)?(?:poner|pones|ponga|ordene|ordenas|ordenar)|ponme|dame|deme|te\\s+encargo)\\s+(${NUMW})\\b(.*)$`));
    if (barePut && named && !kindIn(barePut[2] || "") && !meatIn(barePut[2] || "")) {
      upsert({ kind: named, meat: "", style: "", qd: "", queso: false, frij: false, n: numOf(barePut[1]), explicit: true, added: 0 });
      continue;
    }
    const re = new RegExp(`\\b(${NUMW})\\b`, "g");
    const hits = [...text.matchAll(re)];
    if (!hits.length) {
      const meat = meatIn(text.replace(/\bfrijoles?\b/g, " "));
      const blank = meat ? [...cur()].reverse().find((p) => !p.meat && p.kind !== "menudo" && p.kind !== "pozole" && p.kind !== "esquite" && (!kindIn(text) || p.kind === kindIn(text))) : null;
      if (blank && meat) { blank.meat = meat; blank.explicit = true; blank.frij = blank.frij || frijoles(text); if (styleIn(text)) blank.style = styleIn(text); }
    }
    const born: Part[] = [];
    for (let h = 0; h < hits.length; h++) {
      const n = numOf(hits[h][1]);
      if (!n) continue;
      const at = hits[h].index || 0;
      const seg = text.slice(at, hits[h + 1]?.index ?? text.length);
      const before = text.slice(Math.max(0, at - 24), at);
      if (/\b(?:minutos?|horas?|dolares?|pesos?)\b/.test(seg)) continue;
      const dishWord = kindIn(seg) || (/\belotes?\b/.test(seg) && eloteIsEsquite ? "esquite" : null);
      const meat = meatIn(seg.replace(/\bfrijoles?\b/g, " "));
      if (!dishWord && !meat) continue;
      if (/\botr[ao]s\b/.test(before) && dishWord) bump();
      let kind = dishWord || open?.kind || null;
      if (!kind) continue;
      if (kind === "quesadilla" && fried(seg)) kind = "qd";
      const qd = kind === "qd" ? (/\b(?:preparad|deluxe|con\s+todo|everything)\b/.test(seg) && !/\b(?:regular|normal)\b/.test(seg) ? "preparada" : "regular") : "";
      const queso = kind === "gordita" && (quesoGordita(seg) || quesoGordita(text) || !!open?.queso && !dishWord);
      const style = styleIn(seg) || styleIn(text) || (!dishWord ? open?.style || "" : "");
      const explicit = !!(dishWord && meat) || (!!meat && kindIn(text) === kind) || (!dishWord && !!meat && (boundary(text) || /\botr[ao]s?\b/.test(before)));
      const part: Part = { kind, meat: meat || "", style, qd, queso, frij: frijoles(seg) || frijoles(text), n, explicit, added: fromBoundary ? n : 0 };
      born.push(part);
      upsert(part);
    }
    if (born.length) {
      const styled = born.find((p) => p.style)?.style;
      if (styled) for (const p of born) if (!p.style && p.kind === born[0].kind) {
        p.style = styled;
        const saved = cur().find((x) => x.kind === p.kind && x.meat === p.meat && x.n === p.n);
        if (saved) saved.style = styled;
      }
    }
  }
  const summed = new Map<string, Want>();
  for (const g of groups) for (const p of g) {
    const key = [p.kind, p.meat, p.qd, p.queso ? "q" : ""].join("|");
    const hit = summed.get(key);
    if (!hit) summed.set(key, { ...p, added: 0 });
    else if (p.added) { hit.added += p.n; hit.n += p.n; hit.frij = hit.frij || p.frij; hit.explicit = hit.explicit || p.explicit; if (p.style) hit.style = p.style; if (p.qd === "preparada") hit.qd = p.qd; }
    else { hit.n = Math.max(hit.n, p.n); hit.frij = hit.frij || p.frij; hit.explicit = hit.explicit || p.explicit; if (p.style && !hit.style) hit.style = p.style; if (p.qd === "preparada") hit.qd = p.qd; }
  }
  return [...summed.values()];
}

const oname = (o: any) => typeof o === "string" ? o : String(o?.name || "");
function lineKind(id: string): Kind | null {
  if (/^sq-qd-/.test(id)) return "qd";
  if (/^sq-quesadilla-/.test(id)) return "quesadilla";
  if (/^sq-taco-/.test(id)) return "taco";
  if (/^sq-gordita-/.test(id)) return "gordita";
  if (/^sq-torta-/.test(id)) return "torta";
  if (/^sq-burrito-/.test(id)) return "burrito";
  if (/^sq-pozole-/.test(id)) return "pozole";
  if (/^sq-menudo-/.test(id) && !/solo-caldo/.test(id)) return "menudo";
  if (/^sq-esquite-/.test(id)) return "esquite";
  return null;
}
function lineMeat(line: any): string {
  for (const m of line?.modifiers || []) {
    if (!/carne|meat/i.test(String(m.step || "")) && !/carne|meat|bistec|pastor|pollo|tripa|cabeza/i.test(String(m.option || ""))) continue;
    const k = meatIn(String(m.option || ""));
    if (k) return k;
  }
  return "";
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

function buildLine(w: Want, menu: any[]): any | null {
  if (w.kind === "pozole") {
    const item = (menu || []).find((m) => /^sq-pozole-rojo/.test(String(m.id))) || (menu || []).find((m) => /^sq-pozole-/.test(String(m.id)));
    return item ? { itemId: item.id, quantity: w.n, modifiers: [], readback: `${w.n} pozole` } : null;
  }
  if (w.kind === "menudo") {
    const item = (menu || []).find((m) => /^sq-menudo-menudo-con-tortillas/.test(String(m.id))) || (menu || []).find((m) => /^sq-menudo-/.test(String(m.id)) && !/con-pata|solo-caldo/.test(String(m.id)));
    return item ? { itemId: item.id, quantity: w.n, modifiers: [], readback: `${w.n} menudo` } : null;
  }
  if (w.kind === "esquite") {
    const item = (menu || []).find((m) => /^sq-esquite-/.test(String(m.id)));
    return item ? { itemId: item.id, quantity: w.n, modifiers: [], readback: `${w.n} esquite` } : null;
  }
  const food = (menu || []).find((m) => lineKind(String(m.id)) === (w.kind === "qd" ? "quesadilla" : w.kind) && (w.kind !== "qd" || /quesadilla-HLT6CR|quesadilla$/.test(String(m.id)) || /^sq-quesadilla-/.test(String(m.id))));
  const host = w.kind === "qd"
    ? (menu || []).find((m) => String(m.id) === (w.qd === "preparada" ? QD_DLX : QD_REG)) || { id: w.qd === "preparada" ? QD_DLX : QD_REG, modifierGroups: food?.modifierGroups || [] }
    : (menu || []).find((m) => lineKind(String(m.id)) === w.kind);
  if (!host) return null;
  const mods: Array<{ step: string; option: string }> = [];
  if (w.kind === "gordita") {
    const g = optionNamed(host, /gordita options/i, (n) => w.queso ? /\(QGD\)/.test(n) : /^\(GD\)/.test(n));
    if (g) mods.push(g);
  } else if (w.kind === "taco" || w.kind === "quesadilla") {
    if (!w.style) return null;
    const code = w.kind === "taco"
      ? (w.style === "harina" ? "THR" : w.style === "taquero" ? "TST" : "TCO")
      : (w.style === "harina" ? "QHR" : w.style === "taquero" ? "QST" : "QCO");
    const g = optionNamed(host, /tortilla options/i, (n) => n.includes(`(${code})`));
    if (!g) return null;
    mods.push(g);
  }
  if (w.meat) {
    const g = optionNamed(host.modifierGroups ? host : food, /carne|meat/i, (n) => plain(n).replace(/\s/g, "").includes(w.meat));
    if (!g) return null;
    mods.push(g);
  }
  if (w.frij) {
    const g = optionNamed(food || host, /con\s*\/\s*with/i, (n) => /^\*\*Con Frijoles/i.test(n));
    if (g) mods.push(g);
  }
  if (w.kind === "qd") {
    if (!w.qd) return null;
    mods.unshift({ step: "(QD) Style", option: w.qd === "preparada" ? "(QD) DELUXE Preparada" : "(QD) REGULAR Dorada" });
  }
  if (w.kind === "torta") {
    const g = optionNamed(host, /torta options/i, (n) => /^\(TO\)/.test(n));
    if (g) mods.push(g);
  }
  return { itemId: host.id, quantity: w.n, modifiers: mods, readback: `${w.n} ${w.kind} ${w.meat}`.trim() };
}

function linesFor(cart: any[], w: Want, wants: Want[]): any[] {
  const both = wants.some((o) => o !== w && o.meat === w.meat && (o.kind === "qd" || o.kind === "quesadilla") && (w.kind === "qd" || w.kind === "quesadilla") && o.kind !== w.kind);
  return cart.filter((line) => {
    const k = lineKind(String(line?.itemId || ""));
    const meat = lineMeat(line);
    if (!k) return !!w.meat && meat === w.meat;
    if ((w.meat || "") !== meat) return false;
    if (k === w.kind) return true;
    return !both && (k === "qd" || k === "quesadilla") && (w.kind === "qd" || w.kind === "quesadilla");
  });
}

/** Add a missing later group, or raise a short count. A line already at the spoken count stays. */
export function applySecondGroups(cart: any[], turns: Turn[], menu: any[]): boolean {
  if (!Array.isArray(cart) || !Array.isArray(turns)) return false;
  const unavailable = staffUnavailable(turns as any).join(" ");
  const parsed = secondGroupWants(turns);
  const gorditaMeats = new Set(parsed.filter((w) => w.kind === "gordita" && w.meat).map((w) => w.meat));
  const wants = parsed.filter((w) => w.explicit && w.n > 0 && w.kind !== "menudo" && w.kind !== "torta" && w.kind !== "burrito" && (w.meat || w.kind === "pozole" || w.kind === "esquite"));
  if (!wants.length) return false;
  const combo = cart.some((l) => /^sq-combo-quesadillas/.test(String(l?.itemId || "")));
  const qSum = wants.filter((w) => w.kind === "quesadilla" || w.kind === "qd").reduce((s, w) => s + w.n, 0);
  const familyNow = (w: Want) => cart.filter((line) => {
    const k = lineKind(String(line?.itemId || ""));
    return k === w.kind || ((k === "qd" || k === "quesadilla") && (w.kind === "qd" || w.kind === "quesadilla"));
  }).reduce((s, l) => s + (Number(l.quantity) || 1), 0);
  const started = new Map<string, number>();
  for (const w of wants) {
    const key = w.kind === "qd" || w.kind === "quesadilla" ? "q" : w.kind;
    if (!started.has(key)) started.set(key, familyNow(w));
  }
  let changed = false;
  for (const w of wants) {
    if (combo && qSum <= 2 && (w.kind === "quesadilla" || w.kind === "qd")) continue;
    if ((w.kind === "taco" || w.kind === "quesadilla") && !w.style) continue;
    if (w.kind === "taco" && w.style === "harina") continue;
    if (w.kind === "qd" && !w.qd) continue;
    if (w.meat === "duro") continue;
    if (unavailable && new RegExp(`\\b${w.kind}`).test(unavailable)) continue;
    if (w.kind === "gordita" && gorditaMeats.size > 1) continue;
    const lines = linesFor(cart, w, wants);
    const have = lines.reduce((s, l) => s + (Number(l.quantity) || 1), 0);
    const key = w.kind === "qd" || w.kind === "quesadilla" ? "q" : w.kind;
    if (have >= w.n) continue;
    // A dish already on the cart is only grown by "otras N" or another order of that same meat.
    // A second meat is not invented beside lines the caller already placed.
    if ((started.get(key) || 0) > 0 && !lines.length) continue;
    if (lines.length) {
      if (!w.added) continue;
      const next = Math.min(w.n, have + w.added);
      if (next <= have) continue;
      lines[lines.length - 1].quantity = (Number(lines[lines.length - 1].quantity) || 1) + (next - have);
      changed = true;
      continue;
    }
    const line = buildLine(w, menu);
    if (!line) continue;
    cart.push(line);
    changed = true;
  }
  return changed;
}
