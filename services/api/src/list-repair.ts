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

// aaron1 (CA2217937, Oct 30 7:57 PM ET, English pickup): "two flour steak quesadilla deluxe, sour cream on the side … rice and beans
// on the side" → staff "combo of rice and beans". Elvi put Con Frijoles in the quesadillas, never rang the sour cream on the side
// or the rice-and-beans side.
const RICE_BEANS = /\b(?:rice\s+(?:and|&|n)\s+beans|beans\s+(?:and|&)\s+rice|arroz\s+y\s+frijol(?:es)?|frijoles\s+y\s+arroz)\b/i;
/** Beans/rice only ever said as "rice and beans" are the side, not a filling. */
export function beansOnlyAsSide(text: string): boolean {
  const p = String(text || "").toLowerCase();
  return RICE_BEANS.test(p) && !/\b(?:with|con)\s+(?:(?:beans|frijol(?:es)?)(?!\s+(?:and|&|y)\s+(?:rice|arroz))|(?:rice|arroz)(?!\s+(?:and|&|n|y)\s+(?:beans|frijol)))\b/i.test(p);
}
export function applyRiceBeansSide(cart: any[], turns: Turn[], menu: any[]): boolean {
  const said = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" . ");
  if (!RICE_BEANS.test(said) || !beansOnlyAsSide(said)) return false;
  // staff said none / caller declined → nothing
  if (turns.some((t) => t.speaker === "staff" && /\b(?:no\s+(?:tenemos|hay)\s+arroz|no\s+rice|out\s+of\s+rice)\b/i.test(t.text))) return false;
  let changed = false;
  for (const l of cart) { if (!/^sq-(?:quesadilla|qd|taco|gordita|burrito|torta)-/.test(String(l.itemId))) continue;
    const before = (l.modifiers || []).length; l.modifiers = (l.modifiers || []).filter((m: any) => !/^\*\*Con (?:Frijoles|Arroz)\b/i.test(String(m.option))); if (l.modifiers.length !== before) changed = true; }
  const agreed = turns.some((t) => t.speaker === "staff" && RICE_BEANS.test(t.text)) || /\b(?:on the side|aparte|de lado)\b/i.test(said);
  const hasSide = cart.some((l) => /^sq-sides-|^sq-combo-/.test(String(l.itemId)) || (l.modifiers || []).some((m: any) => /COMBO Sides|ET Side/i.test(String(m.step))));
  const side = menu.find((m) => /^sq-sides-arroz-rice/.test(m.id));
  if (agreed && !hasSide && side) {
    const g = (side.modifierGroups || [])[0]; const opt = (g?.options || []).map(oname).find((o: string) => /^Arroz - Rice and Frijole/i.test(o));
    if (opt) { cart.push({ itemId: side.id, quantity: 1, modifiers: [{ step: g.name, option: opt }] }); changed = true; }
  }
  return changed;
}
/** "sour cream on the side": deluxe already includes crema → a note on that line; without deluxe → the EXTRA SIDE Crema. */
export function applyCremaOnSide(cart: any[], turns: Turn[], menu: any[]): boolean {
  const t = turns.find((x) => x.speaker === "caller" && /\b(?:sour\s*cream|crema)\b[^.?]{0,20}\b(?:on\s+the\s+side|aparte|a\s+un\s+lado|de\s+lado)\b/i.test(x.text));
  if (!t) return false;
  const food = cart.filter((l) => /^sq-(?:quesadilla|qd|taco|gordita|burrito|torta|tostada|sope)/.test(String(l.itemId)));
  if (!food.length) return false;
  let changed = false;
  for (const l of food) {
    if ((l.elviNotes || []).some((n: string) => /crema.*(?:aparte|side)/i.test(n)) || (l.modifiers || []).some((m: any) => /EXTRA SIDE Crema/i.test(m.option))) continue;
    if ((l.modifiers || []).some((m: any) => /^DELUXE/i.test(m.option))) { l.elviNotes = [...(l.elviNotes || []), "crema / sour cream aparte (on the side)"]; changed = true; continue; }
    const g = groups(menu, l.itemId).find((g) => (g.options || []).some((o: any) => /EXTRA SIDE Crema/i.test(oname(o))));
    if (g) { l.modifiers = [...(l.modifiers || []), { step: g.name, option: (g.options || []).map(oname).find((o: string) => /EXTRA SIDE Crema/i.test(o)) }]; changed = true; }
  }
  return changed;
}
/** Live: "rice and beans" in the turn never becomes a Con Frijoles / Con Arroz filling. */
export function noRiceBeansFilling(r: any, input: any) {
  const tx = String(input?.transcript || ""); if (!beansOnlyAsSide(tx) || !Array.isArray(r?.actions)) return r;
  let hit = false;
  const actions = r.actions.map((a: any) => { if (!Array.isArray(a?.modifiers)) return a; const ms = a.modifiers.filter((m: any) => !/^\*\*Con (?:Frijoles|Arroz)\b/i.test(String(m.option))); if (ms.length !== a.modifiers.length) hit = true; return { ...a, modifiers: ms }; });
  if (!hit) return r;
  return { ...r, actions, reply: String(r.reply || "").replace(/,?\s*with (?:beans|rice)(?=,|\.)/gi, "") };
}
/** Live: staff already answered which combo / staff picked the dish, and the cart has the dish with its choices → no re-ask. */
export function noReaskAnswered(r: any, input: any) {
  const reply = String(r?.reply || ""); if (!reply.trim().endsWith("?") || (r?.actions || []).length) return r;
  const h: any[] = input?.history || []; const lastStaff = String([...h].reverse().find((x) => x.role === "assistant")?.text || "");
  const staffTurns = h.filter((x: any) => x.role === "assistant").map((x: any) => String(x.text || "")).join(" ");
  const cart: any[] = input?.cart || []; const en = input?.language === "en"; const ack = { ...r, reply: en ? "Okay." : "Muy bien." };
  // "Which combo? Tacos, Quesadillas…" after staff said "the combo rice and beans"
  if (/\b(?:which|qu[eé]|cu[aá]l)\s+combo\b/i.test(reply) && RICE_BEANS.test(staffTurns + " " + lastStaff)) return ack;
  // re-asking tortilla / meat for a dish whose every cart line already has both
  const asks = reply.match(/\b(quesadillas?|tacos?|gorditas?|tortas?|burritos?)\b/i); if (!asks) return r;
  const re = new RegExp(`^sq-${asks[1].toLowerCase().replace(/s$/, "")}`);
  const lines = cart.filter((l) => re.test(String(l.itemId))); if (!lines.length) return r;
  // robert1: a burrito has no tortilla step — its meat alone answers "Burrito: Bistec, Cabeza…?"
  const noTort = /^burrito/i.test(asks[1]);
  const done = lines.every((l) => (noTort || (l.modifiers || []).some((m: any) => /tortilla|shell|options/i.test(String(m.step)) && !/salsa|deluxe/i.test(String(m.step)))) && (l.modifiers || []).some((m: any) => /carne|meat/i.test(String(m.step)) && meatIn(plain(String(m.option)))));
  if (done && /\b(?:what meat|qu[eé] carne|how many|cu[aá]nt[oa]s|comal|harina|taquer|bistec,|or\b)/i.test(reply) && !/\b(?:another|otra|more|m[aá]s)\b/i.test(String(input?.transcript || ""))) return ack;
  return r;
}

// braulio1 (CA690aaab, Oct 30 8:48 PM ET, Spanish staff-answered pickup): "dos tortas de tripas bien doradas … solas, la verdura
// aparte", "dos tacos, tres tacos chicos de bistec", "una orden de arroz … ¿chica o grande? Chica".
const DISH_KIND: Array<[RegExp, RegExp]> = [[/\btortas?\b/, /^sq-torta-/], [/\bhuaraches?\b|\bguaraches?\b/, /^sq-huarache-/], [/\bgorditas?\b/, /^sq-gordita-/],
  [/\bsopes?\b/, /^sq-sope/], [/\bburritos?\b/, /^sq-burrito-/], [/\btacos?\b/, /^sq-taco-/], [/\bquesadillas?\b/, /^sq-quesadilla-|^sq-qd-/]];
const kindRe = (p: string) => { let best: [number, RegExp] | null = null; for (const [w, id] of DISH_KIND) { const m = p.match(w); if (m && (!best || (m.index || 0) < best[0])) best = [m.index || 0, id]; } return best?.[1] || null; };
const meatOpt = (l: any) => (l.modifiers || []).map((m: any) => meatIn(plain(m.option))).find(Boolean) || null;
/** "torta/taco de tripa bien dorada" — dorada cooks the meat: never a Quesadilla Dorada; it's the note "tripa bien dorada". */
export function applyMeatBienDorada(cart: any[], turns: Turn[]): boolean {
  let changed = false;
  for (const t of turns) { if (t.speaker !== "caller") continue; const p = plain(t.text);
    for (const m of p.matchAll(/\b(tortas?|tacos?|huaraches?|guaraches?|gorditas?|sopes?|burritos?)\s+de\s+([a-z]+?)s?\s+(?:bien\s+)?dorad[oa]s?\b/g)) {
      const meat = meatIn(m[2]); const kid = kindRe(m[1]); if (!meat || !kid) continue;
      const saidQd = turns.some((x) => x.speaker === "caller" && /\bquesadillas?\s+dorad|\bqd\b|\bdoradas?\s+de\b|^\W*(?:unas?\s+|\d+\s+|dos\s+|tres\s+)?doradas?\b/.test(plain(x.text)));
      if (!saidQd) for (let i = cart.length - 1; i >= 0; i--) if (/^sq-qd-/.test(cart[i].itemId) && meatOpt(cart[i]) === meat) { cart.splice(i, 1); changed = true; }
      const note = `${meat} bien dorada`;
      for (const l of cart) if (kid.test(l.itemId) && meatOpt(l) === meat && !(l.elviNotes || []).includes(note)) { l.elviNotes = [...(l.elviNotes || []), note]; changed = true; }
    } }
  return changed;
}
/** "solas" / "la verdura aparte" said about the dish of this or the previous caller turn: plain (no Queso upgrade nobody said) + note. */
export function applySolasVerduraAparte(cart: any[], turns: Turn[], menu: any[]): boolean {
  let changed = false; const callers = turns.filter((t) => t.speaker === "caller");
  callers.forEach((t, k) => { const p = plain(t.text);
    const aparte = /\b(?:verduras?|vegetales|toppings?|veggies)\s+(?:por\s+)?(?:aparte|separado|on the side)\b|\baparte\s+la\s+verdura\b/.test(p);
    const solas = /\bsol[ao]s\b|\bsol[ao]\b(?!\s+(?:arroz|frijol))/.test(p);
    if (!aparte && !solas) return;
    const kid = kindRe(p) || (callers[k - 1] && kindRe(plain(callers[k - 1].text))); if (!kid) return;
    for (const l of cart) { if (!kid.test(l.itemId)) continue;
      if (aparte && !(l.elviNotes || []).includes("verdura aparte")) { l.elviNotes = [...(l.elviNotes || []), "verdura aparte"]; changed = true; }
      if (solas && !callers.some((c) => /\bqueso\b|\bcheese\b/.test(plain(c.text)))) {
        const g = groups(menu, l.itemId).find((g) => (g.options || []).map(oname).some((o: string) => /^\(QTO\) Queso Torta/.test(o)));
        const plainOpt = g && (g.options || []).map(oname).find((o: string) => /^\(TO\) Torta$/.test(o));
        if (plainOpt) { const ms = (l.modifiers || []).map((m: any) => /^\(QTO\)/.test(m.option) ? { ...m, option: plainOpt } : m); if (JSON.stringify(ms) !== JSON.stringify(l.modifiers)) { l.modifiers = ms; changed = true; } }
        l.elviNotes = (l.elviNotes || []).filter((n: string) => !/^confirmar \(B\) Torta Carne/.test(n) || !meatOpt(l));
      } }
  });
  return changed;
}
/** "dos tacos, tres tacos chicos de bistec" — the last count said for that dish+meat in the turn wins (and the staff readback agrees). */
export function applySpokenCount(cart: any[], turns: Turn[]): boolean {
  let changed = false;
  for (const t of turns) { if (t.speaker !== "caller") continue; const p = plain(t.text);
    const hits = [...p.matchAll(new RegExp(`\\b(${NUMW})\\s+(tacos?|tortas?|quesadillas?|gorditas?|sopes?|huaraches?)\\b((?:\\s+(?!(?:${NUMW})\\b)[a-z]+)*)`, "g"))];
    if (hits.length < 2) continue;
    const last = hits[hits.length - 1]; const meat = meatIn(last[3]); const kid = kindRe(last[2]); const n = numOf(last[1]);
    if (!meat || !kid || !n || !hits.slice(0, -1).some((h) => kindRe(h[2])?.source === kid.source && !meatIn(h[3]))) continue;
    const ls = cart.filter((l) => kid.test(l.itemId) && meatOpt(l) === meat); if (ls.length !== 1 || ls[0].quantity === n) continue;
    const later = turns.slice(turns.indexOf(t) + 1).filter((x) => x.speaker === "caller").some((x) => kindRe(plain(x.text))?.source === kid.source && meatIn(plain(x.text)) === meat);
    if (!later) { ls[0].quantity = n; changed = true; }
  }
  return changed;
}
const SIZE_WORD = /^\W*(?:la\s+|el\s+|una?\s+)?(chic[ao]|small|peque[nñ][ao]|regular|grande|large|big)\b/;
/** "¿chica o grande?" → "Chica": the open Sides line gets the catalog size option (chica/small = regular, grande = GRANDE). */
export function applySideSize(cart: any[], turns: Turn[], menu: any[]): boolean {
  let changed = false;
  turns.forEach((t, i) => { if (t.speaker !== "caller") return; const m = plain(t.text).match(SIZE_WORD); if (!m) return;
    const ask = turns.slice(Math.max(0, i - 2), i).reverse().find((x) => x.speaker === "staff");
    if (!ask || !/\b(?:chic[ao]|small|regular)\b[^?]*\b(?:o|or)\b[^?]*\b(?:grande|large)\b/.test(plain(ask.text))) return;
    const said = plain(ask.text) + " " + turns.slice(Math.max(0, i - 4), i).map((x) => plain(x.text)).join(" ");
    const l = [...cart].reverse().find((l) => /^sq-sides-/.test(l.itemId) && !(l.modifiers || []).length && (/arroz|rice/.test(said) || /frijol|beans/.test(said)));
    const item = l && menu.find((x) => x.id === l.itemId); if (!item) return;
    const g = (item.modifierGroups || [])[0]; if (!g) return; const opts: string[] = (g.options || []).map(oname); const big = /grande|large|big/.test(m[1]);
    const rice = /arroz|rice/.test(said), beans = /frijol|beans/.test(said);
    const o = opts.find((o) => (big ? /^GRANDE/i.test(o) : !/^GRANDE/i.test(o)) && (rice && beans ? /rice/i.test(o) && /beans/i.test(o) : rice ? /rice/i.test(o) && !/beans/i.test(o) : /beans/i.test(o) && !/rice/i.test(o)));
    if (o) { l.modifiers = [{ step: g.name, option: o }]; changed = true; }
  });
  return changed;
}
/** Live: bare "Chica"/"Grande" answering "¿chica o grande?" about the side just rung → set its size, never "Not added". */
export function liveSideSize(r: any, input: any) {
  const tx = plain(String(input?.transcript || "")); const m = tx.match(SIZE_WORD); if (!m || tx.split(" ").length > 4) return r;
  const h: any[] = input?.history || []; const lastStaff = plain(String([...h].reverse().find((x) => x.role === "assistant")?.text || ""));
  if (!/\b(?:chic[ao]|small|regular)\b[^?]*\b(?:o|or)\b[^?]*\b(?:grande|large)\b/.test(lastStaff)) return r;
  if ((r?.actions || []).some((a: any) => a.type === "add_item" || a.type === "update_item")) return r;
  const cart: any[] = input?.cart || []; const l = [...cart].reverse().find((l) => /^sq-sides-/.test(String(l.itemId))); if (!l) return r;
  const item = (input?.menu || input?.resolverMenu || []).find((x: any) => x.id === l.itemId); const g = item?.modifierGroups?.[0]; if (!g) return r;
  const big = /grande|large|big/.test(m[1]); const rice = /arroz|rice/.test(lastStaff), beans = /frijol|beans/.test(lastStaff);
  const opts: string[] = (g.options || []).map(oname);
  const o = opts.find((o) => (big ? /^GRANDE/i.test(o) : !/^GRANDE/i.test(o)) && (rice && beans ? /rice/i.test(o) && /beans/i.test(o) : rice ? /rice/i.test(o) && !/beans/i.test(o) : beans ? /beans/i.test(o) && !/rice/i.test(o) : true));
  if (!o) return r; const en = input?.language === "en";
  return { ...r, actions: [{ type: "update_item", itemId: l.itemId, quantity: l.quantity || 1, modifiers: [{ step: g.name, option: o }] }], reply: en ? `${big ? "Large" : "Small"}. Anything else?` : `${big ? "Grande" : "Chica"}. ¿Algo más?` };
}

