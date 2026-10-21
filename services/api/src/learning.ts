import { detectReadback, applyReadback } from "./staff-readback.js";
import path from "node:path";
import fs from "node:fs";
// learn2: labeled examples. Ground truth = what the CUSTOMER said: the staff ticket, corrected by the auditor's staff flags
// (STAFF_MISSING adds what was said, STAFF_EXTRA removes what wasn't), so Elvi never learns a staff error.
// PII stripped; files only under data/learning/ (gitignored).
import { scoreOrder, type Line, type Miss } from "./call-accuracy.js";
import { createHash } from "node:crypto";

type Flag = { type: string; detail: string };
const STAFF = /^(STAFF_EXTRA|STAFF_MISSING|PRICE_DIFF|CUSTOM_AMOUNT|DELIVERY_FEE_MISSING|DELIVERY_FEE_WRONG)$/;
export function truthOverrides(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/learning/truth-overrides.json"), "utf8")); } catch { return {}; }
}
/** grade1: data quality per call — every grade trains, weighted. */
export type Grade = "best" | "good" | "medium" | "bad";
export const GRADE_DEFAULTS: Record<Grade, number> = { best: 1.0, good: 0.75, medium: 0.5, bad: 0.25 };
export function gradeWeights(): Record<Grade, number> {
  try { return { ...GRADE_DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/learning/config.json"), "utf8")).gradeWeights }; } catch { return { ...GRADE_DEFAULTS }; }
}
export const gradeWeight = (g: Grade) => gradeWeights()[g] ?? 0.5;
const dishKey = (l: { name: string; baseName?: string }) => { const m = String(l.baseName || l.name).toLowerCase().match(/tacos?|burritos?|quesadillas?|gorditas?|tortas?|enchiladas?|tamales?|horchatas?|jamaicas?|aguas?|sopes?|huaraches?|tostadas?|chilaquiles|menudos?|cocas?|coca cola|nachos|flautas?/); return m ? m[0].replace(/ cola$/, "").replace(/(es|s)$/, "") : null; };
/** BEST: ticket = customer's words, full read-back confirmed. GOOD: ticket = words with no read-back, or a corrected
 *  read-back the ticket reflects. MEDIUM: staff errors / partly unclear, truth fixed by words or overrides. BAD: unclear. */
export function gradeCall(o: { unclear: boolean; staffScore: number | null; readback: { status: string; dishCounts?: Record<string, number> }; truthLines: Array<{ name: string; baseName?: string }>; overridden?: boolean; corrected?: string[] }): Grade {
  if (o.unclear) return "bad";
  const ticketOk = o.staffScore === 100 && !o.overridden;
  if (!ticketOk) return "medium";
  if (o.readback.status === "confirmed") {
    const said = new Set(Object.keys(o.readback.dishCounts || {}));
    const full = o.truthLines.map(dishKey).filter(Boolean).every((k) => said.has(k as string));
    return full ? "best" : "good";
  }
  return "good"; // no read-back, or corrected and the ticket reflects it (staffScore 100 against the corrected truth)
}
/** staffgrade1: BEST = ticket 100% vs correct order AND confirmed read-back. GOOD = exact, no read-back (or a corrected
 *  read-back the ticket reflects). MEDIUM = minor (one or two option/modifier misses, custom amount, price). BAD = wrong
 *  or missing dish, wrong meat, wrong qty, or 3+ errors. Unclear calls: no staff grade. */
export function staffGradeOf(o: { unclear: boolean; staffScore: number | null; misses: Miss[]; readback: { status: string } }): Grade | null {
  if (o.unclear || o.staffScore == null) return null;
  if (o.staffScore === 100 && !o.misses.length) return o.readback.status === "confirmed" ? "best" : "good";
  const types = o.misses.map(errorType);
  if (types.length >= 3 || types.some((t) => /^(missed item|extra item|wrong qty|wrong meat|wrong dish type)$/.test(t))) return "bad";
  return "medium";
}
export function staffGradeByDevice(ex: Example[]) {
  const out: Record<string, { best: number; good: number; medium: number; bad: number; calls: number; readbacks: number; readbackRate: number | null }> = {};
  for (const e of ex) { if (e.channel !== "phone" || !e.staffGrade) continue;
    for (const k of ["all", e.answeredBy || "unknown"]) { const o = (out[k] = out[k] || { best: 0, good: 0, medium: 0, bad: 0, calls: 0, readbacks: 0, readbackRate: null }); o[e.staffGrade]++; o.calls++; if (e.readback && e.readback !== "none") o.readbacks++; o.readbackRate = Math.round((o.readbacks / o.calls) * 1000) / 10; } }
  return out;
}
export function gradeStats(ex: Example[]) {
  const out: Record<string, number> = { best: 0, good: 0, medium: 0, bad: 0 };
  for (const e of ex) if (e.channel === "phone" && e.grade) out[e.grade]++;
  return out;
}
/** readback1: Elvi/staff accuracy with vs without a staff read-back, by answering device (desk 9249 / cell 6793 /
 *  counter). Messy calls excluded. Later: per staff member once a staff name is captured on answer. */
export function readbackStats(ex0: Example[]) {
  const ex = ex0.filter((e) => e.channel === "phone" && e.difficulty !== "messy" && e.elviScore != null && e.staffScore != null);
  const groups = new Map<string, Example[]>();
  for (const e of ex) for (const k of ["all", e.answeredBy || "unknown"]) groups.set(k, [...(groups.get(k) || []), e]);
  const avg = (xs: Example[], f: (e: Example) => number) => (xs.length ? Math.round((xs.reduce((a, e) => a + f(e), 0) / xs.length) * 10) / 10 : null);
  return [...groups].map(([device, xs]) => { const w = xs.filter((e) => e.readback && e.readback !== "none"), wo = xs.filter((e) => !e.readback || e.readback === "none");
    return { device, calls: xs.length, readbacks: w.length, confirmed: xs.filter((e) => e.readback === "confirmed").length, corrected: xs.filter((e) => e.readback === "corrected").length,
      withReadback: { elvi: avg(w, (e) => e.elviScore!), staff: avg(w, (e) => e.staffScore!) }, withoutReadback: { elvi: avg(wo, (e) => e.elviScore!), staff: avg(wo, (e) => e.staffScore!) } }; });
}
/** readback1: confirmed recap phrasings (PII stripped) — examples for Elvi's own end-of-order confirmation wording. */
export function readbackPhrases(rows: any[]): Array<{ ref: string; text: string; response: string; language: string }> {
  const out: any[] = [];
  for (const r of rows) { const rb = detectReadback((r.turns || []) as any); if (rb.status !== "confirmed" || !rb.staffText) continue;
    const names = [r.customerName, r.orderName, r.nameCheck?.heard, r.nameCheck?.ticket];
    out.push({ ref: ref(r.callSid), text: stripPii(rb.staffText, names), response: stripPii(rb.response || "", names), language: /(the|your|that|you)/i.test(rb.staffText) ? "en" : "es" }); }
  return out;
}
const clone = (l: Line): Line => ({ ...l, choices: [...(l.choices || [])] });
const MEAT_RE = /bistec|steak|pastor|chorizo|pollo|chicken|carnitas|cabeza|buche|tripa|prensado|duro|pork rinds|lengua|suadero|barbacoa|birria|campechana|camar|shrimp|pescado|fish/i;
/** case1b: the ticket choice a voice-only choice would contradict on the same line, or null. */
export function conflictsWith(have: string[], add: string): string | null {
  const VAR = /^\s*\([A-Z]{1,4}\)/;
  const find = (re: RegExp) => have.find((c) => re.test(c)) || null;
  if (VAR.test(add)) return find(VAR);
  if (MEAT_RE.test(add) && !/frijol|bean|queso|cheese/i.test(add)) return have.find((c) => MEAT_RE.test(c) && !/frijol|bean|queso|cheese/i.test(c)) || null;
  if (/queso derretido|melted cheese/i.test(add)) return find(/\(QGD\)|queso gordita/i);
  if (/frijoles refritos|refried beans/i.test(add)) return find(/con frijoles|with beans/i);
  if (/con frijoles|with beans/i.test(add)) return find(/frijoles refritos|refried beans/i);
  return null;
}
export function groundTruth(ticket: Line[], elvi: Line[], flags: Flag[] = []): { lines: Line[]; corrected: string[] } {
  let gt = ticket.map(clone); const corrected: string[] = []; const used = new Set<Line>();
  for (const f of flags.filter((x) => STAFF.test(x.type))) {
    const d = String(f.detail || "");
    let m = /^ticket item never mentioned:\s*\d+\s*×\s*(.+)$/.exec(d);
    if (m) { const n = gt.length; gt = gt.filter((l) => l.name !== m![1].trim() && l.baseName !== m![1].trim()); if (gt.length < n) corrected.push(`removed ${m[1].trim()}`); continue; }
    m = /^(.+?):\s*(.+?) said, not rung$/.exec(d);
    if (m) { for (const l of gt) if (l.name === m[1] && !l.choices.includes(m[2])) {
      const clash = conflictsWith(l.choices, m[2]); // case1b: never two tortillas / two meats / QGD + melted cheese on one line
      if (clash) { corrected.push(`skipped ${m[2]} on ${m[1]} (conflicts with ${clash})`); continue; }
      l.choices.push(m[2]); corrected.push(`added ${m[2]} on ${m[1]}`); } continue; }
    m = /^(.+?):\s*(.+?) never mentioned$/.exec(d);
    if (m) { for (const l of gt) if (l.name === m[1] && l.choices.includes(m[2])) { l.choices = l.choices.filter((c) => c !== m![2]); corrected.push(`removed ${m[2]} from ${m[1]}`); } continue; }
    m = /^custom amount \$([\d.]+)$/.exec(d);
    if (m) { // a2: staff rang a said item as a custom amount — the voice item with that total replaces the nameless line
      const cents = Math.round(Number(m[1]) * 100), i = gt.findIndex((l) => !String(l.name || "").trim() && l.totalCents === cents);
      const said = elvi.filter((e) => !ticket.some((g) => g.name === e.name));
      let pick = said.find((e) => e.totalCents === cents && !used.has(e));
      // alex1: no exact total (staff typed their own price) — when the nameless lines and the voice-only items are the same
      // count, pair them in price order (cheapest custom ↔ cheapest voice item)
      if (!pick && i >= 0) { const blanks = ticket.filter((l) => !String(l.name || "").trim()).map((l) => l.totalCents).sort((x, y) => x - y); const all = [...said].sort((x, y) => x.totalCents - y.totalCents);
        if (blanks.length === all.length) { const c = all[blanks.indexOf(cents)]; if (c && !used.has(c)) pick = c; } }
      if (i >= 0 && pick) { used.add(pick); gt.splice(i, 1, clone(pick)); corrected.push(`custom amount → ${pick.baseName || pick.name}`); }
      continue;
    }
    if (f.type === "PRICE_DIFF") for (const l of gt) { const e = elvi.find((x) => x.name === l.name); if (e && e.unitCents !== l.unitCents) { l.unitCents = e.unitCents; l.totalCents = e.unitCents * l.quantity; corrected.push(`catalog price on ${l.name}`); } }
  }
  return { lines: gt, corrected };
}

const ADDR = /\b\d{2,6}\s+(?:[a-z]+\s){0,3}(?:st|street|ave|avenue|rd|road|dr|drive|blvd|lane|ln|ct|court|way|calle|avenida)\b\.?/gi;
export function stripPii(text: string, names: Array<string | null | undefined> = []): string {
  let t = String(text || "").replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "<PHONE>").replace(/\b\d{7,}\b/g, "<PHONE>").replace(ADDR, "<ADDRESS>").replace(/\S+@\S+\.\S+/g, "<EMAIL>");
  for (const n of names) for (const w of String(n || "").split(/\s+/).filter((x) => x.length >= 2)) t = t.replace(new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "giu"), "<NAME>");
  return t;
}
export const ref = (sid: string) => "ex-" + createHash("sha256").update(String(sid)).digest("hex").slice(0, 10);
const lineStr = (l: Line) => `${l.quantity}× ${l.baseName || l.name}${l.choices?.length ? " [" + [...l.choices].sort().join("; ") + "]" : ""}`;
export type Example = { staffGrade?: Grade | null; grade?: Grade; readback?: "confirmed" | "corrected" | "none"; answeredBy?: string | null; difficulty?: "clear" | "messy"; difficultyNote?: string; ref: string; at: string; channel: "phone" | "app"; weight: number; turns: Array<{ speaker: string; text: string }>; truth: string[]; truthLines: Line[];
  elvi: string[]; elviScore: number | null; staffScore: number | null; corrected: string[]; staffMisses: Miss[] };
