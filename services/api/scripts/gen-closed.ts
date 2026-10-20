// closed1/afterhours1: generate the closed-day + before/after-hours clips in Carlos's cloned xAI voices via ensurePrompt.
//   npx tsx scripts/gen-closed.ts          # generate missing clips
//   npx tsx scripts/gen-closed.ts --list   # just print keys + wording
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.twilio") });
const t = await import("../src/twilio.ts");
const list = process.argv.includes("--list");
const states = [{ kind: "day", when: 2, openMin: 600, variant: "day" } as const, ...t.allClosedStates()];
for (const s of states) for (const lang of ["es", "en"] as const) {
  const key = t.closedStateKey(lang, s), text = t.closedText(lang, s);
  const ok = list ? true : await t.ensurePrompt(lang, text, key, 20000);
  console.log(`${list ? "" : ok ? "ok   " : "FAIL "}${key}.mp3  ${text}`);
}
process.exit(0);
