// Conversation-intent report. Exit 1 when a deterministic or plumbing check fails.
// The model row is reported and is not a pass of model behavior.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { intentChecks } from "./conversation-intent.ts";

function codeSha(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const outFlag = process.argv.indexOf("--out");
  const out = outFlag >= 0 ? process.argv[outFlag + 1] : "";
  const sha = codeSha();
  const checks = await intentChecks();
  const scored = checks.filter((check) => check.layer !== "model");
  const body = {
    codeSha: sha,
    kind: "conversation-intent",
    pageNamedGateSatisfied: false,
    network: false,
    modelEvaluation: "unverified",
    modelNote: "No realtime model call. A stub or a missing API key does not verify that the model follows the examples.",
    checks,
    pass: scored.filter((check) => check.ok).length,
    fail: scored.filter((check) => !check.ok).length,
  };
  const lines = [`conversation-intent ${sha}`, `deterministic+plumbing ${body.pass} pass / ${body.fail} fail`, "model unverified", ""];
  for (const check of checks) lines.push(`${check.ok ? "pass" : "FAIL"}  ${check.layer.padEnd(22)} ${check.id}${check.ok ? "" : " — " + check.detail}`);
  console.log(lines.join("\n"));
  if (out) { mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(body, null, 2)); console.log(`\nwrote ${out}`); }
  if (scored.some((check) => !check.ok)) process.exit(1);
}