// christopher1 (CAdd2004, Oct 31 10:07 AM ET): "¿con pata o sin pata?" → "Sin patas." rang the Con Pata option; "quesadilla de
// tripo" (STT for tripa) rang Bistec. daniela1 (CA1acb74): "al lado chiles de los toreados con cebolla" + staff "¿Cebolla y chiles
// asados?" → "Sí" never rang Extras Cebolla y Chiles Asados.
const said = (turns: Turn[], who: string) => turns.filter((t) => t.speaker === who).map((t) => plain(t.text)).join(" | ");
/** Caller chose no pata: "sin pata(s)", or "regular"/"normal" answering "¿con pata o …?". Never when the caller said "con pata". */
export function callerSinPata(turns: Turn[]): boolean {
  const c = said(turns, "caller"); if (/\bcon (?:la )?patas?\b/.test(c) && !/\bsin (?:la )?patas?\b/.test(c)) return false;
  if (/\bsin (?:la )?patas?\b/.test(c)) return !/\bcon (?:la )?patas?\b/.test(c.replace(/\b(?:no|sin)\b[^|]*?\bcon (?:la )?patas?\b/g, ""));
  return turns.some((t, i) => t.speaker === "caller" && /^(?:la |el )?(?:regular|normal|sencillo)\b/.test(plain(t.text))
    && /\bcon (?:la )?patas?\b[^?]*\b(?:o|or)\b/.test(plain([...turns.slice(Math.max(0, i - 2), i)].reverse().find((x) => x.speaker === "staff")?.text || "")));
}
const CON_PATA = /con pata|extra pata|beef feet/i;
const fixMenudoMods = (mods: any[], menuItem: any) => {
  const g = (menuItem?.modifierGroups || []).find((g: any) => (g.options || []).some((o: any) => CON_PATA.test(oname(o))));
  const reg = g && (g.options || []).map(oname).find((o: string) => /menudo/i.test(o) && !CON_PATA.test(o));
  let hit = false; const out = (mods || []).filter((m: any) => { if (CON_PATA.test(String(m.option))) { hit = true; return false; } return true; });
  if (hit && reg && g && !out.some((m: any) => m.step === g.name)) out.unshift({ step: g.name, option: reg });
  return { mods: out, hit };
};
export function applyMenudoSinPata(cart: any[], turns: Turn[], menu: any[]): boolean {
  if (!callerSinPata(turns)) return false; let changed = false;
  for (const l of cart) { if (!/menudo/i.test(String(l.itemId))) continue;
    if (/con-pata/i.test(String(l.itemId))) { const reg = menu.find((m) => /^sq-menudo-/.test(m.id) && /menudo/i.test(m.id) && !/con-pata/.test(m.id)); if (reg) { l.itemId = reg.id; changed = true; } }
    const r = fixMenudoMods(l.modifiers, menu.find((m) => m.id === l.itemId)); if (r.hit) { l.modifiers = r.mods; changed = true; } }
  return changed;
}
/** STT "tripo"/"tripita(s)" = tripa. */
export const fixTripaStt = (s: string) => String(s || "").replace(/\btrip(?:o|os|itas?)\b/giu, "tripa");
const DISH_RE = /\b(?:quesadillas?|tacos?|tortas?|gorditas?|sopes?|huaraches?|burritos?)\b/;
/** The caller named exactly one meat for a q/taco line ("quesadilla de tripo") but the line has another, never-said meat → that meat. */
export function applySaidMeat(cart: any[], turns: Turn[], menu: any[]): boolean {
  const c = plain(fixTripaStt(turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" "))).replace(/\bsalsa (?:de )?asada\b|\bchiles? asad[oa]s?\b/g, " "); let changed = false;
  if (!DISH_RE.test(c)) return false;
  const saidMeats = new Set(MEATS.filter(([re]) => re.test(c)).map(([, k]) => k)); if (saidMeats.size !== 1) return false;
  const want = [...saidMeats][0];
  for (const l of cart) { if (!kindOfLine(l)) continue; const m = (l.modifiers || []).find((x: any) => /carne|meat/i.test(String(x.step))); if (!m) continue;
    const k = meatIn(plain(String(m.option))); if (!k || k === want || saidMeats.has(k)) continue;
    const g = (menu.find((x) => x.id === l.itemId)?.modifierGroups || []).find((g: any) => g.name === m.step);
    const o = (g?.options || []).map(oname).find((o: string) => meatIn(plain(o)) === want);
    if (o) { m.option = o; changed = true; } else { l.elviNotes = [...(l.elviNotes || []), want]; changed = true; } }
  return changed;
}
const ASADOS_CALLER = /\b(?:chiles?|chilitos?)\b[^|]*\b(?:toreados?|asados?)\b|\b(?:toreados?|asados?)\b[^|]*\b(?:cebollas?|cebollitas?)\b|\bcebollas? y chiles?\b/;
const ASADOS_STAFF = /\bcebollas? y chiles? asados\b|\b(?:chiles )?toreados\b/;
const YES = /^(?:si|yes|yeah|ok(?:ay)?|aja|claro|por favor|eso)\b/;
export const asadosSideSaid = (turns: Turn[]) => turns.some((t, i) => t.speaker === "caller" && (ASADOS_CALLER.test(plain(t.text))
  || (YES.test(plain(t.text)) && ASADOS_STAFF.test(plain([...turns.slice(Math.max(0, i - 2), i)].reverse().find((x) => x.speaker === "staff")?.text || "")))));
const hasAsados = (cart: any[]) => cart.some((l) => (l.modifiers || []).some((m: any) => /cebolla y chiles asados/i.test(String(m.option))));
export function applyAsadosSide(cart: any[], turns: Turn[], menu: any[]): boolean {
  if (hasAsados(cart) || !asadosSideSaid(turns)) return false;
  const ex = menu.find((m) => (m.modifierGroups || []).some((g: any) => /^extras options$/i.test(g.name) && (g.options || []).some((o: any) => /^cebolla y chiles asados$/i.test(oname(o)))));
  if (!ex) return false;
  cart.push({ itemId: ex.id, quantity: 1, modifiers: [{ step: "Extras options", option: "Cebolla y Chiles Asados" }] }); return true;
}
/** Live: same three repairs on the turn's add/update actions (menu = input.menu). */
export function liveChristopher(r: any, input: any) {
  const menu: any[] = input?.menu || input?.resolverMenu || []; const h: any[] = input?.history || [];
  const turns: Turn[] = [...h.map((x: any) => ({ speaker: x.role === "assistant" ? "staff" : "caller", text: String(x.text || "") })), { speaker: "caller", text: String(input?.transcript || "") }];
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; if (!menu.length) return r;
  const lines = acts.filter((a) => a.type === "add_item" || a.type === "update_item");
  const tmp = lines.map((a) => ({ itemId: a.itemId, modifiers: (a.modifiers || []).map((m: any) => ({ ...m })) }));
  const turnOnly: Turn[] = turns.slice(-3);
  const ch = applyMenudoSinPata(tmp, turns, menu) || false; const ch2 = applySaidMeat(tmp, turnOnly, menu);
  if (ch || ch2) tmp.forEach((t, i) => { lines[i].itemId = t.itemId; lines[i].modifiers = t.modifiers; });
  const lastTwo = turns.slice(-3); const cartNow = [...(input?.cart || []), ...tmp];
  if (asadosSideSaid(lastTwo) && !hasAsados(cartNow)) { const add: any[] = []; if (applyAsadosSide(add, lastTwo, menu)) return { ...r, actions: [...acts, { type: "add_item", ...add[0] }] }; }
  return ch || ch2 ? { ...r, actions: acts } : r;
}

// hominy1 (CAa025cf, Oct 31 10:21 AM ET): "un menudo con maíz de pozole" = menudo with hominy (a note), never a Pozole dish.
const HOMINY = /\bmenudos?\b[^|]{0,40}?\bcon (?:el |la )?(?:maiz(?: de pozole)?|pozole|hominy)\b|\bmenudo with hominy\b/;
const POZOLE_DISH = /\b(?:una?|dos|tres|\d+|orden(?:es)? de|order of)\s+(?:de )?pozoles?\b(?! con)|\bpozole (?:rojo|verde|blanco)\b/;
export const hominyOnMenudo = (text: string) => HOMINY.test(plain(text));
export function applyMenudoHominy(cart: any[], turns: Turn[]): boolean {
  const c = said(turns, "caller"); if (!HOMINY.test(c)) return false;
  const dishSaid = POZOLE_DISH.test(c.replace(new RegExp(HOMINY.source, "g"), " "));
  let changed = false;
  if (!dishSaid) for (let i = cart.length - 1; i >= 0; i--) if (/^sq-pozole-/.test(String(cart[i].itemId))) { cart.splice(i, 1); changed = true; }
  const m = cart.find((l) => /menudo/i.test(String(l.itemId)));
  if (m && !(m.elviNotes || []).some((n: string) => /maiz|maíz|hominy/i.test(n))) { m.elviNotes = [...(m.elviNotes || []), "con maíz de pozole (hominy)"]; changed = true; }
  return changed;
}
// dayana2 (CAa2bf38): staff "¿preparadas o normales?" / "¿Tres?" rang a 2nd REGULAR QD twin of the DELUXE bistec pair.
const QD_REG = /^sq-qd-.*regular/i, QD_DLX = /^sq-qd-.*(?:deluxe|preparada)/i;
const callerSaidNormalQd = (c: string) => /\b(?:normal(?:es)?|regular(?:es)?|sencillas?|sin preparar|plain)\b/.test(c);
const qdMeat = (l: any) => meatIn(plain((l.modifiers || []).filter((m: any) => /carne|meat/i.test(String(m.step))).map((m: any) => m.option).join(" ")));
export function dropQdRegularTwin(cart: any[], turns: Turn[]): boolean {
  if (callerSaidNormalQd(said(turns, "caller"))) return false; let changed = false;
  for (let i = cart.length - 1; i >= 0; i--) { const l = cart[i]; if (!QD_REG.test(String(l.itemId))) continue;
    if (cart.some((d) => d !== l && QD_DLX.test(String(d.itemId)) && qdMeat(d) === qdMeat(l))) { cart.splice(i, 1); changed = true; } }
  return changed;
}
/** Live: no Pozole add on a "menudo con maíz de pozole" turn; no REGULAR QD add twinning a rung DELUXE one unless the caller said normal. */
export function liveHominyQd(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; if (!acts.length) return r;
  const tx = String(input?.transcript || ""); const cart: any[] = input?.cart || [];
  const out = acts.filter((a) => {
    if (a.type === "add_item" && /^sq-pozole-/.test(String(a.itemId)) && hominyOnMenudo(tx) && !POZOLE_DISH.test(plain(tx).replace(new RegExp(HOMINY.source, "g"), " "))) return false;
    if (a.type === "add_item" && QD_REG.test(String(a.itemId)) && !callerSaidNormalQd(plain(tx))
      && [...cart, ...acts.filter((x) => x !== a)].some((d) => QD_DLX.test(String(d.itemId)) && qdMeat(d) === qdMeat(a))) return false;
    return true; });
  return out.length === acts.length ? r : { ...r, actions: out };
}

// menudo3 (CA435752, Oct 31 11:34 AM ET): "tres menudos, dos con pata" + staff "y uno regular, ¿verdad?" → "Sí" rang
// 3 con pata + 2 more con pata. The caller's total N with M con pata = M con pata + (N−M) regular, one line each.
const MENUDO_TOTAL = new RegExp(`\\b(${NUMW}) menudos?\\b`), PATA_N = new RegExp(`\\b(${NUMW}) (?:de |con )?(?:con )?pata\\b`);
const REG_N = new RegExp(`\\b(${NUMW}) (?:regular(?:es)?|normal(?:es)?|sencillos?|sin pata)\\b`);
export function menudoSplit(turns: Turn[]): { total: number; pata: number; reg: number } | null {
  const c = said(turns, "caller"); const t = c.match(MENUDO_TOTAL); if (!t) return null; const total = numOf(t[1]);
  const after = c.slice((t.index || 0) + t[0].length); const p = after.match(PATA_N) || c.match(PATA_N); if (!p) return null; const pata = numOf(p[1]);
  if (!(total >= 2 && pata >= 1 && pata < total)) return null;
  let reg = 0; const r = after.match(REG_N); if (r) reg = numOf(r[1]);
  else turns.forEach((x, i) => { if (x.speaker === "staff" && REG_N.test(plain(x.text)) && /\bmenudo|regular|normal|sin pata/.test(plain(x.text))) {
    const nx = turns.slice(i + 1, i + 3).find((y) => y.speaker === "caller"); if (nx && YES.test(plain(nx.text))) reg = numOf(plain(x.text).match(REG_N)![1]); } });
  return reg && pata + reg === total ? { total, pata, reg } : null;
}
export function applyMenudoSplit(cart: any[], turns: Turn[], menu: any[]): boolean {
  const s = menudoSplit(turns); if (!s) return false;
  const lines = cart.filter((l) => /^sq-menudo-/.test(String(l.itemId))); if (!lines.length) return false;
  const isPata = (l: any) => /con-pata/.test(String(l.itemId)) || (l.modifiers || []).some((m: any) => CON_PATA.test(String(m.option)));
  const q = (f: (l: any) => boolean) => lines.filter(f).reduce((a, l) => a + (Number(l.quantity) || 1), 0);
  if (q(isPata) === s.pata && q((l) => !isPata(l)) === s.reg && lines.length <= 2) return false;
  const tort = lines.flatMap((l) => l.modifiers || []).find((m: any) => /tortilla/i.test(String(m.step)) && !/extra/i.test(String(m.step)));
  const pataId = menu.find((m) => /^sq-menudo-con-pata/.test(m.id))?.id || "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
  const regId = menu.find((m) => /^sq-menudo-/.test(m.id) && !/con-pata/.test(m.id))?.id || "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
  const at = cart.indexOf(lines[0]); for (let i = cart.length - 1; i >= 0; i--) if (lines.includes(cart[i])) cart.splice(i, 1);
  const tm = tort ? [{ ...tort }] : [];
  cart.splice(at, 0, { itemId: pataId, quantity: s.pata, modifiers: [...tm], readback: `${s.pata} menudo con pata` },
    { itemId: regId, quantity: s.reg, modifiers: [{ step: "Menudo options", option: "Menudo con Tortillas (4)" }, ...tm.map((m) => ({ ...m }))], readback: `${s.reg} menudo regular` });
  return true;
}
// menudo3: staff reading the meat list ("cabeza, carnita, …, buche, lengua, … y birria") rang an "orden de birria"; the
// caller only said "uno de buche". A dish only staff named in a meat-list read is never added.
const LIST_DISHES: Array<[RegExp, RegExp]> = [[/\bbirrias?\b/, /^sq-birria/], [/\bmenud(?:o|os|ito|itos)\b/, /^sq-menudo-/], [/\bpozoles?\b/, /^sq-pozole-/]];
const isMeatListRead = (t: Turn) => t.speaker === "staff" && MEATS.filter(([re]) => re.test(plain(t.text))).length >= 5;
export function dropStaffListDish(cart: any[], turns: Turn[]): boolean {
  if (!turns.some(isMeatListRead)) return false; const c = said(turns, "caller"); let changed = false;
  for (const [w, id] of LIST_DISHES) { if (w.test(c)) continue;
    for (let i = cart.length - 1; i >= 0; i--) if (id.test(String(cart[i].itemId))) { cart.splice(i, 1); changed = true; } }
  return changed;
}
// alex2 (CAe64e71, 11:40 AM ET): "dos quesadillas de picadillo … las de picadillo serían de comal" + "otras dos de aceite / ¿Qué viste?
// Preparadas" (= doradas de bistec, preparadas). Elvi: phantom QD regular picadillo, the bistec QD as REGULAR, no extra salsa asada.
/** STT "qué viste" right after a meat ask = "bistec". */
export const fixBistecStt = (s: string) => String(s || "").replace(/\bqu[eé] viste\b/giu, "bistec");
const qcoMeat = (l: any) => /^sq-quesadilla-/.test(String(l.itemId)) && (l.modifiers || []).some((m: any) => /QCO|comal/i.test(String(m.option))) ? meatOfLine(l) : null;
/** QD line twinning a QCO line of the same meat the caller said goes "de comal" → drop the QD. */
export function dropQdComalTwin(cart: any[], turns: Turn[]): boolean { let changed = false;
  const comalMeats = new Set(turns.filter((t) => t.speaker === "caller").map((t) => plain(t.text)).filter((p) => /\bcomal\b/.test(p) && !/\bdorad/.test(p)).map(meatIn).filter(Boolean));
  for (let i = cart.length - 1; i >= 0; i--) { const l = cart[i]; if (kindOfLine(l) !== "qd") continue; const k = qdMeat(l) || meatOfLine(l);
    if (k && comalMeats.has(k) && cart.some((d) => qcoMeat(d) === k)) { cart.splice(i, 1); changed = true; } }
  return changed;
}
const DLX_ID = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
/** Caller said "preparada(s)" and never normal/regular → REGULAR QD lines become DELUXE Preparada. */
export function applyQdPreparada(cart: any[], turns: Turn[]): boolean {
  const c = preparadaWords(said(turns, "caller")); if (!/\bpreparad[ao]s?\b/.test(c) || callerSaidNormalQd(c.replace(/\bpreparad[ao]s? o (?:normal|regular)(?:es)?\b/g, ""))) return false;
  let changed = false;
  for (const l of cart) { if (!QD_REG.test(String(l.itemId)) && !(kindOfLine(l) === "qd" && (l.modifiers || []).some((m: any) => /REGULAR Dorada/i.test(String(m.option))))) continue;
    if (QD_DLX.test(String(l.itemId))) continue;
    l.itemId = DLX_ID; l.modifiers = [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, ...(l.modifiers || []).filter((m: any) => !/\(QD\)/.test(String(m.option)))];
    if (l.readback) l.readback = String(l.readback).replace(/regular/i, "deluxe preparada"); changed = true; }
  return changed;
}
// alex2: staff "¿No quieres salsa extra?" → "Sí, por favor, una." → "De la asada, ¿verdad?" → "Sí." = 1 Extras Mild Salsa Asada 2oz.
const SALSA_FLAV: Array<[RegExp, string]> = [[/\basada\b/, "Mild Salsa Asada"], [/\bverde\b/, "Medium Salsa Verde"], [/\broja\b/, "Hot Salsa Roja"], [/\btomate|tomato\b/, "Mild Salsa Tomato"]];
export function extraSalsaSaid(turns: Turn[]): { option: string; qty: number } | null {
  for (let i = 0; i < turns.length; i++) { const p = plain(turns[i].text);
    if (!/\bsalsas? extra\b|\bextra salsa\b|\bsalsa aparte\b/.test(p)) continue;
    const win = turns.slice(i, i + 5); if (!win.some((t) => t.speaker === "caller" && (YES.test(plain(t.text)) || new RegExp(`\\b(${NUMW})\\b`).test(plain(t.text))))) continue;
    if (win.some((t) => t.speaker === "caller" && /^no\b/.test(plain(t.text)))) continue;
    const ws = win.map((t) => plain(t.text)).join(" | "); const f = SALSA_FLAV.find(([re]) => re.test(ws)); if (!f) continue;
    const n = win.filter((t) => t.speaker === "caller").map((t) => plain(t.text).match(new RegExp(`\\b(${NUMW})\\b`))).find(Boolean);
    return { option: `${f[1]} 2oz`, qty: n ? numOf(n[1]) || 1 : 1 }; }
  return null;
}
export function applyExtraSalsa(cart: any[], turns: Turn[]): boolean {
  const s = extraSalsaSaid(turns); if (!s) return false;
  if (cart.some((l) => /^sq-extras-/.test(String(l.itemId)) && (l.modifiers || []).some((m: any) => /salsa/i.test(String(m.option))))) return false;
  if (cart.some((l) => (l.modifiers || []).some((m: any) => /EXTRA .*salsa/i.test(String(m.option)) && /salsa/i.test(s.option.split(" ")[1] || "")))) return false;
  cart.push({ itemId: "sq-extras-mild-salsa-asada-2oz-T6PGNT", quantity: s.qty, modifiers: [{ step: "Extras options", option: s.option }], readback: `${s.qty} salsa extra` }); return true;
}
/** Post-pass bundle for menudo3/alex2. */
export function applyMenudo3Alex2(cart: any[], turns: Turn[], menu: any[]) {
  const t2 = turns.map((t) => ({ ...t, text: fixBistecStt(t.text) }));
  applyMenudoSplit(cart, t2, menu); dropStaffListDish(cart, t2); dropQdComalTwin(cart, t2); applyQdPreparada(cart, t2); applyExtraSalsa(cart, t2);
}
/** Live: never add a birria/menudo/pozole the caller didn't say right after staff read the meat list. */
export function liveMenudo3(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; if (!acts.length) return r;
  const h: any[] = input?.history || []; const lastStaff = [...h].reverse().find((x: any) => x.role === "assistant");
  if (!lastStaff || !isMeatListRead({ speaker: "staff", text: String(lastStaff.text || "") })) return r;
  const tx = plain(String(input?.transcript || ""));
  const out = acts.filter((a) => !(a.type === "add_item" && LIST_DISHES.some(([w, id]) => id.test(String(a.itemId)) && !w.test(tx))));
  return out.length === acts.length ? r : { ...r, actions: out };
}

