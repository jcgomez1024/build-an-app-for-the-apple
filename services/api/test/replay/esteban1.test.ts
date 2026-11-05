import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { staffRecapText } from "../../src/list-repair.js";

// esteban1 (CAea851d, Nov 4 7:03 PM ET): 2 QD deluxe bistec con todo + 1 TST bistec; after-call rang 4 QD deluxe bistec.
// Staff "Quesadilla dorada, sí, todavía te tengo" (availability) opened a staff recap that also counted the echoed "dos de bistec" twice.
const d = JSON.parse(readFileSync(new URL("../fixtures/CAea851d-esteban1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const stub = () => { const r: any = async (t: string) => {
  if (/dos .*QD REGULAR.*bistec/i.test(t)) return { actions: [{ type: "add_item", itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: 2, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }], reply: "2 × Quesadilla Dorada REGULAR Dorada: bistec, salsa asada. $5.50. ¿Algo más?" };
  if (/QD REGULAR/i.test(t)) return { actions: [], reply: "Sí, sí tenemos. ¿Cuántos le preparo?" };
  if (/taquito de bistec/i.test(t)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }], reply: "Taco: taquero, bistec, salsa asada. $3.00. ¿Algo más?" };
  return { actions: [], reply: "Muy bien." }; };
r.menu = () => M; return r; };

test("esteban1: 2 QD deluxe bistec + 1 TST bistec, no doubled QD line", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const qd = r.cart.filter((l: any) => /^sq-qd-/.test(l.itemId));
  assert.equal(qd.length, 1, JSON.stringify(r.cart)); assert.equal(qd[0].quantity, 2);
  assert.match(qd[0].itemId, /deluxe/); assert.match(JSON.stringify(qd[0].modifiers), /Bistec/);
  const tacos = r.cart.filter((l: any) => /^sq-taco-/.test(l.itemId));
  assert.equal(tacos.length, 1); assert.equal(tacos[0].quantity, 1); assert.match(JSON.stringify(tacos[0].modifiers), /TST.*Bistec|Bistec.*TST/s);
  assert.equal(r.cart.length, 2);
});
test("esteban1: availability 'todavía te tengo' is no recap; a real recap with an echo counts once", () => {
  assert.equal(staffRecapText([{ speaker: "staff", text: "Quesadilla dorada, sí, todavía te tengo." }, { speaker: "staff", text: "Dos de bistec, ¿algo más?" }] as any), null);
  const t = staffRecapText([{ speaker: "staff", text: "Entonces serían dos de bistec preparadas" }, { speaker: "caller", text: "sí" }, { speaker: "staff", text: "Okay, dos de bistec, y un taco de pastor" }] as any)!;
  assert.equal((t.match(/dos/g) || []).length, 1, t);
});
