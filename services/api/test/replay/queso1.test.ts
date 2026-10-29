// queso1 (Carlos): a quesadilla already comes with melted cheese inside → "con queso" / "queso adentro" adds no cheese
// modifier. A taco "con queso" (incl. "queso adentro") is always **Con Queso Fresco on top, never EXTRA Queso Derretido.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withConAddons } from "../../src/standard-toppings.ts";

const CON = { name: "(C) Con / With", options: [
  { name: "**Con Queso Fresco / With Cheese (+$0.50)", priceDeltaCents: 50 }, { name: "**EXTRA Queso Derretido / Melted Cheese (+$0.50)", priceDeltaCents: 50 }] };
const MEATS = { name: "(B) Q Carnes / Meats", options: [{ name: "Bistec / Steak" }, { name: "Deshebrada / Shredded Beef with Potatoes" }] };
const menu = [
  { id: "q", name: "Quesadilla", modifierGroups: [MEATS, CON] },
  { id: "qd", name: "(QD) Quesadilla Dorada (QD) REGULAR Dorada", modifierGroups: [MEATS, CON] },
  { id: "sq-taco-TAR7L5", name: "Taco", modifierGroups: [MEATS, CON] }];
const add = (itemId: string, opts: string[]) => [{ type: "add_item", itemId, quantity: 1, modifiers: opts.map((option) => ({ step: "x", option })) }];
const opts = (r: any) => r[0].modifiers.map((m: any) => m.option);
const MELT = "**EXTRA Queso Derretido / Melted Cheese (+$0.50)", FRESCO = "**Con Queso Fresco / With Cheese (+$0.50)";

test("queso1: quesadilla con queso / queso adentro → no extra cheese modifier", () => {
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak"]), menu, "una quesadilla de bistec con queso")), ["Bistec / Steak"]);
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak", MELT]), menu, "quesadilla de bistec con queso adentro")), ["Bistec / Steak"]);
  assert.deepEqual(opts(withConAddons(add("qd", ["Bistec / Steak", FRESCO]), menu, "una dorada de bistec con queso")), ["Bistec / Steak"]);
  // explicit asks still honored
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak"]), menu, "quesadilla de bistec, extra queso derretido")), ["Bistec / Steak", MELT]);
});

test("queso1: taco con queso / queso adentro → Con Queso Fresco, never melted", () => {
  const D = "Deshebrada / Shredded Beef with Potatoes";
  assert.deepEqual(opts(withConAddons(add("sq-taco-TAR7L5", [D]), menu, "un taco de deshebrada con queso")), [D, FRESCO]);
  assert.deepEqual(opts(withConAddons(add("sq-taco-TAR7L5", [D, MELT]), menu, "una de esas con queso adentro")), [D, FRESCO]);
  assert.deepEqual(opts(withConAddons(add("sq-taco-TAR7L5", [D]), menu, "un taco de deshebrada")), [D]);
});

test("queso1: quesadilla con extra queso / más queso → paid EXTRA Queso Derretido", () => {
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak"]), menu, "una quesadilla de bistec con extra queso")), ["Bistec / Steak", MELT]);
  assert.deepEqual(opts(withConAddons(add("q", ["Bistec / Steak"]), menu, "quesadilla de bistec con más queso")), ["Bistec / Steak", MELT]);
  assert.deepEqual(opts(withConAddons(add("qd", ["Bistec / Steak"]), menu, "dorada de bistec, extra de queso")), ["Bistec / Steak", MELT]);
});
