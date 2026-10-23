// avail3: any availability question ("¿tienen arroz?") never adds an item, even if the dish isn't named again. Synthetic, no PII.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
const T = (speaker: "caller" | "staff", text: string, start: number, language = "es"): CallTurn => ({ speaker, start, end: start + 1, text, language });
const runner = (seen: string[]) => async (text: string) => { seen.push(text);
  if (/arroz|rice/i.test(text)) return { reply: "Arroz agregado.", actions: [{ type: "add_item", itemId: "sq-rice", quantity: 1, modifiers: [] }] };
  if (/taco/i.test(text)) return { reply: "Dos tacos. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-taco", quantity: 2, modifiers: [] }] };
  return { reply: "¿Algo más?", actions: [] }; };
for (const [q, lang] of [["¿tienen arroz?", "es"], ["¿hay arroz hoy?", "es"], ["do you have rice?", "en"], ["you got rice today?", "en"], ["is rice available?", "en"], ["is that available?", "en"], ["do you guys have rice?", "en"], ["do you still have rice?", "en"], ["¿está disponible el arroz?", "es"], ["¿tienen disponible arroz?", "es"], ["¿manejan arroz?", "es"], ["Ah, ¿tienen arroz?", "es"]]) {
  test(`avail3: '${q}' adds no rice`, async () => {
    const seen: string[] = [];
    const r: any = await shadowOrderFromTurns([T("caller", q, 0, lang), T("staff", "Sí.", 2), T("caller", "dame dos tacos de asada", 4), T("staff", "¿Algo más?", 6), T("caller", "es todo, gracias", 8)], runner(seen) as any);
    assert.ok(!r.cart.some((l: any) => l.itemId === "sq-rice"), seen.join(" | "));
  });
}
test("avail3: ordering rice after asking still adds it", async () => {
  const seen: string[] = [];
  const r: any = await shadowOrderFromTurns([T("caller", "¿tienen arroz?", 0), T("staff", "Sí.", 2), T("caller", "dame un arroz", 4), T("staff", "¿Algo más?", 6), T("caller", "es todo, gracias", 8)], runner(seen) as any);
  assert.ok(r.cart.some((l: any) => l.itemId === "sq-rice"), seen.join(" | "));
});
test("qbcomal1: Queso Birrias with no tortilla named → comal (QCO); 'street' keeps QST", async () => {
  const mk = (opt: string) => async () => ({ reply: "¿Algo más?", actions: [{ type: "add_item", itemId: "sq-qb", quantity: 1, modifiers: [{ step: "Variation", option: opt }] }] });
  const qst = "(QST) 3 x Queso Birrias Taquera / Street con Consome/Broth";
  const a: any = await shadowOrderFromTurns([T("caller", "one queso birrias please", 0, "en"), T("staff", "Anything else?", 2), T("caller", "that's it, thanks", 4, "en")], mk(qst) as any);
  assert.match(a.cart[0].modifiers[0].option, /^\(QCO\)/);
  const b: any = await shadowOrderFromTurns([T("caller", "one queso birrias street please", 0, "en"), T("staff", "Anything else?", 2), T("caller", "that's it, thanks", 4, "en")], mk(qst) as any);
  assert.match(b.cart[0].modifiers[0].option, /^\(QST\)/);
});
test("avail4: 'Sí, y me da, ¿tienen como arroz…?' then 'me da una side de arroz' → 1 rice", async () => {
  const seen: string[] = [];
  const r: any = await shadowOrderFromTurns([T("caller", "dame dos tacos de asada", 0), T("staff", "¿Algo más?", 2), T("caller", "Sí, y me da, ¿tienen como arroz, como una side de arroz?", 4), T("staff", "Sí.", 6), T("caller", "Ok, me da una side de arroz.", 8), T("staff", "¿Algo más?", 10), T("caller", "es todo, gracias", 12)], runner(seen) as any);
  assert.equal(r.cart.filter((l: any) => l.itemId === "sq-rice").reduce((a: number, l: any) => a + l.quantity, 0), 1, seen.join(" | "));
});
test("split1: 'tres quesadillas doradas, una de bistec y dos de pollo' splits the 3 across meats", async () => {
  const { splitItems } = await import("../../src/call-scoring.ts");
  const p = splitItems("tres quesadillas doradas, una de bistec y dos de pollo.");
  assert.equal(p.length, 2, JSON.stringify(p)); assert.match(p[0], /^una quesadillas doradas de bistec/); assert.match(p[1], /^dos quesadillas doradas de pollo/);
  assert.deepEqual(splitItems("tres tacos, una de pastor"), ["tres tacos, una de pastor"]);
});
test("order3: 'la tercera orden serían tres de bistec con chorizo' rings 3 more of the last dish", async () => {
  const seen: string[] = [];
  const run = async (text: string) => { seen.push(text);
    if (/quesadilla/i.test(text)) return { reply: "¿Algo más?", actions: [{ type: "add_item", itemId: "sq-quesadilla-X", quantity: /tres/i.test(text) ? 3 : 2, modifiers: [{ step: "Carne", option: /bistec/i.test(text) ? "Bistec" : "Tripa" }] }] };
    return { reply: "¿Algo más?", actions: [] }; };
  const r: any = await shadowOrderFromTurns([T("caller", "dos quesadillas de tripa", 0), T("staff", "¿Algo más?", 2), T("caller", "Y la, y la tercera orden serían tres de, de bistec con chorizo.", 4), T("staff", "¿Algo más?", 6), T("caller", "es todo, gracias", 8)], run as any);
  assert.equal(r.cart.length, 2, seen.join(" | "));
});
test("dish1: 'una orden de tacos' then 'me da cuatro de tripa y cuatro de costilla' → 2 taco lines of 4", async () => {
  const seen: string[] = [];
  const run = async (text: string) => { seen.push(text);
    if (/tacos? de (tripa|costilla)/i.test(text)) return { reply: "¿Algo más?", actions: [{ type: "add_item", itemId: "sq-taco-X", quantity: 4, modifiers: [{ step: "Carne", option: /tripa/i.test(text) ? "Tripa" : "Costilla" }] }] };
    return { reply: "¿Qué tacos?", actions: [] }; };
  const r: any = await shadowOrderFromTurns([T("caller", "Buenas tardes, quería poner una orden de tacos.", 0), T("caller", "Diga, ah, me da cuatro de tripa y cuatro de costilla.", 2), T("staff", "¿Algo más?", 4), T("caller", "Sería todo.", 6)], run as any);
  assert.equal(r.cart.reduce((a: number, l: any) => a + l.quantity, 0), 8, seen.join(" | "));
});
test("size1: 'A regular.' to the size question resizes the burrito, not a 2nd one", async () => {
  const run = async (text: string) => /regular/i.test(text)
    ? { reply: "¿Algo más?", actions: [{ type: "add_item", itemId: "sq-burrito-X", quantity: 1, modifiers: [{ step: "Size", option: "Regular '10" }] }] }
    : /burrito/i.test(text) ? { reply: "¿Regular o grande?", actions: [{ type: "add_item", itemId: "sq-burrito-X", quantity: 1, modifiers: [{ step: "Size", option: "Grande '12" }] }] } : { reply: "¿Algo más?", actions: [] };
  const r: any = await shadowOrderFromTurns([T("caller", "Y un burrito de pollo.", 0), T("staff", "¿Lo quieres regular o grande?", 2), T("caller", "A regular.", 4), T("staff", "Muy bien.", 6), T("caller", "Sería todo.", 8)], run as any);
  assert.equal(r.cart.length, 1); assert.equal(r.cart[0].modifiers[0].option, "Regular '10");
});
