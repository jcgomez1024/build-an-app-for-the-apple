// nameturn1: the name turn can't re-add an earlier item merged with another item's meat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutNameTurnAdds } from "../../src/elvi.ts";

const merged = { type: "add_item", itemId: "torta", quantity: 2, modifiers: [{ option: "Bistec / Steak" }, { option: "Prensado / Spicy Pork (+$0.50)" }] };
test("nameturn1: 'Ana. Sí, está bien' → only set_customer, no torta re-add", () => {
  const r: any = withoutNameTurnAdds({ reply: "2 × Torta: chicharrón prensado y bistec. ¿Algo más?", actions: [{ type: "set_customer", name: "Ana" }, merged] } as any, "Ana. Sí, está bien", "es" as any);
  assert.deepEqual(r.actions.map((a: any) => a.type), ["set_customer"]);
  assert.match(r.reply, /Ana/);
  assert.doesNotMatch(r.reply, /Torta/);
});
test("nameturn1: a name turn that also orders food keeps the add", () => {
  const r: any = withoutNameTurnAdds({ reply: "x", actions: [{ type: "set_customer", name: "Ana" }, merged] } as any, "Ana, y otra torta de prensado", "es" as any);
  assert.equal(r.actions.length, 2);
});
