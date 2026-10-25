// Repeat callers: remembered language (detected from speech) and first name (manual or Square, read-only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const logDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/logs/calls");
const file = process.env.ELVI_CALLERS_FILE || path.join(logDir, "callers.json"); // delivery1: override for tests
export const phoneKey = (p: unknown) => String(p || "").replace(/\D/g, "").slice(-10);

export type NameSource = "manual" | "ticket" | "readback" | "elvi" | "square"; // ordername1: elvi = heard by Elvi on the order
type Caller = { language?: "es" | "en"; languageFrom?: "speech" | "manual" | "key"; languageSetBy?: string; languageSetAt?: string; name?: string; nameFrom?: NameSource; nameSource?: NameSource; nameUpdatedAt?: string; nameHistory?: Record<string, number>; lastPickupName?: string; lastPickupAt?: string; calls?: number; lastCall?: string;
  // delivery1: delivery addresses per phone (personal data — this file is gitignored). Newest first, max 5.
  addresses?: SavedAddress[]; lastFulfillment?: "DELIVERY" | "PICKUP" | "FOR_HERE"; lastFulfillmentAt?: string;
  // callerprofile1: staff-entered delivery details (personal data, gitignored). photo = file id in data/logs/calls/caller-photos.
  delivery?: DeliveryProfile };
