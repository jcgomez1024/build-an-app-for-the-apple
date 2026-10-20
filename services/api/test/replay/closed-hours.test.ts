// afterhours1: simulated-time checks for the closed / before-opening / after-closing phone messages.
// Pure: no Twilio, Square or xAI calls. Uses the real phone store hours (data/phone-hours.json) + a fake bypass number.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.TWILIO_CLOSED_ENABLED = "1";
process.env.TWILIO_CLOSED_DAYS = "1";
process.env.TWILIO_CLOSED_BYPASS = "+15555550100";
delete process.env.TWILIO_AFTERHOURS; delete process.env.TWILIO_PHONE_OPEN; delete process.env.TWILIO_CLOSE_GRACE_MIN; delete process.env.TWILIO_PHONE_HOURS_JSON;
const t = await import("../../src/twilio.ts");
const caller = "+15555550199";
// ET is UTC-4 until Nov 1, 2026. Oct 18 2026 = Sunday.
const et = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 9, day, hh + 4, mm));
const v = (d: Date, from = caller) => t.closedState(from, d)?.variant ?? "open";
const cases: Array<[string, Date, string]> = [
  ["Sun 7:59 AM → before 8", et(18, 7, 59), "before-today-480"],
  ["Sun 8:00 AM open", et(18, 8), "open"],
  ["Sun 8:29 PM open", et(18, 20, 29), "open"],
  ["Sun 8:30 PM → Tue 10 (Mon closed)", et(18, 20, 30), "after-tue-600"],
  ["Mon noon → Monday message", et(19, 12), "day"],
  ["Mon 11:59 PM → Monday message", et(19, 23, 59), "day"],
  ["Tue 12:30 AM → before 10", et(20, 0, 30), "before-today-600"],
  ["Tue 9:59 AM → before 10", et(20, 9, 59), "before-today-600"],
  ["Tue 10:00 AM open", et(20, 10), "open"],
  ["Tue 5:29 PM open", et(20, 17, 29), "open"],
  ["Tue 5:30 PM → tomorrow 10", et(20, 17, 30), "after-tomorrow-600"],
  ["Wed 8:29 PM open", et(21, 20, 29), "open"],
  ["Wed 8:30 PM → tomorrow 10", et(21, 20, 30), "after-tomorrow-600"],
  ["Thu 8:30 PM → tomorrow 10", et(22, 20, 30), "after-tomorrow-600"],
  ["Fri 9:29 PM open", et(23, 21, 29), "open"],
  ["Fri 9:30 PM → tomorrow 10", et(23, 21, 30), "after-tomorrow-600"],
  ["Sat 9:29 PM open", et(24, 21, 29), "open"],
  ["Sat 9:30 PM → tomorrow 8 (Sunday)", et(24, 21, 30), "after-tomorrow-480"],
  ["Sun 1:00 AM → before 8", et(25, 1), "before-today-480"],
];
for (const [name, at, want] of cases) test(`closed-hours · ${name}`, () => assert.equal(v(at), want));

test("closed-hours · bypass number always rings", () => {
  for (const [, at] of cases) assert.equal(v(at, "+1 (555) 555-0100"), "open");
});
test("closed-hours · TWILIO_AFTERHOURS=0 keeps only the Monday message", () => {
  process.env.TWILIO_AFTERHOURS = "0";
  try { assert.equal(v(et(20, 17, 45)), "open"); assert.equal(v(et(19, 12)), "day"); } finally { delete process.env.TWILIO_AFTERHOURS; }
});
test("closed-hours · wording", () => {
  const s = t.closedState(caller, et(20, 17, 30))!;
  const sat = t.closedState(caller, et(24, 21, 45))!;
  assert.equal(t.closedText("es", sat), "Gracias por llamar a Cocina Elvis. Lo sentimos, ya cerramos por hoy. Abrimos mañana a las ocho de la mañana. ¡Hasta luego!");
  assert.equal(t.closedText("en", sat), "Thanks for calling Cocina Elvis. Sorry, we're now closed for the day. We open tomorrow at 8 AM. See you then!");
  assert.equal(t.closedText("en", s), "Thanks for calling Cocina Elvis. Sorry, we're now closed for the day. We open tomorrow at 10 AM. See you then!");
  assert.equal(t.closedText("es", s), "Gracias por llamar a Cocina Elvis. Lo sentimos, ya cerramos por hoy. Abrimos mañana a las diez de la mañana. ¡Hasta luego!");
  const tw = t.closedTwiml("https://x.test", undefined, s);
  assert.match(tw, /closed-es-after-tomorrow-600\.mp3[\s\S]*closed-en-after-tomorrow-600\.mp3[\s\S]*<Hangup\/>$/);
});
test("closed-hours · every needed clip exists in Carlos's voice", () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/phone-prompts");
  for (const s of t.allClosedStates()) for (const l of ["es", "en"] as const) assert.ok(fs.existsSync(path.join(dir, `${t.closedStateKey(l, s)}.mp3`)), t.closedStateKey(l, s));
});
