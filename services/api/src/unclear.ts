/** unclear1: calls whose true order can't be known (relayed orders, errors on both sides). Excluded from Elvi/staff
 *  accuracy, coaching counts, labeled examples, finetune and nightly replays; still listed with "Orden poco clara".
 *  Reversible by CallSid: scripts/unclear.ts, POST /api/calls/:sid/unclear (localhost), or the calls.html toggle. */
import fs from "node:fs";
import path from "node:path";
export type Unclear = { at: string; by: string; note?: string; droppedCoaching?: string[] };
const file = () => process.env.UNCLEAR_FILE || path.join(process.cwd(), "data/learning/unclear.json");
export function loadUnclear(): Record<string, Unclear> { try { return JSON.parse(fs.readFileSync(file(), "utf8")); } catch { return {}; } }
export const isUnclear = (sid: string) => !!loadUnclear()[sid];
export function setUnclear(sid: string, on: boolean, info: Partial<Unclear> = {}): Record<string, Unclear> {
  if (!/^CA[0-9a-f]{32}$/.test(sid)) throw new Error("bad call id");
  const all = loadUnclear();
  if (on) all[sid] = { at: new Date().toISOString(), by: info.by || "developer", ...(info.note ? { note: info.note } : {}), ...(info.droppedCoaching ? { droppedCoaching: info.droppedCoaching } : {}) };
  else delete all[sid];
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(all, null, 1));
  return all;
}
