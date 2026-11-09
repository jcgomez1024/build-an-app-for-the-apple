// Per-check menu-validation report. Exit 1 when a check fails.
// Unit rows call the validator. Integration rows call shadowOrderFromTurns and buildTicketLines.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { menuValidationReport } from "./menu-validation.ts";

function codeSha(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const outFlag = process.argv.indexOf("--out");
  const out = outFlag >= 0 ? process.argv[outFlag + 1] : "";
  const sha = codeSha();
  const checks = await menuValidationReport();
  const body = {
    codeSha: sha,
    kind: "menu-validation",
    pageNamedGateSatisfied: false,
    network: false,
    checks,
    unitPass: checks.filter((c) => c.layer === "unit" && c.ok).length,
    unitFail: checks.filter((c) => c.layer === "unit" && !c.ok).length,
    integrationPass: checks.filter((c) => c.layer === "integration" && c.ok).length,
    integrationFail: checks.filter((c) => c.layer === "integration" && !c.ok).length,
  };
  const lines = [`menu-validation ${sha}`, `unit ${body.unitPass} pass / ${body.unitFail} fail`, `integration ${body.integrationPass} pass / ${body.integrationFail} fail`, ""];
  for (const c of checks) lines.push(`${c.ok ? "pass" : "FAIL"}  ${c.layer.padEnd(12)} ${c.id}${c.ok ? "" : " — " + c.detail}`);
  console.log(lines.join("\n"));
  if (out) { mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(body, null, 2)); console.log(`\nwrote ${out}`); }
  if (checks.some((c) => !c.ok)) process.exit(1);
}
