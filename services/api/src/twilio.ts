// Counter phone (tw11). The main lines forward every call to the Twilio numbers, so Twilio NEVER dials a main line
// (that would loop). Flow: greeting + language (repeat callers by name) -> recording notice -> Enqueue into the line's
// queue with hold audio in the caller's language -> staff answer in /phone.html (Twilio Voice JS SDK) -> whisper
// "Llamada de {nombre}" to staff only -> bridged with dual-channel recording -> transcript + Elvi shadow order (no checkout).
// Nobody online at the counter, or nobody answers in time -> voicemail (transcribed, with Elvi's suggested order).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { knownCaller, rememberCaller, callerName, setOnNameSaved, cleanFirstName, type NameSource, saveCallerFulfillment, savedDelivery } from "./caller-memory.js";
import { detectFulfillment, detectAddress, type Fulfillment } from "./delivery.js";
import { cachedQuote, quoteDeliveryAddress, type Quote } from "./delivery-zone.js";
import { learnReadbackName, nameExtractEnabled, type ReadbackDecision } from "./name-extract.js";
import { searchOrdersReadOnly, paymentReceiptReadOnly } from "./square.js";
import { squareRefs } from "./call-accuracy.js";
import { orderNameForPhone } from "./call-accuracy.js";
import { buildCallLog, readCallEvents, rangeDays, summarize, type CallLogRange, type TwilioStatus } from "./call-log.js";
import { transcribeDualChannel, shadowOrderFromTurns, sttWords, detectLanguage, type ShadowTurn, type CallTurn, type ContainerPlan, removalNotesIn } from "./call-scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(apiRoot, ".env.twilio") });

const callsDir = path.join(apiRoot, "data/calls");
const logDir = path.join(apiRoot, "data/logs/calls");

type ShadowFn = (sessionKey: string) => ShadowTurn;
type Lang = "es" | "en";

function xmlEscape(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}
const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
const d10 = (p: unknown) => String(p || "").replace(/\D/g, "").slice(-10);

function publicUrl(req: express.Request) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0];
  return `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}${req.originalUrl}`;
}

export function twilioSignature(url: string, params: Record<string, string>, token: string) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