// luis3 (CA7a1e91, Oct 31 11:43 AM ET): "Tienen, venden tacos de birria" + 3 tacos taqueros de birria rang a phantom
// 1 lb Birria de Chivo; "media docena de tortillas" rang the 12-pack; reply said "Con Pata Menudo" for a regular menudo.
const BIRRIA_IN_DISH = /\b(?:tacos?|quesadillas?|qd|doradas?|tortas?|burritos?|gorditas?|sopes?|huaraches?|consomes?|consome)\s+(?:\w+\s+){0,2}?de\s+birria\b/g;
export function dropBirriaFromDish(cart: any[], turns: Turn[]): boolean {
  const c = said(turns, "caller"); if (!BIRRIA_IN_DISH.test(c)) return false; BIRRIA_IN_DISH.lastIndex = 0;
  if (/\bbirria\b/.test(c.replace(BIRRIA_IN_DISH, " "))) return false;
  if (!cart.some((l) => !/^sq-birria/.test(String(l.itemId)) && (l.modifiers || []).some((m: any) => /birria/i.test(String(m.option))))) return false;
  let changed = false; for (let i = cart.length - 1; i >= 0; i--) if (/^sq-birria/.test(String(cart[i].itemId))) { cart.splice(i, 1); changed = true; }
  return changed;
}
const HALF_DOZEN = /\bmedia docena\b|\bhalf (?:a )?dozen\b|\bseis tortillas\b|\b6 tortillas\b/;
export function applyHalfDozenTortillas(cart: any[], turns: Turn[], menu: any[]): boolean {
  const c = said(turns, "caller"); if (!HALF_DOZEN.test(c) || /\bdocena\b(?! de tortillas)[^|]*/.test(c.replace(/\bmedia docena\b/g, "")) && /\buna docena\b/.test(c)) return false;
  let changed = false;
  for (const l of cart) { const id = String(l.itemId); if (!/^sq-tortillas-12-x-/.test(id) || (Number(l.quantity) || 1) !== 1) continue;
    const pre = id.replace(/^sq-tortillas-12-x-/, "sq-tortillas-6-x-").replace(/-[A-Z0-9]+$/, "-");
    const six = menu.flatMap((m) => [m.id, ...(m.modifierGroups || []).flatMap((g: any) => (g.options || []).map((o: any) => o?.id))]).find((x) => typeof x === "string" && x.startsWith(pre));
    if (!six) continue; l.itemId = six; l.modifiers = (l.modifiers || []).map((m: any) => ({ ...m, option: String(m.option).replace(/^12 x/, "6 x") }));
    if (l.readback) l.readback = String(l.readback).replace(/\b12\b/, "6"); changed = true; }
  return changed;
}
/** Reply naming "Con Pata Menudo" when nothing in the turn's lines is con pata → say the regular menudo. */
export function fixMenudoReply(reply: string, lines: any[]): string {
  const r = String(reply || ""); if (!/con pata menudo/i.test(r)) return r;
  if (lines.some((l) => /con-pata/.test(String(l.itemId)) || (l.modifiers || []).some((m: any) => CON_PATA.test(String(m.option))))) return r;
  if (!lines.some((l) => /^sq-menudo-/.test(String(l.itemId)))) return r;
  if (/¿[^?]*\bo\b[^?]*con pata menudo/i.test(r) || /con pata menudo[^?]*\bo\b[^?]*\?/i.test(r)) return r; // a real "regular o con pata?" question
  return r.replace(/(?:Menudo\s+)?Con Pata Menudo 32oz y Tortillas \(4\)/gi, "Menudo con Tortillas (4)");
}
export function applyLuis3(cart: any[], turns: Turn[], menu: any[]) { dropBirriaFromDish(cart, turns); applyHalfDozenTortillas(cart, turns, menu); }
/** Live: no 1 lb birria added on a "tacos de birria" turn; regular-menudo reply never says con pata. */
export function liveLuis3(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; const cart: any[] = input?.cart || [];
  const tx = plain(String(input?.transcript || "")); let out = acts;
  if (BIRRIA_IN_DISH.test(tx)) { BIRRIA_IN_DISH.lastIndex = 0; if (!/\bbirria\b/.test(tx.replace(BIRRIA_IN_DISH, " ")))
    out = acts.filter((a) => !(a.type === "add_item" && /^sq-birria/.test(String(a.itemId)))); }
  BIRRIA_IN_DISH.lastIndex = 0;
  const reply = fixMenudoReply(r?.reply, [...out.filter((a) => a.type === "add_item" || a.type === "update_item"), ...(out.some((a) => /^sq-menudo-/.test(String(a.itemId))) ? [] : cart)]);
  return out === acts && reply === String(r?.reply || "") ? r : { ...r, actions: out, reply };
}

// alan1 (CA0a42f0, Oct 31 12:27 PM ET): "una de bistec y una de pastor" + "otra orden igual" → staff "entonces te tengo |
// dos tortas de bistec y dos tortas de al pastor" (read-back split over two staff turns); Elvi rang 3 bistec + 1 pastor.
// The final staff read-back's "N <dish> de <meat>" counts win for each (dish, meat) it names (any dish kind, joined turns).
export function finalReadbackPairs(turns: Turn[]): Array<{ id: RegExp; meat: string; qty: number }> {
  let i = -1; turns.forEach((t, j) => { if (t.speaker === "staff" && READBACK.test(plain(t.text))) i = j; }); if (i < 0) return [];
  let txt = plain(turns[i].text); for (let j = i + 1; j < turns.length && turns[j].speaker === "staff"; j++) txt += " " + plain(turns[j].text);
  txt = txt.slice(txt.search(READBACK));
  const re = new RegExp(`\\b(${NUMW})\\s+(?:(?:ordenes|orden) de\\s+)?([a-z]+)?\\s*(?:[a-z]+\\s+)?de\\s+((?:al\\s+)?[a-z]+)`, "g");
  const out: Array<{ id: RegExp; meat: string; qty: number }> = []; let last: RegExp | null = null; let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) { const id = (m[2] && kindRe(m[2])) || last; const meat = meatIn(m[3]); if (!id || !meat) continue; last = id;
    const prev = out.find((o) => o.id === id && o.meat === meat); if (prev) prev.qty += numOf(m[1]); else out.push({ id, meat, qty: numOf(m[1]) }); }
  return out;
}
/** The line's meat from its carne/meat step only (never "Mild Salsa Asada"); "Alpastor" = al pastor. */
const carneOf = (l: any) => { const m = (l.modifiers || []).find((x: any) => /carne|meat|relleno|filling/i.test(String(x.step)));
  return m ? meatIn(plain(String(m.option)).replace(/\balpastor\b/, "al pastor")) : null; };
export function applyReadbackCounts(cart: any[], turns: Turn[]): boolean {
  let changed = false;
  for (const p of finalReadbackPairs(turns)) { if (p.id.source.includes("taco") || p.id.source.includes("quesadilla")) continue; // applyStaffReadback owns tacos/q
    const ls = cart.filter((l) => p.id.test(String(l.itemId)) && carneOf(l) === p.meat); if (!ls.length || !p.qty) continue;
    const sum = ls.reduce((a, l) => a + (Number(l.quantity) || 1), 0); if (sum === p.qty && ls.length === 1) continue;
    ls[0].quantity = p.qty; for (const x of ls.slice(1)) cart.splice(cart.indexOf(x), 1); changed = true; }
  return changed;
}

// qco5 (CA1c1052, Oct 31 12:39 PM ET): "cinco quesadillas de maíz … dos de bistec y una … otras dos … del pastor … esa de
// costilla" rang 2 costilla (count carried) and a phantom 6 corn tortillas from "¿tiene tortilla de harina o de maíz?".
const TORT_ORDER = new RegExp(`\\b(?:${NUMW}|orden(?:es)?|paquetes?|docenas?|media|extra|aparte|mas)\\s+(?:\\w+\\s+){0,2}?tortillas?\\b|\\btortillas? (?:aparte|extra)\\b`);
/** A tortilla pack nobody ordered — the caller only asked which tortilla (harina/maíz) the dishes come in. */
export function dropTortillaStyleAsk(cart: any[], turns: Turn[]): boolean {
  if (!cart.some((l) => /^sq-tortillas-/.test(String(l.itemId))) || !cart.some((l) => kindOfLine(l))) return false;
  const ms = turns.filter((t) => t.speaker === "caller" && /\btortillas?\b/.test(plain(t.text))).map((t) => plain(t.text));
  if (ms.some((p) => TORT_ORDER.test(p))) return false;
  let ch = false; for (let i = cart.length - 1; i >= 0; i--) if (/^sq-tortillas-/.test(String(cart[i].itemId))) { cart.splice(i, 1); ch = true; } return ch;
}
/** "cinco quesadillas" stated, cart sums more: a line whose meat no one ever counted above 1 ("esa de costilla") goes to 1. */
export function applyStatedDishTotal(cart: any[], turns: Turn[]): boolean {
  let ch = false;
  for (const [fam, re] of [["q", /\bquesadillas\b/], ["taco", /\btacos\b/]] as const) {
    let N = 0; for (const t of turns) { if (t.speaker !== "caller") continue; const m = plain(t.text).match(new RegExp(`\\b(${NUMW})\\s+${re.source.slice(2)}`)); if (m) N = Math.max(N, numOf(m[1])); }
    const ls = cart.filter((l) => kindOfLine(l) && famOf(kindOfLine(l)!) === fam); if (!N || N < 2) continue;
    let sum = ls.reduce((a, l) => a + (Number(l.quantity) || 1), 0); if (sum <= N) continue;
    const counted: Record<string, number> = {};
    for (const t of turns) { const p = plain(t.text); for (const m of p.matchAll(new RegExp(`\\b(${NUMW})\\s+(?=((?:\\w+\\s*){0,4}))`, "g"))) { const seg = m[2].split(new RegExp(`\\b(?:${NUMW})\\b`))[0]; const k = meatIn(seg); if (k) counted[k] = Math.max(counted[k] || 0, numOf(m[1])); } }
    for (const l of ls) { const k = meatOfLine(l); const q = Number(l.quantity) || 1; if (sum <= N || q < 2 || !k || (counted[k] || 0) >= q) continue;
      const nq = Math.max(counted[k] || 1, q - (sum - N)); sum -= q - nq; l.quantity = nq; ch = true; }
  }
  return ch;
}
// guero1 (CA0376b4, Oct 31 12:43 PM ET): staff recap "por último serían dos de preparadas de al pastor no crema y una
// preparada de de viste no crema" … "Y dos tacos de lengua de comal y un taco de comal de al pastor" — the recap (split
// over staff turns around caller acks) rebuilds the taco/quesadilla/QD lines, deluxe ids and "sin crema" notes.
const RECAP = /\b(?:tengo en|por ultimo|serian|seria|entonces (?:son|serian|es)|te tengo|le tengo)\b/;
export function staffRecapText(turns: Turn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) { const t = turns[i]; if (t.speaker !== "staff" || !RECAP.test(plain(t.text))) continue;
    const parts: string[] = [];
    for (let j = i; j < Math.min(turns.length, i + 6); j++) { const x = turns[j]; const p = plain(fixBistecStt(x.text));
      if (x.speaker === "staff" && new RegExp(`\\b(${NUMW})\\b`).test(p) && (meatIn(p) || /\bviste\b/.test(p))) parts.push(p); }
    if (!parts.length) continue;
    let txt = parts.join(" y ").replace(/\bde (?:de )?viste\b/g, "de bistec").replace(/\b(?:de )+(preparad|dorad)/g, "$1")
      .replace(new RegExp(`\\b(${NUMW}) (preparad[ao]s?|dorad[ao]s?)\\b`, "g"), "$1 quesadillas $2");
    return txt;
  }
  return null;
}
export function applyStaffRecap(cart: any[], turns: Turn[], menu: any[]): boolean {
  const txt = staffRecapText(turns); if (!txt) return false;
  const lines = parseList(txt); if (lines.length < 2 || lines.some((e) => !e.meat)) return false;
  const nx = turns.find((t, i) => i > 0 && t.speaker === "caller" && /^(?:no\b|falta|cambia)/.test(plain(t.text)) && turns.slice(0, i).some((s) => s.speaker === "staff" && plain(s.text).includes(txt.slice(0, 12))));
  if (nx) return false;
  if (!applyStaffReadback(cart, [...turns, { speaker: "staff", text: "te tengo " + txt }], menu)) return false;
  applyQdPreparada(cart, turns.map((t) => ({ ...t, text: preparadaWords(t.text) })));
  const sinCrema = /\b(?:no|sin) crema\b/.test(txt);
  for (const l of cart) { if (kindOfLine(l) !== "qd") continue;
    if ((l.modifiers || []).some((m: any) => /DELUXE Preparada/i.test(String(m.option))) && !QD_DLX.test(String(l.itemId))) {
      l.itemId = DLX_ID; l.modifiers = [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, ...(l.modifiers || []).filter((m: any) => !/\(QD\)|DELUXE|APARTE/i.test(String(m.option)))]; }
    if (sinCrema && QD_DLX.test(String(l.itemId)) && !(l.elviNotes || []).some((n: string) => /crema/i.test(n))) l.elviNotes = [...(l.elviNotes || []), "sin crema"]; }
  return true;
}

// rolando1 (CA4f6740, Oct 31 1:21 PM ET): "doradas … ¿preparadas? … de las que dicen verdura" = DELUXE Preparada.
export const preparadaWords = (s: string) => String(s || "").replace(/\b(?:de )?(?:las|los) que (?:dicen|traen|llevan|tienen) (?:la )?verduras?\b|\bcon (?:toda )?(?:la )?verduras?\b|\bwith (?:the )?veggies\b/giu, "preparadas");
// marta1 (CAc8d287, Oct 31 1:15 PM ET): 2 QCO buche → "buche con chorizo" → staff "Buche con chorizo, las dos." rang
// 2 plain buche + 1 buche/chorizo; "una de chicharrón prestado" (STT for prensado) never rang.
const MIX = /\b([a-z]+) con ([a-z]+)\b[^|]*?\b(?:las|los) (?:dos|tres|cuatro|cinco)\b|\b(?:las|los) (dos|tres|cuatro|cinco)\b[^|]*?\b([a-z]+) con ([a-z]+)\b/;
export function applyMixAll(cart: any[], turns: Turn[], menu: any[]): boolean {
  let ch = false;
  for (const t of turns) { const m = plain(t.text).match(MIX); if (!m) continue; const a = meatIn(m[1] || m[4] || ""), b = meatIn(m[2] || m[5] || ""); if (!a || !b || a === b) continue;
    const ls = cart.filter((l) => kindOfLine(l) && (l.modifiers || []).some((x: any) => meatIn(plain(x.option)) === a)); if (ls.length < 2) continue;
    const mixed = ls.find((l) => (l.modifiers || []).some((x: any) => meatIn(plain(x.option)) === b)); if (!mixed) continue;
    const n = ls.filter((l) => kindOfLine(l) === kindOfLine(mixed)).reduce((s, l) => s + (Number(l.quantity) || 1), 0);
    const want = m[3] ? numOf(m[3]) : numOf(plain(t.text).match(/\b(?:las|los) (dos|tres|cuatro|cinco)\b/)![1]);
    for (const l of ls) if (l !== mixed && kindOfLine(l) === kindOfLine(mixed)) cart.splice(cart.indexOf(l), 1);
    mixed.quantity = Math.min(want, n) || want; ch = true; }
  return ch;
}
export const fixPrensadoStt = (s: string) => String(s || "").replace(/\bchicharr[oó]n (?:prestado|pensado|presado|prendado)\b/giu, "chicharrón prensado");
/** "Y una de chicharrón prensado" in a quesadilla/taco run (staff "También de comal") with no line of that meat → add it. */
export function addSaidMeatLine(cart: any[], turns: Turn[], menu: any[]): boolean {
  let ch = false;
  turns.forEach((t, i) => { if (t.speaker !== "caller") return; const p = plain(fixPrensadoStt(t.text));
    const m = p.match(new RegExp(`\\b(${NUMW}) (?:de |del )(?:chicharron )?([a-z]+)\\b`)); if (!m) return; const meat = meatIn(m[2]); if (!meat || /\b(?:tacos?|quesadillas?|tortas?|burritos?|gorditas?|orden)\b/.test(p)) return;
    if (cart.some((l) => (l.modifiers || []).some((x: any) => meatIn(plain(x.option)) === meat) || plain(String(l.itemId)).includes(meat))) return;
    const ctx = turns.slice(Math.max(0, i - 4), i + 3).map((x) => plain(x.text)).join(" | ");
    const kind: Kind | null = /\bquesadillas?\b/.test(ctx) ? "quesadilla" : /\btacos?\b/.test(ctx) ? "taco" : null; if (!kind) return;
    if (turns.slice(i + 1, i + 3).some((x) => x.speaker === "staff" && /^no\b|no (?:tenemos|hay)|se (?:nos )?acab/.test(plain(x.text)))) return;
    const l: any = { itemId: (baseItem(menu, kind) || {}).id, quantity: numOf(m[1]) || 1, modifiers: [] }; if (!l.itemId) return;
    setLine(l, { kind, meat, qty: l.quantity, style: /\bcomal\b/.test(ctx) ? "comal" : undefined }, menu);
    if (!(l.modifiers || []).some((x: any) => meatIn(plain(x.option)) === meat)) return; cart.push(l); ch = true; });
  return ch;
}
export function applyMarta1(cart: any[], turns: Turn[], menu: any[]) { applyMixAll(cart, turns, menu); addSaidMeatLine(cart, turns, menu); }

