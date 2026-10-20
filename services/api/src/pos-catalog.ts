// auditor1 (B/C): Elvi's lines in Square POS terms — exact POS item + variation names and POS prices incl. every
// modifier upcharge (e.g. Prensado +$0.50), read from the production catalog (READ-ONLY: GET /v2/catalog/list).
// Online menu items ("Quesadilla (ONLINE)" Regular + "(QCO)…" modifier) map to the POS item ("Quesadilla") whose
// variation is the tortilla ("(QCO) Quesadilla de Comal / Homemade"). Cached 6 h in data/logs (gitignored).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { norm, type Line } from "./call-accuracy.js";

const cacheFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/logs/pos-catalog.json");
type Var = { id: string; name: string; priceCents: number };
type Item = { id: string; name: string; variations: Var[]; modifierListIds: string[] };
type Mod = { id: string; name: string; priceCents: number };
export type PosCatalog = { fetchedAt: string; items: Item[]; modifierLists: Record<string, { name: string; modifiers: Mod[] }> };

export function compactCatalog(objects: any[]): PosCatalog {
  const items: Item[] = [], modifierLists: PosCatalog["modifierLists"] = {};
  for (const o of objects || []) {
    if (o.is_deleted) continue;
    if (o.type === "ITEM") items.push({ id: o.id, name: String(o.item_data?.name || ""), modifierListIds: (o.item_data?.modifier_list_info || []).filter((m: any) => m.enabled !== false).map((m: any) => m.modifier_list_id),
      variations: (o.item_data?.variations || []).filter((v: any) => !v.is_deleted).map((v: any) => ({ id: v.id, name: String(v.item_variation_data?.name || ""), priceCents: Number(v.item_variation_data?.price_money?.amount ?? 0) })) });
    if (o.type === "MODIFIER_LIST") modifierLists[o.id] = { name: String(o.modifier_list_data?.name || ""), modifiers: (o.modifier_list_data?.modifiers || []).map((m: any) => ({ id: m.id, name: String(m.modifier_data?.name || "").trim(), priceCents: Number(m.modifier_data?.price_money?.amount ?? 0) })) };
  }
  return { fetchedAt: new Date().toISOString(), items, modifierLists };
}
let mem: PosCatalog | null = null;
export function cachedPosCatalog(): PosCatalog | null {
  if (mem) return mem;
  try { mem = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { mem = null; }
  return mem;
}
/** Read-only catalog fetch (6 h cache). Never throws; returns the cached copy (or null) on error. */
export async function loadPosCatalog(cfg: { accessToken?: string; apiVersion?: string; env?: string }, maxAgeMs = 6 * 3600_000): Promise<PosCatalog | null> {
  const c = cachedPosCatalog();
  if (c && Date.now() - Date.parse(c.fetchedAt) < maxAgeMs) return c;
  if (!cfg?.accessToken || cfg.env === "sandbox") return c;
  try {
    const all: any[] = []; let cursor = "";
    do {
      const r = await fetch(`https://connect.squareup.com/v2/catalog/list?types=ITEM,MODIFIER_LIST${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { Authorization: `Bearer ${cfg.accessToken}`, "Square-Version": cfg.apiVersion || "2025-01-23" } });
      if (!r.ok) return c;
      const j: any = await r.json(); all.push(...(j.objects || [])); cursor = j.cursor || "";
    } while (cursor);
    mem = compactCatalog(all);
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(mem)); } catch { /* cache only */ }
    return mem;
  } catch { return c; }
}
const CHANNEL = /\s*\((?:ONLINE|VOICE ONLINE|MESA)\)\s*$/i;
const isRegular = (n: string) => /^regular$/i.test(n.trim());
/** Map one Elvi line (online variation id + chosen option names) to the POS item/variation/modifiers and POS price. */
export function toPosLine(l: Line, cat: PosCatalog | null): Line {
  if (!cat || !l.variationId) return l;
  const src = cat.items.find((i) => i.variations.some((v) => v.id === l.variationId));
  if (!src) return l;
  const srcVar = src.variations.find((v) => v.id === l.variationId)!;
  const posName = src.name.replace(CHANNEL, "").trim();
  const pos = cat.items.find((i) => i.name === posName) || src;
  let choices = [...(l.choices || [])];
  let pv: Var | undefined = pos.variations.length === 1 ? pos.variations[0] : pos.variations.find((v) => !isRegular(srcVar.name) && norm(v.name) === norm(srcVar.name));
  if (!pv) {
    const i = choices.findIndex((c) => pos.variations.some((v) => norm(v.name) === norm(c)));
    if (i >= 0) { pv = pos.variations.find((v) => norm(v.name) === norm(choices[i])); choices.splice(i, 1); }
  }
  if (!pv) return l;
  choices = choices.filter((c) => norm(c) !== norm(pv!.name));
  const mods = pos.modifierListIds.flatMap((id) => cat.modifierLists[id]?.modifiers || []);
  let unit = pv.priceCents;
  const posChoices: string[] = [];
  for (const c of choices) {
    const m = mods.find((x) => norm(x.name) === norm(c));
    if (m) { unit += m.priceCents; posChoices.push(m.name); } else posChoices.push(c);
  }
  const q = Number(l.quantity) || 1;
  return { ...l, baseName: pos.name, variationId: pv.id, name: isRegular(pv.name) ? pos.name : `${pos.name} · ${pv.name}`, choices: [...(isRegular(pv.name) ? [] : [pv.name]), ...posChoices], unitCents: unit, totalCents: unit * q };
}
export const toPosLines = (lines: Line[], cat: PosCatalog | null) => lines.map((l) => toPosLine(l, cat));
