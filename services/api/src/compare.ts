// cmp1: per-call comparison for calls.html "Comparar": correct order (overrides > read-back > customer words > ticket)
// vs the staff Square ticket vs Elvi, scored against the correct order. Read-only; reuses the training pipeline.
import { phoneExample, errorType } from "./learning.js";
import { scoreOrder, callerNamedSalsa, tortillaUnconfirmed, type Line } from "./call-accuracy.js";
import { withIncludedToppings } from "./standard-toppings.js";
const wit = (ls: any[]) => ls.map(withIncludedToppings as any) as Line[];
export type Compare = { truth: Line[]; elviScore: number | null; staffScore: number | null; grade: string | null; staffGrade: string | null;
  readback: string; corrected: string[]; elviMissTypes: string[]; elviLiveScore: number | null; elviLiveMissTypes: string[]; staffMissTypes: string[]; line: string | null };
export function compareRow(row: any): Compare | null {
  let ex: ReturnType<typeof phoneExample> = null;
  try { ex = phoneExample(row); } catch { return null; }
  if (!ex) return null;
  const sn = { salsaNamed: callerNamedSalsa(row.turns || []) }; // salsa1
  const elviS = scoreOrder(wit(row.elvi || []), wit(ex.truthLines), sn);
  const liveS = row.elviLive ? scoreOrder(wit(row.elviLive), wit(ex.truthLines), sn) : null; // live1
  return { truth: ex.truthLines, elviScore: ex.elviScore, staffScore: ex.staffScore, grade: ex.grade || null, staffGrade: ex.staffGrade ?? null,
    readback: ex.readback || "none", corrected: ex.corrected, elviMissTypes: elviS.misses.map(errorType), elviLiveScore: liveS ? liveS.score : ex.elviScore, elviLiveMissTypes: liveS ? liveS.misses.map(errorType) : elviS.misses.map(errorType), staffMissTypes: [...ex.staffMisses.map(errorType), ...(tortillaUnconfirmed(row.turns, ex.truthLines).length ? ["tortilla_unconfirmed"] : [])], // tortilla3: minor, score unchanged
    line: row.calledNumber ? String(row.calledNumber).replace(/\D/g, "").slice(-4) : null };
}
