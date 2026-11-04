import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { applySharedAliases } from "../../src/aliases.js";
import { applyStaffDoradaReadback } from "../../src/modifier-turns.js";

// freddy2 (CA6078cb): "Dos cajas viejas doradas y asadas y una agua jamaica" → staff "Dos quesadillas doradas de bistec, ¿preparadas o normales?"
// → "Preparada" ⇒ 2 × QD DELUXE bistec + Jamaica 32oz (Elvi had 2 Tacos Dorados bistec).
const d = JSON.parse(readFileSync(new URL("../fixtures/CA6078cb-freddy2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const TD = "sq-tacos-dorados-tacos-dorados-OHFWF3", J = "sq-drink-agua-fresca-jamaica-32oz-ZLA3ZG", DEL = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const td = () => ({ type: "add_item", itemId: TD, quantity: 2, modifiers: [{ step: "(A) Nachos Carne Options", option: "Bistec / Steak" }] });
// live-like stub: rings Tacos Dorados for the garble (worst case), jamaica for the drink
const stub = () => { const r: any = async (t: string) => {
  if (/jamaica/i.test(t)) return { actions: [{ type: "add_item", itemId: J, quantity: 1, modifiers: [] }], reply: "Jamaica." };
  if (/dorad/i.test(t) && /bistec|asad/i.test(t)) return { actions: [/QD/.test(t) ? { type: "add_item", itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: 2, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Asada" }] } : td()], reply: "Dorados." };
  return { actions: [], reply: "Muy bien." }; }; r.menu = () => M; return r; };

test("freddy2: staff 'dos quesadillas doradas' readback + 'Preparada' → 2 × QD DELUXE bistec + Jamaica", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  assert.equal(r.cart.filter((l: any) => l.itemId === TD).length, 0, JSON.stringify(r.cart));
  const qd = r.cart.filter((l: any) => /-qd-/.test(l.itemId)); assert.equal(qd.length, 1, JSON.stringify(r.cart));
  assert.equal(qd[0].itemId, DEL); assert.equal(qd[0].quantity, 2);
  assert.match(JSON.stringify(qd[0].modifiers), /DELUXE/); assert.match(JSON.stringify(qd[0].modifiers), /Bistec/);
  assert.equal(r.cart.filter((l: any) => l.itemId === J).length, 1);
});
test("freddy2: bare feminine 'doradas' → quesadillas doradas; taco/papas contexts untouched", () => {
  assert.match(applySharedAliases("Dos cajas viejas doradas y asadas", "phone"), /quesadillas doradas/);
  assert.match(applySharedAliases("dos doradas de bistec", "phone"), /quesadillas doradas de bistec/);
  for (const s of ["tres tacos doradas", "papas doradas", "tacos dorados"]) assert.doesNotMatch(applySharedAliases(s, "phone"), /quesadilla/i, s);
});
test("freddy2: Tacos Dorados rung on the raw garble still flips to QD DELUXE bistec", () => {
  const c: any[] = [td()]; applyStaffDoradaReadback(c, d.turns, M);
  assert.equal(c[0].itemId, DEL); assert.match(JSON.stringify(c[0].modifiers), /Bistec/);
});
test("freddy2: readback swap only when caller never said tacos; normales → REGULAR", () => {
  const ts = (c: string) => [{ speaker: "caller", text: c }, { speaker: "staff", text: "Dos quesadillas doradas de bistec, ¿preparadas o normales?" }];
  const a: any[] = [{ ...td(), modifiers: td().modifiers }]; applyStaffDoradaReadback(a, ts("dos tacos dorados") as any, M); assert.equal(a[0].itemId, TD);
  const b: any[] = [{ ...td(), modifiers: td().modifiers }]; applyStaffDoradaReadback(b, [...ts("dos doradas"), { speaker: "caller", text: "normales" }] as any, M);
  assert.match(b[0].itemId, /T5STUH/); assert.match(JSON.stringify(b[0].modifiers), /REGULAR/);
});
