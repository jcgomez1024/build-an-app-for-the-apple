// maria2 (CA329b3324, Oct 30 5:37 PM ET): Elvi asked "Stuffed Poblano Pepper: Arroz-Rice and Frijoles-Beans…? And 3 x (Corn)…?"
// but the question never closed (staff-pick took the tortilla, "Sí" to staff's "arroz y frijol" was an ack), so the chile
// relleno never reached the cart. Rule: once Elvi has asked a dish's side/choice questions, that dish is in the cart.
import { dishNamedIn } from "./elvi.js";
import { declinedQuesabirria } from "./list-repair.js";

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
    // jose-qb1: the question came from a decline ("quesibirrias no, normales") — not an order
    if (/queso-birrias/i.test(String(item.id)) && steps.some((x) => /^caller/.test(String(x?.source || "")) && declinedQuesabirria(String(x?.heard || ""))) && !turns.some((t) => t.speaker === "caller" && /quesa[bv]irria|queso\s*[bv]irria/i.test(t.text) && !declinedQuesabirria(t.text))) return;
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

// maria3 (CA2a89f700, Oct 30 5:43 PM ET): callback "acabo de hacer una orden… ¿no me pueden adherir un pambazo?" — staff
// confirmed "papas con nopales y chorizo, lleva todo… lechuga, crema, queso fresco"; Elvi's cart stayed empty → noOrder.
// An add-on callback is an order: ring the named dish from the confirmed choices and tag it for the earlier ticket.
export const ADD_ON = /\b(?:agr[eé]g\w*|a[ñn]ad\w*|adher\w*|adjunt\w*|tambi[eé]n\s+quiero|se\s+me\s+olvid\w*|acabo\s+de\s+(?:hacer|pedir|ordenar)\s+(?:una|la|mi)\s+orden|add\s+(?:to|on)\b|forgot\s+to\s+(?:add|order)|i\s+just\s+(?:placed|made)\s+an?\s+order)/iu;
export const ADD_ON_NOTE = "AGREGAR a la orden anterior de este número";
const spanishWords = (o: string) => plain(String(o).split(" / ")[0].replace(/\(\+?\$[\d.]+\)/g, " ")).split(" ").filter((w) => w.length >= 4 && w !== "con");
const saysAll = (words: string[], text: string) => { const has = new Set(plain(text).split(" ").map(stem)); return words.length > 0 && words.every((w) => has.has(stem(w))); };
const firstAt = (words: string[], text: string) => Math.min(...words.map((w) => { const i = plain(text).search(new RegExp(`\\b${stem(w)}`)); return i < 0 ? 1e9 : i; }));

export function applyAddOnCallback(cart: any[], turns: Turn[], menu: any[]): boolean {
  if (cart.length || !Array.isArray(menu) || !menu.length) return false;
  const caller = turns.filter((t) => t.speaker === "caller").map((t) => t.text).join(" ");
  if (!ADD_ON.test(caller)) return false;
  const dishes = menu.filter((i) => (i.modifierGroups || []).length && dishNamedIn(i, caller) && !/drink|bebida/i.test(String(i.category || "")));
  // prefer the item whose own name word the caller said earliest; one dish per add-on callback unless clearly more
  const at = (i: any) => firstAt(plain(String(i.name).split(" / ")[0]).split(" ").filter((w) => w.length >= 4 && !/elvis/.test(w)), caller);
  const dish = dishes.sort((a, b) => at(a) - at(b))[0];
  if (!dish || at(dish) >= 1e9) return false;
  const all = turns.map((t) => t.text).join(" ");
  const after = all.slice(Math.max(0, plain(all).search(new RegExp(`\\b${stem(plain(String(dish.name).split(" ")[0]))}`))));
  const modifiers: any[] = [], notes: string[] = [ADD_ON_NOTE];
  for (const g of dish.modifierGroups || []) {
    const opts: string[] = (g.options || []).map((o: any) => (typeof o === "string" ? o : o.name));
    const hits = opts.filter((o) => !/double|extra|\+\$/i.test(o) && saysAll(spanishWords(o), after))
      .filter((o, _i, arr) => !arr.some((p) => p !== o && spanishWords(p).length > spanishWords(o).length && spanishWords(o).every((w) => spanishWords(p).includes(w))))
      .sort((a, b) => firstAt(spanishWords(a), after) - firstAt(spanishWords(b), after));
    const req = (g.minSelections ?? 0) > 0;
    if (!req && /salsa|extra|agua/i.test(g.name)) continue;
    const keep = g.maxSelections ? hits.slice(0, g.maxSelections) : hits;
    for (const o of keep) modifiers.push({ step: g.name, option: o });
    if (req && !keep.length) notes.push(`confirmar ${g.name}`);
  }
  const q = plain(caller).match(/\b(\d+|dos|tres|cuatro|two|three|four)\s+\w+/);
  cart.push({ itemId: dish.id, quantity: q && plain(q[0]).includes(stem(plain(String(dish.name).split(" ")[0]))) ? (Number(q[1]) || NUM[q[1]] || 1) : 1, modifiers, elviNotes: notes, addOn: true });
  return true;
}

/** maria3: point the add-on note at the same caller's most recent earlier order (last 3 h) from the call log. */
export function attachAddOnNote(order: any, caller: string, events: any[], nowMs = Date.now(), callSid = ""): string | null {
  if (!order?.addOn || !caller) return null;
  const prior = events.filter((e) => e?.event === "recording" && e.caller === caller && e.callSid !== callSid && Array.isArray(e.lines) && e.lines.length
    && nowMs - Date.parse(e.ts) < 3 * 3600e3 && Date.parse(e.ts) <= nowMs).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
  if (!prior) return null;
  const when = new Date(Date.parse(prior.ts)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const note = `AGREGAR a la orden de ${when}${prior.name ? ` (${prior.name})` : ""} — llamada …${String(prior.callSid).slice(-6)}`;
  for (const l of order.cart || []) if (l.addOn) l.elviNotes = (l.elviNotes || []).map((n: string) => (n === ADD_ON_NOTE ? note : n));
  order.addOnTo = prior.callSid;
  return prior.callSid;
}