function validSignature(req: express.Request) {
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const sig = String(req.headers["x-twilio-signature"] || "");
  if (!token || !sig) return false;
  const seen = publicUrl(req);
  // Tunnels/proxies may hide https; Twilio signs the public https URL.
  const urls = [seen, seen.replace(/^http:/, "https:"), (process.env.APP_PUBLIC_URL || "").replace(/\/$/, "") + req.originalUrl];
  const a = Buffer.from(sig);
  return urls.some((u) => {
    const b = Buffer.from(twilioSignature(u, req.body || {}, token));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

/** Carlos's own test numbers (TWILIO_TRAINING_CALLERS, comma list): processed the same, tagged source="training". */
export function isTrainingCaller(phone: unknown) {
  const me = d10(phone);
  return !!me && String(process.env.TWILIO_TRAINING_CALLERS || "").split(",").map(d10).filter(Boolean).includes(me);
}

/** Main lines forward to Twilio: Twilio must never dial them (loop). Nothing in this file dials a phone number. */
export function neverDial(phone: unknown) {
  const n = d10(phone);
  return !!n && String(process.env.TWILIO_NEVER_DIAL || "").split(",").map(d10).filter(Boolean).includes(n);
}

function logCall(entry: Record<string, unknown>) {
  fs.mkdirSync(logDir, { recursive: true });
  if (entry.caller !== undefined && entry.source === undefined) entry = { ...entry, source: isTrainingCaller(entry.caller) ? "training" : "customer" };
  const day = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(path.join(logDir, `${day}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

/** intro2: dominant language of the caller's channel (word-weighted). null if the caller said too little. */
export function dominantCallerLanguage(turns: CallTurn[], minWords = 4): Lang | null {
  const n = { es: 0, en: 0 };
  for (const t of turns) if (t.speaker === "caller") n[t.language] += String(t.text || "").split(/\s+/).filter(Boolean).length;
  if (n.es + n.en < minWords || n.es === n.en) return null;
  return n.en > n.es ? "en" : "es";
}
function learnCallerLanguage(callSid: string, caller: string, turns: CallTurn[], greeted: Lang | undefined) {
  const lang = dominantCallerLanguage(turns);
  if (!lang || !caller) return;
  try { rememberCaller(caller, { language: lang, heardSpeech: true }); } catch { /* best effort */ }
  if (greeted && greeted !== lang) logCall({ event: "language_corrected", callSid, caller, from: greeted, to: lang });
}

export async function scoreRecording(buf: Buffer, sessionKey: string, shadowOrder: ShadowFn, opts: { callerChannel?: 1 | 2; before?: CallTurn[] } = {}) {
  let turns = await transcribeDualChannel(buf, { callerChannel: opts.callerChannel });
  if (opts.before?.length) { // calls put on hold come back as a second recording: keep one conversation
    const shift = Math.max(...opts.before.map((t) => t.end)) + 1;
    turns = [...opts.before, ...turns.map((t) => ({ ...t, start: t.start + shift, end: t.end + shift }))];
  }
  const transcript = turns.map((t) => `${t.speaker === "caller" ? "Cliente" : "Staff"} [${t.start.toFixed(1)}s ${t.language}]: ${t.text}`).join("\n");
  const elviOrder = turns.some((t) => t.speaker === "caller") ? await shadowOrderFromTurns(turns, shadowOrder(sessionKey)) : null;
  return { turns, transcript, elviOrder };
}

/** English only on clear English words; Spanish on silence, Spanish or anything unclear. */
export function detectCallerLanguage(heard: string): Lang {
  const t = String(heard || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z' ]+/g, " ").trim();
  if (!t) return "es";
  const en = (t.match(/\b(hello|hi|hey|good (morning|afternoon|evening)|evening|morning|yes|yeah|i|i'm|i'd|can|could|want|order|pick ?up|please|thanks|thank you|english|is this|how are you|what's up)\b/g) || []).length;
  const es = (t.match(/\b(hola|buenas|buenos|bueno|tardes|noches|dias|quiero|quisiera|ordenar|orden|para|por favor|gracias|si|oiga|espanol|de|una?|que)\b/g) || []).length;
  return en > es ? "en" : "es";
}

type NameLookup = (e164: string, signal: AbortSignal) => Promise<string | null>;

/** Neural Polly voices for <Say> (easy to swap). Valid on Twilio TTS docs: Mia-Neural=es-MX, Danielle-Neural=en-US. */
export const SAY_VOICE: Record<Lang, string> = {
  es: "Polly.Mia-Neural",
  en: "Polly.Danielle-Neural"
};
const sayLocale = (lang: Lang) => (lang === "en" ? "en-US" : "es-MX");
const sayIn = (lang: Lang, text: string) =>
  `<Say language="${sayLocale(lang)}" voice="${SAY_VOICE[lang]}">${xmlEscape(text)}</Say>`;

/** Pre-generated xAI cloned-voice MP3s (Carlos). <Play> when present; Polly neural <Say> otherwise. */
const promptsDir = path.join(apiRoot, "data/phone-prompts");
export const XAI_PHONE_VOICE = { es: "ph8amp2n7ihk", en: "3ggnpimh5jzt" } as const; // custom-voices IDs
export const promptSlug = (s: string) =>
  String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
/** intro2/tempo125: PROMPT_TEMPO (default 1.0, .env.twilio; 1.25 → "<key>-t125.mp3"). When ≠1, serve those variants (ffmpeg atempo,
 *  pitch kept) if present, else the normal clip — switchable without code changes. */
export function promptTempo(): number {
  const t = Number(process.env.PROMPT_TEMPO || "1");
  return Number.isFinite(t) && t >= 0.8 && t <= 1.3 ? t : 1;
}
export const tempoSuffix = (t = promptTempo()) => (Math.abs(t - 1) < 0.005 ? "" : `-t${Math.round(t * 100)}`);
/** tempo125: only caller-facing intro/hold clips get the faster copy. Whispers/desk accept (staff), voicemail
 *  prompts and the hold music always play at 1.0. */
export const tempoEligible = (key: string) =>
  /^(opening-|notice-|closed-|held-(es|en)$|hold-(es|en)$|hold-switch-)/.test(key);
function promptFile(key: string) {
  if (!/^[a-z0-9_-]+$/i.test(key)) return null;
  const suf = tempoEligible(key) ? tempoSuffix() : "";
  if (suf) {
    const fast = path.join(promptsDir, `${key}${suf}.mp3`);
    if (fs.existsSync(fast)) return fast;
  }
  const file = path.join(promptsDir, `${key}.mp3`);
  return fs.existsSync(file) ? file : null;
}
/** Best effort: make the tempo variant of a freshly generated clip when PROMPT_TEMPO ≠ 1 and ffmpeg is installed. */
function makeTempoVariant(key: string) {
  const suf = tempoEligible(key) ? tempoSuffix() : "";
  if (!suf) return;
  const src = path.join(promptsDir, `${key}.mp3`), dst = path.join(promptsDir, `${key}${suf}.mp3`);
  if (fs.existsSync(dst)) return;
  import("node:child_process").then(({ execFile }) => {
    execFile("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-filter:a", `atempo=${promptTempo()}`, "-b:a", "128k", `${dst}.partial.mp3`], (err) => {
      if (!err) { try { fs.renameSync(`${dst}.partial.mp3`, dst); } catch { /* keep normal clip */ } }
    });
  }).catch(() => {});
}
const playTag = (base: string, key: string) =>
  `<Play>${xmlEscape(`${base}/api/twilio/prompts/${key}.mp3`)}</Play>`;

/** Generate + cache one cloned-voice MP3 via xAI TTS (short timeout). Returns true if the file is ready. */
const promptGenInflight = new Map<string, Promise<boolean>>();
export async function ensurePrompt(lang: Lang, text: string, key: string, timeoutMs = 1500): Promise<boolean> {
  if (promptFile(key)) return true;
  if (!/^[a-z0-9_-]+$/i.test(key) || !text.trim()) return false;
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return false;
  let p = promptGenInflight.get(key);
  if (!p) {
    p = (async () => {
      try {
        const ctl = new AbortController();
        const kill = setTimeout(() => ctl.abort(), Math.max(500, timeoutMs));
        const r = await fetch("https://api.x.ai/v1/tts", {
          method: "POST",
          signal: ctl.signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice_id: XAI_PHONE_VOICE[lang], language: lang === "en" ? "en" : "es" })
        });
        clearTimeout(kill);
        if (!r.ok) return false;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 200) return false;
        fs.mkdirSync(promptsDir, { recursive: true });
        const partial = path.join(promptsDir, `${key}.mp3.partial`);
        fs.writeFileSync(partial, buf);
        fs.renameSync(partial, path.join(promptsDir, `${key}.mp3`));
        makeTempoVariant(key);
        return true;
      } catch {
        return false;
      } finally {
        promptGenInflight.delete(key);
      }
    })();
    promptGenInflight.set(key, p);
  }
  // Cap how long the webhook waits for this generation.
  const ok = await Promise.race([p, new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))]);
  return ok || !!promptFile(key);
}

/**
 * Prefer cached cloned-voice <Play>. If missing, try on-demand xAI TTS (~1.5s) and cache.
 * If that fails, play fallbackKey (also cloned, e.g. notice-new-es) — never Polly in the greeting.
 * Polly <Say> is only the last resort when even the generic clip is missing.
 */
export async function playCloned(base: string, lang: Lang, text: string, key: string, fallbackKey?: string): Promise<string> {
  const fb = fallbackKey || `notice-new-${lang}`;
  if (base && promptFile(key)) return playTag(base, key);
  if (base) await ensurePrompt(lang, text, key, 1500);
  if (base && promptFile(key)) return playTag(base, key);
  if (base && promptFile(fb)) return playTag(base, fb);
  return sayIn(lang, text);
}

/** Sync helper for static clips that are already on disk (hold/voicemail/opening). */
export function playOrSay(base: string, lang: Lang, text: string, key: string) {
  if (base && promptFile(key)) return playTag(base, key);
  return sayIn(lang, text);
}
// ---- closed1: closed days (TWILIO_CLOSED_DAYS, 0=Sun..6=Sat, ET). Message in Carlos's voice, then hang up. ----
// closed10: opening time hardcoded to 10 AM per Carlos (online pickup hours stay 11:00).
export const CLOSED_TEXT = {
  es: "Gracias por llamar a Cocina Elvis. Lo sentimos, los lunes estamos cerrados. Abrimos el martes a las diez de la mañana. ¡Hasta luego!",
  en: "Thanks for calling Cocina Elvis. Sorry, we're closed on Mondays. We open Tuesday at 10 AM. See you then!",
} as const;
export const closedKey = (lang: Lang) => `closed-${lang}`;
export function etWeekday(at: Date = new Date()): number {
  const d = at.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(d);
}
/** Minutes since midnight in America/New_York. */
export function etMinutes(at: Date = new Date()): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value || 0);
  return (n("hour") % 24) * 60 + n("minute");
}
const closedDaysEnv = () => String(process.env.TWILIO_CLOSED_DAYS ?? "1").split(",").map((x) => Number(x.trim())).filter((x) => x >= 0 && x <= 6);
const closedBypassed = (from: string) => {
  const bypass = String(process.env.TWILIO_CLOSED_BYPASS || "").split(",").map(d10).filter(Boolean);
  return !!(d10(from) && bypass.includes(d10(from)));
};

// ---- afterhours1/hours2: before opening / after closing (same voice + style as the Monday message), then hang up. ----
// hours2: the PHONE uses the real store hours in data/phone-hours.json (NOT the website's online-ordering hours).
// The phone stops answering closeLeadMinutes (30) before close; TWILIO_CLOSE_GRACE_MIN (default 0) can add time back.
// TWILIO_AFTERHOURS=0 turns this part off (Monday message stays). Override hours: TWILIO_PHONE_HOURS_JSON (same shape).
export type DayHours = { open: number; close: number } | null; // minutes since midnight, ET (close = last answering minute + 1)
const WD_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const hm = (s: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
type PhoneHoursFile = { closeLeadMinutes?: number; hours: Record<string, Array<{ open: string; close: string }>> };
let phoneHoursCache: { mtime: number; data: PhoneHoursFile | null } = { mtime: -1, data: null };
export const PHONE_HOURS_FILE = path.join(apiRoot, "data/phone-hours.json");
function storeHours(): PhoneHoursFile | null {
  if (process.env.TWILIO_PHONE_HOURS_JSON) { try { return JSON.parse(process.env.TWILIO_PHONE_HOURS_JSON); } catch { return null; } }
  try {
    const st = fs.statSync(PHONE_HOURS_FILE);
    if (st.mtimeMs !== phoneHoursCache.mtime) phoneHoursCache = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(PHONE_HOURS_FILE, "utf8")) };
  } catch { return phoneHoursCache.data; }
  return phoneHoursCache.data;
}
/** Phone answering window for one weekday (0=Sun), or null when closed all day / unknown. */
export function phoneHours(wd: number, cfg = storeHours()): DayHours {
  if (closedDaysEnv().includes(wd)) return null;
  const list = cfg?.hours ? cfg.hours[WD_KEYS[wd]] : undefined;
  if (!list || !list.length) return null;
  const opens = list.map((w) => hm(w.open)).filter(Number.isFinite), closes = list.map((w) => hm(w.close)).filter(Number.isFinite);
  if (!opens.length || !closes.length) return null;
  const lead = Math.max(0, Number(cfg?.closeLeadMinutes ?? 30) || 0);
  const grace = Math.max(0, Number(process.env.TWILIO_CLOSE_GRACE_MIN ?? "0") || 0);
  return { open: Math.min(...opens), close: Math.max(...closes) - lead + grace };
}
const ES_HOURS = ["doce", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once"];
const ES_DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function esTime(min: number) {
  const h = Math.floor(min / 60), m = min % 60, h12 = h % 12;
  const part = h < 12 ? "de la mañana" : h < 19 ? "de la tarde" : "de la noche";
  const mins = m === 0 ? "" : m === 30 ? " y media" : m === 15 ? " y cuarto" : ` y ${m}`;
  return `${h12 === 1 ? "la" : "las"} ${ES_HOURS[h12]}${mins} ${part}`;
}
function enTime(min: number) {
  const h = Math.floor(min / 60), m = min % 60, h12 = h % 12 || 12;
  return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
}
export type ClosedState = { kind: "day" | "before" | "after"; when: "today" | "tomorrow" | number; openMin: number; variant: string };
/** null = open (ring as usual). "day" = the closed-day (Monday) message; before/after = hours message. */
export function closedState(from: string, at: Date = new Date()): ClosedState | null {
  if (process.env.TWILIO_CLOSED_ENABLED !== "1" || closedBypassed(from)) return null;
  const wd = etWeekday(at), now = etMinutes(at);
  if (closedDaysEnv().includes(wd)) return { kind: "day", when: (wd + 1) % 7, openMin: 600, variant: "day" };
  if (process.env.TWILIO_AFTERHOURS === "0") return null;
  const hours = storeHours();
  if (!hours) return null; // no hours config → never block calls
  const today = phoneHours(wd, hours);
  if (today && now < today.open) return { kind: "before", when: "today", openMin: today.open, variant: `before-today-${today.open}` };
  if (today && now < today.close) return null;
  for (let i = 1; i <= 7; i++) {
    const d = (wd + i) % 7, h = phoneHours(d, hours);
    if (!h) continue;
    const when = i === 1 ? "tomorrow" : d;
    return { kind: "after", when, openMin: h.open, variant: `after-${i === 1 ? "tomorrow" : WD_KEYS[d].toLowerCase()}-${h.open}` };
  }
  return null;
}
export function closedNow(from: string, at: Date = new Date()): boolean {
  return closedState(from, at) !== null;
}
export function closedText(lang: Lang, s: ClosedState): string {
  if (s.kind === "day") return CLOSED_TEXT[lang];
  const whenEs = s.when === "today" ? "hoy" : s.when === "tomorrow" ? "mañana" : `el ${ES_DAYS[s.when]}`;
  const whenEn = s.when === "today" ? "today" : s.when === "tomorrow" ? "tomorrow" : EN_DAYS[s.when];
  if (lang === "es") return s.kind === "before"
    ? `Gracias por llamar a Cocina Elvis. Lo sentimos, todavía no abrimos. Abrimos ${whenEs} a ${esTime(s.openMin)}. ¡Hasta luego!`
    : `Gracias por llamar a Cocina Elvis. Lo sentimos, ya cerramos por hoy. Abrimos ${whenEs} a ${esTime(s.openMin)}. ¡Hasta luego!`;
  return s.kind === "before"
    ? `Thanks for calling Cocina Elvis. Sorry, we're not open yet. We open ${whenEn} at ${enTime(s.openMin)}. See you then!`
    : `Thanks for calling Cocina Elvis. Sorry, we're now closed for the day. We open ${whenEn} at ${enTime(s.openMin)}. See you then!`;
}
/** Clip key: Monday keeps closed-es/closed-en; hours clips are closed-<lang>-<variant> (tempo-eligible: "closed-"). */
export const closedStateKey = (lang: Lang, s: ClosedState) => (s.kind === "day" ? closedKey(lang) : `closed-${lang}-${s.variant}`);
/** Every hours clip the current schedule can need (for pre-generation and the Twilio fallback assets). */
export function allClosedStates(): ClosedState[] {
  const out = new Map<string, ClosedState>();
  const base = Date.UTC(2026, 9, 18, 16, 0); // a Sunday, noon ET — walk a week in 5-min steps
  for (let t = 0; t < 7 * 24 * 60; t += 5) {
    const s = closedState("", new Date(base + t * 60000));
    if (s && s.kind !== "day") out.set(s.variant, s);
  }
  return [...out.values()];
}
/** Known language → that clip only; new caller → Spanish then English. Always ends with Hangup. */
export function closedTwiml(base: string, lang?: Lang, state?: ClosedState | null): string {
  const order: Lang[] = lang ? [lang] : ["es", "en"];
  const s: ClosedState = state || { kind: "day", when: 2, openMin: 600, variant: "day" };
  return `${order.map((l) => playOrSay(base, l, closedText(l, s), closedStateKey(l, s))).join("")}<Hangup/>`;
}

/** intro2 (Carlos, Oct 18): short notices. v2 cache keys so the old long clips (kept on disk) are never served. */
export const NOTICE_NEW: Record<Lang, string> = {
  es: "Enseguida le atendemos. Esta llamada puede ser grabada.",
  en: "We'll be right with you. This call may be recorded.",
};
export const noticeNamedText = (lang: Lang, name: string) =>
  lang === "en" ? `Hi ${name}, this call may be recorded for training.` : `Hola ${name}, esta llamada puede ser grabada para capacitación.`;
export const noticeNewKey = (lang: Lang) => `notice-new-v2-${lang}`;
export const noticeNamedKey = (lang: Lang, slug: string) => `notice-named-v2-${lang}-${slug}`;

/** The recording notice. Known name (returning or Square): "Hola {name}, esta llamada puede ser grabada para capacitación."
 *  No name: the new-caller notice. Voicemail path: the same short named line as the lead, or nothing without a name. */
/** names1: a newly saved caller name → log it and make the "Hola {name}" clip now (caller's language first, then the
 *  other), so the next call plays it instantly. If no clip is ready, noticeLine falls back to the no-name intro. */
export function onCallerNameSaved(phone: string, fullName: string, source: NameSource, extra: Record<string, unknown> = {}) {
  logCall({ event: "caller_name_saved", caller: phone, name: fullName, nameSource: source, ...extra });
  const first = cleanFirstName(fullName);
  if (!first) return;
  const saved = (() => { try { return knownCaller(phone).language; } catch { return undefined; } })();
  const langs: Lang[] = saved === "en" ? ["en", "es"] : ["es", "en"];
  void (async () => { for (const l of langs) await ensurePrompt(l, noticeNamedText(l, first), noticeNamedKey(l, promptSlug(first)), 20000).catch(() => false); })();
}
setOnNameSaved(onCallerNameSaved);
/** names2: after an answered/voicemail call is transcribed, extract the caller's name (ELVI_NAME_EXTRACT=1). Runs
 *  ELVI_NAME_DELAY_MIN (default 10) minutes later so the POS ticket usually exists for the boost/conflict check. */
export function readbackOrdersFor(caller: string, at: string, durSec: number) {
  const start = new Date(Date.parse(at) - 5 * 60000).toISOString(), end = new Date(Date.parse(at) + (durSec + 30) * 1000 + 50 * 60000).toISOString();
  return {
    orders: () => searchOrdersReadOnly(start, end),
    bestTicketName: (orders: any[]) => { const p = String(caller).replace(/\D/g, "").slice(-10); for (const o of orders) { const n = orderNameForPhone(o, p); if (n) return n; } return null; },
  };
}
function scheduleReadbackName(callSid: string, caller: string, turns: CallTurn[], durSec: number) {
  if (!nameExtractEnabled() || !caller || isTrainingCaller(caller)) return;
  const at = callStartedAt.get(callSid) || new Date().toISOString();
  const delay = Math.max(0, Number(process.env.ELVI_NAME_DELAY_MIN ?? 10)) * 60000;
  setTimeout(() => {
    void learnReadbackName({
      caller, turns, at, durSec, ...readbackOrdersFor(caller, at, durSec),
      onPickup: (phone, name, d: ReadbackDecision) => logCall({ event: "caller_pickup_name", callSid, caller: phone, pickupName: name, confidence: d.confidence, evidence: d.evidence }),
      onSaved: (phone, name, d: ReadbackDecision) => onCallerNameSaved(phone, name, "readback", { callSid, confidence: d.confidence, evidence: d.evidence, boosted: !!d.boosted, ticketName: d.ticketName }),
    }).then((d) => {
      if (d.mismatch) logCall({ event: "caller_name_ticket_mismatch", callSid, caller, callName: d.name, ticketName: d.ticketName, confidence: d.confidence, saved: d.action === "save", evidence: d.evidence });
      if (d.action === "skip") logCall({ event: "caller_name_skipped", callSid, caller, reason: d.reason, name: d.name, confidence: d.confidence, ticketName: d.ticketName, evidence: d.evidence }); })
      .catch(() => {});
  }, delay).unref?.();
}
export async function noticeLine(language: Lang, opts: { name?: string | null; returning?: boolean; voicemail?: boolean; base?: string } = {}): Promise<string> {
  const base = opts.base || "";
  const slug = opts.name ? promptSlug(opts.name) : ""; // matches cleanFirstName → "Carlos" → "carlos"
  const generic = promptFile(noticeNewKey(language)) ? noticeNewKey(language) : `notice-new-${language}`;
  if (slug && opts.name) return playCloned(base, language, noticeNamedText(language, opts.name), noticeNamedKey(language, slug), generic);
  if (opts.voicemail) return "";
  return playOrSay(base, language, NOTICE_NEW[language], generic);
}

// ---- hold audio + voicemail text (es-MX / en-US) ----
export const HOLD_TEXT: Record<Lang, string> = {
  es: "Gracias por esperar, en un momento le atendemos. ¿Sabía que también puede ordenar en línea en cocinaelvis.com? Pregunte por nuestros especiales del día. Gracias por elegir Cocina Elvis.",
  en: "Thanks for holding, we'll be right with you. Did you know you can also order online at cocinaelvis.com? Ask us about today's specials. Thank you for choosing Cocina Elvis."
};
export const HELD_TEXT: Record<Lang, string> = {
  es: "Su llamada está en espera. Enseguida regresamos con usted. Gracias por su paciencia.",
  en: "You're on hold. We'll be right back with you. Thanks for your patience."
};
export const VOICEMAIL_TEXT: Record<Lang, string> = {
  es: "Gracias por llamar a Cocina Elvis. En este momento no podemos contestar. Deje su nombre, su número y su pedido después del tono, y le regresamos la llamada. También puede ordenar en línea en cocinaelvis.com.",
  en: "Thanks for calling Cocina Elvis. We can't take your call right now. Please leave your name, number and order after the tone, and we'll call you back. You can also order online at cocinaelvis.com."
};
/** intro2: language switch hint on the waiting-hold loop, said in the OTHER language's cloned voice. */
export const HOLD_SWITCH: Record<Lang, { text: string; voice: Lang; key: string }> = {
  es: { text: "For English, press 2.", voice: "en", key: "hold-switch-v2-en" },
  en: { text: "Para español, oprima 1.", voice: "es", key: "hold-switch-v2-es" },
};
// Short loop (~18s) so /hold re-checks maxWait often. Override with TWILIO_HOLD_MUSIC if needed.
const HOLD_MUSIC_DEFAULT = "http://com.twilio.music.guitars.s3.amazonaws.com/Pitx_-_A_Thought.mp3";
const HOLD_MUSIC = process.env.TWILIO_HOLD_MUSIC || ""; // empty → use local loop via play URL when base known

// ---- counter-phone state (in memory; resets when the API restarts) ----
type Entry = { callSid: string; from: string; name: string | null; line: string; queue: string; language: Lang; training: boolean; at: number; lastSeen: number; heldAt?: number };
const waiting = new Map<string, Entry>(); // customer CallSid -> waiting in a line queue
const held = new Map<string, Entry>(); // customer CallSid -> put on hold by staff (own queue hold-<sid>)
const active = new Map<string, Entry & { agentSid: string; since: number }>(); // agent CallSid -> bridged call
const callLang = new Map<string, Lang>();
const callers = new Map<string, string>(); // CallSid -> From
const callNames = new Map<string, string | null>(); // customer CallSid -> first name (Square/manual)
const callStartedAt = new Map<string, string>(); // customer CallSid -> ISO call start (incoming)
const callLines = new Map<string, string>(); // customer CallSid -> called Twilio number
const segments = new Map<string, { turns: CallTurn[]; files: string[]; at: number }>(); // recordings already processed per call
const talk = new Map<string, number>(); // customer CallSid -> talk seconds across bridges

/** Kitchen-ticket shaped shadow order for /phone.html (Square POS style, read-only). */
export type DeluxeMode = "note" | "expand";
/** 'note' = print Deluxe + italic staff note (no crema). 'expand' = print remaining deluxe toppings only. */
export const DELUXE_MODE: DeluxeMode = process.env.ELVI_DELUXE_MODE === "expand" ? "expand" : "note";

export type ElviTicketLine = {
  name: string; quantity: number; choices: string[]; notes?: string[];
  flag?: string | null; totalCents?: number; kind?: "food" | "drink" | "extra" | "fee" | "divider";
};
export type ElviTicket = {
  callSid: string; at: string; caller: string; name: string | null; receiptCode: string;
  source: string; phoneDisplay: string;
  language: Lang; phase: "listening" | "final";
  fulfillment: string; // TO GO / LLEVAR | FOR HERE / PARA AQUI | DELIVERY / ENTREGA | PICKUP …
  readyTime?: string | null;
  deliverTo?: { name?: string; address?: string; phone?: string; notes?: string } | null;
  lines: ElviTicketLine[];
  training: boolean; openAsk?: string | null; transcript?: string;
  squareRef?: SquareRef | null; // ticketno1: the real Square ticket once staff ring it up
};
export type SquareRef = { receiptNumber: string | null; ticketName: string | null; orderId: string; paymentId: string | null; dashboardUrl: string | null; receiptUrl: string | null; matchedBy: string; linkedAt: string };
// ---- ticketno1: link each Elvi ticket to the real Square ticket (read-only) so staff see Square's own numbers ----
// "Receipt #" = payment receipt_number (what the printed receipt and Transactions search show); "Ticket" = POS ticket name.
const squareLinksFile = path.join(logDir, "square-links.json");
function loadSquareLinks(): Record<string, SquareRef> { try { return JSON.parse(fs.readFileSync(squareLinksFile, "utf8")); } catch { return {}; } }
export function squareLinkFor(callSid: string): SquareRef | null { return loadSquareLinks()[callSid] || null; }
let lastSquareLink = 0;
/** Pick the Square order for a call: phone match, or ticket name = caller's name, or the only order rung up right after. */
export function pickSquareOrder(t: { at: string; caller: string; name: string | null }, orders: any[]): { order: any; by: string } | null {
  const at = Date.parse(t.at), phone = d10(t.caller), first = String(t.name || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
  const win = orders.filter((o) => { const c = Date.parse(o.created_at); return c >= at - 2 * 60000 && c <= at + 60 * 60000; });
  const phoneOf = (o: any) => (o.fulfillments || []).flatMap((f: any) => [f.pickup_details, f.delivery_details].map((x: any) => d10(x?.recipient?.phone_number || "")));
  const byPhone = phone ? win.filter((o) => phoneOf(o).includes(phone)) : [];
  if (byPhone.length) return { order: byPhone[0], by: "phone" };
  const byName = first ? win.filter((o) => String(o.ticket_name || "").trim().split(/\s+/)[0]?.toLowerCase() === first) : [];
  if (byName.length === 1) return { order: byName[0], by: "ticket name" };
  const soon = win.filter((o) => Date.parse(o.created_at) <= at + 20 * 60000);
  if (soon.length === 1) return { order: soon[0], by: "only ticket in 20 min" };
  return null;
}
export async function linkSquareTickets(force = false) {
  if (!force && Date.now() - lastSquareLink < 60000) return;
  lastSquareLink = Date.now();
  const links = loadSquareLinks();
  const todo = [...ticketsByCall.values()].filter((t) => !links[t.callSid] && Date.now() - Date.parse(t.at) > 60000 && Date.now() - Date.parse(t.at) < 72 * 3600000);
  if (!todo.length) return;
  const start = new Date(Math.min(...todo.map((t) => Date.parse(t.at))) - 3 * 60000).toISOString();
  let orders: any[] = [];
  try { orders = await searchOrdersReadOnly(start, new Date().toISOString()); } catch { return; }
  const used = new Set(Object.values(links).map((l) => l.orderId));
  let changed = false;
  for (const t of todo) {
    const pick = pickSquareOrder(t, orders.filter((o) => !used.has(o.id)));
    if (!pick) continue;
    const r = squareRefs(pick.order);
    const rc = r.paymentId ? await paymentReceiptReadOnly(r.paymentId) : null;
    const ref: SquareRef = { receiptNumber: rc?.receiptNumber || r.receiptNumber, ticketName: r.ticketName, orderId: r.orderId, paymentId: r.paymentId, dashboardUrl: r.dashboardUrl, receiptUrl: rc?.receiptUrl || null, matchedBy: pick.by, linkedAt: new Date().toISOString() };
    links[t.callSid] = ref; used.add(r.orderId); changed = true;
    t.squareRef = ref;
    logCall({ event: "square_ticket", callSid: t.callSid, receiptNumber: ref.receiptNumber, orderId: ref.orderId, matchedBy: ref.matchedBy });
  }
  if (changed) { try { fs.writeFileSync(squareLinksFile, JSON.stringify(links, null, 1)); saveTickets(); } catch { /* best effort */ } }
}
// ---- delivery1: fulfillment label + console view (saved address as soon as a known caller rings) ----
export const FULFILLMENT_LABEL: Record<Fulfillment, string> = { DELIVERY: "DELIVERY / ENTREGA", PICKUP: "TO GO / LLEVAR", FOR_HERE: "FOR HERE / PARA AQUI" };
const callDelivery = new Map<string, { fulfillment: Fulfillment | null; address: string | null; street: string | null; confirmed: boolean; quote: Quote | null }>();
function quoteView(q: Quote | null) {
  return q ? { ok: q.ok, needsConfirm: q.needsConfirm, reason: q.reason || null, zone: q.zoneLabel || null, city: q.city || null, feeCents: q.feeCents ?? null, etaMinutes: q.etaMinutes ?? null, miles: q.miles ?? null, minimumCents: q.minimumCents ?? 1000, feeConfirmed: q.feeConfirmed !== false, breakdown: q.breakdown ?? null } : null;
}
export function deliveryView(from: string, callSid?: string) {
  const heard = callSid ? callDelivery.get(callSid) : undefined;
  let saved: ReturnType<typeof savedDelivery> | null = null;
  try { saved = savedDelivery(from); } catch { saved = null; }
  const addr = heard?.address || saved?.address?.address || null;
  let quote = heard?.quote || null;
  if (!quote && addr) { quote = cachedQuote(addr); if (!quote) void quoteDeliveryAddress(addr).catch(() => null); }
  return {
    fulfillment: heard?.fulfillment || null, // said on THIS call
    lastFulfillment: saved?.lastFulfillment || null,
    address: addr, street: heard?.street || saved?.address?.street || null,
    addressFrom: heard?.address ? "call" : saved?.address ? "saved" : null,
    savedLastUsedAt: saved?.address?.lastUsedAt || null, savedCount: saved?.addressCount || 0,
    confirmed: !!heard?.confirmed, quote: quoteView(quote),
    // delivery2: food subtotal Elvi heard (for the MÍNIMO $10 warning); null until the ticket has lines.
    subtotalCents: (() => { const t = callSid ? ticketsByCall.get(callSid) : undefined; const ls = (t?.lines || []).filter((l) => l.kind !== "fee" && l.kind !== "divider"); return ls.length ? ls.reduce((a, l) => a + Number(l.totalCents || 0), 0) : null; })(),
  };
}
/** After a call's transcript: fulfillment + address (staff read-back counts) → ticket, call log, caller memory. */
async function applyCallDelivery(callSid: string, caller: string, turns: Array<{ speaker: "caller" | "staff"; start: number; text: string }>, training: boolean) {
  const f = detectFulfillment(turns);
  const a = f.fulfillment === "DELIVERY" ? detectAddress(turns) : { address: null, confirmed: false, by: null };
  if (!f.fulfillment) return null;
  let quote: Quote | null = null;
  const addr = a.address?.full || (f.fulfillment === "DELIVERY" ? savedDelivery(caller).address?.address || null : null);
  if (f.fulfillment === "DELIVERY" && addr) { try { quote = await quoteDeliveryAddress(addr); } catch { quote = null; } }
  callDelivery.set(callSid, { fulfillment: f.fulfillment, address: addr, street: a.address?.street || null, confirmed: a.confirmed, quote });
  logCall({ event: "fulfillment", callSid, caller, fulfillment: f.fulfillment, by: f.by, address: addr, addressFrom: a.address ? "call" : addr ? "saved" : null, addressConfirmed: a.confirmed, zone: quote?.zone || null, feeCents: quote?.feeCents ?? null, etaMinutes: quote?.etaMinutes ?? null, needsConfirm: quote ? quote.needsConfirm : f.fulfillment === "DELIVERY", source: training ? "training" : "customer" });
  try { saveCallerFulfillment(caller, f.fulfillment, a.address ? { full: a.address.full, street: a.address.street } : null); } catch { /* memory only */ }
  const notes = f.fulfillment !== "DELIVERY" ? undefined
    : quote?.ok ? `${(quote.city || "").toUpperCase()} · ${quote.breakdown || `$${(quote.feeCents! / 100).toFixed(quote.feeCents! % 100 ? 2 : 0)}`}${quote.feeConfirmed === false ? " · CONFIRMAR TARIFA" : ""} · ~${quote.etaMinutes} min · MÍNIMO $10${a.confirmed ? "" : " · confirmar dirección"}`
    : quote?.reason === "out_of_range" ? `FUERA DEL ÁREA DE ENTREGA (${quote.miles} mi)`
    : `CONFIRMAR ZONA${addr ? "" : " · FALTA DIRECCIÓN"}`;
  return { fulfillment: FULFILLMENT_LABEL[f.fulfillment], deliverTo: f.fulfillment === "DELIVERY" ? { address: addr || "", phone: formatTicketPhone(caller), notes } : null };
}
const ticketsFile = path.join(logDir, "elvi-tickets.json");
const ticketsByCall = new Map<string, ElviTicket>();
function loadTickets(): ElviTicket[] {
  try { return JSON.parse(fs.readFileSync(ticketsFile, "utf8")); } catch { return []; }
}
function saveTickets() {
  const list = [...ticketsByCall.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12);
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(ticketsFile, JSON.stringify(list, null, 2));
}
for (const t of loadTickets()) ticketsByCall.set(t.callSid, t);
export const receiptCode = (callSid: string) => {
  const s = String(callSid || "").replace(/^CA/i, "");
  return (s.slice(-4) || "XXXX").toUpperCase();
};
/** Included Mild Salsa Asada is not printed on kitchen tickets (see Nicholas/Jonathan). Non-default salsa stays. */
const HIDE_INCLUDED_SALSA = /^mild salsa asada$/i;
const stripPrice = (c: string) => String(c || "").replace(/\s*\(\+\$[\d.]+\)\s*$/, "").trim();
const stripOnline = (n: string) => String(n || "").replace(/\s*\(ONLINE\)\s*$/i, "").trim();
const normChoice = (s: string) => stripPrice(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export function formatTicketPhone(e164: string): string {
  const d = String(e164 || "").replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return e164 || "";
  return `+1 ${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}
/** Elvi Phone · XXX-XXXX from the Twilio line that answered (289/551 map not configured → use line digits). */
export function elviPhoneSource(calledNumber: string): string {
  const d = d10(calledNumber);
  if (!d) return "Elvi Phone";
  // Optional short labels: TWILIO_LINE_SHORTS=+14409011609=289,+14406642795=551
  const shorts = String(process.env.TWILIO_LINE_SHORTS || "");
  for (const part of shorts.split(",")) {
    const [num, short] = part.split("=").map((x) => x.trim());
    if (d10(num) === d && short) return `Elvi Phone · ${short}`;
  }
  // National line without country/area clutter: 901-1609 / 664-2795
  const pretty = d.length === 10 ? `${d.slice(3, 6)}-${d.slice(6)}` : d;
  return `Elvi Phone · ${pretty}`;
}

let catalogChoiceNames: string[] | null = null;
let catalogMtime = 0;
function loadCatalogChoiceNames(): string[] {
  const catFile = path.join(apiRoot, "data/site-catalog.json");
  let mtime = 0;
  try { mtime = fs.statSync(catFile).mtimeMs; } catch { /* missing */ }
  // ticket5: re-read after a menu sync so a renamed Square label (e.g. DELUXE + Queso Fresco) shows up without a restart.
  if (catalogChoiceNames && mtime === catalogMtime) return catalogChoiceNames;
  catalogMtime = mtime;
  try {
    const cat = JSON.parse(fs.readFileSync(catFile, "utf8"));
    const out: string[] = [];
    const walk = (o: any) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { for (const x of o) walk(x); return; }
      if (typeof o.name === "string" && o.squareId && (o.priceCents != null || o.preselected != null)) out.push(o.name);
      for (const v of Object.values(o)) walk(v);
    };
    walk(cat);
    catalogChoiceNames = [...new Set(out)];
  } catch { catalogChoiceNames = []; }
  return catalogChoiceNames;
}
/**
 * Kitchen/POS labels ↔ site-catalog. Prefer the text Square prints on kitchen tickets
 * (e.g. "Taco de Comal") when catalog online drops "de".
 * NO BEBIDA / NO DRINK is a POS line item not present as a catalog choice — pass through.
 */
const CATALOG_ALIASES: Array<[RegExp, string]> = [
  [/^\(TCO\)\s*Tacos?\s+(?:de\s+)?Comal\s*\/\s*Homemade$/i, "(TCO) Taco de Comal / Homemade"],
  [/^\(QCO\)\s*Quesadillas?\s+(?:de\s+)?Comal\s*\/\s*Homemade$/i, "(QCO) Quesadilla de Comal / Homemade"],
  [/^Con Frijoles\s*\/\s*With Beans$/i, "**Con Frijoles / With Beans"],
  [/^\*{0,2}\s*Con Frijoles\s*\/\s*With Beans$/i, "**Con Frijoles / With Beans"],
  [/^Con Queso Fresco\s*\/\s*With Cheese$/i, "**Con Queso Fresco / With Cheese"],
  [/^\*{0,2}\s*Con Queso Fresco\s*\/\s*With Cheese$/i, "**Con Queso Fresco / With Cheese"],
  [/^Regular\s*[\u2019']10$/i, "Regular '10"],
];
const KNOWN_PASSTHROUGH = new Set(["NO BEBIDA / NO DRINK"]);
function squareChoiceLabel(raw: string): string {
  let stripped = stripPrice(raw);
  if (!stripped) return stripped;
  if (KNOWN_PASSTHROUGH.has(stripped)) return stripped;
  for (const [re, canon] of CATALOG_ALIASES) {
    if (re.test(stripped)) { stripped = canon; break; }
  }
  const n = normChoice(stripped);
  const all = loadCatalogChoiceNames();
  // Exact catalog hit (online may say "Taco Comal" without "de")
  const hit = all.find((c) => normChoice(c) === n);
  if (hit && !/de comal/i.test(stripped)) {
    // If kitchen alias already chose "de Comal", keep it; else use catalog.
    return hit;
  }
  if (/taco de comal/i.test(stripped) || /quesadilla de comal/i.test(stripped)) return stripped;
  if (hit) return hit;
  const starred = all.find((c) => normChoice(c.replace(/^\*+\s*/, "")) === n);
  return starred || stripped;
}
/**
 * ticket5: Deluxe = Lechuga, Pico, Crema AND Queso Fresco (Carlos). The Square label still omits Queso Fresco until he
 * renames it, so print the full label; once the live/catalog label mentions Queso/Fresco, print that label exactly.
 */
const DELUXE_FULL = "DELUXE (Lechuga/Lettuce, Pico, Crema/Sour Cream, Queso Fresco)";
export function deluxeTicketLabel(current: string): string {
  const cur = stripPrice(current);
  if (/\bDELUXE\b/i.test(cur) && /queso|fresco/i.test(cur)) return cur;
  const cat = loadCatalogChoiceNames().find((c) => /\bDELUXE\b/i.test(c) && !/^\(QD\)/i.test(c) && /queso|fresco/i.test(c));
  return cat || DELUXE_FULL;
}
export const NO_BEBIDA = "NO BEBIDA / NO DRINK";
const DELUXE_QD = "(QD) DELUXE Preparada";
const DELUXE_TOPPINGS: Array<{ re: RegExp; label: string }> = [
  { re: /lechuga|lettuce/i, label: "Lechuga / Lettuce" },
  { re: /pico/i, label: "Pico de Gallo" },
  { re: /crema|sour\s*cream/i, label: "Crema / Sour Cream" },
  { re: /queso\s*fresco|fresco/i, label: "Queso Fresco" },
];
/** Staff-style italic notes for removals (lowercase), e.g. 'no crema' — shared list in call-scoring.ts. */
function detectRemovals(elviOrder: any, transcript?: string): string[] {
  const texts: string[] = [];
  for (const s of elviOrder?.steps || []) {
    if (s?.reply) texts.push(String(s.reply));
    if (s?.heard) texts.push(String(s.heard));
  }
  if (transcript) texts.push(String(transcript));
  return removalNotesIn(texts.join("\n"));
}
function isDrinkName(name: string) {
  return /\b(agua|aguas|horchata|orchata|jamaica|tamarindo|coca|pepsi|soda|drink|refresco|sprite|fanta)\b/i.test(name);
}
function isExtraName(name: string) {
  return /^extras?\b/i.test(name) || /\bsalsa\b.*\b4oz\b/i.test(name);
}
function lineKind(name: string): ElviTicketLine["kind"] {
  if (/^no\s+bebida\b/i.test(name)) return "divider";
  if (/delivery\s*fee/i.test(name)) return "fee";
  if (isExtraName(name)) return "extra";
  if (isDrinkName(name)) return "drink";
  return "food";
}
/** Apply DELUXE_MODE when a deluxe modifier is present and the caller asked to drop a deluxe topping. */
function applyDeluxeMode(choices: string[], removalNotes: string[], mode: DeluxeMode): { choices: string[]; notes: string[] } {
  const di = choices.findIndex((c) => /\bDELUXE\b/i.test(c));
  if (di < 0) {
    // Regular item: kitchen only prints what's included — never print 'no X' / 'sin X'.
    return { choices, notes: [] };
  }
  const deluxeRemovals = removalNotes.filter((n) => DELUXE_TOPPINGS.some((t) => t.re.test(n)));
  if (mode === "expand") {
    const kept = DELUXE_TOPPINGS.filter((t) => !deluxeRemovals.some((n) => t.re.test(n))).map((t) => t.label);
    const next = [...choices.slice(0, di), ...kept, ...choices.slice(di + 1)];
    return { choices: next, notes: removalNotes.filter((n) => !deluxeRemovals.includes(n)) };
  }
  // note (default): keep Deluxe catalog line, italic staff notes for removals
  let deluxe = choices[di];
  if (/^\(QD\)/i.test(deluxe)) deluxe = squareChoiceLabel(DELUXE_QD) || DELUXE_QD;
  else deluxe = deluxeTicketLabel(deluxe);
  const next = [...choices];
  next[di] = deluxe;
  return { choices: next, notes: deluxeRemovals };
}
function sortTicketLines(lines: ElviTicketLine[]): ElviTicketLine[] {
  const rank = (k?: string) => (k === "food" ? 0 : k === "extra" ? 1 : k === "drink" ? 2 : 3);
  return [...lines].sort((a, b) => rank(a.kind) - rank(b.kind));
}
/** Square-style: merge consecutive/identical lines (same name + modifiers + notes) into N × Name. */
function mergeIdenticalTicketLines(lines: ElviTicketLine[]): ElviTicketLine[] {
  const key = (l: ElviTicketLine) => JSON.stringify({
    name: l.name,
    choices: l.choices || [],
    notes: l.notes || [],
    kind: l.kind || "food",
    flag: l.flag || null,
  });
  const out: ElviTicketLine[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    // ticket5: never merge across (or into) a NO BEBIDA container divider.
    if (prev && l.kind !== "divider" && prev.kind !== "divider" && key(prev) === key(l)) {
      prev.quantity = (Number(prev.quantity) || 0) + (Number(l.quantity) || 0);
      if (prev.totalCents != null || l.totalCents != null)
        prev.totalCents = (Number(prev.totalCents) || 0) + (Number(l.totalCents) || 0);
    } else {
      out.push({ ...l, choices: [...(l.choices || [])], notes: [...(l.notes || [])] });
    }
  }
  return out;
}

const dividerLine = (): ElviTicketLine => ({ name: NO_BEBIDA, quantity: 1, choices: [], notes: [], kind: "divider", flag: null });
/**
 * ticket5: lay lines out in containers separated by "1 × NO BEBIDA / NO DRINK" (how staff split one order into
 * several to-go containers). Lines are in cart order. Each container is sorted and merged on its own.
 */
export function applyContainerPlan(lines: ElviTicketLine[], plan?: ContainerPlan | null): ElviTicketLine[] {
  type Cell = { line: ElviTicketLine; idx: number } | "|";
  let seq: Cell[] = [];
  const breaks = new Set((plan?.breaks || []).filter((b) => b > 0 && b < lines.length));
  lines.forEach((line, idx) => {
    if (breaks.has(idx)) seq.push("|");
    if (line.kind === "divider" || /^no\s+bebida\b/i.test(line.name)) seq.push("|");
    else seq.push({ line, idx });
  });
  for (const sp of plan?.splits || []) {
    const parts = Math.max(2, Math.min(6, Number(sp.parts) || 2));
    const to = sp.to == null ? lines.length : sp.to;
    const isTarget = (c: Cell) => c !== "|" && c.idx >= sp.from && c.idx < to && (c.line.kind || "food") === "food";
    const targets = seq.filter(isTarget) as Array<{ line: ElviTicketLine; idx: number }>;
    if (!targets.length) continue;
    const per = (q: number) => q / parts;
    const copy = (l: ElviTicketLine, q: number): ElviTicketLine => ({
      ...l, quantity: q, choices: [...(l.choices || [])], notes: [...(l.notes || [])],
      ...(l.totalCents != null ? { totalCents: Math.round((Number(l.totalCents) || 0) * q / (Number(l.quantity) || 1)) } : {}),
    });
    const at = seq.findIndex(isTarget);
    if (targets.every((t) => Number(t.line.quantity) >= parts && Number(t.line.quantity) % parts === 0)) {
      // 6 quesadillas → 3 | 3 (several dishes: each container gets its share of every dish)
      const groups: Cell[] = [];
      for (let g = 0; g < parts; g++) {
        if (g) groups.push("|");
        for (const t of targets) groups.push({ line: copy(t.line, per(Number(t.line.quantity))), idx: t.idx });
      }
      const rest = seq.filter((c) => !targets.includes(c as any));
      const insertAt = seq.slice(0, at).filter((c) => !targets.includes(c as any)).length;
      const isFood = (c: Cell) => c !== "|" && (c.line.kind || "food") === "food";
      const before = rest.slice(0, insertAt), after = rest.slice(insertAt);
      // Other dishes keep their own container; drinks/extras ride along with the last container.
      seq = [...before, ...(before.some(isFood) ? ["|" as Cell] : []), ...groups, ...(after.some(isFood) ? ["|" as Cell] : []), ...after];
    } else {
      // Can't divide evenly: one container per dish; staff confirm if the count is off.
      const flagIt = targets.length !== parts;
      seq = seq.flatMap((c) => {
        if (!isTarget(c)) return [c];
        const cell = c as { line: ElviTicketLine; idx: number };
        if (flagIt && cell === targets[0]) cell.line = { ...cell.line, flag: cell.line.flag || `Confirmar recipientes: ${parts}` };
        return cell === targets[0] ? [c] : ["|", c];
      });
    }
  }
  const groups: ElviTicketLine[][] = [[]];
  for (const c of seq) {
    if (c === "|") { if (groups[groups.length - 1].length) groups.push([]); }
    else groups[groups.length - 1].push(c.line);
  }
  const filled = groups.filter((g) => g.length);
  const out: ElviTicketLine[] = [];
  filled.forEach((g, i) => {
    if (i) out.push(dividerLine());
    out.push(...mergeIdenticalTicketLines(sortTicketLines(g)));
  });
  return out;
}
/** Pure ticket-line builder (Square kitchen style) — exported for the replay harness / previews. */
export type RemovalInfo = { attributed?: boolean; ambiguous?: string[] } | null;
const isDeluxeTopping = (n: string) => DELUXE_TOPPINGS.some((t) => t.re.test(n));
export function buildTicketLines(
  described: Array<{ name: string; quantity: number; choices: string[]; totalCents?: number }>,
  cart: any[], removals: string[], deluxeMode: DeluxeMode = DELUXE_MODE, containers?: ContainerPlan | null,
  removalInfo?: RemovalInfo,
): ElviTicketLine[] {
  const labelled = described.map((l) => (l.choices || [])
    .map((c) => squareChoiceLabel(c))
    .filter((c) => c && !HIDE_INCLUDED_SALSA.test(stripPrice(c))));
  const hasDeluxe = (choices: string[]) => choices.some((c) => /\bDELUXE\b/i.test(c));
  const deluxeCount = labelled.filter(hasDeluxe).length;
  // fix24: a removal goes on the Deluxe dish the caller meant (attributed per cart line by the shadow order).
  // With several Deluxe dishes and no way to tell which, no dish gets the note; staff get a confirm flag instead.
  const ambiguous = (removalInfo?.attributed ? (removalInfo.ambiguous || []) : (deluxeCount > 1 ? removals : [])).filter(isDeluxeTopping);
  const lines: ElviTicketLine[] = described.map((l, i) => {
    const row = cart[i];
    const ask = (row?.modifiers || []).find((m: any) => m.step === "meat_needs_ask" || m.groupName === "meat_needs_ask");
    let choices = labelled[i];
    const lineHasDeluxe = hasDeluxe(choices);
    let lineRemovals: string[] = removalInfo?.attributed ? [...(row?.elviNotes || [])] : (deluxeCount > 1 ? [] : removals);
    if (lineHasDeluxe && deluxeCount === 1 && ambiguous.length) lineRemovals = [...new Set([...lineRemovals, ...ambiguous])];
    const applied = applyDeluxeMode(choices, lineHasDeluxe ? lineRemovals : [], deluxeMode);
    choices = applied.choices;
    const name = stripOnline(l.name);
    const flags = [
      ask ? `Confirmar carne: ${ask.option}` : "",
      lineHasDeluxe && deluxeCount > 1 && ambiguous.length ? `Confirmar: ${ambiguous.join(", ")} — ¿en cuál DELUXE?` : "",
    ].filter(Boolean);
    return {
      name, quantity: l.quantity, choices, notes: applied.notes, totalCents: l.totalCents,
      flag: flags.length ? flags.join(" · ") : null, kind: lineKind(name),
    };
  });
  return applyContainerPlan(lines, containers);
}

async function upsertTicket(
  partial: Partial<ElviTicket> & { callSid: string },
  describe: Describe,
  cart?: any[],
  elviOrder?: any,
  deluxeMode: DeluxeMode = DELUXE_MODE,
) {
  const prev = ticketsByCall.get(partial.callSid);
  const startIso = callStartedAt.get(partial.callSid) || prev?.at || partial.at || new Date().toISOString();
  let lines: ElviTicketLine[] = partial.lines || prev?.lines || [];
  const removals = detectRemovals(elviOrder || { steps: [] }, partial.transcript ?? prev?.transcript);
  if (cart && describe) {
    try {
      const described = await describe(cart);
      lines = buildTicketLines(described, cart, removals, deluxeMode, elviOrder?.containers || null,
        elviOrder?.removalsAttributed ? { attributed: true, ambiguous: elviOrder.ambiguousRemovals || [] } : null);
    } catch { /* keep previous lines */ }
  }
  const caller = partial.caller || prev?.caller || "";
  const called = callLines.get(partial.callSid) || "";
  const name =
    partial.name != null && String(partial.name).trim()
      ? partial.name
      : (prev?.name ?? partial.name ?? null);
  const t: ElviTicket = {
    callSid: partial.callSid,
    at: startIso,
    caller,
    name,
    receiptCode: partial.receiptCode || prev?.receiptCode || receiptCode(partial.callSid),
    source: partial.source || prev?.source || elviPhoneSource(called),
    phoneDisplay: partial.phoneDisplay || prev?.phoneDisplay || formatTicketPhone(caller),
    language: partial.language || prev?.language || "es",
    phase: partial.phase || prev?.phase || "listening",
    fulfillment: partial.fulfillment || prev?.fulfillment || "TO GO / LLEVAR",
    readyTime: partial.readyTime !== undefined ? partial.readyTime : prev?.readyTime,
    deliverTo: partial.deliverTo !== undefined ? partial.deliverTo : prev?.deliverTo,
    lines,
    training: partial.training ?? prev?.training ?? false,
    openAsk: partial.openAsk !== undefined ? partial.openAsk : prev?.openAsk,
    transcript: partial.transcript !== undefined ? partial.transcript : prev?.transcript
  };
  ticketsByCall.set(t.callSid, t);
  saveTickets();
  return t;
}
function recentTickets(limit = 10) {
  return [...ticketsByCall.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
// Presence is in-memory AND persisted so a tsx/server reload does not dump live calls to voicemail.
const presenceFile = path.join(logDir, "agent-presence.json");
function loadAgentSeenAt() {
  try {
    const n = Number(JSON.parse(fs.readFileSync(presenceFile, "utf8")).seenAt);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}
let agentSeenAt = loadAgentSeenAt();
function touchAgent(reason = "heartbeat") {
  agentSeenAt = Date.now();
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(presenceFile, JSON.stringify({ seenAt: agentSeenAt, reason, at: new Date().toISOString() }));
  } catch { /* best effort */ }
}
let lastBase = (process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
/** Default 90s: covers brief API restarts while /phone.html keeps polling every 2s. */
const agentGraceMs = () => Number(process.env.PHONE_ONLINE_GRACE_MS || 90000);
const agentOnline = () => Date.now() - agentSeenAt < agentGraceMs();
const agentAgeMs = () => (agentSeenAt ? Date.now() - agentSeenAt : null);
const maxWaitSec = () => Number(process.env.TWILIO_MAX_WAIT_SEC || 150);
const maxHeldSec = () => Number(process.env.TWILIO_MAX_HELD_SEC || 600);
export const lineQueue = (to: string) => `line-${d10(to) || "main"}`;

/** Re-attach a Twilio queue member into our in-memory waiting list (survives API restarts). */
function resurrectWaiter(sid: string, body: Record<string, unknown>, queueName: string, lang: Lang = "es") {
  if (!sid || waiting.has(sid) || held.has(sid)) return;
  const from = String(body.From || body.Caller || callers.get(sid) || "");
  const now = Date.now();
  const queuedAt = now - Math.max(0, Number(body.QueueTime || 0) * 1000);
  waiting.set(sid, {
    callSid: sid, from, name: null, line: "", queue: queueName, language: callLang.get(sid) || lang,
    training: isTrainingCaller(from), at: queuedAt, lastSeen: now
  });
  logCall({ event: "waiting_resurrected", callSid: sid, caller: from, queue: queueName, queueTime: body.QueueTime });
}

/** Pull live members from Twilio Queues into `waiting` so Contestar never vanishes while they're still queued. */
async function syncWaitingFromTwilio() {
  const account = process.env.TWILIO_ACCOUNT_SID;
  if (!account || !process.env.TWILIO_AUTH_TOKEN) return;
  try {
    const wanted = new Map(phoneLines().map((l) => [l.queue, l]));
    const qr = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Queues.json?PageSize=50`, { headers: { Authorization: twAuth() } });
    if (!qr.ok) return;
    const qj = await qr.json() as { queues?: Array<{ sid: string; friendly_name: string; current_size: number }> };
    for (const q of qj.queues || []) {
      const line = wanted.get(q.friendly_name);
      if (!line || !q.current_size) continue;
      const mr = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Queues/${q.sid}/Members.json?PageSize=50`, { headers: { Authorization: twAuth() } });
      if (!mr.ok) continue;
      const mj = await mr.json() as { queue_members?: Array<{ call_sid: string; date_enqueued?: string; position?: number }> };
      for (const m of mj.queue_members || []) {
        const sid = m.call_sid;
        if (!sid) continue;
        if (waiting.has(sid) || held.has(sid) || [...active.values()].some((a) => a.callSid === sid)) continue;
        const enq = m.date_enqueued ? Date.parse(m.date_enqueued) : Date.now();
        const from = callers.get(sid) || "";
        waiting.set(sid, {
          callSid: sid, from, name: null, line: line.number, queue: line.queue,
          language: callLang.get(sid) || "es", training: isTrainingCaller(from),
          at: Number.isFinite(enq) ? enq : Date.now(), lastSeen: Date.now()
        });
        logCall({ event: "waiting_synced", callSid: sid, caller: from, queue: line.queue });
      }
    }
    // Drop phantom waiters that Twilio no longer has in any line queue (and aren't active/held)
    const live = new Set<string>();
    for (const q of qj.queues || []) {
      if (!wanted.has(q.friendly_name)) continue;
      const mr = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Queues/${q.sid}/Members.json?PageSize=50`, { headers: { Authorization: twAuth() } });
      if (!mr.ok) continue;
      const mj = await mr.json() as { queue_members?: Array<{ call_sid: string }> };
      for (const m of mj.queue_members || []) if (m.call_sid) live.add(m.call_sid);
    }
    for (const [sid, e] of waiting) {
      if (live.has(sid)) continue;
      // Only drop if we've seen a successful sync with empty/other members recently — skip if queues fetch failed partially
      if (Date.now() - e.lastSeen > 45000) {
        waiting.delete(sid);
        logCall({ event: "waiting_dropped_stale", callSid: sid, caller: e.from, queue: e.queue });
      }
    }
  } catch (e) {
    logCall({ event: "waiting_sync_error", error: e instanceof Error ? e.message : String(e) });
  }
}


export function phoneLines() {
  const raw = String(process.env.TWILIO_LINES || "+14409011609=Línea 901-1609,+14406642795=Línea 664-2795");
  return raw.split(",").map((p) => p.split("=").map((x) => x.trim())).filter(([n]) => n).map(([number, label]) => ({ number, label: label || number, queue: lineQueue(number) }));
}
const twAuth = () => "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

/**
 * ring1: phones Twilio rings at the same time as the counter page (TWILIO_RING_NUMBERS, comma list, E.164),
 * e.g. the hidden Spectrum desk line +14405519249 (later the Cricket eSIM). Each is an outbound REST call whose
 * answer URL dials the caller's line queue — the same dequeue the counter page uses, so the first to answer wins.
 * Caller ID on those phones = the Twilio line that was called (Twilio only allows its own/verified numbers as
 * From on a REST call; the caller's number can't be passed through). The whisper says who is calling.
 */
export function ringNumbers(): string[] {
  const own = new Set(phoneLines().map((l) => d10(l.number)));
  return String(process.env.TWILIO_RING_NUMBERS || "").split(",").map((x) => x.trim()).filter(Boolean)
    .map((x) => (x.startsWith("+") ? x : `+1${d10(x)}`))
    .filter((x) => d10(x).length === 10 && !own.has(d10(x)) && !neverDial(x));
}
/** callerid1: the customer's own E.164 number for the ring legs, or "" (→ the Twilio line). Anonymous/restricted/
 *  invalid numbers, our own Twilio lines, the ring phones and the forwarded main lines are never passed. Once Twilio
 *  refuses it on a REST call, stop trying until the API restarts (so every ring isn't placed twice). */
let passCallerIdRefused: { code?: number; message: string; at: number } | null = null;
export function passCallerId(from: string): string {
  if (process.env.TWILIO_PASS_CALLER_ID === "0" || passCallerIdRefused) return "";
  const f = String(from || "").trim();
  if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(f)) return "";
  const n = d10(f);
  if (phoneLines().some((l) => d10(l.number) === n)) return "";
  if (String(process.env.TWILIO_RING_NUMBERS || "").split(",").map(d10).includes(n)) return "";
  if (neverDial(f)) return "";
  return f;
}
const ringTimeoutSec = () => Math.max(10, Math.min(60, Number(process.env.TWILIO_RING_TIMEOUT_SEC || 20)));
/** customer CallSid -> outbound ring legs still ringing (ring CallSid -> phone). */
const ringing = new Map<string, Map<string, string>>();
const ringStarting = new Set<string>();
const ringCanceled = new Set<string>();
/** fix26: desk legs answered and waiting for "1" (customer sid -> ring CallSids). Nothing is dequeued before the keypress. */
const deskAtPrompt = new Map<string, Set<string>>();
/** fix26: phones that answered without pressing 1 (carrier voicemail/announcement) — not re-rung for that caller. */
const ringNoAccept = new Map<string, Set<string>>();
/** fix26: counter tapped Contestar for this caller (customer sid -> ms). The counter always wins over the desk. */
const counterClaim = new Map<string, number>();
const DESK_ACCEPT_TEXT = "Oprima uno para contestar.";
// ---- ringsms1: one text per call to the staff mobiles at the first ring (TWILIO_RING_SMS=1 after A2P 10DLC). ----
const callFwd = new Map<string, string>(); // customer CallSid -> ForwardedFrom (289 / 551 main lines)
const smsSent = new Map<string, number>(); // customer CallSid -> ms (one text per call)
const smsByCaller = new Map<string, number>(); // caller d10 -> last text ms
const smsTimes: number[] = []; // texts in the last hour
const SMS_CALLER_GAP_MS = 2 * 60 * 1000, SMS_PER_HOUR = 30;
export function smsNumbers(): string[] {
  return String(process.env.TWILIO_SMS_NUMBERS || "").split(",").map((x) => x.trim()).filter((x) => /^\+1\d{10}$/.test(x));
}
const fmtUs = (p: string) => { const n = d10(p); return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : ""; };
/** "Carlos 11:50 AM (440) 413-9902 (línea 289)" — pure, used by the dry run. */
export function ringSmsText(o: { name?: string | null; from: string; at: number | Date; forwardedFrom?: string }): string {
  const time = new Date(o.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const num = /^\+1[2-9]\d{9}$/.test(String(o.from || "").trim()) ? fmtUs(o.from) : "Privado";
  const f = d10(o.forwardedFrom || "");
  const via = f.endsWith("2898504") ? " (línea 289)" : f.endsWith("5519122") ? " (línea 551)" : "";
  return `Cocina Elvis: ${(o.name || "").trim() || "Cliente"} ${time} ${num}${via}`;
}
async function sendRingSms(base: string, cust: Entry) {
  if (process.env.TWILIO_RING_SMS !== "1" || smsSent.has(cust.callSid)) return;
  const to = smsNumbers(); const account = process.env.TWILIO_ACCOUNT_SID;
  if (!to.length || !account || !process.env.TWILIO_AUTH_TOKEN) return;
  const now = Date.now();
  smsSent.set(cust.callSid, now);
  if (smsSent.size > 500) for (const [k, t] of smsSent) if (now - t > 6 * 3600_000) { smsSent.delete(k); callFwd.delete(k); }
  while (smsTimes.length && now - smsTimes[0] > 3600_000) smsTimes.shift();
  const key = d10(cust.from) || "privado";
  if (now - (smsByCaller.get(key) || 0) < SMS_CALLER_GAP_MS) { logCall({ event: "ring_sms_skipped", callSid: cust.callSid, reason: "caller-rate" }); return; }
  if (smsTimes.length + to.length > SMS_PER_HOUR) { logCall({ event: "ring_sms_skipped", callSid: cust.callSid, reason: "hour-cap" }); return; }
  smsByCaller.set(key, now);
  const body = ringSmsText({ name: cust.name, from: cust.from, at: cust.at || now, forwardedFrom: callFwd.get(cust.callSid) });
  const svc = String(process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim();
  const line = phoneLines().find((l) => d10(l.number) === d10(cust.line))?.number || phoneLines()[0]?.number || "";
  for (const n of to) {
    smsTimes.push(now);
    try {
      const params = new URLSearchParams({ To: n, Body: body });
      if (svc) params.set("MessagingServiceSid", svc); else params.set("From", line);
      if (/^https:\/\//.test(base)) params.set("StatusCallback", `${base}/api/twilio/sms-status?cust=${encodeURIComponent(cust.callSid)}`);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
        method: "POST", headers: { Authorization: twAuth(), "content-type": "application/x-www-form-urlencoded" }, body: params,
      });
      const j = await r.json().catch(() => ({})) as { sid?: string; status?: string; code?: number; message?: string };
      if (r.ok && j.sid) logCall({ event: "ring_sms", callSid: cust.callSid, to: n, messageSid: j.sid, status: j.status, body });
      else logCall({ event: "ring_sms_error", callSid: cust.callSid, to: n, status: r.status, code: j.code, error: String(j.message || "").slice(0, 200) });
    } catch (e) { logCall({ event: "ring_sms_error", callSid: cust.callSid, to: n, error: e instanceof Error ? e.message : String(e) }); }
  }
}
async function startRings(base: string, cust: Entry) {
  void sendRingSms(base, cust).catch(() => {}); // ringsms1: never blocks ringing
  const skip = ringNoAccept.get(cust.callSid);
  const nums = ringNumbers().filter((n) => !skip?.has(n));
  const account = process.env.TWILIO_ACCOUNT_SID;
  if (counterClaim.has(cust.callSid) || deskAtPrompt.get(cust.callSid)?.size) return;
  if (!nums.length || !account || !process.env.TWILIO_AUTH_TOKEN || !/^https:\/\//.test(base)) return;
  if (ringStarting.has(cust.callSid) || (ringing.get(cust.callSid)?.size || 0) > 0) return;
  ringStarting.add(cust.callSid);
  try {
    const twilioLine = phoneLines().find((l) => d10(l.number) === d10(cust.line))?.number || phoneLines()[0]?.number || "";
    // callerid1: show the real caller on the desk/iPhone (TWILIO_PASS_CALLER_ID=1). Falls back to the Twilio line.
    const passed = passCallerId(cust.from);
    const legs = ringing.get(cust.callSid) || new Map<string, string>();
    ringing.set(cust.callSid, legs);
    await Promise.all(nums.map(async (to) => {
      try {
        const place = (from: string) => fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls.json`, {
          method: "POST", headers: { Authorization: twAuth(), "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            To: to, From: from, Timeout: String(ringTimeoutSec()),
            Url: `${base}/api/twilio/ring-answer?cust=${encodeURIComponent(cust.callSid)}&q=${encodeURIComponent(cust.queue)}`, Method: "POST",
            StatusCallback: `${base}/api/twilio/ring-status?cust=${encodeURIComponent(cust.callSid)}`, StatusCallbackMethod: "POST",
          }),
        });
        let from = passed || twilioLine;
        let r = await place(from);
        let j = await r.json().catch(() => ({})) as { sid?: string; message?: string; code?: number };
        if (!(r.ok && j.sid) && passed) {
          // Twilio refuses a REST From that isn't ours/verified (e.g. 21210/21212): remember and use the Twilio line.
          passCallerIdRefused = { code: j.code, message: String(j.message || "").slice(0, 200), at: Date.now() };
          logCall({ event: "ring_callerid_refused", callSid: cust.callSid, ringTo: to, status: r.status, code: j.code, error: j.message || "" });
          from = twilioLine; r = await place(from); j = await r.json().catch(() => ({}));
        }
        if (r.ok && j.sid) { legs.set(j.sid, to); logCall({ event: "ring_start", callSid: cust.callSid, ringCallSid: j.sid, ringTo: to, callerId: from, callerIdPassed: from !== twilioLine }); }
        else logCall({ event: "ring_error", callSid: cust.callSid, ringTo: to, status: r.status, error: j.message || "" });
      } catch (e) { logCall({ event: "ring_error", callSid: cust.callSid, ringTo: to, error: e instanceof Error ? e.message : String(e) }); }
    }));
  } finally { ringStarting.delete(cust.callSid); }
}
/** Stop the other phones once someone answered (or the caller left). `keep` = the leg that answered. */
async function cancelRings(custSid: string, keep = "", reason = "") {
  const account = process.env.TWILIO_ACCOUNT_SID;
  // Desk legs already answered and sitting at "oprima 1": end them (canceled only works while ringing).
  for (const sid of [...(deskAtPrompt.get(custSid) || [])]) {
    if (sid === keep) continue;
    deskAtPrompt.get(custSid)?.delete(sid);
    ringCanceled.add(sid);
    try {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls/${sid}.json`, {
        method: "POST", headers: { Authorization: twAuth(), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ Status: "completed" }),
      });
      logCall({ event: "ring_cancel", callSid: custSid, ringCallSid: sid, reason: `${reason}-at-prompt` });
    } catch { /* gather times out on its own */ }
  }
  const legs = ringing.get(custSid);
  if (!legs?.size) return;
  for (const [sid, to] of [...legs]) {
    if (sid === keep) continue;
    legs.delete(sid);
    ringCanceled.add(sid);
    try {
      // canceled = stop a queued/ringing leg; it can't end an answered one (that one is the bridge).
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls/${sid}.json`, {
        method: "POST", headers: { Authorization: twAuth(), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ Status: "canceled" }),
      });
      logCall({ event: "ring_cancel", callSid: custSid, ringCallSid: sid, ringTo: to, reason });
    } catch { /* it stops on its own at the ring timeout */ }
  }
  if (!legs.size) ringing.delete(custSid);
}

/** Access token for the counter page (Voice JS SDK). Outgoing only: the page dials into a line's queue. */
export function voiceToken(identity = "counter", ttlSec = 4 * 3600) {
  const keySid = process.env.TWILIO_API_KEY_SID || "", secret = process.env.TWILIO_API_KEY_SECRET || "", app = process.env.TWILIO_TWIML_APP_SID || "";
  if (!keySid || !secret || !app) throw new Error("counter phone is not configured");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" });
  const body = b64({ jti: `${keySid}-${now}`, iss: keySid, sub: process.env.TWILIO_ACCOUNT_SID, iat: now, nbf: now, exp: now + ttlSec, grants: { identity, voice: { incoming: { allow: false }, outgoing: { application_sid: app } } } });
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

// The counter page is reachable on this Mac (localhost) or, through the tunnel, with the PIN.
const pinFails: number[] = [];
function isLocal(req: express.Request) {
  const host = String(req.headers.host || "").split(":")[0];
  const viaTunnel = req.headers["cf-connecting-ip"] || req.headers["cf-ray"] || req.headers["x-forwarded-for"];
  return !viaTunnel && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);
}
const phoneAuth: express.RequestHandler = (req, res, next) => {
  if (isLocal(req)) return next();
  const want = String(process.env.PHONE_PIN || "");
  const got = String(req.headers["x-phone-pin"] || req.body?.pin || "");
  const now = Date.now();
  while (pinFails.length && now - pinFails[0] > 10 * 60 * 1000) pinFails.shift();
  if (pinFails.length >= 10) return res.status(429).json({ error: "Demasiados intentos. Espere 10 minutos." });
  const ok = !!want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) { pinFails.push(now); return res.status(401).json({ error: "PIN incorrecto." }); }
  next();
};

function prune() {
  const now = Date.now();
  for (const [k, t] of counterClaim) if (now - t > 30 * 60 * 1000) { counterClaim.delete(k); ringNoAccept.delete(k); deskAtPrompt.delete(k); }
  for (const [k, e] of waiting) if (now - e.lastSeen > 6 * 60 * 1000) waiting.delete(k);
  for (const [k, e] of held) if (now - e.lastSeen > 15 * 60 * 1000) held.delete(k);
  for (const [k, e] of active) if (now - e.since > 3 * 3600 * 1000) active.delete(k);
  for (const [k, s] of segments) if (now - s.at > 6 * 3600 * 1000) segments.delete(k);
}

type Describe = (cart: any[]) => Promise<Array<{ name: string; quantity: number; choices: string[]; totalCents: number }>>;
export function registerTwilioRoutes(app: express.Express, shadowOrder: ShadowFn, findName: NameLookup = async () => null, describe: Describe = async () => []) {
  const form = express.urlencoded({ extended: false });
  const json = express.json({ limit: "20kb" });
  const guard: express.RequestHandler = (req, res, next) => {
    if (process.env.TWILIO_SKIP_SIGNATURE !== "1" && !validSignature(req)) return res.status(403).send("bad signature");
    next();
  };
  const baseOf = (req: express.Request) => {
    const b = publicUrl(req).replace(/\/api\/twilio\/.*$/, "");
    if (/^https:\/\//.test(b)) lastBase = b;
    return b;
  };

  // Public: Twilio <Play> fetches cloned-voice MP3s (safe filename only).
  app.get("/api/twilio/prompts/:file", (req, res) => {
    const m = /^([a-z0-9_-]+)\.mp3$/i.exec(String(req.params.file || ""));
    if (!m) return res.status(400).end();
    const file = promptFile(m[1]);
    if (!file) return res.status(404).end();
    res.type("audio/mpeg").sendFile(file);
  });

  /** Hold loop (~18 s music + message). Waiting hold: message + "For English, press 2" / "Para español, oprima 1"
   *  inside a DTMF Gather (Gather is allowed in an Enqueue waitUrl); the loop then re-requests /hold as before. */
  const holdTwiml = (base: string, lang: Lang, isHeld: boolean) => {
    const music = HOLD_MUSIC || (promptFile("hold-music-loop") ? `${base}/api/twilio/prompts/hold-music-loop.mp3` : HOLD_MUSIC_DEFAULT);
    const msg = playOrSay(base, lang, (isHeld ? HELD_TEXT : HOLD_TEXT)[lang], isHeld ? `held-${lang}` : `hold-${lang}`);
    if (isHeld) return `${msg}<Play>${xmlEscape(music)}</Play>`;
    const sw = HOLD_SWITCH[lang];
    return `<Gather input="dtmf" numDigits="1" timeout="1" action="${base}/api/twilio/hold-key?lang=${lang}" method="POST">${msg}${playOrSay(base, sw.voice, sw.text, sw.key)}<Play>${xmlEscape(music)}</Play></Gather>`;
  };

  const voicemailXml = (base: string, lang: Lang) =>
    `${playOrSay(base, lang, VOICEMAIL_TEXT[lang], `voicemail-${lang}`)}<Record maxLength="120" timeout="6" playBeep="true" finishOnKey="#" action="${base}/api/twilio/voicemail-done?lang=${lang}" method="POST" recordingStatusCallback="${base}/api/twilio/voicemail" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"/>`;

  /** After the notice: into the line's queue (hold audio), or voicemail when nobody is at the counter. */
  const queueOrVoicemail = (base: string, sid: string, from: string, to: string, lang: Lang, name: string | null) => {
    const queue = lineQueue(to);
    // Always enqueue so /phone.html can ring both lines. If the counter is truly gone, the hold
    // loop Leaves to voicemail after a few seconds (covers tsx reloads that wipe in-memory presence).
    const now = Date.now();
    const online = agentOnline();
    waiting.set(sid, { callSid: sid, from, name, line: to, queue, language: lang, training: isTrainingCaller(from), at: now, lastSeen: now });
    if (sid) { callNames.set(sid, name); if (to) callLines.set(sid, to); }
    logCall({ event: online ? "queued" : "queued_soft_offline", callSid: sid, caller: from, line: to, queue, agentAgeMs: agentAgeMs() });
    return `<Enqueue action="${base}/api/twilio/queue-done" method="POST" waitUrl="${base}/api/twilio/hold?lang=${lang}" waitUrlMethod="POST">${xmlEscape(queue)}</Enqueue>`;
  };

  // Repeat caller with a language heard before: greet them (by first name if Square or Carlos knows it) and queue.
  // Otherwise: short greeting, then listen up to ~2 s to hear which language the caller uses.
  app.post("/api/twilio/voice", form, guard, async (req, res) => {
    const base = baseOf(req);
    const from = String(req.body?.From || "");
    // ring1 loop guard: a call FROM one of our own Twilio lines is our ring leg coming back (e.g. the desk line got
    // forwarded to Twilio too). Reject so it never queues behind itself.
    // callerid1: ring legs may now carry the CUSTOMER's number as From, so also reject a call diverted from one of
    // the ring phones (desk/iPhone forwarded back to Twilio), or the same number arriving while its own ring legs ring.
    const fwdFrom = String(req.body?.ForwardedFrom || "");
    if (fwdFrom && req.body?.CallSid) callFwd.set(String(req.body.CallSid), fwdFrom); // ringsms1: "(línea 289/551)"
    // line1: persist on every customer call ("" = direct dial) so the console call log can show 289 / 551 / Twilio 1609.
    if (req.body?.CallSid) logCall({ event: "forwarded", callSid: String(req.body.CallSid), caller: from, calledNumber: req.body?.To, forwardedFrom: fwdFrom });
    const ringSet = new Set(String(process.env.TWILIO_RING_NUMBERS || "").split(",").map(d10).filter(Boolean));
    const echo = [...waiting.values()].some((e) => d10(e.from) === d10(from) && (ringing.get(e.callSid)?.size || 0) > 0);
    if (phoneLines().some((l) => d10(l.number) === d10(from)) || (fwdFrom && ringSet.has(d10(fwdFrom))) || (d10(from) && ringSet.has(d10(from))) || echo) {
      logCall({ event: "loop_rejected", callSid: req.body?.CallSid, caller: from, calledNumber: req.body?.To });
      return res.type("text/xml").send(xml(`<Reject reason="busy"/>`));
    }
    const sid = String(req.body?.CallSid || "");
    const to = String(req.body?.To || "");
    if (sid) {
      callers.set(sid, from);
      if (!callStartedAt.has(sid)) callStartedAt.set(sid, new Date().toISOString());
      const toNum = String(req.body?.To || "");
      if (toNum) callLines.set(sid, toNum);
    }
    prune();
    let k: ReturnType<typeof knownCaller> = { known: false, language: undefined, manualName: undefined };
    try { k = knownCaller(from, sid); } catch { /* normal greeting */ }
    const namePromise = callerName(from, findName, 900).catch(() => null); // also warms the cache for /lang
    const closedSt = closedState(from);
    if (closedSt) {
      // closed1/afterhours1: no queue, no rings, no counter page. Logged so the console call log shows "Cerrado".
      const lang = k.known && k.language ? k.language : undefined;
      logCall({ event: "incoming", callSid: sid, caller: from, calledNumber: to, greeting: "closed", knownLanguage: lang, flow: "closed" });
      logCall({ event: "closed", callSid: sid, caller: from, calledNumber: to, language: lang || "es+en", weekday: etWeekday(), reason: closedSt.kind, variant: closedSt.variant });
      void namePromise.then((n) => { if (n && sid) logCall({ event: "caller_name", callSid: sid, caller: from, name: n }); }).catch(() => {});
      return res.type("text/xml").send(xml(closedTwiml(base, lang, closedSt)));
    }
    rememberCaller(from, {});
    void namePromise.then((n) => { if (n && sid) logCall({ event: "caller_name", callSid: sid, caller: from, name: n }); }).catch(() => {});
    if (k.known && k.language) {
      const name = await namePromise;
      logCall({ event: "incoming", callSid: sid, caller: from, calledNumber: to, greeting: "returning", knownLanguage: k.language, named: !!name, flow: "counter" });
      logCall({ event: "language", callSid: sid, caller: from, heard: "", language: k.language, from: "saved" });
      if (sid) callLang.set(sid, k.language);
      return res.type("text/xml").send(xml(`${await noticeLine(k.language, { name, returning: true, voicemail: false, base })}${queueOrVoicemail(base, sid, from, to, k.language, name)}`));
    }
    logCall({ event: "incoming", callSid: sid, caller: from, calledNumber: to, greeting: k.known ? "returning-unknown-language" : "new", flow: "counter" });
    res.type("text/xml").send(xml(`${playOrSay(base, "es", "Cocina Elvis", "opening-es")}
  <Gather input="speech" speechTimeout="auto" timeout="1" language="es-MX" hints="hola,hello,hi,buenas,bueno" action="${base}/api/twilio/lang" method="POST" actionOnEmptyResult="true"/>
  <Redirect method="POST">${base}/api/twilio/lang</Redirect>`));
  });

  app.post("/api/twilio/lang", form, guard, async (req, res) => {
    const base = baseOf(req);
    const to = String(req.body?.To || "");
    const from = String(req.body?.From || "");
    const sid = String(req.body?.CallSid || "");
    const heard = String(req.body?.SpeechResult || "");
    const language = detectCallerLanguage(heard);
    if (sid) callLang.set(sid, language);
    logCall({ event: "language", callSid: sid, caller: from, heard, confidence: req.body?.Confidence, language });
    try { rememberCaller(from, { language, heardSpeech: !!heard.trim() }); } catch { /* best effort */ }
    let returning = false, name: string | null = null;
    try { returning = knownCaller(from, sid).known; name = await callerName(from, findName, 900); } catch { /* plain notice */ }
    if (name && sid) logCall({ event: "caller_name", callSid: sid, caller: from, name });
    res.type("text/xml").send(xml(`${await noticeLine(language, { name, returning, voicemail: false, base })}${queueOrVoicemail(base, sid, from, to, language, name)}`));
  });

  // Hold loop (Enqueue waitUrl, re-requested after each loop): message in the caller's language, then music.
  // Leaves the queue for voicemail when nobody is at the counter any more, or after the max wait.
  app.post("/api/twilio/hold", form, guard, async (req, res) => {
    const base = baseOf(req);
    const lang: Lang = req.query.lang === "en" ? "en" : "es";
    const sid = String(req.body?.CallSid || "");
    const queueTime = Number(req.body?.QueueTime || 0);
    const isHeld = req.query.held === "1";
    // Resurrect in-memory row if the API restarted mid-hold (Contestar would otherwise vanish).
    if (!isHeld && sid && !waiting.has(sid) && !held.has(sid)) {
      let qName = String(req.body?.QueueName || "");
      const qSid = String(req.body?.QueueSid || "");
      // waitUrl sends QueueSid, not the friendly name — resolve when needed.
      if (!qName && qSid && process.env.TWILIO_ACCOUNT_SID) {
        try {
          const qr = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Queues/${qSid}.json`, { headers: { Authorization: twAuth() } });
          if (qr.ok) qName = String(((await qr.json()) as { friendly_name?: string }).friendly_name || "");
        } catch { /* sync on next poll */ }
      }
      const matched = phoneLines().find((l) => l.queue === qName);
      resurrectWaiter(sid, req.body || {}, matched?.queue || qName || "line-main", lang);
      const w = waiting.get(sid);
      if (w && matched) { w.line = matched.number; w.queue = matched.queue; }
    }
    const e = (isHeld ? held : waiting).get(sid);
    if (e) e.lastSeen = Date.now();
    const tooLong = queueTime > (isHeld ? maxHeldSec() : maxWaitSec());
    // ring1: desk phone(s) ring with the counter page; re-ring after a ring leg times out while the caller still waits.
    // fix26: phones that answered without pressing 1 (carrier voicemail) don't count — fall back to the old no-counter rule.
    const rings = !isHeld && ringNumbers().filter((n) => !ringNoAccept.get(sid)?.has(n)).length > 0;
    if (rings && e && !tooLong) void startRings(base, e);
    if (tooLong || (!rings && !agentOnline() && queueTime > 8)) {
      logCall({ event: "leave_queue", callSid: sid, caller: e?.from || req.body?.From, reason: tooLong ? "max_wait" : "no_agent", queueTime, agentAgeMs: agentAgeMs() });
      return res.type("text/xml").send(xml("<Leave/>"));
    }
    res.type("text/xml").send(xml(holdTwiml(base, isHeld ? lang : (e?.language || callLang.get(sid) || lang), isHeld)));
  });

  // intro2: keypress during the waiting hold → switch this call's language (hold audio, counter tag, Elvi scoring).
  app.post("/api/twilio/hold-key", form, guard, (req, res) => {
    const base = baseOf(req);
    const sid = String(req.body?.CallSid || "");
    const digit = String(req.body?.Digits || "");
    const e = waiting.get(sid);
    const before: Lang = e?.language || callLang.get(sid) || (req.query.lang === "en" ? "en" : "es");
    const lang: Lang = digit === "2" ? "en" : digit === "1" ? "es" : before;
    if (lang !== before) {
      if (sid) callLang.set(sid, lang);
      if (e) e.language = lang;
      logCall({ event: "language_switch", callSid: sid, caller: e?.from || req.body?.From, from: before, to: lang, digit });
      try { rememberCaller(e?.from || String(req.body?.From || ""), { language: lang, heardSpeech: true }); } catch { /* best effort */ }
    }
    // Still inside the Enqueue wait: returning wait-safe TwiML keeps the caller in the queue.
    res.type("text/xml").send(xml(holdTwiml(base, lang, false)));
  });

  // Enqueue action: the caller left the queue (bridged call ended, hung up, or Leave -> voicemail).
  app.post("/api/twilio/queue-done", form, guard, (req, res) => {
    const base = baseOf(req);
    const sid = String(req.body?.CallSid || "");
    const result = String(req.body?.QueueResult || "");
    const e = waiting.get(sid) || held.get(sid);
    waiting.delete(sid); held.delete(sid);
    void cancelRings(sid, "", `queue-${result || "done"}`);
    const lang: Lang = e?.language || callLang.get(sid) || "es";
    logCall({ event: "queue_result", callSid: sid, caller: e?.from || req.body?.From, result, queueTime: req.body?.QueueTime });
    if (/^(leave|queue-full|error|system-error)$/.test(result)) return res.type("text/xml").send(xml(voicemailXml(base, lang)));
    if (result === "hangup" && !talk.has(sid)) logCall({ event: "missed", callSid: sid, caller: e?.from || req.body?.From, dialStatus: "hung-up-waiting", durationSec: 0 });
    res.type("text/xml").send(xml("<Hangup/>"));
  });

  // Counter page dials in (TwiML App Voice URL). Param "queue": a line queue (front caller) or "hold-<CallSid>".
  // The whisper is said on the counter's own leg before the bridge, so the customer never hears it.
  app.post("/api/twilio/agent", form, guard, async (req, res) => {
    const base = baseOf(req);
    touchAgent("agent-dial");
    const queue = String(req.body?.queue || "");
    const agentSid = String(req.body?.CallSid || "");
    const lines = phoneLines().map((l) => l.queue);
    const heldSid = /^hold-(CA[0-9a-f]{32})$/.exec(queue)?.[1];
    // Rare staff errors: Polly is OK (customer never hears these).
    if (!lines.includes(queue) && !heldSid) return res.type("text/xml").send(xml(`${sayIn("es", "Línea no válida.")}<Hangup/>`));
    const target = heldSid ? held.get(heldSid) : [...waiting.values()].filter((e) => e.queue === queue).sort((a, b) => a.at - b.at)[0];
    if (!target) {
      logCall({ event: "counter_no_target", agentCallSid: agentSid, queue });
      return res.type("text/xml").send(xml(`${sayIn("es", "No hay llamadas en espera en esta línea.")}<Hangup/>`));
    }
    // fix26: the counter tap wins — stop the desk ring (and any desk leg waiting for "1") before dequeuing.
    counterClaim.set(target.callSid, Date.now());
    void cancelRings(target.callSid, "", "counter-tap");
    logCall({ event: "counter_tap", callSid: target.callSid, agentCallSid: agentSid, queue });
    active.set(agentSid, { ...target, agentSid, since: Date.now() });
    let whisper = "";
    if (target.name && !heldSid) {
      const wkey = `whisper-es-${promptSlug(target.name)}`;
      whisper = await playCloned(base, "es", `Llamada de ${target.name}.`, wkey, wkey);
      // If generate timed out and no cache, skip whisper (silence) rather than Polly on the staff leg.
      if (whisper.startsWith("<Say")) whisper = "";
    }
    logCall({ event: "whisper", callSid: target.callSid, played: !!whisper, via: "counter" });
    res.type("text/xml").send(xml(`${whisper}<Dial timeout="30" record="record-from-answer-dual" recordingStatusCallback="${base}/api/twilio/recording?leg=queue" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" action="${base}/api/twilio/agent-done" method="POST"><Queue url="${base}/api/twilio/bridge" method="POST">${xmlEscape(queue)}</Queue></Dial>`));
  });

  // Queue url: runs on the customer's side right before the bridge. Confirms who was really dequeued.
  app.post("/api/twilio/bridge", form, guard, (req, res) => {
    const cust = String(req.body?.CallSid || ""), agent = String(req.body?.DequeingCallSid || "");
    const e = waiting.get(cust) || held.get(cust) || active.get(agent);
    waiting.delete(cust); held.delete(cust);
    if (e && agent) active.set(agent, { ...e, callSid: cust, agentSid: agent, since: Date.now(), heldAt: undefined });
    void cancelRings(cust, agent, "answered");
    logCall({ event: "bridged", callSid: cust, caller: e?.from || req.body?.From, agentCallSid: agent, queueTime: req.body?.QueueTime });
    if (cust) {
      const nm = e?.name ?? callNames.get(cust) ?? null;
      callNames.set(cust, nm);
      if (!callStartedAt.has(cust) && e?.at) callStartedAt.set(cust, new Date(e.at).toISOString());
      const called = callLines.get(cust) || e?.line || "";
      if (called) callLines.set(cust, called);
      void upsertTicket({
        callSid: cust, at: callStartedAt.get(cust) || (e?.at ? new Date(e.at).toISOString() : new Date().toISOString()),
        caller: e?.from || String(req.body?.From || ""),
        name: nm, receiptCode: receiptCode(cust), language: e?.language || callLang.get(cust) || "es",
        phase: "listening", lines: [], training: !!e?.training,
        source: elviPhoneSource(called), phoneDisplay: formatTicketPhone(e?.from || String(req.body?.From || "")),
        fulfillment: "TO GO / LLEVAR",
      }, describe);
    }
    res.type("text/xml").send(xml(""));
  });

  // Dial action on the counter's leg: the bridge ended (hang up, or the customer was put on hold).
  app.post("/api/twilio/agent-done", form, guard, (req, res) => {
    const agent = String(req.body?.CallSid || "");
    const a = active.get(agent);
    active.delete(agent);
    if (a) {
      // fix20: DialCallDuration/Status are sometimes empty on Queue bridges; fall back to time since we bridged.
      const dialSec = Number(req.body?.DialCallDuration) || 0;
      const elapsed = a.since ? Math.max(0, Math.round((Date.now() - a.since) / 1000)) : 0;
      const sec = (talk.get(a.callSid) || 0) + (dialSec || elapsed);
      talk.set(a.callSid, sec);
      const status = String(req.body?.DialCallStatus || "") || (sec > 0 ? "completed" : "");
      // No bridge (caller already gone / taken by another counter tab) is not a missed call: the queue result decides that.
      if (status === "completed" || status === "answered" || sec > 0) logCall({ event: "answered", callSid: a.callSid, caller: a.from, dialStatus: status || "completed", durationSec: sec, via: req.query.via === "desk" ? "desk" : "counter" });
      else logCall({ event: "agent_no_bridge", callSid: a.callSid, agentCallSid: agent, dialStatus: status });
    }
    res.type("text/xml").send(xml("<Hangup/>"));
  });

  // ring1: a desk/eSIM phone answered its ring leg. Same as the counter: whisper on this leg, then dial the line queue
  // (first to dequeue gets the caller), dual-channel recording, 30 s Dial timeout.
  app.post("/api/twilio/ring-answer", form, guard, async (req, res) => {
    // fix26: a desk leg was answered — by a person OR by a carrier voicemail/announcement (Oct 18: Spectrum's
    // "voicemail has not yet been activated" answered in ~1 s and took the caller). Nothing is dequeued here:
    // whisper + "Oprima uno para contestar", and only a "1" (/ring-accept) dials the line queue.
    const base = baseOf(req);
    const ringSid = String(req.body?.CallSid || "");
    const custSid = String(req.query.cust || "");
    const qParam = String(req.query.q || "");
    ringing.get(custSid)?.delete(ringSid);
    const orig = waiting.get(custSid);
    if (!orig || counterClaim.has(custSid)) {
      logCall({ event: "ring_answer_empty", callSid: custSid, ringCallSid: ringSid, counterClaimed: counterClaim.has(custSid) });
      return res.type("text/xml").send(xml(`${sayIn("es", "Ya contestaron esta llamada.")}<Hangup/>`));
    }
    if (!deskAtPrompt.has(custSid)) deskAtPrompt.set(custSid, new Set());
    deskAtPrompt.get(custSid)!.add(ringSid);
    let whisper = "";
    if (orig.name) {
      const wkey = `whisper-es-${promptSlug(orig.name)}`;
      whisper = await playCloned(base, "es", `Llamada de ${orig.name}.`, wkey, wkey);
      if (whisper.startsWith("<Say")) whisper = "";
    }
    const action = `${base}/api/twilio/ring-accept?cust=${encodeURIComponent(custSid)}&amp;q=${encodeURIComponent(qParam || orig.queue)}`;
    // autoconnect1: TWILIO_PRESS1=0 → whisper "Llamada de {name}" (or "Llamada de Cocina Elvis") then connect, no keypress.
    // Carrier voicemail protection = short ring timeout (TWILIO_RING_TIMEOUT_SEC). Counter tap still wins in /ring-accept.
    if (process.env.TWILIO_PRESS1 === "0") {
      if (!whisper) { whisper = await playCloned(base, "es", "Llamada de Cocina Elvis.", "whisper-es-generic", "whisper-es-generic"); if (whisper.startsWith("<Say")) whisper = ""; }
      logCall({ event: "ring_answered", callSid: custSid, ringCallSid: ringSid, ringTo: req.body?.To, whisper: !!whisper, auto: true });
      return res.type("text/xml").send(xml(`${whisper || sayIn("es", "Llamada de Cocina Elvis.")}<Redirect method="POST">${action}&amp;auto=1</Redirect>`));
    }
    const accept = await playCloned(base, "es", DESK_ACCEPT_TEXT, "desk-accept-es", "desk-accept-es");
    logCall({ event: "ring_answered", callSid: custSid, ringCallSid: ringSid, ringTo: req.body?.To, whisper: !!whisper });
    res.type("text/xml").send(xml(`<Gather input="dtmf" numDigits="1" timeout="6" action="${action}" method="POST">${whisper}${accept}${accept}</Gather><Redirect method="POST">${action}</Redirect>`));
  });
  // fix26: desk pressed a key (or the prompt timed out). Only "1" from a person takes the caller, and never after a counter tap.
  app.post("/api/twilio/ring-accept", form, guard, async (req, res) => {
    const base = baseOf(req);
    const ringSid = String(req.body?.CallSid || "");
    const custSid = String(req.query.cust || "");
    const qParam = String(req.query.q || "");
    const digits = req.query.auto === "1" && process.env.TWILIO_PRESS1 === "0" ? "1" : String(req.body?.Digits || ""); // autoconnect1
    deskAtPrompt.get(custSid)?.delete(ringSid);
    if (digits !== "1") {
      // No "1": a machine/announcement (or staff ignored it). Don't ring that phone again for this caller.
      const to = String(req.body?.To || "");
      if (to) { if (!ringNoAccept.has(custSid)) ringNoAccept.set(custSid, new Set()); ringNoAccept.get(custSid)!.add(to); }
      logCall({ event: "ring_not_accepted", callSid: custSid, ringCallSid: ringSid, ringTo: to, digits });
      return res.type("text/xml").send(xml("<Hangup/>"));
    }
    const queue = waiting.get(custSid)?.queue || (phoneLines().some((l) => l.queue === qParam) ? qParam : "");
    const target = queue ? [...waiting.values()].filter((x) => x.queue === queue).sort((a, b) => a.at - b.at)[0] : undefined;
    const claimed = counterClaim.has(custSid) || (target ? counterClaim.has(target.callSid) : false);
    if (!target || claimed) {
      logCall({ event: "ring_accept_late", callSid: custSid, ringCallSid: ringSid, counterClaimed: claimed });
      return res.type("text/xml").send(xml(`${sayIn("es", claimed ? "Ya contestaron en el mostrador." : "Ya contestaron esta llamada.")}<Hangup/>`));
    }
    active.set(ringSid, { ...target, agentSid: ringSid, since: Date.now() });
    logCall({ event: "whisper", callSid: target.callSid, played: true, via: "desk", ringCallSid: ringSid, ringTo: req.body?.To, accepted: true });
    res.type("text/xml").send(xml(`<Dial timeout="30" record="record-from-answer-dual" recordingStatusCallback="${base}/api/twilio/recording?leg=queue" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" action="${base}/api/twilio/agent-done?via=desk" method="POST"><Queue url="${base}/api/twilio/bridge" method="POST">${xmlEscape(queue)}</Queue></Dial>`));
  });
  // Ring leg finished (no-answer / busy / canceled / completed). The hold loop re-rings while the caller still waits.
  // ringsms1: delivery status of the ring-time texts (queued/sent/delivered/undelivered/failed + ErrorCode, e.g. 30034).
  app.post("/api/twilio/sms-status", form, guard, (req, res) => {
    const st = String(req.body?.MessageStatus || "");
    logCall({ event: ["failed", "undelivered"].includes(st) ? "ring_sms_error" : "ring_sms_status", callSid: String(req.query.cust || ""), messageSid: req.body?.MessageSid, to: req.body?.To, status: st, code: req.body?.ErrorCode || undefined });
    res.type("text/xml").send(xml(""));
  });
  app.post("/api/twilio/ring-status", form, guard, (req, res) => {
    const ringSid = String(req.body?.CallSid || "");
    const custSid = String(req.query.cust || "");
    const legs = ringing.get(custSid);
    legs?.delete(ringSid);
    if (legs && !legs.size) ringing.delete(custSid);
    deskAtPrompt.get(custSid)?.delete(ringSid);
    const ours = ringCanceled.delete(ringSid);
    logCall({ event: "ring_end", callSid: custSid, ringCallSid: ringSid, ringTo: req.body?.To, status: req.body?.CallStatus, canceledByUs: ours, durationSec: req.body?.CallDuration });
    res.sendStatus(204);
  });

  // Staff "En espera": move the customer into their own hold queue (hold audio), which ends the counter leg.
  app.post("/api/phone/hold", json, phoneAuth, async (req, res) => {
    const a = active.get(String(req.body?.agentCallSid || ""));
    if (!a) return res.status(404).json({ error: "No hay llamada activa." });
    if (!lastBase) return res.status(503).json({ error: "Sin URL pública todavía." });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Calls/${a.callSid}.json`, {
      method: "POST", headers: { Authorization: twAuth(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Url: `${lastBase}/api/twilio/rehold?lang=${a.language}`, Method: "POST" })
    });
    if (!r.ok) return res.status(502).json({ error: `Twilio ${r.status}` });
    const now = Date.now();
    held.set(a.callSid, { ...a, queue: `hold-${a.callSid}`, heldAt: now, lastSeen: now });
    logCall({ event: "hold", callSid: a.callSid, caller: a.from });
    res.json({ ok: true, queue: `hold-${a.callSid}` });
  });
  app.post("/api/twilio/rehold", form, guard, (req, res) => {
    const base = baseOf(req);
    const sid = String(req.body?.CallSid || "");
    const lang: Lang = req.query.lang === "en" ? "en" : "es";
    res.type("text/xml").send(xml(`<Enqueue action="${base}/api/twilio/queue-done" method="POST" waitUrl="${base}/api/twilio/hold?lang=${lang}&amp;held=1" waitUrlMethod="POST">hold-${xmlEscape(sid)}</Enqueue>`));
  });

  // fix26: counter page reports device problems (token expired, connect errors) so a failed tap leaves a trace.
  app.post("/api/phone/client-event", json, phoneAuth, (req, res) => {
    const b = req.body || {};
    logCall({ event: "counter_client", kind: String(b.kind || "").slice(0, 40), code: b.code != null ? String(b.code).slice(0, 20) : undefined, message: String(b.message || "").slice(0, 300), queue: String(b.queue || "").slice(0, 40) });
    res.json({ ok: true });
  });
  void ensurePrompt("es", DESK_ACCEPT_TEXT, "desk-accept-es", 8000).catch(() => {});
  void ensurePrompt("es", "Llamada de Cocina Elvis.", "whisper-es-generic", 8000).catch(() => {}); // autoconnect1

  // ---- counter page API ----
  app.post("/api/phone/token", json, phoneAuth, (_req, res) => {
    try { touchAgent("token"); res.json({ token: voiceToken("counter"), ttlSec: 4 * 3600 }); }
    catch (e) { res.status(503).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  app.get("/api/phone/state", phoneAuth, async (req, res) => {
    if (req.query.ready === "1") touchAgent("poll"); // heartbeat: a counter page with a working phone is open
    void linkSquareTickets().catch(() => {});
    prune();
    // Best-effort reconcile with Twilio so Contestar survives API restarts mid-hold.
    if (req.query.ready === "1") {
      try { await Promise.race([syncWaitingFromTwilio(), new Promise((r) => setTimeout(r, 800))]); } catch { /* ignore */ }
    }
    const now = Date.now();
    const view = (e: Entry) => ({ callSid: e.callSid, from: e.from, name: e.name, line: e.line, language: e.language, training: e.training, waitingSec: Math.round((now - (e.heldAt || e.at)) / 1000), delivery: deliveryView(e.from, e.callSid) });
    res.json({
      online: agentOnline(),
      agentAgeMs: agentAgeMs(),
      ringPhones: ringNumbers().length,
      deskRinging: [...ringing.entries()].filter(([, l]) => l.size).map(([sid]) => sid),
      agentGraceMs: agentGraceMs(),
      maxWaitSec: maxWaitSec(),
      maxHeldSec: maxHeldSec(),
      lines: phoneLines().map((l) => ({ ...l, waiting: [...waiting.values()].filter((e) => e.queue === l.queue).sort((a, b) => a.at - b.at).map(view) })),
      held: [...held.values()].map((e) => ({ ...view(e), queue: e.queue })),
      active: [...active.values()].map((a) => ({ ...view(a), agentCallSid: a.agentSid, talkSec: Math.round((now - a.since) / 1000) })),
      voicemails: recentVoicemails(),
      tickets: recentTickets(10),
      activeTicket: [...active.values()].map((a) => ticketsByCall.get(a.callSid)).find(Boolean) || null
    });
  });
  // calllog1: every incoming call (not only voicemails), grouped by ET day on the page.
  const statusFile = path.join(logDir, "call-status.json");
  const loadStatuses = (): Record<string, TwilioStatus> => { try { return JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch { return {}; } };
  app.get("/api/phone/calls", phoneAuth, async (req, res) => {
    const range: CallLogRange = req.query.range === "yesterday" ? "yesterday" : req.query.range === "7d" ? "7d" : "today";
    const days = rangeDays(range);
    const events = readCallEvents(logDir, days);
    const statuses = loadStatuses();
    const build = () => buildCallLog(events, {
      days, statuses, isTraining: (p) => isTrainingCaller(p),
      hasTicket: (sid) => ticketsByCall.has(sid),
      ticketName: (sid) => ticketsByCall.get(sid)?.name || callNames.get(sid) || null,
    });
    let rows = build();
    // Reconcile calls whose end was never logged (Mac restarted mid-call): read-only Twilio call status.
    const stale = rows.filter((r) => r.outcome === "unknown" || (r.outcome === "in_progress" && Date.now() - Date.parse(r.at) > 3 * 60 * 1000))
      .filter((r) => !statuses[r.callSid] || (/^(queued|ringing|in-progress)$/.test(statuses[r.callSid].status) && Date.now() - statuses[r.callSid].checkedAt > 60000))
      .slice(0, 10);
    if (stale.length && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const account = process.env.TWILIO_ACCOUNT_SID;
      await Promise.race([Promise.all(stale.map(async (r) => {
        try {
          const tr = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls/${r.callSid}.json`, { headers: { Authorization: twAuth() } });
          if (!tr.ok) return;
          const j = await tr.json() as { status?: string; duration?: string | null };
          statuses[r.callSid] = { status: String(j.status || ""), duration: j.duration != null ? Number(j.duration) : null, checkedAt: Date.now() };
        } catch { /* try next time */ }
      })), new Promise((r) => setTimeout(r, 2500))]);
      try { fs.writeFileSync(statusFile, JSON.stringify(statuses, null, 1)); } catch { /* best effort */ }
      rows = build();
    }
    // Names: log/ticket first; otherwise the same lookup the whisper uses (Square read-only + manual names), cached.
    const unnamed = [...new Set(rows.filter((r) => !r.name && r.number).map((r) => r.number))].slice(0, 25);
    if (unnamed.length) {
      const found = new Map<string, string | null>();
      await Promise.all(unnamed.map(async (n) => { try { found.set(n, await callerName(n, findName, 700)); } catch { found.set(n, null); } }));
      for (const r of rows) if (!r.name && found.get(r.number)) r.name = found.get(r.number)!;
    }
    void linkSquareTickets().catch(() => {});
    const links = loadSquareLinks();
    res.json({ range, days, summary: summarize(rows), rows: rows.map((r) => ({ ...r, square: links[r.callSid] || null })) });
  });

  app.get("/api/phone/voicemail/:sid", phoneAuth, (req, res) => {
    const sid = String(req.params.sid || "");
    if (!/^RE[0-9a-f]{32}$/.test(sid)) return res.status(400).end();
    const file = path.join(callsDir, `${sid}.wav`);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.type("audio/wav").sendFile(file);
  });
  app.get("/api/phone/tickets", phoneAuth, (_req, res) => {
    res.json({ tickets: recentTickets(10), activeTicket: [...active.values()].map((a) => ticketsByCall.get(a.callSid)).find(Boolean) || null });
  });

  // ---- voicemail ----
  app.post("/api/twilio/voicemail-done", form, guard, (req, res) => {
    const lang: Lang = req.query.lang === "en" ? "en" : "es";
    const thanks = lang === "en" ? "Thank you, we'll call you back soon. Goodbye." : "Gracias, le regresamos la llamada pronto. Hasta luego.";
    res.type("text/xml").send(xml(`${playOrSay(baseOf(req), lang, thanks, `voicemail-thanks-${lang}`)}<Hangup/>`));
  });
  app.post("/api/twilio/voicemail", form, guard, (req, res) => {
    res.sendStatus(204);
    const { RecordingUrl, RecordingSid, CallSid, RecordingDuration } = req.body || {};
    if (!RecordingUrl || !RecordingSid) return;
    const caller = callers.get(CallSid) || req.body?.From || "";
    (async () => {
      try {
        const buf = await download(`${RecordingUrl}.wav`);
        fs.mkdirSync(callsDir, { recursive: true });
        const file = path.join(callsDir, `${RecordingSid}.wav`);
        fs.writeFileSync(file, buf);
        const { text, language } = await sttWords(buf);
        const lang: Lang = callLang.get(CallSid) || detectLanguage(text, "es");
        const turns: CallTurn[] = text.trim() ? [{ speaker: "caller", start: 0, end: Number(RecordingDuration) || 1, text, language: language === "en" ? "en" : lang }] : [];
        const elviOrder = turns.length ? await shadowOrderFromTurns(turns, shadowOrder(`vm-${String(CallSid).slice(-24)}`)) : null;
        let name: string | null = null;
        try { name = await callerName(caller, findName, 900); } catch { /* no name */ }
        let lines: any[] = [];
        try { lines = (await describe(elviOrder?.cart || [])).map((l) => ({ name: l.name, quantity: l.quantity, choices: l.choices, totalCents: l.totalCents })); } catch { /* names only in the log */ }
        if (!callStartedAt.has(CallSid)) callStartedAt.set(CallSid, new Date().toISOString());
        await upsertTicket({
          callSid: CallSid, at: callStartedAt.get(CallSid)!, caller, name, receiptCode: receiptCode(CallSid),
          language: lang, phase: "final", training: isTrainingCaller(caller), transcript: text
        }, describe, elviOrder?.cart || [], elviOrder);
        learnCallerLanguage(CallSid, caller, turns.map((t) => ({ ...t, language: detectLanguage(t.text, language === "en" ? "en" : "es") })), callLang.get(CallSid));
        scheduleReadbackName(CallSid, caller, turns, Math.round(Math.max(0, ...turns.map((t) => t.end))));
        logCall({ event: "voicemail", callSid: CallSid, caller, name, language: lang, recordingSid: RecordingSid, durationSec: RecordingDuration, file: path.relative(apiRoot, file), transcript: text, elviOrder, lines });
      } catch (e) {
        logCall({ event: "voicemail_error", callSid: CallSid, caller, recordingSid: RecordingSid, error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });

  async function download(url: string) {
    if (process.env.TWILIO_TEST_AUDIO) return fs.readFileSync(process.env.TWILIO_TEST_AUDIO);
    const r = await fetch(url, { headers: { Authorization: twAuth() } });
    if (!r.ok) throw new Error(`recording download ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  // Dual-channel recording of a bridged call (stored on the customer's CallSid). Clean two-person queue bridges put
  // the customer on channel 1 and staff on channel 2 — set TWILIO_QUEUE_CALLER_CHANNEL=1 (see .env.twilio).
  app.post("/api/twilio/recording", form, guard, (req, res) => {
    res.sendStatus(204); // ack fast; process in background
    const { RecordingUrl, RecordingSid, CallSid, RecordingDuration } = req.body || {};
    if (!RecordingUrl || !RecordingSid) return;
    const caller = callers.get(CallSid) || req.body?.From || "";
    const callerChannel: 1 | 2 = req.query.leg === "queue" ? (process.env.TWILIO_QUEUE_CALLER_CHANNEL === "1" ? 1 : 2) : 1;
    (async () => {
      try {
        const buf = await download(`${RecordingUrl}.wav?RequestedChannels=2`);
        fs.mkdirSync(callsDir, { recursive: true });
        const file = path.join(callsDir, `${RecordingSid}.wav`);
        fs.writeFileSync(file, buf);
        const prev = segments.get(CallSid);
        const result = await scoreRecording(buf, `call-${String(CallSid).replace(/[^a-zA-Z0-9]/g, "").slice(-40)}${prev ? `-s${prev.files.length + 1}` : ""}`, shadowOrder, { callerChannel, before: prev?.turns });
        const files = [...(prev?.files || []), path.relative(apiRoot, file)];
        segments.set(CallSid, { turns: result.turns, files, at: Date.now() });
        let name: string | null = callNames.get(CallSid) ?? ticketsByCall.get(CallSid)?.name ?? null;
        try { if (!name) name = await callerName(caller, findName, 2500); } catch { /* no name */ }
        if (name) callNames.set(CallSid, name);
        let lines: any[] = [];
        try { lines = (await describe(result.elviOrder?.cart || [])).map((l) => ({ name: l.name, quantity: l.quantity, choices: l.choices, totalCents: l.totalCents })); } catch { /* names only */ }
        const called = callLines.get(CallSid) || "";
        const ticket = await upsertTicket({
          callSid: CallSid,
          at: callStartedAt.get(CallSid) || ticketsByCall.get(CallSid)?.at || new Date().toISOString(),
          caller, name, receiptCode: receiptCode(CallSid),
          language: callLang.get(CallSid) || "es", phase: "final", training: isTrainingCaller(caller),
          transcript: result.transcript,
          source: elviPhoneSource(called), phoneDisplay: formatTicketPhone(caller),
          fulfillment: "TO GO / LLEVAR",
          // delivery1: delivery vs pickup + address from the transcript (staff read-back counts).
          ...((await applyCallDelivery(CallSid, caller, result.turns as any, isTrainingCaller(caller)).catch(() => null)) || {}),
        }, describe, result.elviOrder?.cart || [], result.elviOrder);
        learnCallerLanguage(CallSid, caller, result.turns, callLang.get(CallSid));
        scheduleReadbackName(CallSid, caller, result.turns, Math.round(Math.max(0, ...result.turns.map((t) => t.end))));
        logCall({ event: "recording", callSid: CallSid, caller, name, greetingLanguage: callLang.get(CallSid), recordingSid: RecordingSid, durationSec: RecordingDuration, file: path.relative(apiRoot, file), segments: files.length, callerChannel, lines, ticketPhase: ticket.phase, ...result });
      } catch (e) {
        logCall({ event: "recording_error", callSid: CallSid, caller, recordingSid: RecordingSid, error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });

  // Legacy ring-through status (old calls in flight); never dials anything.
  app.post("/api/twilio/dial-status", form, guard, (req, res) => {
    const status = String(req.body?.DialCallStatus || "");
    logCall({ event: status === "completed" ? "answered" : "missed", callSid: req.body?.CallSid, caller: req.body?.From, dialStatus: status, durationSec: req.body?.DialCallDuration });
    res.type("text/xml").send(xml("<Hangup/>"));
  });
}

function recentVoicemails(limit = 20) {
  try {
    const out: any[] = [];
    for (const f of fs.readdirSync(logDir).filter((x) => x.endsWith(".jsonl")).sort().reverse().slice(0, 7)) {
      for (const line of fs.readFileSync(path.join(logDir, f), "utf8").split("\n").reverse()) {
        if (!line.includes('"voicemail"')) continue;
        let e: any; try { e = JSON.parse(line); } catch { continue; }
        if (e.event !== "voicemail" || /^CAtest/i.test(e.callSid || "")) continue;
        out.push({ at: e.ts, callSid: e.callSid, from: e.caller, name: e.name || null, language: e.language, recordingSid: e.recordingSid, durationSec: Number(e.durationSec) || 0, transcript: e.transcript || "", training: e.source === "training",
          order: (e.lines || []).map((l: any) => ({ name: l.name, quantity: l.quantity, choices: l.choices || [], totalCents: l.totalCents })) });
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch { return []; }
}
