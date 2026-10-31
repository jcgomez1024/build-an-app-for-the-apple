// carolina1/luis1/angie1/oscar1/miguel1 (Oct 30, 7:35–7:46 PM ET, staff-answered pickups):
// per-meat counts in a list ("tres de pastor, tres de costilla…") never doubled; a restatement after a hold restates;
// a street/taquero context carries across the list; a later tortilla pick resolves the pending line (no second QD);
// a meat said for a meatless group applies to it; deluxe components aren't separate sides; "una de pollo y la otra de
// papas y frijol" after "dos órdenes" splits the enchiladas.
type Turn = { speaker: string; text: string };
const plain = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const numOf = (w: string) => Number(w) || NUM[w] || 0;
const NUMW = "\\d+|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six";
const MEATS: Array<[RegExp, string]> = [[/\bbistec?k?\b|\bsteak\b|\basada\b/, "bistec"], [/\b(?:al )?pastor\b/, "alpastor"], [/\bcostillas?\b/, "costilla"], [/\btripas?\b/, "tripa"],
  [/\bcabezas?\b/, "cabeza"], [/\bprensado\b/, "prensado"], [/\blenguas?\b/, "lengua"], [/\bchorizo\b/, "chorizo"], [/\bpollo\b|\bchicken\b/, "pollo"], [/\bcarnitas\b/, "carnitas"],
  [/\bbuche\b/, "buche"], [/\bbirria\b/, "birria"], [/\bdeshebrada\b/, "deshebrada"], [/\bpicadillo\b/, "picadillo"]];
const meatIn = (p: string) => { let best: [number, string] | null = null; for (const [re, k] of MEATS) { const m = p.match(re); if (m && (!best || (m.index || 0) < best[0])) best = [m.index || 0, k]; } return best?.[1] || null; };
type Kind = "taco" | "quesadilla" | "qd";
const famOf = (k: Kind) => (k === "taco" ? "taco" : "q");
export const kindOfLine = (l: any): Kind | null => { const id = String(l?.itemId || ""); return /^sq-qd-/.test(id) ? "qd" : /^sq-quesadilla-/.test(id) ? "quesadilla" : /^sq-taco-/.test(id) ? "taco" : null; };
const meatOfLine = (l: any) => { for (const m of l.modifiers || []) { if (/salsa|tortilla|options|con \/|extra|deluxe/i.test(m.step) && !/carne|meat/i.test(m.step)) continue; const k = meatIn(plain(m.option)); if (k) return k; } return null; };
type Exp = { kind: Kind; meat: string | null; qty: number; style?: "comal" | "taquero" | "harina"; qd?: "regular" | "preparada" };

/** Parse a spoken list ("dos quesadillas del comal de biste, una quesadilla preparada de prensado, tres tacos taqueros de…"). */
export function parseList(text: string, ctx: { taco?: Exp["style"]; q?: Exp["style"] } = {}): Exp[] {
  const p = plain(text);
  const re = new RegExp(`\\b(${NUMW})\\s+(?=\\S)`, "g");
  const starts = [...p.matchAll(re)].map((m) => m.index || 0);
  const out: Exp[] = [];
  starts.forEach((s, i) => {
    const seg = p.slice(s, starts[i + 1] ?? p.length);
    const m = seg.match(new RegExp(`^(${NUMW})\\s+(.*)$`)); if (!m) return;
    const qty = numOf(m[1]); const rest = m[2];
    let kind: Kind | null = /^(?:\w+\s+){0,2}tacos?\b/.test(rest) ? "taco" : /^(?:\w+\s+){0,2}quesadillas?\b/.test(rest) ? "quesadilla" : null;
    if (!kind && !/^(?:del?\s+)+(?:comal|biste|bistec)|^(?:taqueros?|street)\b/.test(rest)) return;
    const meat = meatIn(rest.replace(/\bque no .*$/, ""));
    const e: Exp = { kind: kind || ("" as any), meat, qty };
    if (/\b(?:dorad[ao]s?|preparad[ao]s?|aceite|deluxe)\b/.test(rest.replace(/\bque no est\w* tan dorad\w*/, "")) && kind !== "taco") { e.kind = "qd"; e.qd = /preparad|deluxe/.test(rest) ? "preparada" : "regular"; }
    if (/\btaquer|\bstreet\b/.test(rest)) e.style = "taquero"; else if (/\bcomal\b/.test(rest)) e.style = "comal"; else if (/\bharina\b|\bflour\b/.test(rest)) e.style = "harina";
    out.push(e);
  });
  // a count with no dish word ("cuatro del comal de bistec y dos quesadillas…") takes its neighbour's dish
  out.forEach((e, i) => { if (!e.kind) e.kind = (out.slice(i + 1).find((x) => x.kind)?.kind || [...out.slice(0, i)].reverse().find((x) => x.kind)?.kind || "quesadilla") as Kind; });
  // a street/taquero (or comal) context carries across the list
  for (const e of out) { if (e.kind === "qd") continue; const k = e.kind === "taco" ? "taco" : "q"; if (e.style) (ctx as any)[k] = e.style; else if ((ctx as any)[k]) e.style = (ctx as any)[k]; }
  return out.filter((e) => e.qty > 0 && e.qty <= 20);
}

