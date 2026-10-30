import { test } from "node:test";
import assert from "node:assert/strict";
const { noOfferUnavailable } = await import("../../src/elvi.ts");
const history: any = [
  { role: "customer", text: "¿Tienen enchiladas?" },
  { role: "assistant", text: "Las enchiladas son hasta mañana." },
];
test("live: no offering enchiladas after staff said hasta mañana", () => {
  const r: any = noOfferUnavailable({ language: "es", reply: "Claro, le pongo unas enchiladas verdes.", actions: [{ type: "add_item", itemId: "sq-enchiladas-verdes-X", quantity: 1 }] } as any, { language: "es", transcript: "pues unas enchiladas", menu: [], history } as any);
  assert.ok(!/le pongo unas enchiladas/.test(r.reply), r.reply);
  assert.match(r.reply, /no tenemos enchilada/);
  assert.equal(r.actions.length, 0);
});
test("live: unrelated reply/actions untouched; no history → untouched", () => {
  const a: any = { language: "es", reply: "Le pongo dos tacos de bistec.", actions: [{ type: "add_item", itemId: "sq-taco-X", quantity: 2 }] };
  assert.equal(noOfferUnavailable(a, { language: "es", transcript: "", menu: [], history } as any), a);
  const b: any = { language: "es", reply: "Sí, tenemos enchiladas.", actions: [] };
  assert.equal(noOfferUnavailable(b, { language: "es", transcript: "", menu: [], history: [] } as any), b);
});