export type DeliveryProfile = { unitNote?: string; instructions?: string; photo?: string; updatedAt?: string };
export type SavedAddress = { address: string; street: string; firstUsedAt: string; lastUsedAt: string; uses: number };
// names1: lower = stronger. A manual name is never replaced automatically; call readback > ticket > Square lookup.
const NAME_RANK: Record<NameSource, number> = { manual: 0, readback: 1, elvi: 1, ticket: 2, square: 3 }; // names3: the call beats a rushed ticket
const JUNK = /^(receipt|recibo|cliente|customer|guest|invitado|to ?go|para llevar|llevar|pick ?up|walk ?in|online|order|orden|pedido|test|prueba|unknown|desconocido|n\/?a|none|cocina elvis|elvi|hasta(\s+luego)?|nos\s+vemos|good\s*bye|bye(\s*bye)?|cu[ií]date|chao|chau|adi[oó]s)\b/i;
/** Full name as typed, trimmed and Title Cased; null for junk (digits only, Receipt/Cliente/Guest/TO GO, 1 letter, >40 chars). */
export function cleanFullName(raw: string | null | undefined): string | null {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 40) return null;
  if (!/\p{L}{2,}/u.test(s) || /^[\d\s#().+-]+$/.test(s) || /#\s*\d|\d{3,}/.test(s)) return null;
  if (JUNK.test(s)) return null;
  if (!cleanFirstName(s)) return null;
  return s.toLocaleLowerCase("es").replace(/(^|[\s'’-])(\p{L})/gu, (_m, a, b) => a + b.toLocaleUpperCase("es"));
}
const isTrainingNumber = (phone: string) => String(process.env.TWILIO_TRAINING_CALLERS || "").split(",").map(phoneKey).filter(Boolean).includes(phone);
/** names1: what saveCallerName would do (no write). */
export function planCallerName(phoneRaw: string, raw: string | null | undefined, source: NameSource): { save: boolean; reason: string; name?: string; previous?: string; previousSource?: NameSource } {
  const phone = phoneKey(phoneRaw);
  if (phone.length !== 10) return { save: false, reason: "no-number" };
  const name = cleanFullName(raw);
  if (!name) return { save: false, reason: "junk-name" };
  const c = readAll()[phone] || {};
  const prevSrc = (c.nameSource || c.nameFrom) as NameSource | undefined;
  const base = { name, previous: c.name, previousSource: prevSrc };
  if (source !== "manual" && isTrainingNumber(phone) && !c.name) return { save: false, reason: "training-caller", ...base };
  if (prevSrc === "manual" && source !== "manual") return { save: false, reason: "manual-kept", ...base };
  if (prevSrc && NAME_RANK[source] > NAME_RANK[prevSrc]) return { save: false, reason: `weaker-than-${prevSrc}`, ...base };
  if (c.name === name && prevSrc === source) return { save: false, reason: "unchanged", ...base };
  // names3 flip-flop guard: a different call-heard name replaces a call-heard name only once heard on 2 calls.
  if (source === "readback" && prevSrc === "readback" && c.name && c.name !== name && (c.nameHistory?.[name] || 0) < 1) return { save: false, reason: "flipflop-pending", ...base };
  return { save: true, reason: "ok", ...base };
}
/** names1: persist a caller name (full name stored; greetings use the first name). Returns the saved name or null. */
export function saveCallerName(phoneRaw: string, raw: string | null | undefined, source: NameSource): string | null {
  const plan = planCallerName(phoneRaw, raw, source);
  if (!plan.save || !plan.name) return null;
  const all = readAll(); const phone = phoneKey(phoneRaw); const c = all[phone] || {};
  c.name = plan.name; c.nameSource = source; c.nameUpdatedAt = new Date().toISOString();
  if (source === "manual") c.nameFrom = "manual"; else if (c.nameFrom === "manual") delete c.nameFrom;
  all[phone] = c; writeAll(all);
  return plan.name;
}
/** names3: count a "self" name heard on a call (feeds the flip-flop guard). Keeps the 6 most-heard names. */
export function noteReadbackName(phoneRaw: string, raw: string): void {
  const name = cleanFullName(raw); const phone = phoneKey(phoneRaw);
  if (!name || phone.length !== 10) return;
  const all = readAll(); const c = all[phone] || {};
  const h = { ...(c.nameHistory || {}) }; h[name] = (h[name] || 0) + 1;
  c.nameHistory = Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 6));
  all[phone] = c; writeAll(all);
}
/** names3: someone else picks up ("a nombre de Mónica, ella va a recoger") — remembered, NEVER used to greet. */
export function savePickupName(phoneRaw: string, raw: string): string | null {
  const name = cleanFullName(raw); const phone = phoneKey(phoneRaw);
  if (!name || phone.length !== 10) return null;
  const all = readAll(); const c = all[phone] || {};
  c.lastPickupName = name; c.lastPickupAt = new Date().toISOString();
  all[phone] = c; writeAll(all);
  return name;
}
export function savedCallerName(phoneRaw: string): { name: string; source: NameSource } | null {
  const c = readAll()[phoneKey(phoneRaw)];
  const src = (c?.nameSource || c?.nameFrom) as NameSource | undefined;
  return c?.name && src ? { name: c.name, source: src } : null;
}
function readAll(): Record<string, Caller> { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } }
function writeAll(all: Record<string, Caller>) { fs.mkdirSync(logDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(all, null, 2)); }

/** Earlier calls from this number in the call log (excluding the current call). */
function earlierCalls(phone: string, exceptCallSid?: string): { count: number; language?: "es" | "en" } {
  if (!fs.existsSync(logDir)) return { count: 0 };
  const sids = new Set<string>(); let language: "es" | "en" | undefined;
  for (const f of fs.readdirSync(logDir).filter((x) => x.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(logDir, f), "utf8").split("\n")) {
      if (!line.includes(phone)) continue;
      let e: any; try { e = JSON.parse(line); } catch { continue; }
      if (phoneKey(e.caller) !== phone || !e.callSid || e.callSid === exceptCallSid || /^CAtest/i.test(e.callSid)) continue;
      sids.add(e.callSid);
      if (e.event === "language" && String(e.heard || "").trim()) language = e.language; // only a language heard from speech
    }
  }
  return { count: sids.size, language };
}

export function knownCaller(phoneRaw: string, exceptCallSid?: string) {
  const phone = phoneKey(phoneRaw);
  if (!phone) return { known: false, language: undefined as "es" | "en" | undefined, manualName: undefined as string | undefined };
  const saved = readAll()[phone];
  const log = earlierCalls(phone, exceptCallSid);
  const language = saved?.languageFrom === "speech" ? saved.language : log.language;
  return { known: log.count > 0, language, manualName: saved?.nameFrom === "manual" ? saved.name : undefined };
}

