// readback1: synthetic turns only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectReadback, dishCounts, applyReadback } from "../../src/staff-readback.ts";
const T = (...xs: Array<[string, string]>) => xs.map(([speaker, text]) => ({ speaker, text }));
test("readback1: confirmed recap", () => {
  const r = detectReadback(T(["staff", "Cocina Elvis"], ["caller", "dos tacos y una torta"], ["staff", "¿Algo más?"], ["caller", "no"], ["staff", "Entonces dos tacos y una torta, van a ser 18 dólares, ¿okay?"], ["caller", "Sí, gracias"]));
  assert.equal(r.status, "confirmed"); assert.deepEqual(r.dishCounts, { taco: 2, torta: 1 });
});
test("readback1: corrected recap applies the customer's fix", () => {
  const r = detectReadback(T(["staff", "Cocina Elvis"], ["caller", "tres tacos"], ["staff", "ok"], ["caller", "y una coca"], ["staff", "Entonces son dos tacos y una coca"], ["caller", "No, tres tacos"]));
  assert.equal(r.status, "corrected");
  const line = (name: string, q: number) => ({ name, quantity: q, unitCents: 300, totalCents: 300 * q });
  const a = applyReadback([line("Taco", 2), line("Coca Cola", 1)], r);
  assert.equal(a.lines[0].quantity, 3);
});
test("readback1: no recap, or recap without an answer → none", () => {
  assert.equal(detectReadback(T(["staff", "Cocina Elvis"], ["caller", "un taco"], ["staff", "ok, 20 minutos"], ["caller", "gracias"])).status, "none");
  assert.equal(detectReadback(T(["staff", "hola"], ["caller", "un taco"], ["staff", "ok"], ["staff", "Entonces dos tacos y una torta"])).status, "none");
});
test("readback1: confirmed counts fix a single line's quantity, never guess between lines", () => {
  const line = (name: string, q: number) => ({ name, quantity: q, unitCents: 300, totalCents: 300 * q });
  const rb: any = { status: "confirmed", dishCounts: { taco: 4 } };
  assert.equal(applyReadback([line("Taco", 3)], rb).lines[0].quantity, 4);
  assert.deepEqual(applyReadback([line("Taco", 1), line("Taco", 2)], rb).changed, []);
  assert.deepEqual(dishCounts("tus quesadillas y tus tacos y tus dos cocas"), { quesadilla: 0, taco: 0, coca: 2 });
});
import * as L from "../../src/learning.ts";
test("readback1: stats by device and confirmed weight; phrases strip PII", () => {
  const ex = (dev: string, rb: string, elvi: number) => ({ channel: "phone", difficulty: "clear", readback: rb, answeredBy: dev, elviScore: elvi, staffScore: 90, at: "2026-10-21T17:00:00Z" });
  const s = L.readbackStats([ex("desk 0000", "confirmed", 100), ex("desk 0000", "none", 50), ex("counter", "none", 80), { ...ex("counter", "confirmed", 10), difficulty: "messy" }] as any);
  const desk = s.find((x: any) => x.device === "desk 0000")!; assert.equal(desk.readbacks, 1); assert.equal(desk.withReadback.elvi, 100); assert.equal(desk.withoutReadback.elvi, 50);
  assert.equal(s.find((x: any) => x.device === "all")!.calls, 3);
  const p = L.readbackPhrases([{ callSid: "CA" + "3".repeat(32), customerName: "Zorbo", turns: [{ speaker: "staff", text: "hola" }, { speaker: "caller", text: "un taco" }, { speaker: "staff", text: "ok" }, { speaker: "staff", text: "Entonces Zorbo, dos tacos y una torta al 555-555-0123, ¿okay?" }, { speaker: "caller", text: "Sí" }] }]);
  assert.equal(p.length, 1); assert.ok(!/Zorbo|555/.test(p[0].text));
});
