// tortilla1 / reply1: session pattern (synthetic): "tres tacos de bistec" → ask tortilla; "taqueros/taquitos" → street taco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { completeWithSiteDefaults, STREET_WORDS } from "../../src/site-catalog.ts";

const taco: any = { id: "taco", name: "Taco", priceCents: 300, modifierGroups: [
  { id: "A", name: "(A) T Tortilla Options", minSelections: 1, maxSelections: 1, defaultOptions: ["(TCO) Taco Comal / Homemade (+$1.00)"], options: [{ id: "tco", name: "(TCO) Taco Comal / Homemade (+$1.00)", priceDeltaCents: 100 }, { id: "thr", name: "(THR) Taco Harina / Flour" }, { id: "tst", name: "(TST) Taco Taquero / Street Taco" }] },
  { id: "S", name: "(I) Salsa Preferencia / Preference", minSelections: 1, maxSelections: 1, defaultOptions: ["Mild Salsa Asada"], options: [{ id: "s1", name: "Mild Salsa Asada" }, { id: "s2", name: "Hot Salsa Roja" }] }] };
const missing = (groups: string[]) => ({ ok: false, reason: "missing_required_modifiers", selectedItem: { itemId: "taco" }, provided: [{ groupId: "B", option: "Bistec / Steak" }], requiredGroups: groups.map((g) => ({ groupId: g })) });

test("tortilla1: 'tres tacos de bistec' → the required tortilla is asked (no silent Comal); salsa preselect still silent", () => {
  const r = completeWithSiteDefaults(missing(["A", "S"]), [taco], "Quiero tres tacos de bistec");
  assert.equal(r.ok, false); assert.deepEqual(r.requiredGroups.map((g: any) => g.groupId), ["A"]);
  assert.deepEqual(r.siteDefaults.map((f: any) => f.option), ["Mild Salsa Asada"]);
});
test("tortilla1: taqueros / taquitos / street → Taco Taquero, nothing asked", () => {
  for (const t of ["tres tacos taqueros de bistec", "tres taquitos de bistec", "three street tacos"]) {
    const r = completeWithSiteDefaults(missing(["A", "S"]), [taco], t);
    assert.equal(r.ok, true, t); assert.ok(r.actions[0].modifiers.some((m: any) => m.option === "(TST) Taco Taquero / Street Taco"), t);
  }
  assert.ok(STREET_WORDS.test("can you actually make them tacos taqueros"));
});
