/** readback1: staff reconfirming the order near the end of a call ("entonces, tus quesadillas y tus tacos y tus dos
 *  cocas van a ser 38 dólares, ¿okay?") and the customer's answer. Pure, no PII kept beyond the turn text itself. */
export type Readback = { status: "confirmed" | "corrected" | "none"; staffText?: string; response?: string; correction?: string; turnIndex?: number; dishCounts?: Record<string, number> };
const FOOD = /\b(tacos?|burritos?|quesadillas?|gorditas?|tortas?|enchiladas?|tamales?|horchatas?|jamaicas?|aguas?|sopes?|sopesazos?|huaraches?|tostadas?|chilaquiles|menudos?|cocas?|cokes?|nachos|flautas?|elotes?|pupusas?|combos?|drinks?|sodas?)\b/giu;
const RECAP = /\b(entonces|ser[ií]an?|van a ser|le confirmo|te confirmo|le repito|repito|ser[ií]a|tienes?|tiene|so (that'?s|you)|you (got|have)|that'?s|your order|tu orden|su orden|total)\b/iu;
const YES = /^\s*[¿¡]?\s*(s[ií]|aj[aá]|ok(ay)?|correcto|exacto|eso(\s+es)?|as[ií]\s+es|perfecto|est[aá]\s+bien|yes|yeah|yep|correct|right|that'?s (it|right|correct)|mm+\s*hmm|uh[\s-]*huh)(?=[\s,.!?]|$)/iu;
const NO = /^\s*[¿¡]?\s*(no\b|nop|nel|wait|espera|perd[oó]n|actually|en realidad|y\s+tambi[eé]n|also|plus|me falt[oó]|falt[oó])/iu;
const COUNT: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const noun = (w: string) => w.toLowerCase().replace(/(es|s)$/u, "").replace(/^coke$/, "coca").replace(/^agua$/, "agua");
/** "dos quesadillas y tres tacos" → { quesadilla: 2, taco: 3 }; a dish with no number counts 1 only if singular. */
export function dishCounts(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = new RegExp(`(?:\\b(\\d+|${Object.keys(COUNT).join("|")})\\s+(?:\\p{L}+\\s+){0,2}?)?${FOOD.source}`, "giu");
  for (const m of String(text || "").matchAll(re)) { const n = m[1] ? (/^\d+$/.test(m[1]) ? Number(m[1]) : COUNT[m[1].toLowerCase()]) : /s$/i.test(m[2]) && !/^chilaquiles|nachos$/i.test(m[2]) ? 0 : 1; const k = noun(m[2]); if (n) out[k] = (out[k] || 0) + n; else out[k] = out[k] || 0; }
  return out;
}
export function detectReadback(turns: Array<{ speaker: string; text: string }>): Readback {
  const t = turns || []; if (t.length < 4) return { status: "none" };
  const from = Math.floor(t.length * 0.5);
  for (let i = t.length - 1; i >= from; i--) {
    const x = t[i]; if (x.speaker === "caller") continue;
    const foods = (String(x.text).match(FOOD) || []).length;
    if (!(foods >= 2 || (foods >= 1 && RECAP.test(x.text)))) continue;
    const reply = t.slice(i + 1).find((y) => y.speaker === "caller");
    if (!reply) continue;
    const base = { staffText: x.text, response: reply.text, turnIndex: i, dishCounts: dishCounts(x.text) };
    if (NO.test(reply.text) || (FOOD.test(reply.text) && !YES.test(reply.text))) { FOOD.lastIndex = 0; return { status: "corrected", ...base, correction: reply.text }; }
    FOOD.lastIndex = 0;
    if (YES.test(reply.text)) return { status: "confirmed", ...base };
  }
  return { status: "none" };
}
/** Truth precedence (readback1): confirmed recap > customer words > ticket. Recaps are parsed at dish/quantity level only:
 *  a confirmed (or corrected-then-applied) recap that names a dish with a count fixes that dish's quantity on the truth. */
export function applyReadback<L extends { name: string; baseName?: string; quantity: number; totalCents: number; unitCents: number }>(lines: L[], rb: Readback): { lines: L[]; changed: string[] } {
  if (rb.status === "none" || !rb.dishCounts) return { lines, changed: [] };
  const counts = { ...rb.dishCounts };
  if (rb.status === "corrected" && rb.correction) for (const [k, v] of Object.entries(dishCounts(rb.correction))) counts[k] = /y\s+tambi[eé]n|also|plus|otr[oa]|another|m[aá]s/i.test(rb.correction) ? (counts[k] || 0) + (v || 1) : v || counts[k] || 0;
  const out = lines.map((l) => ({ ...l })); const changed: string[] = [];
  for (const [k, n] of Object.entries(counts)) {
    if (!n) continue;
    const mine = out.filter((l) => noun(String((l.baseName || l.name).match(FOOD)?.[0] || "")) === k); FOOD.lastIndex = 0;
    if (mine.length !== 1) continue; // several lines of that dish: a recap count can't say which one changed
    if (mine[0].quantity !== n) { changed.push(`${k}: ${mine[0].quantity} → ${n} (read-back ${rb.status})`); mine[0].quantity = n; mine[0].totalCents = mine[0].unitCents * n; }
  }
  return { lines: out, changed };
}
