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

// sergio1 (CA89117579, Nov 4): "cuatro quesadillas en aceite" → "Sí, de chicharrón prensado" → "¿Las cuatro?" "Sí" → deluxe.
// A bare "de <meat>" after a meatless dish line fills THAT line (all N); never a new default-comal quesadilla.
const QCO_ID = "sq-quesadilla-HLT6CR";
const TORT_SAID = /\b(?:comal|harina|flour|taquer[oa]s?|street|homemade|hechas?\s+a\s+mano|ma[ií]z)\b/iu;
const DISHW = /\b(?:tacos?|quesadillas?|qd|qco|gorditas?|huaraches?|tortas?|burritos?|sopes?|tostadas?|flautas?|menudos?|platillos?|nachos?|doradas?)\b/iu;
const isMeatStep = (m: any) => /carnes?|meats?/i.test(String(m?.step || ""));
const meatKey = (opt: string) => fold(String(opt).split("/")[0]).replace(/\(.*?\)/g, "").trim();
/** caller turns that are just "(sí,) de <meat>" — no dish word, no tortilla choice */
export function bareMeatTurns(callerTexts: string[]): string[] {
  return callerTexts.filter((t) => /^[\s¡¿.,]*(?:(?:am|eh|ah|um|mm|s[ií]|ok(?:ay)?|y|pues|este)\W+)*de\s+\p{L}/iu.test(t) && !DISHW.test(t) && !TORT_SAID.test(t)).map(fold);
}
export function foldPhantomComalMeat(cart: any[], callerTexts: string[]): boolean {
  if (!Array.isArray(cart) || callerTexts.some((t) => TORT_SAID.test(t))) return false;
  const bare = bareMeatTurns(callerTexts); if (!bare.length) return false;
  let changed = false;
  for (let i = cart.length - 1; i >= 0; i--) {
    const q = cart[i]; if (q?.itemId !== QCO_ID) continue;
    const meats = (q.modifiers || []).filter(isMeatStep); if (meats.length !== 1) continue;
    const k = meatKey(meats[0].option); if (!k || !bare.some((b) => b.includes(k))) continue;
    const host = cart.find((l, j) => j !== i && /quesadilla|-qd-/i.test(String(l?.itemId)) && l.itemId !== QCO_ID && !(l.modifiers || []).some(isMeatStep));
    if (!host) continue;
    host.modifiers = [...(host.modifiers || []), { step: meats[0].step, option: meats[0].option }];
    cart.splice(i, 1); changed = true;
  }
  return changed;
}
/** live (app path): a bare "de <meat>" turn whose add is a new default-comal quesadilla while the cart has a meatless quesadilla line → update that line */
export function foldBareMeatAdd(actions: any[], cart: any[], text: string): boolean {
  if (!Array.isArray(actions) || !bareMeatTurns([text]).length) return false;
  const host = (cart || []).slice().reverse().find((l: any) => /quesadilla|-qd-/i.test(String(l?.itemId)) && l.itemId !== QCO_ID && !(l.modifiers || []).some(isMeatStep));
  if (!host) return false;
  const i = actions.findIndex((a: any) => a?.type === "add_item" && a.itemId === QCO_ID && (a.modifiers || []).some(isMeatStep));
  if (i < 0) return false;
  const meat = actions[i].modifiers.find(isMeatStep);
  actions[i] = { type: "update_item", itemId: host.itemId, quantity: host.quantity || 1, modifiers: [...(host.modifiers || []), { step: meat.step, option: meat.option }], correction: true };
  return true;
}

