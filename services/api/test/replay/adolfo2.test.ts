import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns, rewriteCallerText } from "../../src/call-scoring.js";
import { applyComboSidesBoth, dropUnchosenToppings, fixArrozStt } from "../../src/combo-sides.js";

// adolfo2 (CA453699): "dos quesadillas de bistec, comal" + "el combo de roast y frijoles" (STT arroz), staff "combo de arroz con
// frijoles" → COMBO Quesadillas comal 2 × bistec, arroz y frijoles; no DELUXE / salsa nobody chose ("Sí, bye." is not a pick).
const d = JSON.parse(readFileSync(new URL("../fixtures/CA453699-adolfo2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const C = "sq-combo-quesadillas-BATSPB";
const combo = (side: string) => ({ type: "add_item", itemId: C, quantity: 1, modifiers: [
  { step: "(A) Q Tortilla Shell Option COMBO", option: "(QCO) 2 x Comal / Homemade (+$2.00)" },
  { step: "(B) Item #1 Carne/Meat Option COMBO", option: "1 x Bistec / Steak" }, { step: "(CD) Item #2 Carne/Meat Option COMBO", option: "1 x Bistec / Steak" },
  { step: "(D) COMBO Sides", option: side },
  { step: "(E) DELUXE COMBO Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$1.50)" },
  { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" }] });
// worst case: the model asks deluxe → salsa, and the auto-accept adds everything with SOLO Frijoles
const stub = () => { const r: any = async (t: string) => {
  if (/combo/i.test(t)) return { actions: [], reply: "¿Regular, o deluxe con lechuga, pico y crema (+$1.50)?" };
  if (/deluxe|lechuga/i.test(t)) return { actions: [], reply: "¿Salsa asada (mild) como siempre, o tomate, verde (medium) o roja (hot)?" };
  if (/as[ií] est[aá] bien/i.test(t)) return { actions: [combo("SOLO Frijoles Refritos - Refried Beans")], reply: "Combo. ¿Algo más?" };
  return { actions: [], reply: "Muy bien." }; }; r.menu = () => M; return r; };

test("adolfo2: combo quesadillas gets arroz y frijoles, no unchosen deluxe/salsa", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart.filter((l: any) => l.itemId === C);
  assert.equal(c.length, 1, JSON.stringify(r.cart));
  const mods = JSON.stringify(c[0].modifiers);
  assert.match(mods, /Arroz - Rice and Frijoles Refritos/); assert.doesNotMatch(mods, /SOLO/);
  assert.match(mods, /QCO/); assert.equal((mods.match(/Bistec/g) || []).length, 2);
  assert.doesNotMatch(mods, /DELUXE \(|Salsa Asada/);
});
test("adolfo2: STT roast → arroz only next to frijoles/combo", () => {
  assert.equal(fixArrozStt("el combo de roast y frijoles"), "el combo de arroz y frijoles");
  assert.equal(fixArrozStt("combo de ros"), "combo de arroz");
  assert.equal(fixArrozStt("a roast pork burrito"), "a roast pork burrito");
  assert.match(rewriteCallerText("y el combo de roast y frijoles"), /arroz y frijoles/);
});
test("adolfo2: solo frijoles wins; chosen deluxe/salsa stay", () => {
  const a: any[] = [combo("SOLO Frijoles Refritos - Refried Beans")];
  applyComboSidesBoth(a, [{ speaker: "caller", text: "combo de arroz y frijoles" }, { speaker: "caller", text: "no, solo frijoles" }]);
  assert.match(JSON.stringify(a), /SOLO Frijoles/);
  dropUnchosenToppings(a, [{ speaker: "caller", text: "deluxe con salsa verde" }]);
  assert.match(JSON.stringify(a), /DELUXE \(/); assert.match(JSON.stringify(a), /Salsa Asada/);
  dropUnchosenToppings(a, [{ speaker: "caller", text: "dos quesadillas de bistec" }]);
  assert.doesNotMatch(JSON.stringify(a), /DELUXE \(|Salsa Asada/);
});
