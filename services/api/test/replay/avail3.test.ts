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
test("meatsplit1: 'Can I get one steak and one chorizo?' splits the 2 quesadillas just rung", async () => {
  const run = async (text: string) => /quesadilla/i.test(text) ? { reply: "¿Algo más?", actions: [{ type: "add_item", itemId: "sq-q", quantity: 2, modifiers: [{ step: "T", option: "(QHR) Quesadilla Harina / Flour" }, { step: "M", option: "Bistec / Steak" }] }] } : { reply: "Anything else?", actions: [{ type: "add_item", itemId: "sq-q", quantity: 2, modifiers: [] }] };
  const r: any = await shadowOrderFromTurns([T("caller", "if I get two flour steak quesadillas deluxe,", 0, "en"), T("staff", "Okay.", 2), T("caller", "Can I get one steak and one chorizo?", 4, "en"), T("staff", "Anything else?", 6), T("caller", "that's it, thanks", 8, "en")], run as any);
  assert.deepEqual(r.cart.map((l: any) => [l.quantity, l.modifiers[1].option]), [[1, "Bistec / Steak"], [1, "Chorizo / Mexican Sausage"]]);
});
import { mixMeats } from "../../src/call-scoring.js";
test("mix1: 'bistec con chorizo' is one mixed line", () => {
  const acts: any[] = [
    { type: "add_item", itemId: "sq-q", quantity: 3, modifiers: [{ step: "t", option: "Comal" }, { step: "m", option: "Bistec / Steak" }] },
    { type: "add_item", itemId: "sq-q", quantity: 2, modifiers: [{ step: "t", option: "Comal" }, { step: "m", option: "Chorizo / Mexican Sausage" }] },
  ];
  mixMeats(acts, "tres quesadillas de bistec con chorizo");
  assert.equal(acts.length, 1); assert.equal(acts[0].quantity, 3);
  assert.deepEqual(acts[0].modifiers.map((m: any) => m.option), ["Comal", "Bistec / Steak", "Chorizo / Mexican Sausage"]);
  const b: any[] = [{ ...acts[0], modifiers: [{ option: "Bistec / Steak" }] }, { type: "add_item", itemId: "sq-q", quantity: 2, modifiers: [{ option: "Chorizo / Mexican Sausage" }] }];
  mixMeats(b, "tres de bistec y dos de chorizo"); assert.equal(b.length, 2);
});
import { rewriteCallerText, prepMergedCallerTurns } from "../../src/call-scoring.js";
test("or1: the corrected count wins", () => {
  assert.equal(rewriteCallerText("Dos tacos de bistec, o tres tacos de bistec."), "tres tacos de bistec.");
  assert.equal(rewriteCallerText("dos, o tres tacos de pollo"), "tres tacos de pollo");
  assert.equal(rewriteCallerText("dos tacos y tres quesadillas"), "dos tacos y tres quesadillas");
});
test("each1: two of a dish, one of each meat", () => {
  assert.equal(rewriteCallerText("if I get two flour steak quesadillas deluxe, cilantro. Can I get one steak and one chorizo?"),
    "if I get one flour steak quesadilla deluxe, cilantro and one flour chorizo quesadilla deluxe, cilantro.");
});
test("chips1: chips con pico is the dip", () => {
  assert.equal(rewriteCallerText("me le puede poner dos chips con, pico, porfa"), "me le puede poner dos Dips Pico de Gallo con Chips, porfa");
});
test("desk2: dish-less order refers to the asked dish", () => {
  const m = [{speaker:"caller",text:"Eh, tiene nachos"},{speaker:"caller",text:"¿me puede preparar una?"},{speaker:"caller",text:"a nombre de Testo"},{speaker:"caller",text:"de testo, ajá"},{speaker:"caller",text:"uno de buche"}] as any;
  prepMergedCallerTurns(m);
  assert.match(m[1].text, /una orden de nachos/); assert.equal(m[3].text, ""); assert.equal(m[4].text, "uno de buche");
});
test("mix2: staff-pick split merges with caller's 'bistec con chorizo'", () => {
  const acts: any[] = [{ type: "add_item", itemId: "q", quantity: 3, modifiers: [{ option: "Bistec / Steak" }, { option: "Mild Salsa Asada" }] }, { type: "add_item", itemId: "q", quantity: 2, modifiers: [{ option: "Chorizo / Mexican Sausage" }, { option: "Mild Salsa Asada" }] }];
  mixMeats(acts, "Quesadilla Comal tres de bistec con chorizo");
  assert.equal(acts.length, 1); assert.equal(acts[0].quantity, 3);
});
test("decline1/restate1: a decline adds nothing; a restated pair sets counts", async () => {
  const Q = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
  const add = (q: number, meat: string) => ({ type: "add_item", itemId: Q, quantity: q, modifiers: [{ option: "(QD) DELUXE Preparada" }, { option: meat }] });
  const answers: Record<string, any> = {
    "tres quesadillas doradas preparadas de pollo": { actions: [add(1, "Pollo / Chicken")] },
    "dos de pollo, una de bistec": { actions: [add(2, "Pollo / Chicken"), add(1, "Bistec / Steak")] },
    "yo paso a recogerlo": { actions: [{ type: "add_item", itemId: "sq-pambazo-elvis-pb-pambazo-YQ", quantity: 1, modifiers: [] }] },
    "No, así está bien": { actions: [{ type: "add_item", itemId: "sq-torta-4GNTTE", quantity: 1, modifiers: [] }] },
  };
  const turns: any[] = [{ speaker: "staff", start: 0, end: 1, text: "Cocina Elvis, ¿qué le preparamos?", language: "es" }];
  Object.keys(answers).forEach((text, i) => turns.push({ speaker: "caller", start: i * 10 + 2, end: i * 10 + 4, text, language: "es" }, { speaker: "staff", start: i * 10 + 5, end: i * 10 + 6, text: "Muy bien.", language: "es" }));
  const r: any = await shadowOrderFromTurns(turns, (async (t: string) => answers[t] || { actions: [] }) as any);
  const q = r.cart.filter((l: any) => l.itemId === Q).map((l: any) => l.quantity).sort();
  assert.deepEqual(q, [1, 2]); assert.ok(!r.cart.some((l: any) => /torta|pambazo/.test(l.itemId)));
});
test("coctel1: aliases + dish-less 'me pone uno' after 'tiene coctel de camarón'", async () => {
  const { applySharedAliases } = await import("../../src/aliases.ts");
  assert.equal(applySharedAliases("tiene coctel de camarón", "phone"), "tiene Coctel de Camarones / Shrimp Cocktail");
  assert.equal(applySharedAliases(applySharedAliases("tiene coctel de camarón", "phone"), "phone"), "tiene Coctel de Camarones / Shrimp Cocktail");
  assert.equal(applySharedAliases("Eh, nada más el coctel", "phone"), "Eh, Coctel de Camaron / Shrimp");
  assert.equal(applySharedAliases("solo camarón y pulpo", "phone"), "solo camarón y pulpo");
  const m: any[] = [{ speaker: "caller", text: "Eh, tiene coctel de camarón" }, { speaker: "caller", text: "Me pone uno" }];
  prepMergedCallerTurns(m); assert.match(m[1].text, /pone uno orden de coctel de camarón/i);
});