// josh3 (CA1fb72332, Nov 4): "can you add chorizo to that too" / "double meat" change the burrito already rung — never a 2nd one.
const ADD_TO_THAT = /\b(?:add|put|throw|include|make)\b[^.?!]*?\b(?:to|on|in(?:to)?|onto)\s+(?:that|it|this|the\s+same(?:\s+one)?|the\s+(?:burrito|one|order)s?)\b|\bdouble\s+(?:the\s+)?(?:meat|carne)\b|\b(?:agr[eé]g(?:a|ale|uele|ue)|p[oó]n(?:le|gale|ga))\b[^.?!]*?\b(?:a\s+es[ea]s?|al\s+mism[oa]|tambi[eé]n)\b|\bdoble\s+carne\b/iu;
export function addToThatAsUpdate(actions: any[], cart: any[], text: string): boolean {
  if (!Array.isArray(actions) || !Array.isArray(cart) || !ADD_TO_THAT.test(String(text || ""))) return false;
  let changed = false;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]; if (a?.type !== "add_item") continue;
    const j = cart.map((l: any) => l?.itemId).lastIndexOf(a.itemId); if (j < 0) continue;
    const base = cart[j]; const mods = [...(base.modifiers || [])];
    for (const m of a.modifiers || []) if (!mods.some((x: any) => x.step === m.step && x.option === m.option)) {
      // single-choice steps (size) keep the line's own pick
      if (/size|tama[nñ]o/i.test(String(m.step)) && mods.some((x: any) => x.step === m.step)) continue;
      mods.push({ step: m.step, option: m.option });
    }
    actions[i] = { type: "update_item", itemId: a.itemId, quantity: base.quantity || 1, modifiers: mods, correction: true };
    changed = true;
  }
  return changed;
}
// josh3: staff "Got it, one horchata." after the caller asked for a drink → that drink is on the order (after-call).
const AGUA: Array<[RegExp, string]> = [[/horchatas?/iu, "sq-drink-agua-fresca-horchata-32oz-HL6HPK"], [/jamaicas?/iu, "sq-drink-agua-fresca-jamaica-32oz-ZLA3ZG"]];
export function applyStaffDrinkConfirm(cart: any[], turns: Turn[]): void {
  if (!Array.isArray(cart) || !Array.isArray(turns)) return;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]; if (t.speaker !== "staff") continue;
    const m = String(t.text).match(/(?:^|[.,!]\s*|\b(?:got\s+it|okay|ok|all\s+right|perfect|listo|va|perfecto)[,.]?\s+)(\d|one|two|three|una?|dos|tres)\s+(horchatas?|jamaicas?)\b/iu);
    if (!m) continue;
    const prev = turns.slice(Math.max(0, i - 4), i).filter((x) => x.speaker === "caller").map((x) => x.text).join(" ");
    if (!/\b(?:drinks?|horchatas?|jamaicas?|aguas?|bebidas?|cinnamon)\b/iu.test(prev)) continue;
    const n = numWord(m[1]) || 1; const id = AGUA.find(([re]) => re.test(m[2]))![1];
    const have = cart.filter((l: any) => l?.itemId === id).reduce((s: number, l: any) => s + (l.quantity || 1), 0);
    if (have >= n) continue;
    const l = cart.find((x: any) => x?.itemId === id);
    if (l) l.quantity = n; else cart.push({ itemId: id, quantity: n - have, modifiers: [] });
  }
}

