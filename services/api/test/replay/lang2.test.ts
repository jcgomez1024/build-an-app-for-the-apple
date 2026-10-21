// lang2: synthetic numbers only.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lang2-"));
process.env.ELVI_CALLERS_FILE = path.join(tmp, "callers.json");
const { setCallerLanguageManual, setCallerLanguageKey, savedLanguage, rememberCaller } = await import("../../src/caller-memory.ts");
const { confidentCallerLanguage } = await import("../../src/twilio.ts");
const T = (lang: "es" | "en", text: string) => ({ speaker: "caller" as const, start: 0, end: 1, text, language: lang });

test("lang2: confident language needs ≥8 caller words and ≥70% in one language", () => {
  assert.equal(confidentCallerLanguage([T("en", "hi can I get")]), null);
  assert.deepEqual(confidentCallerLanguage([T("en", "hi can I get two tacos and a coke please")]), { language: "en", share: 1 });
  assert.equal(confidentCallerLanguage([T("en", "hi can I get two tacos"), T("es", "de asada por favor gracias")]), null);
});
test("lang2: manual wins — speech and press-2 don't overwrite it; press 2 saves English otherwise", () => {
  rememberCaller("5550000101", { language: "es", heardSpeech: true });
  assert.equal(setCallerLanguageKey("5550000101", "en"), true); assert.equal(savedLanguage("5550000101").language, "en");
  setCallerLanguageManual("5550000101", "es", "Tester");
  rememberCaller("5550000101", { language: "en", heardSpeech: true });
  assert.equal(setCallerLanguageKey("5550000101", "en"), false);
  const s = savedLanguage("5550000101"); assert.equal(s.language, "es"); assert.equal(s.from, "manual"); assert.equal(s.by, "Tester");
});