const READBACK = /\b(?:te tengo|le tengo|tengo|so i have|i have|i got)\b/;
/** The last staff readback of ≥2 dish lines (the caller didn't correct it) — authoritative for the lines it lists. */
export function staffReadback(turns: Turn[]): { at: number; lines: Exp[] } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]; if (t.speaker !== "staff" || !READBACK.test(plain(t.text))) continue;
    const ctx: any = {};
    // the taco style the caller set earlier ("sí, todos taqueros") carries into the readback
    for (const x of turns.slice(0, i)) { const q = plain(x.text); if (/\btodos? (?:taqueros?|street)\b|^\s*(?:si )?(?:taqueros?|street)\b/.test(q)) ctx.taco = "taquero"; }
    const lines = parseList(t.text, ctx);
    if (lines.length < 2 || lines.some((e) => !e.meat)) continue;
    const next = turns.slice(i + 1).find((x) => x.speaker === "caller");
    if (next && /^(?:no\b|falta|me faltan?|cambia|that s wrong|wrong)/.test(plain(next.text))) return null;
    return { at: i, lines };
  }
  return null;
}
const groups = (menu: any[], id: string) => ((menu.find((m) => m.id === id)?.modifierGroups || []) as any[]);
const oname = (o: any) => (typeof o === "string" ? o : o?.name);
const baseItem = (menu: any[], k: Kind) => menu.find((m) => (k === "taco" ? /^sq-taco-/ : k === "quesadilla" ? /^sq-quesadilla-/ : /^sq-qd-/).test(m.id));
function setLine(l: any, e: Exp, menu: any[]) {
  const sameKind = kindOfLine(l) === e.kind;
  const base = sameKind && groups(menu, l.itemId).length ? menu.find((m) => m.id === l.itemId) : baseItem(menu, e.kind);
  if (!base) return;
  if (!sameKind) { l.itemId = base.id; l.modifiers = (l.modifiers || []).filter((m: any) => /salsa preferencia/i.test(m.step)); }
  const gs: any[] = base.modifierGroups || [];
  const put = (g: any, opt: string | undefined) => { if (!g || !opt) return; l.modifiers = [...(l.modifiers || []).filter((m: any) => m.step !== g.name && !(m.step === "" )), { step: g.name, option: opt }]; };
  const mg = gs.find((g) => /carne|meat/i.test(g.name) && !/extra|combo/i.test(g.name));
  if (e.meat) {
    const opt = (mg?.options || []).map(oname).find((o: string) => plain(o).replace(/\s/g, "").includes(e.meat!));
    if (opt) { l.modifiers = (l.modifiers || []).filter((m: any) => !(meatIn(plain(m.option)) && m.step !== mg.name && /carne|meat/i.test(m.step))); put(mg, opt); }
    l.elviNotes = (l.elviNotes || []).filter((n: string) => !/confirmar.*(?:carne|meat)/i.test(n)); if (!l.elviNotes.length) delete l.elviNotes;
  }
  if (e.kind === "qd") {
    const g = gs.find((g) => /\(QD\).*options/i.test(g.name)) || { name: "(QD) Quesadilla Dorada options", options: ["(QD) REGULAR Dorada", "(QD) DELUXE Preparada"] };
    const want = e.qd || ((l.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(m.option)) ? "preparada" : "regular");
    const cur = (l.modifiers || []).find((m: any) => /^\(QD\)/.test(m.option));
    if (!cur || (e.qd && !new RegExp(want, "i").test(cur.option))) { l.modifiers = (l.modifiers || []).filter((m: any) => !/^\(QD\)/.test(m.option)); l.modifiers.unshift({ step: cur?.step || g.name, option: (g.options || []).map(oname).find((o: string) => new RegExp(want === "regular" ? "REGULAR" : "DELUXE", "i").test(o)) }); }
  } else if (e.style) {
    const tg = gs.find((g) => /tortilla options/i.test(g.name));
    put(tg, (tg?.options || []).map(oname).find((o: string) => (e.style === "taquero" ? /taquer|street/i : e.style === "comal" ? /comal/i : /harina|flour/i).test(o)));
  }
  l.quantity = e.qty;
}
/** Staff readback rebuilds the taco / quesadilla / QD lines it lists: counts, meats, tortilla, regular/preparada. */
export function applyStaffReadback(cart: any[], turns: Turn[], menu: any[]): boolean {
  const rb = staffReadback(turns); if (!rb) return false;
  const keys = new Set(rb.lines.map((e) => `${famOf(e.kind)}:${e.meat}`));
  const claimed = new Set<any>();
  for (const e of rb.lines) {
    const fam = famOf(e.kind);
    const cands = cart.filter((l) => !claimed.has(l) && kindOfLine(l) && famOf(kindOfLine(l)!) === fam && meatOfLine(l) === e.meat);
    const meatless = cart.filter((l) => !claimed.has(l) && kindOfLine(l) && famOf(kindOfLine(l)!) === fam && !meatOfLine(l));
    const pick = cands.find((l) => kindOfLine(l) === e.kind && (e.kind !== "qd" || !e.qd || (l.modifiers || []).some((m: any) => new RegExp(e.qd === "regular" ? "REGULAR" : "DELUXE", "i").test(m.option)))) || cands.find((l) => kindOfLine(l) === e.kind) || cands[0] || meatless[0];
    let l = pick;
    if (!l) { const b = baseItem(menu, e.kind); if (!b) continue; l = { itemId: b.id, quantity: e.qty, modifiers: [] }; cart.push(l); }
    claimed.add(l); setLine(l, e, menu);
  }
  for (let i = cart.length - 1; i >= 0; i--) {
    const l = cart[i]; const k = kindOfLine(l); if (!k || claimed.has(l)) continue;
    const m = meatOfLine(l);
    if (keys.has(`${famOf(k)}:${m}`) || (!m && rb.lines.some((e) => famOf(e.kind) === famOf(k)))) cart.splice(i, 1);
  }
  // "tres tacos taqueros de tripas que no estén tan doradas" → a note on that line
  for (const t of turns) { const p = plain(t.text); if (t.speaker !== "caller" || !/\bno (?:esten|este|muy|tan)\b.*\bdorad/.test(p)) continue;
    const meat = meatIn(p); const l = meat && cart.find((x) => kindOfLine(x) && meatOfLine(x) === meat);
    if (l && !(l.elviNotes || []).some((n: string) => /dorad/.test(n))) l.elviNotes = [...(l.elviNotes || []), "no tan doradas"]; }
  return true;
}