import { pickVariation, loadSiteCatalog } from "../../src/site-catalog.js";
test("coctel2: 'Coctel de Camaron / Shrimp' / 'nada más camarón' picks the plain shrimp sku; bare dish still asks", () => {
  const p: any = loadSiteCatalog()!.products.find((x: any) => /^Coctel de Camarones/.test(x.name));
  const items: any[] = p.skus.map((k: any, n: number) => ({ id: `c${n}`, name: k.name, squareCatalogObjectId: p.squareId, squareVariationId: k.squareId }));
  assert.equal(pickVariation("Eh, Coctel de Camaron / Shrimp Sí", items).length, 1);
  assert.match(pickVariation("nada más camarón", items)[0].name, /Shrimp$/);
  assert.equal(pickVariation("un coctel", items).length, 2);
  assert.equal(pickVariation("coctel de camarón con pulpo", items).length, 1);
});

test("fixmeat1/split2/combo1 (Jesús): self-correction replaces the meat; quesadilla and gordita combo split", () => {
  const m = [{ speaker: "caller", text: "una quesadilla de chorizo, que diga, perdón, del pastor, y me puede dar un, el combo de las gorditas Ah, de harina Sí" }];
  prepMergedCallerTurns(m);
  assert.equal(m.length, 2);
  assert.equal(m[0].text, "una quesadilla de harina de al pastor");
  assert.match(m[1].text, /COMBO Gorditas/);
  assert.doesNotMatch(m[1].text, /harina|chorizo/);
});

test("cecilia1: tienen menudo → dos órdenes con pata stamps dish and qty", async () => {
  const MEN = "sq-menudo-con-pata";
  const seen: string[] = [];
  const run = async (t: string) => {
    seen.push(t);
    if (/menudo/i.test(t) && /\b(dos|2)\b/i.test(t)) return { actions: [{ type: "add_item", itemId: MEN, quantity: 2, modifiers: [{ option: "Con Pata" }, { option: "Corn Tortillas" }], readback: "2 menudo con pata" }] };
    if (/menudo/i.test(t)) return { actions: [{ type: "add_item", itemId: MEN, quantity: 1, modifiers: [{ option: "Con Pata" }], readback: "1 menudo" }] };
    return { actions: [] };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "¿sí tienen menudo?", language: "es" },
    { speaker: "staff", start: 2, end: 3, text: "Sí, tenemos menudo.", language: "es" },
    { speaker: "caller", start: 4, end: 5, text: "me puede preparar dos órdenes, por favor, con pata?", language: "es" },
    { speaker: "staff", start: 6, end: 7, text: "¿Algo más?", language: "es" },
    { speaker: "caller", start: 8, end: 9, text: "es todo, gracias", language: "es" },
  ] as any, run as any);
  assert.ok(seen.some((s) => /menudo/i.test(s) && /\b(dos|2)\b/i.test(s)), `expected dos menudo in say(); got ${JSON.stringify(seen)}`);
  const q = r.cart.filter((l: any) => /menudo/i.test(l.itemId)).reduce((a: number, l: any) => a + (l.quantity || 1), 0);
  assert.equal(q, 2);
});

test("desk2: menudo dos órdenes con pata", () => {
  const m = [{ speaker: "caller", text: "¿sí tienen menudo?" }, { speaker: "caller", text: "me puede preparar dos órdenes, por favor, con pata?" }] as any;
  prepMergedCallerTurns(m);
  assert.match(m[1].text, /dos\s+[oó]rdenes?\s+de\s+menudos?/i);
});

test("avail2: Oiga, disculpe, ¿sí tienen menudo? stamps onto dos órdenes", () => {
  const m = [
    { speaker: "caller", text: "Oiga, disculpe, ¿sí tienen menudo?" },
    { speaker: "caller", text: "O, ¿me puede preparar dos órdenes, por favor, con pata?" },
  ] as any;
  prepMergedCallerTurns(m);
  assert.ok(m.some((x: any) => /menudo/i.test(x.text) && /dos\s+[oó]rdenes?/i.test(x.text)), JSON.stringify(m));
});
