// auditor1: "Elvi Auditor" — per completed call, compare the Square ticket with what was said and with Elvi's
// listen-only order; flag staff/ticket anomalies (pings) and Elvi misses (fix candidates). Private queue:
// data/auditor/findings.jsonl (gitignored). Summaries never include phone numbers or addresses.
import { classifyCall } from "./call-classify.js";
import { isStandardTopping, conAddonSaid } from "./standard-toppings.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { norm } from "./call-accuracy.js";

export const AUDITOR_DIR = process.env.ELVI_AUDITOR_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/auditor");
export const FINDINGS_FILE = path.join(AUDITOR_DIR, "findings.jsonl");
export type FlagType = "STAFF_EXTRA" | "STAFF_MISSING" | "CUSTOM_AMOUNT" | "PRICE_DIFF" | "NO_TICKET" | "DELIVERY_FEE_MISSING" | "DELIVERY_FEE_WRONG" | "ELVI_MISS" | "UNUSUAL_CALL" | "ORDER_FOLLOWUP";
export const PING_TYPES: FlagType[] = ["STAFF_EXTRA", "STAFF_MISSING", "CUSTOM_AMOUNT", "PRICE_DIFF", "NO_TICKET", "DELIVERY_FEE_MISSING", "DELIVERY_FEE_WRONG", "UNUSUAL_CALL"];
export type Flag = { type: FlagType; detail: string; es: string; en: string; category?: string; urgent?: boolean; question?: string | null };
export type Finding = { id: string; callSid: string; callAt: string; score: number | null; flags: Flag[]; summary_es: string; summary_en: string;
  customerName?: string | null; category?: string; urgent?: boolean; question?: string | null; ping: boolean; fixCandidate: boolean; notified: boolean; notifiedAt?: string; superseded?: boolean; retired?: string; retiredAt?: string; createdAt: string; receipt?: string | null };

const money = (c: number) => `$${(Number(c || 0) / 100).toFixed(2)}`;
const IGNORE = /\bmild salsa asada\b|^regular$/;
const STOP = new Set(["extra", "with", "side", "regular", "order", "orden", "mexican", "sausage", "steak", "homemade", "flour", "street", "quesadilla", "taco", "torta", "dorada", "deluxe", "preparada"]);
/** Spoken keywords for a Square name: "**Con Arroz / With Rice" → ["arroz", "rice"]. */
export function keywords(name: string) {
  return [...new Set(norm(String(name).replace(/\*+/g, " ").replace(/\([^)]*\)/g, " ")).split(" ").filter((w) => w.length >= 4 && !STOP.has(w) && w !== "with" && w !== "con"))];
}
// addons1: a "(C) Con / With" paid add-on counts as said only on its own phrase ("con frijoles", "extra queso derretido").
const said = (text: string, name: string) => { const ca = conAddonSaid(text, name); if (ca !== null) return ca; const t = ` ${norm(text)} `; const k = keywords(name); return k.length > 0 && k.some((w) => t.includes(` ${w.slice(0, Math.max(4, w.length - 1))}`)); };
const isFee = (l: any) => /^delivery fee\b/i.test(String(l?.baseName || l?.name || ""));
const isCustom = (l: any) => !String(l?.baseName || l?.name || "").trim() || (!l?.variationId && !isFee(l));

