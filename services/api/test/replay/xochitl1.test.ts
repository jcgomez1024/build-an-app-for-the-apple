import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";

// xochitl1 (CAb2b6edd, Nov 5 11:12 AM ET, staff-answered): 1 torta de chorizo + "dos sacos de buche" (STT for tacos) on
// "tortilla hecha a mano" (comal). After-call turned the fragment into a 1 × buche TORTA. Stub = the model's behavior.
const d = JSON.parse(readFileSync(new URL("../fixtures/CAb2b6edd-xochitl1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const stub = () => { const torta = (meat: string) => ({ type: "add_item", itemId: "sq-torta-4GNTTE", quantity: 1, modifiers: [{ step: "(A) Torta Options", option: "(TO) Torta" }, { step: "(B) Torta Carne Options", option: meat }] });
let askedTacos = false;
const r: any = async (t: string) => {
  if (/torta de chorizo/i.test(t)) return { actions: [torta("Chorizo / Mexican Sausage")], reply: "Torta: chorizo, salsa asada. $4.75. ¿Algo más?" };
  if (/^\W*que s[ií] torta\W*$/i.test(t)) return { actions: [], reply: "Torta: ¿Bistec, Cabeza, Carnitas o Chorizo?" };
  if (/^\W*chorizo\W*$/i.test(t)) return { actions: [torta("Chorizo / Mexican Sausage")], reply: "Torta: chorizo, salsa asada. $4.75. ¿Algo más?" };
  if (/torta de buche/i.test(t)) return { actions: [torta("Buche / Pork Stomach (+$0.50)")], reply: "Torta: buche, salsa asada. $5.25. ¿Algo más?" };
  if (/dos tacos de buche/i.test(t)) { askedTacos = true; return { actions: [], reply: "Tacos: ¿Taco Comal, Taco Harina o Taco Taquero?" }; }
  if (askedTacos && /hecha a mano|comal/i.test(t)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "(B) T Carnes / Meats Opciones", option: "Buche / Pork Stomach (+$0.50)" }] }], reply: "2 × Taco: comal, buche. ¿Algo más?" };
  return { actions: [], reply: "Muy bien." }; };
r.menu = () => M; return r; };

test("xochitl1: torta chorizo kept; 'dos sacos de buche' = 2 TCO buche tacos, no buche torta", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart, j = (l: any) => JSON.stringify(l.modifiers);
  const tortas = c.filter((l: any) => /^sq-torta-/.test(l.itemId));
  assert.equal(tortas.length, 1, JSON.stringify(c)); assert.match(j(tortas[0]), /Chorizo/); assert.equal(tortas[0].quantity, 1);
  const tacos = c.filter((l: any) => /^sq-taco-/.test(l.itemId));
  assert.equal(tacos.length, 1); assert.equal(tacos[0].quantity, 2); assert.match(j(tacos[0]), /TCO/); assert.match(j(tacos[0]), /Buche/);
  assert.equal(c.length, 2);
});
