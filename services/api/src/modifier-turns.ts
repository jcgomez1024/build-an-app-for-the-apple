// pedro3 (CA0afcaf19, Nov 1): modifier phrasing, staff-offered "X o Y" guisado choice, "sí, y con huevo picoso", resumed-after-bye.
type Turn = { speaker: string; text: string };
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const COUNT = /\b(?:\d+|una?|dos|tres|cuatro|cinco|seis|otr[ao]s?|one|two|three|another)\s+(?:m[aá]s\s+)?(?:gorditas?|tacos?|quesadillas?|huaraches?|tortas?|burritos?|sopes?|tostadas?)\b/iu;

/** "si la(s) pueden poner en nopales", "pónganles queso", "ponerle cebolla" — a change to a dish already ordered, not a new one. */
export function isPutOnModifier(text: string): boolean {
  const t = fold(text);
  if (!/\b(?:l[aeo]s?\s+(?:\w+\s+){0,2}poner(?:me)?\b|ponerl[aeo]s?\b|pon(?:ga|gan|e)?l[aeo]s?\b|put\s+(?:it|them)\s+(?:on|in|with)\b)/.test(t)) return false;
  return !COUNT.test(text) || /\b(?:las?|los?)\s+(?:\w+\s+)?(?:gorditas?|tacos?|quesadillas?|huaraches?|tortas?)\b[^.]*\bponer/.test(t);
}

/** Drop add_item actions for a dish already in the cart on a put-on modifier turn. Returns true when it changed anything. */
export function dropPutOnReAdd(actions: any[], cart: any[], text: string): boolean {
  if (!Array.isArray(actions) || !isPutOnModifier(text)) return false;
  const n = actions.length;
  for (let i = actions.length - 1; i >= 0; i--) { const a = actions[i];
    if (a?.type === "add_item" && cart.some((l: any) => l?.itemId === a.itemId)) actions.splice(i, 1); }
  return actions.length !== n;
}

const MEAT_GROUP = /carnes|meats/i;
const meatsOf = (l: any) => (l.modifiers || []).filter((m: any) => MEAT_GROUP.test(String(m.step)));
const keyWords = (opt: string) => fold(opt.split(" /")[0]).split(/\s+/).filter((w) => w.length > 3 && !/^(?:papas|con)$/.test(w));
const AFFIRM = /^[\s¡¿]*(?:s[ií](?!\p{L})|ok(?:ay)?(?!\p{L})|claro|eso|exacto|yes|yeah|ajá)/iu;
const lev1 = (a: string, b: string) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i); };
const saysWord = (t: string, w: string) => fold(t).split(/[^a-z]+/).some((x) => x === w || (w.length >= 5 && x.length >= 4 && lev1(x, w)));

const ALIAS: Array<[RegExp, RegExp]> = [[/huevo\s+(?:picoso|con\s+chile|enchilado)|spicy\s+egg/i, /^Huevo con Chile/i]];

/** After-call: a line holding two guisados (model took staff's "nopales con papas o papas con rajas") keeps the one the caller chose;
 *  "sí, y con huevo picoso" adds that filling to the line staff just named. */
export function applyGuisadoChoice(cart: any[], turns: Turn[], menu: any[]): void {
  for (const l of cart) {
    const ms = meatsOf(l); if (ms.length < 2) continue;
    // only when staff offered them as alternatives ("papas con nopales o papas con rajas")
    const offered = turns.some((t) => t.speaker !== "caller" && /\bo\b/.test(fold(t.text))
      && ms.filter((m: any) => keyWords(m.option).some((w) => saysWord(t.text, w))).length >= 2);
    if (!offered) continue;
    const callerAll = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
    const said = ms.filter((m: any) => keyWords(m.option).some((w) => saysWord(callerAll, w)));
    let keep: any[] = said.length && said.length < ms.length ? said : [];
    if (!keep.length) for (let i = 0; i + 1 < turns.length; i++) { const s = turns[i], c = turns[i + 1];
      if (s.speaker === "caller" || c.speaker !== "caller" || !AFFIRM.test(c.text)) continue;
      const named = ms.filter((m: any) => keyWords(m.option).every((w) => fold(s.text).includes(w)));
      if (named.length === 1 && !/\bo\b/i.test(fold(s.text))) { keep = named; break; } }
    if (keep.length && keep.length < ms.length) l.modifiers = l.modifiers.filter((m: any) => !MEAT_GROUP.test(String(m.step)) || keep.includes(m));
  }
  for (let i = 1; i < turns.length; i++) { const c = turns[i], s = turns[i - 1];
    if (c.speaker !== "caller" || s.speaker === "caller") continue;
    const m = fold(c.text).match(/^[\s,.]*(?:si|ok(?:ay)?|claro)\W+y\s+con\s+([a-z\s]+)/); if (!m) continue;
    const line = [...cart].reverse().find((l) => meatsOf(l).some((x: any) => keyWords(x.option).length && keyWords(x.option).every((w) => fold(s.text).includes(w))));
    if (!line) continue;
    const item = (menu || []).find((x: any) => x.id === line.itemId); const g = item?.modifierGroups?.find((gg: any) => MEAT_GROUP.test(gg.name)); if (!g) continue;
    const al = ALIAS.find(([re]) => re.test(m[1]));
    const opt = g.options.find((o: any) => al ? al[1].test(o.name) : keyWords(o.name).length && keyWords(o.name).every((w) => m[1].includes(w)));
    if (opt && !line.modifiers.some((x: any) => x.option === opt.name)) {
      const at = line.modifiers.map((x: any) => MEAT_GROUP.test(String(x.step))).lastIndexOf(true);
      line.modifiers.splice(at + 1, 0, { step: g.name, option: opt.name });
    }
  }
}

