// rescore1: synthetic call — rescores with the same staff flag types don't re-notify; a new type does.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { recordFinding, ackFindings, readFindings, pendingFindings } from "../../src/auditor.ts";
const F = (type: string, detail: string) => ({ type, detail, es: detail, en: detail }) as any;
test("rescore1: count changes carry notified; one current finding; new staff type notifies", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aud-")), "f.jsonl");
  const row = { callSid: "CAtest00rescore", at: "2026-10-21T16:35:00Z", score: 33 };
  const a = recordFinding(row, [F("CUSTOM_AMOUNT", "$16"), F("STAFF_MISSING", "chilaquiles x3")], file)!;
  assert.equal(a.notified, false); ackFindings([a.id], file);
  const b = recordFinding(row, [F("CUSTOM_AMOUNT", "$16"), F("STAFF_MISSING", "chilaquiles x1")], file)!;
  assert.equal(b.notified, true);
  assert.equal(readFindings(file).filter((f) => !f.superseded).length, 1);
  assert.equal(pendingFindings(file).length, 0);
  const c = recordFinding(row, [F("CUSTOM_AMOUNT", "$16"), F("PRICE_DIFF", "x")], file)!;
  assert.equal(c.notified, false); assert.equal(pendingFindings(file).length, 1);
});
