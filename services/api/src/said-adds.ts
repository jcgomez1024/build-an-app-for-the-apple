// cris1 (CA99377e, Nov 5 11:06 AM ET, staff-answered): "harina de tripas?" → staff "Dos de harina, de tripas" rang 1;
// "que es torta de, … de chorizo" (staff "¿Queso y torta? Okey") never rang; "unos frijoles … al lado" / staff "seis de frijoles" (side) dropped.
type Turn = { speaker: string; text: string };
const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const MEATS: [RegExp, string][] = [[/\bbistec|\bsteak/, "Bistec"], [/\bcabeza/, "Cabeza"], [/\bcarnitas/, "Carnitas"], [/\bchorizo/, "Chorizo"],
  [/\bcostilla/, "Costilla"], [/\bpollo/, "Pollo"], [/\b(?:al ?)?pastor/, "Alpastor"], [/\bbuche/, "Buche"], [/\blengua/, "Lengua"],
  [/\btripas?\b/, "Tripa"], [/\bprensado/, "Prensado"], [/\bduro\b/, "Duro"]];
const meatOf = (s: string) => { const p = fold(s); for (const [re, k] of MEATS) if (re.test(p)) return k; return null; };
const lineMeat = (l: any) => { for (const m of l.modifiers || []) if (/carne|meat/i.test(String(m.step))) { const k = meatOf(String(m.option).split("/")[0]); if (k) return k; } return null; };
const DISH = /^sq-(?:quesadilla|qd|taco|gordita|torta|burrito|sope|huarache|tostada)-/i;

/** Staff echo "Dos de harina, de tripas" / "dos de tripa" right after the caller named that meat → the single qty-1 line of that meat takes N. */
export function applyStaffMeatCountEcho(cart: any[], turns: Turn[]): boolean {
  let ch = false;
  for (let i = 1; i < turns.length; i++) { const s = turns[i]; if (s.speaker !== "staff") continue;
    const p = fold(s.text).replace(/[,.¿?¡!]/g, " ").replace(/\s+/g, " ");
    const m = p.match(/^(?:(?:ok(?:ay|ey)?|si|muy bien|claro) )*(dos|tres|cuatro|cinco|seis|\d) (?:de (?:harina|comal|maiz|doradas?|taquer[oa]s?) )?(?:de )+([a-z]+)/); if (!m) continue;
    const n = NUM[m[1]] || +m[1]; const meat = meatOf(m[2]); if (!n || n < 2 || !meat) continue;
    const prev = turns.slice(Math.max(0, i - 2), i).filter((t) => t.speaker === "caller").map((t) => fold(t.text)).join(" ");
    if (meatOf(prev) !== meat) continue;
    if (turns.slice(i + 1, i + 3).some((t) => t.speaker === "caller" && /^\W*(?:no|nomas una?|solo una?)\b/.test(fold(t.text)))) continue;
    // esteban1: any other line of that meat (e.g. 2 QD bistec + 1 taco bistec) makes the echo ambiguous → leave counts alone
    const ls = cart.filter((l) => lineMeat(l) === meat); if (ls.some((l) => !DISH.test(String(l.itemId)))) continue;
    if (ls.length === 1 && (Number(ls[0].quantity) || 1) === 1) { ls[0].quantity = n; ch = true; } }
  return ch;
}