/** Caller lists (no readback): "dos street tacos" … staff "¿de qué?" … "de biste" — fill meatless lines with the meat said for that group. */
export function fillMeatlessFromCaller(cart: any[], turns: Turn[], menu: any[]): boolean {
  const said: Exp[] = []; let pending: Exp | null = null; const ctx: any = {};
  for (const t of turns) {
    if (t.speaker !== "caller") continue;
    const p = plain(t.text);
    const es = parseList(p, ctx);
    if (!es.length && pending) { const m = p.match(/^(?:y\s+)?(?:del?|of)\s+(.*)$/); const meat = m && meatIn(m[1]); if (meat) { pending.meat = meat; pending = null; } continue; }
    for (const e of es) said.push(e);
    pending = es.length && !es[es.length - 1].meat ? es[es.length - 1] : null;
  }
  let changed = false;
  for (const l of cart) {
    const k = kindOfLine(l); if (!k || meatOfLine(l) || !(l.elviNotes || []).some((n: string) => /confirmar.*(?:carne|meat)/i.test(n))) continue;
    const e = said.find((e) => e.meat && famOf(e.kind) === famOf(k) && (e.kind === k || !e.style) && !cart.some((x) => x !== l && kindOfLine(x) === k && meatOfLine(x) === e.meat));
    if (!e) continue;
    setLine(l, { ...e, kind: k, qty: l.quantity || e.qty }, menu); changed = true;
  }
  return changed;
}

