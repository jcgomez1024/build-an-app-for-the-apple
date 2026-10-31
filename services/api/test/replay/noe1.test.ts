// noe1 (CA8e26a89, Oct 30 8:08 PM ET, Noe, Spanish staff-answered pickup): 4 QD regular bistec "con la verdura aparte" + pico con chips.
// Cart right; the "verdura aparte" note was missed (shared removalNotesIn → live ticket notes + post-call shadow).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-30T18:00:00-04:00";
const { shadowOrderFromTurns, removalNotesIn } = await import("../../src/call-scoring.ts");
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const QD = fx("CA8e26a89-cart.json")[0], PICO = fx("CA8e26a89-cart.json")[1];
test("noe1: removalNotesIn catches toppings on the side, ES and EN", () => {
  for (const t of ["No regulares, con la verdura aparte, por favor.", "veggies on the side", "con las verduras por separado", "toppings on the side please", "aparte la verdura"]) assert.deepEqual(removalNotesIn(t), ["verdura aparte"], t);
  assert.deepEqual(removalNotesIn("con todo, sin verdura"), ["no verdura"]);
  assert.deepEqual(removalNotesIn("un pico de gallo con chips"), []);
});
test("noe1 replay: note lands on the QD line, not the pico", async () => {
  const run = async (text: string) => /quesadillas/i.test(text) ? { actions: [{ type: "add_item", ...QD }], reply: "4 QD" }
    : /pico/i.test(text) ? { actions: [{ type: "add_item", ...PICO }], reply: "Listo." } : { actions: [], reply: "Muy bien." };
  const r: any = await shadowOrderFromTurns(fx("CA8e26a89-turns.json"), run as any);
  const qd = r.cart.find((l: any) => /quesadilla-dorada/.test(l.itemId)), pico = r.cart.find((l: any) => /dips/.test(l.itemId));
  assert.ok(qd && (qd.elviNotes || []).includes("verdura aparte"), JSON.stringify(r.cart));
  assert.ok(!pico || !(pico.elviNotes || []).includes("verdura aparte"));
});