/** Caller pushes back right after staff's goodbye ("No, espérate", "wait") — the order is still open. */
export const RESUME_AFTER_BYE = /^[\s¡¿.,]*(?:(?:eh|um|ah|mm)\W+)*(?:no\W+)?(?:esp[eé]r(?:a|ate|eme|ame)|espera|wait|hold\s+on|un\s+momento|aguant(?:a|ate)|otra\s+cosa|tambi[eé]n\s+quiero)/iu;

// lupita1 (CA35cd40, Nov 4): "dos quesadillas al comal de chicharrón prensado con frijoles" rang 1 prensado+Con Frijoles and 1
// Frijoles-Refritos-only line. "con frijoles" after a meat is that line's Con Frijoles option — merge back into one line of the full count.
const CON_FRIJOL_GROUP = /^\*{0,3}con\s+frijoles/i;
export function mergeConFrijolesSplit(actions: any[], text: string): boolean {
  if (!Array.isArray(actions)) return false;
  const t = fold(text);
  if (!/\bcon\s+frijol(?:es)?\b/.test(t) || /refrit|\b(?:otr[ao]s?|una?|1)\s+(?:de\s+)?(?:puro\s+|solo\s+)?frijol/.test(t)) return false;
  const adds = actions.filter((a) => a?.type === "add_item");
  const beanOnly = (a: any) => { const ms = (a.modifiers || []).filter((m: any) => MEAT_GROUP.test(String(m.step)));
    return ms.length > 0 && ms.every((m: any) => /frijoles refritos|refried beans/i.test(String(m.option))); };
  const meatLine = (a: any) => (a.modifiers || []).some((m: any) => MEAT_GROUP.test(String(m.step)) && !/frijoles refritos|refried beans/i.test(String(m.option)));
  let changed = false;
  for (const b of adds.filter(beanOnly)) {
    const host = adds.find((a) => a !== b && a.itemId === b.itemId && meatLine(a)); if (!host) continue;
    host.quantity = (Number(host.quantity) || 1) + (Number(b.quantity) || 1);
    if (!(host.modifiers || []).some((m: any) => CON_FRIJOL_GROUP.test(String(m.option)))) {
      const con = (b.modifiers || []).find((m: any) => CON_FRIJOL_GROUP.test(String(m.option)));
      host.modifiers = [...(host.modifiers || []), con || { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" }];
    }
    actions.splice(actions.indexOf(b), 1); changed = true;
  }
  return changed;
}

// yoni1: "me pone nueve tortas de bistec" — a spelled count before the dish sets the add's quantity (model rang 1).
const NUMW: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
export const numWord = (w: string): number | null => { const f = fold(w); if (/^\d{1,2}$/.test(f)) return Number(f); return NUMW[f] ?? null; };
const NOUNS = "tortas?|tacos?|quesadillas?|gorditas?|huaraches?|burritos?|sopes?|tostadas?|flautas?|tamales?|pambazos?|enchiladas?|tlayudas?";
export function spokenDishCounts(text: string): Array<{ n: number; noun: string }> {
  const out: Array<{ n: number; noun: string }> = []; const re = new RegExp(String.raw`(?<!\p{L})(\d{1,2}|[a-z]+)\s+(?:orden(?:es)?\s+de\s+)?(${NOUNS})(?!\p{L})`, "giu");
  for (const m of fold(text).matchAll(re)) { const n = numWord(m[1]); if (n && n >= 2) out.push({ n, noun: m[2].replace(/(?:es|s)$/, "") }); }
  return out;
}
/** One spoken count for one dish noun → a lone qty-1 add of that dish takes the count. */
export function applySpokenQty(actions: any[], text: string): boolean {
  if (!Array.isArray(actions)) return false; const cs = spokenDishCounts(text); let ch = false;
  for (const c of cs) { if (cs.filter((x) => x.noun === c.noun).length > 1) continue;
    const hits = actions.filter((a) => a?.type === "add_item" && String(a.itemId).toLowerCase().startsWith(`sq-${c.noun}`) && !/combo/i.test(String(a.itemId)));
    if (hits.length === 1 && (Number(hits[0].quantity) || 1) === 1) { hits[0].quantity = c.n; ch = true; } }
  return ch;
}
/** After-call: staff echoes the count alone ("Nueve.") right after the caller's dish turn → that dish's line takes it. */
export function applyStaffCountEcho(cart: any[], turns: Turn[]): void {
  for (let i = 1; i < turns.length; i++) { const s = turns[i], c = turns[i - 1];
    if (s.speaker === "caller" || c.speaker !== "caller") continue;
    const m = fold(s.text).match(/^\W*(?:ok(?:ay)?\W+)?(\d{1,2}|[a-z]+)\W*(?:\?|$)/); if (!m) continue; const n = numWord(m[1]); if (!n || n < 2) continue;
    const cs = spokenDishCounts(c.text).filter((x) => x.n === n); if (cs.length !== 1) continue;
    const lines = cart.filter((l) => String(l.itemId).toLowerCase().startsWith(`sq-${cs[0].noun}`) && !/combo/i.test(String(l.itemId)));
    if (lines.length === 1 && (Number(lines[0].quantity) || 1) === 1) lines[0].quantity = n;
  }
}
