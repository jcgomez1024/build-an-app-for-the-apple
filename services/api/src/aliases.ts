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
const CODE_ALIASES_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/aliases/code-aliases.json");

let cache: Alias[] = [];
type CodeRow = Alias & { apply: string };
let codeRows: CodeRow[] | null = null;
export function assertCodeAliases(file = CODE_ALIASES_FILE): void {
  if (!fs.existsSync(file)) throw new Error(`code-aliases.json is missing (${file})`);
  let json: { aliases?: unknown };
  try { json = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { throw new Error(`code-aliases.json is not valid JSON (${file}): ${(e as Error).message}`); }
  if (!json || !Array.isArray(json.aliases) || json.aliases.length === 0) throw new Error(`code-aliases.json has no aliases (${file})`);
  for (const row of json.aliases as Array<Partial<RawAlias>>) {
    if (!row || typeof row.id !== "string" || typeof row.match !== "string" || typeof row.to !== "string") {
      throw new Error(`code-aliases.json row ${row && row.id ? row.id : "?"} is missing id, match, or to`);
    }
    try { new RegExp(row.match, typeof row.flags === "string" ? row.flags : ""); }
    catch (e) { throw new Error(`code-aliases.json rule ${row.id} has an invalid pattern: ${(e as Error).message}`); }
  }
}
function loadCodeRows(): CodeRow[] {
  if (codeRows) return codeRows;
  assertCodeAliases();
  const json = JSON.parse(fs.readFileSync(CODE_ALIASES_FILE, "utf8"));
  const raw = (json.aliases || []) as Array<RawAlias & { apply?: string }>;
  codeRows = raw.map((row) => {
    if (row.apply && row.apply !== "shared") {
      return { id: row.id, re: new RegExp(row.match, row.flags || ""), to: row.to, scope: row.scope?.length ? row.scope : ["phone", "app"], apply: row.apply };
    }
    const compiled = compileAliases([row])[0];
    if (!compiled) throw new Error(`code-aliases.json rule ${row.id} did not compile`);
    return { ...compiled, apply: "shared" };
  });
  return codeRows;
}
assertCodeAliases();
export function applyCodeAliases(text: string, apply: string, id?: string): string {
  let t = String(text ?? "");
  for (const row of loadCodeRows()) {
    if (row.apply !== apply || (id && row.id !== id)) continue;
    row.re.lastIndex = 0;
    t = t.replace(row.re, row.to);
  }
  return t;
}
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
  for (const a of [...loadAliases(), ...loadCodeRows().filter((row) => row.apply === "shared")]) {
    if (!a.scope.includes(scope)) continue;
    if (a.requires && !a.requires.test(t)) continue;
    if (a.forbids && a.forbids.test(t)) continue;
    a.re.lastIndex = 0;
    t = t.replace(a.re, a.to);
  }
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}
