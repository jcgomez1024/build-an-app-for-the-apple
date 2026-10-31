// aaron1 (CA2217937, Oct 30 7:57 PM ET): 2 flour steak quesadillas deluxe, sour cream on the side, + rice and beans side.
// dayana1 (CAa36f03b, Oct 30 Spanish): name "Discúlpeme"; "¿a qué hora cierra?" answered from data/phone-hours.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyRiceBeansSide, applyCremaOnSide, beansOnlyAsSide, noRiceBeansFilling, noReaskAnswered } from "../../src/list-repair.ts";
import { hoursAnswer, noUnknownHours } from "../../src/store-hours.ts";
import { nameFromTranscriptInfo, isNumberName } from "../../src/order-name.ts";
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const menu = fx("CA4bdd506-menu.json");
const FRI = new Date("2026-10-30T23:59:00Z"); // Fri 7:59 PM ET
test("aaron1: rice and beans = side, Con Frijoles dropped, sour cream on the side noted on the deluxe line", () => {
  const turns = fx("CA2217937-turns.json"), cart = fx("CA2217937-cart.json");
  applyRiceBeansSide(cart, turns, menu); applyCremaOnSide(cart, turns, menu);
  const q = cart.filter((l: any) => /quesadilla/.test(l.itemId));
  assert.equal(q.reduce((a: number, l: any) => a + l.quantity, 0), 2);
  for (const l of q) { assert.ok(!l.modifiers.some((m: any) => /Con Frijoles/.test(m.option))); assert.ok(l.modifiers.some((m: any) => /QHR/.test(m.option)) && l.modifiers.some((m: any) => /Bistec/.test(m.option)) && l.modifiers.some((m: any) => /^DELUXE/.test(m.option)));
    assert.ok((l.elviNotes || []).some((n: string) => /sour cream aparte/.test(n))); }
  const s = cart.filter((l: any) => /^sq-sides-arroz-rice/.test(l.itemId));
  assert.equal(s.length, 1); assert.match(s[0].modifiers[0].option, /Rice and Frijole/);
});
test("aaron1: 'with beans' filling still a filling; crema extra without deluxe", () => {
  assert.equal(beansOnlyAsSide("steak quesadilla with beans, and rice and beans on the side"), false);
  assert.equal(beansOnlyAsSide("lunch special with the rice and beans on the side"), true);
  const cart = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }];
  applyCremaOnSide(cart, [{ speaker: "caller", text: "one steak quesadilla, sour cream on the side" }], menu);
  assert.ok(cart[0].modifiers.some((m: any) => /EXTRA SIDE Crema/.test(m.option)));
});
test("aaron1 live: no Con Frijoles from 'rice and beans'; no 'which combo?' after staff answered; no tortilla re-ask", () => {
  const r = noRiceBeansFilling({ reply: "2 × Quesadilla: flour, with beans, deluxe. Anything else?", actions: [{ type: "add_item", itemId: "sq-quesadilla-HLT6CR", modifiers: [{ option: "**Con Frijoles / With Beans (+$0.50)" }, { option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }] }] }, { transcript: "like a lunch special that come with the rice and beans on the side" });
  assert.equal(r.actions[0].modifiers.length, 1); assert.doesNotMatch(r.reply, /with beans/);
  const hist = [{ role: "assistant", text: "I got the combo rice and beans. You want that one?" }];
  assert.equal(noReaskAnswered({ reply: "Which combo? Tacos, Quesadillas, Burrito, Gorditas, Tortas, or Mix?", actions: [] }, { transcript: "yeah, let me get the combo", history: hist, language: "en" }).reply, "Okay.");
  const cart = fx("CA2217937-cart.json");
  assert.equal(noReaskAnswered({ reply: "Quesadilla: Quesadilla Comal, Quesadilla Harina or Quesadilla Taquera?", actions: [] }, { transcript: "All right", history: [], cart, language: "en" }).reply, "Okay.");
  assert.match(noReaskAnswered({ reply: "Which combo? Tacos or Mix?", actions: [] }, { transcript: "a combo", history: [], language: "en" }).reply, /Which combo/);
});
test("dayana1: Discúlpeme / Con permiso never a name", () => {
  const info = nameFromTranscriptInfo(fx("CAa36f03b-turns.json"));
  assert.ok(!info || !/disc|perd|permiso/i.test(info.name), String(info?.name));
  for (const n of ["Discúlpeme", "Disculpe", "Perdón", "Con permiso", "Perdone"]) assert.ok(isNumberName(n), n);
  assert.equal(isNumberName("Dayana"), false);
});
test("dayana1: hours from data/phone-hours.json", () => {
  assert.equal(hoursAnswer("¿y a qué hora cierra?", "es", FRI), "Hoy cerramos a las diez de la noche.");
  assert.equal(hoursAnswer("what time do you close", "en", FRI), "Today we're open until 10 PM.");
  assert.match(hoursAnswer("a qué hora abren", "es", new Date("2026-11-02T16:00:00Z"))!, /cerrados.*martes.*diez de la mañana/);
  const r = noUnknownHours({ reply: "No sé la hora de cierre, ¿algo más?", actions: [] }, { transcript: "¿y a qué hora cierra?", language: "es" }, FRI);
  assert.equal(r.reply, "Hoy cerramos a las diez de la noche. ¿Algo más?");
  const ok = { reply: "Cerramos a las diez.", actions: [] }; assert.equal(noUnknownHours(ok, { transcript: "a qué hora cierra", language: "es" }, FRI), ok);
});
