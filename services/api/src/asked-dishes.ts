// maria2 (CA329b3324, Oct 30 5:37 PM ET): Elvi asked "Stuffed Poblano Pepper: Arroz-Rice and Frijoles-Beans…? And 3 x (Corn)…?"
// but the question never closed (staff-pick took the tortilla, "Sí" to staff's "arroz y frijol" was an ack), so the chile
// relleno never reached the cart. Rule: once Elvi has asked a dish's side/choice questions, that dish is in the cart.
import { dishNamedIn } from "./elvi.js";

type Turn = { speaker: string; text: string };
const plain = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const SKIP = new Set(["solo", "only", "and", "with", "con", "the", "extra", "side", "lado", "options", "option", "opciones"]);
const stem = (w: string) => w.replace(/(es|s)$/, "").slice(0, 6);
const wordsOf = (o: string) => [...new Set(plain(o.replace(/\(\+?\$[\d.]+\)/g, " ").replace(/\b\d+\s*x\b/gi, " ")).split(" ").filter((w) => w.length >= 4 && !SKIP.has(w)).map(stem))];
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, one: 1, a: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5 };
const CANCEL = /\b(quit[ae]|quitale|cancel\w*|olvid\w+|ya no|nevermind|never mind|remove|take off)\b/;

function itemForQuestion(name: string, menu: any[]) {
  const n = plain(name);
  if (n.length < 3) return null;
  return menu.find((i) => [i.readbackName, i.readbackNameEs, i.name, i.nameEs].filter(Boolean)
    .some((x: string) => { const p = plain(x), first = plain(String(x).split(" / ")[0]), last = plain(String(x).split(" / ").slice(-1)[0]); return p === n || first === n || last === n || (n.length >= 8 && (p.startsWith(n) || n.startsWith(last) && last.length >= 8)); })) || null;
}

/** Pick an option for a required group from what was said after the question; else default; else null. */
export function pickFromSpeech(group: any, said: string): { option: string; how: "only" | "said" | "default" } | null {
  const opts: string[] = (group.options || []).map((o: any) => (typeof o === "string" ? o : o.name));
  if (opts.length === 1) return { option: opts[0], how: "only" };
  const toks = plain(said).split(" ").map(stem);
  const has = new Set(toks);
  const scored = opts.map((o) => ({ o, n: wordsOf(o).filter((w) => has.has(w)).length, solo: /\bsolo|only\b/i.test(o) }));
  const saidSolo = /\b(solo|solamente|nada mas|only|just)\b/.test(plain(said));
  for (const s of scored) if (s.n > 0 && s.solo) s.n += saidSolo ? 0.5 : -0.5;
  const best = Math.max(...scored.map((s) => s.n));
  const top = scored.filter((s) => s.n === best);
  if (best >= 1 && top.length === 1) return { option: top[0].o, how: "said" };
  const def = (group.defaultOptions || [])[0];
  return def && opts.includes(def) ? { option: def, how: "default" } : null;
}

export function applyAskedDishes(cart: any[], steps: any[], turns: Turn[], menu: any[]) {
  if (!Array.isArray(menu) || !menu.length) return;
  const callerAll = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
  const seen = new Set<string>();
  steps.forEach((s, si) => {
    const m = String(s?.reply || "").match(/^([^:¿?\n]{3,70}):\s*¿?[^?]*\?/u);
    if (!m || !s.heard) return;
    const item = itemForQuestion(m[1].trim(), menu);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    if (cart.some((l) => l.itemId === item.id)) return;
    if (!dishNamedIn(item, callerAll)) return; // Elvi asked about a dish nobody said
    const later = steps.slice(si).map((x) => String(x.heard || "")).join(" ");
    if (CANCEL.test(plain(later))) return;
    const q = plain(String(s.heard)).match(/\b(\d+|un|una|uno|one|a|dos|two|tres|three|cuatro|four|cinco|five)\s+(?:orden(?:es)?\s+de\s+(?:de\s+)?|order(?:s)?\s+of\s+)?\w+/);
    const quantity = q ? (Number(q[1]) || NUM[q[1]] || 1) : 1;
    const modifiers: any[] = [], notes: string[] = [];
    for (const g of (item.modifierGroups || []).filter((g: any) => (g.minSelections ?? 0) > 0)) {
      const p = pickFromSpeech(g, later);
      if (p) modifiers.push({ step: g.name, option: p.option, ...(p.how === "default" ? { isDefault: true } : {}) });
      else notes.push(`confirmar ${g.name}`);
    }
    cart.push({ itemId: item.id, quantity, modifiers, ...(notes.length ? { elviNotes: notes } : {}), asked: true });
    steps.push({ source: "asked-dish", heard: String(s.heard).slice(0, 80), item: item.id });
  });
}
