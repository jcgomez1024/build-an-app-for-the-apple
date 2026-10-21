// case1: synthetic shadow — "…la otra" after a gordita line updates it instead of adding two more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
test("case1: 'con frijoles y queso la otra' updates the last gordita", async () => {
  const add = (mods: string[], q = 1) => ({ reply: "Gordita. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-gordita-T", quantity: q, modifiers: mods.map((o) => ({ step: "", option: o })) }] });
  const script: Record<string, any> = { "Me pone una gordita de bistec": add(["Bistec / Steak"]), "Con frijoles y queso la otra": add(["(QGD) Queso Gordita (+$0.50)", "**Con Frijoles / With Beans (+$0.50)"], 2) };
  const turns: any[] = [{ speaker: "staff", text: "Cocina Elvis." }, { speaker: "caller", text: "Me pone una gordita de bistec" }, { speaker: "staff", text: "Ok." }, { speaker: "caller", text: "Con frijoles y queso la otra" }];
  const r: any = await shadowOrderFromTurns(turns, async (t: string) => script[t] || { reply: "", actions: [] });
  const g = r.cart.filter((l: any) => l.itemId === "sq-gordita-T");
  assert.equal(g.reduce((n: number, l: any) => n + l.quantity, 0), 1);
});
