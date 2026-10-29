// sean1 (CA249b7de2b1ff6c44212b5de33fd6508a ~11:41 AM ET Oct 29): English pickup, Sean calling, Ryan picking up; staff answered.
// Correct: 4 × QCO bistec (caller "let's do Kamal", staff "Corn is okay, corn"); onions + cilantro on the side; PICKUP; name Ryan.
// Live miss: staff's option list "Corn, flour, Frankie Sevilla" was read as a flour pick → 4 × QHR (+$0.75 each);
// name "Ryan Or" from "it'll be under Ryan or Sean".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T11:41:00-04:00";
const { shadowOrderFromTurns, staffPick, rewriteCallerText } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA249b7d-turns.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR";
const OPTS = ["Quesadilla Comal", "Quesadilla Harina", "Quesadilla Taquera"];
const Q_ASK = "Quesadilla: Quesadilla Comal, Quesadilla Harina or Quesadilla Taquera?";
const TORT: Record<string, string> = { comal: "(QCO) Quesadilla Comal / Homemade (+$1.00)", harina: "(QHR) Quesadilla Harina / Flour (+$0.75)", taquera: "(QST) Quesadilla Taquera / Street Quesadilla" };
const ring = (k: string) => ({ reply: "4 × Quesadilla. Anything else?", actions: [{ type: "add_item", itemId: Q, quantity: 4, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, { step: "(A) Q Tortilla Options", option: TORT[k] }] }] });
/** Stub: asks the tortilla on the first dish turn; rings whichever tortilla word it is given. */
const stub = async (text: string) => {
  const t = text.toLowerCase();
  if (/comal/.test(t)) return ring("comal");
  if (/harina|flour/.test(t)) return ring("harina");
  if (/taquera/.test(t)) return ring("taquera");
  if (/quesadilla/.test(t)) return { reply: Q_ASK, actions: [] };
  return { reply: "Anything else?", actions: [] };
};

test("sean1: Kamal/Camal → comal; 'corn' for a quesadilla is comal; an option list is not a pick", () => {
  assert.equal(staffPick(OPTS, "let's do Kamal."), "Quesadilla Comal");
  assert.equal(staffPick(OPTS, "Camal"), "Quesadilla Comal");
  assert.equal(staffPick(OPTS, "Corn is okay, corn."), "Quesadilla Comal");
  assert.equal(staffPick(OPTS, "Corn, flour, Frankie Sevilla."), null);
  assert.match(rewriteCallerText("let's do Kamal."), /comal/);
});

test("sean1: name Ryan (not 'Ryan Or')", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Ryan");
});

test("sean1: 4 × QCO bistec, no flour; PICKUP", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const lines = r.cart.map((l: any) => ({ id: String(l.itemId), q: Number(l.quantity) || 1, mods: (l.modifiers || []).map((m: any) => String(m.option)) }));
  const dump = JSON.stringify(lines);
  const qs = lines.filter((l: any) => l.id === Q);
  assert.equal(qs.reduce((n: number, l: any) => n + l.q, 0), 4, "4 quesadillas: " + dump);
  assert.ok(qs.every((l: any) => l.mods.some((o: string) => /QCO/.test(o)) && l.mods.some((o: string) => /Bistec/.test(o))), "all QCO bistec: " + dump);
  assert.ok(!dump.includes("QHR"), "no flour: " + dump);
  assert.equal(r.fulfillment, "PICKUP", "pickup: " + dump);
});
