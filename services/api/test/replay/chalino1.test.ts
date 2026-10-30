// chalino1 (CAe85a692542519dbf86de4d11c3304029, Oct 30 6:54 PM ET, Chalino, Spanish delivery, staff-answered, 154 s).
// Correct: 2 tortas de bistec sin queso, 1 taco de comal de carnitas, 2 sodas de lata; staff: $24 con delivery.
// Live/shadow: phantom 2 Chilaquiles ("me llama mucho el heno"), 1 Queso Torta bistec+carnitas, no sodas, name "Seis",
// address "26229 Chalino. St" (phone digits). Address said: "en la Portland… es 2:46" (staff: "Dos cuarenta y seis Curlan").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { noPhantomDish } from "../../src/elvi.ts";
import { nameFromTranscriptInfo, isNumberName } from "../../src/order-name.ts";
import { detectAddress, addressesIn } from "../../src/delivery.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CAe85a692-turns.json", import.meta.url), "utf8"));
const menu = JSON.parse(readFileSync(new URL("../fixtures/CAe85a692-menu.json", import.meta.url), "utf8"));
const T = "sq-torta-4GNTTE", TC = "sq-taco-TAR7L5", CH = "sq-chilaquiles-con-huevo-YWKBQV";
const TO = { step: "(A) Torta Options", option: "(TO) Torta" }, QTO = { step: "(A) Torta Options", option: "(QTO) Queso Torta (+$0.50)" };
const BI = { step: "(B) Torta Carne Options", option: "Bistec / Steak" }, CA = { step: "(B) Torta Carne Options", option: "Carnitas / Pulled Pork (+$0.50)" };
const QD = { step: "(C) Con / With", option: "**EXTRA Queso Derretido / Melted Cheese (+$0.50)" };
const raw = async (t: string) => { 
  if (/heno/i.test(t)) return { reply: "2 Chilaquiles con Huevo. ¿Algo más?", actions: [{ type: "add_item", itemId: CH, quantity: 2, modifiers: [] }] };
  if (/dos tortas de bistec/i.test(t)) return { reply: "Torta de bistec. ¿Con queso o sin queso?", actions: [{ type: "add_item", itemId: T, quantity: 1, modifiers: [TO, BI] }] };
  if (/^sin queso/i.test(t)) return { reply: "Torta con queso. ¿Algo más?", actions: [{ type: "update_item", itemId: T, modifiers: [QTO, BI, QD] }] };
  if (/carnitas? está bien/i.test(t)) return { reply: "Torta de bistec y carnitas. ¿Algo más?", actions: [{ type: "update_item", itemId: T, quantity: 2, modifiers: [QTO, BI, CA, QD] }] };
  if (/^uno .*carnitas/i.test(t)) return { reply: "Taco de comal de carnitas. ¿Algo más?", actions: [{ type: "add_item", itemId: TC, quantity: 1, modifiers: [{ step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" }, { step: "(B) T Carnes / Meats Opciones", option: "Carnitas / Pulled Pork (+$0.50)" }] }] };
  return { reply: "¿Tortilla de comal?", actions: [] };
};
const run = Object.assign(async (t: string) => raw(t), { menu: () => menu });
const opts = (l: any) => l.modifiers.map((m: any) => m.option);

test("chalino1: 2 tortas bistec sin queso, 1 taco comal carnitas, 2 sodas de lata; no phantom chilaquiles; 246 Portland", async () => {
  const r: any = await shadowOrderFromTurns(structuredClone(turns), run as any);
  assert.equal(r.cart.some((l: any) => l.itemId === CH), false);
  const t = r.cart.filter((l: any) => l.itemId === T);
  assert.equal(t.length, 1); assert.equal(t[0].quantity, 2);
  assert.deepEqual(opts(t[0]), ["(TO) Torta", "Bistec / Steak"]);
  const tc = r.cart.filter((l: any) => l.itemId === TC);
  assert.equal(tc.length, 1); assert.equal(tc[0].quantity, 1); assert.ok(opts(tc[0]).some((o: string) => /Comal/.test(o))); assert.ok(opts(tc[0]).some((o: string) => /Carnitas/.test(o)));
  const d = r.cart.filter((l: any) => /^sq-drink-/.test(l.itemId));
  assert.equal(d.length, 1); assert.equal(d[0].quantity, 2); assert.match(d[0].elviNotes.join(), /lata/);
  assert.equal(r.address, "246 Portland");
});

test("chalino1: live guard drops an unsaid dish, keeps named / counted / offered adds", () => {
  const a = { reply: "2 Chilaquiles con Huevo. ¿Algo más?", actions: [{ type: "add_item", itemId: CH, quantity: 2, modifiers: [] }] };
  const go = (transcript: string, last = "¿Me das el número de tu casa?") => noPhantomDish(a, { transcript, language: "es", menu, history: [{ role: "assistant", text: last }] }).actions.length;
  assert.equal(go("Me llama mucho el heno, ya, ya he pedido ahí, a veces llego."), 0);
  assert.equal(go("unos chilaquiles"), 1);
  assert.equal(go("dos"), 1);
  assert.equal(go("sí por favor", "¿Le agrego chilaquiles?"), 1);
});

test("chalino1: number words and phone digits are never a name; the staff read-back wins", () => {
  assert.deepEqual(nameFromTranscriptInfo(turns), { name: "Chalino", thirdPerson: false, source: "staff-ask" });
  for (const n of ["Seis", "Dos", "Noventa Y Así", "262", "Catorce Veintisiete"]) assert.equal(isNumberName(n), true, n);
  for (const n of ["Chalino", "Rosa", "Juan Carlos"]) assert.equal(isNumberName(n), false, n);
});

test("chalino1: phone digits are never parsed as an address; house-number answers are", () => {
  assert.deepEqual(addressesIn("Y dame tu número ahora sí, Chalino. 2 6 2 2 9"), []);
  assert.deepEqual(addressesIn("my phone number is 440 555 1212"), []);
  assert.equal(addressesIn("fairground número 85")[0]?.street, "85 Fairground St");
  assert.equal(addressesIn("es el 872 Bank Street")[0]?.street, "872 Bank St");
  assert.equal(detectAddress(turns).address?.street, "246 Portland");
});
