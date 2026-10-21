// case1c: synthetic. Two bare dishes, then meat fragments; "las dos" covers what is still waiting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meatFragment, isBareDish, shadowOrderFromTurns } from "../../src/call-scoring.ts";
test("case1c: fragment parsing", () => {
  assert.equal(meatFragment("de bistec, me le pone queso"), "de bistec, con queso");
  assert.equal(meatFragment("El de bistec con frijoles las dos. ¿Se oye?"), "de bistec con frijoles");
  assert.equal(meatFragment("una gordita de bistec"), null);
  assert.ok(isBareDish("Me pone gordita")); assert.ok(!isBareDish("una gordita de bistec"));
});
test("case1c: 'gordita y una quesadilla' → staff asks the gordita → each fragment lands on its dish", async () => {
  const said: string[] = [];
  const run = async (t: string) => { said.push(t);
    if (/^(me pone )?gordita$|^una quesadilla$/i.test(t.trim())) return { reply: "¿De qué carne?", actions: [] };
    const m = t.match(/^una (gordita|quesadilla) (de .+)$/i);
    if (m) return { reply: "Listo. ¿Algo más?", actions: [{ type: "add_item", itemId: `sq-${m[1]}-T`, quantity: 1, modifiers: [{ step: "", option: m[2] }] }] };
    return { reply: "¿Algo más?", actions: [] }; };
  const turns: any[] = [{ speaker: "staff", text: "Cocina Elvis." }, { speaker: "caller", text: "Me pone gordita y una quesadilla" },
    { speaker: "staff", text: "¿La gordita de qué?" }, { speaker: "caller", text: "de bistec, me le pone queso" },
    { speaker: "staff", text: "¿Y la quesadilla de qué?" }, { speaker: "caller", text: "El de bistec con frijoles las dos" }];
  const r: any = await shadowOrderFromTurns(turns, run as any);
  assert.deepEqual(r.cart.map((l: any) => [l.itemId, l.modifiers[0].option]), [["sq-gordita-T", "de bistec, con queso"], ["sq-quesadilla-T", "de bistec con frijoles"]]);
});
