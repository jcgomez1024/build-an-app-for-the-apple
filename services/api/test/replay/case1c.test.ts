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
test("case1d: 'sí' to staff's '¿La gordita también … frijoles?' adds beans to that gordita", async () => {
  const run = async (t: string) => /bistec/.test(t) && !/otra/.test(t) ? { reply: "Ok. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-gordita-T", quantity: 1, modifiers: [{ step: "", option: "Bistec / Steak" }] }] }
    : /otra/.test(t) ? { reply: "Ok. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-gordita-T", quantity: 1, modifiers: [{ step: "", option: "**Con Frijoles / With Beans (+$0.50)" }] }] } : { reply: "¿Algo más?", actions: [] };
  const turns: any[] = [{ speaker: "caller", text: "una gordita de bistec" }, { speaker: "staff", text: "¿La gordita también quieres que lleve frijoles?" }, { speaker: "caller", text: "Sí." }, { speaker: "staff", text: "Ok." }, { speaker: "caller", text: "y otra gordita con frijoles" }];
  const r: any = await shadowOrderFromTurns(turns, run as any);
  assert.deepEqual(r.cart[0].modifiers.map((m: any) => m.option), ["Bistec / Steak", "**Con Frijoles / With Beans (+$0.50)"]);
});