// freddy2 (CA6078cb, Nov 4): garbled "dos cajas viejas doradas" rang Tacos Dorados; staff read back "dos quesadillas doradas de bistec,
// ¿preparadas o normales?" → "Preparada". After-call, staff's dish readback beats the garbled caller line; preparada(s) → DELUXE.
const TD_ID = "sq-tacos-dorados-tacos-dorados-OHFWF3";
const QD_DEL = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", QD_REG = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
export function applyStaffDoradaReadback(cart: any[], turns: Turn[], menu: any[] = []): void {
  if (!Array.isArray(cart) || !Array.isArray(turns)) return;
  const caller = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
  if (/\btacos?\b|\bdorados\b/iu.test(caller)) return;
  const staffAll = turns.filter((t) => t.speaker === "staff").map((t) => t.text).join(" ");
  const m = staffAll.match(/\b(\d{1,2}|una?|dos|tres|cuatro|cinco|seis)\s+quesadillas?\s+doradas?\b/iu); if (!m) return;
  const n = numWord(m[1]) || 1;
  const qdMeats: string[] = ((menu || []).find((i: any) => i?.id === QD_REG)?.modifierGroups || []).find((g: any) => /carnes|meats/i.test(g.name))?.options?.map((o: any) => o.name) || [];
  for (const l of cart) {
    if (![TD_ID, QD_DEL, QD_REG].includes(l?.itemId) || (l.quantity || 1) !== n) continue;
    const del = /\bpreparad[ao]s?\b|\bdeluxe\b|\bcon\s+todo\b/iu.test(caller) && !/\b(?:normal(?:es)?|regular(?:es)?|sencill[ao]s?)\b/iu.test(caller);
    const meats = (l.modifiers || []).filter((x: any) => /carne|meat/i.test(String(x.step))).map((x: any) => {
      const k = meatKey(x.option); const opt = qdMeats.find((o) => meatKey(o) === k) || x.option;
      return { step: "(B) Q Carnes / Meats", option: opt };
    });
    if (/quesadillas?\s+doradas?\s+de\s+bistec\b/iu.test(staffAll) && !meats.some((x: any) => /bistec/i.test(x.option))) meats.splice(0, meats.length, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" });
    if (!del && l.itemId !== TD_ID) continue; // QD line already rung; only upgrade style on a preparada answer
    l.itemId = del ? QD_DEL : QD_REG;
    l.modifiers = [{ step: "(QD) Style", option: del ? "(QD) DELUXE Preparada" : "(QD) REGULAR Dorada" }, ...meats];
    delete l.asked;
  }
}

// jennifer1 (CA8da140, Nov 4): "dos órdenes de menudo" … "¿pura pancita o pancita con pata?" "Pues las dos. Y serían tres." … "¿Tres van a ser?" "Sí"
// → Elvi kept 2. After-call: a later caller "serían/van a ser/son N" or a staff "¿N van a ser?" the caller confirms sets the menudo total;
// "las dos / ambas / de los dos" to a pancita-vs-pata choice is a mix → note on the line so staff confirm the split.
const MENUDO_RE = /^sq-menudo/i;
export function applyMenudoCountConfirm(cart: any[], turns: Turn[]): void {
  if (!Array.isArray(cart) || !Array.isArray(turns)) return;
  const lines = cart.filter((l) => MENUDO_RE.test(String(l?.itemId)) && !/solo|caldo/i.test(String(l?.itemId)));
  if (!lines.length) return;
  const first = turns.findIndex((t) => /menud/iu.test(t.text)); if (first < 0) return;
  let n: number | null = null, mix = false;
  for (let i = first; i < turns.length; i++) { const t = turns[i], f = fold(t.text);
    if (t.speaker === "caller") {
      const m = f.match(/\b(?:serian|van\s+a\s+ser|son|seran|que\s+sean|mejor)\s+(\d{1,2}|[a-z]+)\b/); const k = m && numWord(m[1]); if (k && k >= 1 && k <= 12) n = k;
      if (/\b(?:las|los)\s+dos\b|\bambas?\b|\bambos\b|\bde\s+(?:las|los)\s+dos\b/.test(f) && i > 0 && /pancita/.test(fold(turns.slice(Math.max(first, i - 3), i).map((x) => x.text).join(" "))) && /pata/.test(fold(turns.slice(Math.max(first, i - 3), i).map((x) => x.text).join(" ")))) mix = true;
    } else {
      const m = f.match(/\b(\d{1,2}|[a-z]+)\s+van\s+a\s+ser\b/); const k = m && numWord(m[1]);
      const next = turns.slice(i + 1).find((x) => x.speaker === "caller");
      if (k && k >= 1 && k <= 12 && next && /^\W*(?:s[ií]|yes|ok(?:ay)?|correcto|eso|as[ií]\s+es)\b/iu.test(next.text)) n = k;
    }
  }
  const total = lines.reduce((a, l) => a + (Number(l.quantity) || 1), 0);
  if (n && n > total) { const l = lines[lines.length - 1]; l.quantity = (Number(l.quantity) || 1) + (n - total); }
  if (mix && lines.length === 1 && (Number(lines[0].quantity) || 1) >= 2) {
    const l = lines[0]; l.elviNotes = Array.isArray(l.elviNotes) ? l.elviNotes : [];
    const note = "Mix pancita + con pata (caller said 'las dos') — confirm split"; if (!l.elviNotes.includes(note)) l.elviNotes.push(note);
  }
}

// nikki1 (CA31f9eb, Nov 4): "two regular quesadillas, steak … flour" then "can you just make it four regular quesadillas, the steak?"
// → staff "four flour quesadilla steak" ($24). "make it N" / "just make it N" / "hazlas N" / "mejor que sean N" REPLACES the matching
// line's qty (restated attrs override by step) — never a second line (Elvi rang 2 + 4 = 6).
const MAKE_IT_N = /\b(?:make\s+(?:it|them|that)|change\s+(?:it|that)\s+to|haz(?:las|los|la|lo)|h[aá]gal[ao]s|mejor\s+(?:que\s+sean\s+)?|que\s+sean)\s+(\d{1,2}|[a-z]+)\b([^.?!]*)/iu;
const NOUN_ID: Array<[RegExp, RegExp]> = [[/quesadillas?|quesas?/iu, /quesadilla(?!-dorada)/i], [/tacos?/iu, /^sq-tacos?-(?!dorados)/i], [/burritos?/iu, /burrito/i], [/tortas?/iu, /torta/i], [/gorditas?/iu, /gordita/i], [/sopes?/iu, /sope/i], [/menudos?/iu, /^sq-menudo/i]];
const isFood = (l: any) => !/^sq-(?:extras|drink|sides|salsa)/i.test(String(l?.itemId));
export function makeItN(text: string): { n: number; tail: string } | null {
  const m = fold(String(text || "")).match(MAKE_IT_N); if (!m) return null; const n = numWord(m[1]);
  return n && n >= 1 && n <= 30 ? { n, tail: m[2] || "" } : null;
}
function makeItTarget(cart: any[], tail: string): number {
  const nid = NOUN_ID.find(([w]) => w.test(tail));
  for (let j = cart.length - 1; j >= 0; j--) { const id = String(cart[j]?.itemId); if (nid ? nid[1].test(id) : isFood(cart[j])) return j; }
  return -1;
}
/** live + say(): the "make it N" turn edits the matching cart line's qty instead of adding another one */
export function makeItNAsUpdate(actions: any[], cart: any[], text: string): boolean {
  const k = makeItN(text); if (!k || !Array.isArray(actions) || !Array.isArray(cart)) return false;
  const j = makeItTarget(cart, k.tail); if (j < 0) return false;
  const base = cart[j]; let changed = false;
  for (let i = 0; i < actions.length; i++) { const a = actions[i];
    if (a?.type !== "add_item" || a.itemId !== base.itemId) continue;
    const mods = [...(base.modifiers || [])];
    for (const m of a.modifiers || []) { if (m?.isDefault) continue; const x = mods.findIndex((y: any) => y.step === m.step); if (x >= 0) mods[x] = { step: m.step, option: m.option }; else mods.push({ step: m.step, option: m.option }); }
    actions[i] = { type: "update_item", itemId: base.itemId, quantity: k.n, modifiers: mods, correction: true }; changed = true;
  }
  if (!changed && !actions.some((a: any) => a?.type === "add_item" || a?.type === "update_item" || a?.type === "remove_item") && (Number(base.quantity) || 1) !== k.n) {
    actions.push({ type: "update_item", itemId: base.itemId, quantity: k.n, modifiers: base.modifiers || [], correction: true }); changed = true;
  }
  return changed;
}
/** after-call: after a caller "make it N", same-dish lines with the same meat collapse into ONE line of N */
export function applyMakeItNMerge(cart: any[], turns: Turn[]): void {
  if (!Array.isArray(cart) || !Array.isArray(turns)) return;
  for (const t of turns) { if (t.speaker !== "caller") continue; const k = makeItN(t.text); if (!k) continue;
    const j = makeItTarget(cart, k.tail); if (j < 0) continue; const id = cart[j].itemId;
    const meat = (l: any) => (l.modifiers || []).filter(isMeatStep).map((m: any) => meatKey(m.option)).sort().join("+");
    const same = cart.filter((l) => l.itemId === id && meat(l) === meat(cart[j]));
    if (same.length < 2) continue;
    const keep = same.find((l) => (Number(l.quantity) || 1) === k.n) || same[same.length - 1];
    keep.quantity = k.n;
    for (const l of same) if (l !== keep) cart.splice(cart.indexOf(l), 1);
  }
}
/** nikki1: "a couple sour creams" / staff "two sour creams" → the Crema extra line carries the count (never 1) */
const EXTRA_NOUN: Array<[RegExp, RegExp]> = [[/sour\s*creams?|cremas?/iu, /crema/i], [/guacamoles?|guac/iu, /guac/i], [/limes?|limones?/iu, /lim[oó]n|lime/i]];
export function applyExtraCounts(cart: any[], turns: Turn[]): void {
  if (!Array.isArray(cart) || !Array.isArray(turns)) return;
  for (const [w, opt] of EXTRA_NOUN) {
    let n = 0;
    for (const t of turns) { const f = fold(t.text);
      const re = new RegExp(String.raw`\b(\d{1,2}|[a-z]+|couple(?:\s+of)?|a\s+couple(?:\s+of)?|par\s+de|un\s+par\s+de)\s+(?:(?:small|little|big|chic[oa]s?|extra)\s+)?(?:` + w.source + String.raw`)\b`, "iu");
      const m = f.match(re); if (!m) continue; const k = /couple|par/.test(m[1]) ? 2 : numWord(m[1]); if (k && k >= 2 && k <= 10) n = k;
    }
    if (!n) continue;
    const lines = cart.filter((l) => /^sq-extras/i.test(String(l?.itemId)) && (l.modifiers || []).some((m: any) => opt.test(String(m.option))));
    if (lines.length === 1 && (Number(lines[0].quantity) || 1) < n) lines[0].quantity = n;
  }
}
