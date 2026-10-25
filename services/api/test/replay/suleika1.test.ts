// suleika1 (CAfef486): 2 Mole Tradicional Platillo (Solo Arroz) + 1 Birria 1lb;
// "dos órdenes" after moles avail = qty 2 moles (NOT enchiladas); "con arroz" = mole plating, NOT Sides Arroz $4.50
import { test } from "node:test";
import assert from "node:assert/strict";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");

const MOLE = "sq-mole-tradicional-platillo-4THFAW";
const BIRRIA = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
const SIDE_RICE = "sq-sides-arroz-rice-26S6E6";
const ENCH = /enchilada/i;

test("suleika1: 2 mole Solo Arroz + 1 birria; no Side arroz; no enchiladas", async () => {
  const run = async (text: string) => {
    // model mistakes: qty1 mole, invent enchiladas unavailable path as add, add Side arroz on "con arroz"
    if (/moles?/i.test(text) && /tienen|tienes|hay/i.test(text))
      return { actions: [], reply: "sí hay" };
    if (/dos\s+órdenes|órdenes/i.test(text) && /mole/i.test(text))
      return { actions: [{ type: "add_item", itemId: MOLE, quantity: 1, modifiers: [], readback: "mole" }], reply: "?" };
    if (/con\s+arroz|puro\s+arroz/i.test(text))
      return { actions: [{ type: "add_item", itemId: SIDE_RICE, quantity: 1, modifiers: [], readback: "side rice" }], reply: "?" };
    if (/birria/i.test(text) && /das|dame|una/i.test(text))
      return { actions: [{ type: "add_item", itemId: BIRRIA, quantity: 1, modifiers: [], readback: "birria" }], reply: "?" };
    if (/enchilada/i.test(text))
      return { actions: [{ type: "add_item", itemId: "sq-enchiladas-platillo-FAKE", quantity: 1, modifiers: [], readback: "ench" }], reply: "?" };
    return { actions: [], reply: "?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "Sí, buenos días. Este, ¿tienen moles?", language: "es" },
    { speaker: "staff", start: 1, end: 2, text: "Sí, sí hay, pero ya no tengo pollo de la pieza, solamente tendría pollo del del del que está desmenuzado.", language: "es" },
    { speaker: "caller", start: 2, end: 3, text: "¿Sí hay?", language: "es" },
    { speaker: "caller", start: 3, end: 4, text: "¿O con pollo desmenuzado no tienen de regular?", language: "es" },
    { speaker: "staff", start: 4, end: 5, text: "Se me terminaron en la noche todas las preguntas.", language: "es" },
    { speaker: "caller", start: 5, end: 6, text: "Okay, me,", language: "es" },
    { speaker: "caller", start: 6, end: 7, text: "está bien. Este, ¿me das dos órdenes, por favor?", language: "es" },
    { speaker: "staff", start: 7, end: 8, text: "Okay, con puro arroz, ¿será?", language: "es" },
    { speaker: "caller", start: 8, end: 9, text: "Sí, con arroz.", language: "es" },
    { speaker: "staff", start: 9, end: 10, text: "¿Algo más?", language: "es" },
    { speaker: "caller", start: 10, end: 11, text: "Y me, ¿y también tienes birria o no?", language: "es" },
    { speaker: "staff", start: 11, end: 12, text: "Sí, sí hay.", language: "es" },
    { speaker: "caller", start: 12, end: 13, text: "¿Me das una birria, por favor?", language: "es" },
    { speaker: "staff", start: 13, end: 14, text: "¿Qué más?", language: "es" },
    { speaker: "caller", start: 14, end: 15, text: "Sería todo.", language: "es" },
    { speaker: "staff", start: 15, end: 16, text: "Una birra y dos moles,", language: "es" },
    { speaker: "caller", start: 16, end: 17, text: "Sí.", language: "es" },
    { speaker: "staff", start: 17, end: 18, text: "Zuleika.", language: "es" },
    { speaker: "caller", start: 18, end: 19, text: "Sí.", language: "es" },
  ] as any, run as any);

  const moleQty = r.cart.filter((l: any) => /mole/i.test(String(l.itemId))).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const birriaQty = r.cart.filter((l: any) => /birria/i.test(String(l.itemId))).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const sideRice = r.cart.filter((l: any) => /sides-arroz|26S6E6/i.test(String(l.itemId))).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(moleQty, 2, "2 mole: " + JSON.stringify(r.cart));
  assert.equal(birriaQty, 1, "1 birria: " + JSON.stringify(r.cart));
  assert.equal(sideRice, 0, "no Side arroz: " + JSON.stringify(r.cart));
  assert.ok(!r.cart.some((l: any) => ENCH.test(String(l.itemId)) || ENCH.test(String(l.readback || ""))), "no enchiladas: " + JSON.stringify(r.cart));
  const moleLines = r.cart.filter((l: any) => /mole/i.test(String(l.itemId)));
  assert.ok(moleLines.every((l: any) => (l.modifiers || []).some((m: any) => /Solo Arroz/i.test(String(m.option || "")))),
    "Solo Arroz on mole: " + JSON.stringify(moleLines));
});