export function rememberCaller(phoneRaw: string, update: { language?: "es" | "en"; heardSpeech?: boolean }) {
  const phone = phoneKey(phoneRaw);
  if (!phone) return;
  const all = readAll();
  const c = all[phone] || {};
  // lang2: a staff-set (manual) language is never overwritten by speech / auto detection.
  if (update.language && update.heardSpeech && c.languageFrom !== "manual") { c.language = update.language; c.languageFrom = "speech"; }
  c.calls = (c.calls || 0) + (update.heardSpeech === undefined ? 1 : 0);
  c.lastCall = new Date().toISOString();
  all[phone] = c;
  writeAll(all);
}

/** lang2: staff set the language on calls.html — wins over automatic changes. */
export function setCallerLanguageManual(phoneRaw: string, language: "es" | "en", by: string): { from: "es" | "en" | null } {
  const phone = phoneKey(phoneRaw); if (!phone) return { from: null };
  const all = readAll(); const c = all[phone] || {}; const from = c.language || null;
  c.language = language; c.languageFrom = "manual"; c.languageSetBy = by; c.languageSetAt = new Date().toISOString();
  all[phone] = c; writeAll(all); return { from };
}
/** lang2: the caller pressed 2 / 1 — their own choice; saved unless staff set it manually. */
export function setCallerLanguageKey(phoneRaw: string, language: "es" | "en"): boolean {
  const phone = phoneKey(phoneRaw); if (!phone) return false;
  const all = readAll(); const c = all[phone] || {};
  if (c.languageFrom === "manual") return false;
  c.language = language; c.languageFrom = "key"; all[phone] = c; writeAll(all); return true;
}
export function savedLanguage(phoneRaw: string): { language: "es" | "en" | null; from: string | null; by?: string; at?: string } {
  const c = readAll()[phoneKey(phoneRaw)];
  return { language: c?.language || null, from: c?.languageFrom || null, by: c?.languageSetBy, at: c?.languageSetAt };
}

