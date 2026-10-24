// hours1 (8:03 PM 10/23 call): after the Quesadilla Dorada's website window (ends 7:59 PM) Elvi refuses it once and
// never asks "¿Regular o deluxe?" for it; the window itself is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-23T20:03:00-04:00";
const { finalizeTurn } = await import("../../src/elvi.ts");

const menu: any[] = [{ id: "qd", name: "(QD) Quesadilla Dorada", squareCatalogObjectId: "DANMDMZDAJYSE6ERXUY5EKGZ", priceCents: 1000, category: "Especial",
  variations: [{ id: "r", name: "(QD) REGULAR Dorada", priceCents: 1000 }, { id: "d", name: "(QD) DELUXE Preparada", priceCents: 1300 }], modifierGroups: [] }];
test("hours1: out-of-window dorada is refused, not a Regular/Deluxe question", () => {
  const r: any = finalizeTurn({ language: "es", reply: "Agregado.", actions: [{ type: "add_item", itemId: "qd", quantity: 1, modifiers: [] }] } as any,
    "quiero una quesadilla dorada preparada de bistec con cabeza", menu as any, "es");
  assert.doesNotMatch(r.reply, /regular o deluxe/i);
  assert.match(r.reply, /7:59/);
  assert.equal(r.actions.filter((a: any) => a.type === "add_item").length, 0);
});
