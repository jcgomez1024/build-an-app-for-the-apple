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
  const done = lines.every((l) => (l.modifiers || []).some((m: any) => /tortilla|shell|options/i.test(String(m.step)) && !/salsa|deluxe/i.test(String(m.step))) && (l.modifiers || []).some((m: any) => /carne|meat/i.test(String(m.step))));
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
  const c = said(turns, "caller"); if (!/\bpreparad[ao]s?\b/.test(c) || callerSaidNormalQd(c.replace(/\bpreparad[ao]s? o (?:normal|regular)(?:es)?\b/g, ""))) return false;
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
