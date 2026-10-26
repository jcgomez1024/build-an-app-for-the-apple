// delivery1/delivery2/fees1/fees2 (distance-only tiers, no city rule): delivery zone / fee / ETA from data/delivery.json. Geocodes with the free US Census geocoder
// (no key) incl. the incorporated place (city) — ZIP alone is not enough (44077 also covers Painesville Twp).
// Cached in data/logs/geocode-cache.json (gitignored: addresses are personal data). On any doubt → needsConfirm.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addressKey } from "./delivery.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DELIVERY_FILE = path.join(apiRoot, "data/delivery.json");
const cacheFile = process.env.ELVI_GEOCODE_CACHE || path.join(apiRoot, "data/logs/geocode-cache.json");
type Zone = { id: string; label: string; feeCents: number; etaMinutes: number; maxMiles: number; requirePlace?: string; feeConfirmed?: boolean; serviceFee?: boolean };
export type DeliveryConfig = { origin: { lat: number; lng: number }; zones: Zone[]; maxMiles: number; subtotalMinimumCents?: number; serviceFeeCents?: number };
export type Quote = {
  ok: boolean; needsConfirm: boolean; reason?: "no_address" | "geocode_failed" | "out_of_range" | "place_unknown" | "pending";
  miles?: number; zone?: string; zoneLabel?: string; feeCents?: number; etaMinutes?: number; matched?: string;
  place?: string | null; city?: string | null; inCity?: boolean | null; minimumCents?: number; feeConfirmed?: boolean;
  /** fees1: feeCents = deliveryCents + serviceCents (total charged). breakdown e.g. "Envío $6.99 + servicio $1.00 = $7.99". */
  deliveryCents?: number; serviceCents?: number; breakdown?: string;
  message: { es: string; en: string };
};

export function loadDeliveryConfig(): DeliveryConfig { return JSON.parse(fs.readFileSync(DELIVERY_FILE, "utf8")); }
export const deliveryMinimumCents = (cfg = loadDeliveryConfig()) => cfg.subtotalMinimumCents ?? 1000;
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8, r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
/** "Painesville city" → "Painesville"; "Painesville township" → "Painesville Twp". */
export const cityName = (place: string | null | undefined) => !place ? null : String(place).replace(/\s+city$/i, "").replace(/\s+township$/i, " Twp").replace(/\s+village$/i, "").trim();

/** Zone/fee/ETA for a distance + Census place (pure). place = incorporated place or county subdivision NAME; null = unknown. */
export function quoteFor(miles: number, place: string | null, cfg = loadDeliveryConfig()): Quote {
  const mi = Math.round(miles * 10) / 10;
  const city = cityName(place);
  const minimumCents = deliveryMinimumCents(cfg);
  if (miles > cfg.maxMiles) return { ok: false, needsConfirm: false, reason: "out_of_range", miles: mi, place, city, minimumCents,
    message: { es: `Lo sentimos, esa dirección está fuera del área de entrega (${mi} millas). ¿Lo quiere para recoger?`, en: `Sorry, that address is outside our delivery area (${mi} miles). Would you like pickup instead?` } };
  const zones = [...cfg.zones];
  const near = zones.find((z) => z.requirePlace);
  // $5 only inside the required city AND within its radius; unknown place inside the radius → staff confirm.
  if (near && miles <= near.maxMiles && !place) return { ok: false, needsConfirm: true, reason: "place_unknown", miles: mi, place: null, city: null, inCity: null, minimumCents,
    message: { es: "No pude confirmar la ciudad de esa dirección. El personal confirmará la zona y la tarifa.", en: "I couldn't confirm the city for that address. Staff will confirm the delivery zone and fee." } };
  const inCity = near ? String(place || "").toLowerCase() === near.requirePlace!.toLowerCase() : null;
  const z = near && inCity && miles <= near.maxMiles ? near : zones.filter((x) => !x.requirePlace).sort((a, b) => a.maxMiles - b.maxMiles).find((x) => miles <= x.maxMiles);
  if (!z) return { ok: false, needsConfirm: true, reason: "out_of_range", miles: mi, place, city, minimumCents, message: { es: "El personal confirmará la zona de entrega.", en: "Staff will confirm the delivery zone." } };
  const where = city ? ` (${city})` : "";
  const feeConfirmed = z.feeConfirmed !== false;
  const serviceCents = z.serviceFee ? (cfg.serviceFeeCents ?? 0) : 0;
  const total = z.feeCents + serviceCents;
  const m2 = (c: number) => `$${(c / 100).toFixed(2)}`;
  const breakdown = serviceCents ? `Envío ${m2(z.feeCents)} + servicio ${m2(serviceCents)} = ${m2(total)}` : `Envío ${money(total)}`;
  const fee = serviceCents ? m2(total) : money(total);
  return { ok: true, needsConfirm: false, miles: mi, zone: z.id, zoneLabel: `${city || "?"} · ${fee}${feeConfirmed ? "" : " (confirmar)"}`, feeCents: total, deliveryCents: z.feeCents, serviceCents, breakdown, etaMinutes: z.etaMinutes, place, city, inCity, minimumCents, feeConfirmed,
    message: feeConfirmed
      ? { es: `La entrega${where} cuesta ${fee}${serviceCents ? ", incluyendo el cargo de servicio" : ""} y llega en unos ${z.etaMinutes} minutos. El mínimo para entrega es ${money(minimumCents)}.`, en: `Delivery${where} is ${fee}${serviceCents ? " including the service fee" : ""} and takes about ${z.etaMinutes} minutes. The delivery minimum is ${money(minimumCents)}.` }
      : { es: `La entrega${where} es de unos ${fee}; el personal le confirma la tarifa. Llega en unos ${z.etaMinutes} minutos. El mínimo para entrega es ${money(minimumCents)}.`, en: `Delivery${where} is about ${fee}; staff will confirm the fee. It takes about ${z.etaMinutes} minutes. The delivery minimum is ${money(minimumCents)}.` } };
}
/** Back-compat for callers that only know the distance (place unknown). */
export const quoteForMiles = (miles: number, cfg = loadDeliveryConfig()) => quoteFor(miles, null, cfg);
/** hector1: when delivery + street address is taken but geocode failed / fee unknown, never leave feeCents null — default near-zone phone fee ($5). */
export function provisionalDeliveryFeeCents(quote: Quote | null | undefined, hasAddress: boolean): number | null {
  if (quote && Number(quote.feeCents) > 0) return Number(quote.feeCents);
  if (!hasAddress) return null;
  if (quote?.reason === "out_of_range") return null;
  const near = loadDeliveryConfig().zones.find((z) => z.id === "near") || loadDeliveryConfig().zones[0];
  return near?.feeCents ?? 500;
}

