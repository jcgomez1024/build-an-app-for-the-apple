// tw4938: synthetic, no PII. Meats stay on their own taco line, listed meats each become a line, the caller's running total
// trims a meat said twice, re-sent lines of another dish don't stick to the dish being talked about, and "preparada(s)" counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, listedMeats, statedTotal, dishesNamed, kindOfItem } from "../../src/call-scoring.ts";
import { said } from "../../src/auditor.ts";
const ST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
const M = (o: string) => ({ step: "(B) T Carnes / Meats Opciones", option: o });
const DLX = { step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" };
const taco = (meat: string, extra: any[] = []) => ({ type: "add_item", itemId: "sq-taco-T1", quantity: 1, modifiers: [ST, M(meat), ...extra] });
const qd = (q = 1) => ({ type: "add_item", itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-Q1", quantity: q, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] });
const B = "Bistec / Steak", P = "Alpastor / Roasted Pork", T = "Tripa / Beef Tripe";

test("tw4938: helpers", () => {
  assert.deepEqual(listedMeats("Uno de bistec, uno de al pastor y tripa").map((x) => x.meat), ["bistec", "pastor", "tripa"]);
  assert.deepEqual(listedMeats("uno de bistec y chorizo").map((x) => x.meat), ["bistec"], "mixed meats on one item are not two lines");
  assert.deepEqual(listedMeats("Sí, otra tripa").map((x) => [x.meat, x.another]), [["tripa", true]]);
  assert.deepEqual(listedMeats("sin cebolla, uno sin tripa"), []);
  assert.deepEqual(statedTotal("Serían tres o cuánto van ahí"), { n: 3, kind: null });
  assert.deepEqual(statedTotal("serían cuatro tacos"), { n: 4, kind: "taco" });
  assert.ok(dishesNamed("una QD dorada").has("quesadilla")); assert.equal(kindOfItem("sq-qd-quesadilla-dorada-x"), "quesadilla"); assert.equal(kindOfItem("sq-taco-x"), "taco");
});

test("tw4938: two street tacos orders, quesadilla preparada — synthetic replay", async () => {
  const turns: any[] = [
    { speaker: "staff", text: "¿Qué va a querer?", language: "es" },
    { speaker: "caller", text: "Tres tacos taqueros: uno de bistec, uno de al pastor, uno de bistec también y tripa. Serían tres.", language: "es" },
    { speaker: "staff", text: "Ajá.", language: "es" },
    { speaker: "caller", text: "Y una quesadilla dorada de bistec preparada.", language: "es" },
    { speaker: "staff", text: "Ajá.", language: "es" },
    { speaker: "caller", text: "Preparada con todo.", language: "es" },
    { speaker: "staff", text: "Ajá.", language: "es" },
    { speaker: "caller", text: "Eh. Y", language: "es" },
    { speaker: "staff", text: "Ajá.", language: "es" },
    { speaker: "caller", text: "Sí, otra tripa. Serían cuatro tacos.", language: "es" },
  ];
  const run = async (text: string, _l: string, history: any[]) => {
    const t = text.toLowerCase(); let actions: any[] = [];
    if (/uno de bistec/.test(t)) actions = [taco(B), taco(P), taco(B)];            // Elvi dropped "y tripa", kept the repeated bistec
    else if (/^un taco taquero de tripa/.test(t)) actions = [taco(T)];
    else if (/quesadilla|\bqd\b/.test(t)) actions = history.length ? [taco(B, [DLX]), taco(P, [DLX]), taco(T, [DLX])] : [qd()]; // re-sent the tacos with Deluxe
    else if (/preparada con todo/.test(t)) actions = [taco(B, [DLX]), taco(P, [DLX])];
    else if (/^eh\. y/.test(t)) actions = [{ type: "update_item", itemId: "sq-taco-T1", modifiers: [ST, M(T), M(B)] }];
    return { reply: "Listo. ¿Algo más?", actions };
  };
  const r: any = await shadowOrderFromTurns(turns, run as any);
  const lines = r.cart.map((l: any) => `${l.quantity}×${kindOfItem(l.itemId)}:${l.modifiers.filter((m: any) => !/Taquero|Salsa|^\(QD\)/.test(m.option)).map((m: any) => m.option.split(" ")[0]).join("+")}`);
  assert.deepEqual(lines.filter((x: string) => x.includes("taco")).sort(), ["1×taco:Alpastor", "1×taco:Bistec", "1×taco:Tripa", "1×taco:Tripa"]);
  assert.deepEqual(lines.filter((x: string) => x.includes("quesadilla")), ["1×quesadilla:Bistec"]);
});

test("tw4938: 'dos quesadillas doradas … preparadas' rung at qty 1 → 2", async () => {
  const turns: any[] = [{ speaker: "caller", text: "Dos quesadillas doradas de bistec preparadas, por favor.", language: "es" }];
  const r: any = await shadowOrderFromTurns(turns, (async () => ({ reply: "Listo. ¿Algo más?", actions: [qd(1)] })) as any);
  assert.equal(r.cart.reduce((a: number, l: any) => a + l.quantity, 0), 2);
});

test("tw4938: 'aparte, una porción de nachos' (= also) is not Deluxe on the side; 'preparada con todo aparte' is", () => {
  const opt = "DELUXE ***APARTE / EVERTHING ON SIDE***";
  assert.equal(said("Una quesadilla dorada preparada con todo\nme das una, aparte, una porción de nachos", opt), false);
  assert.equal(said("dos doradas preparadas con todo aparte", opt), true);
});