// alex3 (CA63e343, Oct 31 2:10 PM ET): staff half-repeat "Tres ques," rang a phantom 3 QST bistec next to the 3 QD bistec
// the caller ordered; "una guarda chata" (ASR) → staff "un agua de horchata" was missed.
const Q_PLAIN = /^sq-quesadilla-/i, Q_DORADA = /^sq-qd-/i;
const QUES_WORD = /\bques(?:adillas?|o?s)?\b/g;
/** A plain quesadilla line twinning a QD line (same qty + meat) is a truncated staff repeat unless the caller asked for quesadillas twice. */
export function dropTruncatedRepeatTwin(cart: any[], turns: Turn[]): boolean {
  const asks = turns.filter((t) => t.speaker === "caller" && /\bquesadillas?\b/.test(plain(t.text))).length;
  let ch = false;
  for (let i = cart.length - 1; i >= 0; i--) { const l = cart[i]; if (!Q_PLAIN.test(String(l.itemId))) continue;
    const m = qdMeat(l); if (!m) continue;
    const twin = cart.some((d) => d !== l && Q_DORADA.test(String(d.itemId)) && (d.quantity || 1) === (l.quantity || 1) && qdMeat(d) === m);
    const qLines = cart.filter((d) => Q_PLAIN.test(String(d.itemId)) || Q_DORADA.test(String(d.itemId))).length;
    if (twin && asks < qLines) { cart.splice(i, 1); ch = true; } }
  return ch;
}
const DRINK_ASR: Array<[RegExp, RegExp, string]> = [
  [/\b(?:guar?d?a\s*chata|agua\s*(?:de\s*)?chata|hor?chata|orchata|ojata)\b/, /\bhorchata\b/, "sq-drink-agua-fresca-horchata-32oz-HL6HPK"],
  [/\b(?:ja\s*maica|agua\s*(?:de\s*)?maica|hamaica)\b/, /\bjamaica\b/, "sq-drink-agua-fresca-jamaica-32oz-ZLA3ZG"],
];
/** Caller says a garbled agua fresca and the next staff turn names it → add it once (qty from the staff/caller "un/dos"). */
export function addStaffConfirmedDrink(cart: any[], turns: Turn[], menu: any[]): boolean {
  let ch = false;
  turns.forEach((t, i) => { if (t.speaker !== "caller") return; const c = plain(t.text);
    for (const [asr, name, id] of DRINK_ASR) { if (!asr.test(c)) continue;
      const st = turns.slice(i + 1, i + 3).find((x) => x.speaker === "staff"); if (!st || !name.test(plain(st.text))) continue;
      if (cart.some((l) => String(l.itemId).includes(id.split("-").slice(0, 5).join("-")))) continue;
      if (menu?.length && !menu.some((m: any) => m.id === id)) continue;
      const q = plain(st.text).match(/\b(dos|tres|cuatro|2|3|4)\s+aguas?\b/); const qty = q ? ({ dos: 2, tres: 3, cuatro: 4 } as any)[q[1]] || Number(q[1]) : 1;
      cart.push({ itemId: id, quantity: qty, modifiers: [], readback: name.source.replace(/\\b/g, "") }); ch = true; } });
  return ch;
}
export function applyAlex3(cart: any[], turns: Turn[], menu: any[]) { dropTruncatedRepeatTwin(cart, turns); addStaffConfirmedDrink(cart, turns, menu); addStrongAsrHorchata(cart, turns); }

// andrew1 (CA67453b, Oct 31 3:46 PM ET): "un sopesazo de asada" rang with only "Mild Salsa Asada" and no meat.
// "de asada" on a dish with a meat step = carne asada = Bistec, never a salsa pick (unless "salsa asada" was said).
const SOPES = /^sq-sope(?:s|z)a?so/i;
const ASADA_MEAT = (t: string) => /\b(?:de|con)\s+(?:as\s+)?asada\b/.test(t) && !/\bsalsa\s+(?:de\s+)?asada\b/.test(t);
const hasMeat = (l: any) => (l.modifiers || []).some((m: any) => /carne|meat/i.test(String(m.step)));
function asadaBistec(l: any) {
  l.modifiers = [{ step: "(A) Elvis Carne / Meat Options", option: "Bistec / Steak" }, ...(l.modifiers || []).map((m: any) => /^Mild Salsa Asada$/.test(m.option) ? { ...m, isDefault: true } : m)];
}
export function applySopesAsada(cart: any[], turns: Turn[]): boolean {
  if (!ASADA_MEAT(said(turns, "caller").replace(/\|/g, " ")) ) return false; let ch = false;
  for (const l of cart) if (SOPES.test(String(l.itemId)) && !hasMeat(l)) { asadaBistec(l); ch = true; }
  return ch;
}
export function liveSopesAsada(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; const tx = plain(String(input?.transcript || ""));
  if (!ASADA_MEAT(tx)) return r; let ch = false;
  const out = acts.map((a) => { if ((a.type === "add_item" || a.type === "update_item") && SOPES.test(String(a.itemId)) && !hasMeat(a)) { const b = { ...a }; asadaBistec(b); ch = true; return b; } return a; });
  return ch ? { ...r, actions: out } : r;
}

// luis8 (CAf762f3, Oct 31 3:47 PM ET): "dos burritos de deshebrada" → staff "¿grandes o regulares?" → "Regulares" →
// "menos cebolla y cilantro". Elvi rang 2 GRANDE deluxe + a phantom 1 regular deshebrada+bistec.
const BURRITO = /^sq-burrito-/i;
const burMeats = (l: any) => (l.modifiers || []).filter((m: any) => /carne|meat/i.test(String(m.step))).map((m: any) => meatIn(plain(m.option))).filter(Boolean);
export function applyBurritoSaid(cart: any[], turns: Turn[]): boolean {
  let ch = false; const lines = () => cart.filter((l) => BURRITO.test(String(l.itemId)));
  if (!lines().length) return false;
  const callerTx = said(turns, "caller"), all = turns.map((t) => plain(t.text)).join(" | ");
  // 1. counted burritos with one meat: lines beyond that count with an unsaid meat mix are phantoms
  const m = callerTx.match(new RegExp(`\\b(${NUMW}) burritos?(?: (?:regulares|grandes))? de ([a-z]+)`));
  if (m && !/\b(?:otro|otra|mas|y un[oa]?) burritos?\b/.test(callerTx.slice((m.index || 0) + m[0].length))) {
    const n = numOf(m[1]), meat = meatIn(m[2]);
    if (n && meat) for (let i = cart.length - 1; i >= 0 && lines().reduce((a, l) => a + (l.quantity || 1), 0) > n; i--) {
      const l = cart[i]; if (!BURRITO.test(String(l.itemId))) continue; const ms = burMeats(l);
      if (ms.length !== 1 || ms[0] !== meat) { cart.splice(i, 1); ch = true; } }
  }
  // 2. staff "¿grandes o regulares?" → caller's answer sets the size
  turns.forEach((t, i) => { if (t.speaker !== "staff" || !/\bgrandes?\b.*\bregular(?:es)?\b|\bregular(?:es)?\b.*\bgrandes?\b/.test(plain(t.text))) return;
    const ans = turns.slice(i + 1, i + 3).find((x) => x.speaker === "caller"); if (!ans) return; const a = plain(ans.text);
    const size = /\bregular(?:es)?\b/.test(a) ? "Regular '10" : /\bgrandes?\b/.test(a) ? "Grande '12 (+$3.00)" : null; if (!size) return;
    for (const l of lines()) { const s = (l.modifiers || []).find((x: any) => /burrito size/i.test(String(x.step)));
      if (s && s.option !== size) { s.option = size; ch = true; } else if (!s) { l.modifiers = [{ step: "(A) Burrito Size", option: size }, ...(l.modifiers || [])]; ch = true; } } });
  // 3. DELUXE only when someone said deluxe/preparado
  if (!/\b(?:deluxe|delux|preparad[oa]s?)\b/.test(all)) for (const l of lines()) { const k = (l.modifiers || []).length;
    l.modifiers = (l.modifiers || []).filter((x: any) => !/deluxe/i.test(String(x.step))); if (l.modifiers.length !== k) ch = true; }
  // 4. "menos/sin cebolla y cilantro" → notes (and never the add-on options)
  const neg = callerTx.match(/\b(?:menos|sin|no)\s+((?:cebolla|cilantro|crema|queso|arroz|frijoles?)(?:\s+(?:y|ni|ni\s+tampoco)\s+(?:cebolla|cilantro|crema|queso|arroz|frijoles?))*)/);
  if (neg) { const words = neg[1].split(/\s+(?:y|ni|ni tampoco)\s+/); for (const l of lines()) {
    l.modifiers = (l.modifiers || []).filter((x: any) => !words.some((w) => plain(x.option).startsWith(w.replace(/s$/, ""))));
    const notes = new Set([...(l.elviNotes || []), ...words.map((w) => `no ${w}`)]); if (notes.size !== (l.elviNotes || []).length) { l.elviNotes = [...notes]; ch = true; } } }
  return ch;
}

// hector2 (CA17937e, Oct 31 4:28 PM ET): "1 water de Ochata" (ASR) is an agua de horchata even with no staff repeat.
const STRONG_HORCHATA = /\b(?:agua|water|vaso)\s+(?:de\s+)?(?:h?o\s*chata|or?chata|ochata)\b/;
const HORCHATA_ID = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
export function addStrongAsrHorchata(cart: any[], turns: Turn[]): boolean {
  if (cart.some((l) => /horchata/i.test(String(l.itemId)))) return false;
  const t = turns.find((x) => x.speaker === "caller" && STRONG_HORCHATA.test(plain(x.text))); if (!t) return false;
  const q = plain(t.text).match(new RegExp(`\\b(${NUMW})\\s+(?:agua|water|vaso)s?\\b`)); 
  cart.push({ itemId: HORCHATA_ID, quantity: q ? Math.max(1, numOf(q[1])) : 1, modifiers: [], readback: "horchata" }); return true;
}
export function liveStrongHorchata(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; const tx = plain(String(input?.transcript || ""));
  if (!STRONG_HORCHATA.test(tx) || [...(input?.cart || []), ...acts].some((l: any) => /horchata/i.test(String(l.itemId)))) return r;
  const q = tx.match(new RegExp(`\\b(${NUMW})\\s+(?:agua|water|vaso)s?\\b`));
  return { ...r, actions: [...acts, { type: "add_item", itemId: HORCHATA_ID, quantity: q ? Math.max(1, numOf(q[1])) : 1, modifiers: [], readback: "horchata" }] };
}

// irene1 (CAa5a670, Oct 31 5:09 PM ET): "una coca de bot…" → "una coca, no sé de cuál…, de taparrosca, de botella" →
// "Una de taparrosca" rang 3 Cokes. Re-mentioning / clarifying the same drink ("una (de) X") is the same drink, not another.
const DRINK_ID = /^sq-drink-/i;
const MORE_DRINK = /\b(?:otra|otro|otras|otros|mas|tambien|another|also|extra|cada\s+un[oa]|para\s+cada)\b/;
const DRINK_N = new RegExp(`\\b(${NUMW})\\s+(?:de\\s+)?(?:cocas?|coca\\s+colas?|cokes?|pepsis?|sprites?|fantas?|jarritos?|refrescos?|sodas?|aguas?|botellas?|latas?|taparroscas?|horchatas?|jamaicas?|tamarindos?|drinks?|de\\s+(?:taparrosca|botella|lata|vidrio|plastico))\\b`, "g");
const drinkSaidMax = (t: string) => Math.max(0, ...[...t.matchAll(DRINK_N)].map((m) => numOf(m[1])));
export function mergeReMentionedDrink(cart: any[], turns: Turn[]): boolean {
  const callerTx = said(turns, "caller"); if (MORE_DRINK.test(callerTx.replace(/\bno se\b/g, ""))) return false;
  const said1 = drinkSaidMax(callerTx); if (said1 !== 1) return false; let ch = false;
  const seen = new Map<string, any>();
  for (let i = 0; i < cart.length; i++) { const l = cart[i]; if (!DRINK_ID.test(String(l.itemId))) continue;
    const k = String(l.itemId) + JSON.stringify(l.modifiers || []); const first = seen.get(k);
    if (!first) { seen.set(k, l); continue; }
    if ((first.quantity || 1) === 1 && (l.quantity || 1) === 1) { cart.splice(i--, 1); ch = true; } }
  return ch;
}
export function liveDrinkReMention(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; const cart: any[] = input?.cart || [];
  const tx = plain(String(input?.transcript || "")); if (MORE_DRINK.test(tx) || drinkSaidMax(tx) > 1) return r;
  const out = acts.filter((a) => !(a.type === "add_item" && DRINK_ID.test(String(a.itemId)) && (a.quantity || 1) === 1
    && cart.some((l) => l.itemId === a.itemId && JSON.stringify(l.modifiers || []) === JSON.stringify(a.modifiers || []))));
  return out.length === acts.length ? r : { ...r, actions: out };
}

// agustin2 (CA3888d0, Oct 31 5:02 PM ET): a relayed multi-order call — each sub-order's items, then "esa orden es para X".
// The closure names the group so far. With ≥3 closures the caller's own words rebuild the taco / quesadilla / QD / quesitorta
// lines (counts, "N de <meat>" splits, harina/comal/taquera/aceite, preparadas, con frijoles / cebolla asada). After-call only.
const RELAY_CLOSE = /\b(?:(?:esa|esta|eso|este)\s+(?:orden\s+)?(?:es|va)\s+para|(?:^|\b(?:oh|ah|ajá|aja)\s+)para)\s+(?:el\s+|la\s+)?([a-z]{3,})\b/;
const RELAY_MEATS: Array<[RegExp, string]> = [[/\bbistec?k?\b|\bbiste\b|\bsteak\b|(?<!cebolla(?:s)? )\basada\b/, "Bistec"], [/\b(?:al )?pastor\b/, "Alpastor"], [/\bcostillas?\b/, "Costilla"], [/\btripas?\b/, "Tripa"],
  [/\bcabezas?\b/, "Cabeza"], [/\bprensado\b/, "Prensado"], [/\blenguas?\b/, "Lengua"], [/\bchorizo\b/, "Chorizo"], [/\bpollo\b/, "Pollo"], [/\bcarnitas\b/, "Carnitas"],
  [/\bbuche\b/, "Buche"], [/\b(?:chicharron\s+)?duro\b/, "Duro"], [/\bdeshebrada\b/, "Deshebrada"], [/\bpicadillo\b/, "Picadillo"]];
const relayMeat = (t: string) => { let best: [number, string] | null = null; for (const [re, k] of RELAY_MEATS) { const m = t.match(re); if (m && (!best || (m.index || 0) < best[0])) best = [m.index || 0, k]; } return best?.[1] || null; };
type RelayFam = "quesadilla" | "taco" | "torta";
const FAM_RE = /\b(quesadillas?|tacos?|quesitortas?|queso\s+tortas?|tortas?|burritos?|burros?)\b/;
const famOfWord = (w: string): RelayFam | "burrito" => /quesadilla/.test(w) ? "quesadilla" : /taco/.test(w) ? "taco" : /torta/.test(w) ? "torta" : "burrito";
export type RelayLine = { group: string; fam: RelayFam; qty: number; meat: string; style: string | null; qd: "regular" | "preparada" | null; beans: boolean; onion: boolean; note?: string };
export function relayGroups(turns: Turn[]): Array<{ name: string; text: string }> | null {
  const out: Array<{ name: string; text: string }> = []; let cur = "";
  for (const t of turns) { if (t.speaker !== "caller") continue; const p = plain(t.text); const m = p.match(RELAY_CLOSE);
    if (m && !/^(?:llevar|recoger|aca|aqui|alla|hoy|ahorita|las|los|que|mi|mis|su)$/.test(m[1])) { cur += " " + p.slice(0, m.index); const name = m[1];
      if (FAM_RE.test(cur)) out.push({ name, text: cur.trim() }); cur = " " + p.slice((m.index || 0) + m[0].length); }
    else cur += " | " + p; }
  if (FAM_RE.test(cur)) out.push({ name: "", text: cur.trim() });
  return out.filter((g) => g.name).length >= 3 ? out : null;
}
export function parseRelayGroup(g: { name: string; text: string }): RelayLine[] | null {
  const t = g.text.replace(/\bcebollas?\s+asadas?\b/g, "cebolla_asada");
  const heads = [...t.matchAll(new RegExp(`\\b(${NUMW})\\s+(?:${FAM_RE.source.slice(3, -3)})`, "g"))]
    .map((m) => ({ i: m.index || 0, qty: numOf(m[1]), fam: famOfWord(m[0]) })).filter((h) => h.qty > 0);
  if (!heads.length) return null;
  const fams = [...new Set(heads.map((h) => h.fam))]; const lines: RelayLine[] = [];
  for (const fam of fams) { if (fam === "burrito") continue;
    const hs = heads.filter((h) => h.fam === fam); const qty = hs[hs.length - 1].qty;
    const start = hs[0].i; const nextOther = heads.find((h) => h.i > start && h.fam !== fam && !hs.includes(h));
    const seg = t.slice(start, nextOther ? nextOther.i : undefined);
    const style = /\bharina\b/.test(seg) ? "harina" : /\bcomal\b/.test(seg) ? "comal" : /\btaquer[oa]s?\b/.test(seg) ? "taquero" : null;
    const qd = fam === "quesadilla" && /\b(?:aceite|fritas?|doradas?)\b/.test(seg) ? (/\bpreparad[oa]s?\b/.test(seg) ? "preparada" : "regular") : null;
    const splits = [...seg.matchAll(new RegExp(`\\b(${NUMW})\\s+de\\s+((?:chicharron\\s+)?[a-z]+)`, "g"))].map((m) => ({ i: m.index || 0, qty: numOf(m[1]), meat: relayMeat(m[2]) })).filter((s) => s.qty && s.meat);
    const sum = splits.reduce((a, s) => a + s.qty, 0);
    if (splits.length && sum === qty) splits.forEach((s, k) => { const tail = seg.slice(s.i, splits[k + 1]?.i);
      const nop = /\bnopal(?:es)?\b/.test(tail);
      lines.push({ group: g.name, fam, qty: s.qty, meat: s.meat!, style, qd, beans: /\bfrijol(?:es)?\b/.test(tail) && !/\bsin\s+frijol/.test(tail), onion: /cebolla_asada/.test(tail), ...(nop ? { note: "con nopales" } : {}) }); });
    else { const meat = relayMeat(seg); if (!meat) return null;
      lines.push({ group: g.name, fam, qty, meat, style, qd, beans: /\bcon\s+frijol/.test(seg), onion: /cebolla_asada/.test(seg) }); } }
  return lines;
}
function relayCartLine(e: RelayLine, menu: any[]): any | null {
  const id = e.fam === "taco" ? /^sq-taco-/ : e.fam === "torta" ? /^sq-torta-/ : e.qd ? /^sq-qd-.*regular/ : /^sq-quesadilla-/;
  const base = menu.find((m) => id.test(m.id)); if (!base) return null; const gs: any[] = base.modifierGroups || [];
  const opt = (gre: RegExp, ore: RegExp) => { const g = gs.find((x) => gre.test(x.name)); const o = g && (g.options || []).map(oname).find((x: string) => ore.test(x)); return o ? { step: g.name, option: o } : null; };
  const mods = [
    e.fam === "torta" ? opt(/torta options/i, /\(QTO\)/) : e.qd ? opt(/\(QD\).*options/i, e.qd === "preparada" ? /DELUXE Preparada/ : /REGULAR/) : e.style ? opt(/tortilla options/i, e.style === "harina" ? /\(QHR\)/ : e.style === "comal" ? /\((?:QCO|TCO)\)/ : /\((?:QST|TST)\)/) : null,
    opt(/carne|meat/i, new RegExp(`^${e.meat}\\b`, "i")),
    e.beans ? opt(/con \/ with/i, /Frijoles/) : null,
    e.onion ? opt(/extras/i, /Cebolla y Chiles Asados/) : null,
  ].filter(Boolean);
  if (!mods.some((m: any) => /carne|meat/i.test(m.step))) return null;
  return { itemId: base.id, quantity: e.qty, modifiers: mods, forName: e.group ? e.group[0].toUpperCase() + e.group.slice(1) : undefined, ...(e.note ? { elviNotes: [e.note] } : {}) };
}
export function applyRelayOrders(cart: any[], turns: Turn[], menu: any[]): boolean {
  const gs = relayGroups(turns); if (!gs || !menu?.length) return false;
  const lines: any[] = [];
  for (const g of gs) { const ls = parseRelayGroup(g); if (!ls) return false; for (const e of ls) { const l = relayCartLine(e, menu); if (!l) return false; lines.push(l); } }
  if (!lines.length) return false;
  const FOODISH = /^sq-(?:taco|quesadilla|qd|torta)-/;
  for (let i = cart.length - 1; i >= 0; i--) if (FOODISH.test(String(cart[i].itemId))) cart.splice(i, 1);
  cart.unshift(...lines);
  // "dos botecitos de crema" rang as salsa-asada cups → crema on the side of that group's first line
  const callerTx = said(turns, "caller"); const cm = callerTx.match(new RegExp(`\\b(${NUMW})\\s+botecitos?\\s+de\\s+crema\\b`));
  if (cm && !/\bbotecitos?\s+de\s+salsa\b/.test(callerTx)) { const si = cart.findIndex((l) => /^sq-extras-.*salsa/.test(String(l.itemId))); if (si >= 0) cart.splice(si, 1);
    const g = gs.find((x) => /botecitos?\s+de\s+crema/.test(x.text)); const host = cart.find((l) => l.forName === g?.name) || cart[0];
    host.modifiers.push({ step: "(F) GQT Extras", option: "**EXTRA SIDE Crema / Sour Cream (+$0.75)", quantity: numOf(cm[1]) });
    host.elviNotes = [...(host.elviNotes || []), `${numOf(cm[1])} crema aparte`]; }
  return true;
}

