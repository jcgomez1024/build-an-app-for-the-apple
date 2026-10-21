// tortilla2: split singles — unnamed line gets the website default + one grouped confirm. Synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { preTurn } from "../../src/pre-turn.ts";

const menu: any[] = [{ id: "taco", name: "Taco", priceCents: 300, modifierGroups: [
  { id: "A", name: "(A) T Tortilla Options", defaultOptions: ["(TCO) Taco Comal / Homemade (+$1.00)"], options: [{ id: "tco", name: "(TCO) Taco Comal / Homemade (+$1.00)", priceDeltaCents: 100 }, { id: "thr", name: "(THR) Taco Harina / Flour" }, { id: "tst", name: "(TST) Taco Taquero / Street Taco" }] },
  { id: "B", name: "(B) T Carnes / Meats Opciones", options: [{ id: "bi", name: "Bistec / Steak" }, { id: "ap", name: "Alpastor / Roasted Pork" }] }] }];
const shellOf = (a: any) => a.modifiers.find((m: any) => m.groupId === "A").option;

test("tortilla2: '2 de pastor en harina y 2 de asada' → asada gets Comal + '¿Y los 2 de asada, de comal por igual?'", () => {
  const r = preTurn("tsp1", "quiero 4 tacos, 2 de pastor en harina y 2 de asada", menu, "es");
  assert.deepEqual(r.adds!.map(shellOf), ["(THR) Taco Harina / Flour", "(TCO) Taco Comal / Homemade (+$1.00)"]);
  assert.match(r.reply!, /¿Y los 2 de asada, de comal por igual\?$/);
  const y = preTurn("tsp1", "sí", menu, "es"); assert.deepEqual(y.updates, []); assert.match(y.reply!, /Perfecto, de comal/);
});
test("tortilla2: naming taquero switches only the unnamed line; English wording", () => {
  const r = preTurn("tsp2", "4 tacos, 2 pastor on flour and 2 asada", menu, "en");
  assert.match(r.reply!, /And the 2 asada, on comal as well\?$/);
  const u = preTurn("tsp2", "no, street", menu, "en");
  assert.equal(u.updates!.length, 1); assert.equal(shellOf(u.updates![0]), "(TST) Taco Taquero / Street Taco");
  assert.ok(u.updates![0].match.includes("(TCO) Taco Comal / Homemade (+$1.00)"));
});
test("tortilla2: all lines named → no confirm; an unrelated answer drops the pending confirm", () => {
  const r = preTurn("tsp3", "4 tacos, 2 de pastor en harina y 2 de asada de comal", menu, "es");
  assert.doesNotMatch(r.reply || "", /por igual/);
  preTurn("tsp4", "4 tacos, 2 de pastor en harina y 2 de asada", menu, "es");
  assert.equal(preTurn("tsp4", "y una horchata grande", menu, "es").updates, undefined);
});
