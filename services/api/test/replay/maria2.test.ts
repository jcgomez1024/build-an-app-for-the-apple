// maria2 (CA329b3324, Oct 30 5:37 PM ET, María, Spanish pickup, staff-answered, 76 s):
// "cuatro gorditas de comal de costilla" + "una orden de chile rellenos" (staff: arroz y frijol; vienen de queso solamente).
// Elvi asked the Stuffed Poblano side/tortilla questions but never rang it. Asked dish ⇒ in the cart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyAskedDishes, pickFromSpeech } from "../../src/asked-dishes.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA329b3324-turns.json", import.meta.url), "utf8"));
const menu = JSON.parse(readFileSync(new URL("../fixtures/CA329b3324-menu.json", import.meta.url), "utf8"));
const CR = "sq-chiles-rellenos-platillo-stuffed-poblano-pepper-EUM4MG";
const Q = "Stuffed Poblano Pepper: Arroz-Rice and Frijoles-Beans, SOLO Arroz or SOLO Frijoles? And 3 x (Corn) Corn Tortilla or 3 x (Flour) Harina Tortilla?";
let asked = false;
const run = Object.assign(async (t: string) => {
  if (/gorditas/i.test(t)) return { reply: "Gordita: costilla. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-gordita-M647RE", quantity: 4, modifiers: [{ step: "(A) Gordita Options", option: "(GD) Gordita" }, { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" }] }] };
  if (/relleno/i.test(t)) asked = true;
  return asked ? { reply: Q, actions: [] } : { reply: "Adelante.", actions: [] };
}, { menu: () => menu });

test("maria2: 4 gorditas costilla + 1 Stuffed Poblano (queso, arroz y frijol, corn)", async () => {
  asked = false;
  const r: any = await shadowOrderFromTurns(structuredClone(turns), run as any);
  const g = r.cart.filter((l: any) => l.itemId === "sq-gordita-M647RE");
  assert.equal(g.length, 1); assert.equal(g[0].quantity, 4);
  const c = r.cart.filter((l: any) => l.itemId === CR);
  assert.equal(c.length, 1); assert.equal(c[0].quantity, 1);
  const opt = (s: RegExp) => c[0].modifiers.find((m: any) => s.test(m.step))?.option;
  assert.equal(opt(/Tipo/), "QUESO / CHEESE");
  assert.equal(opt(/Lado/), "Arroz-Rice and Frijoles-Beans");
  assert.equal(opt(/Tortilla Options/), "3 x (Corn) Corn Tortilla");
  assert.ok(!c[0].elviNotes);
  assert.equal(r.cart.length, 2);
});
test("maria2: no menu getter → pass is a no-op (old behaviour)", async () => {
  asked = false;
  const bare = async (t: string, l: any, h: any) => run(t);
  const r: any = await shadowOrderFromTurns(structuredClone(turns), bare as any);
  assert.ok(!r.cart.some((l: any) => l.itemId === CR));
});
test("maria2: asked dish nobody named, or cancelled, is not added; already-rung dish not doubled", () => {
  const cart: any[] = [];
  applyAskedDishes(cart, [{ source: "caller", heard: "una orden de tacos", reply: Q }], [{ speaker: "caller", text: "una orden de tacos" }], menu);
  assert.equal(cart.length, 0);
  applyAskedDishes(cart, [{ source: "caller", heard: "un chile relleno", reply: Q }, { source: "caller", heard: "mejor quítale el chile relleno" }], [{ speaker: "caller", text: "un chile relleno" }], menu);
  assert.equal(cart.length, 0);
  const rung: any[] = [{ itemId: CR, quantity: 1, modifiers: [] }];
  applyAskedDishes(rung, [{ source: "caller", heard: "un chile relleno", reply: Q }], [{ speaker: "caller", text: "un chile relleno" }], menu);
  assert.equal(rung.length, 1);
});
test("maria2: Spanish question, 'dos chiles rellenos', 'solo arroz', 'de harina'", () => {
  const cart: any[] = [];
  applyAskedDishes(cart, [{ source: "caller", heard: "dos chiles rellenos", reply: "Chiles Rellenos Platillo: ¿Arroz y frijoles, solo arroz o solo frijoles?" }, { source: "caller", heard: "solo arroz, de harina" }],
    [{ speaker: "caller", text: "dos chiles rellenos" }], menu);
  assert.equal(cart.length, 1); assert.equal(cart[0].quantity, 2);
  const lado = menu.find((i: any) => i.id === CR).modifierGroups.find((g: any) => /Lado/.test(g.name));
  assert.equal(pickFromSpeech(lado, "solo arroz")?.option, "SOLO Arroz / ONLY Rice");
  assert.equal(pickFromSpeech(lado, "solo frijoles por favor")?.option, "SOLO Frijoles / ONLY Beans");
  assert.equal(cart[0].modifiers.find((m: any) => /Tortilla Options/.test(m.step)).option, "3 x (Flour) Harina Tortilla");
});
