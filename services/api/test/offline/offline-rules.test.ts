import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCodeAliases } from "../../src/aliases.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the older spelling fixes are unchanged and still unrecorded", () => {
  const lock = JSON.parse(readFileSync(path.join(root, "data/offline/spelling-fixes-frozen.json"), "utf8"));
  const file = path.join(root, "data/aliases/code-aliases.json");
  const raw = readFileSync(file);
  const hash = createHash("sha256").update(raw).digest("hex");
  assert.equal(hash, lock.sha256);
  const rows = JSON.parse(raw.toString()).aliases;
  assert.equal(rows.length, lock.rows);
  assert.equal(rows.every((row: { approved?: string }) => row.approved === "unrecorded"), true);
});

test("code-aliases.json fails loudly when it is missing or invalid", () => {
  assert.throws(() => assertCodeAliases(path.join(root, "data/aliases/no-such-code-aliases.json")), /missing/);
  const dir = mkdtempSync(path.join(tmpdir(), "elvi-aliases-"));
  const badJson = path.join(dir, "bad.json");
  writeFileSync(badJson, "{");
  assert.throws(() => assertCodeAliases(badJson), /not valid JSON/);
  const badRule = path.join(dir, "rule.json");
  writeFileSync(badRule, JSON.stringify({ aliases: [{ id: "broken", match: "(", to: "x" }] }));
  assert.throws(() => assertCodeAliases(badRule), /invalid pattern/);
  assert.doesNotThrow(() => assertCodeAliases(path.join(root, "data/aliases/code-aliases.json")));
});

test("the twelve offline rules replace the never-do list without touching the live prompt", () => {
  const rules = JSON.parse(readFileSync(path.join(root, "data/offline/never-do-12.json"), "utf8"));
  assert.equal(rules.rules.length, 12);
  assert.equal(new Set(rules.rules).size, 12);
  const live = JSON.parse(readFileSync(path.join(root, "data/elvi-donts.json"), "utf8"));
  assert.equal(live.donts.length, 33);
  const elvi = readFileSync(path.join(root, "src/elvi.ts"), "utf8");
  const realtime = readFileSync(path.join(root, "src/realtime.ts"), "utf8");
  assert.equal(elvi.includes("never-do-12"), false);
  assert.equal(realtime.includes("never-do-12"), false);
  assert.match(elvi, /elvi-donts\.json/);
});
