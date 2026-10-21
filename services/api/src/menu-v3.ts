// v3menu: data for the browsable-menu PREVIEW (order.cocinaelvis.app/?menu=v3). Read-only, no PII.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSiteCatalog, currentTime } from "./site-catalog.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], DAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toMin = (hhmm: string) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };
const fmt = (m: number) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${h % 12 || 12}:${String(mm).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`; };
function zoned(now: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday)), minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export type StoreState = { state: "open" | "last_order" | "before_open" | "closed"; prepMinutes: number; pill: { es: string; en: string }; banner: { es: string; en: string } | null;
  schedule?: { at: string; es: string; en: string } | null;
  hours: Array<{ day: string; es: string; en: string; open: string | null; close: string | null }>; lastOrder: string | null; nextOpen: { es: string; en: string } | null };
/** PREVIEW-ONLY hours override (relayed by the designer from Carlos, 2026-10-21, to confirm): weekends 10am–8pm
 *  (Cash App is right; Square will be updated). Live phone hours still come from Square's site catalog. */
export const PREVIEW_HOURS: Record<string, { open: string; close: string }> = { SAT: { open: "10:00", close: "20:00" }, SUN: { open: "10:00", close: "20:00" } };
/** Store state from the website's pickup hours (same source Elvi uses) and its prep time. Last order = close − prep. */
function storeStateInner(now = currentTime(), catalog = loadSiteCatalog()): StoreState | null {
  const store = catalog?.store; if (!store?.pickupHours) return null;
  const prep = Number(store.prepMinutes) || 20, tz = store.timezone || "America/New_York";
  const { day, minutes } = zoned(now, tz);
  const win = (d: number) => (PREVIEW_HOURS as any)[DAYS[d]] || (store.pickupHours as any)[DAYS[d]]?.[0] || null;
  const hours = DAYS.map((_, d) => { const w = win(d); return { day: DAYS[d], es: DAY_ES[d], en: DAY_EN[d], open: w ? fmt(toMin(w.open)) : null, close: w ? fmt(toMin(w.close)) : null }; });
  const next = (() => { for (let i = 1; i <= 7; i++) { const d = (day + i) % 7, w = win(d); if (w) return { es: `abrimos ${DAY_ES[d]} ${fmt(toMin(w.open))}`, en: `we open ${DAY_EN[d]} ${fmt(toMin(w.open))}` }; } return null; })();
  const w = win(day);
  if (!w) return { state: "closed", prepMinutes: prep, pill: { es: "Cerrado", en: "Closed" }, banner: next ? { es: `Hoy cerrado — ${next.es}`, en: `Closed today — ${next.en}` } : null, hours, lastOrder: null, nextOpen: next };
  const open = toMin(w.open), close = toMin(w.close), last = close - prep;
  if (minutes < open) return { state: "before_open", prepMinutes: prep, pill: { es: `Abre ${fmt(open)}`, en: `Opens ${fmt(open)}` }, banner: { es: `Abrimos hoy a las ${fmt(open)}`, en: `We open today at ${fmt(open)}` }, hours, lastOrder: fmt(last), nextOpen: { es: `hoy ${fmt(open)}`, en: `today ${fmt(open)}` } };
  if (minutes >= last) return { state: "closed", prepMinutes: prep, pill: { es: "Cerrado", en: "Closed" }, banner: next ? { es: `Ya cerramos por hoy — ${next.es}`, en: `Closed for today — ${next.en}` } : null, hours, lastOrder: fmt(last), nextOpen: next };
  if (minutes >= close - 2 * prep) return { state: "last_order", prepMinutes: prep, pill: { es: `Último pedido ${fmt(last)}`, en: `Last order ${fmt(last)}` }, banner: { es: `Último pedido a las ${fmt(last)} (preparamos en ${prep} min)`, en: `Last order at ${fmt(last)} (${prep}-min prep)` }, hours, lastOrder: fmt(last), nextOpen: null };
  return { state: "open", prepMinutes: prep, pill: { es: `Abierto · cierra ${fmt(close)}`, en: `Open · closes ${fmt(close)}` }, banner: null, hours, lastOrder: fmt(last), nextOpen: null };
}
const norm = (s: string) => String(s || "").replace(/\s*\(ONLINE\)\s*/i, "").trim().toLowerCase();
/** Popular = paid online orders (data/learning/online-orders.json, refreshed hourly) + phone orders matched to a Square
 *  ticket (data/learning/examples.jsonl correct orders, rebuilt nightly). Item counts only; returns product names, best first. */
export function popularProducts(productNames: string[], n = 6): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  const add = (name: string, q: number) => { const k = norm(name); const hit = productNames.find((p) => norm(p) === k); if (hit) counts.set(hit, (counts.get(hit) || 0) + q); };
  try { const o = JSON.parse(fs.readFileSync(path.join(root, "data/learning/online-orders.json"), "utf8")); for (const it of o.items || []) add(it.name, Number(it.count) || 0); } catch { /* none yet */ }
  try { for (const l of fs.readFileSync(path.join(root, "data/learning/examples.jsonl"), "utf8").split("\n")) { if (!l.trim()) continue; const e = JSON.parse(l); if (e.channel !== "phone") continue; for (const t of e.truthLines || []) add(t.baseName, Number(t.quantity) || 1); } } catch { /* none yet */ }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
}

/** Store state + a scheduled-pickup option when closed / before opening (preview: pickup at the next opening). */
export function storeState(now = currentTime(), catalog = loadSiteCatalog()): StoreState | null {
  const st = storeStateInner(now, catalog); if (!st) return st;
  if (st.state === "open" || st.state === "last_order") return { ...st, schedule: null };
  const store: any = catalog?.store, tz = store?.timezone || "America/New_York"; const { day, minutes } = zoned(now, tz);
  const win = (d: number) => (PREVIEW_HOURS as any)[DAYS[d]] || store.pickupHours[DAYS[d]]?.[0] || null;
  for (let i = st.state === "before_open" ? 0 : 1; i <= 7; i++) { const d = (day + i) % 7, ww = win(d); if (!ww) continue;
    const at = new Date(now.getTime() + (i * 1440 + toMin(ww.open) - minutes) * 60000); at.setUTCSeconds(0, 0);
    return { ...st, schedule: { at: at.toISOString(), es: `Programar para ${DAY_ES[d]} ${fmt(toMin(ww.open))}`, en: `Schedule for ${DAY_EN[d]} ${fmt(toMin(ww.open))}` } }; }
  return { ...st, schedule: null };
}
