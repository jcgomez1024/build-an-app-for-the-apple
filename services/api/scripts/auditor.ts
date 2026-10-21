/** auditor1: Elvi Auditor CLI. Read-only against Square (via the local API); writes only data/auditor/.
 *    npx tsx scripts/auditor.ts run        # audit recent completed calls (launchd every 5 min)
 *    npx tsx scripts/auditor.ts pending    # un-notified findings as JSON
 *    npx tsx scripts/auditor.ts ack <ids…> # mark notified */
import fs from "node:fs"; import path from "node:path";
import { auditCall, recordFinding, retireFindings, pendingFindings, ackFindings, AUDITOR_DIR } from "../src/auditor.ts";
import { nameFromTranscript, rememberHeardNameIfNone } from "../src/order-name.ts";
const [cmd, ...args] = process.argv.slice(2);
if (cmd === "pending") { console.log(JSON.stringify(pendingFindings(), null, 2)); process.exit(0); }
if (cmd === "ack") { const ids = args.flatMap((a) => a.split(",")).filter(Boolean); console.log(JSON.stringify({ acked: ackFindings(ids) })); process.exit(0); }
if (cmd !== "run") { console.error("usage: auditor.ts run|pending|ack <ids>"); process.exit(2); }
const stateFile = path.join(AUDITOR_DIR, "state.json");
const state: { final: Record<string, string> } = (() => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return { final: {} }; } })();
const r = await fetch("http://localhost:4000/api/calls/accuracy?days=2", { signal: AbortSignal.timeout(60_000) }).catch(() => null);
if (!r?.ok) { console.error("api unavailable", r?.status); process.exit(0); }
const data: any = await r.json();
let audited = 0, recorded = 0;
for (const row of data.calls || []) {
  if (row.unclear) { retireFindings(row.callSid, "unclear order"); continue; } // unclear1
  if (state.final[row.callSid]) continue;
  const a = auditCall(row);
  if (!a) continue;
  audited++;
  // sopesaso1: name heard on the call → caller memory, only if the number has no saved name (never training calls).
  const heard = row.source !== "training" && row.caller ? nameFromTranscript(row.turns || []) : null;
  if (heard) { try { rememberHeardNameIfNone(row.caller, heard); } catch { /* best effort */ } }
  if (a.flags.length || row.ticket) { if (recordFinding(row, a.flags)) recorded++; }
  else retireFindings(row.callSid, row.noOrder ? "no order on call" : "no ticket match"); // match1
  if (a.final) state.final[row.callSid] = new Date().toISOString();
}
fs.mkdirSync(AUDITOR_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
console.log(`${new Date().toISOString()} audited ${audited}, new findings ${recorded}, pending ${pendingFindings().length}`);
