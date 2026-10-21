import { test } from "node:test";
import assert from "node:assert/strict";
import { closedLabel } from "../../src/call-log.ts";
test("closedlabel1: label = the call's actual ET weekday, every day", () => {
  assert.equal(closedLabel({ reason: "after", weekday: 2 }), "Cerrado (martes)");
  assert.equal(closedLabel({ reason: "before", weekday: 3 }), "Cerrado (miércoles)");
  assert.equal(closedLabel({ reason: "day", weekday: 1 }), "Cerrado (lunes)");
  ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"].forEach((d, i) => assert.equal(closedLabel({ reason: "after", weekday: i }), `Cerrado (${d})`));
  // no weekday logged: derived from the timestamp in ET (Tue 6:37 PM ET = Tue 22:37 UTC; Tue 11:30 PM ET = Wed 03:30 UTC)
  assert.equal(closedLabel({ reason: "after", ts: "2026-10-20T22:37:36Z" }), "Cerrado (martes)");
  assert.equal(closedLabel({ reason: "after", ts: "2026-10-21T03:30:00Z" }), "Cerrado (martes)");
  assert.equal(closedLabel(undefined), "Cerrado (fuera de horario)");
});
