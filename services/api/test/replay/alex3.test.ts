// alex3 (CA63e343, Oct 31 2:10 PM ET): 3 QD REGULAR bistec sin verdura, 2 tacos taqueros bistec, 1 horchata; delivery to Perry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const D = await import("../../src/delivery.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const d = JSON.parse(readFileSync(new URL("../fixtures/CA63e343-alex3.json", import.meta.url), "utf8"));
test("alex3: 'Tres ques,' phantom 3 QST bistec dropped; 'una guarda chata' + staff horchata added", () => {
  const c = structuredClone(d.cart.cart); L.applyAlex3(c, d.turns, menu);
  assert.deepEqual(c.map((l: any) => `${l.quantity} ${l.itemId.split("-").slice(0, 2).join("-")}`), ["3 sq-qd", "2 sq-taco", "1 sq-drink"]);
  assert.match(c[2].itemId, /horchata/);
});
test("alex3 general: two caller quesadilla asks keep both lines; no staff confirm → no drink", () => {
  const c: any[] = [{ itemId: "sq-qd-x-regular", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  const t = [{ speaker: "caller", text: "dos quesadillas fritas de bistec" }, { speaker: "caller", text: "y dos quesadillas taqueras de bistec" }, { speaker: "caller", text: "una guarda chata" }, { speaker: "staff", text: "Okay." }];
  L.applyAlex3(c, t, menu); assert.equal(c.length, 2);
});
test("alex3: 'haciendo deliveries' + staff 'te la llevamos' → DELIVERY; town Perry for the quote", () => {
  assert.equal(D.detectFulfillment(d.turns).fulfillment, "DELIVERY");
  assert.equal(D.detectAddress(d.turns).address, null);
  assert.equal(D.cityHeard(d.turns), "Perry, OH");
  assert.equal(D.detectFulfillment([{ speaker: "staff", text: "Okay, para llevar." }] as any).fulfillment, "PICKUP");
});
