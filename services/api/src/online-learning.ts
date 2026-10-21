// learn1 (Carlos): learn from customers who order themselves online. Read-only aggregate of PAID Square Online orders:
// item / modifier / combo frequencies + common free-text notes → data/learning/online-orders.json (gitignored).
// Never stores names, phone numbers, addresses, emails, order ids or exact times.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isOnlineOrder } from "./call-accuracy.js";

export const LEARNING_FILE = process.env.ELVI_LEARNING_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/learning/online-orders.json");
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
/** Paid = completed, or has a captured payment (net amount > 0). */
export const isPaid = (o: any) => /^COMPLETED$/i.test(String(o?.state || "")) || Number(o?.net_amounts?.total_money?.amount ?? o?.total_money?.amount ?? 0) > 0 && (o?.tenders || []).length > 0;
/** Free-text note → safe phrase, or null if it could hold personal data (digits runs, emails, street words, long). */
export function safeNote(t: string): string | null {
  const s = norm(t).replace(/[^\p{L}\p{N}\s,.'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!s || s.length > 60) return null;
  if (/\d{3,}|@|\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|lane|ln|ct|court|apt|unit|suite|calle|avenida|call me|text me|my name|llamar|mi nombre)\b/.test(s)) return null;
  return s;
}
type Count = Record<string, number>;
const inc = (m: Count, k: string, n = 1) => { if (k) m[k] = (m[k] || 0) + n; };
const top = (m: Count, n: number, min = 1) => Object.entries(m).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, count: v }));
export function buildOnlineLearning(orders: any[], now = new Date()) {
  const paid = orders.filter((o) => isOnlineOrder(o) && isPaid(o) && (o.line_items || []).length);
  const items: Count = {}, mods: Record<string, Count> = {}, itemOrders: Count = {}, pairs: Count = {}, notes: Count = {}, sizes: Count = {};
  for (const o of paid) {
    const names = new Set<string>();
    for (const li of o.line_items || []) {
      const name = String(li.name || "").trim(); if (!name) continue;
      const q = Number(li.quantity) || 1; inc(items, name, q); names.add(name);
      if (li.variation_name && !/^regular$/i.test(li.variation_name)) inc(sizes, `${name} · ${li.variation_name}`, q);
      mods[name] ||= {}; inc(itemOrders, name);
      for (const m of li.modifiers || []) inc(mods[name], String(m.name || "").trim());
      const n = li.note ? safeNote(li.note) : null; if (n) inc(notes, n);
    }
    const list = [...names].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) inc(pairs, `${list[i]} + ${list[j]}`);
  }
  const byItem = Object.fromEntries(Object.entries(mods).map(([k, m]) => [k, { orders: itemOrders[k], modifiers: top(m, 15).map((x) => ({ ...x, share: Math.round((x.count / itemOrders[k]) * 100) / 100 })) }]));
  return { version: 1, generatedAt: now.toISOString(), source: "Square Online, paid orders (read-only)", orders: paid.length,
    items: top(items, 60), variations: top(sizes, 30), modifiersByItem: byItem, combos: top(pairs, 30, 2), notes: top(notes, 30, 2) };
}
/** Usual modifiers for an item (share ≥ minShare) — for Elvi suggestions/defaults. */
export function usualModifiers(itemName: string, minShare = 0.5, file = LEARNING_FILE): string[] {
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return (j.modifiersByItem?.[itemName]?.modifiers || []).filter((m: any) => m.share >= minShare).map((m: any) => m.name); } catch { return []; }
}
export function writeOnlineLearning(data: ReturnType<typeof buildOnlineLearning>, file = LEARNING_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
}
