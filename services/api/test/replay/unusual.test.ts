// unusual1: non-order calls → UNUSUAL_CALL {category, urgent, question}. Synthetic transcripts only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCall, scrub } from "../../src/call-classify.ts";
import { auditCall } from "../../src/auditor.ts";
const c = (...texts: string[]) => texts.map((text, i) => ({ speaker: i % 2 ? "staff" : "caller", text }));

test("unusual1: categories + urgent", () => {
  const beans = classifyCall(c("Are the beans and rice on your menu vegetarian, or do they have meat in them?", "Yes, pinto beans, Mexican rice."), false)!;
  assert.equal(beans.category, "question_dietary"); assert.equal(beans.urgent, false); assert.match(beans.question!, /vegetarian/);
  assert.deepEqual([classifyCall(c("I got the wrong order, this is ridiculous"), true)!.category, classifyCall(c("I got the wrong order"), true)!.urgent], ["complaint", true]);
  assert.equal(classifyCall(c("la comida llegó fría y faltó un taco"), false)!.urgent, true);
  assert.equal(classifyCall(c("do you do catering for 50 people?"), false)!.category, "catering_large");
  assert.equal(classifyCall(c("Hi, this is about your Google business listing, press 1"), false)!.category, "wrong_number_spam");
  assert.equal(classifyCall(c("are you hiring? I want to apply for a job"), false)!.category, "reservation_other");
  assert.equal(classifyCall(c("two comal quesadillas, steak and rice"), true), null); // normal order
});

test("unusual1: no phone numbers or addresses in the question/summary", () => {
  assert.doesNotMatch(scrub("call me at 216-555-0100, I'm at 123 Main Street"), /555|Main/);
});

test("unusual1: auditor flags a question-only call as UNUSUAL_CALL (ping)", () => {
  const row = { recordingSid: "RE", at: new Date(0).toISOString(), recordingSec: 40, turns: c("Are your beans vegetarian?", "Yes."), elvi: [], ticket: null };
  const f = auditCall(row, Date.now())!.flags;
  assert.equal(f.length, 1); assert.equal(f[0].type, "UNUSUAL_CALL"); assert.equal(f[0].category, "question_dietary"); assert.equal(f[0].urgent, false);
});
