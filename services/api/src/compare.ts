// cmp1: per-call comparison for calls.html "Comparar": correct order (overrides > read-back > customer words > ticket)
// vs the staff Square ticket vs Elvi, scored against the correct order. Read-only; reuses the training pipeline.
import { phoneExample, errorType } from "./learning.js";
import { scoreOrder, type Line } from "./call-accuracy.js";
export type Compare = { truth: Line[]; elviScore: number | null; staffScore: number | null; grade: string | null; staffGrade: string | null;
  readback: string; corrected: string[]; elviMissTypes: string[]; elviLiveScore: number | null; elviLiveMissTypes: string[]; staffMissTypes: string[]; line: string | null };
export function compareRow(row: any): Compare | null {
  let ex: ReturnType<typeof phoneExample> = null;
  try { ex = phoneExample(row); } catch { return null; }
  if (!ex) return null;
  const elviS = scoreOrder(row.elvi || [], ex.truthLines);
  const liveS = row.elviLive ? scoreOrder(row.elviLive, ex.truthLines) : null; // live1
  return { truth: ex.truthLines, elviScore: ex.elviScore, staffScore: ex.staffScore, grade: ex.grade || null, staffGrade: ex.staffGrade ?? null,
    readback: ex.readback || "none", corrected: ex.corrected, elviMissTypes: elviS.misses.map(errorType), elviLiveScore: liveS ? liveS.score : ex.elviScore, elviLiveMissTypes: liveS ? liveS.misses.map(errorType) : elviS.misses.map(errorType), staffMissTypes: ex.staffMisses.map(errorType),
    line: row.calledNumber ? String(row.calledNumber).replace(/\D/g, "").slice(-4) : null };
}
