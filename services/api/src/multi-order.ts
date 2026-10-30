// lena1 (CA7629f001, Oct 30 6:34 PM ET, Lena, English pickup, two orders): order 2 "one chorizo steak quesadilla, flour …
// no, one chorizo and then one steak one" + "two sour creams and extra limes" + "only cilantro" (staff: cilantro and onions).
// Post-call: the correction splits the dual-meat line into singles; sides ring on the Extras item; toppings become a note.
const plain = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4 };
type Turn = { speaker: string; text: string };
const MEAT_G = /carne|meat/i;
const meatOf = (menu: any[], itemId: string, word: string) => {
  const g = (menu.find((i) => i.id === itemId)?.modifierGroups || []).find((g: any) => MEAT_G.test(g.name) && !/combo|item #/i.test(g.name));
  if (!g) return null;
  const w = plain(word);
  const o = (g.options || []).map((o: any) => (typeof o === "string" ? o : o.name)).find((o: string) => plain(o).split(" ").some((x) => x.length >= 4 && (x === w || x === w.replace(/s$/, ""))));
  return o ? { step: g.name, option: o } : null;
};

/** "one X and (then) one Y (one)" after a dual-meat "X Y" line → two single lines of the same dish. */
export function applySplitCorrection(cart: any[], turns: Turn[], menu: any[]): boolean {
  const caller = plain(turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" "));
  let changed = false;
  for (const m of caller.matchAll(/\b(?:no\s+)?one\s+([a-z]{4,})\s+and\s+(?:then\s+)?one\s+([a-z]{4,})(?:\s+one)?\b/g)) {
    const [A, B] = [m[1], m[2]];
    const hasM = (l: any, w: string) => (l.modifiers || []).some((x: any) => x.option === meatOf(menu, l.itemId, w)?.option);
    // the dual-meat "A B" line, else the latest single A or B line of a dish offering both (ASR/LLM already half-fixed it)
    const dual = [...cart].reverse().find((l) => meatOf(menu, l.itemId, A) && meatOf(menu, l.itemId, B) && hasM(l, A) && hasM(l, B))
      || [...cart].reverse().find((l) => meatOf(menu, l.itemId, A) && meatOf(menu, l.itemId, B) && l.quantity === 1 && (hasM(l, A) || hasM(l, B)));
    if (!dual) continue;
    const a = meatOf(menu, dual.itemId, A)!, b = meatOf(menu, dual.itemId, B)!;
    // drop this group's lines of the same dish made only of A/B (echo re-adds), then ring one A + one B
    const same = (l: any) => l.itemId === dual.itemId && (l.person ?? null) === (dual.person ?? null) && (l === dual || l.quantity === 1 || dual.person != null) // within a separate order group the correction is that group's whole say
      && (l.modifiers || []).filter((x: any) => MEAT_G.test(x.step)).every((x: any) => x.option === a.option || x.option === b.option);
    const at = cart.indexOf(cart.find(same));
    const base = (dual.modifiers || []).filter((x: any) => !MEAT_G.test(x.step));
    for (let i = cart.length - 1; i >= 0; i--) if (same(cart[i])) cart.splice(i, 1);
    const mk = (meat: any) => ({ ...dual, quantity: 1, modifiers: [...base.filter((x: any) => !/tortilla/i.test(x.step)), meat, ...base.filter((x: any) => /tortilla/i.test(x.step))].sort((x: any, y: any) => String(x.step).localeCompare(String(y.step))) });
    cart.splice(at, 0, mk(a), mk(b));
    changed = true;
  }
  return changed;
}

/** "two sour creams", "extra limes" (ASR "lines"), "only cilantro (and onions)" → Extras lines + a toppings note. */
export function applySidesAndToppings(cart: any[], turns: Turn[], menu: any[]): boolean {
  const extras = menu.find((i) => /^sq-extras-/.test(i.id) && /^extras$/i.test(String(i.name)));
  const caller = plain(turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" "));
  const all = plain(turns.map((t) => t.text).join(" "));
  let changed = false;
  const lastDish = [...cart].reverse().find((l) => l.itemId !== extras?.id);
  const person = lastDish?.person;
  const opt = (re: RegExp) => (extras?.modifierGroups || []).flatMap((g: any) => (g.options || []).map((o: any) => ({ step: g.name, option: typeof o === "string" ? o : o.name }))).find((o: any) => re.test(o.option));
  const haveSide = (re: RegExp) => cart.some((l) => (l.modifiers || []).some((m: any) => re.test(m.option) && (l.itemId === extras?.id || /extra/i.test(m.option))));
  const ring = (n: number, o: any) => { if (!o || !extras) return; cart.push({ itemId: extras.id, quantity: n, modifiers: [o], ...(person ? { person } : {}) }); changed = true; };
  const sc = [...caller.matchAll(/\b(?:(\d+|a|an|one|two|three|four)\s+)?(?:sides?\s+of\s+|extra\s+)?sour\s*creams?\b/g)];
  if (sc.length && !haveSide(/crema|sour cream/i)) ring(Math.max(...sc.map((m) => Number(m[1]) || NUM[m[1] || "one"] || 1)), opt(/^Crema \/ Sour Cream 2oz$/i));
  const lm = caller.match(/\b(?:(\d+|one|two|three|four)\s+)?extra\s+(?:limes?|lines?|limones?)\b|\b(\d+|one|two|three|four)\s+(?:limes|limones)\b/);
  if (lm && !haveSide(/lim[oó]n|lime/i)) ring(Number(lm[1] || lm[2]) || NUM[lm[1] || lm[2] || "one"] || 1, opt(/^Half Limon \/ Lime$/i));
  if (/\bonly\s+cilantro\b|\bjust\s+cilantro\b|\bcilantro\s+(?:and\s+)?onions?\s+only\b/.test(caller)) {
    const note = /\bcilantro\s+and\s+onions?\b/.test(all) ? "solo cilantro y cebolla" : "solo cilantro";
    for (const l of cart) if (l.itemId !== extras?.id && (l.person ?? null) === (person ?? null) && l.itemId === lastDish?.itemId)
      if (!(l.elviNotes || []).includes(note)) { l.elviNotes = [...(l.elviNotes || []), note]; changed = true; }
  }
  return changed;
}
