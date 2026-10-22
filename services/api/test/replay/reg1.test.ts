import test from "node:test"; import assert from "node:assert/strict";
import { groundTruth } from "../../src/learning.ts";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
const L = (name: string, cents: number) => ({ name, baseName: name, quantity: 1, choices: [], unitCents: cents, totalCents: cents } as any);
test("reg1: nameless custom amounts pair with the dishes heard 'said, not rung', even when Elvi also rang a stray dish", () => {
  const ticket = [L("", 1600), L("Agua Fresca", 550), L("", 1900)];
  const elvi = [L("Chilaquiles", 1200), L("Chilaquiles", 1500), L("Huarache", 1500), L("Agua Fresca", 550)];
  const flags: any[] = [{ type: "CUSTOM_AMOUNT", detail: "custom amount $16.00" }, { type: "CUSTOM_AMOUNT", detail: "custom amount $19.00" }, { type: "STAFF_MISSING", detail: "said on call, not rung: 1 × Chilaquiles" }];
  const t = groundTruth(ticket, elvi, flags).lines.map((l: any) => l.name).sort();
  assert.deepEqual(t, ["Agua Fresca", "Chilaquiles", "Chilaquiles"]);
});
test("reg1: 'a uno agrégamele bistec' adds to a rung dish, it doesn't ring a dish never named", async () => {
  const turns: any[] = [{ speaker: "caller", text: "Unos chilaquiles, por favor.", language: "es" }, { speaker: "staff", text: "Sí." }, { speaker: "caller", text: "A uno agrégamele bistec.", language: "es" }];
  const run = async (t: string) => /chilaquiles/i.test(t) ? { reply: "Listo. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-chilaquiles-con-huevo-C1", quantity: 1, modifiers: [] }] }
    : { reply: "Listo. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-huarache-elvis-H1", quantity: 1, modifiers: [{ step: "M", option: "Bistec" }] }] };
  const r: any = await shadowOrderFromTurns(turns, run as any);
  assert.deepEqual(r.cart.map((l: any) => l.itemId), ["sq-chilaquiles-con-huevo-C1"]);
});