// mario1 (CA3870a1, Oct 31 5:23 PM ET): "y de tomarme tres un carrito" — a jarrito asked for (ASR: carrito/harrito/jarri…) in a drink
// context with no flavor said and no jarrito in the cart → 1 jarrito, flavor flagged for staff. Never guess the flavor.
const JAR_WORD = /\b(?:j|h|c)arritos?\b|\bjarri\w*/;
const JAR_CTX = new RegExp(`\\b(?:de|para)\\s+tomar(?:me|te)?\\b[^|]{0,40}?\\b(?:(${NUMW})\\s+)?(?:j|h|c)arritos?\\b|\\b(?:(${NUMW})\\s+)?jarritos?\\b`);
const JAR_FLAVORS: Array<[RegExp, RegExp]> = [[/\btamarindo\b/, /tamarindo/], [/\bfresa\b/, /fresa/], [/\blimon\b/, /limon/], [/\bpina\b/, /pina/], [/\bmango\b/, /mango/], [/\bmandarina\b/, /mandarina/]];
export const JAR_PLACEHOLDER = "sq-drink-jarrito-mandarina-mandarin-I4GNSG"; // same placeholder spoken-ledger uses
function jarritoAsk(text: string): { qty: number; flavor: RegExp | null } | null {
  const m = text.match(JAR_CTX); if (!m) return null; const n = m[1] || m[2]; const tail = text.slice(m.index || 0, (m.index || 0) + m[0].length + 60);
  const fl = JAR_FLAVORS.find(([re]) => re.test(tail));
  return { qty: n && /^(?:un[ao]?|1)$/.test(n) ? 1 : n ? numOf(n) || 1 : 1, flavor: fl ? fl[1] : null };
}
export function addAskedJarrito(cart: any[], turns: Turn[], menu: any[]): boolean {
  const ask = jarritoAsk(said(turns, "caller")); if (!ask) return false;
  const ph = cart.find((l) => l.itemId === JAR_PLACEHOLDER);
  if (ph && !ask.flavor && !/mandarina/.test(said(turns, "staff")) && !(ph.elviNotes || []).length) { ph.elviNotes = ["jarrito, sabor no dicho — confirmar"]; return true; }
  if (cart.some((l) => /^sq-drink-jarrito-/.test(String(l.itemId)))) return false;
  const item = ask.flavor ? menu.find((x) => /^sq-drink-jarrito-/.test(x.id) && ask.flavor!.test(x.id)) : menu.find((x) => x.id === JAR_PLACEHOLDER);
  if (!item) return false;
  cart.push({ itemId: item.id, quantity: 1, modifiers: [], ...(ask.flavor ? {} : { elviNotes: ["jarrito, sabor no dicho — confirmar"] }) });
  return true;
}
export function liveJarritoAsk(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; const cart: any[] = input?.cart || [];
  if (acts.some((a) => a.type === "add_item" && /^sq-drink-/.test(String(a.itemId))) || cart.some((l) => /^sq-drink-jarrito-/.test(String(l.itemId)))) return r;
  const tx = plain(String(input?.transcript || "")); const ask = jarritoAsk(tx); if (!ask || ask.flavor) return r;
  return { ...r, actions: [...acts, { type: "add_item", itemId: JAR_PLACEHOLDER, quantity: 1, modifiers: [], readback: "un jarrito (sabor por confirmar)" }] };
}

// kevin1 (CAdd19f3, Oct 31 6:51 PM ET): "un esquite, por favor" + staff "¿El esquite lo quiere con tajín?" "Sí" → no esquite rang.
// Caller asks for N esquites and the cart has none → add N; tajín from "con/sin tajín" or a yes to staff's tajín question.
const ESQ_ASK = new RegExp(`\\b(?:(${NUMW})\\s+)?esquites?\\b`);
function esquiteTajin(turns: Turn[]): "con" | "sin" | "doble" | null {
  let r: "con" | "sin" | "doble" | null = null;
  turns.forEach((t, i) => { const p = plain(t.text); if (!/tajin/.test(p)) return;
    if (t.speaker === "caller") { r = /\b(?:sin|no)\s+(?:el\s+)?tajin/.test(p) ? "sin" : /\b(?:doble|extra)\s+(?:de\s+)?tajin|tajin\s+doble/.test(p) ? "doble" : /\bcon\s+tajin/.test(p) ? "con" : r; return; }
    const nx = turns.slice(i + 1).find((x) => x.speaker === "caller"); const a = nx ? plain(nx.text) : "";
    if (/\?|quiere|lleva|con tajin/.test(p) && /^(?:si|claro|ok|okay|esta bien|ajam?|correcto|por favor|yes)\b/.test(a)) r = r || "con";
    else if (/^no\b/.test(a)) r = "sin"; });
  return r;
}
export function addAskedEsquite(cart: any[], turns: Turn[], menu: any[]): boolean {
  const item = menu.find((x) => /^sq-esquite-/.test(x.id)); if (!item) return false;
  const g = (item.modifierGroups || [])[0]; const want = esquiteTajin(turns);
  const opt = g && want && (g.options || []).map(oname).find((o: string) => want === "sin" ? /NO TAJIN/i.test(o) : want === "doble" ? /DOUBLE Tajin/i.test(o) : /^Tajin/i.test(o));
  const have = cart.find((l) => /^sq-esquite-/.test(String(l.itemId)));
  if (have) { if (opt && !(have.modifiers || []).some((x: any) => /tajin/i.test(x.option))) { have.modifiers = [...(have.modifiers || []), { step: g.name, option: opt }]; return true; } return false; }
  const m = said(turns, "caller").match(ESQ_ASK); if (!m) return false;
  cart.push({ itemId: item.id, quantity: m[1] ? numOf(m[1]) || 1 : 1, modifiers: opt ? [{ step: g.name, option: opt }] : [] });
  return true;
}
export function liveEsquiteAsk(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; const cart: any[] = input?.cart || [];
  if (acts.some((a) => a.type === "add_item" && /^sq-esquite-/.test(String(a.itemId))) || cart.some((l) => /^sq-esquite-/.test(String(l.itemId)))) return r;
  const m = plain(String(input?.transcript || "")).match(ESQ_ASK); if (!m) return r;
  const id = (input?.menu || []).find?.((x: any) => /^sq-esquite-/.test(x.id))?.id || "sq-esquite-elvis-esquite-16oz-SGPEZK";
  return { ...r, actions: [...acts, { type: "add_item", itemId: id, quantity: m[1] ? numOf(m[1]) || 1 : 1, modifiers: [], readback: "esquite" }] };
}

// kevin2b (CAdd19f3, Oct 31 6:51 PM ET): staff "del comal." → "el del comal está bien" (queso birrias rang QST), and after
// "dos tacos de bistec" the caller's "¿No tiene taqueras?" … "Sí, por favor" (tacos rang TCO). The tortilla word applies to the
// food family last talked about (queso birrias / tacos / quesadillas): said by the caller, or a caller yes to a staff turn naming it.
type TFam = "qb" | "taco" | "quesadilla";
const TFAM_WORD: Array<[RegExp, TFam | "other"]> = [[/\bque?s[aei]\s*v?birrias?\b|\bquesabirrias?\b|\bquesi\s*birrias?\b|\bque?s[aei]v?irrias?\b/, "qb"], [/\btacos?\b/, "taco"],
  [/\bquesadillas?\b/, "quesadilla"], [/\b(?:esquites?|elotes?|jarritos?|horchatas?|aguas?|cocas?|refrescos?|sodas?|burritos?|tortas?|sopes?|gorditas?|menudo|pozole)\b/, "other"]];
const tStyle = (p: string): "comal" | "taquero" | "harina" | null => /\bcomal(?:es)?\b|\bhechas? a mano\b/.test(p) ? "comal" : /\btaquer[oa]s?\b|\bstreet\b/.test(p) ? "taquero" : /\bharina\b|\bflour\b/.test(p) ? "harina" : null;
const lastFam = (p: string): TFam | "other" | null => { let best: [number, TFam | "other"] | null = null;
  for (const [re, f] of TFAM_WORD) for (const m of p.matchAll(new RegExp(re.source, "g"))) if (!best || (m.index || 0) >= best[0]) best = [m.index || 0, f]; return best?.[1] || null; };
export function applyLateTortillaChoice(cart: any[], turns: Turn[], menu: any[]): boolean {
  const choice: Partial<Record<TFam, "comal" | "taquero" | "harina">> = {}; let fam: TFam | "other" | null = null;
  turns.forEach((t, i) => { const p = plain(t.text); const st = tStyle(p);
    const f0 = lastFam(p.replace(/\b(?:comal(?:es)?|taquer[oa]s?|harina)\b/g, ""));
    if (st && t.speaker === "caller") { const target = f0 && f0 !== "other" ? f0 : fam; if (target && target !== "other") choice[target] = st; }
    if (st && t.speaker === "staff" && [/\bcomal/, /\btaquer/, /\bharina/].filter((r) => r.test(p)).length === 1) { const target = f0 && f0 !== "other" ? f0 : fam; const nx = turns[i + 1];
      if (target && target !== "other" && nx?.speaker === "caller" && /^(?:si|claro|ok|okay|esta bien|ajam?|correcto|por favor|yes|sale|va)\b/.test(plain(nx.text))) choice[target] = st; }
    if (f0) fam = f0; });
  let changed = false;
  for (const l of cart) { const id = String(l.itemId);
    const f: TFam | null = /^sq-queso-birrias-/.test(id) ? "qb" : /^sq-taco-/.test(id) ? "taco" : /^sq-quesadilla-/.test(id) ? "quesadilla" : null; if (!f || !choice[f]) continue;
    const base = menu.find((m) => m.id === id); const g = (base?.modifierGroups || []).find((x: any) => /tortilla options|queso birrias options/i.test(x.name)); if (!g) continue;
    const want = choice[f]!; const code = f === "taco" ? { comal: "TCO", taquero: "TST", harina: "THR" }[want] : { comal: "QCO", taquero: "QST", harina: "QHR" }[want];
    const opt = (g.options || []).map(oname).find((o: string) => o.startsWith(`(${code})`)); if (!opt) continue;
    const cur = (l.modifiers || []).find((m: any) => m.step === g.name || /^\((?:TCO|TST|THR|QCO|QST|QHR)\)/.test(String(m.option)));
    if (cur?.option === opt) continue;
    l.modifiers = [...(l.modifiers || []).filter((m: any) => m !== cur), { step: g.name, option: opt }]; changed = true; }
  return changed;
}

// chuy2 (CAc212a3, Oct 31 8:18 PM ET): the caller's own recap — "son seis doradas de buche, tres y tres, pero las seis son regulares"
// … "y las otras dos preparadas" … "¿cuántas quesadillas son? ocho y el burrito" — rebuilds the dorada lines when the recap
// counts add up to the stated total. Comal/harina quesadilla lines go too when comal/harina was never said on this call.
const QD_WORD = "(?:doradas?|doraditas?|fritas?|en aceite|quesadillas?(?: (?:doradas?|fritas?|en aceite))?)";
export function applyQdRecap(cart: any[], turns: Turn[], menu: any[]): boolean {
  const c = said(turns, "caller");
  const m = c.match(new RegExp(`\\bson (${NUMW}) ${QD_WORD}(?: de ([a-z]+))?[^|]{0,80}?\\b(?:las|todas)(?: (?:${NUMW}|todas))? son (regulares|preparadas)`));
  if (!m) return false; const n1 = numOf(m[1]); const meat1 = m[2] ? meatIn(m[2]) : null; if (!n1 || !meat1) return false;
  const st1: "regular" | "preparada" = m[3] === "regulares" ? "regular" : "preparada";
  const o = c.slice((m.index || 0) + m[0].length).match(new RegExp(`\\b(?:las|y las) otras (${NUMW}) (preparadas|regulares)`));
  const n2 = o ? numOf(o[1]) : 0; const st2: "regular" | "preparada" = o?.[2] === "regulares" ? "regular" : "preparada";
  let meat2 = meat1;
  if (o) { const after = c.slice(c.indexOf(o[0])); const dm = [...after.matchAll(new RegExp(`${QD_WORD}[^|]{0,20}?\\bde ([a-z]+)[^|]{0,12}?\\b${o[2]}`, "g"))].pop(); const mm = dm ? meatIn(dm[1]) : null; if (mm) meat2 = mm; }
  const tot = c.match(new RegExp(`\\b(${NUMW})\\s+y\\s+el\\s+(?:burrito|burro)\\b`)) || c.match(new RegExp(`\\bson\\s+(${NUMW})\\s+quesadillas\\b`));
  if (!tot || numOf(tot[1]) !== n1 + n2) return false;
  const base = baseItem(menu, "qd"); if (!base) return false;
  const keepQ = /\b(?:comal|harina)\b/.test(c);
  for (let i = cart.length - 1; i >= 0; i--) { const k = kindOfLine(cart[i]); if (k === "qd" || (k === "quesadilla" && !keepQ)) cart.splice(i, 1); }
  const mk = (q: number, meat: string, qd: "regular" | "preparada") => { const l: any = { itemId: base.id, quantity: q, modifiers: [] }; setLine(l, { kind: "qd", meat, qty: q, qd }, menu); return l; };
  const add = [mk(n1, meat1, st1)]; if (n2) add.push(mk(n2, meat2, st2));
  const bi = cart.findIndex((l) => /^sq-burrito-/.test(String(l.itemId))); cart.splice(bi >= 0 ? bi : cart.length, 0, ...add);
  return true;
}
// chuy2: "¿De qué quieres el burrito?" "De lengua, de lengua, de lengua con aguacate" rang buche. The meat the caller repeats right
// after "burrito" (≥2 times, the only one said there) wins; "con aguacate" goes on as a note.
export function applyBurritoMeatRepeat(cart: any[], turns: Turn[], menu: any[]): boolean {
  const bl = cart.filter((l) => /^sq-burrito-/.test(String(l.itemId))); if (bl.length !== 1) return false;
  const ct = turns.filter((t) => t.speaker === "caller").map((t) => plain(t.text)); const i = ct.findIndex((t) => /\bburrit?os?\b|\bburros?\b/.test(t)); if (i < 0) return false;
  const win = ct.slice(i, i + 5).join(" | "); const hits = [...win.matchAll(/\bde ([a-z]+)/g)].map((x) => meatIn(x[1])).filter(Boolean) as string[];
  const counts = new Map<string, number>(); hits.forEach((h) => counts.set(h, (counts.get(h) || 0) + 1));
  let changed = false; const l = bl[0];
  if (counts.size === 1) { const [meat, n] = [...counts][0]; if (n >= 2 && meatOfLine(l) !== meat) {
    const base = menu.find((x) => x.id === l.itemId); const g = (base?.modifierGroups || []).find((x: any) => /carne/i.test(x.name));
    const opt = g && (g.options || []).map(oname).find((o: string) => plain(o).replace(/\s/g, "").includes(meat));
    if (opt) { l.modifiers = [...(l.modifiers || []).filter((x: any) => x.step !== g.name), { step: g.name, option: opt }]; changed = true; } } }
  const winA = ct.slice(i, i + 8).join(" | ");
  if (/\bcon aguacate\b/.test(winA) && !(l.elviNotes || []).some((n: string) => /aguacate/i.test(n)) && !(l.modifiers || []).some((x: any) => /guacamole/i.test(x.option))) {
    l.elviNotes = [...(l.elviNotes || []), "con aguacate"]; changed = true; }
  return changed;
}

