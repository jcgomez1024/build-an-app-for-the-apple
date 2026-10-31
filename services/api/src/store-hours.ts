// dayana1 (CAa36f03b, Oct 30 ~7:59 PM ET): "¿a qué hora cierra?" → Elvi said she didn't know. The real store hours live in
// data/phone-hours.json (hours2, Carlos Oct 19) — the same file the phone's after-hours message uses (store close, not phone cutoff).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const STORE_HOURS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/phone-hours.json");
type HoursFile = { timezone?: string; hours: Record<string, Array<{ open: string; close: string }>> };
const KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const ES_D = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"], EN_D = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let cache: { m: number; d: HoursFile | null } = { m: -1, d: null };
export function loadStoreHours(file = STORE_HOURS_FILE): HoursFile | null {
  try { const st = fs.statSync(file); if (st.mtimeMs !== cache.m) cache = { m: st.mtimeMs, d: JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { return cache.d; }
  return cache.d;
}
const hm = (s: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const ES_H = ["doce", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once"];
const es = (n: number) => { const h = Math.floor(n / 60), m = n % 60; return `${h % 12 === 1 ? "la" : "las"} ${ES_H[h % 12]}${m ? (m === 30 ? " y media" : ` y ${m}`) : ""} de la ${h < 12 ? "mañana" : h < 19 ? "tarde" : "noche"}`; };
const en = (n: number) => { const h = Math.floor(n / 60), m = n % 60; return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`; };
export const HOURS_Q = /\b(?:a\s+qu[eé]\s+hora\s+(?:cierra|cierran|abre|abren|close|open)\w*|qu[eé]\s+horario|horario|hasta\s+qu[eé]\s+hora|what\s+time\s+(?:do|does|are)\s+(?:you|y'?all|they|it|the\s+\w+)\s+(?:close|open)|when\s+do\s+(?:you|y'?all)\s+(?:close|open)|(?:your|store|the)\s+hours|how\s+late\s+(?:are|do)\s+(?:you|y'?all))\b/iu;
function nowET(now: Date) { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value || ""; return { wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")), min: (Number(g("hour")) % 24) * 60 + Number(g("minute")) }; }
/** Today's store hours as a sentence (null when the file is missing — never guess). */
export function hoursAnswer(text: string, lang: string | undefined, now = new Date(), cfg = loadStoreHours()): string | null {
  if (!cfg?.hours) return null;
  const { wd, min } = nowET(now); const day = cfg.hours[KEYS[wd]]; const isEn = lang === "en";
  const opens = /\babr[ea]n?\b|\bopen\b/i.test(text) && !/\bcierra|\bclose/i.test(text);
  if (!day || !day.length) {
    let n = 1; while (n < 7 && !(cfg.hours[KEYS[(wd + n) % 7]] || []).length) n++; const nx = cfg.hours[KEYS[(wd + n) % 7]]?.[0]; if (!nx) return null;
    return isEn ? `We're closed today. We open ${EN_D[(wd + n) % 7]} at ${en(hm(nx.open))}.` : `Hoy estamos cerrados. Abrimos el ${ES_D[(wd + n) % 7]} a ${es(hm(nx.open))}.`;
  }
  const o = Math.min(...day.map((w) => hm(w.open))), c = Math.max(...day.map((w) => hm(w.close)));
  if (opens && min < o) return isEn ? `We open today at ${en(o)} and close at ${en(c)}.` : `Hoy abrimos a ${es(o)} y cerramos a ${es(c)}.`;
  return isEn ? `Today we're open until ${en(c)}.` : `Hoy cerramos a ${es(c)}.`;
}
/** Live: an hours question whose reply has no time ("no sé la hora…") gets the real hours. */
export function noUnknownHours(r: any, input: any, now = new Date()) {
  const tx = String(input?.transcript || ""); if (!HOURS_Q.test(tx)) return r;
  const reply = String(r?.reply || "");
  if (/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b.*\b(?:close|open|cerr|abr)|\b(?:cerramos|abrimos|close at|open until|open at)\b/i.test(reply) && !/\bno\s+(?:s[eé]|tengo)|\bdon'?t\s+know|\bnot\s+sure/i.test(reply)) return r;
  const a = hoursAnswer(tx, input?.language, now); if (!a) return r;
  return { ...r, reply: `${a} ${input?.language === "en" ? "Anything else?" : "¿Algo más?"}` };
}
