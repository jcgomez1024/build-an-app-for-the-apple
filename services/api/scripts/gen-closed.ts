// closed1: generate the closed-day clips in Carlos's cloned xAI voices via the existing ensurePrompt pipeline.
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
const t = await import("../src/twilio.ts");
for (const lang of ["es", "en"] as const) {
  const ok = await t.ensurePrompt(lang, t.CLOSED_TEXT[lang], t.closedKey(lang), 20000);
  console.log(`${ok ? "ok  " : "FAIL"} ${t.closedKey(lang)}.mp3  [${lang}/${t.XAI_PHONE_VOICE[lang]}] ${t.CLOSED_TEXT[lang]}`);
}
process.exit(0);