/** Caller "torta de <meat>" (also split "torta de," … "de chorizo") with no torta line → add it, unless staff said it's out or caller said no. */
export function addSaidTorta(cart: any[], turns: Turn[], menu: any[]): boolean {
  if (cart.some((l) => /^sq-torta-|tortas?-/i.test(String(l.itemId)))) return false;
  const item = (menu || []).find((x: any) => /^sq-torta-/i.test(String(x.id))); if (!item) return false;
  const cs = turns.map((t, i) => ({ t, i })).filter((x) => x.t.speaker === "caller");
  for (let k = 0; k < cs.length; k++) { const p = fold(cs[k].t.text); if (!/\btortas?\b/.test(p) || /tortilla/.test(p)) continue;
    let meat = meatOf(p.split(/\btortas?\b/)[1] || ""); let end = cs[k].i;
    if (!meat && /\btortas? de\W*$/.test(p) && cs[k + 1] && /^\W*(?:de\s+)+[a-z]/.test(fold(cs[k + 1].t.text))) { meat = meatOf(cs[k + 1].t.text); end = cs[k + 1].i; }
    if (!meat) continue;
    const after = turns.slice(end + 1, end + 4).map((t) => (t.speaker === "caller" ? "C:" : "S:") + fold(t.text)).join(" | ");
    if (/S:[^|]*(?:no (?:hay|tenemos|tengo)|se (?:nos |me )?acab)|C:\W*no\b/.test(after)) continue;
    const nm = p.match(/\b(dos|tres|cuatro|\d) tortas?\b/); const qty = nm ? NUM[nm[1]] || +nm[1] : 1;
    const groups = item.modifierGroups || item.modifiers || [];
    const opt = (re: RegExp, g: RegExp) => { const gr = groups.find((x: any) => g.test(String(x.name))); const o = gr && (gr.options || []).find((y: any) => re.test(String(y.name))); return o ? { step: gr.name, option: o.name } : null; };
    const mods = [opt(/^\(TO\) Torta/, /Torta Options/), opt(new RegExp("^" + meat, "i"), /Carne/)].filter(Boolean);
    if (mods.length < 2) continue;
    cart.push({ itemId: item.id, quantity: qty, modifiers: mods }); return true; }
  return false;
}

const MEAT_ALT = "cabeza|bistec|steak|asada|pastor|alpastor|pollo|carnitas|chorizo|lengua|tripas?|buche|prensado|costillas?|birria|deshebrada|picadillo|suadero";
/** Staff is out of this meat: "cabeza sí no tengo todavía", "no tengo cabeza", "se acabó la lengua". Not "sí tengo X". */
export function staffMeatsOut(text: string): string[] {
  const found = new Set<string>();
  const grab = (w: string) => { const k = meatOf(w); if (k) found.add(k); };
  for (const c of fold(text).split(/[.!?;]+/)) {
    for (const m of c.matchAll(new RegExp(String.raw`\b(${MEAT_ALT})\b(?:\s+(?!no\b)\w+){0,6}\s+no\s+(?:tengo|tenemos|hay|queda)\b`, "g"))) grab(m[1]);
    for (const m of c.matchAll(new RegExp(String.raw`\bno,?\s+(?:tengo|tenemos|hay|queda|quedan)\s+(?:de\s+)?(${MEAT_ALT})\b`, "g"))) grab(m[1]);
    for (const m of c.matchAll(new RegExp(String.raw`\b(${MEAT_ALT})\b(?:\s+(?!se\b)\w+){0,4}\s+se\s+(?:nos\s+|me\s+)?acab`, "g"))) grab(m[1]);
    for (const m of c.matchAll(new RegExp(String.raw`\bse\s+(?:nos\s+|me\s+)?acab\w*\s+(?:la\s+|el\s+|de\s+)?(${MEAT_ALT})\b`, "g"))) grab(m[1]);
    for (const m of c.matchAll(new RegExp(String.raw`\bya\s+no\s+(?:hay|tengo|tenemos|queda)\s+(?:de\s+)?(${MEAT_ALT})\b`, "g"))) grab(m[1]);
  }
  return [...found];
}
const lineFamily = (id: string): string | null => /^sq-taco-/.test(id) ? "taco" : /^sq-torta-/.test(id) ? "torta" : /^sq-(?:quesadilla|qd)-/.test(id) ? "quesadilla" : /^sq-gordita-/.test(id) ? "gordita" : /^sq-burrito-/.test(id) ? "burrito" : /^sq-sope/.test(id) ? "sope" : null;
function dishIn(s: string): string | null {
  const p = fold(s);
  if (/\bquesadillas?\b|\bdoradas?\b|\bqd\b/.test(p)) return "quesadilla";
  if (/\btacos?\b/.test(p)) return "taco";
  if (/\btortas?\b/.test(p) && !/tortilla/.test(p)) return "torta";
  if (/\bgorditas?\b/.test(p)) return "gordita";
  if (/\bburritos?\b/.test(p)) return "burrito";
  if (/\bsopes?\b/.test(p)) return "sope";
  return null;
}
const meatNegated = (text: string, meat: string) => {
  const w = meat === "Alpastor" ? "pastor" : meat.toLowerCase();
  const p = fold(text);
  return new RegExp(String.raw`\b(?:de\s+)?${w}\w*\s+no\b`).test(p) || new RegExp(String.raw`\bno\s+(?:de\s+)?${w}`).test(p);
};
/** Staff is out of a meat and the caller orders a different one for that dish → drop the cancelled meat lines.
 *  "también" / a different dish keeps the original. A later positive re-ask of the same meat keeps it. */
