// anthony1: fried corn doradas → 3 QD Deluxe steak + 1 QD Regular steak cheese; sides rice+beans; no phantoms
import { test } from "node:test";
import assert from "node:assert/strict";
const { shadowOrderFromTurns, prepMergedCallerTurns, DORADA_DELUXE_ID, DORADA_REG_ID } = await import("../../src/call-scoring.ts");

test("anthony1: fried ones with corn rewrites to quesadillas doradas", () => {
  const merged = [
    { speaker: "caller", text: "can I get four of the five quesadillas?" },
    { speaker: "staff", text: "homemade or refried?" },
    { speaker: "caller", text: "the fried ones with corn, the corn tortilla ones?" },
  ];
  prepMergedCallerTurns(merged as any);
  assert.match(merged[0].text, /four quesadillas/i);
  assert.match(merged[2].text, /quesadillas doradas/i);
  assert.doesNotMatch(merged[2].text, /fried ones|corn tortilla ones/i);
});

test("anthony1: 3 deluxe + 1 regular + sides; drop rellenos/burrito invent", async () => {
  const DEL = DORADA_DELUXE_ID;
  const REG = DORADA_REG_ID;
  const TCO = "sq-taco-comal-homemade-corn-tortilla-taco-comal-U6KZVH";
  const REL = "sq-chiles-rellenos-platillo-stuffed-poblano-pepper-EUM4MG";
  const BUR = "sq-burrito-TGWBEN";
  const RICE = "sq-sides-arroz-rice-26S6E6";
  const BEANS = "sq-sides-frijoles-beans-FK2O6W";
  const run = async (text: string) => {
    // model mistakes: TCO on fried, invent rellenos/burrito on sides
    if (/doradas|fried|quesadillas/i.test(text) && !/side/i.test(text))
      return { actions: [{ type: "add_item", itemId: TCO, quantity: 1, modifiers: [{ option: "Bistec / Steak" }, { option: "DELUXE" }] }], reply: "?" };
    if (/side of rice|sides rice/i.test(text))
      return { actions: [{ type: "add_item", itemId: REL, quantity: 1, modifiers: [] }], reply: "?" };
    if (/side of|beans|frijoles/i.test(text))
      return { actions: [{ type: "add_item", itemId: BUR, quantity: 1, modifiers: [{ option: "Bistec / Steak" }, { option: "Grande '12 (+$3.00)" }] }], reply: "?" };
    return { actions: [], reply: "?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "can I get four of the five quesadillas?", language: "en" },
    { speaker: "staff", start: 1, end: 2, text: "four quesadillas, you want the homemade or refried?", language: "en" },
    { speaker: "caller", start: 2, end: 3, text: "the fried ones with corn, the corn tortilla ones?", language: "en" },
    { speaker: "staff", start: 3, end: 4, text: "Okay, the fried, what kind of meat do you want?", language: "en" },
    { speaker: "caller", start: 4, end: 5, text: "Yeah. can I do steak for all of them?", language: "en" },
    { speaker: "staff", start: 5, end: 6, text: "Four, four of them. You want deluxe?", language: "en" },
    { speaker: "caller", start: 6, end: 7, text: "Yeah. can I get three of those deluxe?", language: "en" },
    { speaker: "caller", start: 7, end: 8, text: "And then one just,", language: "en" },
    { speaker: "caller", start: 8, end: 9, text: "no, one with just steak and cheese only.", language: "en" },
    { speaker: "staff", start: 9, end: 10, text: "Okay, so you want three deluxe and just one with steak and cheese.", language: "en" },
    { speaker: "caller", start: 10, end: 11, text: "Yeah.", language: "en" },
    { speaker: "caller", start: 11, end: 12, text: "Yeah, can I get a side of rice", language: "en" },
    { speaker: "caller", start: 12, end: 13, text: "and then a side of refried beans?", language: "en" },
    { speaker: "staff", start: 13, end: 14, text: "Okay, can I get your name?", language: "en" },
    { speaker: "caller", start: 14, end: 15, text: "Anthony.", language: "en" },
  ] as any, run as any);
  const deluxe = r.cart.filter((l: any) => l.itemId === DEL);
  const regular = r.cart.filter((l: any) => l.itemId === REG);
  const dQty = deluxe.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const rQty = regular.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(dQty, 3, "3 deluxe: " + JSON.stringify(r.cart));
  assert.equal(rQty, 1, "1 regular: " + JSON.stringify(r.cart));
  assert.equal(r.cart.filter((l: any) => l.itemId === RICE).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, "1 side rice: " + JSON.stringify(r.cart));
  assert.equal(r.cart.filter((l: any) => l.itemId === BEANS).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, "1 side beans: " + JSON.stringify(r.cart));
  assert.ok(!r.cart.some((l: any) => /taco|relleno|poblano|burrito/i.test(String(l.itemId))), "no phantoms: " + JSON.stringify(r.cart));
});