export function phoneExample(row: any): Example | null {
  if (!row?.ticket?.lines?.length || row.followUp || row.score == null) return null;
  const names = [row.customerName, row.orderName, row.nameCheck?.heard, row.nameCheck?.ticket];
  // case1b: a reviewed truth (data/learning/truth-overrides.json, keyed by CallSid) beats flag-derived corrections.
  // "ticket" = the ticket already matches the customer's words; otherwise { lines: Line[], note }.
  const ov = truthOverrides()[row.callSid];
  const { lines, corrected } = ov === "ticket" || ov?.use === "ticket" ? { lines: row.ticket.lines.map(clone).map((l: Line, k: number) => { for (const r of ov?.replace || []) if (r.set && r.line === k) return { ...r.set, choices: [...(r.set.choices || [])] } as Line; else if ((r.line == null || r.line === k) && r.from && l.choices.includes(r.from)) l.choices = l.choices.map((c) => (c === r.from ? r.to : c)); return l; }), corrected: [`reviewed: ticket = customer's words${ov?.note ? " (" + ov.note + ")" : ""}`] }
    : ov?.lines ? { lines: ov.lines, corrected: [`reviewed truth${ov.note ? " (" + ov.note + ")" : ""}`] } : groundTruth(row.ticket.lines, row.elvi || [], row.audit?.flags || []);
  // readback1: confirmed recap > customer words > ticket (dish/quantity level); a reviewed override still wins over all
  const rb = detectReadback((row.turns || []) as any);
  if (!ov && rb.status !== "none") { const a = applyReadback(lines as any, rb); if (a.changed.length) { lines.splice(0, lines.length, ...(a.lines as any)); corrected.push(...a.changed); } }
  const elviS = scoreOrder(row.elvi || [], lines), staffS = scoreOrder(row.ticket.lines, lines);
  const grade = gradeCall({ unclear: !!row.unclear, staffScore: staffS.score, readback: rb, truthLines: lines, overridden: !!ov, corrected });
  staffS.misses = customAmountMisses(staffS.misses, corrected);
  // case1e: reviewed coaching points replace the generic missed/extra pair for the corrected line
  if (ov?.coaching?.length) {
    const drop = new RegExp(ov.coachingMatch || "$^", "i");
    staffS.misses = [...staffS.misses.filter((x) => !drop.test(`${x.detail} ${x.ticket || ""} ${x.elvi || ""}`)), ...ov.coaching.map((c: any) => ({ kind: "coaching", detail: `${c.item}: ${c.detail}`, ticket: c.item, coach: c.type } as any))];
  }
  return { ref: ref(row.callSid), at: row.at, channel: "phone", weight: gradeWeight(grade), grade, staffGrade: staffGradeOf({ unclear: !!row.unclear, staffScore: staffS.score, misses: staffS.misses, readback: rb }), readback: rb.status, answeredBy: row.answeredBy || null, difficulty: row.unclear ? "messy" : "clear", ...(row.unclear?.note ? { difficultyNote: row.unclear.note } : {}), turns: (row.turns || []).map((t: any) => ({ speaker: t.speaker, text: stripPii(t.text, names) })),
    truth: lines.map(lineStr), truthLines: lines, elvi: (row.elvi || []).map(lineStr), elviScore: elviS.score, staffScore: staffS.score, corrected, staffMisses: staffS.misses };
}
/** App session: the paid cart is the truth (weight 1); an abandoned cart is low weight (0.2). */
export function appExample(session: string, entries: any[]): Example | null {
  const turns = entries.filter((e) => e.heard).map((e) => ({ speaker: "caller", text: stripPii(String(e.heard)) }));
  if (!turns.length) return null;
  const paid = [...entries].reverse().find((e) => e.event === "checkout" && e.paid);
  const cart = paid ? paid.cart : entries.flatMap((e) => (e.actions || []).map((a: any) => {
    if (typeof a === "string") { const m = /^(\d+)x\s+(\S+)\s*\[(.*)\]$/.exec(a); return m ? { id: m[2], quantity: Number(m[1]), modifiers: m[3] ? m[3].split(/,\s(?=[(A-Z*])/) : [] } : null; }
    return a?.type === "add_item" ? { id: a.itemId, quantity: a.quantity, modifiers: (a.modifiers || []).map((m: any) => m.option) } : null;
  }).filter(Boolean));
  if (!cart?.length) return null;
  const truth = cart.map((l: any) => `${l.quantity}× ${l.id} [${[...(l.modifiers || [])].sort().join("; ")}]`);
  return { ref: ref("app-" + session), at: entries[0]?.at || "", channel: "app", weight: paid ? 1 : 0.2, turns, truth, truthLines: [], elvi: truth, elviScore: null, staffScore: null, corrected: [], staffMisses: [] };
}
/** alex1: a nameless custom amount replaced by a voice item is ONE staff error ("custom amount instead of item"), not a
 * missed item plus an extra blank line. */
export function customAmountMisses(misses: Miss[], corrected: string[]): Miss[] {
  const names = corrected.map((c) => /^custom amount → (.+)$/.exec(c)?.[1]).filter(Boolean) as string[];
  if (!names.length) return misses;
  const out = misses.filter((x) => !(x.kind === "extra_item" && !String(x.ticket || "").replace(/^\d+\s*×\s*/, "").trim()));
  const left = [...names];
  return out.map((x) => { const i = left.findIndex((n) => x.kind === "missing_item" && `${x.elvi || ""} ${x.detail}`.includes(n));
    if (i < 0) return x; left.splice(i, 1); return { ...x, custom: true } as Miss; });
}
/** Staff-mistake patterns (no staff names): weekly, by item and error type. */
export function errorType(m: Miss): string {
  const d = `${m.detail} ${m.ticket || ""}`;
  if ((m as any).coach) return String((m as any).coach);
  if ((m as any).custom) return "custom amount instead of item";
  if (m.kind === "quantity") return "wrong qty";
  if (m.kind === "missing_item" && !String(m.ticket || "").trim()) return "custom amount instead of item";
  if (m.kind === "missing_item") return "missed item";
  if (m.kind === "extra_item") return "extra item";
  if (m.kind === "price") return "price";
  if (/tortilla|comal|harina|taquer|ma[ií]z|corn|flour/i.test(d)) return "wrong tortilla";
  if (/frijol|bean|queso|cheese|arroz|rice|crema|extra|lechuga/i.test(d)) return "missed/extra add-on";
  if (/bistec|steak|pastor|pork|chorizo|pollo|chicken|carnitas|cabeza|buche|tripa|prensado|duro|lengua|suadero/i.test(d)) return "wrong meat";
  return "other choice";
}
const weekOf = (iso: string) => { const d = new Date(new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
export function staffPatterns(ex0: Example[]) {
  const ex = ex0.filter((e) => e.difficulty !== "messy"); // unclear1: no coaching counts from messy calls
  const m = new Map<string, { week: string; item: string; type: string; count: number }>();
  for (const e of ex) for (const x of e.staffMisses) { const item = String(x.ticket || x.elvi || x.detail.split(":")[0]).split(" · ")[0]; const k = `${weekOf(e.at)}|${item}|${errorType(x)}`; const c = m.get(k) || { week: weekOf(e.at), item, type: errorType(x), count: 0 }; c.count++; m.set(k, c); }
  return [...m.values()].sort((a, b) => b.week.localeCompare(a.week) || b.count - a.count);
}
export function coachingPoints(p: ReturnType<typeof staffPatterns>, week: string) {
  return p.filter((x) => x.week === week).slice(0, 5).map((x) => ({ es: `${x.item}: ${x.type} (${x.count}×) — repasar al marcar`, en: `${x.item}: ${x.type} (${x.count}×) — double-check when ringing` }));
}
/** Order-to-voice accuracy for Elvi and staff, per week (phone examples). */
export function voiceAccuracy(ex0: Example[]) {
  const ex = ex0.filter((e) => e.difficulty !== "messy"); // unclear1
  const w = new Map<string, { week: string; n: number; elvi: number; staff: number }>();
  for (const e of ex) { if (e.channel !== "phone" || e.elviScore == null || e.staffScore == null) continue; const k = weekOf(e.at); const s = w.get(k) || { week: k, n: 0, elvi: 0, staff: 0 }; s.n++; s.elvi += e.elviScore; s.staff += e.staffScore; w.set(k, s); }
  return [...w.values()].sort((a, b) => a.week.localeCompare(b.week)).map((s) => ({ week: s.week, calls: s.n, elvi: Math.round((s.elvi / s.n) * 10) / 10, staff: Math.round((s.staff / s.n) * 10) / 10 }));
}
/** Fine-tune-ready chat format (not used for training yet). */
export const finetuneRow = (e: Example) => ({ messages: [
  { role: "system", content: "You are Elvi, Cocina Elvis's order taker. Output the order as Square catalog lines." },
  { role: "user", content: e.turns.map((t) => `${t.speaker === "caller" ? "Customer" : "Staff"}: ${t.text}`).join("\n") },
  { role: "assistant", content: JSON.stringify(e.truth) }], weight: e.weight, ref: e.ref, channel: e.channel, difficulty: e.difficulty || "clear" });
