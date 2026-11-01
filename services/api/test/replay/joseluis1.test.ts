import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA244be9-joseluis1.json", import.meta.url), "utf8"));
test("joseluis1: staff menu list + '¿Los dos de chorizo?' (the sopes) never adds chorizo tacos", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, (async () => ({ reply: "", actions: [] })) as any);
  assert.ok(!r.cart.some((l: any) => /taco/.test(l.itemId)));
});
test("joseluis1 rule: staff 'cinco de asada' about tacos still adds them", async () => {
  const t: any = [{ speaker: "caller", text: "me da unos tacos" }, { speaker: "staff", text: "¿De qué?" }, { speaker: "caller", text: "cinco de asada" }, { speaker: "staff", text: "Cinco de asada." }];
  const { addStaffConfirmedTacos } = await import("../../src/readback-pass.ts"); const c: any[] = []; addStaffConfirmedTacos(c, t);
  assert.equal(c[0]?.quantity, 5);
});
test("joseluis1: 'José Luis Rangel' + staff 'Muy bien, José Luis' → full name, accent kept", () => {
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "José Luis Rangel");
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "¿Me das tu nombre?" }, { speaker: "staff", text: "Muy bien, José. Danos quince." }] as any)?.name, "José");
});
