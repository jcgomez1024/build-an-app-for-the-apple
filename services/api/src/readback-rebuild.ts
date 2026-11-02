// carlos3 (CAf907ff): the caller confirmed ("sí, cierto") the staff's full readback
// "tres tacos de comal de bistec, dos tacos taqueros de chorizo, dos quesadillas de harina de bistec…".
// When every read-back taco/quesadilla names count + tortilla + meat, that readback is the ticket for those dishes.
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, one: 1, a: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, once: 11, doce: 12, twelve: 12 };
const NUMW = String.raw`\d{1,2}|${Object.keys(NUM).filter((k) => k.length > 1).join("|")}`;
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()] || 0);
const KIND: Record<string, string> = { taco: "taco", tacos: "taco", quesadilla: "quesadilla", quesadillas: "quesadilla" };
const STYLE: Record<string, Array<[RegExp, RegExp]>> = {
  taco: [[/\bcomal\b|\bhomemade\b|\bhechas?\s+a\s+mano\b/iu, /^\(TCO\)/], [/\bharina\b|\bflour\b/iu, /^\(THR\)/], [/\btaquer[oa]s?\b|\bstreet\b/iu, /^\(TST\)/]],
  quesadilla: [[/\bcomal\b|\bhomemade\b/iu, /^\(QCO\)/], [/\bharina\b|\bflour\b/iu, /^\(QHR\)/], [/\btaquer[oa]s?\b|\bstreet\b/iu, /^\(QST\)/]],
};
const MEATS: Array<[RegExp, RegExp]> = [
  [/\b(?:bistec|biste|bisteck|steak|asada)\b/iu, /^bistec/i], [/\bchorizo\b/iu, /^chorizo/i], [/\bpastor\b/iu, /pastor/i],
  [/\bcarnitas\b/iu, /^carnitas/i], [/\b(?:pollo|chicken)\b/iu, /^pollo/i], [/\bcabeza\b/iu, /^cabeza/i], [/\blengua\b|\btongue\b/iu, /^lengua/i],
  [/\btripa\b|\btripe\b/iu, /^tripa/i], [/\bsuadero\b/iu, /^suadero/i], [/\bbarbacoa\b/iu, /^barbacoa/i], [/\bbirria\b/iu, /birria/i],
];
const AFFIRM = /^\W*(?:s[ií](?!\p{L})|correcto|cierto|exacto|eso\s+es|as[ií]\s+es|perfecto|yes\b|yeah\b|correct\b|that'?s\s+(?:right|it|correct))/iu;
const OTHER_DISH = /\b(?:gorditas?|tortas?|burritos?|sopes?|huaraches?|tostadas?|flautas?|enchiladas?|tamales?|menudo|pozole|platillos?|plates?|orden(?:es)?\s+de)\b/iu;
const kindOf = (id: string) => { const m = String(id || "").match(/^sq-([a-z]+)/); return m ? m[1] : ""; };
export type RbItem = { kind: string; qty: number; style: RegExp; meat: RegExp };
export function parseReadback(text: string): RbItem[] | null {
  const t = String(text || "").toLowerCase().replace(/\bcomalde\b/g, "comal de").replace(/\bdel\s+comal\b/g, "de comal");
  const re = new RegExp(String.raw`\b(${NUMW})\s+(tacos?|quesadillas?)\b`, "giu");
  const hits = [...t.matchAll(re)]; if (hits.length < 2) return null;
  const out: RbItem[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]; const seg = t.slice(h.index! + h[0].length, i + 1 < hits.length ? hits[i + 1].index : undefined).split(/\by\s+por\b|\bpor\s+[úu]ltimo\b|[.?!]/)[0];
    const kind = KIND[h[2]]; const qty = num(h[1]);
    const st = STYLE[kind].filter(([w]) => w.test(seg)); const mt = MEATS.filter(([w]) => w.test(seg));
    if (!qty || st.length !== 1 || mt.length !== 1) return null; // every item fully specified, or don't trust it
    out.push({ kind, qty, style: st[0][1], meat: mt[0][1] });
  }
  return out;
}
/** The last staff run before the caller's affirmation, parsed; null unless confirmed & fully specified. */
export function confirmedReadback(turns: Array<{ speaker: string; text: string }>): RbItem[] | null {
  let best: RbItem[] | null = null;
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].speaker !== "caller" || !AFFIRM.test(String(turns[i].text || ""))) continue;
    let j = i - 1; const run: string[] = [];
    while (j >= 0 && turns[j].speaker !== "caller") run.unshift(String(turns[j--].text || ""));
    const txt = run.join(" ");
    if (OTHER_DISH.test(txt)) continue;
    const p = parseReadback(txt); if (p && p.length >= 2) best = p;
  }
  return best;
}
const grpOf = (item: any, re: RegExp) => (item?.modifierGroups || []).find((g: any) => re.test(String(g.name || "")));
export function applyConfirmedReadback(cart: any[], turns: any[], menu: any[]): number {
  const rb = confirmedReadback(turns || []); if (!rb) return 0;
  const kinds = new Set(rb.map((r) => r.kind));
  const old = cart.filter((a) => kinds.has(kindOf(a.itemId)));
  const next: any[] = [];
  for (const r of rb) {
    const proto = old.find((a) => kindOf(a.itemId) === r.kind); if (!proto) return 0; // dish never rung: leave it to other passes
    const item = menu.find((m: any) => m?.id === proto.itemId);
    const tg = grpOf(item, /tortilla/i), mg = grpOf(item, /carne|meat/i); if (!tg || !mg) return 0;
    const to = (tg.options || []).find((o: any) => r.style.test(String(o.name || ""))), mo = (mg.options || []).find((o: any) => r.meat.test(String(o.name || "")));
    if (!to || !mo) return 0;
    const twin = old.find((a) => kindOf(a.itemId) === r.kind && (a.modifiers || []).some((x: any) => x.step === mg.name && x.option === mo.name)) || proto;
    const c = JSON.parse(JSON.stringify(twin)); c.quantity = r.qty; delete c.lineId;
    const own = new Set([...(tg.options || []), ...(mg.options || [])].map((o: any) => o.name));
    const mods = (c.modifiers || []).filter((x: any) => x.step !== tg.name && x.step !== mg.name && !own.has(x.option));
    c.modifiers = [{ step: tg.name, option: to.name }, { step: mg.name, option: mo.name }, ...mods];
    next.push(c);
  }
  const sig = (a: any) => `${a.itemId}|${a.quantity}|${(a.modifiers || []).map((x: any) => x.option).sort().join(",")}`;
  if (old.map(sig).sort().join(";") === next.map(sig).sort().join(";")) return 0;
  for (const a of old) cart.splice(cart.indexOf(a), 1);
  cart.push(...next);
  return next.length;
}
