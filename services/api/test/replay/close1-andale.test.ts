// close1 (Cecilia): after goodbye, "Ándale, pues" never adds water (or anything).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

test("close1: Ándale, pues after goodbye adds nothing", async () => {
  const water = { type: "add_item", itemId: "sq-drink-agua-water-bottle-H4VXU2", quantity: 11, modifiers: [] };
  const run = async (text: string) => {
    if (/pepasi|pepsi|botella/i.test(text)) return { reply: "Pepsi.", actions: [{ type: "add_item", itemId: "sq-pepsi", quantity: 1, modifiers: [] }] };
    if (/jamaica/i.test(text)) return { reply: "Jamaica.", actions: [{ type: "add_item", itemId: "sq-jamaica", quantity: 1, modifiers: [] }] };
    if (/[aá]ndale/i.test(text)) return { reply: "11 × Agua.", actions: [water] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const r: any = await shadowOrderFromTurns([
    T("caller", "me da uno de botella", 0),
    T("staff", "Claro.", 2),
    T("caller", "Me pone una de Jamaica, por favor.", 4),
    T("staff", "Okay. ¿Qué más?", 6),
    T("caller", "Nada más, ahora sí, ya, don.", 8),
    T("staff", "Ándale, pues, ahí te los tenemos. Gracias.", 10),
    T("caller", "Ándale, pues", 12),
  ], run as any);
  assert.ok(!r.cart.some((l: any) => /water|agua-water/i.test(l.itemId)), JSON.stringify(r.cart));
  assert.ok(r.steps.some((s: any) => s.source === "caller-closing" && /[aá]ndale/i.test(s.heard)));
});
