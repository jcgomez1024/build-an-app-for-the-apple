// blocklist1 (Carlos, Oct 30 2026): "no pickup/delivery" contact list. Callers on data/phone-blocklist.json hear, in their
// language, that they must come to the restaurant to order — then the call ends. No queue/ring, no order, ticket or staff SMS.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const BLOCKLIST_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/phone-blocklist.json");
export type BlockEntry = { phone: string; name?: string; note?: string };
/** US-centric E.164: 10 digits → +1…, 11 starting with 1 → +…, otherwise +digits. */
export function toE164(raw: unknown): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}
export function loadBlocklist(file = process.env.ELVI_BLOCKLIST_FILE || BLOCKLIST_FILE): BlockEntry[] {
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")); const xs = Array.isArray(j) ? j : j?.numbers || [];
    return xs.filter((x: any) => x && toE164(x.phone)).map((x: any) => ({ ...x, phone: toE164(x.phone) }));
  } catch { return []; }
}
export function blockedCaller(phone: unknown, list = loadBlocklist()): BlockEntry | null {
  const p = toE164(phone); if (!p || p.length < 11) return null;
  return list.find((x) => x.phone === p) || null;
}
export const BLOCKED_TEXT = {
  es: "Lo siento, tienes que ir al restaurante a ordenar.",
  en: "Sorry, you need to come to the restaurant to order.",
} as const;
/** Language: saved/known caller language first, else the first utterance, else both (Spanish first). */
export function blockedLanguages(saved?: string | null, firstUtterance?: string): Array<"es" | "en"> {
  if (saved === "es" || saved === "en") return [saved];
  const u = String(firstUtterance || "").toLowerCase();
  if (u.trim()) return /\b(hi|hello|hey|yes|order|please|can i|i want|i'd like)\b/.test(u) && !/\b(hola|quiero|orden|por favor|buenas)\b/.test(u) ? ["en"] : ["es"];
  return ["es", "en"];
}
export const blockedReply = (lang: "es" | "en") => BLOCKED_TEXT[lang];
