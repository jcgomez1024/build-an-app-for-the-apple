import { test } from "node:test";
import assert from "node:assert/strict";
import { closedLabel } from "../../src/call-log.ts";
test("closedlabel1: after/before hours ≠ Monday", () => {
  assert.equal(closedLabel({ reason: "after", weekday: 2 }), "Cerrado (fuera de horario)");
  assert.equal(closedLabel({ reason: "before", weekday: 3 }), "Cerrado (fuera de horario)");
  assert.equal(closedLabel({ reason: "day", weekday: 1 }), "Cerrado (lunes)");
  assert.equal(closedLabel(undefined), "Cerrado (día cerrado)");
});
