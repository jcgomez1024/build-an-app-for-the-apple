// m40: delivery address suggest + reverse — Census onelineaddress (no key) primary; Google Places when GOOGLE_PLACES_API_KEY is set.
// Only house-numbered matched addresses (matchedAddress starts with digits). Never street-only stubs.

export type AddrSuggestion = {
  matchedAddress: string;
  street: string;
  city: string;
  full: string;
  lat: number;
  lng: number;
  verified: true;
  source: "census" | "places";
};

const HOUSE = /^\d/;
const LOCAL_CITY = /painesville|mentor|fairport|concord|perry|madison|willoughby|eastlake|grand river|kirtland|chardon|wickliffe|geneva|leroy/i;

function hasHouse(s: string) {
  return HOUSE.test(String(s || "").trim());
}

/** Bias short/local queries toward Painesville so Census can match (e.g. "545 E Erie" → + ", Painesville, OH"). */
export function biasAddressQuery(q: string): string {
  const s = String(q || "").trim().replace(/\s+/g, " ");
  if (!s) return s;
  if (/\b(oh|ohio)\b|\b44\d{3}\b/i.test(s)) return s;
  if (LOCAL_CITY.test(s)) return `${s}, OH`;
  return `${s}, Painesville, OH`;
}

function splitMatched(matched: string): { street: string; city: string; full: string } {
  const parts = String(matched || "").split(",").map((p) => p.trim()).filter(Boolean);
  const street = parts[0] || matched;
  const city = parts.slice(1).join(", ") || "OH";
  // Title-ish display: keep Census upper for confirm fidelity, soft-format street for list
  const streetDisp = street.replace(/\b([A-Z]+)\b/g, (w) => (w.length <= 2 ? w : w[0] + w.slice(1).toLowerCase()));
  const cityDisp = city.replace(/\b([A-Z]{3,})\b/g, (w) => w[0] + w.slice(1).toLowerCase());
  const full = `${streetDisp}, ${cityDisp}`;
  return { street: streetDisp, city: cityDisp, full };
}

function fromCensusMatch(m: any): AddrSuggestion | null {
  const matchedAddress = String(m?.matchedAddress || "").trim();
  if (!hasHouse(matchedAddress)) return null;
  const lat = Number(m?.coordinates?.y), lng = Number(m?.coordinates?.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const { street, city, full } = splitMatched(matchedAddress);
  return { matchedAddress, street, city, full, lat, lng, verified: true, source: "census" };
}

async function censusOneline(address: string, fetcher: typeof fetch): Promise<AddrSuggestion[]> {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetcher(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const j: any = await r.json();
    const out: AddrSuggestion[] = [];
    const seen = new Set<string>();
    for (const m of j?.result?.addressMatches || []) {
      const a = fromCensusMatch(m);
      if (!a) continue;
      const k = a.matchedAddress.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
      if (out.length >= 3) break;
    }
    return out;
  } catch {
    clearTimeout(t);
    return [];
  }
}

async function placesSuggest(q: string, fetcher: typeof fetch, key: string): Promise<AddrSuggestion[]> {
  const autoUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&types=address&components=country:us&location=41.7245,-81.2456&radius=25000&key=${encodeURIComponent(key)}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetcher(autoUrl, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const j: any = await r.json();
    const preds = (j?.predictions || []).slice(0, 3);
    const out: AddrSuggestion[] = [];
    for (const p of preds) {
      const id = p?.place_id; if (!id) continue;
      const dUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(id)}&fields=formatted_address,geometry,address_component&key=${encodeURIComponent(key)}`;
      const dr = await fetcher(dUrl);
      if (!dr.ok) continue;
      const dj: any = await dr.json();
      const res = dj?.result;
      const formatted = String(res?.formatted_address || "").trim();
      const lat = Number(res?.geometry?.location?.lat), lng = Number(res?.geometry?.location?.lng);
      if (!hasHouse(formatted) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      // Prefer Census-verified coords when Places gives a candidate
      const verified = await censusOneline(biasAddressQuery(formatted.replace(/,?\s*USA$/i, "")), fetcher);
      if (verified[0]) { out.push(verified[0]); continue; }
      const { street, city, full } = splitMatched(formatted.replace(/,?\s*USA$/i, "").replace(/, United States$/i, ""));
      out.push({ matchedAddress: formatted, street, city, full, lat, lng, verified: true, source: "places" });
    }
    return out.slice(0, 3);
  } catch {
    clearTimeout(t);
    return [];
  }
}

/** Suggest 0–3 house-numbered verified addresses for typed text. */
export async function suggestAddresses(q: string, fetcher: typeof fetch = fetch): Promise<AddrSuggestion[]> {
  const raw = String(q || "").trim();
  if (raw.length < 2) return [];
  const biased = biasAddressQuery(raw);
  const key = String(process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (key) {
    const places = await placesSuggest(biased, fetcher, key);
    if (places.length) return places;
  }
  // Census: try biased first; if empty and query already had city, try raw; if short with house # try a couple variants
  let hits = await censusOneline(biased, fetcher);
  if (!hits.length && biased !== raw) hits = await censusOneline(raw, fetcher);
  if (!hits.length && /^\d/.test(raw) && !/,/.test(raw)) {
    hits = await censusOneline(`${raw}, Painesville, OH 44077`, fetcher);
  }
  return hits;
}

/** Reverse: Nominatim house candidate → Census verify (house # required). */
export async function reverseAddress(lat: number, lng: number, fetcher: typeof fetch = fetch): Promise<AddrSuggestion | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let candidate = "";
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&format=json&addressdetails=1`;
    const r = await fetcher(url, { signal: ctl.signal, headers: { "User-Agent": "CocinaElvis-OrderApp/1.0 (delivery address verify)" } });
    clearTimeout(t);
    if (r.ok) {
      const j: any = await r.json();
      const a = j?.address || {};
      const hn = a.house_number, road = a.road || a.pedestrian || "";
      if (hn && road) {
        const city = a.city || a.town || a.village || a.municipality || "Painesville";
        const state = a.state === "Ohio" ? "OH" : (a.state || "OH");
        const zip = a.postcode || "";
        candidate = `${hn} ${road}, ${city}, ${state}${zip ? " " + zip : ""}`;
      } else if (hasHouse(String(j?.display_name || ""))) {
        candidate = String(j.display_name).split(", United States")[0];
      }
    }
  } catch { /* fall through */ }
  if (candidate) {
    const hits = await suggestAddresses(candidate, fetcher);
    if (hits[0]) return hits[0];
  }
  // Last resort: no house from reverse → cannot verify
  return null;
}