/** "with lettuce and sour cream" is the DELUXE: a Crema/Lechuga/Pico side next to a deluxe line goes, unless asked as extra/aparte. */
export function dropDeluxeComponentSides(cart: any[], turns: Turn[]): boolean {
  if (!cart.some((l) => (l.modifiers || []).some((m: any) => /^DELUXE \(/i.test(m.option)))) return false;
  const caller = plain(turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" "));
  if (/\b(?:extra|aparte|on the side|side of|por separado)\b[^.]{0,25}\b(?:crema|sour cream|lechuga|lettuce|pico)\b/.test(caller)) return false;
  let changed = false;
  for (let i = cart.length - 1; i >= 0; i--) { const l = cart[i];
    if (/^sq-extras-/.test(String(l.itemId)) && (l.modifiers || []).concat([{ option: l.itemId }]).some((m: any) => /crema|sour[\s-]?cream|lechuga|lettuce|pico/i.test(String(m.option)))) { cart.splice(i, 1); changed = true; } }
  return changed;
}
/** "Y queso fresco, por favor, también" right after a dish → Con Queso Fresco on that dish (not a side). */
export function applySaidQuesoFresco(cart: any[], turns: Turn[], menu: any[]): boolean {
  const i = turns.findIndex((t) => t.speaker === "caller" && /\bqueso fresco\b/.test(plain(t.text)) && !/\bsin queso fresco\b/.test(plain(t.text)));
  if (i < 0) return false;
  const before = turns.slice(0, i).reverse().map((t) => plain(t.text));
  const kinds: Array<[RegExp, RegExp]> = [[/\bgorditas?\b/, /^sq-gordita-/], [/\btacos?\b/, /^sq-taco-/], [/\bquesadillas?\b/, /^sq-(?:quesadilla|qd)-/], [/\btortas?\b/, /^sq-torta-/], [/\bsopes?\b/, /^sq-sope/]];
  for (const p of before) for (const [w, id] of kinds) if (w.test(p)) {
    const l = cart.find((x) => id.test(String(x.itemId))); if (!l) return false;
    if ((l.modifiers || []).some((m: any) => /queso fresco/i.test(m.option))) return false;
    const g = groups(menu, l.itemId).find((g) => (g.options || []).some((o: any) => /^\*\*Con Queso Fresco/i.test(oname(o))));
    if (!g) return false;
    l.modifiers = [...(l.modifiers || []), { step: g.name, option: (g.options || []).map(oname).find((o: string) => /^\*\*Con Queso Fresco/i.test(o)) }]; return true;
  }
  return false;
}
/** "dos órdenes [de enchiladas]" + "una de (puro) pollo" + "(¿y la otra?) de papas y de frijoles" → two orders. */
export function splitEnchiladaOrders(cart: any[], turns: Turn[], menu: any[]): boolean {
  const ls = cart.filter((l) => /^sq-enchiladas-/.test(String(l.itemId)));
  if (ls.length !== 1 || !/\b(?:dos|2) ordenes\b/.test(plain(turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ")))) return false;
  const l = ls[0]; const g = groups(menu, l.itemId).find((g) => /carne options/i.test(g.name)); if (!g) return false;
  const opt = (w: string) => (g.options || []).map(oname).find((o: string) => plain(o).split(" ")[0].replace(/s$/, "") === w.replace(/es$|s$/, ""));
  const fills = (p: string) => [...p.matchAll(/\b(queso|papas?|frijol(?:es)?|pollo|prensado)\b/g)].map((m) => opt(m[1])).filter(Boolean) as string[];
  const i1 = turns.findIndex((t) => t.speaker === "caller" && /\buna? (?:orden )?de (?:pur[oa] |sol[oa] )?(?:queso|papas?|frijol|pollo|prensado)\b/.test(plain(t.text)));
  if (i1 < 0) return false;
  const f1 = fills(plain(turns[i1].text).replace(/\b(?:la|las|y la|y las) otras?\b.*$/, ""));
  let rest = plain(turns[i1].text).match(/\b(?:la|las) otras?\b(.*)$/)?.[1] || "";
  if (!fills(rest).length) { const nx = turns.slice(i1 + 1).find((t) => t.speaker === "caller"); rest = nx ? plain(nx.text) : ""; }
  const f2 = [...new Set(fills(rest))];
  if (f1.length !== 1 || !f2.length || (f2.length === 1 && f2[0] === f1[0])) return false;
  const other = (l.modifiers || []).filter((m: any) => m.step !== g.name);
  const dedup = (ms: any[]) => ms.filter((m, i) => ms.findIndex((x) => x.step === m.step && x.option === m.option) === i);
  l.quantity = 1; l.modifiers = dedup([{ step: g.name, option: f1[0] }, ...other]);
  cart.splice(cart.indexOf(l) + 1, 0, { ...l, modifiers: dedup([...f2.map((o) => ({ step: g.name, option: o })), ...other]), elviNotes: undefined });
  if (!cart[cart.indexOf(l) + 1].elviNotes) delete cart[cart.indexOf(l) + 1].elviNotes;
  return true;
}

// oscar2 (CAc49c8f0, 7:51 PM ET): staff guessed "¿cuatro tacos de comal de costilla?" → "No, no, no… de costilla no" — a negated meat
// is never rung; the group's meats come from the caller's own "dos de tripa, uno de lengua… y otro de cabeza".
const MEAT_WORDS = "bistec?k?|steak|asada|(?:al )?pastor|costillas?|tripas?|cabezas?|prensado|lenguas?|chorizo|pollo|chicken|carnitas|buche|birria|deshebrada|picadillo";
/** Meats the caller negated in this utterance: "de X no", "X no", "no X" (not a tag question "de X, ¿no?"). */
export function negatedMeats(text: string): string[] {
  const raw = String(text || "");
  const p = plain(raw); const out = new Set<string>();
  for (const m of p.matchAll(new RegExp(`\\b(?:de\\s+)?(${MEAT_WORDS})\\s+no\\b`, "g"))) {
    // "de costilla, ¿no?" is a confirmation, not a negation
    const word = m[1].split(" ").pop()!; const at = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").indexOf(word);
    if (at >= 0 && /^\s*,?\s*¿?\s*no\s*\?/u.test(raw.slice(at + word.length).normalize("NFD").replace(/\p{M}/gu, ""))) continue;
    const k = meatIn(m[1]); if (k) out.add(k);
  }
  for (const m of p.matchAll(new RegExp(`\\b(?:no\\s+(?:de|of|quiero|want)|not|no)\\s+(${MEAT_WORDS})\\b(?!\\s+(?:si|yes))`, "g"))) { const k = meatIn(m[1]); const prev = p.slice(0, m.index).trim().split(" ").pop() || ""; if (k && !/\bno\s+(?:mas|hay)\b/.test(m[0]) && !meatIn(prev)) out.add(k); }
  return [...out];
}
const isNeg = (t: Turn, meat: string) => t.speaker === "caller" && negatedMeats(t.text).includes(meat);
/** Post-call: a line whose meat the caller negated (and never later asked for) loses it; a "cuatro tacos" group is split into the meats the caller listed. */
export function applyNegatedMeat(cart: any[], turns: Turn[], menu: any[]): boolean {
  let changed = false;
  for (const l of [...cart]) {
    const k = kindOfLine(l); const meat = k && meatOfLine(l); if (!k || !meat) continue;
    const ni = turns.findIndex((t) => isNeg(t, meat)); if (ni < 0) continue;
    // asked for again later, positively ("sí, de costilla")
    if (turns.slice(ni + 1).some((t) => t.speaker === "caller" && meatIn(plain(t.text)) === meat && !negatedMeats(t.text).includes(meat))) continue;
    const later: Record<string, number> = {};
    for (const t of turns.slice(ni + 1)) { if (t.speaker !== "caller") continue;
      for (const m of plain(t.text).matchAll(new RegExp(`\\b(${NUMW}|otro|otra)\\s+(?:tacos?\\s+)?(?:de|del)\\s+(${MEAT_WORDS})\\b`, "g"))) {
        const mm = meatIn(m[2]); if (!mm || mm === meat) continue; const q = /^otr/.test(m[1]) ? 1 : numOf(m[1]);
        later[mm] = Math.max(later[mm] || 0, q); } } // a restated "dos de tripa" restates
    const style = (l.modifiers || []).find((m: any) => /tortilla options/i.test(m.step))?.option;
    const st: Exp["style"] = /taquer|street/i.test(style || "") ? "taquero" : /comal/i.test(style || "") ? "comal" : /harina|flour/i.test(style || "") ? "harina" : undefined;
    const group = l.quantity || 1; const sum = Object.values(later).reduce((a, b) => a + b, 0);
    cart.splice(cart.indexOf(l), 1); changed = true;
    if (!sum || sum > group) continue;
    for (const [mm, q] of Object.entries(later)) {
      const ex = cart.find((x) => kindOfLine(x) === k && meatOfLine(x) === mm);
      if (ex) { ex.quantity = Math.max(ex.quantity || 0, q); continue; }
      const b = baseItem(menu, k); if (!b) continue; const nl: any = { itemId: b.id, quantity: q, modifiers: [] }; setLine(nl, { kind: k, meat: mm, qty: q, style: st }, menu); cart.push(nl);
    }
  }
  return changed;
}
/** Tacos Dorados the caller never asked for ("dorados", "flautas", "crispy rolled") next to plain tacos of that meat are a phantom. */
export function dropUnsaidDorados(cart: any[], turns: Turn[]): boolean {
  const caller = plain(turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" "));
  if (/\b(?:dorad[oa]s?|flautas?|rolled|crispy)\b/.test(caller)) return false;
  let changed = false;
  for (let i = cart.length - 1; i >= 0; i--) { const l = cart[i]; if (!/^sq-tacos-dorados-/.test(String(l.itemId))) continue;
    const m = meatOfLine(l); if (cart.some((x) => kindOfLine(x) === "taco" && (!m || meatOfLine(x) === m))) { cart.splice(i, 1); changed = true; } }
  return changed;
}
/** Live: an add/update action carrying a meat the caller just negated drops that meat (Elvi then asks which). */
export function noNegatedMeat(r: any, input: any) {
  const neg = negatedMeats(String(input?.transcript || "")); if (!neg.length || !Array.isArray(r?.actions)) return r;
  let hit = false;
  const actions = r.actions.map((a: any) => { if (!a || !Array.isArray(a.modifiers)) return a;
    const mods = a.modifiers.filter((m: any) => { const k = meatIn(plain(m.option)); const bad = !!k && neg.includes(k) && /carne|meat/i.test(String(m.step || m.groupName || "")); if (bad) hit = true; return !bad; });
    return mods.length === a.modifiers.length ? a : { ...a, modifiers: mods }; });
  return hit ? { ...r, actions } : r;
}
