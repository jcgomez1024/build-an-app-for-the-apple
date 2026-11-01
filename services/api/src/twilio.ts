// Counter phone (tw11). The main lines forward every call to the Twilio numbers, so Twilio NEVER dials a main line
// (that would loop). Flow: greeting + language (repeat callers by name) -> recording notice -> Enqueue into the line's
// queue with hold audio in the caller's language -> staff answer in /phone.html (Twilio Voice JS SDK) -> whisper
// "Llamada de {nombre}" to staff only -> bridged with dual-channel recording -> transcript + Elvi shadow order (no checkout).
// Nobody online at the counter, or nobody answers in time -> voicemail (transcribed, with Elvi's suggested order).
import { snapToKnownName, nameFromTranscriptInfo, rememberHeardNameIfNone, markOrderOnlyName, deniedVocative, isNumberName } from "./order-name.js";
import crypto from "node:crypto";
import { blockedCaller, blockedLanguages, BLOCKED_TEXT } from "./phone-blocklist.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { knownCaller, rememberCaller, callerName, setOnNameSaved, cleanFirstName, type NameSource, saveCallerFulfillment, savedDelivery, deliveryProfile, deliveryProfileNote, savedCallerName, PHOTO_DIR , savedLanguage, setCallerLanguageKey, setCallerLanguageManual, savePickupName} from "./caller-memory.js";
import { detectFulfillment, detectAddress, cityHeard, type Fulfillment } from "./delivery.js";
import { cachedQuote, quoteDeliveryAddress, provisionalDeliveryFeeCents, type Quote } from "./delivery-zone.js";
import { attachAddOnNote } from "./asked-dishes.js";
import { learnReadbackName, nameExtractEnabled, type ReadbackDecision } from "./name-extract.js";
import { searchOrdersReadOnly, paymentReceiptReadOnly } from "./square.js";
import { squareRefs } from "./call-accuracy.js";
import { orderNameForPhone } from "./call-accuracy.js";
import { heardName as heardShadowName } from "./name-accuracy.js";
import { loadHistory, favoritesFor, deliveryNudge, confidentName } from "./favorites.js";
import { phoneKey as favKey } from "./caller-memory.js";
import { buildCallLog, readCallEvents, rangeDays, summarize, type CallLogRange, type TwilioStatus } from "./call-log.js";
import { transcribeDualChannel, shadowOrderFromTurns, sttWords, detectLanguage, type ShadowTurn, type CallTurn, type ContainerPlan, removalNotesIn } from "./call-scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(apiRoot, ".env.twilio") });

const callsDir = path.join(apiRoot, "data/calls");
const logDir = process.env.ELVI_CALL_LOG_DIR || path.join(apiRoot, "data/logs/calls"); // tests point this at a temp dir

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

/** fav1: phone favorites are READY but INACTIVE while the phone is listen-only. Elvi says nothing; we only log what she
 * would have offered (local, gitignored call log). ELVI_PHONE_FAVORITES=1 is for when live answering starts (still log-only today). */