const CONFIRM: Quote["message"] = { es: "No pude ubicar la dirección. El personal confirmará la zona y la tarifa.", en: "I couldn't locate that address. Staff will confirm the delivery zone and fee." };

type Cached = { lat: number; lng: number; matched: string; place: string | null; at: string; v: 2 } | { fail: true; at: string };
function readCache(): Record<string, any> { try { return JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { return {}; } }
function writeCache(c: Record<string, Cached>) { try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(c, null, 2)); } catch { /* cache only */ } }
const cacheKey = (address: string) => String(address || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const withState = (a: string) => (/\b(oh|ohio)\b|\b44\d{3}\b/i.test(a) ? a : `${a}, ${/painesville|mentor|fairport|concord|perry|madison|willoughby|grand river|leroy|kirtland|chardon|eastlake|wickliffe|geneva/i.test(a) ? "" : "Painesville, "}OH`);

/** Sync: quote from the geocode cache only (null when not looked up yet, or cached before places were stored). */
export function cachedQuote(address: string): Quote | null {
  if (!String(address || "").trim()) return { ok: false, needsConfirm: true, reason: "no_address", message: { es: "¿A qué dirección se lo llevamos?", en: "What's the delivery address?" } };
  const c = readCache()[cacheKey(withState(address))];
  if (!c) return null;
  if (c.fail) return { ok: false, needsConfirm: true, reason: "geocode_failed", message: CONFIRM };
  if (c.v !== 2) return null; // delivery1 cache had no place → look up again
  const cfg = loadDeliveryConfig();
  return { ...quoteFor(milesBetween(cfg.origin, c), c.place, cfg), matched: c.matched };
}

/** Geocode + place (Census geographies, ~3.5 s timeout, cached; failures cached 1 day) → quote. Never throws. */
export async function quoteDeliveryAddress(address: string, fetcher: typeof fetch = fetch): Promise<Quote> {
  const hit = cachedQuote(address);
  if (hit) {
    const c = readCache()[cacheKey(withState(address))];
    if (!(c && c.fail && Date.now() - Date.parse(c.at) > 86400000)) return hit;
  }
  const q = withState(address);
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?benchmark=Public_AR_Current&vintage=Current_Current&layers=${encodeURIComponent("Incorporated Places,County Subdivisions")}&format=json&address=${encodeURIComponent(q)}`;
    const r = await fetcher(url, { signal: ctl.signal }); clearTimeout(t);
    const j: any = r.ok ? await r.json() : null;
    const m = j?.result?.addressMatches?.[0];
    const cache = readCache();
    if (!m?.coordinates) { cache[cacheKey(q)] = { fail: true, at: new Date().toISOString() }; writeCache(cache); return { ok: false, needsConfirm: true, reason: "geocode_failed", message: CONFIRM }; }
    if ((j?.result?.addressMatches || []).length > 1) {
      // Two different matches → ambiguous: don't cache a guess.
      const places = new Set(j.result.addressMatches.map((x: any) => x?.geographies?.["Incorporated Places"]?.[0]?.NAME || x?.geographies?.["County Subdivisions"]?.[0]?.NAME || ""));
      if (places.size > 1) return { ok: false, needsConfirm: true, reason: "place_unknown", message: { es: "Hay más de una dirección parecida. El personal confirmará la zona.", en: "More than one address matches. Staff will confirm the zone." } };
    }
    const g = m.geographies || {};
    const place: string | null = g["Incorporated Places"]?.[0]?.NAME || g["County Subdivisions"]?.[0]?.NAME || null;
    cache[cacheKey(q)] = { lat: m.coordinates.y, lng: m.coordinates.x, matched: String(m.matchedAddress || ""), place, at: new Date().toISOString(), v: 2 };
    writeCache(cache);
    return cachedQuote(address)!;
  } catch {
    return { ok: false, needsConfirm: true, reason: "geocode_failed", message: CONFIRM }; // network error: not cached
  }
}
export { addressKey };

// appdelivery1: customer-app delivery = website fees (data/delivery.json "app"). Same geocode/distance as phone.
export type AppDeliveryConfig = { enabled?: boolean; maxMiles: number; subtotalMinimumCents: number; serviceFeeCents: number; prepMinutes: number; driveMinutes: number;
  tiers: Array<{ id: string; label: string; feeCents: number; maxMiles: number }>; squareFeeVariations?: Record<string, string>; squareServiceFeeVariation?: string | null };
export function loadAppDelivery(file: any = loadDeliveryConfig()): AppDeliveryConfig | null { return (file as any)?.app || null; }
const m2 = (c: number) => `$${(c / 100).toFixed(2)}`;
/** Pure: app quote for a distance. feeCents = delivery + service (total); deliveryCents / serviceCents split. */
export function appQuoteFor(miles: number, app: AppDeliveryConfig): Quote {
  const mi = Math.round(miles * 10) / 10, minimumCents = app.subtotalMinimumCents;
  const tier = [...app.tiers].sort((a, b) => a.maxMiles - b.maxMiles).find((t) => miles <= t.maxMiles);
  if (miles > app.maxMiles || !tier) return { ok: false, needsConfirm: false, reason: "out_of_range", miles: mi, minimumCents,
    message: { es: `Lo sentimos, esa dirección está fuera de nuestra área de entrega (${mi} millas; entregamos hasta ${app.maxMiles} millas). ¿Lo quiere para recoger?`, en: `Sorry, that address is outside our delivery area (${mi} miles; we deliver up to ${app.maxMiles} miles). Would you like pickup instead?` } };
  const eta = app.prepMinutes + app.driveMinutes, svc = app.serviceFeeCents, total = tier.feeCents + svc;
  return { ok: true, needsConfirm: false, miles: mi, zone: tier.id, zoneLabel: tier.label, feeCents: total, deliveryCents: tier.feeCents, serviceCents: svc, etaMinutes: eta, minimumCents, feeConfirmed: true,
    breakdown: `Envío ${m2(tier.feeCents)} + servicio ${m2(svc)} = ${m2(total)}`,
    message: { es: `Entrega: ${m2(tier.feeCents)} + ${m2(svc)} de servicio (${mi} millas). Llega en unos ${eta} minutos. Mínimo para entrega: ${m2(minimumCents)} en comida.`,
      en: `Delivery: ${m2(tier.feeCents)} + ${m2(svc)} service fee (${mi} miles). About ${eta} minutes. Delivery minimum: ${m2(minimumCents)} of food.` } };
}
const toApp = (q: Quote | null, app: AppDeliveryConfig | null): Quote | null => (!q || !app ? q : typeof q.miles === "number" ? { ...appQuoteFor(q.miles, app), matched: q.matched, place: q.place, city: q.city } : q);
export const cachedAppQuote = (address: string) => toApp(cachedQuote(address), loadAppDelivery());
export async function quoteAppAddress(address: string, fetcher: typeof fetch = fetch): Promise<Quote> { return toApp(await quoteDeliveryAddress(address, fetcher), loadAppDelivery())!; }

/** m40: quote from verified lat/lng (skip re-geocode). App path uses distance tiers; place optional. */
export function quoteDeliveryCoords(lat: number, lng: number, matched?: string, place: string | null = null): Quote {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, needsConfirm: true, reason: "geocode_failed", message: CONFIRM };
  const cfg = loadDeliveryConfig();
  const miles = milesBetween(cfg.origin, { lat, lng });
  return { ...quoteFor(miles, place, cfg), matched };
}
export function quoteAppCoords(lat: number, lng: number, matched?: string, place: string | null = null): Quote {
  return toApp(quoteDeliveryCoords(lat, lng, matched, place), loadAppDelivery())!;
}