// robert1 (CAcaddf9, Oct 31 9:15 PM ET, English): "we'll do four, street tacos with carne asada. Yep, we'll do one burrito grande"
// rang 4 × Burrito Grande; "chips and queso" rang a Burrito (cheese chile relleno + refried beans); the real burrito lost
// "extra carne asada", "only lechuga / no rice, no beans, no cheese" and "salsa verde with both the tacos and the burrito".
const EN_NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const nOf = (w: string) => EN_NUM[w] ?? numOf(w) ?? (Number(w) || 0);
const ANYNUM = `(?:${NUMW}|one|a|an|two|three|four|five|six|seven|eight|nine|ten|twelve|\\d+)`;
const DIPS_ID = "sq-dips-MAIPCN";
const saysQuesoDip = (p: string) => /\bchips (?:and|with|y|con) queso\b|\bqueso (?:dip )?(?:and|with|y|con) chips\b|\bqueso dip\b/.test(p);
/** Dish mentions with counts in caller speech: "four street tacos with carne asada", "one burrito grande". */
function dishCounts(c: string) {
  const out: Array<{ fam: "taco" | "burrito"; qty: number; style?: "taquero" | "comal" | "harina"; meat: string | null; at: number }> = [];
  for (const m of c.matchAll(new RegExp(`\\b(${ANYNUM})[ ,|]+(?:(street|taquer[oa]s?|comal|flour|harina) )?(tacos?|burritos?)\\b(?=([^|]{0,40}))`, "g"))) {
    const fam = /^taco/.test(m[3]) ? "taco" : "burrito"; const st = m[2] ? (/street|taquer/.test(m[2]) ? "taquero" : /comal/.test(m[2]) ? "comal" : "harina") : undefined;
    const mm = m[4].split(new RegExp(`\\b${ANYNUM} (?:street |taquer[oa]s? )?(?:tacos?|burritos?)\\b`))[0].match(/\b(?:with|de|con) (?:carne )?([a-z]+)/); out.push({ fam, qty: nOf(m[1]), style: st as any, meat: mm ? meatIn(mm[1]) : null, at: m.index || 0 }); }
  return out;
}
export function applyEnglishMultiItem(cart: any[], turns: Turn[], menu: any[]): boolean {
  const c = said(turns, "caller"); const ds = dishCounts(c); let changed = false;
  const tacos = ds.filter((d) => d.fam === "taco"); const burr = ds.filter((d) => d.fam === "burrito");
  const isB = (l: any) => /^sq-burrito-/.test(String(l.itemId));
  // 1) "N tacos … one burrito" merged into N burritos → the N-line is the tacos
  for (const t of tacos) {
    if (cart.some((l) => kindOfLine(l) === "taco" && l.quantity === t.qty)) continue;
    const bl = cart.find((l) => isB(l) && l.quantity === t.qty && t.qty > 1 && !burr.some((b) => b.qty === t.qty)); if (!bl) continue;
    const meat = t.meat || meatOfLine(bl) || null; const hadOther = cart.some((l) => l !== bl && isB(l));
    if (!hadOther && burr.length) cart.splice(cart.indexOf(bl) + 1, 0, { ...structuredClone(bl), quantity: 1, elviNotes: [] });
    const notes = bl.elviNotes; bl.elviNotes = undefined; bl.quantity = t.qty; setLine(bl, { kind: "taco", meat, qty: t.qty, style: t.style || "taquero" }, menu); delete bl.elviNotes;
    void notes; changed = true;
  }
  // 2) more burrito lines than the caller ordered: drop the ones whose filling the caller never said (or said "no" to)
  const want = burr.reduce((a, b) => a + b.qty, 0);
  if (want) { const bls = cart.filter(isB); let extra = bls.reduce((a, l) => a + (l.quantity || 1), 0) - want;
    const unsaid = (l: any) => (l.modifiers || []).filter((m: any) => /carne|meat/i.test(m.step)).every((m: any) => { const w = plain(String(m.option)).split("/")[0].trim().split(" ")[0]; return !meatIn(plain(m.option)) && !new RegExp(`(?<!\\bno )\\b${w}`).test(c.replace(/\bno (?:rice|beans|cheese)\b/g, "")); });
    for (const l of bls) { if (extra <= 0) break; if (!unsaid(l) || (l.quantity || 1) > extra) continue; cart.splice(cart.indexOf(l), 1); extra -= l.quantity || 1; changed = true; } }
  // 3) one burrito left: carne asada / extra meat / only lettuce / no rice-beans-cheese
  const bls = cart.filter(isB);
  if (bls.length === 1 && burr.length) { const l = bls[0]; const notes = new Set<string>(l.elviNotes || []);
    const bm = burr[0].meat || (c.match(/\bburrito[^]{0,120}?\bwith (?:carne )?(asada|steak|pastor|chicken|pollo|carnitas|chorizo)\b/) || [])[1];
    const want2 = bm ? meatIn(bm) : null;
    if (want2 && meatOfLine(l) !== want2) { const g = (menu.find((x) => x.id === l.itemId)?.modifierGroups || []).find((x: any) => /carne/i.test(x.name)); const o = g && (g.options || []).map(oname).find((o: string) => meatIn(plain(o)) === want2); if (o) { l.modifiers = [...(l.modifiers || []).filter((m: any) => m.step !== g.name), { step: g.name, option: o }]; changed = true; } }
    const em = c.match(/\bextra (?:carne )?(asada|steak|meat|carne|pastor|chicken|pollo)\b/); if (em) notes.add(`extra ${em[1] === "asada" ? "carne asada" : em[1]}`);
    if (/\b(?:only|just|solo|nomas) (?:lechuga|lettuce)\b/.test(c)) { notes.add("solo lechuga"); l.modifiers = (l.modifiers || []).filter((m: any) => !/DELUXE/i.test(m.option)); }
    for (const [re, n, opt] of [[/\bno (?:rice|arroz)\b/, "no arroz", /arroz/i], [/\bno (?:beans|frijoles)\b/, "no frijoles", /frijol/i], [/\bno (?:cheese|queso)\b/, "no queso", /queso fresco/i]] as Array<[RegExp, string, RegExp]>)
      if (re.test(c)) { notes.add(n); l.modifiers = (l.modifiers || []).filter((m: any) => /carne/i.test(m.step) || !opt.test(m.option)); }
    const nn = [...notes]; if (nn.length !== (l.elviNotes || []).length) { l.elviNotes = nn; changed = true; } }
  // 4) "salsa verde with both the tacos and the burrito" / "all salsa verde"
  if (/\bsalsa verde\b/.test(c) && /\b(?:both|all|everything|todo|todos|all salsa verde)\b/.test(c))
    for (const l of cart) if ((kindOfLine(l) === "taco" || isB(l)) && !(l.elviNotes || []).includes("salsa verde") && !(l.modifiers || []).some((m: any) => /verde/i.test(m.option))) { l.elviNotes = [...(l.elviNotes || []), "salsa verde"]; changed = true; }
  // 5) chips and queso / queso dip → Dips: Queso Dip con Chips
  if (saysQuesoDip(c) && !cart.some((l) => /^sq-dips-/.test(String(l.itemId)))) { cart.push({ itemId: DIPS_ID, quantity: 1, modifiers: [{ step: "Dips", option: "Queso Dip con Chips (+$1.00)" }], readback: "queso dip con chips" }); changed = true; }
  return changed;
}
/** Live: one caller turn "four street tacos … one burrito grande" added as N × burrito → split into N tacos + 1 burrito;
 *  a burrito added on a turn that never says burrito but says "chips and queso" → Queso Dip con Chips. */
export function liveMultiItem(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; if (!acts.length) return r;
  const tx = plain(String(input?.transcript || "")); const ds = dishCounts(tx); const menu: any[] = input?.menu || []; let ch = false;
  const out: any[] = [];
  for (const a of acts) {
    const isB = a.type === "add_item" && /^sq-burrito-/.test(String(a.itemId));
    if (isB && !/\bburrit?os?\b|\bburros?\b/.test(tx) && saysQuesoDip(tx)) { out.push({ type: "add_item", itemId: DIPS_ID, quantity: 1, modifiers: [{ step: "Dips", option: "Queso Dip con Chips (+$1.00)" }], readback: "queso dip con chips" }); ch = true; continue; }
    const t = ds.find((d) => d.fam === "taco" && d.qty === a.quantity && a.quantity > 1); const b = ds.find((d) => d.fam === "burrito" && d.qty !== a.quantity);
    if (isB && t && b) { const base = menu.length ? baseItem(menu, "taco") : null;
      const tl: any = { itemId: base?.id || "sq-taco-TAR7L5", quantity: t.qty, modifiers: [] }; if (menu.length) setLine(tl, { kind: "taco", meat: t.meat || meatOfLine(a), qty: t.qty, style: t.style || "taquero" }, menu);
      out.push({ type: "add_item", ...tl, readback: `${t.qty} street tacos` }, { ...a, quantity: b.qty }); ch = true; continue; }
    out.push(a);
  }
  return ch ? { ...r, actions: out } : r;
}

// julian1 (CAb91612): "cuatro quesadillas de comal, dos de bistec y dos de chorizo" → lines carry the per-meat counts (2+2), never 1+1.
const NUMWJ: Record<string, number> = { un: 1, una: 1, uno: 1, one: 1, a: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10 };
const nOfJ = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUMWJ[w] || 0);
/** Per-meat counts in one phrase: "dos de bistec y dos de chorizo", "2 bistec, 2 chorizo". Returns [] unless ≥2 meats each have a count. */
export function meatSplitCounts(text: string): Array<{ qty: number; meat: string }> {
  const p = plain(text); const out: Array<{ qty: number; meat: string }> = [];
  for (const m of p.matchAll(/\b(\d{1,2}|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:de\s+|of\s+)?([a-z]+)(?=((?:\s+[a-z]+)?))/g)) {
    const q = nOfJ(m[1]); const k = meatIn(m[2] + m[3]); if (!q || !k || !meatIn(m[2])) continue;
    if (!out.some((x) => x.meat === k)) out.push({ qty: q, meat: k });
  }
  return out.length >= 2 ? out : [];
}
const totalBefore = (p: string) => { const m = p.match(/\b(\d{1,2}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|seven|eight|nine|ten)\s+(?:orden(?:es)? de\s+)?(?:quesadillas?|tacos?|gorditas?|sopes?|tostadas?|flautas?|huaraches?|burritos?|tortas?)\b/); return m ? nOfJ(m[1]) : 0; };
/** Set qty of the same-dish lines to the per-meat counts when every count lands on exactly one 1-qty line. */
function applySplitQty(lines: any[], split: Array<{ qty: number; meat: string }>, total: number): boolean {
  if (!split.length) return false; const sum = split.reduce((a, s) => a + s.qty, 0); if (total && total !== sum) return false;
  const hits = split.map((s) => lines.filter((l) => meatOfLine(l) === s.meat));
  if (hits.some((h) => h.length !== 1)) return false;
  const ids = new Set(hits.map((h) => String(h[0].itemId))); if (ids.size !== 1) return false;
  let ch = false; split.forEach((s, i) => { const l = hits[i][0]; if ((Number(l.quantity) || 1) !== s.qty) { l.quantity = s.qty; ch = true; } });
  return ch;
}
export function applyMeatSplitQty(cart: any[], turns: Turn[]): boolean {
  const cs = turns.filter((t) => t.speaker === "caller").map((t) => String(t.text || "")); let ch = false;
  for (let i = 0; i < cs.length; i++) { const s = meatSplitCounts(cs[i]); if (!s.length) continue;
    const ctx = plain([cs[i - 1] || "", cs[i]].join(" ")); if (applySplitQty(cart, s, totalBefore(ctx))) ch = true; }
  return ch;
}
/** Live: quantities match what Elvi reads back / the caller said ("4 quesadillas de comal: 2 bistec, 2 chorizo"). */
export function liveMeatSplitQty(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; const adds = acts.filter((a) => a?.type === "add_item"); if (adds.length < 2) return r;
  for (const src of [String(r?.reply || ""), String(input?.transcript || "")]) {
    const s = meatSplitCounts(src); if (!s.length) continue;
    const copy = adds.map((a) => ({ ...a })); if (applySplitQty(copy, s, totalBefore(plain(src)))) { let k = 0; return { ...r, actions: acts.map((a) => (a?.type === "add_item" ? copy[k++] : a)) }; }
    if (s.every((x) => adds.some((a) => meatOfLine(a) === x.meat && a.quantity === x.qty))) return r;
  }
  return r;
}

// sergio1 (CA391bc9): "lo quiero cargadito… extra" + staff "Claro, extra carne" → EXTRA Carne / Meat (+$3) on the menudo.
const EXTRA_CARNE_CALLER = /\bextra\s+(?:de\s+)?(?:carne|meat)\b|\bcargadit[oa]s?\b|\bcargad[oa]\s+de\b|\bcon\s+m[aá]s\s+carne\b|\bm[aá]s\s+carne\b|\bpoquito\s+m[aá]s\s+(?:de\s+)?carne\b|\bextra\s+meat\b|\bmore\s+meat\b|\bdouble\s+(?:the\s+)?meat\b|\bdoble\s+carne\b/iu;
const EXTRA_CARNE_STAFF = /\bextra\s+(?:de\s+)?carne\b|\bextra\s+meat\b|\bcon\s+m[aá]s\s+carne\b|\bcargadit[oa]\b|\bdoble\s+carne\b|\bdouble\s+meat\b/iu;
const NO_EXTRA = /\b(?:sin|no|without|nada\s+de)\s+(?:extra|m[aá]s\s+carne|cargad)/iu;
/** Caller asked for extra meat ("extra carne", "cargadito", "con más carne"), or staff confirmed it. */
export function wantsExtraCarne(callerText: string, staffText = ""): boolean {
  const c = String(callerText || ""), s = String(staffText || "");
  if (NO_EXTRA.test(c)) return false;
  return EXTRA_CARNE_CALLER.test(c) || EXTRA_CARNE_STAFF.test(s);
}
/** The paid EXTRA Carne option on an item, from the menu (menudo "EXTRA Carne / Meat (+$3.00)", others "DOUBLE Carne / Meat"). */
export function extraCarneOption(menu: any[], itemId: string): { step: string; option: string } | null {
  const it = (menu || []).find((m: any) => m.id === itemId); if (!it) return null;
  for (const g of it.modifierGroups || []) { if (!/extra\s+carne/i.test(String(g.name))) continue;
    const o = (g.options || []).find((o: any) => /extra\s+carne|double\s+carne/i.test(String(o.name))); if (o) return { step: g.name, option: o.name }; }
  return null;
}
const hasExtraCarne = (l: any) => (l.modifiers || []).some((m: any) => /extra\s+carne|double\s+carne/i.test(String(m.option)));
/** After-call: exactly one line can take EXTRA Carne and the call asked for it → add it. */
export function applyExtraCarne(cart: any[], turns: Turn[], menu: any[]): boolean {
  const c = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" | "), s = turns.filter((t) => t.speaker === "staff").map((t) => t.text).join(" | ");
  if (!wantsExtraCarne(c, s)) return false;
  const el = cart.filter((l) => extraCarneOption(menu, String(l.itemId))); if (el.length !== 1 || hasExtraCarne(el[0])) return false;
  el[0].modifiers = [...(el[0].modifiers || []), extraCarneOption(menu, String(el[0].itemId))]; return true;
}
/** Live: this turn (or staff's confirm in history) asks for extra meat → EXTRA Carne on the one eligible line (in actions or cart). */
export function liveExtraCarne(r: any, input: any) {
  const menu: any[] = input?.menu || []; if (!menu.length) return r;
  const hist: any[] = input?.history || []; const recent = hist.slice(-4);
  const c = [String(input?.transcript || ""), ...recent.filter((h) => h.role === "customer" || h.role === "user").map((h) => String(h.text || ""))].join(" | ");
  const s = recent.filter((h) => h.role === "staff").map((h) => String(h.text || "")).join(" | ");
  if (!wantsExtraCarne(String(input?.transcript || ""), "") && !(wantsExtraCarne(c, s) && /\b(?:s[ií]|extra|exacto|aj[aá]|eso|yes|yeah)\b/iu.test(String(input?.transcript || "")))) return r;
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : [];
  const addEl = acts.filter((a) => a?.type === "add_item" && extraCarneOption(menu, String(a.itemId)));
  if (addEl.length === 1) { if (hasExtraCarne(addEl[0])) return r; const o = extraCarneOption(menu, String(addEl[0].itemId))!;
    return { ...r, actions: acts.map((a) => (a === addEl[0] ? { ...a, modifiers: [...(a.modifiers || []), o] } : a)) }; }
  if (addEl.length) return r;
  const el = (input?.cart || []).filter((l: any) => extraCarneOption(menu, String(l.itemId))); if (el.length !== 1 || hasExtraCarne(el[0])) return r;
  const l = el[0]; const o = extraCarneOption(menu, String(l.itemId))!; const en = input?.language === "en";
  return { ...r, actions: [...acts.filter((a) => !(a?.type === "update_item" && a.itemId === l.itemId)), { type: "update_item", itemId: l.itemId, quantity: l.quantity || 1, modifiers: [...(l.modifiers || []), o], correction: true }],
    reply: en ? "Extra meat added. Anything else?" : "Con extra carne. ¿Algo más?" };
}