let favMenu: { at: number; items: any[] } | null = null;
let favMenuLoader: (() => Promise<any[]>) | null = null;
export function setFavMenuLoader(fn: () => Promise<any[]>) { favMenuLoader = fn; }
export async function logPhoneFavorites(sid: string, from: string) {
  const orders = loadHistory()[favKey(from)];
  if (!orders || orders.length < 3) return;
  if (!favMenuLoader) return;
  if (!favMenu || Date.now() - favMenu.at > 600_000) favMenu = { at: Date.now(), items: await favMenuLoader() };
  const fav = favoritesFor(orders, favMenu.items, { name: confidentName(from), channel: "phone", nudge: deliveryNudge(from, orders, "phone") });
  if (!fav) return;
  logCall({ event: "favorites_would_offer", callSid: sid, caller: from, kind: fav.kind, orders: fav.orders, live: process.env.ELVI_PHONE_FAVORITES === "1", greetingEs: fav.greeting.es, greetingEn: fav.greeting.en, dropped: fav.dropped, deliveryNudge: !!fav.deliveryNudge });
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
/** lang2: confident main language of the caller — ≥ 8 caller words and ≥ 70 % in one language. */
export function confidentCallerLanguage(turns: CallTurn[], minWords = 8, minShare = 0.7): { language: Lang; share: number } | null {
  const n = { es: 0, en: 0 };
  for (const t of turns) if (t.speaker === "caller") n[t.language] += String(t.text || "").split(/\s+/).filter(Boolean).length;
  const tot = n.es + n.en; if (tot < minWords) return null;
  const language: Lang = n.en > n.es ? "en" : "es", share = n[language] / tot;
  return share >= minShare ? { language, share: Math.round(share * 100) / 100 } : null;
}
/** lang2: after each transcript — confident + different from the saved language → update it and log "language_corrected"
 *  (informational, no ping). A manual (staff) setting is never changed automatically. */
export function learnCallerLanguage(callSid: string, caller: string, turns: CallTurn[], greeted: Lang | undefined) {
  if (!caller) return;
  const c = confidentCallerLanguage(turns);
  if (!c) return;
  const saved = savedLanguage(caller);
  const before = saved.language || greeted || null;
  if (saved.from === "manual") { if (saved.language !== c.language) logCall({ event: "language_correction_skipped", callSid, caller, saved: saved.language, heard: c.language, share: c.share, reason: "manual" }); return; }
  try { rememberCaller(caller, { language: c.language, heardSpeech: true }); } catch { /* best effort */ }
  if (before && before !== c.language) logCall({ event: "language_corrected", callSid, caller, from: before, to: c.language, share: c.share, source: "auto" });
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
/** ringback1 (Carlos): standard US ringback — 440 + 480 Hz, 2 s on / 4 s off — as an 8 kHz 16-bit mono WAV (one 6 s cycle),
 *  generated in memory and served by our API; the waiting hold loops it until staff accept / bridge. */
let ringbackCache: Buffer | null = null;
export function ringbackWav(): Buffer {
  if (ringbackCache) return ringbackCache;
  const rate = 8000, n = rate * 6, data = Buffer.alloc(n * 2);
  for (let i = 0; i < 2 * rate; i++) {
    const t = i / rate, env = Math.min(1, i / 80, (2 * rate - i) / 80); // 10 ms ramps, no clicks
    const v = env * 0.22 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return (ringbackCache = Buffer.concat([h, data]));
}
export const RINGBACK_PATH = "/api/twilio/tones/ringback-us.wav";
/** Waiting hold (after the greeting, until bridge): ringback only, looped (~60 s; the waitUrl re-requests it after). */
export const waitingHoldTwiml = (base: string, lang: "es" | "en") =>
  `<Gather input="dtmf" numDigits="1" timeout="1" action="${base}/api/twilio/hold-key?lang=${lang}" method="POST"><Play loop="10">${base}${RINGBACK_PATH}</Play></Gather>`;

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
/** intro3: new / unknown-language caller TwiML — opening, notice, then Enqueue (ring legs start on the first hold poll). */
export const introTwiml = (base: string, notice: string, enqueue: string) => `${playOrSay(base, "es", "Cocina Elvis", "opening-es")}${notice}${enqueue}`;
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
type Entry = { callSid: string; from: string; name: string | null; line: string; queue: string; language: Lang; training: boolean; at: number; lastSeen: number; heldAt?: number; introEndsAt?: number };
/** ring2: the greeting + recording notice length before the caller is in the queue (no bridge before it ends). */
export const INTRO_MS = () => Math.max(0, Number(process.env.TWILIO_INTRO_MS ?? 5500) || 0);
/** ring2: seconds a ring leg must still wait before dialing the queue, so the notice always finishes first. */
export const bridgeWaitSec = (introEndsAt: number | undefined, now = Date.now()) => (introEndsAt && introEndsAt > now ? Math.ceil((introEndsAt - now) / 1000) : 0);
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
const talkSecByCall = new Map<string, number>(); // link15: talk/recording seconds per call
/** Pick the Square order for a call: phone match, or ticket name = caller's name, or the only order rung up right after. */
/** link15: a time-only guess ("only ticket in 20 min") needs a real ordering call — at least ~15 s of talk and some order
 *  speech (a dish word or an Elvi line). A 5 s "Bueno. Bueno." test call must never grab the next walk-in's ticket. */
const ORDER_SPEECH = /\b(?:tacos?|burritos?|quesadillas?|doradas?|gorditas?|tortas?|enchiladas?|tamales?|sopes?|sopesazos?|huaraches?|tostadas?|chilaquiles|menudo|pozole|birrias?|nachos|elotes?|esquites?|horchatas?|jamaicas?|aguas?|jarritos?|sodas?|platillos?|platos?|combos?|ordenes|orders?|bistec|chorizo|lengua|pastor|carnitas|cabeza|pollo|asada|suadero|tripa|costilla)\b/iu;
export function timeOnlyLinkOk(t: { talkSec?: number | null; transcript?: string; lines?: unknown[] }): boolean {
  if (t.talkSec != null && t.talkSec < 15) return false;
  if (t.lines === undefined && t.transcript === undefined) return true; // no speech info given: only the length gate applies
  // birria1/Carlos 10/25: when cart lines are known, require a real order — empty-cart inquiries must not steal "only ticket in 20 min".
  if (t.lines !== undefined) return (t.lines?.length || 0) > 0;
  return ORDER_SPEECH.test(String(t.transcript || ""));
}
/** santiago1 (CA7fc26b): base dish word of a ticket / Square line ("Quesadilla · (QCO) …" → "quesadilla"). */
const baseItem = (n: string) => String(n || "").split(/\s+·\s+|\s+\(|\s+\//)[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/s\b/, "").trim();
export function pickSquareOrder(t: { at: string; caller: string; name: string | null; talkSec?: number | null; transcript?: string; lines?: unknown[] }, orders: any[], now = Date.now()): { order: any; by: string } | null {
  const at = Date.parse(t.at), phone = d10(t.caller), first = String(t.name || "").trim().split(/\s+/)[0]?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") || "";
  const empty = (o: any) => !(o?.line_items || []).length && !Number(o?.total_money?.amount || 0); // followup1: never link $0 / no-item orders
  const online = (o: any) => /online|website|ecom/i.test(String(o?.source?.name || ""));
  const win = orders.filter((o) => { const c = Date.parse(o.created_at); return !empty(o) && c >= at - 2 * 60000 && c <= at + 60 * 60000; });
  // santiago1: closest ticket rung AFTER the call ends wins ties (a walk-in a few seconds earlier is not this call)
  const dist = (o: any) => { const d = Date.parse(o.created_at) - at; return d >= 0 ? d : 3 * Math.abs(d); };
  const closest = (xs: any[]) => [...xs].sort((a, b) => dist(a) - dist(b))[0];
  const phoneOf = (o: any) => (o.fulfillments || []).flatMap((f: any) => [f.pickup_details, f.delivery_details].map((x: any) => d10(x?.recipient?.phone_number || "")));
  const byPhone = phone ? win.filter((o) => phoneOf(o).includes(phone)) : [];
  if (byPhone.length) return { order: closest(byPhone), by: "phone" };
  const tname = (o: any) => String(o.ticket_name || "").trim().split(/\s+/)[0]?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") || "";
  const byName = first ? win.filter((o) => tname(o) === first) : [];
  if (byName.length) return { order: closest(byName), by: "ticket name" };
  // santiago1: the ticket's dishes match what the caller ordered (every Elvi food dish on the Square ticket)
  const near = win.filter((o) => !online(o) && Date.parse(o.created_at) <= at + 20 * 60000 && !(first && tname(o) && tname(o) !== first));
  const want = [...new Set(((t.lines || []) as any[]).filter((l) => !l?.kind || l.kind === "food").map((l) => baseItem(l?.name)).filter(Boolean))];
  if (want.length) {
    const byItems = near.filter((o) => { const have = new Set((o.line_items || []).map((li: any) => baseItem(li?.name))); return want.every((w) => have.has(w)); });
    if (byItems.length) return { order: closest(byItems), by: "items" };
  }
  // time-only fallback: only once the 20-min window has closed, and never a ticket named for someone else
  if (now < at + 20 * 60000) return null;
  const soon = win.filter((o) => !online(o) && Date.parse(o.created_at) <= at + 20 * 60000); // followup1: POS tickets only
  if (soon.length === 1 && timeOnlyLinkOk(t) && !(first && tname(soon[0]) && tname(soon[0]) !== first)) return { order: soon[0], by: "only ticket in 20 min" };
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
    const pick = pickSquareOrder({ ...t, talkSec: talkSecByCall.get(t.callSid) ?? null }, orders.filter((o) => !used.has(o.id)));
    if (!pick) continue;
    const r = squareRefs(pick.order);
    const rc = r.paymentId ? await paymentReceiptReadOnly(r.paymentId) : null;
    const ref: SquareRef = { receiptNumber: rc?.receiptNumber || r.receiptNumber, ticketName: r.ticketName, orderId: r.orderId, paymentId: r.paymentId, dashboardUrl: r.dashboardUrl, receiptUrl: rc?.receiptUrl || null, matchedBy: pick.by, linkedAt: new Date().toISOString() };
    links[t.callSid] = ref; used.add(r.orderId); changed = true;
    t.squareRef = ref;
    logCall({ event: "square_ticket", callSid: t.callSid, receiptNumber: ref.receiptNumber, orderId: ref.orderId, matchedBy: ref.matchedBy });
    void sendNameFollowUp(t.callSid, cleanFirstName(String(ref.ticketName || "")) || null).catch(() => {}); // smsname1
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
    // callerprofile1: staff-entered unit/building, instructions and building photo (photo served behind the PIN).
    profile: (() => { try { const p = deliveryProfile(from); const n = savedCallerName(from); return p || n ? { name: n?.name || null, unitNote: p?.unitNote || null, instructions: p?.instructions || null, photo: p?.photo || null } : null; } catch { return null; } })(),
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
  // alex3: no street said and none saved → the caller's town (unconfirmed) so the zone/fee still quotes
  const addr = a.address?.full || (f.fulfillment === "DELIVERY" ? savedDelivery(caller).address?.address || cityHeard(turns) || null : null);
  if (f.fulfillment === "DELIVERY" && addr) { try { quote = await quoteDeliveryAddress(addr); } catch { quote = null; } }
  callDelivery.set(callSid, { fulfillment: f.fulfillment, address: addr, street: a.address?.street || null, confirmed: a.confirmed, quote });
  // hector1: address taken → never leave feeCents null (geocode fail still gets near-zone provisional)
  const feeCents = provisionalDeliveryFeeCents(quote, !!addr);
  logCall({ event: "fulfillment", callSid, caller, fulfillment: f.fulfillment, by: f.by, address: addr, addressFrom: a.address ? "call" : addr ? "saved" : null, addressConfirmed: a.confirmed, zone: quote?.zone || null, feeCents, etaMinutes: quote?.etaMinutes ?? null, needsConfirm: quote ? quote.needsConfirm : f.fulfillment === "DELIVERY", source: training ? "training" : "customer" });
  try { saveCallerFulfillment(caller, f.fulfillment, a.address ? { full: a.address.full, street: a.address.street } : null); } catch { /* memory only */ }
  const notes = f.fulfillment !== "DELIVERY" ? undefined
    : quote?.ok ? `${(quote.city || "").toUpperCase()} · ${quote.breakdown || `$${(quote.feeCents! / 100).toFixed(quote.feeCents! % 100 ? 2 : 0)}`}${quote.feeConfirmed === false ? " · CONFIRMAR TARIFA" : ""} · ~${quote.etaMinutes} min · MÍNIMO $10${a.confirmed ? "" : " · confirmar dirección"}`
    : quote?.reason === "out_of_range" ? `FUERA DEL ÁREA DE ENTREGA (${quote.miles} mi)`
    : `CONFIRMAR ZONA${addr ? "" : " · FALTA DIRECCIÓN"}`;
  let extra = ""; try { extra = deliveryProfileNote(deliveryProfile(caller)); } catch { extra = ""; }
  const allNotes = [notes, extra].filter(Boolean).join(" | ") || undefined;
  return { fulfillment: FULFILLMENT_LABEL[f.fulfillment], deliverTo: f.fulfillment === "DELIVERY" ? { address: addr || "", phone: formatTicketPhone(caller), notes: allNotes } : null };
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
    // ca39e2bb: additive kitchen notes ("extra bistec" / "extra carne") print on non-deluxe too;
    // removal notes (no/sin) stay deluxe-only via applyDeluxeMode.
    const additiveNotes = [...(row?.elviNotes || [])].filter((n) => /^\s*(?:extra\b|vapor:|enchiladas:)|\baparte\b/iu.test(String(n))); // vapor1: per-order filling mix
    const notes = [...new Set([...(applied.notes || []), ...additiveNotes])];
    const name = stripOnline(l.name);
    const flags = [
      ask ? `Confirmar carne: ${ask.option}` : "",
      lineHasDeluxe && deluxeCount > 1 && ambiguous.length ? `Confirmar: ${ambiguous.join(", ")} — ¿en cuál DELUXE?` : "",
    ].filter(Boolean);
    return {
      name, quantity: l.quantity, choices, notes, totalCents: l.totalCents,
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
// time1: APP_PUBLIC_URL is now the customer host (order.*), which denies /api/twilio — wait for a real Twilio webhook base instead.
let lastBase = /\/\/order\./.test(process.env.APP_PUBLIC_URL || "") ? "" : (process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
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
/** route1 (Carlos): per-line ring routing from .env.twilio, e.g. TWILIO_LINE_RING=1609:cells,2795:desk (line suffix).
 *  cells = only the TWILIO_RING_NUMBERS phones (not the counter page); desk = only the counter/browser client (phone.html);
 *  unset / other = both (old behavior). TWILIO_DESK_FALLBACK_CELLS=1 rings the cells when the desk is offline (default off). */
export type RingMode = "cells" | "desk" | "both" | "custom";
/** route3: per-line plan. Tokens joined by "+": cells (TWILIO_RING_NUMBERS), desk (phone.html), or a phone number,
 *  e.g. 1609:cells+desk,2795:+14405519249+desk. Never-dial numbers and our own Twilio lines are always dropped. */
export type RingPlan = { cells: boolean; desk: boolean; numbers: string[] };
export function lineRingPlan(line: string): RingPlan {
  const n = d10(line);
  for (const part of String(process.env.TWILIO_LINE_RING || "").split(",")) {
    const i = part.indexOf(":"); if (i < 0) continue;
    const k = part.slice(0, i).replace(/\D/g, ""), v = part.slice(i + 1).trim().toLowerCase();
    if (!k || !n || !n.endsWith(k)) continue;
    const toks = v.split("+").map((x) => x.trim()).filter(Boolean);
    const plan: RingPlan = { cells: false, desk: false, numbers: [] };
    for (const t of toks) { if (t === "cells") plan.cells = true; else if (t === "desk") plan.desk = true; else if (t === "both") { plan.cells = true; plan.desk = true; } else if (/^\d{10,11}$/.test(t)) plan.numbers.push(`+1${d10(t)}`); }
    if (plan.cells || plan.desk || plan.numbers.length) return plan;
  }
  return { cells: true, desk: true, numbers: [] };
}
export function lineRingMode(line: string): RingMode {
  const p = lineRingPlan(line);
  return p.numbers.length ? "custom" : p.cells && p.desk ? "both" : p.cells ? "cells" : "desk";
}
export const deskFallbackCells = () => process.env.TWILIO_DESK_FALLBACK_CELLS === "1";
/** Ring phones for this line right now. Desk-only line: none, unless the fallback flag is on and the desk is offline. */
/** rering1: re-ring immediately after a ring leg times out / is busy / fails on its own (not canceled by us),
 *  when no other leg is still ringing and the caller hasn't hit max wait. */
export function shouldReRing(status: string, canceledByUs: boolean, otherLegsRinging: boolean, waitedSec: number, maxWait: number): boolean {
  return /^(no-answer|busy|failed)$/.test(status) && !canceledByUs && !otherLegsRinging && waitedSec < maxWait - 5;
}
export function ringNumbersFor(line: string, deskOnline: boolean): string[] {
  const p = lineRingPlan(line);
  const own = new Set(phoneLines().map((l) => d10(l.number)));
  const extra = p.numbers.filter((x) => !own.has(d10(x)) && !neverDial(x));
  let out = [...(p.cells ? ringNumbers() : []), ...extra];
  if (!out.length && p.desk && deskFallbackCells() && !deskOnline) out = ringNumbers();
  return [...new Set(out)];
}
/** Does the counter page (desk) get this line's calls? */
export const deskTakesLine = (line: string) => lineRingPlan(line).desk;
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
/** cleanup1: caller ID for staff ring legs = the Twilio line that received the call (never the customer's number). */
export function ringCallerId(receivedOn: string): string {
  return phoneLines().find((l) => d10(l.number) === d10(receivedOn))?.number || phoneLines()[0]?.number || "";
}
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
const smsMeta = new Map<string, { base: string; from: string; line: string; at: number; nameSent: boolean; followUp: boolean }>(); // smsname1
const SMS_CALLER_GAP_MS = 2 * 60 * 1000, SMS_PER_HOUR = 30;
export function smsNumbers(): string[] {
  return String(process.env.TWILIO_SMS_NUMBERS || "").split(",").map((x) => x.trim()).filter((x) => /^\+1\d{10}$/.test(x));
}
const fmtUs = (p: string) => { const n = d10(p); return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : ""; };
/** smstext1: accents/symbols → plain GSM-7 letters (keeps one segment). */
export const gsm7 = (t: string) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 .,'@&()+\-:\/?!]/g, "");
/** "Carlos 11:50 AM (440) 413-9902 (línea 289)" — pure, used by the dry run. */
export function ringSmsText(o: { name?: string | null; from: string; at: number | Date; forwardedFrom?: string }): string {
  const time = new Date(o.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const num = /^\+1[2-9]\d{9}$/.test(String(o.from || "").trim()) ? fmtUs(o.from) : "Privado";
  const f = d10(o.forwardedFrom || "");
  // smstext1: matches the approved A2P samples; plain GSM-7 ("linea", "-") so it stays one 160-char segment.
  const via = f.endsWith("2898504") ? " (linea 289)" : f.endsWith("5519122") ? " (linea 551)" : "";
  const name = gsm7(String(o.name || "").trim()).slice(0, 24).trim() || "Cliente";
  return `Cocina Elvis Staff Alert: ${name} ${time} ${num}${via} - please answer. Reply STOP to opt out.`;
}
/** smsfrom1: alert FROM the line the customer called (if attached to the messaging service), keeping the service SID;
 *  otherwise the service pool picks. No service configured → From = the line (legacy). Pure. */
export function smsSender(calledLine: string, attached: string[], svc: string, fallbackLine = ""): { from?: string; messagingServiceSid?: string } {
  if (!svc) return { from: fallbackLine };
  const hit = attached.find((n) => d10(n) && d10(n) === d10(calledLine));
  return hit ? { from: hit, messagingServiceSid: svc } : { messagingServiceSid: svc };
}
let svcNums: { svc: string; at: number; nums: string[] } | null = null;
/** Numbers attached to the messaging service (read-only GET, cached 1 h; [] on error → service pool). */
async function serviceNumbers(svc: string): Promise<string[]> {
  if (svcNums && svcNums.svc === svc && Date.now() - svcNums.at < 3600_000) return svcNums.nums;
  try {
    const r = await fetch(`https://messaging.twilio.com/v1/Services/${svc}/PhoneNumbers?PageSize=50`, { headers: { Authorization: twAuth() } });
    const j: any = r.ok ? await r.json() : null;
    const nums = (j?.phone_numbers || []).map((p: any) => String(p.phone_number));
    svcNums = { svc, at: Date.now(), nums };
    return nums;
  } catch { return []; }
}
async function sendRingSms(base: string, cust: Entry) {
  if (process.env.TWILIO_RING_SMS !== "1" || smsSent.has(cust.callSid)) return;
  const to = smsNumbers(); const account = process.env.TWILIO_ACCOUNT_SID;
  if (!to.length || !account || !process.env.TWILIO_AUTH_TOKEN) return;
  const now = Date.now();
  smsSent.set(cust.callSid, now);
  if (smsSent.size > 500) for (const [k, t] of smsSent) if (now - t > 6 * 3600_000) { smsSent.delete(k); callFwd.delete(k); smsMeta.delete(k); }
  while (smsTimes.length && now - smsTimes[0] > 3600_000) smsTimes.shift();
  const key = d10(cust.from) || "privado";
  if (now - (smsByCaller.get(key) || 0) < SMS_CALLER_GAP_MS) { logCall({ event: "ring_sms_skipped", callSid: cust.callSid, reason: "caller-rate" }); return; }
  if (smsTimes.length + to.length > SMS_PER_HOUR) { logCall({ event: "ring_sms_skipped", callSid: cust.callSid, reason: "hour-cap" }); return; }
  smsByCaller.set(key, now);
  const body = ringSmsText({ name: cust.name, from: cust.from, at: cust.at || now, forwardedFrom: callFwd.get(cust.callSid) });
  smsMeta.set(cust.callSid, { base, from: cust.from, line: cust.line, at: cust.at || now, nameSent: !!String(cust.name || "").trim(), followUp: false });
  await postStaffSms(base, cust.callSid, cust.line, to, body, "ring_sms");
}
async function postStaffSms(base: string, callSid: string, calledLine: string, to: string[], body: string, event: string) {
  const account = process.env.TWILIO_ACCOUNT_SID; const now = Date.now();
  const svc = String(process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim();
  const line = phoneLines().find((l) => d10(l.number) === d10(calledLine))?.number || phoneLines()[0]?.number || "";
  const sender = smsSender(calledLine, svc ? await serviceNumbers(svc) : [], svc, line);
  for (const n of to) {
    smsTimes.push(now);
    try {
      const params = new URLSearchParams({ To: n, Body: body });
      if (sender.messagingServiceSid) params.set("MessagingServiceSid", sender.messagingServiceSid);
      if (sender.from) params.set("From", sender.from);
      if (/^https:\/\//.test(base)) params.set("StatusCallback", `${base}/api/twilio/sms-status?cust=${encodeURIComponent(callSid)}`);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
        method: "POST", headers: { Authorization: twAuth(), "content-type": "application/x-www-form-urlencoded" }, body: params,
      });
      const j = await r.json().catch(() => ({})) as { sid?: string; status?: string; code?: number; message?: string };
      if (r.ok && j.sid) logCall({ event, callSid, to: n, messageSid: j.sid, status: j.status, body });
      else logCall({ event: event + "_error", callSid, to: n, status: r.status, code: j.code, error: String(j.message || "").slice(0, 200) });
    } catch (e) { logCall({ event: event + "_error", callSid, to: n, error: e instanceof Error ? e.message : String(e) }); }
  }
}
/** smsname1: "Llamada 1:06 PM (...6767): Alex" — the name learned after the ring alert went out. Pure, GSM-7. */
export function nameFollowUpText(o: { name: string; from: string; at: number | Date }): string {
  const time = new Date(o.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const n = d10(o.from); const num = n.length === 10 ? `(...${n.slice(6)})` : "(Privado)";
  return `Llamada ${time} ${num}: ${gsm7(String(o.name || "").trim()).slice(0, 24).trim()}`;
}
/** smsname1: decide whether a learned name gets a follow-up text. Pure: only when a ring alert went out without a name,
 *  no follow-up was sent yet for this call, and the name is real. */
export function shouldNameFollowUp(meta: { nameSent: boolean; followUp: boolean } | undefined, name: string | null | undefined): boolean {
  if (/^\s*(mesa|table|para llevar|to go|cliente|customer)\b/i.test(String(name || ""))) return false;
  return !!meta && !meta.nameSent && !meta.followUp && !!gsm7(String(name || "")).replace(/[^A-Za-z]/g, "").length;
}
/** smsname1: one follow-up per call to the same recipients when the name is learned (heard or Square ticket). */
export async function sendNameFollowUp(callSid: string, name: string | null | undefined) {
  const meta = smsMeta.get(callSid);
  if (process.env.TWILIO_RING_SMS !== "1" || !shouldNameFollowUp(meta, name)) return;
  const to = smsNumbers(); if (!to.length || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;
  meta!.followUp = true;
  await postStaffSms(meta!.base, callSid, meta!.line, to, nameFollowUpText({ name: String(name), from: meta!.from, at: meta!.at }), "ring_sms_name");
}
export function _setSmsMetaForTest(callSid: string, m: any) { smsMeta.set(callSid, m); }
export function _smsMetaForTest(callSid: string) { return smsMeta.get(callSid); }
/** ringtime1: ring-leg REST body — also ask Twilio for initiated / ringing / answered events (timeline in the call log). */
export function ringLegBody(p: Record<string, string>) {
  const b = new URLSearchParams(p);
  for (const ev of ["initiated", "ringing", "answered", "completed"]) b.append("StatusCallbackEvent", ev);
  return b;
}
async function startRings(base: string, cust: Entry) {
  void sendRingSms(base, cust).catch(() => {}); // ringsms1: never blocks ringing
  const skip = ringNoAccept.get(cust.callSid);
  const nums = ringNumbersFor(cust.line, agentOnline()).filter((n) => !skip?.has(n));
  const account = process.env.TWILIO_ACCOUNT_SID;
  if (counterClaim.has(cust.callSid) || deskAtPrompt.get(cust.callSid)?.size) return;
  if (!nums.length || !account || !process.env.TWILIO_AUTH_TOKEN || !/^https:\/\//.test(base)) return;
  if (ringStarting.has(cust.callSid) || (ringing.get(cust.callSid)?.size || 0) > 0) return;
  ringStarting.add(cust.callSid);
  try {
    const twilioLine = ringCallerId(cust.line);
    // callerid1: show the real caller on the desk/iPhone (TWILIO_PASS_CALLER_ID=1). Falls back to the Twilio line.
    // cleanup1: never use the customer's number as the REST caller ID (Twilio 21210, not verified). The ring leg shows the
    // Twilio line that received the call; the whisper still tells staff the caller's name/number.
    const passed = "";
    const legs = ringing.get(cust.callSid) || new Map<string, string>();
    ringing.set(cust.callSid, legs); watchDeadLegs(); // deadleg1
    await Promise.all(nums.map(async (to) => {
      try {
        const place = (from: string) => fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls.json`, {
          method: "POST", headers: { Authorization: twAuth(), "content-type": "application/x-www-form-urlencoded" },
          body: ringLegBody({
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
const parentEnd = new Map<string, { status: string; durationSec: number; endedAt: string | null }>();
/** deadleg1: has the CUSTOMER's leg already ended? Read-only GET; null if unknown (network/auth) so callers don't act. */
export async function parentLegEnded(custSid: string, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  const account = process.env.TWILIO_ACCOUNT_SID; if (!account || !/^CA[0-9a-f]{32}$/.test(custSid)) return null;
  try {
    const r = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls/${custSid}.json`, { headers: { Authorization: twAuth() } });
    if (!r.ok) return null; const j: any = await r.json();
    if (/^(completed|canceled|failed|busy|no-answer)$/.test(String(j.status || ""))) parentEnd.set(custSid, { status: j.status, durationSec: Number(j.duration) || 0, endedAt: j.end_time ? new Date(j.end_time).toISOString() : null });
    return /^(completed|canceled|failed|busy|no-answer)$/.test(String(j.status || ""));
  } catch { return null; }
}
/** deadleg1: the caller hung up (Oct 21 1:10 PM: during the intro, before Enqueue) — drop the waiter, end the ring legs. */
async function callerGone(custSid: string, where: string) {
  waiting.delete(custSid);
  const pe = parentEnd.get(custSid);
  if (pe) logCall({ event: "parent_end", callSid: custSid, ...pe, from: "twilio-get" });
  logCall({ event: "caller_gone", callSid: custSid, where });
  await cancelRings(custSid, "", "caller-gone").catch(() => {});
}
let deadLegTimer: ReturnType<typeof setInterval> | null = null;
function watchDeadLegs() {
  if (deadLegTimer) return;
  deadLegTimer = setInterval(() => {
    const open = new Set([...ringing.keys(), ...[...deskAtPrompt].filter(([, v]) => v.size).map(([k]) => k)]);
    for (const custSid of open) void parentLegEnded(custSid).then((gone) => { if (gone && (ringing.has(custSid) || deskAtPrompt.get(custSid)?.size)) void callerGone(custSid, "ring-watch"); });
  }, 4000);
  (deadLegTimer as any).unref?.();
}
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
/** lang2: caller number for a call (from the call logs). */
function callerForSid(sid: string): string | null {
  for (const f of fs.readdirSync(logDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse()) {
    for (const l of fs.readFileSync(path.join(logDir, f), "utf8").split("\n")) { if (!l.includes(sid) || !l.includes('"incoming"')) continue; try { const j = JSON.parse(l); if (j.callSid === sid && j.caller) return String(j.caller); } catch {} }
  }
  return null;
}
export const phoneAuth: express.RequestHandler = (req, res, next) => {
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

  // callerprofile1: building photo for a delivery caller — PIN (or localhost) only; id is random, never the phone.
  // lang2: staff ES/EN toggle on calls.html → that number's saved language for future calls (manual wins over auto).
  app.post("/api/calls/:sid/language", json, phoneAuth, (req, res) => {
    const sid = String(req.params.sid || ""), language = req.body?.language === "en" ? "en" : req.body?.language === "es" ? "es" : null;
    if (!/^CA[0-9a-zA-Z]{10,40}$/.test(sid) || !language) return res.status(400).json({ error: "bad request" });
    const caller = callerForSid(sid);
    if (!caller) return res.status(404).json({ error: "call not found" });
    const by = String(req.body?.by || "").replace(/[^\p{L}\p{N} .'-]/gu, "").slice(0, 40) || "staff (PIN)";
    const { from } = setCallerLanguageManual(caller, language, by);
    logCall({ event: "language_manual", callSid: sid, caller, from, to: language, by });
    res.json({ ok: true, language, from, by });
  });
  app.get("/api/phone/caller-photo/:id", phoneAuth, (req, res) => {
    const m = /^([a-z0-9]{12,40})(-thumb)?$/i.exec(String(req.params.id || ""));
    if (!m) return res.status(400).end();
    const f = path.join(PHOTO_DIR, `${m[1]}${m[2] ? "-thumb" : ""}.jpg`);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(f, { headers: { "Content-Type": "image/jpeg" } });
  });

  // Public: Twilio <Play> fetches cloned-voice MP3s (safe filename only).
  app.get(RINGBACK_PATH, (_req, res) => { res.type("audio/wav").set("Cache-Control", "public, max-age=86400").send(ringbackWav()); });
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
    void HOLD_SWITCH; // ring2 (Carlos): no "For English, press 2" — Spanish only for new callers; language is corrected after the call
    if (process.env.TWILIO_WAIT_RINGBACK !== "0") return waitingHoldTwiml(base, lang); // ringback1: ringback, not silence/music, while staff phones ring
    return `<Gather input="dtmf" numDigits="1" timeout="1" action="${base}/api/twilio/hold-key?lang=${lang}" method="POST">${msg}<Play>${xmlEscape(music)}</Play></Gather>`;
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
    waiting.set(sid, { callSid: sid, from, name, line: to, queue, language: lang, training: isTrainingCaller(from), at: now, lastSeen: now, introEndsAt: now + INTRO_MS() });
    // ring2: ring the staff phones NOW, in parallel with the greeting + notice (ring-accept waits for the notice to end).
    if (process.env.TWILIO_RING_EARLY !== "0" && base) { const w = waiting.get(sid); if (w) void startRings(base, w).catch(() => {}); }
    if (sid) { callNames.set(sid, name); if (to) callLines.set(sid, to); }
    logCall({ event: online ? "queued" : "queued_soft_offline", callSid: sid, caller: from, line: to, queue, agentAgeMs: agentAgeMs(), ringMode: lineRingMode(to) });
    if (lineRingMode(to) === "desk" && !online) logCall({ event: "desk_offline", callSid: sid, caller: from, line: to, fallbackCells: deskFallbackCells(), agentAgeMs: agentAgeMs(), note: deskFallbackCells() ? "desk offline → ringing cells (fallback on)" : "desk offline, fallback off → voicemail after ~8 s on hold" });
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
    if (isLoopCall({ from, fwdFrom, lines: phoneLines().map((l) => l.number), ringSet, echo })) {
      logCall({ event: "loop_rejected", callSid: req.body?.CallSid, caller: from, calledNumber: req.body?.To });
      return res.type("text/xml").send(xml(`<Reject reason="busy"/>`));
    }
    const sid = String(req.body?.CallSid || "");
    const to = String(req.body?.To || "");
    // blocklist1: no-pickup/delivery list → tell them in their language, hang up. No queue/ring → no recording/ticket/SMS.
    const blocked = blockedCaller(from);
    if (blocked) {
      let lang: string | null = null; try { lang = savedLanguage(from).language || knownCaller(from, sid).language || null; } catch { /* both */ }
      const langs = blockedLanguages(lang);
      logCall({ event: "incoming", callSid: sid, caller: from, calledNumber: to, greeting: "blocked", flow: "blocked" });
      logCall({ event: "blocked_no_order", callSid: sid, caller: from, calledNumber: to, name: blocked.name, language: langs.join("+") });
      return res.type("text/xml").send(xml(`${langs.map((l) => sayIn(l, BLOCKED_TEXT[l])).join("")}<Hangup/>`));
    }
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
    void logPhoneFavorites(sid, from).catch(() => {});
    void namePromise.then((n) => { if (n && sid) logCall({ event: "caller_name", callSid: sid, caller: from, name: n }); }).catch(() => {});
    if (k.known && k.language) {
      const name = await namePromise;
      logCall({ event: "incoming", callSid: sid, caller: from, calledNumber: to, greeting: "returning", knownLanguage: k.language, named: !!name, flow: "counter" });
      logCall({ event: "language", callSid: sid, caller: from, heard: "", language: k.language, from: "saved" });
      if (sid) callLang.set(sid, k.language);
      return res.type("text/xml").send(xml(`${await noticeLine(k.language, { name, returning: true, voicemail: false, base })}${queueOrVoicemail(base, sid, from, to, k.language, name)}`));
    }
    logCall({ event: "incoming", callSid: sid, caller: from, calledNumber: to, greeting: k.known ? "returning-unknown-language" : "new", flow: "counter" });
    // intro3 (Carlos, Oct 21): no language-listening pause. "Cocina Elvis" + the notice in Spanish, then ring at once.
    // English stays one key away on the hold loop ("For English, press 2"); a saved language still wins next call.
    if (sid) callLang.set(sid, "es");
    logCall({ event: "language", callSid: sid, caller: from, heard: "", language: "es", from: "default" });
    let nm: string | null = null;
    try { nm = await namePromise; } catch { /* plain notice */ }
    if (nm && sid) logCall({ event: "caller_name", callSid: sid, caller: from, name: nm });
    res.type("text/xml").send(xml(introTwiml(base, await noticeLine("es", { name: nm, returning: k.known, voicemail: false, base }), queueOrVoicemail(base, sid, from, to, "es", nm))));
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
    const line = e?.line || "";
    const rings = !isHeld && ringNumbersFor(line, agentOnline()).filter((n) => !ringNoAccept.get(sid)?.has(n)).length > 0;
    if (rings && e && !tooLong) void startRings(base, e);
    else if (e && !isHeld && !tooLong) void sendRingSms(base, e).catch(() => {}); // route1: desk-only line still texts staff
    const deskCounts = deskTakesLine(line) && agentOnline();
    if (tooLong || (!rings && !deskCounts && queueTime > 8)) {
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
      try { setCallerLanguageKey(e?.from || String(req.body?.From || ""), lang); } catch { /* best effort */ } // lang2: press 2 saves English (unless staff set it)
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
    const tapWait = heldSid ? 0 : bridgeWaitSec(target.introEndsAt); // ring2: counter tap during the notice waits for it
    res.type("text/xml").send(xml(`${whisper}${tapWait ? `<Pause length="${tapWait}"/>` : ""}<Dial timeout="30" record="record-from-answer-dual" recordingStatusCallback="${base}/api/twilio/recording?leg=queue" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" action="${base}/api/twilio/agent-done" method="POST"><Queue url="${base}/api/twilio/bridge" method="POST">${xmlEscape(queue)}</Queue></Dial>`));
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
      if (sec > 0) talkSecByCall.set(a.callSid, Math.max(sec, talkSecByCall.get(a.callSid) || 0));
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
    if (await parentLegEnded(custSid) === true) { // deadleg1: never give staff dead air
      logCall({ event: "ring_answer_dead", callSid: custSid, ringCallSid: ringSid, ringTo: req.body?.To });
      void callerGone(custSid, "ring-answer");
      return res.type("text/xml").send(xml(`${sayIn("es", "El cliente ya colgó.")}<Hangup/>`));
    }
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
    if (process.env.TWILIO_PRESS1 === "0" && process.env.TWILIO_AUTO_WHISPER !== "1") {
      // instant1 (Carlos): auto-connect with NO whisper — straight to the bridge (notice-hold still applies in ring-accept).
      logCall({ event: "ring_answered", callSid: custSid, ringCallSid: ringSid, ringTo: req.body?.To, whisper: false, auto: true });
      return res.type("text/xml").send(xml(`<Redirect method="POST">${action}&amp;auto=1</Redirect>`));
    }
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
    if (await parentLegEnded(custSid) === true) { // deadleg1
      logCall({ event: "ring_accept_dead", callSid: custSid, ringCallSid: ringSid });
      waiting.delete(custSid); void callerGone(custSid, "ring-accept"); // another caller on the same line can still be taken
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
    const waitSec = bridgeWaitSec(target.introEndsAt); // ring2: never bridge before the recording notice ends
    if (waitSec) logCall({ event: "bridge_wait", callSid: target.callSid, ringCallSid: ringSid, waitSec });
    res.type("text/xml").send(xml(`${waitSec ? `<Pause length="${waitSec}"/>` : ""}<Dial timeout="30" record="record-from-answer-dual" recordingStatusCallback="${base}/api/twilio/recording?leg=queue" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" action="${base}/api/twilio/agent-done?via=desk" method="POST"><Queue url="${base}/api/twilio/bridge" method="POST">${xmlEscape(queue)}</Queue></Dial>`));
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
    // ringtime1: progress events are logged only — they must not end the leg (that was "completed"-only before).
    const st = String(req.body?.CallStatus || "");
    if (/^(initiated|ringing|in-progress|answered|queued)$/.test(st)) { logCall({ event: "ring_progress", callSid: custSid, ringCallSid: ringSid, ringTo: req.body?.To, status: st, sequence: req.body?.SequenceNumber, timestamp: req.body?.Timestamp }); return res.sendStatus(204); }
    const legs = ringing.get(custSid);
    legs?.delete(ringSid);
    if (legs && !legs.size) ringing.delete(custSid);
    deskAtPrompt.get(custSid)?.delete(ringSid);
    const ours = ringCanceled.delete(ringSid);
    logCall({ event: "ring_end", callSid: custSid, ringCallSid: ringSid, ringTo: req.body?.To, status: req.body?.CallStatus, canceledByUs: ours, durationSec: req.body?.CallDuration });
    // rering1: the waiting hold is a ~60 s ringback loop, so waiting for /hold to re-ring left callers in silence
    // (no phone ringing) for ~40 s after a leg timed out. Re-ring right away while the caller still waits.
    const w = waiting.get(custSid);
    if (w && lastBase && shouldReRing(st, ours, !!legs?.size, (Date.now() - w.at) / 1000, maxWaitSec())) {
      logCall({ event: "rering", callSid: custSid, afterStatus: st, waitSec: Math.round((Date.now() - w.at) / 1000) });
      void startRings(lastBase, w);
    }
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
      // route1: a cells-only line never shows/rings on the counter page.
      lines: phoneLines().map((l) => ({ ...l, ringMode: lineRingMode(l.number), waiting: deskTakesLine(l.number) ? [...waiting.values()].filter((e) => e.queue === l.queue).sort((a, b) => a.at - b.at).map(view) : [] })),
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
  // rec2 (CAb3acddf, Oct 30 12:10 PM ET): Twilio gets the 204 right away and never retries, so a restart while a recording is
  // downloading/transcribing (~2 min) lost the call. Each callback is journaled to data/pending-recordings until it finishes and resumed at boot.
  const pendingDir = path.join(apiRoot, "data/pending-recordings");
  const handleRecording = (body: any, leg: string) => {
    const { RecordingUrl, RecordingSid, CallSid, RecordingDuration } = body || {};
    if (!RecordingUrl || !RecordingSid || !/^RE[0-9a-zA-Z]{10,40}$/.test(String(RecordingSid))) return;
    const journal = path.join(pendingDir, `${RecordingSid}.json`);
    try { fs.mkdirSync(pendingDir, { recursive: true }); fs.writeFileSync(journal, JSON.stringify({ body, leg, at: Date.now() })); } catch {}
    const caller = callers.get(CallSid) || body?.From || "";
    if (blockedCaller(caller)) { // blocklist1: never score/ticket/SMS a blocked number
      logCall({ event: "recording_skipped_blocked", callSid: CallSid, caller, recordingSid: RecordingSid });
      try { fs.unlinkSync(journal); } catch {} return;
    }
    const callerChannel: 1 | 2 = leg === "queue" ? (process.env.TWILIO_QUEUE_CALLER_CHANNEL === "1" ? 1 : 2) : 1;
    (async () => {
      try {
        const buf = await download(`${RecordingUrl}.wav?RequestedChannels=2`);
        fs.mkdirSync(callsDir, { recursive: true });
        const file = path.join(callsDir, `${RecordingSid}.wav`);
        fs.writeFileSync(file, buf);
        const prev = segments.get(CallSid);
        const result = await scoreRecording(buf, `call-${String(CallSid).replace(/[^a-zA-Z0-9]/g, "").slice(-40)}${prev ? `-s${prev.files.length + 1}` : ""}`, shadowOrder, { callerChannel, before: prev?.turns });
        // maria3: an add-on callback's line points at the caller's earlier order (no Square ticket merge exists)
        try { if ((result.elviOrder as any)?.addOn) { const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); attachAddOnNote(result.elviOrder, caller, readCallEvents(logDir, [day]), Date.now(), CallSid); } } catch { /* note stays generic */ }
        const files = [...(prev?.files || []), path.relative(apiRoot, file)];
        segments.set(CallSid, { turns: result.turns, files, at: Date.now() });
        let name: string | null = callNames.get(CallSid) ?? ticketsByCall.get(CallSid)?.name ?? null;
        try { if (!name) name = await callerName(caller, findName, 2500); } catch { /* no name */ }
        // ordername1 (Carlos 10/24): bare / "De X" after name-ask → ticket + customer name log.
        // Pickup-only (lastPickupName, not contact): "para X" / "for X" / "la va a recoger" / picking-up.
        const heardInfo = nameFromTranscriptInfo(result.turns as any);
        // alexvoc1: a staff vocative the caller denied ("Alex, ¿no?" → "yo soy otro") is never the order name or memory.
        const heardOrderName0 = heardInfo?.name && !isNumberName(heardInfo.name) && !deniedVocative(result.turns as any, heardInfo.name) ? heardInfo.name : null;
        // giancarlo1: heard name that sounds like the caller's known name → known name; filler-led junk ("Allá en Carlos") → none.
        let heardOrderName: string | null = heardOrderName0;
        try { const mem = (JSON.parse(fs.readFileSync(path.join(logDir, "callers.json"), "utf8")) as any)[String(caller || "").replace(/\D/g, "").slice(-10)] || {}; heardOrderName = snapToKnownName(heardOrderName0, [mem.name, mem.lastPickupName]); } catch { /* keep heard */ }
        // mau1 (CAc68af8): no food ordered → never persist customerName / pickup name to memory
        const hasOrder = Array.isArray(result.elviOrder?.cart) && result.elviOrder.cart.length > 0;
        if (heardOrderName) {
          // Customer: bare name / "De Luis." after name-ask. Pickup-only: para/for/recoger (thirdPerson).
          const pickupOnly = !!heardInfo?.thirdPerson;
          let savedNow = false;
          const groupOrder = (heardInfo?.group?.length || 0) >= 2; // osmar1: multi-name group order → ticket labels only, no caller memory
          if (hasOrder && !groupOrder) {
            if (pickupOnly) {
              try { savePickupName(caller, heardOrderName); } catch { /* best effort */ }
              markOrderOnlyName(heardOrderName);
            } else if (!isTrainingCaller(caller)) {
              savedNow = rememberHeardNameIfNone(caller, heardOrderName);
              if (!savedNow) { try { savePickupName(caller, heardOrderName); } catch { /* best effort */ } } // still remember ticket name on phone
            }
          }
          logCall({ event: "order_name", callSid: CallSid, caller, name: heardOrderName, from: heardInfo?.source || "staff-ask", savedToMemory: savedNow, pickupOnly, noOrder: !hasOrder, ...(groupOrder ? { group: heardInfo!.group } : {}) });
          if (hasOrder) {
            name = cleanFirstName(heardOrderName) || name;
            callNames.set(CallSid, name);
            void sendNameFollowUp(CallSid, name).catch(() => {}); // smsname1
          }
        }
        if (name) callNames.set(CallSid, name);
        let lines: any[] = [];
        try { lines = (await describe(result.elviOrder?.cart || [])).map((l) => ({ name: l.name, quantity: l.quantity, choices: l.choices, totalCents: l.totalCents })); } catch { /* names only */ }
        const called = callLines.get(CallSid) || "";
        const ticket = await upsertTicket({
          callSid: CallSid,
          at: callStartedAt.get(CallSid) || ticketsByCall.get(CallSid)?.at || new Date().toISOString(),
          caller, name, receiptCode: receiptCode(CallSid),
          language: callLang.get(CallSid) || "es", phase: (result.elviOrder as any)?.statusCall ? "listening" : "final", training: isTrainingCaller(caller), // alexvoc1: status call never finalizes a ticket
          transcript: result.transcript,
          source: elviPhoneSource(called), phoneDisplay: formatTicketPhone(caller),
          fulfillment: "TO GO / LLEVAR",
          // delivery1: delivery vs pickup + address from the transcript (staff read-back counts).
          // mau1: no-order chat (empty cart) — do not lock DELIVERY/PICKUP or save fulfillment to memory
          ...((hasOrder ? await applyCallDelivery(CallSid, caller, result.turns as any, isTrainingCaller(caller)).catch(() => null) : null) || {}),
        }, describe, result.elviOrder?.cart || [], result.elviOrder);
        learnCallerLanguage(CallSid, caller, result.turns, callLang.get(CallSid));
        // rec3: a swept (late, lost-callback) recording never texts staff.
        if (!body?._swept) scheduleReadbackName(CallSid, caller, result.turns, Math.round(Math.max(0, ...result.turns.map((t) => t.end))));
        // namecheck1: Elvi's shadow order always carries the name she heard (practice for live orders).
        try { const hn = heardShadowName(result.turns as any, heardOrderName); if (hn && result.elviOrder) (result.elviOrder as any).customerName = hn; } catch {}
        if (Number(RecordingDuration) > 0) talkSecByCall.set(CallSid, Math.max(Number(RecordingDuration), talkSecByCall.get(CallSid) || 0));
        logCall({ event: "recording", callSid: CallSid, caller, name, greetingLanguage: callLang.get(CallSid), recordingSid: RecordingSid, durationSec: RecordingDuration, file: path.relative(apiRoot, file), segments: files.length, callerChannel, lines, ticketPhase: ticket.phase, ...result });
      } catch (e) {
        logCall({ event: "recording_error", callSid: CallSid, caller, recordingSid: RecordingSid, error: e instanceof Error ? e.message : String(e) });
      } finally { try { fs.unlinkSync(journal); } catch {} }
    })();
  };
  app.post("/api/twilio/recording", form, guard, (req, res) => {
    res.sendStatus(204); // ack fast; process in background (journaled)
    handleRecording(req.body, String(req.query.leg || ""));
  });
  if (process.env.NODE_ENV !== "test" && !process.env.TWILIO_TEST_AUDIO) setTimeout(() => {
    try {
      for (const f of fs.readdirSync(pendingDir).filter((x) => x.endsWith(".json"))) {
        const j = JSON.parse(fs.readFileSync(path.join(pendingDir, f), "utf8"));
        if (Date.now() - Number(j.at || 0) > 2 * 3600_000) { fs.unlinkSync(path.join(pendingDir, f)); continue; }
        logCall({ event: "recording_resumed", callSid: j.body?.CallSid, recordingSid: j.body?.RecordingSid });
        handleRecording(j.body, j.leg);
      }
    } catch { /* none pending */ }
    sweepLostRecordings().catch(() => {});
  }, 5000).unref?.();
  // rec3 (CA2fa762e / CAb3acddf, Oct 30): a restart kills an in-flight job begun on older code, or drops a callback that
  // arrives while the server is down (Twilio doesn't retry). Every 10 min (and at boot) find calls that ended 3–20 min ago
  // with no recording event or journal, and ingest their completed Twilio recording (read-only list; no staff SMS).
  async function sweepLostRecordings() {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;
    const ended = new Map<string, number>(), done = new Set<string>(), answered = new Set<string>();
    for (const d of [0, 1]) {
      const f = path.join(logDir, `${new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10)}.jsonl`);
      let txt = ""; try { txt = fs.readFileSync(f, "utf8"); } catch { continue; }
      for (const line of txt.split("\n")) { if (!line) continue; let j: any; try { j = JSON.parse(line); } catch { continue; }
        if (!j.callSid) continue;
        if (j.event === "ring_end") ended.set(j.callSid, Date.parse(j.ts));
        if (j.event === "answered") answered.add(j.callSid);
        if (j.event === "blocked_no_order") done.add(j.callSid); // blocklist1
        if (/^recording/.test(String(j.event))) done.add(j.callSid); }
    }
    let pend = ""; try { pend = fs.readdirSync(pendingDir).map((f) => fs.readFileSync(path.join(pendingDir, f), "utf8")).join(" "); } catch {}
    for (const [sid, at] of ended) {
      const age = Date.now() - at;
      if (!answered.has(sid) || done.has(sid) || age < 3 * 60_000 || age > 20 * 60_000 || pend.includes(sid)) continue;
      try {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings.json?CallSid=${sid}`, { headers: { Authorization: twAuth() }, signal: AbortSignal.timeout(15_000) });
        const rec = ((await r.json()) as any).recordings?.find((x: any) => x.status === "completed");
        if (!rec) continue;
        logCall({ event: "recording_swept", callSid: sid, recordingSid: rec.sid });
        handleRecording({ RecordingUrl: `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${rec.sid}`, RecordingSid: rec.sid, CallSid: sid, RecordingDuration: rec.duration, _swept: "1" }, "");
      } catch { /* try next sweep */ }
    }
  }
  if (process.env.NODE_ENV !== "test" && !process.env.TWILIO_TEST_AUDIO) setInterval(() => { sweepLostRecordings().catch(() => {}); }, 10 * 60_000).unref?.();

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

/** loop2: our ring legs always dial out FROM our Twilio line (callerid 21210 fix), so a real loop arrives From one of
 *  our lines (or diverted from a ring phone, or echoes while its own legs ring). A staff cell dialing the line
 *  directly is a normal caller — the old "From is a ring number" rule rejected those (2:12 PM 2026-10-20). */
export function isLoopCall(o: { from: string; fwdFrom?: string; lines: string[]; ringSet: Set<string>; echo?: boolean }): boolean {
  const d = (x: string) => String(x || "").replace(/\D/g, "").slice(-10);
  const from = d(o.from), fwd = d(o.fwdFrom || "");
  return (!!from && o.lines.some((l) => d(l) === from)) || (!!fwd && o.ringSet.has(fwd)) || !!o.echo;
}
