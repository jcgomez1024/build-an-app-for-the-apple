// faq1: question calls record Carlos's FAQ answer; UNUSUAL_CALL summary includes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCall, faqAnswers } from "../../src/call-classify.ts";

test("faq1: beans → no lard; rice → chicken bouillon", () => {
  assert.deepEqual(faqAnswers("¿los frijoles llevan manteca?").map((a) => a.id), ["frijoles-manteca"]);
  assert.deepEqual(faqAnswers("is the rice vegetarian?").map((a) => a.id), ["arroz-caldo-pollo"]);
});
test("faq1: question call summary includes the answer (es/en)", () => {
  const u = classifyCall([{ speaker: "caller", text: "Hola, ¿los frijoles tienen manteca? Soy vegetariana." }, { speaker: "staff", text: "Déjeme ver." }], false)!;
  assert.equal(u.category, "question_dietary");
  assert.match(u.summary_es, /no llevan manteca/);
  assert.match(u.summary_en, /no lard/);
  assert.equal(u.answers![0].id, "frijoles-manteca");
});

test("qgeneral1: wait/hours/price/location/menu → question_general; ingredients → question_dietary", () => {
  const c = (t: string) => classifyCall([{ speaker: "caller", text: t }, { speaker: "staff", text: "Okay." }], false)?.category;
  assert.equal(c("I just wondered how long does it take to get some carry out food?"), "question_general");
  assert.equal(c("¿A qué hora cierran hoy?"), "question_general");
  assert.equal(c("How much is a burrito?"), "question_general");
  assert.equal(c("Where are you located?"), "question_general");
  assert.equal(c("Are your beans vegetarian?"), "question_dietary");
});
