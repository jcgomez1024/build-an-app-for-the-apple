// namecheck1 (Carlos): listen-only practice — the customer name Elvi hears goes on her shadow order and is compared with the
// matched staff Square ticket's name (read-only). Informational: never part of the item score, never a staff flag.
import { nameFromTranscript, nameFromAnswer } from "./order-name.js";
import { cleanFirstName } from "./caller-memory.js";

type Turn = { speaker: "caller" | "staff"; text: string };
const SELF = /(?<![\p{L}])(?:this\s+is|my\s+name\s+is|me\s+llamo|mi\s+nombre\s+es|habla|le\s+habla|a\s+nombre\s+de|under(?:\s+the\s+name)?)\s+(\p{L}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?)/iu;
const NOT = /^(calling|here|from|the|a|an|for|to|un|una|el|la|de|para|order|orden|pedido|pick|pickup|delivery|cocina|elvis|elvi)$/i;
/** Display form: Title Case, accents kept ("josé luis" → "José Luis"). */
export const displayName = (raw: string | null | undefined) => {
  const w = String(raw || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean).slice(0, 3);
  const out = w.map((x) => x.toLocaleLowerCase("es").replace(/(^|[-'’])(\p{L})/gu, (_m, a, b) => a + b.toLocaleUpperCase("es"))).join(" ");
  return out && cleanFirstName(out) ? out : null;
};
/** The name Elvi heard: answer to "¿a nombre de quién?", staff vocative, then caller self-intro ("this is Ryan", "habla Martín"). */
export function heardName(turns: Turn[], orderName?: string | null): string | null {
  const n = orderName || nameFromTranscript(turns);
  if (n) return displayName(n);
  for (const t of turns) {
    if (t.speaker !== "caller") continue;
    const m = SELF.exec(t.text); if (!m) continue;
    const first = m[1].split(/\s+/)[0];
    if (NOT.test(first)) continue;
    const d = displayName(nameFromAnswer(m[1]) || m[1]); if (d) return d;
  }
  return null;
}
const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
/** Staff ticket's name (read-only): pickup/delivery recipient, ticket name, else a short note that looks like a name. */
export function ticketName(order: any): string | null {
  for (const f of order?.fulfillments || []) for (const d of [f.pickup_details, f.delivery_details, f.shipment_details]) if (d?.recipient?.display_name) return displayName(d.recipient.display_name);
  if (order?.ticket_name) { const n = displayName(String(order.ticket_name).replace(/^(?:to\s*go|para\s+llevar|pick\s*up)\b[\s:-]*/i, "")); if (n) return n; }
  const note = String(order?.note || "").trim();
  if (note && note.split(/\s+/).length <= 3 && /^\p{Lu}/u.test(note)) return displayName(note);
  return null;
}
const lev = (a: string, b: string) => { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; };
const skel = (s: string) => s.replace(/h/g, "").replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1").replace(/v/g, "b").replace(/z/g, "s").replace(/k|q/g, "c");
export type NameResult = "match" | "close" | "missing" | "mismatch";
/** null = the ticket carries no name (nothing to compare). */
export function compareNames(heard: string | null, ticket: string | null): NameResult | null {
  if (!ticket) return null;
  if (!heard) return "missing";
  const h = fold(heard), t = fold(ticket), hf = h.split(" ")[0], tf = t.split(" ")[0];
  if (h === t || hf === tf) return "match";
  const close = (a: string, b: string) => a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a) || lev(a, b) <= (Math.min(a.length, b.length) >= 5 ? 2 : 1) || skel(a) === skel(b));
  if (close(hf, tf) || t.split(" ").includes(hf) || h.split(" ").includes(tf)) return "close";
  return "mismatch";
}
export function nameStats(rows: Array<{ at: string; nameCheck?: { heard: string | null; result: NameResult | null } | null }>) {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const week = (d: Date) => { const x = new Date(day(d) + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return `wk ${x.toISOString().slice(0, 10)}`; };
  const m = new Map<string, { period: string; calls: number; heard: number; compared: number; match: number; close: number; missing: number; mismatch: number }>();
  for (const r of rows) {
    if (!r.nameCheck) continue;
    const k = week(new Date(r.at)), s = m.get(k) || { period: k, calls: 0, heard: 0, compared: 0, match: 0, close: 0, missing: 0, mismatch: 0 };
    s.calls++; if (r.nameCheck.heard) s.heard++; if (r.nameCheck.result) { s.compared++; s[r.nameCheck.result]++; }
    m.set(k, s);
  }
  return [...m.values()].sort((a, b) => a.period.localeCompare(b.period)).map((s) => ({ ...s, accuracy: s.compared ? Math.round(((s.match + s.close * 0.5) / s.compared) * 1000) / 10 : null }));
}
