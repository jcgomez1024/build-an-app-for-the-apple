// m41: delivery address suggest + reverse — Places API (New) when GOOGLE_PLACES_API_KEY is set; Census onelineaddress fallback/verify (no Geocoding API).
// Only house-numbered matched addresses (matchedAddress starts with digits). Never street-only stubs. Never log the API key.

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
  // Places API (New) only — legacy maps.googleapis.com place/autocomplete|details will fail on this key.
  // Key goes in X-Goog-Api-Key header only; never log or put in query strings.
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetcher("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
      },
      body: JSON.stringify({
        input: q,
        includedRegionCodes: ["us"],
        languageCode: "en",
        regionCode: "us",
        locationBias: {
          circle: {
            center: { latitude: 41.7245, longitude: -81.2456 }, // Cocina Elvis · Painesville
            radius: 25000.0,
          },
        },
      }),
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const j: any = await r.json();
    const preds = (j?.suggestions || []).map((s: any) => s?.placePrediction).filter(Boolean).slice(0, 5);
    const out: AddrSuggestion[] = [];
    const seen = new Set<string>();
    for (const pred of preds) {
      const preview = String(pred?.text?.text || pred?.structuredFormat?.mainText?.text || "").trim();
      // Skip street-only stubs before spending a Details call
      if (preview && !hasHouse(preview)) continue;
      const placeId = String(pred?.placeId || "").replace(/^places\//, "").trim();
      if (!placeId) continue;
      const dr = await fetcher(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "formattedAddress,location,addressComponents",
        },
      });
      if (!dr.ok) continue;
      const res: any = await dr.json();
      const formatted = String(res?.formattedAddress || "").trim();
      const lat = Number(res?.location?.latitude), lng = Number(res?.location?.longitude);
      if (!hasHouse(formatted) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const cleaned = formatted.replace(/,?\s*USA$/i, "").replace(/, United States$/i, "").trim();
      // Prefer Census-verified matchedAddress + coords (Geocoding API not enabled on this key)
      const verified = await censusOneline(biasAddressQuery(cleaned), fetcher);
      let a: AddrSuggestion | null = null;
      if (verified[0]) {
        a = { ...verified[0], source: "places" };
      } else {
        const { street, city, full } = splitMatched(cleaned);
        a = { matchedAddress: cleaned, street, city, full, lat, lng, verified: true, source: "places" };
      }
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