// yomar1 (CAbc24f7): staff guesses "De comal, ¿verdad?" → caller "en aceite, preparadas" = correction: that item is QD Deluxe Preparada.
const QD_DLX_ID = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const QD_STYLE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
const STAFF_TORT_GUESS = /\b(?:de\s+)?(?:comal|harina|ma[ií]z|hecha\s+a\s+mano|homemade|flour|corn)\b[^?]{0,20}(?:\?|verdad|no\b)|\b(?:verdad|cierto)\b[^?]{0,10}\b(?:comal|harina|ma[ií]z)\b/iu;
const CALLER_QD_DLX = /\b(?:en\s+(?:\w+\s+)?aceite|doradas?|fritas?)\b[^|]{0,40}\bpreparad[oa]s?\b|\bpreparad[oa]s?\b[^|]{0,40}\b(?:en\s+(?:\w+\s+)?aceite|doradas?|fritas?)\b/iu;
const meatOptOf = (l: any) => (l.modifiers || []).find((m: any) => /carnes?\s*\/\s*meats?/i.test(String(m.step)) && !/extra/i.test(String(m.step)));
const toQdDeluxe = (l: any) => ({ ...l, itemId: QD_DLX_ID, modifiers: [QD_STYLE, ...(meatOptOf(l) ? [meatOptOf(l)] : [])], readback: "quesadilla dorada deluxe" });
/** Caller's "en aceite / doradas … preparadas" right after a staff tortilla guess → the quesadilla just ordered is QD Deluxe Preparada. */
export function qdCorrectionMeats(turns: Turn[]): Array<string | null> {
  const out: Array<string | null> = [];
  for (let i = 1; i < turns.length; i++) {
    const t = turns[i]; if (t.speaker !== "caller" || !CALLER_QD_DLX.test(String(t.text || ""))) continue;
    const g = turns.slice(Math.max(0, i - 2), i).find((x) => x.speaker === "staff" && STAFF_TORT_GUESS.test(String(x.text || ""))); if (!g) continue;
    const before = turns.slice(Math.max(0, i - 5), turns.indexOf(g)).filter((x) => x.speaker === "caller").map((x) => plain(x.text)).join(" ");
    if (!/\bquesadillas?\b/.test(before)) continue;
    out.push(meatIn(before.slice(before.lastIndexOf("quesadilla"))));
  }
  return out;
}
export function applyQdCorrection(cart: any[], turns: Turn[]): boolean {
  let ch = false;
  for (const meat of qdCorrectionMeats(turns)) {
    const ls = cart.filter((l) => /^sq-quesadilla-/.test(String(l.itemId)) && (!meat || meatOfLine(l) === meat));
    const l = meat ? ls[0] : ls[ls.length - 1]; if (!l) continue;
    if (meat && ls.length !== 1) continue;
    cart[cart.indexOf(l)] = toQdDeluxe(l); ch = true;
  }
  return ch;
}
/** Live: "en aceite, preparadas" turn after a quesadilla → QD Deluxe Preparada (convert a plain add, or swap the cart line). */
export function liveQdCorrection(r: any, input: any) {
  const tx = String(input?.transcript || ""); if (!CALLER_QD_DLX.test(tx)) return r;
  const hist: any[] = input?.history || []; const prevC = hist.filter((h) => h.role === "customer").slice(-3).map((h) => plain(h.text)).join(" ") + " " + plain(tx);
  if (!/\bquesadillas?\b/.test(prevC)) return r;
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : []; const en = input?.language === "en";
  if (acts.some((a) => a?.type === "add_item" && /^sq-quesadilla-/.test(String(a.itemId)))) return { ...r, actions: acts.map((a) => (a?.type === "add_item" && /^sq-quesadilla-/.test(String(a.itemId)) ? toQdDeluxe(a) : a)) };
  if (acts.some((a) => a?.type === "add_item" && a.itemId === QD_DLX_ID)) return r;
  const cart: any[] = input?.cart || []; const last = [...cart].reverse().find((l) => /^sq-quesadilla-/.test(String(l.itemId)));
  const meatW = meatIn(prevC.slice(prevC.lastIndexOf("quesadilla")));
  const nm = prevC.match(new RegExp(`\\b(${NUMW})\\s+quesadillas?\\b`)); const qty = nm ? numOf(nm[1]) || 1 : 1;
  const meatMod = (k: string | null) => k ? { step: "(B) Q Carnes / Meats", option: ({ bistec: "Bistec / Steak", chorizo: "Chorizo / Mexican Sausage", cabeza: "Cabeza / Beef Head (+$0.50)", carnitas: "Carnitas / Pulled Pork" } as any)[k] } : null;
  if (last) { const nl = toQdDeluxe(last); return { ...r, actions: [{ type: "remove_item", itemId: last.itemId, quantity: last.quantity || 1 }, { type: "add_item", ...nl }],
    reply: en ? `${nl.quantity} fried deluxe quesadillas. Anything else?` : `${nl.quantity} quesadillas doradas deluxe. ¿Algo más?` }; }
  const mm = meatMod(meatW); if (!mm || !mm.option) return r;
  return { ...r, actions: [...acts, { type: "add_item", itemId: QD_DLX_ID, quantity: qty, modifiers: [QD_STYLE, mm], readback: "quesadilla dorada deluxe" }],
    reply: en ? `${qty} fried deluxe quesadillas, ${meatW}. Anything else?` : `${qty} quesadillas doradas deluxe de ${meatW}. ¿Algo más?` };
}

// juan/felipe (Nov 1): menudo con pata. CON = "Con Pata Menudo 32oz y Tortillas (4)" SKU; REG = Menudo con Tortillas.
const MEN_CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG", MEN_REG = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const isMenudo = (l: any) => l && (l.itemId === MEN_CON || l.itemId === MEN_REG);
const menTort = (l: any) => (l.modifiers || []).filter((m: any) => /menudo tortillas/i.test(String(m.step)) || /extra/i.test(String(m.step))).map((m: any) => ({ step: m.step, option: m.option }));
const menLine = (pata: boolean, q: number, like?: any) => { const t = like && menTort(like).length ? menTort(like) : [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }];
  return { itemId: pata ? MEN_CON : MEN_REG, quantity: q, modifiers: pata ? t : [{ step: "Menudo options", option: "Menudo con Tortillas (4)" }, ...t], readback: pata ? `${q} menudo con pata` : `${q} menudo regular` }; };
/** "dos menudos, uno con pata y el otro normal" → [conPata, normal]. */
export function menudoSplitText(text: string): { con: number; reg: number } | null {
  const t = plain(text);
  const m = t.match(new RegExp(`\\b(${NUMW})\\s+menudos?\\b[^.?!]{0,30}?\\b(${NUMW}|el\\s+otro|la\\s+otra|otro)\\s+(con|sin)\\s+pata\\b[^.?!]{0,12}?\\b(?:y|el|and)\\b[^.?!]{0,12}?\\b(?:el\\s+otro|otro|los\\s+otros|(${NUMW}))\\s+(?:es\\s+|ser[ií]a\\s+)?(normal(?:es)?|regular(?:es)?|sin\\s+pata|con\\s+pata|solo|sencillos?)\\b`));
  if (!m) return null;
  const tot = numOf(m[1]); if (tot < 2) return null;
  const a = /^\d|un|dos|tres|cuatro|cinco|seis/.test(m[2]) && !/otr/.test(m[2]) ? numOf(m[2]) || 1 : 1;
  const firstPata = m[3] === "con"; const secondPata = /^con/.test(m[5]);
  if (firstPata === secondPata) return null;
  const b = m[4] ? numOf(m[4]) : tot - a; if (a + b !== tot || b < 1) return null;
  return firstPata ? { con: a, reg: b } : { con: b, reg: a };
}
const STAFF_PATA_Q = /\bcon\s+pata\b[^.]{0,10}\?|\?\s*con\s+pata\b|¿\s*(?:lo\s+quiere\s+|los\s+quiere\s+|lo\s+quieres\s+)?con\s+pata/iu;
const CALLER_YES = /^\s*(?:(?:y|ah|eh|este|mm+)[,.\s]+)*(?:s[ií]|claro|aj[aá]|[oó]rale|ok(?:ay)?|yes|eso|con\s+pata)(?![\p{L}])/iu;
/** After-call: split "uno con pata y el otro normal"; staff "¿Con pata?" + caller "sí" → Menudo con Pata. */
export function applyMenudoPata(cart: any[], turns: Turn[]): boolean {
  const men = cart.filter(isMenudo); if (!men.length) return false;
  const callerTxt = turns.filter((t) => t.speaker === "caller").map((t) => String(t.text));
  for (const tx of callerTxt) {
    const sp = menudoSplitText(tx); if (!sp) continue;
    const like = men.find((l) => l.itemId === MEN_REG) || men[0];
    const want = [...(sp.con ? [menLine(true, sp.con, like)] : []), ...(sp.reg ? [menLine(false, sp.reg, like)] : [])];
    const cur = men.map((l) => `${l.itemId}x${l.quantity}`).sort().join(); const nw = want.map((l) => `${l.itemId}x${l.quantity}`).sort().join();
    if (cur === nw && men.every((l) => !(l.modifiers || []).some((m: any) => /con pata/i.test(String(m.option))) || l.itemId === MEN_CON)) return false;
    const at = cart.indexOf(men[0]); for (const l of men) cart.splice(cart.indexOf(l), 1); cart.splice(at, 0, ...want); return true;
  }
  // "¿Con pata?" (staff) → caller yes within the next 3 caller turns, no "sin pata/normal" → all plain menudos become con pata
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].speaker !== "staff" || !STAFF_PATA_Q.test(String(turns[i].text))) continue;
    const next = turns.slice(i + 1, i + 6).filter((t) => t.speaker === "caller").slice(0, 3).map((t) => String(t.text));
    if (next.some((x) => /\bsin\s+pata\b|\bnormal\b|\bno\b/iu.test(x))) continue;
    if (!next.some((x) => CALLER_YES.test(x))) continue;
    let ch = false;
    for (const l of cart.filter((x) => x.itemId === MEN_REG)) { if ((l.modifiers || []).some((m: any) => /sin pata/i.test(String(m.option)))) continue; cart[cart.indexOf(l)] = menLine(true, l.quantity || 1, l); ch = true; }
    return ch;
  }
  return false;
}
/** Live: the caller's split ("dos menudos, uno con pata y el otro normal") replaces whatever menudo adds this step. */
export function liveMenudoSplit(r: any, input: any) {
  const sp = menudoSplitText(String(input?.transcript || "")); if (!sp) return r;
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : [];
  const madd = acts.filter((a) => a?.type === "add_item" && isMenudo(a)); const cartMen = (input?.cart || []).filter(isMenudo);
  if (!madd.length && !cartMen.length) return { ...r, actions: [...acts, menLine(true, sp.con), menLine(false, sp.reg)].map((a: any) => (a.type ? a : { type: "add_item", ...a })).filter((a: any) => a.quantity > 0) };
  const like = madd[0] || cartMen[0];
  const out = acts.filter((a) => !madd.includes(a));
  for (const l of cartMen) out.push({ type: "remove_item", itemId: l.itemId, quantity: l.quantity || 1 });
  for (const [p, q] of [[true, sp.con], [false, sp.reg]] as Array<[boolean, number]>) if (q > 0) out.push({ type: "add_item", ...menLine(p, q, like) });
  return { ...r, actions: out };
}
/** ulises1: "verdura aparte" / "cebolla y cilantro … aparte" → "verdura aparte" note on the food lines (after-call). */
const VERD_APARTE = /\b(?:verduras?|cebolla(?:\s+y\s+cilantro)?|cilantro(?:\s+y\s+cebolla)?)\b[^.]{0,40}\b(?:aparte|por\s+separado|on\s+the\s+side)\b|\b(?:aparte|por\s+separado)\b[^.]{0,15}\b(?:la\s+|las\s+)?(?:verduras?|cebolla|cilantro)\b/iu;
const VERD_FOOD = /^sq-(?:torta|taco|quesadilla|qd-|gordita|sope|burrito|tostada|huarache|combo-tortas|combo-tacos)/;
export function applyVerduraAparte(cart: any[], turns: Turn[]): boolean {
  const ct = turns.filter((t) => t.speaker === "caller").map((t) => String(t.text));
  const idx = ct.findIndex((x) => VERD_APARTE.test(x) || (/\bverduras?\b/iu.test(x) && /\baparte\b/iu.test(x))); if (idx < 0) return false;
  const lines = cart.filter((l) => VERD_FOOD.test(String(l.itemId))); if (!lines.length) return false;
  let ch = false;
  for (const l of lines) if (!(l.elviNotes || []).includes("verdura aparte")) { l.elviNotes = [...(l.elviNotes || []), "verdura aparte"]; ch = true; }
  return ch;
}

// antonio1 (CAfa1c39): "y me pones un consomé" / staff "solamente consomé, ¿verdad?" → Birria · SOLO 16oz Consome ($7).
const BIRRIA_ID = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
const CONSOME_SOLO = { step: "Birria de Chivo / Goat Birria options", option: "SOLO / ONLY 16oz de Consome / Broth de Birria" };
const CONSOME_RE = new RegExp(`(?:^|\\b(${NUMW}|solo|solamente|nada\\s+m[aá]s|puro|un\\s+solo)\\s+)(?:de\\s+)?consom[eé]s?\\b`);
/** Caller's standalone consomé count ("un consomé", "dos consomés", "solamente consomé"); 0 when it's "con consomé"/birria/quesabirria. */
export function consomeSoloQty(text: string): number {
  const t = plain(text); if (!/\bconsom[eé]s?\b/.test(t)) return 0;
  if (/\b(?:con|with|y\s+su)\s+(?:su\s+)?consom[eé]|\bbirria|\bquesabirria|\bqueso\s*birria|\blibra\b/.test(t)) return 0;
  const m = t.match(CONSOME_RE); if (!m) return 0;
  return m[1] && numOf(m[1]) ? numOf(m[1]) : 1;
}
const hasConsomeLine = (cart: any[]) => cart.some((l) => /^sq-birria-/.test(String(l.itemId)) || /consom/i.test(JSON.stringify(l.modifiers || [])) || /^sq-queso-birrias-/.test(String(l.itemId)));
export function applyConsomeSolo(cart: any[], turns: Turn[]): boolean {
  if (hasConsomeLine(cart)) return false;
  let q = 0;
  for (const t of turns) if (t.speaker === "caller") q = Math.max(q, consomeSoloQty(String(t.text)));
  if (!q) return false;
  cart.push({ itemId: BIRRIA_ID, quantity: q, modifiers: [CONSOME_SOLO], readback: q > 1 ? `${q} consomés` : "consomé" }); return true;
}
/** Live: "un consomé" → add the consomé solo 16oz now (never a QD regular/deluxe question). */
export function liveConsomeSolo(r: any, input: any) {
  const q = consomeSoloQty(String(input?.transcript || "")); if (!q) return r;
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : [];
  if (hasConsomeLine([...(input?.cart || []), ...acts.filter((a) => a?.type === "add_item")])) return r;
  const keep = acts.filter((a) => !(a?.type === "add_item" && /consom/i.test(JSON.stringify(a))));
  const en = input?.language === "en";
  return { ...r, actions: [...keep, { type: "add_item", itemId: BIRRIA_ID, quantity: q, modifiers: [CONSOME_SOLO], readback: q > 1 ? `${q} consomés` : "consomé" }],
    reply: en ? `${q} consomé, 16 oz. Anything else?` : `${q === 1 ? "Un" : q} consomé${q > 1 ? "s" : ""} de 16 oz. ¿Algo más?` };
}

// miriam-coctel1 (CA67bc69): "¿tienes coctel de camarón?" … "con pulpo" is the Coctel (shrimp + pulpo), never a Ceviche —
// a ceviche line only stands when someone actually said "ceviche".
const COCTEL_SHRIMP = "sq-coctel-de-camarones-shrimp-cocktail-coctel-de-camaron-shrimp-VWHXC4";
const COCTEL_PULPO = "sq-coctel-de-camarones-shrimp-cocktail-coctel-de-camaron-shrimp-and-pulpo-calamari-B5ITWC";
const COCTEL_SAID = /\bc[oó]ct[ae]l(?:es)?\b|\bcocktails?\b|\bcoctel(?:ito)?s?\b/iu;
function coctelFor(itemId: string, pulpo: boolean): string | null {
  if (!/^sq-ceviche-/i.test(itemId) || /pescado|fish|placeholder/i.test(itemId)) return null;
  return /pulpo|calamari/i.test(itemId) || pulpo ? COCTEL_PULPO : COCTEL_SHRIMP;
}
export function applyCoctelNotCeviche(cart: any[], turns: Turn[]): boolean {
  const all = turns.map((t) => String(t.text || "")).join(" ");
  if (!COCTEL_SAID.test(all) || /\bceviches?\b/iu.test(all)) return false;
  const pulpo = /\bpulpo|calamar/iu.test(all); let ch = false;
  for (const l of cart) { const to = coctelFor(String(l.itemId || ""), pulpo); if (to) { l.itemId = to; l.modifiers = (l.modifiers || []).filter((m: any) => !/ceviche/i.test(String(m?.step || ""))); if (l.readback) l.readback = String(l.readback).replace(/ceviche/giu, "coctel"); ch = true; } }
  return ch;
}
export function liveCoctelNotCeviche(r: any, input: any) {
  const hist: any[] = input?.history || [];
  const said = [...hist.filter((h) => h.role === "customer" || h.role === "user").map((h) => String(h.text || "")), String(input?.transcript || "")].join(" ");
  if (!COCTEL_SAID.test(said) || /\bceviches?\b/iu.test(said)) return r;
  const pulpo = /\bpulpo|calamar/iu.test(said); const en = input?.language === "en";
  const acts = (Array.isArray(r?.actions) ? r.actions : []).map((a: any) => {
    if ((a?.type !== "add_item" && a?.type !== "update_item") || !a.itemId) return a;
    const to = coctelFor(String(a.itemId), pulpo); return to ? { ...a, itemId: to, modifiers: (a.modifiers || []).filter((m: any) => !/ceviche/i.test(String(m?.step || ""))) } : a;
  });
  let reply = String(r?.reply || "");
  if (/^\s*Ceviche\s*:\s*¿/u.test(reply)) reply = en ? "Shrimp cocktail: just shrimp, or shrimp with octopus?" : "Coctel de camarón: ¿solo camarón o camarón con pulpo?";
  else reply = reply.replace(/\bCeviche(?:\s+Ceviche)?\s+de\s+Camar[oó]n\s+Con\s+Pulpo\b/giu, "Coctel de Camarón con Pulpo").replace(/\bCeviche(?:\s+Ceviche)?\s+de\s+Camar[oó]n\b/giu, "Coctel de Camarón").replace(/\bCeviche(?:\s+Ceviche)?\s+de\s+Pulpo\b/giu, "Coctel de Camarón con Pulpo");
  return { ...r, actions: acts, reply };
}