export function dropSwitchedOffMeat(cart: any[], turns: Turn[]): boolean {
  let ch = false;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].speaker !== "staff") continue;
    const out = staffMeatsOut(turns[i].text);
    if (!out.length) continue;
    const prev = [...turns.slice(0, i)].reverse().find((t) => t.speaker === "caller");
    const dish = dishIn(turns[i].text) || (prev ? dishIn(prev.text) : null);
    const later = turns.slice(i + 1).filter((t) => t.speaker === "caller");
    for (const meat of out) {
      if (later.some((t) => meatOf(t.text) === meat && !meatNegated(t.text, meat) && !/\bno\s+(?:tengo|hay|tenemos)\b/.test(fold(t.text)))) continue;
      const switched = later.some((t) => {
        const m = meatOf(t.text);
        if (!m || m === meat) return false;
        const d = dishIn(t.text);
        if (dish && d && d !== dish) return false;
        const p = fold(t.text);
        if (/\btambi[eé]n\b|\balso\b/.test(p) && !/\bentonces\b|\bmejor\b|\ben\s+vez\b|\binstead\b/.test(p)) return false;
        if (!d && !/\b(?:entonces|mejor|ponme|dame|deme|de|instead)\b/.test(p)) return false;
        return true;
      });
      if (!switched) continue;
      for (let j = cart.length - 1; j >= 0; j--) {
        if (lineMeat(cart[j]) !== meat) continue;
        const fam = lineFamily(String(cart[j].itemId || ""));
        if (dish && fam && fam !== dish) continue;
        cart.splice(j, 1); ch = true;
      }
    }
  }
  return ch;
}
const TORTA_PLAIN = "(TO) Torta";
/** "Normales" / "regulares" / "sencillas" answering a torta queso-or-normal question → (TO) Torta, no cheese.
 *  A quesadilla/sope "¿preparadas o normales?" is not this. Caller "queso torta" / "con queso" after that answer still wins. */
