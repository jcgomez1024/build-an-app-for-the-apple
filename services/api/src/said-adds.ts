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
