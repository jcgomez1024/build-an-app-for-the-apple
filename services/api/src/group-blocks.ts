// ronald2 (CA66f2c1): "tres órdenes" — Kevin QB + 3 bistec, Pedro QB + 4 pastor, Ronald "cuatro tacos" … "Al pastor".
// Each person's lines were deduped as restatements (1 QB, 4 pastor). Per-person blocks must ADD.
import { personSwitch } from "./call-scoring.js";
type Turn = { speaker?: string; text: string };
type Line = { itemId: string; quantity: number; modifiers?: { step: string; option: string }[]; [k: string]: any };
const QB_ID = "sq-queso-birrias-qst-3-x-queso-birrias-taquera-street-con-consome-broth-VUBNR7";
const TACO_ID = "sq-taco-TAR7L5";
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, unas: 1, unos: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const MEATS: [RegExp, string][] = [[/\b(?:al\s*)?pastor\b/, "Alpastor"], [/\bbistec\b/, "Bistec"], [/\bchorizo\b/, "Chorizo"], [/\bcarnitas\b/, "Carnitas"],
  [/\bpollo\b/, "Pollo"], [/\bcabeza\b/, "Cabeza"], [/\blengua\b/, "Lengua"], [/\btripa\b/, "Tripa"], [/\bbuche\b/, "Buche"], [/\bcostilla\b/, "Costilla"]];
const nrm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const meatIn = (t: string) => MEATS.find(([re]) => re.test(t))?.[1] || null;
const QB = /\bque\s*[sz]?[aie]?\s*[bv]irrias?\b|\bqueso\s*birrias?\b|\bquesa\s*[bv]ir/;
/** Staff answering "¿para quién?" with a bare name ("Kevin.") also closes a block. */
const bareName = (t: string) => /^\s*(\p{Lu}\p{Ll}{2,})\s*[.!]?\s*$/u.exec(t)?.[1] || null;
type Block = { who: string; qb: number; tacos: Map<string, number> };
export function groupBlocks(turns: Turn[]): Block[] {
  const out: Block[] = []; let cur: Block = { who: "", qb: 0, tacos: new Map() }; let pend = 0;
  const close = (who: string) => { if (cur.who && cur.who === who) return; if (cur.qb || cur.tacos.size) { cur.who = who; out.push(cur); } else if (out.length && out[out.length - 1].who === who) return; cur = { who: "", qb: 0, tacos: new Map() }; pend = 0; };
  for (const t of turns) {
    const raw = String(t.text || ""), x = nrm(raw);
    if (t.speaker === "caller") {
      if (QB.test(x) && !cur.qb) { const n = /\b(dos|tres|\d)\s+(?:ordenes?\s+de\s+)?que/.exec(x); cur.qb = n ? (NUM[n[1]] || Number(n[1])) : 1; }
      const m = /\b(\d+|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+tacos?\b(?:\s+de\s+([a-z ]{3,20}))?/.exec(x);
      if (m && !/\btienes\b/.test(x)) { const n = NUM[m[1]] || Number(m[1]); const meat = meatIn(m[2] || "") || meatIn(x.slice(m.index));
        if (meat) cur.tacos.set(meat, Math.max(cur.tacos.get(meat) || 0, n)); else pend = n; }
      else if (pend) { const meat = meatIn(x); if (meat && x.split(/\s+/).length <= 4) { cur.tacos.set(meat, Math.max(cur.tacos.get(meat) || 0, pend)); pend = 0; } }
    }
    const who = (t.speaker === "caller" ? personSwitch(raw) : null) || (t.speaker === "staff" ? bareName(raw) : null);
    if (who && who !== "me") close(who);
  }
  return out;
}
const meatOf = (l: Line) => (l.modifiers || []).map((m) => m.option).join(" ");
export function applyGroupBlockCounts(cart: Line[], turns: Turn[]): void {
  const bl = groupBlocks(turns);
  if (new Set(bl.map((b) => b.who)).size < 2) return;
  const qb = bl.reduce((s, b) => s + b.qb, 0);
  const tacos = new Map<string, number>(); for (const b of bl) for (const [k, v] of b.tacos) tacos.set(k, (tacos.get(k) || 0) + v);
  const raise = (match: (l: Line) => boolean, want: number, make: () => Line) => {
    const ls = cart.filter(match); const have = ls.reduce((s, l) => s + (Number(l.quantity) || 1), 0);
    if (have >= want) return; if (ls.length) ls[ls.length - 1].quantity += want - have; else { const l = make(); l.quantity = want - have; cart.push(l); }
  };
  if (qb) raise((l) => /^sq-queso-birrias/.test(l.itemId), qb, () => ({ itemId: QB_ID, quantity: 1, modifiers: [{ step: "Queso Birrias options", option: "(QST) 3 x Queso Birrias Taquera / Street con Consome / Broth" }] }));
  for (const [meat, n] of tacos) raise((l) => l.itemId === TACO_ID && new RegExp(meat, "i").test(meatOf(l)), n, () => ({ itemId: TACO_ID, quantity: 1, modifiers: [
    { step: "(B) T Carnes / Meats Opciones", option: meat === "Alpastor" ? "Alpastor / Roasted Pork" : meat === "Bistec" ? "Bistec / Steak" : meat }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] }));
}
