// marta1 (CAc8d287, Oct 31 1:15 PM ET): birria, 2 QCO buche con chorizo ("las dos"), 1 tripa, 1 chicharrón prensado; name doña Marta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const N = await import("../../src/order-name.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const meats = (l: any) => l.modifiers.map((m: any) => m.option).filter((o: string) => / \/ /.test(o) && !/Homemade|Gordita|Dorada|Preparada/.test(o)).sort().join("+");
const show = (c: any[]) => c.map((l: any) => `${l.quantity} ${l.itemId.split("-").slice(0, 2).join("-")} ${meats(l)}`);

test("marta1: 'buche con chorizo, las dos' = one 2× buche+chorizo line; prestado→prensado QCO added", () => {
  const d = fx("CAc8d287-marta1"); const c = d.cart.cart; L.applyMarta1(c, d.turns, menu);
  assert.deepEqual(show(c), ["1 sq-birria ", "2 sq-quesadilla Buche / Pork Stomach (+$0.50)+Chorizo / Mexican Sausage", "1 sq-quesadilla Tripa / Beef Tripe", "1 sq-quesadilla Prensado / Spicy Pork (+$0.50)"]);
  assert.ok(c[3].modifiers.some((m: any) => /QCO/.test(m.option)));
});
test("marta1: staff 'doña Marta' beats a junk spelled name", () => {
  assert.equal(N.nameFromTranscriptInfo(fx("CAc8d287-marta1").turns)?.name, "Marta");
});
test("marta1 general: no add when staff says they're out", () => {
  const c: any[] = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [] }];
  assert.equal(L.addSaidMeatLine(c, [{ speaker: "caller", text: "dos quesadillas" }, { speaker: "caller", text: "y una de chicharrón prensado" }, { speaker: "staff", text: "No, no tenemos prensado hoy." }] as any, menu), false);
});