/** First name only, and only if it looks like a real name (no digits, no "cliente", "test", business words). */
export function cleanFirstName(raw: string | null | undefined): string | null {
  const first = String(raw || "").trim().split(/[\s,]+/)[0] || "";
  if (!/^[\p{L}][\p{L}'’-]{1,19}$/u.test(first)) return null;
  if (/^(cliente|customer|guest|test|prueba|unknown|desconocido|cocina|elvis|mr|mrs|ms|sr|sra|srta|dr|n\/?a|none|na|xx+)$/i.test(first)) return null;
  return first.toLocaleLowerCase("es").replace(/(^|[-'’])(\p{L})/gu, (_m, a, b) => a + b.toLocaleUpperCase("es"));
}

// Square name cache (incl. "no customer") so a call never waits on Square twice.
/** names1: twilio.ts hooks this to log caller_name_saved and pre-generate the greeting clip. */
export let onNameSaved: ((phone: string, name: string, source: NameSource) => void) | null = null;
export function setOnNameSaved(fn: typeof onNameSaved) { onNameSaved = fn; }
const nameCache = new Map<string, { name: string | null; at: number }>();
const inflight = new Map<string, Promise<string | null>>();
const TTL = 12 * 60 * 60 * 1000, NEG_TTL = 60 * 60 * 1000;

export async function callerName(phoneRaw: string, lookup: (e164: string, signal: AbortSignal) => Promise<string | null>, timeoutMs = 900): Promise<string | null> {
  const phone = phoneKey(phoneRaw);
  if (phone.length !== 10) return null;
  const manual = knownCaller(phoneRaw).manualName;
  if (manual) return cleanFirstName(manual);
  // names1: a saved ticket/Elvi/Square name survives restarts and the 12 h cache.
  const saved = savedCallerName(phoneRaw);
  if (saved && saved.source !== "square") return cleanFirstName(saved.name);
  const hit = nameCache.get(phone);
  if (hit && Date.now() - hit.at < (hit.name ? TTL : NEG_TTL)) return hit.name;
  let p = inflight.get(phone);
  if (!p) {
    const ctl = new AbortController();
    const kill = setTimeout(() => ctl.abort(), 5000); // background fetch may finish after the call's timeout and fill the cache
    p = lookup(`+1${phone}`, ctl.signal).then((n) => {
      const name = cleanFirstName(n); nameCache.set(phone, { name, at: Date.now() });
      if (n) { try { const s = saveCallerName(phoneRaw, n, "square"); if (s) onNameSaved?.(phoneRaw, s, "square"); } catch { /* best effort */ } }
      return name || (saved ? cleanFirstName(saved.name) : null);
    })
      .catch(() => null).finally(() => { clearTimeout(kill); inflight.delete(phone); });
    inflight.set(phone, p);
  }
  const got = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
  return got || (saved ? cleanFirstName(saved.name) : null);
}

// ---- delivery1: fulfillment + address history per caller ----
const addrKey = (a: string) => String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3).join(" ");
/** Remember how this caller ordered (and where to, for delivery). Address history keeps last-used date and a use count. */
export function saveCallerFulfillment(phoneRaw: string, fulfillment: "DELIVERY" | "PICKUP" | "FOR_HERE", address?: { full: string; street: string } | null, at = new Date()) {
  const phone = phoneKey(phoneRaw);
  if (!phone) return;
  const all = readAll();
  const c = all[phone] || {};
  c.lastFulfillment = fulfillment; c.lastFulfillmentAt = at.toISOString();
  if (fulfillment === "DELIVERY" && address?.full) {
    const list = c.addresses || [];
    const k = addrKey(address.street || address.full);
    const hit = list.find((x) => addrKey(x.street || x.address) === k);
    if (hit) { hit.uses += 1; hit.lastUsedAt = at.toISOString(); if (address.full.length >= hit.address.length) hit.address = address.full; }
    else list.push({ address: address.full, street: address.street, firstUsedAt: at.toISOString(), lastUsedAt: at.toISOString(), uses: 1 });
    c.addresses = list.sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt)).slice(0, 5);
  }
  all[phone] = c;
  writeAll(all);
}
export const PHOTO_DIR = path.join(logDir, "caller-photos");
/** callerprofile1: save staff-entered delivery details (unit/building, instructions, photo id) for a phone. */
export function saveDeliveryProfile(phoneRaw: string, p: DeliveryProfile) {
  const phone = phoneKey(phoneRaw);
  if (phone.length !== 10) throw new Error("no number");
  const all = readAll(); const c = all[phone] || {};
  const clean = (s?: string) => (s == null ? undefined : String(s).replace(/\s+/g, " ").trim().slice(0, 300) || undefined);
  c.delivery = { ...(c.delivery || {}), ...Object.fromEntries(Object.entries({ unitNote: clean(p.unitNote), instructions: clean(p.instructions), photo: p.photo && /^[a-z0-9]{12,40}$/i.test(p.photo) ? p.photo : undefined }).filter(([, v]) => v !== undefined)), updatedAt: new Date().toISOString() };
  all[phone] = c; writeAll(all);
  return c.delivery;
}
export const deliveryProfile = (phoneRaw: string): DeliveryProfile | null => readAll()[phoneKey(phoneRaw)]?.delivery || null;
/** Ticket/console text: "<unit note> · <instructions>". */
export const deliveryProfileNote = (p: DeliveryProfile | null) => [p?.unitNote, p?.instructions].filter(Boolean).join(" · ");

/** What we know for a ringing caller: last fulfillment + last-used address (phone side only — the caller ID is the identity). */
export function savedDelivery(phoneRaw: string): { lastFulfillment: "DELIVERY" | "PICKUP" | "FOR_HERE" | null; lastFulfillmentAt: string | null; address: SavedAddress | null; addressCount: number } {
  const c = readAll()[phoneKey(phoneRaw)];
  return { lastFulfillment: c?.lastFulfillment || null, lastFulfillmentAt: c?.lastFulfillmentAt || null, address: c?.addresses?.[0] || null, addressCount: c?.addresses?.length || 0 };
}
