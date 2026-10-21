// learn2 (Carlos: "2 avenues, 1 Elvi knowledge"): the ONE knowledge module both avenues use — phone (chatWithElvi /
// shadow parser) and the customer app (typed chat → chatWithElvi; live voice → /menu/resolve). Menu rules, online-order
// learning and favorites are imported from here too, so nothing has a channel copy. Correction memory = APPROVED
// clause-level entries only (data/learning/memory.json, gitignored). Candidates wait in pending.json for the developer.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export { withConTodo, withConAddons } from "./standard-toppings.js";
export { withLearnedSuggestion, offerAnswer, offerFor } from "./online-learning.js";
export { favoritesFor, favoriteAnswer } from "./favorites.js";
export { completeWithSiteDefaults, fixNamedMeats } from "./site-catalog.js";

export const LEARN_DIR = process.env.ELVI_LEARNING_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/learning");
const memFile = () => path.join(LEARN_DIR, "memory.json");
export const pendingFile = () => path.join(LEARN_DIR, "pending.json");

export type MemoryEntry = { id: string; dish: string; key: string[]; phrase: string; item: string; choices: string[]; quantity?: number | null;
  kind: "clause" | "alias" | "slang"; from?: string; to?: string; source: string; approvedAt?: string; approvedBy?: string };
export type Candidate = MemoryEntry & { status: "pending" | "approved" | "rejected"; reason?: string; callRef: string;
  before: { score: number; lines: string[] }; after: { score: number; lines: string[] } | null; attempts: Array<{ n: number; key: string[]; score: number | null; note: string }>;
  similar: { checked: number; agree: number; disagree: number }; regression: { suite: string; replays: Array<{ ref: string; before: number; after: number }> } | null; createdAt: string };

const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const DISH = /\b(tacos?|tortas?|quesadillas?|gorditas?|burritos?|sopesa[sz]os?|sopes?|huaraches?|doradas?|pambazos?|enchiladas?|tostadas?|flautas?|nachos)\b/;
export const dishOf = (clause: string) => fold(clause).match(DISH)?.[1]?.replace(/z/g, "s").replace(/e?s$/, "") || "";
/** Content words = words that appear in this menu's item/option names (meats, tortillas, add-ons); fillers and counts drop out,
 * so a key generalizes across callers ("me pone dos tortas de bistec" ≡ "una torta de bistec por favor"). */
export function vocab(menu: any[]): Set<string> {
  const v = new Set<string>();
  for (const m of menu || []) for (const s of [m.name, m.nameEs, ...(m.modifierGroups || []).flatMap((g: any) => (g.options || []).map((o: any) => (typeof o === "string" ? o : o.name)))])
    for (const w of fold(String(s || "")).split(" ")) if (w.length >= 4 && !/^\d/.test(w)) v.add(w.replace(/e?s$/, ""));
  return v;
}
export function clauseKey(clause: string, menu: any[], all = false): string[] {
  const v = vocab(menu), d = dishOf(clause);
  const ws = fold(clause).split(" ").map((w) => w.replace(/e?s$/, "")).filter((w) => w.length >= 3 && w !== d && (all || v.has(w)));
  return [...new Set(ws)].sort();
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

let override: MemoryEntry[] | null = null;
/** Nightly eval / self-retry / tests: run with this memory instead of the approved file. null = back to the file. */
export function setMemoryOverride(m: MemoryEntry[] | null) { override = m; }
export function loadMemory(): MemoryEntry[] { if (override) return override; try { return JSON.parse(fs.readFileSync(memFile(), "utf8")).entries || []; } catch { return []; } }
export function saveMemory(entries: MemoryEntry[]) { fs.mkdirSync(LEARN_DIR, { recursive: true }); fs.writeFileSync(memFile(), JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, 1)); }

const QN: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, otra: 1, otro: 1 };
const qtyIn = (c: string) => { const m = fold(c).match(/\b(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|one|two|three|four|five|six|otras?|otros?)\b/); if (!m) return 1; const k = m[1].replace(/s$/, ""); return /\d/.test(k) ? Number(k) : QN[k] || 1; };

export type Recalled = { itemId: string; quantity: number; modifiers: Array<{ groupId: string; groupName: string; step: string; option: string }>; memoryId: string };
/** Correction memory for one utterance. Every dish clause must hit an entry (else null → normal flow). */
export function recall(text: string, menu: any[], clauses?: string[]): Recalled[] | null {
  const mem = loadMemory(); if (!mem.length || !text) return null;
  const cl = clauses && clauses.length ? clauses : [text];
  const out: Recalled[] = [];
  for (const c of cl) {
    const d = dishOf(c); if (!d) return null;
    const k = clauseKey(c, menu), ka = clauseKey(c, menu, true);
    const e = mem.find((x) => x.dish === d && (x.kind === "alias" ? same(x.key, ka) : same(x.key, k)));
    if (!e) return null;
    const item = (menu || []).find((m: any) => fold(m.name) === fold(e.item)); if (!item) return null;
    const mods: Recalled["modifiers"] = [];
    for (const ch of e.choices) for (const g of item.modifierGroups || []) { const o = (g.options || []).find((x: any) => fold(typeof x === "string" ? x : x.name) === fold(ch)); if (o) { mods.push({ groupId: g.id, groupName: g.name, step: g.name, option: typeof o === "string" ? o : o.name }); break; } }
    if (mods.length !== e.choices.length) return null; // catalog changed → don't guess
    out.push({ itemId: item.id, quantity: e.quantity || qtyIn(c), modifiers: mods, memoryId: e.id });
  }
  return out.length ? out : null;
}

// ---- pending-approval queue (developer approves; nothing goes live before) ----
export const readPending = (): Candidate[] => { try { return JSON.parse(fs.readFileSync(pendingFile(), "utf8")).candidates || []; } catch { return []; } };
export const writePending = (c: Candidate[]) => { fs.mkdirSync(LEARN_DIR, { recursive: true }); fs.writeFileSync(pendingFile(), JSON.stringify({ updatedAt: new Date().toISOString(), candidates: c }, null, 1)); };
export function decide(id: string, ok: boolean, by: string, reason = "") {
  const all = readPending(); const c = all.find((x) => x.id === id); if (!c || c.status !== "pending") return null;
  c.status = ok ? "approved" : "rejected"; c.reason = reason || (ok ? "approved" : "rejected by reviewer");
  if (ok) { const mem = loadMemory().filter((m) => m.id !== c.id); const { status, reason: _r, callRef, before, after, attempts, similar, regression, createdAt, ...entry } = c; mem.push({ ...entry, approvedAt: new Date().toISOString(), approvedBy: by }); saveMemory(mem); }
  writePending(all); return c;
}

/** a1: approved slang/alias mappings ("taparrosca" → "refresco") rewrite the utterance before parsing — phone and app alike. */
export function rewriteSlang(text: string): string {
  let t = String(text || "");
  for (const e of loadMemory()) if (e.kind === "slang" && e.from && e.to) t = t.replace(new RegExp(`(?<![\\p{L}])${e.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "giu"), e.to);
  return t;
}
