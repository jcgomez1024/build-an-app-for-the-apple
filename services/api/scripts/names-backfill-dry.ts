// names2 backfill DRY RUN: extract caller names from the last N days of transcribed calls. Writes NOTHING.
//   npx tsx scripts/names-backfill-dry.ts [days=14] [--include-training  (evaluation only; training callers are never saved)]
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.twilio") });
const { loadCalls } = await import("../src/call-accuracy.ts");
const { learnReadbackName } = await import("../src/name-extract.ts");
const { readbackOrdersFor } = await import("../src/twilio.ts");
const days = Number(process.argv[2] || 14);
const training = String(process.env.TWILIO_TRAINING_CALLERS || "").split(",").map((p) => p.replace(/\D/g, "").slice(-10));
const mask = (p: string) => "***-***-" + String(p).replace(/\D/g, "").slice(-4);
const calls = loadCalls(days).filter((c) => c.caller && (c.turns?.length || c.voicemail?.transcript));
const counts: Record<string, number> = {}; let tin = 0, tout = 0, llm = 0;
for (const c of calls) {
  const turns = c.turns?.length ? c.turns : [{ speaker: "caller", start: 0, end: c.voicemail?.durationSec || 1, text: c.voicemail?.transcript || "", language: "es" }];
  const dur = Math.round(Math.max(0, ...turns.map((t: any) => t.end || 0)));
  const isTraining = !process.argv.includes("--include-training") && (c.source === "training" || training.includes(String(c.caller).replace(/\D/g, "").slice(-10)));
  const d = await learnReadbackName({ caller: c.caller, turns: turns as any, at: c.at, durSec: dur, training: isTraining, dry: true, ...readbackOrdersFor(c.caller, c.at, dur) });
  if (d.usage) { llm++; tin += d.usage.in; tout += d.usage.out; }
  const key = d.action === "save" ? `WOULD SAVE (${d.reason})` : d.reason; counts[key] = (counts[key] || 0) + 1;
  const when = new Date(c.at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  console.log(`${when} ET  ${mask(c.caller)}  ${d.action === "save" ? "SAVE" : "skip"} ${d.reason}${d.name ? `  name="${d.name}"` : ""}${d.confidence != null ? ` conf=${d.confidence}` : ""}${d.speaker ? ` by=${d.speaker}` : ""}${d.ticketName ? ` ticket="${d.ticketName}"` : ""}${d.evidence ? `  «${d.evidence}»` : ""}`);
}
console.log("\ncalls with transcripts:", calls.length, "| LLM calls:", llm, "| tokens in/out:", tin, "/", tout);
console.log(counts);
process.exit(0);
