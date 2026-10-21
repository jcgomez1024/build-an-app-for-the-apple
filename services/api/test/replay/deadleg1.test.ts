// deadleg1: synthetic numbers. Caller hangs up at 5 s; desk picks up an empty leg later → missed, not "Contestada".
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCallLog } from "../../src/call-log.ts";
import { parentLegEnded } from "../../src/twilio.ts";
const sid = "CA" + "d".repeat(32), T = (s: number) => new Date(Date.UTC(2026, 9, 21, 17, 10, s)).toISOString();
const base = [
  { ts: T(0), event: "incoming", callSid: sid, caller: "+15555550123", calledNumber: "+15555550199" },
  { ts: T(0.5), event: "ring_start", callSid: sid, ringTo: "+14405550000" },
  { ts: T(11), event: "ring_answered", callSid: sid, ringTo: "+14405519249" },
  { ts: T(15), event: "whisper", callSid: sid, via: "desk", ringTo: "+14405519249", accepted: true },
  { ts: T(51), event: "answered", callSid: sid, durationSec: 36, via: "desk" },
];
const opts = { days: ["2026-10-21"], isTraining: () => false, hasTicket: () => false, now: Date.parse(T(0)) + 3600_000 };
test("deadleg1: parent ended before any bridge → 'Colgó antes de contestar · esperó 0:05', no duration, late note", () => {
  const [r] = buildCallLog([...base, { ts: T(60), event: "parent_end", callSid: sid, durationSec: 5 }], opts);
  assert.equal(r.outcome, "hungup"); assert.equal(r.missed, true);
  assert.equal(r.outcomeLabel, "Colgó antes de contestar · esperó 0:05");
  assert.equal(r.durationSec, null); assert.equal(r.note, "escritorio contestó 6 s tarde");
});
test("deadleg1: a bridged desk call keeps 'Contestada' and talk time = after the bridge only", () => {
  const ev = [...base.slice(0, 4), { ts: T(16), event: "bridged", callSid: sid }, { ts: T(51), event: "answered", callSid: sid, durationSec: 36, via: "desk" }];
  const [r] = buildCallLog(ev, opts);
  assert.match(r.outcomeLabel, /^Contestada en escritorio/); assert.equal(r.durationSec, 35); assert.equal(r.missed, false);
});
test("deadleg1: parentLegEnded reads Twilio status (read-only GET); unknown → null", async () => {
  process.env.TWILIO_ACCOUNT_SID = "ACtest"; process.env.TWILIO_AUTH_TOKEN = "x";
  const f: any = async () => new Response(JSON.stringify({ status: "completed", duration: "5" }));
  assert.equal(await parentLegEnded(sid, f), true);
  assert.equal(await parentLegEnded(sid, (async () => new Response(JSON.stringify({ status: "in-progress" }))) as any), false);
  assert.equal(await parentLegEnded(sid, (async () => new Response("", { status: 500 })) as any), null);
});
