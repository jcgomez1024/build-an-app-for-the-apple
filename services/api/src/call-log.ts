/**
 * calllog1: one row per incoming call for the counter page, built from data/logs/calls/*.jsonl
 * (incoming, caller_name, queued, whisper, bridged, answered, queue_result, missed, voicemail, recording,
 * loop_rejected, tag) plus Twilio call status (read-only GET) for calls whose end never got logged
 * (e.g. the Mac restarted mid-call). Days are America/New_York days.
 */
import fs from "node:fs";
import path from "node:path";

export type CallOutcome = "counter" | "desk" | "voicemail" | "hungup" | "rejected" | "closed" | "in_progress" | "unknown";
export type CallLogRow = {
  callSid: string; at: string; day: string; time: string;
  name: string | null; number: string; numberDisplay: string;
  line: string; lineNumber: string; forwardedFrom?: string | null;
  outcome: CallOutcome; outcomeLabel: string; missed: boolean;
  waitSec: number | null; durationSec: number | null;
  recordingSid: string | null; recordingKind: "call" | "voicemail" | null;
  hasTicket: boolean; training: boolean; deskTo: string | null;
};
export type CallLogRange = "today" | "yesterday" | "7d";
export type TwilioStatus = { status: string; duration: number | null; checkedAt: number };

const TZ = "America/New_York";
const d10 = (p: unknown) => String(p || "").replace(/\D/g, "").slice(-10);
export const etDay = (d: Date | number | string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
const etTime = (d: Date | string) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(d));
export function formatNumber(p: string) {
  const d = d10(p);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || "Número privado");
}
/** line1: the customer-facing line. Forwarded from 289-8504 → "289", from 551-9122 → "551"; a direct dial to a
 *  Twilio number → "Twilio 1609". Calls logged before line1 (no forwardedFrom known) keep the old lineShort label. */
