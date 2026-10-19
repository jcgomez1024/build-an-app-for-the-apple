// aliases1: replay tests from anonymized real phrasings. Pure text only: never calls Square, xAI or Twilio.
// Run: npm run replay   (cases: test/replay/*.jsonl, one JSON object per line)
//   fn: "app" → normalizeSpokenCatalogAliases (customer app), "phone" → cleanPhrase (call scoring)
//   eq: exact expected output · has / not: case-insensitive substrings that must / must not appear
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSpokenCatalogAliases } from "../../src/text-intents.ts";
import { cleanPhrase } from "../../src/call-scoring.ts";
import { loadAliases, applySharedAliases } from "../../src/aliases.ts";

type Case = { id: string; fn: "app" | "phone"; input: string; eq?: string; has?: string[]; not?: string[] };
const dir = path.dirname(fileURLToPath(import.meta.url));
const cases: Array<Case & { file: string }> = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) {
  fs.readFileSync(path.join(dir, f), "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try { cases.push({ ...JSON.parse(line), file: f }); } catch { throw new Error(`${f}:${i + 1} is not valid JSON`); }
  });
}

test("alias file loads and every rule compiles", () => {
  const raw = JSON.parse(fs.readFileSync(path.resolve(dir, "../../data/aliases/aliases.json"), "utf8")).aliases;
  assert.equal(loadAliases(true).length, raw.length);
});

test("shared aliases are idempotent", () => {
  for (const c of cases) {
    const once = applySharedAliases(c.input, c.fn);
    assert.equal(applySharedAliases(once, c.fn), once, c.id);
  }
});

for (const c of cases) {
  test(`${c.file} · ${c.id}`, () => {
    const out = c.fn === "phone" ? cleanPhrase(c.input) : normalizeSpokenCatalogAliases(c.input);
    const low = out.toLowerCase();
    if (c.eq !== undefined) assert.equal(out, c.eq);
    for (const h of c.has || []) assert.ok(low.includes(h.toLowerCase()), `expected "${h}" in "${out}"`);
    for (const n of c.not || []) assert.ok(!low.includes(n.toLowerCase()), `did not expect "${n}" in "${out}"`);
  });
}
