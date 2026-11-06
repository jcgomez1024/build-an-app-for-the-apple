// marta-vapor (CA1de52ae, Nov 6 ~3:27 PM ET, Marta, Spanish pickup): "¿Tienes tacos al vapor hoy?"
// then "¿me pones dos órdenes así surtidas?" Staff confirms. Live miss: no add_item ("Listo." / "Dos de qué."),
// empty cart, order_name noOrder. Surtida is the mixed fillings (one of each), not a catalog item.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyVaporOrders, liveVaporOrder, VAPOR_ID, vaporOrderCount, vaporMixed } from "../../src/readback-pass.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CA1de52ae-marta1.json", import.meta.url), "utf8"));
const FILL = ["Papas / Potatoes", "Frijoles / Beans", "Prensado / Pork", "Pollo / Chicken", "Queso / Cheese"];
const miss = async (t: string) => {
  if (/surtid/i.test(t)) return { reply: "Listo.", actions: [] };
  if (/dos órdenes/i.test(t)) return { reply: "Dos de qué.", actions: [] };
  if (/nombre de marta/i.test(t)) return { reply: "Marta.", actions: [{ type: "set_customer", name: "Marta" }] };
  return { reply: "¿Algo más?", actions: [] };
};

test("marta-vapor: surtida after tacos al vapor is two mixed orders, not a new dish", () => {
  assert.equal(vaporOrderCount(d.turns), 2);
  assert.equal(vaporMixed(d.turns), true);
  const c: any[] = [];
  applyVaporOrders(c, d.turns);
  assert.equal(c.length, 1);
  assert.equal(c[0].itemId, VAPOR_ID);
  assert.equal(c[0].quantity, 2);
  assert.deepEqual(c[0].modifiers.map((m: any) => m.option), FILL);
  assert.equal(c[0].elviNotes[0], "vapor: 1 papa, 1 frijol, 1 prensado, 1 pollo, 1 queso");
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Marta");
});

test("marta-vapor: live 'dos órdenes así surtidas' adds the two orders instead of Listo / Dos de qué", () => {
  const r = liveVaporOrder(
    { reply: "Listo.", actions: [] },
    {
      language: "es",
      transcript: "Okay, ¿me pones dos órdenes así surtidas?",
      cart: [],
      history: [
        { role: "customer", text: "¿Tienes tacos al vapor hoy?" },
        { role: "assistant", text: "Sí. Una orden son cinco tacos. Los rellenos son papas, frijol, prensado, pollo y queso." },
      ],
    },
  );
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].itemId, VAPOR_ID);
  assert.equal(r.actions[0].quantity, 2);
  assert.deepEqual(r.actions[0].modifiers.map((m: any) => m.option), FILL);
  assert.match(r.reply, /surtid/);
  const bare = liveVaporOrder(
    { reply: "Dos de qué.", actions: [] },
    { language: "es", transcript: "Sí, dos órdenes.", cart: [], history: d.turns.slice(0, 6).map((t: any) => ({ role: t.speaker === "staff" ? "assistant" : "customer", text: t.text })) },
  );
  assert.equal(bare.actions[0].quantity, 2);
  assert.equal(bare.actions[0].itemId, VAPOR_ID);
});

test("marta-vapor: replay of the live miss is 2 surtida steamed-taco orders, not noOrder", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, miss as any);
  assert.notEqual(r.noOrder, true);
  const v = r.cart.filter((l: any) => l.itemId === VAPOR_ID);
  assert.equal(v.length, 1, JSON.stringify(r.cart));
  assert.equal(v[0].quantity, 2);
  assert.deepEqual(v[0].modifiers.map((m: any) => m.option), FILL);
  assert.equal(v[0].elviNotes[0], "vapor: 1 papa, 1 frijol, 1 prensado, 1 pollo, 1 queso");
  assert.equal(r.cart.some((l: any) => /surtid|mezclad/i.test(String(l.itemId))), false);
});
