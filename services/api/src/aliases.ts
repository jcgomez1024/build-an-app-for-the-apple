// aliases1: one spoken-alias list shared by the phone (call-scoring.ts) and the customer app (text-intents.ts).
// Data: services/api/data/aliases/aliases.json. Reloaded when the file changes (checked at most every 5 s).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AliasScope = "phone" | "app";
type RawAlias = { id: string; match: string; to: string; flags?: string; scope?: AliasScope[]; requires?: string; forbids?: string };
type Alias = { id: string; re: RegExp; to: string; scope: AliasScope[]; requires?: RegExp; forbids?: RegExp };

export const ALIASES_FILE = process.env.ELVI_ALIASES_FILE
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/aliases/aliases.json");

let cache: Alias[] = [];
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
        scope: a.scope && a.scope.length ? a.scope : ["phone", "app"],
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
  for (const a of loadAliases()) {
    if (!a.scope.includes(scope)) continue;
    if (a.requires && !a.requires.test(t)) continue;
    if (a.forbids && a.forbids.test(t)) continue;
    a.re.lastIndex = 0;
    t = t.replace(a.re, a.to);
  }
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}
