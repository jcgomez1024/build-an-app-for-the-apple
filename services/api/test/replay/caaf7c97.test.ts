// CAaf7c97 (CAaf7c97e55e6414e419cff42c0b57bda8 ~4:39 PM ET Oct 29): price-only call, staff answered, 27 s.
// "¿a cómo tienes las quesadillas en comal?" / "¿qué cuestan?" → staff "$4.50"; caller will call back. Empty cart is right.
// Live miss: reply quoted QCO at $1 (the upcharge), opened the meat prompt with invented answers, name "Cuántas".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T16:39:00-04:00";
const { shadowOrderFromTurns, isQuestionOnlyCall } = await import("../../src/call-scoring.ts");
const { priceAnswer } = await import("../../src/caller-ledger.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");
const turns = JSON.parse(readFileSync(new URL("../fixtures/CAaf7c97-turns.json", import.meta.url), "utf8"));
const stubLiveMiss = async () => ({ reply: "La Quesadilla Comal está a $1. ¿Bistec, Cabeza, Carnitas o Chorizo?", actions: [{ type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }] }] });

test("caaf7c97: price questions are info-only", () => {
  assert.equal(isQuestionOnlyCall(turns), true);
  assert.equal(isQuestionOnlyCall([{ speaker: "caller", text: "¿Cuánto valen los tacos?" }]), true);
  assert.equal(isQuestionOnlyCall([{ speaker: "caller", text: "Me da dos quesadillas de bistec, ¿cuánto es?" }]), false);
});

test("caaf7c97: catalog price answers", () => {
  assert.match(priceAnswer("¿a cómo tienes las quesadillas en comal?")!, /\$4\.50/);
  assert.match(priceAnswer("¿Qué cuestan las quesadillas de harina?")!, /\$4\.25/);
  assert.match(priceAnswer("how much is a flour taco", "en")!, /\$3\.50/);
  assert.equal(priceAnswer("dos quesadillas de bistec"), null);
});

test("caaf7c97: replay → empty cart, no item flow, $4.50 reply", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  assert.equal(r.cart.length, 0);
  const replies = r.steps.map((s: any) => s.reply || "").join(" | ");
  assert.match(replies, /\$4\.50/);
  assert.doesNotMatch(replies, /\$1\b|\$1\.00|Bistec|Carnitas|La pongo|así está bien/);
  assert.ok(!r.steps.some((s: any) => /auto/.test(String(s.source))));
});

test("caaf7c97: no name from '¿Cuántas, perdón?'", () => {
  const n = nameFromTranscriptInfo(turns as any);
  assert.ok(!n || !/^(cu[aá]nt|qu[eé]|c[oó]mo)/i.test(n.name), JSON.stringify(n));
  for (const w of ["Cuántos", "Cómo", "Dónde", "Cuándo", "Quién"]) {
    const m = nameFromTranscriptInfo([{ speaker: "staff", text: `¿${w}, perdón?` }, { speaker: "caller", text: "sí" }] as any);
    assert.ok(!m || m.name.toLowerCase() !== w.toLowerCase(), w);
  }
});
