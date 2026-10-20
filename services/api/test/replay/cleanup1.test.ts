// cleanup1: info-only calls make no shadow order; non-name words never become a caller name; ring caller ID = Twilio line.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isQuestionOnlyCall, shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscript, nameFromStaffVocative } from "../../src/order-name.ts";

const beans: any[] = [
  { speaker: "caller", text: "Yes, I'm wondering if you can tell me, are your beans and rice vegetarian?", start: 1, end: 2, language: "en" },
  { speaker: "staff", text: "Yes, I have, beans, I have fried beans, pinto, I have a rice, Mexican, and, peppers for, vegetarian.", start: 3, end: 4, language: "en" },
  { speaker: "caller", text: "Okay, so there's no meat or fat, like pork or?", start: 5, end: 6, language: "en" },
  { speaker: "staff", text: "Yeah, the Mexican rice, and the beans pinto, fried.", start: 7, end: 8, language: "en" },
  { speaker: "caller", text: "Okay, you know what, thank you very much.", start: 9, end: 10, language: "en" },
];

test("cleanup1: a dietary-question call makes no shadow order", async () => {
  assert.equal(isQuestionOnlyCall(beans), true);
  let calls = 0;
  const run = async () => { calls++; return { reply: "Burrito Grande. ¿Algo más?", actions: [{ type: "add_item", itemId: "burrito", quantity: 1 }] }; };
  const r: any = await shadowOrderFromTurns(beans, run as any);
  assert.equal(r.cart.length, 0); assert.equal(calls, 0);
  // Asking to order still orders, even with a dietary question in it.
  assert.equal(isQuestionOnlyCall([{ speaker: "caller", text: "Is the burrito vegetarian? I'd like two bean burritos." }]), false);
  assert.equal(isQuestionOnlyCall([{ speaker: "caller", text: "me da dos tacos de asada" }]), false);
  assert.equal(isQuestionOnlyCall([{ speaker: "caller", text: "two comal quesadillas, steak and rice" }]), false);
});

test("cleanup1: 'Mexican' and other non-name words are never a caller name", () => {
  assert.equal(nameFromTranscript(beans), null);
  for (const w of ["Mexican", "Mexicano", "Mexicana", "American", "Vegetarian", "Pinto", "Grande", "Welcome", "Sorry"])
    assert.equal(nameFromStaffVocative([{ speaker: "staff", text: `Okay, thank you, ${w}.` }]), null, w);
  assert.equal(nameFromStaffVocative([{ speaker: "staff", text: "Okey, dame veinte, Kilo." }]), "Kilo");
});

test("cleanup1: staff ring legs use the Twilio line as caller ID (never the customer's number)", async () => {
  process.env.TWILIO_LINES = "+12165550111=Línea A,+12165550122=Línea B";
  const { ringCallerId } = await import("../../src/twilio.ts");
  assert.equal(ringCallerId("+12165550122"), "+12165550122");
  assert.equal(ringCallerId("+12165550999"), "+12165550111");
  const src = fs.readFileSync(new URL("../../src/twilio.ts", import.meta.url), "utf8");
  assert.match(src, /const passed = "";/);
  assert.doesNotMatch(src, /const passed = passCallerId\(/);
});
