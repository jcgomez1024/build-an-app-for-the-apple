// Reproduce an offline evidence run. Writes a result file and prints the matrix.
// Exit 1 only when a known-correct control fails. Candidate failures stay in the file.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { catalogAudit, evaluateAll, matrixText } from "./evaluate.ts";

function codeSha(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

export async function runEvidence(outPath?: string) {
  const sha = codeSha();
  const results = await evaluateAll();
  const audit = catalogAudit();
  const body = {
    codeSha: sha,
    pageNamedGateSatisfied: false,
    path: "shadowOrderFromTurns + empty model stub + site phone menu",
    network: false,
    catalog: audit,
    results,
  };
  const text = matrixText(results, sha);
  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(body, null, 2));
  }
  return { text, body, controlFailed: results.some((r) => r.role === "control" && r.verdict !== "pass") };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const outFlag = process.argv.indexOf("--out");
  const out = outFlag >= 0 ? process.argv[outFlag + 1] : "";
  const ran = await runEvidence(out || undefined);
  console.log(ran.text);
  if (out) console.log(`\nwrote ${out}`);
  if (ran.controlFailed) process.exit(1);
}