/** Pure: findings for one /api/calls/accuracy row. nowMs decides whether "no ticket yet" is final. */
export function auditCall(r: any, nowMs = Date.now()): { flags: Flag[]; final: boolean } | null {
  if (!r?.recordingSid || !(r.turns || []).length || r.answered === false) return null;
  const all = (r.turns || []).map((t: any) => t.text).join(" ");
  const staff = (r.turns || []).filter((t: any) => t.speaker === "staff").map((t: any) => t.text).join(" ");
  const flags: Flag[] = [];
  const add = (type: FlagType, detail: string, es: string, en: string) => { if (!flags.some((f) => f.type === type && f.detail === detail)) flags.push({ type, detail, es, en }); }; // match2: deduped
  const elviFood = (r.elvi || []).filter((l: any) => !isFee(l));
  const delivery = r.elviFulfillment === "DELIVERY" || r.fulfillment?.elvi?.fulfillment === "DELIVERY";
  const endedMs = Date.parse(r.at) + ((r.recordingSec || r.talkSec || 0) * 1000);
  // unusual1: non-order calls (question/dietary, complaint, catering, wrong number/spam, other) — a "Revisar" ping.
  // followup1: a call about an existing online order — informational only (never scored, no staff checks);
  // only an urgent complaint about it still pings.
  if (r.followUp) {
    const fu = r.followUp, due = fu.dueAt ? new Date(fu.dueAt).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
    flags.push({ type: "ORDER_FOLLOWUP", detail: `online order ${String(fu.orderId).slice(-6)}${due ? `, due ${due}` : ""}`, category: "order_followup",
      es: `Llamada sobre un pedido en línea ya hecho${due ? ` (para ${due})` : ""}. No cuenta para Elvi.`, en: `Call about an existing online order${due ? ` (due ${due})` : ""}. Not scored against Elvi.` } as Flag);
    const cu = classifyCall(r.turns || [], false);
    if (cu?.category === "complaint" && cu.urgent) flags.push({ type: "UNUSUAL_CALL", detail: `complaint (urgent)`, es: cu.summary_es, en: cu.summary_en, category: cu.category, urgent: true, question: cu.question } as Flag);
    return { flags, final: nowMs - endedMs > 60 * 60_000 };
  }
  const u = classifyCall(r.turns || [], elviFood.length > 0);
  if (u) flags.push({ type: "UNUSUAL_CALL", detail: `${u.category}${u.urgent ? " (urgent)" : ""}${u.question ? `: ${u.question}` : ""}`, es: u.summary_es, en: u.summary_en, category: u.category, urgent: u.urgent, question: u.question } as Flag);
  if (!r.ticket) {
    if (!elviFood.length) return { flags, final: nowMs - endedMs > 60 * 60_000 };
    if (nowMs - endedMs < 45 * 60_000) return { flags, final: false }; // staff may still be ringing it in
    add("NO_TICKET", "order-like call, no Square ticket within 45 min", "Llamada con pedido pero no se encontró ticket en Square.", "Order call but no matching Square ticket was found.");
    return { flags, final: nowMs - endedMs > 3 * 3600_000 };
  }
  const tLines = r.ticket.lines || [];
  const custom = tLines.filter(isCustom);
  for (const c of custom) add("CUSTOM_AMOUNT", `custom amount ${money(c.totalCents)}`, `El ticket tiene un monto libre sin nombre de ${money(c.totalCents)} (debe ser un artículo del catálogo).`, `Ticket has an unnamed custom amount of ${money(c.totalCents)} (should be a catalog item).`);
  // Delivery fee vs our distance rule ($5 ≤4 mi, $8 4-10 mi).
  const feeLine = tLines.find(isFee);
  if (delivery && !feeLine) add("DELIVERY_FEE_MISSING", "delivery call, no Delivery Fee line", "Entrega a domicilio sin cargo de envío en el ticket.", "Delivery order with no delivery fee on the ticket.");
  if (delivery && feeLine && r.deliveryFeeCents && Math.abs(feeLine.totalCents - r.deliveryFeeCents) > 1) add("DELIVERY_FEE_WRONG", `fee ${money(feeLine.totalCents)} vs rule ${money(r.deliveryFeeCents)}`, `Cargo de envío ${money(feeLine.totalCents)}; por distancia debía ser ${money(r.deliveryFeeCents)}.`, `Delivery fee ${money(feeLine.totalCents)}; distance rule says ${money(r.deliveryFeeCents)}.`);
  const qtyDone = new Set<string>();
  for (const p of r.pairs || []) {
    const t = p.ticket, e = p.elvi;
    // match2: leftover units of an item matched on both sides = ONE quantity flag for that item (no missing/extra).
    if ((p as any).qtyDiff) {
      const q = (p as any).qtyDiff; if (qtyDone.has(q.item)) continue; qtyDone.add(q.item);
      if (t && (isFee(t) || isCustom(t))) continue;
      add("ELVI_MISS", `${q.item}: qty ticket ${q.ticket}, Elvi ${q.elvi}`, `${q.item}: cantidad ticket ${q.ticket}, Elvi ${q.elvi}.`, `${q.item}: quantity ticket ${q.ticket}, Elvi ${q.elvi}.`);
      continue;
    }
    if (t && (isFee(t) || isCustom(t))) continue;
    if (e && isFee(e)) continue;
    if (t && !e) {
      if (said(all, t.baseName || t.name)) add("ELVI_MISS", `Elvi missed ${t.quantity} × ${t.name}`, `Elvi no captó ${t.quantity} × ${t.name}.`, `Elvi missed ${t.quantity} × ${t.name}.`);
      else add("STAFF_EXTRA", `ticket item never mentioned: ${t.quantity} × ${t.name}`, `En el ticket hay ${t.quantity} × ${t.name}, pero nunca se mencionó en la llamada.`, `Ticket has ${t.quantity} × ${t.name}, never mentioned on the call.`);
      continue;
    }
    if (e && !t) {
      if (custom.some((c: any) => Math.abs(c.totalCents - e.totalCents) <= 1)) continue; // rung as the custom amount
      if (said(all, e.baseName || e.name)) add("STAFF_MISSING", `said on call, not rung: ${e.quantity} × ${e.name}`, `Se pidió ${e.quantity} × ${e.name} en la llamada, pero no está en el ticket.`, `${e.quantity} × ${e.name} was ordered on the call but isn't on the ticket.`);
      else add("ELVI_MISS", `Elvi added ${e.quantity} × ${e.name}`, `Elvi agregó ${e.quantity} × ${e.name} que no está en el ticket.`, `Elvi added ${e.quantity} × ${e.name}, not on the ticket.`);
      continue;
    }
    if (!t || !e) continue;
    const tc = (t.choices || []).filter((c: string) => !IGNORE.test(norm(c))), ec = (e.choices || []).filter((c: string) => !IGNORE.test(norm(c)));
    const tOnly = tc.filter((c: string) => !ec.some((x: string) => norm(x) === norm(c))), eOnly = ec.filter((c: string) => !tc.some((x: string) => norm(x) === norm(c)));
    for (const c of tOnly) {
      if (isStandardTopping(t.baseName || t.name, c) || isStandardTopping(e.baseName || e.name, c)) continue; // sopesaso1: included
      if (said(all, c)) add("ELVI_MISS", `${t.name}: Elvi missed ${c}`, `${t.name}: Elvi no captó «${c}».`, `${t.name}: Elvi missed "${c}".`);
      else add("STAFF_EXTRA", `${t.name}: ${c} never mentioned`, `${t.name}: el ticket tiene «${c}», pero nunca se mencionó en la llamada.`, `${t.name}: ticket has "${c}", never mentioned on the call.`);
    }
    for (const c of eOnly) {
      // rice1: Elvi is listen-only — a choice the caller (or staff) said that isn't on the ticket is a staff miss.
      // match2: the choice IS rung, just on another item of the ticket (e.g. prensado on the quesadillas) → Elvi put it on the wrong item.
      const elsewhere = tLines.some((x: any) => x !== t && norm(x.baseName || x.name) !== norm(t.baseName || t.name) && (x.choices || []).some((y: string) => norm(y) === norm(c)));
      if (elsewhere) add("ELVI_MISS", `${t.name}: Elvi added ${c} (it belongs to another item)`, `${t.name}: Elvi agregó «${c}», que va en otro artículo del ticket.`, `${t.name}: Elvi added "${c}", which belongs to another item on the ticket.`);
      else if (said(all, c)) add("STAFF_MISSING", `${t.name}: ${c} said, not rung`, `${t.name}: se dijo «${c}» pero no está en el ticket.`, `${t.name}: "${c}" was said but isn't on the ticket.`);
      else add("ELVI_MISS", `${t.name}: Elvi added ${c}`, `${t.name}: Elvi agregó «${c}».`, `${t.name}: Elvi added "${c}".`);
    }
    if (e.quantity !== t.quantity) add("ELVI_MISS", `${t.name}: qty ticket ${t.quantity}, Elvi ${e.quantity}`, `${t.name}: cantidad ticket ${t.quantity}, Elvi ${e.quantity}.`, `${t.name}: quantity ticket ${t.quantity}, Elvi ${e.quantity}.`);
    else if (!tOnly.length && !eOnly.length && Math.abs(e.totalCents - t.totalCents) > 1) add("PRICE_DIFF", `${t.name}: ticket ${money(t.totalCents)} vs catalog ${money(e.totalCents)}`, `${t.name}: el ticket cobra ${money(t.totalCents)}; el catálogo da ${money(e.totalCents)}.`, `${t.name}: ticket charges ${money(t.totalCents)}; catalog price is ${money(e.totalCents)}.`);
  }
  return { flags, final: nowMs - endedMs > 3 * 3600_000 };
}
export function summarize(flags: Flag[], lang: "es" | "en") {
  const ping = flags.filter((f) => PING_TYPES.includes(f.type)), fix = flags.filter((f) => f.type === "ELVI_MISS");
  if (!flags.length) return lang === "es" ? "Sin anomalías: el ticket coincide con la llamada." : "No anomalies: the ticket matches the call.";
  const a = ping.map((f) => f[lang]).join(" ");
  const b = fix.length ? (lang === "es" ? ` (${fix.length} error(es) de Elvi para corregir.)` : ` (${fix.length} Elvi miss(es) to fix.)`) : "";
  return (a || (lang === "es" ? "Solo errores de Elvi." : "Elvi misses only.")) + b;
}
// ---- queue ----
export function readFindings(file = FINDINGS_FILE): Finding[] {
  try { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
function writeFindings(all: Finding[], file = FINDINGS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, all.map((f) => JSON.stringify(f)).join("\n") + (all.length ? "\n" : ""), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const sig = (flags: Flag[]) => crypto.createHash("sha1").update(JSON.stringify(flags.map((f) => [f.type, f.detail]).sort())).digest("hex").slice(0, 10);
/** match1: a call that no longer has anything to report (e.g. a walk-in ticket was wrongly matched): retire its open findings. */
export function retireFindings(callSid: string, reason: string, file = FINDINGS_FILE, now = new Date()): number {
  const all = readFindings(file); let n = 0;
  for (const f of all) if (f.callSid === callSid && !f.superseded) { f.superseded = true; (f as any).retired = reason; (f as any).retiredAt = now.toISOString(); f.notified = true; n++; }
  if (n) writeFindings(all, file);
  return n;
}
/** Upsert the latest finding for a call (idempotent: same flags → no change; changed flags → new finding, old superseded). */
export function recordFinding(row: any, flags: Flag[], file = FINDINGS_FILE, now = new Date()): Finding | null {
  const all = readFindings(file);
  const id = `${String(row.callSid).slice(-8)}-${sig(flags)}`;
  const prev = all.filter((f) => f.callSid === row.callSid && !f.superseded);
  if (prev.some((f) => f.id === id)) return null;
  for (const p of prev) p.superseded = true;
  const ping = flags.some((f) => PING_TYPES.includes(f.type));
  const f: Finding = { id, callSid: row.callSid, callAt: row.at, score: row.score ?? null, flags, summary_es: summarize(flags, "es"), summary_en: summarize(flags, "en"),
    customerName: row.customerName || null,
    ...(() => { const u: any = flags.find((x) => x.type === "UNUSUAL_CALL") || flags.find((x) => x.type === "ORDER_FOLLOWUP"); return u ? { category: u.category, urgent: !!u.urgent, question: u.question || null } : {}; })(), // unusual1 // sopesaso1: first name heard on the call (or saved)
    ping, fixCandidate: flags.some((x) => x.type === "ELVI_MISS"), notified: !ping, createdAt: now.toISOString(), receipt: row.ticket?.receiptNumber || null };
  all.push(f); writeFindings(all, file);
  return f;
}
export const pendingFindings = (file = FINDINGS_FILE) => readFindings(file).filter((f) => !f.superseded && f.ping && !f.notified);
export function ackFindings(ids: string[], file = FINDINGS_FILE) {
  const all = readFindings(file); let n = 0;
  for (const f of all) if (ids.includes(f.id) && !f.notified) { f.notified = true; f.notifiedAt = new Date().toISOString(); n++; }
  writeFindings(all, file); return n;
}
/** For calls.html badges: latest (non-superseded) finding per call. */
export function auditorFindingsByCall(file = FINDINGS_FILE): Record<string, Pick<Finding, "id" | "flags" | "summary_es" | "summary_en" | "ping" | "notified">> {
  const out: Record<string, any> = {};
  for (const f of readFindings(file)) if (!f.superseded) out[f.callSid] = { id: f.id, flags: f.flags, summary_es: f.summary_es, summary_en: f.summary_en, ping: f.ping, notified: f.notified };
  return out;
}
