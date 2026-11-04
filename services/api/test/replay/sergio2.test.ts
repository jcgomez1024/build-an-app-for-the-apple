import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { foldPhantomComalMeat, foldBareMeatAdd } from "../../src/modifier-turns.js";

// sergio2 (CA89117579): "cuatro quesadillas en aceite… Sí, de chicharrón prensado… ¿Las cuatro? Sí… preparadas deluxe" → 4 × QD DELUXE prensado.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA891175-sergio2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const QCO = "sq-quesadilla-HLT6CR", QD = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const PREN = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork (+$0.50)" };
const qco = (q: number) => ({ type: "add_item", itemId: QCO, quantity: q, modifiers: [PREN, { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }] });
const stub = () => { const r: any = async (t: string) => {
  if (/^Quesadilla Comal$/i.test(t.trim())) return { actions: [qco(4)], reply: "4 × Quesadilla: comal, prensado." };
  if (/aceite|prensado/i.test(t)) return { actions: [], reply: "Quesadilla: ¿Quesadilla Comal, Quesadilla Harina o Quesadilla Taquera?" };
  return { actions: [], reply: "Muy bien." }; }; r.menu = () => M; return r; };

test("sergio2: bare 'de prensado' lands on the 4 QD DELUXE, no phantom QCO", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  assert.equal(r.cart.filter((l: any) => l.itemId === QCO).length, 0, JSON.stringify(r.cart));
  const qd = r.cart.filter((l: any) => /-qd-/.test(l.itemId));
  assert.equal(qd.length, 1, JSON.stringify(r.cart)); assert.equal(qd[0].quantity, 4);
  assert.match(JSON.stringify(qd[0].modifiers), /DELUXE/); assert.match(JSON.stringify(qd[0].modifiers), /Prensado/);
});
test("sergio2: fold unit — skips when caller said comal or named a dish", () => {
  const mk = () => [{ itemId: QD, quantity: 4, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }] }, { itemId: QCO, quantity: 1, modifiers: qco(1).modifiers }];
  const a = mk(); assert.equal(foldPhantomComalMeat(a, ["cuatro quesadillas en aceite", "Sí, de chicharrón prensado."]), true);
  assert.equal(a.length, 1); assert.equal(a[0].quantity, 4); assert.match(JSON.stringify(a[0]), /Prensado/);
  const b = mk(); assert.equal(foldPhantomComalMeat(b, ["cuatro doradas", "y una de comal", "de prensado"]), false); assert.equal(b.length, 2);
  const c = mk(); assert.equal(foldPhantomComalMeat(c, ["cuatro doradas deluxe", "y una quesadilla de prensado"]), false); assert.equal(c.length, 2);
});
test("sergio2: live app path — bare 'de prensado' add becomes an update of the meatless QD line", () => {
  const cart = [{ itemId: QD, quantity: 4, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }] }];
  const acts: any[] = [qco(1)]; assert.equal(foldBareMeatAdd(acts, cart, "Sí, de prensado"), true);
  assert.equal(acts[0].type, "update_item"); assert.equal(acts[0].itemId, QD); assert.equal(acts[0].quantity, 4); assert.match(JSON.stringify(acts[0].modifiers), /Prensado/);
  const acts2: any[] = [qco(1)]; assert.equal(foldBareMeatAdd(acts2, cart, "una quesadilla de comal de prensado"), false);
});
