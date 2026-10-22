// avail2: an availability question continued with "y + dish" isn't an order; before opening, time-window dishes aren't refused.
import test from "node:test"; import assert from "node:assert/strict";
const { availabilityQuestion } = await import("../../src/elvi.ts");
const h = (...c: string[]) => c.flatMap((t) => [{ role: "customer", text: t }, { role: "assistant", text: "Sí, tenemos." }]);
test("'¿tienen X?' then '¿Y bebida?' → availability answer, no add", () => {
  const r: any = availabilityQuestion({ transcript: "¿Y agua de horchata?", language: "es", history: h("Disculpe, el día de hoy, ¿tienen tacos dorados?"), menu: [] } as any);
  assert.ok(r); assert.deepEqual(r.actions, []);
  assert.ok(availabilityQuestion({ transcript: "Disculpe, el día de hoy, ¿tienen tacos dorados?", language: "es", history: [], menu: [] } as any), "'el día de hoy' prefix still an availability question");
  assert.ok(availabilityQuestion({ transcript: "and horchata?", language: "en", history: h("do you have tamales?"), menu: [] } as any));
});
test("real orders are not swallowed", () => {
  const prev = h("¿tienen tacos dorados?");
  for (const t of ["y un agua de horchata grande", "y dos aguas de horchata", "y dame una horchata", "y quiero horchata"]) assert.equal(availabilityQuestion({ transcript: t, language: "es", history: prev, menu: [] } as any), null, t);
  assert.equal(availabilityQuestion({ transcript: "¿Y agua de horchata?", language: "es", history: h("una quesadilla de pollo"), menu: [] } as any), null, "no availability question before");
});
