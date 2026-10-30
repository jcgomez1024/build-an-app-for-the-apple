// aliases1: one spoken-alias list shared by the phone (call-scoring.ts) and the customer app (text-intents.ts).
// Data: services/api/data/aliases/aliases.json. Reloaded when the file changes (checked at most every 5 s).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AliasScope = "phone" | "app" | "fulfillment"; // delivery1: "fulfillment" rules only feed delivery.ts
type RawAlias = { id: string; match: string; to: string; flags?: string; scope?: AliasScope[]; requires?: string; forbids?: string };
type Alias = { id: string; re: RegExp; to: string; scope: AliasScope[]; requires?: RegExp; forbids?: RegExp };

export const ALIASES_FILE = process.env.ELVI_ALIASES_FILE
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/aliases/aliases.json");

let cache: Alias[] = [];
// coctel1 (Alan): built-in rules (code, so they ship with a restart — never via the live-reloaded JSON)
export const BUILTIN_ALIASES: Alias[] = compileAliases([
  // vapor1 (CA331ca94): "tacos sudados" / "de canasta" / "de vapor" are Tacos al Vapor; ASR "quesitoto" is a quesitorta
  { id: "vapor1-name", match: String.raw`\btacos?\s+(?:sudad[oi]s|de\s+canasta|de\s+vapor)\b`, to: "tacos al vapor", scope: ["phone", "app"] },
  { id: "vapor1-quesitoto", match: String.raw`\bquesitot[oa](s?)\b`, to: "quesitorta$1", scope: ["phone", "app"] },
  { id: "coctel1-name", match: String.raw`\bc[oó]ctel(?:es)?\s+de\s+camar[oó]n(?!es\s*\/|\s*\/)(?:es)?\b(?!\s*\/)|\bshrimp\s+c[oó]ctel\b(?!\s*\()`, to: "Coctel de Camarones / Shrimp Cocktail", scope: ["phone", "app"] },
  { id: "coctel1-variant", match: String.raw`\b(?:nada\s+m[aá]s|s[oó]lo|solamente|just|only)\s+(?:el\s+|de\s+|the\s+)?(?:c[oó]ctel(?!\s+de\s+camar)|camar[oó]n(?:es)?|shrimp)\b(?!\s*(?:y|and|con|with)\s+(?:pulpo|calamar))`, to: "Coctel de Camaron / Shrimp", scope: ["phone", "app"], forbids: String.raw`pulpo|calamar|octopus` },
]);
let loadedMtime = -1;
let checkedAt = 0;

export function compileAliases(raw: RawAlias[]): Alias[] {
  const out: Alias[] = [];
  for (const a of raw || []) {
    try {
      if (!a || !a.id || typeof a.match !== "string" || typeof a.to !== "string") throw new Error("missing id/match/to");
      const flags = a.flags || "giu";
      out.push({
        id: a.id,
        re: new RegExp(a.match, flags.includes("g") ? flags : flags + "g"),
        to: a.to,
        scope: a.scope && a.scope.length ? a.scope : ["phone", "app"], // "fulfillment" must be listed explicitly
        requires: a.requires ? new RegExp(a.requires, "iu") : undefined,
        forbids: a.forbids ? new RegExp(a.forbids, "iu") : undefined,
      });
    } catch (e) {
      console.warn(`[aliases] skipped rule ${a && a.id}: ${(e as Error).message}`);
    }
  }
  return out;
}

export function loadAliases(force = false): Alias[] {
  const now = Date.now();
  if (!force && now - checkedAt < 5000 && loadedMtime >= 0) return cache;
  checkedAt = now;
  try {
    const st = fs.statSync(ALIASES_FILE);
    if (force || st.mtimeMs !== loadedMtime) {
      const json = JSON.parse(fs.readFileSync(ALIASES_FILE, "utf8"));
      cache = compileAliases(Array.isArray(json) ? json : json.aliases);
      loadedMtime = st.mtimeMs;
    }
  } catch (e) {
    if (loadedMtime !== -2) console.warn(`[aliases] could not load ${ALIASES_FILE}: ${(e as Error).message}`);
    loadedMtime = -2; // keep the last good list (or none)
  }
  return cache;
}

/** Apply the shared spoken aliases for one surface. Idempotent rules only (re-running must not change the result). */
export function applySharedAliases(text: string, scope: AliasScope): string {
  let t = String(text ?? "");
  if (!t) return t;
  for (const a of [...loadAliases(), ...BUILTIN_ALIASES]) {
    if (!a.scope.includes(scope)) continue;
    if (a.requires && !a.requires.test(t)) continue;
    if (a.forbids && a.forbids.test(t)) continue;
    a.re.lastIndex = 0;
    t = t.replace(a.re, a.to);
  }
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}
