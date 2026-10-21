import { test } from "node:test";
import assert from "node:assert/strict";
import { ringbackWav, waitingHoldTwiml, RINGBACK_PATH } from "../../src/twilio.ts";
test("ringback1: US ringback WAV — 8 kHz mono, 6 s cycle, tone 0–2 s, silence 2–6 s, 440+480 Hz", () => {
  const w = ringbackWav();
  assert.equal(w.toString("ascii", 0, 4), "RIFF"); assert.equal(w.readUInt32LE(24), 8000); assert.equal(w.readUInt16LE(22), 1);
  const s = (i: number) => w.readInt16LE(44 + i * 2), n = (w.length - 44) / 2;
  assert.equal(n, 48000);
  let on = 0, off = 0; for (let i = 0; i < 16000; i++) on = Math.max(on, Math.abs(s(i))); for (let i = 16000; i < n; i++) off = Math.max(off, Math.abs(s(i)));
  assert.ok(on > 8000); assert.equal(off, 0);
  // 440+480 beat at 40 Hz: energy envelope dips every 25 ms
  let cross = 0; for (let i = 1000; i < 9000; i++) if ((s(i - 1) < 0) !== (s(i) < 0)) cross++;
  assert.ok(Math.abs(cross - 960) <= 20, `460 Hz carrier ×2 + 40 Hz beat nulls ≈ 960 crossings/s, got ${cross}`); // 440+480 = 2·cos(2π·20t)·sin(2π·460t)
});
test("ringback1: waiting hold TwiML loops the hosted ringback (no music/message)", () => {
  const x = waitingHoldTwiml("https://elvi.example", "es");
  assert.match(x, new RegExp(`<Play loop="10">https://elvi.example${RINGBACK_PATH.replace(/\//g, "\\/")}</Play>`));
  assert.doesNotMatch(x, /<Say|hold-music/);
});
