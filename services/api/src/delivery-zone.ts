// delivery1: delivery zone / fee / ETA from data/delivery.json. Geocodes with the free US Census geocoder (no key),
// cached in data/logs/geocode-cache.json (gitignored: addresses are personal data). On any failure → needsConfirm.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addressKey } from "./delivery.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DELIVERY_FILE = path.join(apiRoot, "data/delivery.json");
const cacheFile = process.env.ELVI_GEOCODE_CACHE || path.join(apiRoot, "data/logs/geocode-cache.json");
type Zone = { id: string; label: string; maxMiles: number; feeCents: number; etaExtraMinutes: number; confirmed?: boolean };
export type DeliveryConfig = { origin: { lat: number; lng: number }; zones: Zone[]; maxMiles: number; subtotalMinimumCents?: number; prepMinutesDefault?: number };
export type Quote = {
  ok: boolean; needsConfirm: boolean; reason?: "no_address" | "geocode_failed" | "out_of_range" | "pending";
  miles?: number; zone?: string; zoneLabel?: string; feeCents?: number; etaMinutes?: number; matched?: string;
  message: { es: string; en: string };
};

export function loadDeliveryConfig(): DeliveryConfig {
  return JSON.parse(fs.readFileSync(DELIVERY_FILE, "utf8"));
}
function prepMinutes(cfg: DeliveryConfig): number {
  try { return Number(JSON.parse(fs.readFileSync(path.join(apiRoot, "data/site-catalog.json"), "utf8"))?.store?.prepMinutes) || cfg.prepMinutesDefault || 20; }
  catch { return cfg.prepMinutesDefault || 20; }
}
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8, r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
/** Zone/fee/ETA for a distance (pure; used by tests and after geocoding). */
export function quoteForMiles(miles: number, cfg = loadDeliveryConfig()): Quote {
  const z = [...cfg.zones].sort((a, b) => a.maxMiles - b.maxMiles).find((x) => miles <= x.maxMiles && miles <= cfg.maxMiles);
  const mi = Math.round(miles * 10) / 10;
  if (!z) return { ok: false, needsConfirm: true, reason: "out_of_range", miles: mi,
    message: { es: `Esa dirección está a ${mi} millas, fuera de nuestra zona de entrega. ¿Lo quiere para recoger?`, en: `That address is ${mi} miles away, outside our delivery area. Would you like pickup instead?` } };
  const eta = prepMinutes(cfg) + z.etaExtraMinutes;
  return { ok: true, needsConfirm: false, miles: mi, zone: z.id, zoneLabel: z.label, feeCents: z.feeCents, etaMinutes: eta,
    message: { es: `La entrega cuesta ${money(z.feeCents)} y llega en unos ${eta} minutos.`, en: `Delivery is ${money(z.feeCents)} and takes about ${eta} minutes.` } };
}
const CONFIRM: Quote["message"] = { es: "No pude ubicar la dirección. Confirme la zona de entrega con el personal.", en: "I couldn't locate that address. Please confirm the delivery zone with staff." };

type Cached = { lat: number; lng: number; matched: string; at: string } | { fail: true; at: string };
function readCache(): Record<string, Cached> { try { return JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { return {}; } }
function writeCache(c: Record<string, Cached>) { try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(c, null, 2)); } catch { /* cache only */ } }
const cacheKey = (address: string) => String(address || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const withState = (a: string) => (/\b(oh|ohio)\b|\b44\d{3}\b/i.test(a) ? a : `${a}, ${/painesville|mentor|fairport|concord|perry|madison|willoughby|grand river|leroy|kirtland|chardon|eastlake|wickliffe|geneva/i.test(a) ? "" : "Painesville, "}OH`);

/** Sync: quote from the geocode cache only (null when not looked up yet). */
export function cachedQuote(address: string): Quote | null {
  if (!String(address || "").trim()) return { ok: false, needsConfirm: true, reason: "no_address", message: { es: "¿A qué dirección se lo llevamos?", en: "What's the delivery address?" } };
  const c = readCache()[cacheKey(withState(address))];
  if (!c) return null;
  if ("fail" in c) return { ok: false, needsConfirm: true, reason: "geocode_failed", message: CONFIRM };
  return { ...quoteForMiles(milesBetween(loadDeliveryConfig().origin, c), loadDeliveryConfig()), matched: c.matched };
}

/** Geocode (Census, ~3 s timeout, cached; failures cached 1 day) → quote. Never throws. */
export async function quoteDeliveryAddress(address: string, fetcher: typeof fetch = fetch): Promise<Quote> {
  const hit = cachedQuote(address);
  if (hit) {
    const c = readCache()[cacheKey(withState(address))];
    const staleFail = c && "fail" in c && Date.now() - Date.parse(c.at) > 86400000;
    if (!staleFail) return hit;
  }
  const q = withState(address);
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(q)}`;
    const r = await fetcher(url, { signal: ctl.signal }); clearTimeout(t);
    const j: any = r.ok ? await r.json() : null;
    const m = j?.result?.addressMatches?.[0];
    const cache = readCache();
    if (!m?.coordinates) { cache[cacheKey(q)] = { fail: true, at: new Date().toISOString() }; writeCache(cache); return { ok: false, needsConfirm: true, reason: "geocode_failed", message: CONFIRM }; }
    cache[cacheKey(q)] = { lat: m.coordinates.y, lng: m.coordinates.x, matched: String(m.matchedAddress || ""), at: new Date().toISOString() };
    writeCache(cache);
    return cachedQuote(address)!;
  } catch {
    return { ok: false, needsConfirm: true, reason: "geocode_failed", message: CONFIRM }; // network error: not cached
  }
}
export { addressKey };
