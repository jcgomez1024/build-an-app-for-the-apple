// agustin2 (CA3888d0, Oct 31 5:02 PM ET): 9 relayed sub-orders closed by "esa orden es para X"; name "Amable" from "si es amable".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const N = await import("../../src/order-name.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const d = JSON.parse(readFileSync(new URL("../fixtures/CA3888d0-agustin2.json", import.meta.url), "utf8"));
const sum = (c: any[], re: RegExp) => c.filter((l) => re.test(l.itemId + " " + l.modifiers.map((m: any) => m.option).join(" "))).reduce((a, l) => a + l.quantity, 0);
test("agustin2: relay groups rebuild the food lines from the caller's words", () => {
  const c = structuredClone(d.cart.cart); assert.ok(L.applyRelayOrders(c, d.turns, menu));
  assert.equal(sum(c, /QHR.*Bistec/), 5); assert.equal(sum(c, /QHR.*Pollo/), 2); assert.equal(sum(c, /QHR.*Lengua/), 1);
  assert.equal(sum(c, /DELUXE Preparada/), 4); assert.equal(sum(c, /QCO.*Duro.*Frijoles/), 2); assert.equal(sum(c, /QCO.*Costilla/), 2);
  assert.equal(sum(c, /TST.*Chorizo/), 3); assert.equal(sum(c, /TST.*Alpastor/), 3); assert.equal(sum(c, /QTO/), 4); assert.equal(sum(c, /^sq-burrito/), 1);
  assert.equal(sum(c, /QCO.*Bistec/), 0); assert.equal(sum(c, /^sq-extras-.*salsa/), 0); assert.equal(sum(c, /EXTRA SIDE Crema/), 3);
  assert.equal(c.find((l: any) => /EXTRA SIDE Crema/.test(JSON.stringify(l))).forName, "Anthony");
});
test("agustin2: no relay closures → untouched", () => {
  const c = structuredClone(d.cart.cart); const t = d.turns.map((x: any) => ({ ...x, text: String(x.text).replace(/\bpara\b/gi, "") }));
  assert.equal(L.applyRelayOrders(c, t, menu), false); assert.deepEqual(c, d.cart.cart);
});
test("agustin2: 'amable' is never a name; vocative Agustín wins", () => {
  assert.equal(N.nameFromTranscriptInfo(d.turns)?.name, "Agustín");
  assert.equal(N.nameFromTranscriptInfo([{ speaker: "staff", text: "¿A nombre de quién?" }, { speaker: "caller", text: "Amable" }] as any)?.name ?? null, null);
});
