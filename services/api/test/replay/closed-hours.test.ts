// afterhours1: simulated-time checks for the closed / before-opening / after-closing phone messages.
// Pure: no Twilio, Square or xAI calls. Uses the real site hours (data/site-catalog.json) + a fake bypass number.
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
  ["Sun 8:59 AM → before 9", et(18, 8, 59), "before-today-540"],
  ["Sun 9:00 AM open", et(18, 9), "open"],
  ["Sun 8:04 PM grace", et(18, 20, 4), "open"],
  ["Sun 8:05 PM → Tue 10 (Mon closed)", et(18, 20, 5), "after-tue-600"],
  ["Mon noon → Monday message", et(19, 12), "day"],
  ["Mon 11:59 PM → Monday message", et(19, 23, 59), "day"],
  ["Tue 12:30 AM → before 10", et(20, 0, 30), "before-today-600"],
  ["Tue 9:59 AM → before 10", et(20, 9, 59), "before-today-600"],
  ["Tue 10:00 AM open (phone opens 10, site 11)", et(20, 10), "open"],
  ["Tue 5:04 PM grace", et(20, 17, 4), "open"],
  ["Tue 5:05 PM → tomorrow 10", et(20, 17, 5), "after-tomorrow-600"],
  ["Wed 7:59 PM open", et(21, 19, 59), "open"],
  ["Wed 8:06 PM → tomorrow 10", et(21, 20, 6), "after-tomorrow-600"],
  ["Fri 9:04 PM grace", et(23, 21, 4), "open"],
  ["Fri 11:30 PM → tomorrow 10", et(23, 23, 30), "after-tomorrow-600"],
  ["Sat 9:10 PM → tomorrow 9 (Sunday)", et(24, 21, 10), "after-tomorrow-540"],
];
for (const [name, at, want] of cases) test(`closed-hours · ${name}`, () => assert.equal(v(at), want));

test("closed-hours · bypass number always rings", () => {
  for (const [, at] of cases) assert.equal(v(at, "+1 (555) 555-0100"), "open");
});
test("closed-hours · TWILIO_AFTERHOURS=0 keeps only the Monday message", () => {
  process.env.TWILIO_AFTERHOURS = "0";
  try { assert.equal(v(et(20, 17, 30)), "open"); assert.equal(v(et(19, 12)), "day"); } finally { delete process.env.TWILIO_AFTERHOURS; }
});
test("closed-hours · wording", () => {
  const s = t.closedState(caller, et(20, 17, 30))!;
  assert.equal(t.closedText("en", s), "Thanks for calling Cocina Elvis. Sorry, we're now closed for the day. We open tomorrow at 10 AM. See you then!");
  assert.equal(t.closedText("es", s), "Gracias por llamar a Cocina Elvis. Lo sentimos, ya cerramos por hoy. Abrimos mañana a las diez de la mañana. ¡Hasta luego!");
  const tw = t.closedTwiml("https://x.test", undefined, s);
  assert.match(tw, /closed-es-after-tomorrow-600\.mp3[\s\S]*closed-en-after-tomorrow-600\.mp3[\s\S]*<Hangup\/>$/);
});
test("closed-hours · every needed clip exists in Carlos's voice", () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/phone-prompts");
  for (const s of t.allClosedStates()) for (const l of ["es", "en"] as const) assert.ok(fs.existsSync(path.join(dir, `${t.closedStateKey(l, s)}.mp3`)), t.closedStateKey(l, s));
});
