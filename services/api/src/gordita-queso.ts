// jonathan1 (CA855f43): gordita duro con queso + gordita bistec "sin queso" (twice) → bistec rang QGD; the duro's "con queso"
// answer was read as Queso Birrias (3 × QB nobody said); the readback ledger re-added the duro gordita.
type Turn = { speaker?: string; text: string };
type Line = { itemId: string; quantity: number; modifiers?: { step: string; option: string }[]; [k: string]: any };
const nrm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const GORDITA = /^sq-gordita-/;
const MEATS: [RegExp, string][] = [[/\b(?:duro|chicharron(?:\s+duro)?)\b/, "Duro"], [/\bprensado\b/, "Prensado"], [/\bbistec\b/, "Bistec"], [/\bchorizo\b/, "Chorizo"],
  [/\bcarnitas\b/, "Carnitas"], [/\bpollo\b/, "Pollo"], [/\bcabeza\b/, "Cabeza"], [/\b(?:al\s*)?pastor\b/, "Alpastor"], [/\bbuche\b/, "Buche"], [/\blengua\b/, "Lengua"],
  [/\btripa\b/, "Tripa"], [/\bcostilla\b/, "Costilla"], [/\bpicadillo\b/, "Picadillo"], [/\bdeshebrada\b/, "Deshebrada"]];
const meatsAt = (x: string) => { const out: { meat: string; at: number }[] = []; for (const [re, meat] of MEATS) { const g = new RegExp(re.source, "g"); let m; while ((m = g.exec(x))) out.push({ meat, at: m.index }); } return out.sort((a, b) => a.at - b.at); };
const meatOf = (l: Line) => (l.modifiers || []).find((m) => /Carnes|Meats/i.test(m.step))?.option || "";
/** Per gordita: the last "con/sin queso" said for its meat wins (a bare answer goes to the meat just talked about). */
export function applyGorditaQueso(cart: Line[], turns: Turn[]): void {
  const g = cart.filter((l) => GORDITA.test(l.itemId)); if (!g.length) return;
  const want = new Map<string, boolean>(); let last = "";
  for (const t of turns) {
    const x = nrm(t.text), ms = meatsAt(x);
    const q = [...x.matchAll(/\b(con|sin)\s+queso\b(?!\s+(?:fresco|birria))/g)];
    const question = t.speaker === "staff" && /\?\s*$/.test(String(t.text).trim());
    if (q.length && !(q.some((m) => m[1] === "con") && q.some((m) => m[1] === "sin")) && !question) for (const m of q) {
      const before = ms.filter((v) => v.at < m.index!).pop(), after = ms.find((v) => v.at > m.index!);
      const meat = (before && m.index! - before.at < 25 ? before.meat : after && after.at - m.index! < 25 ? after.meat : before?.meat) || last;
      if (meat) want.set(meat, m[1] === "con");
    }
    if (ms.length) last = ms[ms.length - 1].meat;
  }
  for (const l of g) { const meat = MEATS.find(([, k]) => new RegExp(k, "i").test(meatOf(l)))?.[1]; if (!meat || !want.has(meat)) continue;
    // modifier objects can be shared between lines — replace, never mutate
    l.modifiers = (l.modifiers || []).map((m) => /Gordita\s+Options/i.test(m.step) ? { ...m, option: want.get(meat) ? "(QGD) Queso Gordita (+$0.50)" : "(GD) Gordita" } : m); }
}
/** A ledger re-add (readback-tagged) of a gordita that's already rung once, with no second one spoken, is a duplicate. */
export function dropGorditaReaddTwin(cart: Line[], turns: Turn[]): void {
  const callerSaid = turns.filter((t) => t.speaker === "caller").map((t) => nrm(t.text)).join(" ");
  const sig = (l: Line) => JSON.stringify((l.modifiers || []).map((m) => m.option).sort());
  for (let i = cart.length - 1; i >= 0; i--) { const l = cart[i]; if (!GORDITA.test(l.itemId) || !l.readback || l.quantity !== 1) continue;
    const twin = cart.find((o, j) => j !== i && GORDITA.test(o.itemId) && !o.readback && sig(o) === sig(l)); if (!twin) continue;
    const meat = MEATS.find(([, k]) => new RegExp(k, "i").test(meatOf(l)));
    if (meat && new RegExp(String.raw`\b(?:dos|tres|[2-9]|otra)\b[^.?!]{0,30}${meat[0].source}`).test(callerSaid)) continue;
    cart.splice(i, 1); }
}
/** Queso Birrias only when someone said birria (a bare "con queso" is not QB). */
export function dropUnsaidQuesoBirrias(cart: Line[], turns: Turn[]): void {
  if (turns.some((t) => /[bv]irri|\bqb\b/.test(nrm(t.text)))) return;
  for (let i = cart.length - 1; i >= 0; i--) if (/^sq-queso-birrias/.test(cart[i].itemId)) cart.splice(i, 1);
}