export function lineForCall(called: string, forwardedFrom?: string | null): string {
  const f = d10(forwardedFrom || "");
  if (f === "4402898504") return "289";
  if (f === "4405519122") return "551";
  const c = d10(called);
  if (forwardedFrom !== undefined && c) return `Twilio ${c.slice(6)}`;
  return lineShort(called);
}
/** 289 / 551 from TWILIO_LINE_SHORTS (+14409011609=289,…), else the known forwarding map, else the 7-digit line. */
export function lineShort(called: string): string {
  const d = d10(called);
  if (!d) return "";
  for (const part of String(process.env.TWILIO_LINE_SHORTS || "").split(",")) {
    const [num, short] = part.split("=").map((x) => x.trim());
    if (num && short && d10(num) === d) return short;
  }
  const known: Record<string, string> = { "4409011609": "289", "4406642795": "551" };
  return known[d] || `${d.slice(3, 6)}-${d.slice(6)}`;
}
/** Desk phone (Spectrum 551 lines) vs the Cricket iPhone (289-8504, old ring-through calls) vs any other ring phone. */
export function deskLabel(to: string | null): string {
  const d = d10(to);
  if (!d) return "Contestada en escritorio";
  const last4 = d.slice(-4);
  if (d.startsWith("440551")) return `Contestada en escritorio (desk ${last4})`;
  if (d === "4402898504") return `Contestada en iPhone (${last4})`;
  return `Contestada en teléfono (${last4})`;
}
export function rangeDays(range: CallLogRange, now = new Date()): string[] {
  const days: string[] = [];
  const n = range === "7d" ? 7 : 1;
  const start = range === "yesterday" ? 1 : 0;
  for (let i = start; i < start + n; i++) days.push(etDay(new Date(now.getTime() - i * 86400000 + 0)));
  // DST-safe: de-dup and make sure "today"/"yesterday" are the real ET days.
  return [...new Set(days)];
}
/** Read jsonl files that can hold events for these ET days (files are named by UTC date). */
export function readCallEvents(logDir: string, days: string[]): any[] {
  if (!days.length) return [];
  const sorted = [...days].sort();
  const lo = new Date(`${sorted[0]}T00:00:00Z`).getTime() - 86400000;
  const hi = new Date(`${sorted[sorted.length - 1]}T00:00:00Z`).getTime() + 2 * 86400000;
  const out: any[] = [];
  let files: string[] = [];
  try { files = fs.readdirSync(logDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)); } catch { return out; }
  for (const f of files) {
    const t = new Date(`${f.slice(0, 10)}T00:00:00Z`).getTime();
    if (t < lo || t > hi) continue;
    for (const line of fs.readFileSync(path.join(logDir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }
  return out;
}

const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

export function buildCallLog(events: any[], opts: {
  days: string[]; isTraining: (phone: string) => boolean; hasTicket: (sid: string) => boolean;
  ticketName?: (sid: string) => string | null; statuses?: Record<string, TwilioStatus>; now?: number;
}): CallLogRow[] {
  const days = new Set(opts.days);
  const now = opts.now ?? Date.now();
  const bySid = new Map<string, any[]>();
  for (const e of events) {
    const sid = String(e?.callSid || "");
    if (!/^CA[0-9a-f]{32}$/i.test(sid)) continue;
    if (!bySid.has(sid)) bySid.set(sid, []);
    bySid.get(sid)!.push(e);
  }
  // Agent / ring legs carry their own CallSid; only customer legs start with "incoming" or "loop_rejected".
  const rows: CallLogRow[] = [];
  for (const [sid, evs] of bySid) {
    evs.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const first = evs.find((e) => e.event === "incoming" || e.event === "loop_rejected");
    if (!first) continue;
    const at = String(first.ts);
    const day = etDay(at);
    if (!days.has(day)) continue;
    const of = (name: string) => evs.filter((e) => e.event === name);
    const last = (name: string) => of(name).pop();
    const number = String(first.caller || evs.find((e) => e.caller)?.caller || "");
    const called = String(first.calledNumber || evs.find((e) => e.line)?.line || "");
    const fwdEv = evs.find((e) => e.event === "forwarded" || e.forwardedFrom !== undefined); // line1
    const training = evs.some((e) => e.source === "training") || opts.isTraining(number);
    const name = [...evs].reverse().find((e) => typeof e.name === "string" && e.name.trim())?.name || opts.ticketName?.(sid) || null;
    const answered = of("answered");
    // Desk answers: ring1 desk legs (whisper via "desk"), or the older ring-through flow that forwarded to the desk line.
    const deskWhisper = of("whisper").find((e) => e.via === "desk") || (first.forwardTo ? { ringTo: first.forwardTo, via: "desk" } : undefined);
    const vm = last("voicemail");
    const qr = of("queue_result");
    const hangupQ = qr.find((e) => e.result === "hangup");
    const missed = last("missed");
    const rec = of("recording").find((e) => e.recordingSid);
    const st = opts.statuses?.[sid];
    let outcome: CallOutcome = "unknown";
    let waitSec: number | null = null;
    let durationSec: number | null = null;
    if (first.event === "loop_rejected" || of("loop_rejected").length) outcome = "rejected";
    else if (of("closed").length) outcome = "closed"; // closed1: closed-day message, nobody rang
    else if (answered.length) {
      outcome = answered.some((e) => e.via === "desk") || (deskWhisper && !answered.some((e) => e.via === "counter")) ? "desk" : "counter";
      durationSec = Math.max(...answered.map((e) => num(e.durationSec) || 0));
      waitSec = num(of("bridged")[0]?.queueTime);
    } else if (vm) {
      outcome = "voicemail";
      durationSec = num(vm.durationSec);
      const left = qr.find((e) => /^(leave|queue-full|error|system-error)$/.test(String(e.result)));
      waitSec = num(left?.queueTime);
    } else if (hangupQ || missed) {
      outcome = "hungup";
      waitSec = num(hangupQ?.queueTime) ?? Math.max(0, Math.round((Date.parse((missed || hangupQ).ts) - Date.parse(at)) / 1000));
    } else if (st) {
      if (/^(queued|ringing|in-progress)$/.test(st.status)) outcome = "in_progress";
      else { outcome = "hungup"; waitSec = st.duration; }
    } else if (now - Date.parse(at) < 10 * 60 * 1000) outcome = "in_progress";
    const deskTo = deskWhisper?.ringTo ? String(deskWhisper.ringTo) : null;
    const labels: Record<CallOutcome, string> = {
      counter: "Contestada en mostrador",
      desk: deskLabel(deskTo),
      voicemail: "Buzón de voz",
      hungup: `Colgó en espera${waitSec != null ? ` (${waitSec} s)` : ""}`,
      rejected: "Rechazada (loop guard)",
      closed: "Cerrado (lunes)",
      in_progress: "En curso",
      unknown: "Sin resultado",
    };
    rows.push({
      callSid: sid, at, day, time: etTime(at),
      name: name ? String(name) : null, number, numberDisplay: formatNumber(number),
      line: lineForCall(called, fwdEv ? String(fwdEv.forwardedFrom || "") : undefined), lineNumber: called, forwardedFrom: fwdEv?.forwardedFrom || null,
      outcome, outcomeLabel: labels[outcome], missed: outcome === "hungup" || outcome === "voicemail",
      waitSec, durationSec,
      recordingSid: rec?.recordingSid || vm?.recordingSid || null,
      recordingKind: rec?.recordingSid ? "call" : vm?.recordingSid ? "voicemail" : null,
      hasTicket: opts.hasTicket(sid), training, deskTo,
    });
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function summarize(rows: CallLogRow[]) {
  const c = { total: rows.length, answered: 0, voicemail: 0, hungup: 0, rejected: 0, inProgress: 0 };
  for (const r of rows) {
    if (r.outcome === "counter" || r.outcome === "desk") c.answered++;
    else if (r.outcome === "voicemail") c.voicemail++;
    else if (r.outcome === "hungup") c.hungup++;
    else if (r.outcome === "rejected") c.rejected++;
    else if (r.outcome === "in_progress") c.inProgress++;
  }
  return c;
}
