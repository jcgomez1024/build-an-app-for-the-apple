// alex1e: staff "Nombre." → bare ASR name must not invent food
import { test } from "node:test";
import assert from "node:assert/strict";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

test("alex1e: bare name after staff Nombre. does not invent food", async () => {
  const DEL = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
  const REG = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
  const run = async (text: string) => {
    if (/Wally|Alex/i.test(text) && !/quesadilla|aceite|bistec|comal|picadillo/i.test(text)) {
      return { actions: [{ type: "add_item", itemId: REG, quantity: 1, modifiers: [{ option: "Picadillo / Ground Beef with Potatoes" }] }], reply: "?" };
    }
    if (/aceite|deluxe|bistec/i.test(text)) {
      return { actions: [{ type: "add_item", itemId: DEL, quantity: 2, modifiers: [{ option: "(QD) DELUXE Preparada" }, { option: "Bistec / Steak" }] }], reply: "¿Algo más?" };
    }
    return { actions: [], reply: "?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "Me pone dos QD DELUXE Dorada de bistec preparadas", language: "es" },
    { speaker: "staff", start: 2, end: 3, text: "Nombre.", language: "es" },
    { speaker: "caller", start: 3, end: 4, text: "Wally.", language: "es" },
    { speaker: "staff", start: 4, end: 5, text: "¿Cómo?", language: "es" },
    { speaker: "caller", start: 5, end: 6, text: "Alex.", language: "es" },
  ] as any, run as any);
  assert.ok(!r.cart.some((l: any) => /regular.?dorada|T5STUH/i.test(String(l.itemId))), "no invent: " + JSON.stringify(r.cart));
  assert.ok(r.cart.some((l: any) => /deluxe|ZZAV3L/i.test(String(l.itemId))), "kept deluxe: " + JSON.stringify(r.cart));
});