export function applyTortaNormales(cart: any[], turns: Turn[], menu: any[] = []): boolean {
  const tortas = cart.filter((l) => /^sq-torta-/.test(String(l?.itemId || "")));
  if (!tortas.length) return false;
  const idx: number[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]; if (t.speaker !== "caller") continue;
    const p = fold(t.text).trim();
    if (!/\b(?:normales|normal|regulares|regular|sencillas|sencilla)\b/.test(p)) continue;
    const withTorta = /\btortas?\b/.test(p) && !/tortilla/.test(p);
    const bare = /^(?:(?:no|ah|eh|ok(?:ay)?|pues|son|las|los)\s+)*(?:normales|normal|regulares|regular|sencillas|sencilla)\b[.!]*$/.test(p);
    if (!bare && !withTorta) continue;
    if (/\b(?:quesadill|dorad|sopes|gordit|birria)\b/.test(p) && !withTorta) continue;
    if (bare) {
      const staff = [...turns.slice(0, i)].reverse().find((x) => x.speaker === "staff");
      const prevDish = [...turns.slice(0, i)].reverse().find((x) => x.speaker === "caller" && /\b(?:tortas?|quesadill|dorad|sopes|gordit)\b/.test(fold(x.text)));
      const sp = fold(staff?.text || "");
      if (/\b(?:quesadill|dorad|sopes|gordit|birria)\b/.test(sp) && !/\btortas?\b/.test(sp)) continue;
      const recentTorta = (/\btortas?\b/.test(sp) && !/tortilla/.test(sp)) || (!!prevDish && /\btortas?\b/.test(fold(prevDish.text)) && !/tortilla/.test(fold(prevDish.text)) && !/\b(?:quesadill|dorad|sopes)\b/.test(fold(prevDish.text)));
      if (!recentTorta) continue;
    }
    idx.push(i);
  }
  if (!idx.length) return false;
  const lastN = idx[idx.length - 1];
  const cheeseAt = turns.findIndex((t, i) => i > lastN && t.speaker === "caller" && /\b(?:queso\s+tortas?|quesitort|con\s+queso|en\s+queso)\b/.test(fold(t.text)));
  if (cheeseAt >= 0) return false;
  let plainOpt = TORTA_PLAIN;
  for (const item of menu || []) {
    if (!/^sq-torta-/.test(String(item?.id || ""))) continue;
    for (const g of item.modifierGroups || item.modifiers || []) {
      const o = (g.options || []).find((y: any) => /^\(TO\) Torta\b/.test(String(y?.name || y)));
      if (o) plainOpt = String(o.name || o);
    }
  }
  let ch = false;
  for (const l of tortas) {
    const before = JSON.stringify(l.modifiers || []);
    let mods = (l.modifiers || []).map((m: any) => /\(QTO\)/i.test(String(m.option)) ? { ...m, option: plainOpt } : m);
    mods = mods.filter((m: any) => !/queso derretido|melted cheese|\(QTO\)/i.test(String(m.option)));
    if (!mods.some((m: any) => /\(TO\)/.test(String(m.option)))) mods = [{ step: "(A) Torta Options", option: plainOpt }, ...mods];
    const seen = new Set<string>();
    mods = mods.filter((m: any) => { const k = /\(TO\)/.test(String(m.option)) ? "TO" : String(m.option); if (seen.has(k)) return false; seen.add(k); return true; });
    if (JSON.stringify(mods) !== before) { l.modifiers = mods; ch = true; }
  }
  return ch;
}
/** "unos frijoles … al lado/aparte" or staff "side/seis de frijoles" with no beans anywhere → 1 Sides · Frijoles. */
export function addSideFrijoles(cart: any[], turns: Turn[], menu: any[]): boolean {
  const said = turns.some((t) => { const p = fold(t.text);
    return (t.speaker === "caller" && /frijol/.test(p) && /\b(?:al lado|de lado|aparte|side|orden de frijol)/.test(p)) || (t.speaker === "staff" && /\b(?:side|seis|sai) de (?:puros )?frijol/.test(p)); });
  if (!said) return false;
  if (cart.some((l) => /frijol|beans|sides/i.test(String(l.itemId) + JSON.stringify(l.modifiers || [])))) return false;
  const item = (menu || []).find((x: any) => /^sq-sides-/i.test(String(x.id))); if (!item) return false;
  const gr = (item.modifierGroups || item.modifiers || [])[0]; const o = gr && (gr.options || []).find((y: any) => /^Frijoles/i.test(String(y.name))); if (!o) return false;
  cart.push({ itemId: item.id, quantity: 1, modifiers: [{ step: gr.name, option: o.name }] }); return true;
}
