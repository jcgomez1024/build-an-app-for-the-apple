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
