import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
