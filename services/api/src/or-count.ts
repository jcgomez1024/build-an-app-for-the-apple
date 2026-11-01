// stephanie1 (CA4d4c38): caller self-corrections "six tacos, or eight tacos" (last number wins) and
// enumerated same-dish lines "one quesadilla of chorizo, and then another quesadilla of biste" (one line per meat).
const NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const NUMW = String.raw`\d{1,2}|${Object.keys(NUM).filter((k) => k.length > 2).join("|")}`;
const DISH = String.raw`tacos?|quesadillas?|gorditas?|tortas?|burritos?|sopes?|huaraches?|tostadas?|flautas?|enchiladas?|tamales?`;
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()] || 0);
const stem = (s: string) => s.toLowerCase().replace(/(?<=l)es$/, "").replace(/s$/, "");
const kindOf = (itemId: string) => { const m = String(itemId || "").match(/^sq-([a-z]+)/); return m ? m[1] : ""; };

export function orCorrections(texts: string[]): Array<{ kind: string; from: number; to: number }> {
  const out: Array<{ kind: string; from: number; to: number }> = [];
  const re = new RegExp(String.raw`\b(${NUMW})\s+(${DISH})\b\s*,?\s+(?:or|o|no\s*,?|i\s+mean|mejor)\s+(?:like\s+|maybe\s+|sea\s+)?(${NUMW})\s+(${DISH})\b`, "giu");
  for (const t of texts) for (const m of String(t || "").matchAll(re)) {
    if (stem(m[2]) !== stem(m[4])) continue; const from = num(m[1]), to = num(m[3]);
    if (from > 0 && to > 0 && from !== to) out.push({ kind: stem(m[2]), from, to });
  }
  return out;
}
/** Lines of the corrected dish still at the first number take the last one. */
export function applyOrCount(lines: any[], texts: string[]): number {
  let n = 0;
  for (const c of orCorrections(texts)) for (const a of lines) {
    if (a?.type && a.type !== "add_item" && a.type !== "update_item") continue;
    if (kindOf(a.itemId) === c.kind && Number(a.quantity) === c.from) { a.quantity = c.to; n++; }
  }
  return n;
}
const MEATS: Array<[RegExp, RegExp]> = [
  [/\b(?:bistec|biste|bisteck|steak|asada)\b/iu, /^bistec/i], [/\bchorizo\b/iu, /^chorizo/i], [/\b(?:al\s+)?pastor\b/iu, /pastor/i],
  [/\bcarnitas\b/iu, /^carnitas/i], [/\b(?:pollo|chicken)\b/iu, /^pollo/i], [/\bcabeza\b/iu, /^cabeza/i], [/\blengua\b|\btongue\b/iu, /^lengua/i],
  [/\btripa\b|\btripe\b/iu, /^tripa/i], [/\bsuadero\b/iu, /^suadero/i], [/\bbarbacoa\b/iu, /^barbacoa/i], [/\bbirria\b/iu, /birria/i],
];
/** "one quesadilla of chorizo, and then another quesadilla of biste": every enumerated meat gets its own line of that dish. */
export function enumeratedDishMeats(text: string): Array<{ kind: string; opt: RegExp }> {
  const re = new RegExp(String.raw`\b(?:one|a|another|una?|otr[ao])\s+(${DISH})\s+(?:of|de|with|con)\s+((?:\p{L}+[\s-]*){1,2})`, "giu");
  const out: Array<{ kind: string; opt: RegExp }> = [];
  for (const m of String(text || "").matchAll(re)) { const hit = MEATS.find(([w]) => w.test(m[2])); if (hit) out.push({ kind: stem(m[1]), opt: hit[1] }); }
  return out;
}
const meatOf = (a: any) => (a?.modifiers || []).find((x: any) => /carne|meat/i.test(String(x.step || "")));
export function addEnumeratedMeats(lines: any[], text: string, menu: any[], asAction = false): number {
  const said = enumeratedDishMeats(text); let n = 0;
  const kinds = new Set(said.map((s) => s.kind));
  for (const k of kinds) {
    const want = said.filter((s) => s.kind === k); if (want.length < 2) continue;
    const sib = lines.find((a) => (!a?.type || a.type === "add_item") && kindOf(a.itemId) === k && meatOf(a)); if (!sib) continue;
    const item = menu.find((m: any) => m?.id === sib.itemId); const grp = (item?.modifierGroups || []).find((g: any) => g.name === meatOf(sib).step);
    if (!grp) continue;
    for (const w of want) {
      if (lines.some((a) => kindOf(a.itemId) === k && w.opt.test(String(meatOf(a)?.option || "")))) continue;
      const o = (grp.options || []).find((x: any) => w.opt.test(String(x.name || ""))); if (!o) continue;
      const c = JSON.parse(JSON.stringify(sib)); c.quantity = 1;
      c.modifiers = c.modifiers.map((x: any) => (x.step === grp.name ? { ...x, option: o.name } : x));
      if (asAction) c.type = "add_item"; delete c.lineId; lines.push(c); n++;
    }
  }
  return n;
}