// ashley-menudo1 (CAe86b1c): "tres menudos … sin pata" → 3 regular menudos; the "(4)" in "Menudo con Tortillas (4)" is the
// tortilla count, never the quantity, and "sin pata" never reads back "extra pata".
const MEN_COUNT = new RegExp(`(?:^|[^\\p{L}\\d(])(${NUMW})\\s+menudos?(?![\\p{L}])`, "giu");
const SIN_PATA = /\bsin\s+(?:la\s+)?patas?\b|\bno\s+(?:le\s+)?(?:ponga|pongas|quiero)\s+(?:la\s+)?pata\b|\bwithout\s+(?:the\s+)?(?:pata|feet|foot|hoof)\b/iu;
// diana-menudo1: "póngame cuatro" (no dish in the turn) sets the count of the dish being ordered
const PONGAME_N = new RegExp(`(?:^|[^\\p{L}])(?:p[oó]ng(?:a|an)me|p[oó]nme|p[oó]ngale|me\\s+(?:da|das|pone|pones)|d[eé]me|dame)\\s+(?:unos?\\s+|unas?\\s+)?(${NUMW})(?![\\p{L}\\d])`, "giu");
const OTHER_DISH = /(?<![\p{L}])(?:tacos?|quesadillas?|gorditas?|sopes?|huaraches?|tortas?|burritos?|flautas?|tostadas?|tamales?|enchiladas?|pambazos?|platillos?|aguas?|refrescos?|jarritos?|horchatas?|pozole|birria|consom[eé]|coctel|ceviche)(?![\p{L}])/iu;
export function pongameCount(t: string): number {
  if (OTHER_DISH.test(t) || /menudos?/iu.test(t)) return 0;
  let n = 0; for (const m of t.matchAll(PONGAME_N)) { const k = nOf(m[1].toLowerCase()); if (k > 0 && k < 30) n = k; }
  return n;
}
function menudoCountSaid(texts: string[]): number {
  let n = 0; let menCtx = false;
  for (const t of texts) {
    for (const m of t.matchAll(MEN_COUNT)) { const k = nOf(m[1].toLowerCase()); if (k > 0 && k < 30) n = k; }
    if (/menudos?/iu.test(t)) menCtx = true; else if (OTHER_DISH.test(t)) menCtx = false;
    const p = menCtx ? pongameCount(t) : 0; if (p) n = p;
  }
  return n;
}
// marcela-qhr1: a quesadilla add the caller gave a meat for ("tres quesadillas de bistec de harina") carries that meat;
// "no tan dorado" / "poco dorado" is a cook note, never a dorada.
const Q_MEAT: Array<[RegExp, string]> = [
  [/bistec|asada|steak/iu, "Bistec / Steak"], [/chorizo/iu, "Chorizo / Mexican Sausage"], [/pollo|chicken/iu, "Pollo / Chicken"],
  [/picadillo/iu, "Picadillo / Ground Beef"], [/prensado/iu, "Prensado / Spicy Pork"], [/duro/iu, "Duro / Pork Rinds"],
  [/costilla/iu, "Costilla / Beef Rib"], [/pastor/iu, "Alpastor / Roasted Pork"], [/lengua/iu, "Lengua / Beef Tongue"],
  [/tripas?/iu, "Tripa / Beef Tripe"], [/buche/iu, "Buche / Pork Stomach"], [/carnitas/iu, "Carnitas / Pulled Pork"],
];
const QUES_ID = "sq-quesadilla-HLT6CR";
const isMeatMod = (m: any) => /Carnes|Meats/i.test(String(m?.step || "")) || Q_MEAT.some(([, o]) => o === m?.option);
export const NO_TAN_DORADO = /(?<![\p{L}])(?:no\s+(?:tan|muy)|poco|menos|bien\s+poco)\s+dorad[oa]s?(?![\p{L}])|(?<![\p{L}])not\s+(?:too|very|so)\s+(?:crispy|fried|browned)/iu;
function quesMeatIn(t: string): string | null {
  const m = t.match(/quesadillas?\b(.{0,40})/iu); if (!m) return null;
  const seg = m[1]; const hit = Q_MEAT.find(([re]) => new RegExp(`de\\s+(?:al\\s+)?(?:${re.source})`, "iu").test(seg));
  return hit ? hit[1] : null;
}
export function applyQuesadillaMeatSaid(cart: any[], turns: Turn[]): boolean {
  let ch = false; const caller = turns.filter((t) => t.speaker === "caller").map((t) => String(t.text || ""));
  const joined = caller.map((t, i) => t + " " + (caller[i + 1] || ""));
  for (const l of cart) {
    if (l.itemId !== QUES_ID) continue;
    const ji = joined.findIndex((t) => quesMeatIn(t));
    if (!(l.modifiers || []).some(isMeatMod) && ji >= 0) { l.modifiers = [...(l.modifiers || []), { step: "(B) Q Carnes / Meats", option: quesMeatIn(joined[ji])! }]; ch = true; }
    const nt = joined.find((t) => /quesadillas?/iu.test(t) && NO_TAN_DORADO.test(t)); const nm = nt?.match(NO_TAN_DORADO)?.[0];
    if (nm && !(l.elviNotes || []).some((n: string) => /dorad/i.test(n))) { const meat = (nt!.match(/(?:el|la)\s+(\p{L}+)\s+(?:no\s+(?:tan|muy)|poco|menos)\s+dorad/iu) || [])[1]; l.elviNotes = [...(l.elviNotes || []), `${meat ? meat + " " : ""}${nm.toLowerCase()}`]; ch = true; }
  }
  return ch;
}
export function liveQuesadillaMeat(r: any, input: any) {
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : [];
  const said = String(input?.transcript || ""); const m = quesMeatIn(said);
  if (!m || !acts.some((a) => a?.type === "add_item" && a.itemId === QUES_ID && !(a.modifiers || []).some(isMeatMod))) return r;
  return { ...r, actions: acts.map((a) => a?.type === "add_item" && a.itemId === QUES_ID && !(a.modifiers || []).some(isMeatMod) ? { ...a, modifiers: [...(a.modifiers || []), { step: "(B) Q Carnes / Meats", option: m }] } : a) };
}
export function applyMenudoCountSinPata(cart: any[], turns: Turn[]): boolean {
  const men = cart.filter((l) => l.itemId === MEN_REG || l.itemId === MEN_CON); if (!men.length) return false;
  let ch = false;
  const caller = turns.filter((t) => t.speaker === "caller").map((t) => String(t.text || ""));
  if (caller.some((t) => SIN_PATA.test(t)) && !caller.some((t) => /\bcon\s+pata\b/iu.test(t.replace(SIN_PATA, "")))) {
    for (const l of men) {
      if (l.itemId === MEN_CON) { l.itemId = MEN_REG; l.modifiers = [{ step: "Menudo options", option: "Menudo con Tortillas (4)" }, ...(l.modifiers || []).filter((m: any) => /tortilla/i.test(String(m?.step || "")))]; ch = true; }
      const mods = (l.modifiers || []).filter((m: any) => !/pata/i.test(String(m?.option || "")) || /Menudo con Tortillas/i.test(String(m?.option)));
      if (mods.length !== (l.modifiers || []).length) { l.modifiers = mods; ch = true; }
      if (l.readback && /pata/i.test(l.readback)) { l.readback = String(l.readback).replace(/,?\s*(?:extra|con)\s+pata/giu, ""); ch = true; }
    }
  }
  const n = menudoCountSaid(turns.map((t) => String(t.text || "")));
  if (n && men.length === 1 && men[0].quantity !== n) { men[0].quantity = n; ch = true; }
  return ch;
}
export function liveMenudoCountSinPata(r: any, input: any) {
  const hist: any[] = input?.history || [];
  const said = [...hist.filter((h) => h.role === "customer" || h.role === "user").map((h) => String(h.text || "")), String(input?.transcript || "")];
  const acts: any[] = Array.isArray(r?.actions) ? r.actions : [];
  if (!acts.some((a) => a?.type === "add_item" && (a.itemId === MEN_REG || a.itemId === MEN_CON))) return r;
  const sin = said.some((t) => SIN_PATA.test(t)); const n = menudoCountSaid(said);
  const four = said.some((t) => /(?:^|[^(\d])(?:cuatro|4)(?![\d)])/iu.test(t));
  let reply = String(r?.reply || "");
  const out = acts.map((a) => {
    if (a?.type !== "add_item" || (a.itemId !== MEN_REG && a.itemId !== MEN_CON)) return a;
    let b = { ...a };
    if (sin) { b.itemId = MEN_REG; b.modifiers = (b.modifiers || []).filter((m: any) => !/pata/i.test(String(m?.option || "")) || /Menudo con Tortillas/i.test(String(m?.option))); reply = reply.replace(/,?\s*(?:extra|con)\s+pata\b/giu, ""); }
    const q = n || (Number(b.quantity) === 4 && !four ? 1 : 0);
    if (q && Number(b.quantity) !== q) { reply = reply.replace(new RegExp(`(^|\\s)${b.quantity}\\s*×`), `$1${q} ×`).replace(/\s*\$\d+(?:\.\d{2})?\.?/g, ""); b.quantity = q; }
    return b;
  });
  return { ...r, actions: out, reply };
}

// ---- batch 22 (adolfo-combo1, kevin-combo1, angelica-tortillas1, nena1, edgar-mix1) ----
const B22_MEATS: Array<[RegExp, string]> = [
  [/bistec|asada|steak/, "Bistec / Steak"], [/chorizo/, "Chorizo / Mexican Sausage"], [/pollo|chicken/, "Pollo / Chicken"],
  [/costilla/, "Costilla / Beef Rib"], [/pastor/, "Alpastor / Roasted Pork"], [/carnitas/, "Carnitas / Pulled Pork"],
  [/cabeza/, "Cabeza / Beef Head"], [/buche/, "Buche / Pork Stomach"], [/lengua/, "Lengua / Beef Tongue"],
  [/tripa/, "Tripa / Beef Tripe"], [/prensado/, "Prensado / Spicy Pork"], [/duro|chicharr/, "Duro / Pork Rinds"],
  [/deshebrada/, "Deshebrada / Shredded Beef with Potatoes"], [/picadillo/, "Picadillo / Ground Beef with Potatoes"],
  [/birria/, "Birria de Chivo / Goat Birria"],
];
const b22low = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function b22Meats(text: string): string[] {
  const out: Array<[number, string]> = [];
  for (const [re, name] of B22_MEATS) { const g = new RegExp(re.source, "g"); let m; while ((m = g.exec(text))) out.push([m.index, name]); }
  return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}
const COMBO_Q_ID = "sq-combo-quesadillas-BATSPB";
/** adolfo-combo1/kevin-combo1: "dos quesadillas combo" or 2 quesadillas + arroz y frijol → one COMBO Quesadillas line, each quesadilla its own meat; drop phantom singles. After-call. */
export function applyQuesadillaCombo(cart: any[], turns: Turn[]): boolean {
  const all = turns.map((t) => ({ sp: t.speaker, x: b22low(t.text) }));
  const callerQ = all.filter((t) => t.sp === "caller" && /quesadilla/.test(t.x));
  if (!callerQ.length) return false;
  const comboSaid = all.some((t) => /combo/.test(t.x) && (t.sp === "caller" ? true : /quesadilla/.test(t.x)));
  const twoQ = callerQ.some((t) => /(dos|2)\s+quesadillas?/.test(t.x));
  const sides = all.some((t) => t.sp === "caller" && /(arroz|rice)/.test(t.x)) && all.some((t) => t.sp === "caller" && /(frijol|beans)/.test(t.x));
  if (!(comboSaid || (twoQ && sides))) return false;
  // more than 2 quesadillas said, or another quesadilla beyond the combo → leave alone
  if (callerQ.some((t) => /(tres|cuatro|cinco|seis|[3-9])\s+quesadillas|otra\s+quesadilla|dos\s+combos/.test(t.x))) return false;
  // meats: "uno de X y uno de Y" in caller turns after first quesadilla mention, else "quesadillas de X"
  const firstQ = all.findIndex((t) => t.sp === "caller" && /quesadilla/.test(t.x));
  let meats: string[] = [];
  for (const t of all.slice(firstQ)) {
    if (t.sp !== "caller") continue;
    const parts = t.x.match(/un[oa]?\s+de\s+[a-z ]+?(?=,|\s+y\s+un|$|\.)/g);
    if (parts && parts.length >= 2) { meats = parts.flatMap((p) => b22Meats(p).slice(0, 1)); if (meats.length >= 2) break; }
  }
  if (meats.length < 2) {
    const q = callerQ.map((t) => b22Meats(t.x)).find((m) => m.length);
    if (!q) return false;
    meats = q.length >= 2 ? q.slice(0, 2) : [q[0], q[0]];
  }
  const callerTxt = all.filter((t) => t.sp === "caller").map((t) => t.x).join(" ");
  const shell = /harina|flour/.test(callerTxt) ? "(QHR) 2 x Harina / Flour (+$1.00)" : /taquera|street/.test(callerTxt) && !/comal/.test(callerTxt) ? "(QST) 2 x Taquera / Street" : "(QCO) 2 x Comal / Homemade (+$2.00)";
  const ra = /(arroz|rice)/.test(callerTxt), fr = /(frijol|beans)/.test(callerTxt);
  const side = ra && !fr ? "SOLO Arroz - Rice" : fr && !ra ? "SOLO Frijoles Refritos - Refried Beans" : "Arroz - Rice and Frijoles Refritos - Refried Beans";
  const prev = cart.find((l) => l?.itemId === COMBO_Q_ID);
  const keep = (prev?.modifiers || []).filter((m: any) => !/^\((A|B|CD|D)\)/.test(String(m.step)));
  const line: any = prev || { itemId: COMBO_Q_ID, quantity: 1 };
  line.quantity = 1;
  line.modifiers = [
    { step: "(A) Q Tortilla Shell Option COMBO", option: shell },
    { step: "(B) Item #1 Carne/Meat Option COMBO", option: "1 x " + meats[0] },
    { step: "(CD) Item #2 Carne/Meat Option COMBO", option: "1 x " + meats[1] },
    { step: "(D) COMBO Sides", option: side },
    ...keep,
  ];
  const before = JSON.stringify(cart);
  for (let i = cart.length - 1; i >= 0; i--) {
    const id = String(cart[i]?.itemId || "");
    if (cart[i] !== line && (id === COMBO_Q_ID || /^sq-quesadilla-|^sq-qd-quesadilla/.test(id))) cart.splice(i, 1);
  }
  if (!cart.includes(line)) cart.push(line);
  return JSON.stringify(cart) !== before;
}

/** angelica-tortillas1: duplicate tortilla pack lines → one; last "N docenas" said wins; drop a pack style never said. After-call. */
export function applyTortillaPackDedupe(cart: any[], turns: Turn[]): boolean {
  const packs = cart.filter((l) => /^sq-tortillas-/.test(String(l?.itemId || "")));
  if (packs.length < 2) return false;
  const callerTxt = turns.filter((t) => t.speaker === "caller").map((t) => b22low(t.text)).join(" ");
  const before = JSON.stringify(cart);
  const styleSaid = (id: string) => /taquera|street/.test(id) ? /taquer|street/.test(callerTxt) : /harina|flour/.test(id) ? /harina|flour/.test(callerTxt) : true;
  const ids = [...new Set(packs.map((l) => l.itemId))];
  const saidIds = ids.filter(styleSaid);
  if (!saidIds.length) return false;
  for (let i = cart.length - 1; i >= 0; i--) if (/^sq-tortillas-/.test(String(cart[i]?.itemId)) && !saidIds.includes(cart[i].itemId)) cart.splice(i, 1);
  const NW: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  let last: number | null = null;
  for (const m of callerTxt.matchAll(/(\d+|una?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+docenas?/g)) last = /\d/.test(m[1]) ? +m[1] : NW[m[1]];
  for (const id of saidIds) {
    const ls = cart.filter((l) => l?.itemId === id);
    if (ls.length < 2 && last == null) continue;
    const q = last != null && /-12-/.test(id) ? last : ls[ls.length - 1].quantity;
    ls[0].quantity = q;
    for (const l of ls.slice(1)) cart.splice(cart.indexOf(l), 1);
  }
  return JSON.stringify(cart) !== before;
}

/** nena1: "cuatro tortas de milanesa" → torta qty 4 and no carne modifier the caller never said with the torta. After-call. */
export function applyTortaSaid(cart: any[], turns: Turn[]): boolean {
  const tortas = cart.filter((l) => /^sq-torta-/.test(String(l?.itemId || "")));
  if (tortas.length !== 1) return false;
  const t = tortas[0];
  const tt = turns.filter((x) => x.speaker === "caller").map((x) => b22low(x.text)).filter((x) => /tort[ao]s?(?![a-z])/.test(x) && !/tortilla/.test(x));
  if (!tt.length) return false;
  const NW: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8 };
  let n: number | null = null;
  for (const x of tt) { const m = x.match(/(\d+|una?|dos|tres|cuatro|cinco|seis|siete|ocho)\s+tort[ao]s?(?![a-z])/); if (m) n = /\d/.test(m[1]) ? +m[1] : NW[m[1]]; }
  const before = JSON.stringify(t);
  if (n && n > 1) t.quantity = n;
  const txt = tt.join(" ");
  if ((t.modifiers || []).some((m: any) => /milanesa/i.test(m.option)) && /milanesa/.test(txt)) {
    t.modifiers = t.modifiers.filter((m: any) => !/Carne|Meat/i.test(String(m.step)) || /milanesa/i.test(m.option) || b22Meats(b22low(m.option)).some((mm) => b22Meats(txt).includes(mm)));
  }
  return JSON.stringify(t) !== before;
}

/** edgar-mix1: taco line with 2+ meats when caller listed "uno de X, uno de Y" → one taco per meat; drop meatless taco lines beyond the tacos stated; collapse exact-duplicate burrito lines said once. After-call. */
export function applyTacoMeatList(cart: any[], turns: Turn[]): boolean {
  const before = JSON.stringify(cart);
  const ct = turns.filter((t) => t.speaker === "caller").map((t) => b22low(t.text));
  const listed = ct.filter((x) => /^(y\s+)?un[oa]?\s+del?\s+/.test(x.trim()) || /un[oa]\s+de\s+\w+\s+y\s+un[oa]\s+de/.test(x)).length >= 2;
  const isTaco = (l: any) => /^sq-taco-/.test(String(l?.itemId || ""));
  const meatMods = (l: any) => (l.modifiers || []).filter((m: any) => b22Meats(b22low(m.option)).length && !/salsa|tortilla|\(T[A-Z]+\)/i.test(m.option));
  if (listed) {
    for (const l of [...cart]) {
      if (!isTaco(l) || l.quantity !== 1) continue;
      const mm = meatMods(l);
      if (mm.length < 2) continue;
      const rest = l.modifiers.filter((m: any) => !mm.includes(m));
      const idx = cart.indexOf(l);
      cart.splice(idx, 1, ...mm.map((m: any) => ({ ...structuredClone(l), modifiers: [m, ...structuredClone(rest)], quantity: 1 })));
    }
    let stated = 0;
    for (const x of ct) for (const m of x.matchAll(/(\d+|dos|tres|cuatro|cinco|seis)\s+tacos/g)) stated += /\d/.test(m[1]) ? +m[1] : ({ dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 } as any)[m[1]];
    const withMeat = cart.filter((l) => isTaco(l) && meatMods(l).length).reduce((a, l) => a + (l.quantity || 1), 0);
    if (stated && withMeat >= stated) for (let i = cart.length - 1; i >= 0; i--) if (isTaco(cart[i]) && !meatMods(cart[i]).length) cart.splice(i, 1);
  }
  // exact-duplicate burrito lines: keep one when caller never said 2 of that meat / "otro ... igual" of same meat
  const key = (l: any) => l.itemId + "|" + (l.modifiers || []).map((m: any) => m.option).sort().join("|");
  const seen = new Map<string, any>();
  for (const l of [...cart]) {
    if (!/^sq-burrito-/.test(String(l?.itemId || "")) || l.quantity !== 1) continue;
    const k = key(l);
    if (!seen.has(k)) { seen.set(k, l); continue; }
    const meats = meatMods(l).flatMap((m: any) => b22Meats(b22low(m.option)));
    const twice = ct.filter((x) => /burrito/.test(x) && meats.some((mm) => b22Meats(x).includes(mm))).length >= 2 || ct.some((x) => /(dos|2)\s+burritos/.test(x));
    if (!twice) cart.splice(cart.indexOf(l), 1);
  }
  return JSON.stringify(cart) !== before;
}
