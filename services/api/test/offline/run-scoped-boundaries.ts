// Saves one existing capture review through upsertTicket, then a fresh process
// loads that scratch file with the app ticket store and runs recoveryAcceptance.
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outPath = process.argv[2];
if (!outPath) throw new Error("usage: run-scoped-boundaries.ts <out.json>");

const prodRoots = [
  "/agent/repos/build-an-app-for-the-apple/services/api/data/logs",
  "/agent/repos/build-an-app-for-the-apple/services/api/data/logs/calls",
  "/agent/repos/build-an-app-for-the-apple/services/api/data/calls",
];
function snap(root: string) {
  try {
    const st = statSync(root);
    return { exists: true, mtimeMs: st.mtimeMs, files: readdirSync(root).slice(0, 40) };
  } catch {
    return { exists: false, mtimeMs: null, files: [] as string[] };
  }
}

const scratch = mkdtempSync(path.join(tmpdir(), "elvi-ticket-"));
process.env.ELVI_CALL_LOG_DIR = scratch;
process.env.ELVI_CALLERS_FILE = path.join(scratch, "callers.json");
process.env.NODE_ENV = "test";

const before = Object.fromEntries(prodRoots.map((root) => [root, snap(root)]));
const twilio = await import("../../src/twilio.ts");
const scoring = await import("../../src/call-scoring.ts");
const evidence = await import("../../src/offline-evidence.ts");
const { phoneMenu } = await import("./evaluate.ts");
const { CASES } = await import("./cases.ts");

const phone = phoneMenu();
const c01 = CASES.find((item) => item.id === "C01")!;
const callSid = "CA-capture-c01-review";
const run: any = async () => ({ actions: [], reply: "" });
run.menu = () => phone;
const order: any = await scoring.shadowOrderFromTurns(c01.turns as any, run);
const describe = async (cart: any[]) => cart.map((line) => {
  const item = phone.find((entry) => entry.id === line.itemId);
  const quantity = Number(line.quantity) || 1;
  return { name: item?.name || "", quantity, choices: (line.modifiers || []).map((modifier: any) => modifier.option), totalCents: Number(item?.priceCents || 0) * quantity };
});
await twilio.upsertTicket({
  callSid, caller: "", name: null, phase: "final", language: "es", transcript: c01.turns.map((turn) => turn.text).join("\n"),
}, describe, order.cart, order);
const file = path.join(scratch, "elvi-tickets.json");
const parentHash = createHash("sha256").update(readFileSync(file)).digest("hex");
const here = path.dirname(fileURLToPath(import.meta.url));
const fresh = JSON.parse(execFileSync("npx", ["tsx", path.join(here, "recover-stored.ts"), scratch, callSid], {
  cwd: "/agent/repos/build-an-app-for-the-apple/services/api",
  encoding: "utf8",
  env: { ...process.env, NODE_ENV: "test", ELVI_CALL_LOG_DIR: scratch, ELVI_CALLERS_FILE: path.join(scratch, "callers.json") },
}));
const after = Object.fromEntries(prodRoots.map((root) => [root, snap(root)]));
const productionUntouched = prodRoots.every((root) => JSON.stringify(before[root]) === JSON.stringify(after[root]));
const described = await describe(order.cart || []);
const ticketLines = twilio.buildTicketLines(described, order.cart || [], []);
const clearRecovered = evidence.gateTicketAcceptance({ validation: "clear", reviewReason: null, cart: [{ itemId: "x", quantity: 1 }], autoAccepted: false });
const storeOk = fresh.found === true
  && fresh.hash === parentHash
  && fresh.phase === "review"
  && fresh.recovery?.phase === "review"
  && typeof fresh.reviewReason === "string"
  && fresh.recovery?.reviewReason === fresh.reviewReason
  && productionUntouched
  && clearRecovered.phase === "final"
  && clearRecovered.acceptance === "validation-complete";
const body = {
  candidate_sha: execSync("git rev-parse HEAD", { cwd: "/agent/repos/build-an-app-for-the-apple" }).toString().trim(),
  transcript: "C01",
  order_review: order.reviewReason ?? null,
  staff_lines: ticketLines.map((line: any) => ({ name: line.name, quantity: line.quantity, notes: line.notes, flag: line.flag, totalCents: line.totalCents })),
  file_hash: parentHash,
  fresh_process: fresh,
  production_untouched: productionUntouched,
  clear_recovered_unchanged: clearRecovered,
  scratch,
};
writeFileSync(outPath, JSON.stringify(body, null, 2));
console.log(storeOk ? "PASS" : "FAIL", "fresh-store", fresh.phase, fresh.reviewReason, fresh.recovery?.phase, fresh.hash);
console.log(productionUntouched ? "PASS" : "FAIL", "production-untouched");
console.log(clearRecovered.acceptance === "validation-complete" ? "PASS" : "FAIL", "clear-recovered-unchanged");
if (!storeOk) process.exit(1);
