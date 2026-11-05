import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { applyStaffMeatCountEcho, addSaidTorta, addSideFrijoles } from "../../src/said-adds.js";

// cris2 (CA99377e, Nov 5 11:06 AM ET): 2 QHR tripa + 2 QHR lengua + torta de chorizo + side frijoles + horchata 32oz.
// After-call had 1 tripa, no torta, no frijoles. Stub = the live model's actions.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA99377e-cris2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR";
const q = (meat: string, n: number) => ({ type: "add_item", itemId: Q, quantity: n, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { step: "(B) Q Carnes / Meats", option: meat }] });
const H = { type: "add_item", itemId: "sq-drink-agua-fresca-horchata-32oz-HL6HPK", quantity: 1, modifiers: [] };
const stub = () => { const r: any = async (t: string) => {
  if (/harina de tripas/i.test(t)) return { actions: [q("Tripa / Beef Tripe (+$0.50)", 1)], reply: "Quesadilla: harina, tripa, salsa asada. $4.75. ¿Algo más?" };
  if (/quesadillas de,?\s*$/i.test(t)) return { actions: [], reply: "Quesadilla: ¿Quesadilla Comal, Quesadilla Harina o Quesadilla Taquera? ¿Y Bistec, Cabeza, Carnitas o Chorizo?" };
  if (/dos de lengua/i.test(t)) return { actions: [q("Lengua / Beef Tongue (+$0.50)", 2)], reply: "2 × Quesadilla: harina, lengua, salsa asada. $9.50. ¿Algo más?" };
  if (/torta de,? ?(?:de )?chorizo/i.test(t)) return { actions: [], reply: "Es bolillo con chorizo, queso, crema, lechuga, pico de gallo y aguacate. ¿La quieres?" };
  if (/horchata|frijoles/i.test(t)) return { actions: [H], reply: "Agua Fresca Horchata 32oz. $5.50. ¿Algo más?" };
  return { actions: [], reply: "Muy bien." }; };
r.menu = () => M; return r; };
const meat = (l: any) => JSON.stringify(l.modifiers);

test("cris2: 2 tripa + 2 lengua QHR, torta chorizo, side frijoles, horchata", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart; const f = (re: RegExp, id: RegExp) => c.filter((l: any) => id.test(l.itemId) && re.test(meat(l)));
  assert.equal(f(/Tripa/, /^sq-quesadilla-/)[0]?.quantity, 2, JSON.stringify(c));
  assert.equal(f(/Lengua/, /^sq-quesadilla-/)[0]?.quantity, 2);
  const t = f(/Chorizo/, /^sq-torta-/); assert.equal(t.length, 1); assert.equal(t[0].quantity, 1); assert.match(meat(t[0]), /\(TO\) Torta/);
  assert.equal(f(/Frijoles/, /^sq-sides-/).length, 1);
  assert.equal(c.filter((l: any) => /horchata/.test(l.itemId)).length, 1);
  assert.equal(c.length, 5);
});
test("cris2 helpers: guards", () => {
  const T = (s: string, x: string) => ({ speaker: s, text: x });
  const one = () => [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe (+$0.50)" }] }];
  let c: any[] = one(); applyStaffMeatCountEcho(c, [T("caller", "de tripa"), T("staff", "Dos de tripa"), T("caller", "No, nomás una")]); assert.equal(c[0].quantity, 1);
  c = one(); applyStaffMeatCountEcho(c, [T("caller", "de lengua"), T("staff", "Dos de tripa")]); assert.equal(c[0].quantity, 1);
  c = one(); applyStaffMeatCountEcho(c, [T("caller", "de harina de tripas"), T("staff", "Dos de harina, de tripas")]); assert.equal(c[0].quantity, 2);
  c = []; addSaidTorta(c, [T("caller", "una torta de chorizo"), T("staff", "No tenemos chorizo hoy")], M); assert.equal(c.length, 0);
  c = []; addSaidTorta(c, [T("caller", "dos tortas de pollo"), T("staff", "Okey")], M); assert.equal(c[0]?.quantity, 2);
  c = [{ itemId: "sq-torta-4GNTTE", quantity: 1, modifiers: [{ step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" }] }];
  addSideFrijoles(c, [T("caller", "con frijoles al lado")], M); assert.equal(c.length, 1);
  c = []; addSideFrijoles(c, [T("caller", "unos frijoles")], M); assert.equal(c.length, 0);
});
