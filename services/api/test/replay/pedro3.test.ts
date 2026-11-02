import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { isPutOnModifier, dropPutOnReAdd, RESUME_AFTER_BYE } from "../../src/modifier-turns.js";

// pedro3 (CA0afcaf19): 2 GD picadillo, 1 QD regular bistec sin verdura, 1 GD papas con rajas + huevo con chile (Square tF932p $20.75).
const d = JSON.parse(readFileSync(new URL("../fixtures/CA0afcaf-pedro3.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const G = "sq-gordita-M647RE", QD = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
const PIC = "Picadillo / Ground Beef with Potatoes", NOP = "Nopales con Papas / Cacti with Potatoes", RAJ = "Papas Con Rajas / Poblano with Potatoes";
const gm = (...m: string[]) => [{ step: "(A) Gordita Options", option: "(GD) Gordita" }, ...m.map((o) => ({ step: "(B) Q Carnes / Meats", option: o })), { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" }];
// stub replays the live model's adds, including its two wrong ones
const stub = () => { const r: any = async (t: string) => { const p = t.toLowerCase(); const a: any[] = [];
  if (/gorditas de picadillo/.test(p) && !/poner/.test(p)) a.push({ type: "add_item", itemId: G, quantity: 2, modifiers: gm(PIC) });
  if (/dorada de bistec/.test(p)) a.push({ type: "add_item", itemId: QD, quantity: 1, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" }] });
  if (/gordita de papas/.test(p)) a.push({ type: "add_item", itemId: G, quantity: 1, modifiers: gm(NOP, RAJ) });
  if (/poner en no pares/.test(p)) a.push({ type: "add_item", itemId: G, quantity: 1, modifiers: gm(PIC) });
  return { actions: a, reply: "ok. ¿Algo más?" }; }; r.menu = () => M; return r; };

test("pedro3: after-call cart matches Square tF932p", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const lines = r.cart.map((l: any) => `${l.quantity} ${l.itemId} ${l.modifiers.filter((m: any) => /Carnes/.test(m.step)).map((m: any) => m.option.split(" /")[0]).join("+")}`);
  assert.deepEqual(lines, [`2 ${G} Picadillo`, `1 ${QD} Bistec`, `1 ${G} Papas Con Rajas+Huevo con Chile`]);
  const j = JSON.stringify(r.cart);
  assert.doesNotMatch(j, /Nopales/); assert.doesNotMatch(j, /sq-quesadilla-HLT6CR/);
  assert.doesNotMatch(JSON.stringify(r.cart.filter((l: any) => l.itemId === G)), /Bistec/);
});
test("pedro3: 'poner en/ponerle' modifies, never adds", () => {
  for (const s of ["las gorditas de picadillos, si la pueden poner en nopales también", "¿Le puedes poner cebolla?", "pónganles queso", "ponerle crema"]) assert.equal(isPutOnModifier(s), true, s);
  for (const s of ["¿Me puede poner dos tacos de pollo?", "me pone una gordita de bistec", "dame dos gorditas"]) assert.equal(isPutOnModifier(s), false, s);
  const acts = [{ type: "add_item", itemId: G, quantity: 1 }];
  assert.equal(dropPutOnReAdd(acts, [{ itemId: G, quantity: 2 }], "si la pueden poner en nopales también"), true);
  assert.deepEqual(acts, []);
});
test("pedro3: caller adds after staff's final goodbye are ignored; 'No, espérate' reopens", async () => {
  assert.match("eh. No, espérate.", RESUME_AFTER_BYE); assert.doesNotMatch("Okay, gracias.", RESUME_AFTER_BYE);
  const turns = [{ speaker: "caller", text: "Dame dos gorditas de picadillo." }, { speaker: "staff", text: "Okay, bye." }, { speaker: "caller", text: "Y una gordita de papas." }];
  const r: any = await shadowOrderFromTurns(turns as any, stub());
  assert.doesNotMatch(JSON.stringify(r.cart), /Rajas|Nopales/);
});
