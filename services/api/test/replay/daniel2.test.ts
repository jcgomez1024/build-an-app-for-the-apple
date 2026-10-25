// daniel2 (CA7c6217 ~12:54 ET Oct 25): "dos menudos… uno con pata y el otro sin pata"
// + "dos tacos de bistec… nada de verduras, así solitos".
// Correct: 1 CON + 1 SIN + 2 TCO bistec note no verdura; never 2×CON, never Tacos Dorados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T12:54:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromTranscript } = await import("../../src/order-name.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
const DOR = "sq-tacos-dorados-tacos-dorados-OHFWF3";
const TACO = "sq-taco-TAR7L5";

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA7c6217-turns.json", import.meta.url), "utf8"));

const stubLiveMiss = async (text: string) => {
  if (/menudo/i.test(text) && !/taco/i.test(text))
    return {
      actions: [{
        type: "add_item", itemId: CON, quantity: 2,
        modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }],
        readback: "2 menudo con pata",
      }],
      reply: "2 Con Pata",
    };
  if (/taco|bistec|verdura|solit/i.test(text))
    return {
      actions: [
        { type: "add_item", itemId: DOR, quantity: 2, modifiers: [{ step: "(A)", option: "Bistec / Steak" }], readback: "2 dorados" },
        {
          type: "add_item", itemId: TACO, quantity: 2,
          modifiers: [
            { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" },
            { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" },
          ],
          readback: "2 tco bistec",
        },
      ],
      reply: "tacos",
    };
  return { actions: [] as any[], reply: "?" };
};

test("daniel2: name Daniel", async () => {
  assert.equal(nameFromTranscript(turns as any), "Daniel");
});

test("daniel2: 1 CON + 1 SIN + 2 TCO bistec no verdura; no Dorados; no 2×CON", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const sin = r.cart.filter((l: any) => l.itemId === SIN);
  const con = r.cart.filter((l: any) => l.itemId === CON);
  const sinQty = sin.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  const conQty = con.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  assert.equal(sinQty, 1, `SIN qty: ${JSON.stringify(r.cart)}`);
  assert.equal(conQty, 1, `CON qty: ${JSON.stringify(r.cart)}`);
  assert.ok(!r.cart.some((l: any) => /tacos-dorados/i.test(String(l.itemId))), "no Tacos Dorados phantom");
  const tacos = r.cart.filter((l: any) => /taco/i.test(String(l.itemId)) && !/dorados/i.test(String(l.itemId)));
  const tacoQty = tacos.reduce((a: number, l: any) => a + (Number(l.quantity) || 1), 0);
  assert.equal(tacoQty, 2, `taco qty: ${JSON.stringify(tacos)}`);
  assert.ok(tacos.every((l: any) => (l.modifiers || []).some((m: any) => /TCO|Comal|Homemade/i.test(String(m.option)))), "TCO");
  assert.ok(tacos.every((l: any) => (l.modifiers || []).some((m: any) => /bistec|steak/i.test(String(m.option)))), "bistec");
  assert.ok(tacos.some((l: any) => (l.elviNotes || []).some((n: string) => /no verdura|sin verdura/i.test(n))),
    `need no verdura note: ${JSON.stringify(tacos)}`);
});
