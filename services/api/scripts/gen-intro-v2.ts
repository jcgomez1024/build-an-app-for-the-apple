// intro2: generate the short intro clips (v2 keys) in Carlos's cloned xAI voices via the existing ensurePrompt pipeline.
// Never prints secrets. Old clips are left on disk.
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
const t = await import("../src/twilio.ts");
const jobs: Array<[ "es" | "en", string, string ]> = [
  ["es", t.NOTICE_NEW.es, t.noticeNewKey("es")],
  ["en", t.NOTICE_NEW.en, t.noticeNewKey("en")],
  ["es", t.noticeNamedText("es", "Carlos"), t.noticeNamedKey("es", "carlos")],
  ["en", t.noticeNamedText("en", "Carlos"), t.noticeNamedKey("en", "carlos")],
  [t.HOLD_SWITCH.es.voice, t.HOLD_SWITCH.es.text, t.HOLD_SWITCH.es.key],
  [t.HOLD_SWITCH.en.voice, t.HOLD_SWITCH.en.text, t.HOLD_SWITCH.en.key],
];
for (const [lang, text, key] of jobs) {
  const ok = await t.ensurePrompt(lang, text, key, 20000);
  console.log(`${ok ? "ok  " : "FAIL"} ${key}.mp3  [${lang}/${t.XAI_PHONE_VOICE[lang]}] ${text}`);
}
process.exit(0);
