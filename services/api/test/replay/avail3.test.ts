// avail3: any availability question ("¿tienen arroz?") never adds an item, even if the dish isn't named again. Synthetic, no PII.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";
const T = (speaker: "caller" | "staff", text: string, start: number, language = "es"): CallTurn => ({ speaker, start, end: start + 1, text, language });
const runner = (seen: string[]) => async (text: string) => { seen.push(text);
  if (/arroz|rice/i.test(text)) return { reply: "Arroz agregado.", actions: [{ type: "add_item", itemId: "sq-rice", quantity: 1, modifiers: [] }] };
  if (/taco/i.test(text)) return { reply: "Dos tacos. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-taco", quantity: 2, modifiers: [] }] };
  return { reply: "¿Algo más?", actions: [] }; };
for (const [q, lang] of [["¿tienen arroz?", "es"], ["¿hay arroz hoy?", "es"], ["do you have rice?", "en"], ["you got rice today?", "en"], ["is rice available?", "en"], ["is that available?", "en"], ["do you guys have rice?", "en"], ["do you still have rice?", "en"], ["¿está disponible el arroz?", "es"], ["¿tienen disponible arroz?", "es"], ["¿manejan arroz?", "es"]]) {
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
