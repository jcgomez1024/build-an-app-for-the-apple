import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { applySharedAliases } from "../../src/aliases.js";
import { applySpokenQty, applyStaffCountEcho } from "../../src/modifier-turns.js";

// yoni1 (CA28e2b5): "me pone nueve tortas de bise", staff "Nueve." → 9 × Torta bistec (Elvi: 1 torta, meat "confirmar").
const d = JSON.parse(readFileSync(new URL("../fixtures/CA28e2b5-yoni1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const T = "sq-torta-4GNTTE";
const torta = (q: number) => ({ type: "add_item", itemId: T, quantity: q, modifiers: [{ step: "(A) Torta Options", option: "(TO) Torta" }, { step: "(B) Torta Carne Options", option: "Bistec / Steak" }] });
const stub = (seen: string[]) => { const r: any = async (t: string) => { seen.push(t);
  if (/tortas de bistec/i.test(t)) return { actions: [torta(1)], reply: "Torta bistec. ¿Algo más?" };
  if (/tortas/i.test(t)) return { actions: [], reply: "Torta: ¿Bistec, Cabeza, Carnitas o Chorizo?" };
  return { actions: [], reply: "Muy bien." }; }; r.menu = () => M; return r; };

test("yoni1: 'bise' reaches the model as bistec; spoken 'nueve' sets qty → 9 × torta bistec", async () => {
  const seen: string[] = [];
  const r: any = await shadowOrderFromTurns(d.turns, stub(seen));
  assert.ok(seen.some((t) => /nueve tortas de bistec/i.test(t)), seen.join(" | "));
  const ts = r.cart.filter((l: any) => l.itemId === T);
  assert.equal(ts.length, 1); assert.equal(ts[0].quantity, 9);
  assert.match(JSON.stringify(ts[0].modifiers), /Bistec/); assert.doesNotMatch(JSON.stringify(ts[0]), /confirmar/);
});
test("yoni1: bistec STT variants, not over-matched", () => {
  for (const s of ["tortas de bise", "dos de bisté", "un taco de biste", "de bistek", "con bisteck"]) assert.match(applySharedAliases(s, "phone"), /bistec/, s);
  for (const s of ["la bise es mía", "besitos", "bisected", "Bisbee"]) assert.doesNotMatch(applySharedAliases(s, "phone"), /bistec/, s);
});
test("yoni1: spoken count before a dish + staff count echo", () => {
  const a = [torta(1)]; assert.equal(applySpokenQty(a, "me pone nueve tortas de bistec"), true); assert.equal(a[0].quantity, 9);
  const b = [torta(1)]; assert.equal(applySpokenQty(b, "una torta de bistec"), false); assert.equal(b[0].quantity, 1);
  const c = [torta(1), torta(1)]; applySpokenQty(c, "dos tortas, una de bistec y otra de chorizo"); assert.deepEqual(c.map((x) => x.quantity), [1, 1]);
  const cart: any[] = [{ ...torta(1) }];
  applyStaffCountEcho(cart, [{ speaker: "caller", text: "me pone nueve tortas de bistec" }, { speaker: "staff", text: "Nueve." }]);
  assert.equal(cart[0].quantity, 9);
});
