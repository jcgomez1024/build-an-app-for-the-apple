import { test } from "node:test";
import assert from "node:assert/strict";
import { dropDeclinedAsk } from "../../src/list-repair.ts";
import { flagUnresolvedRequired, isConfirmedProvenance, orderValidation } from "../../src/offline-evidence.ts";
import { CASES } from "./cases.ts";
import { evaluateAll, phoneMenu } from "./evaluate.ts";

test("offline evidence keeps inferred fields out of the assertion set", () => {
  for (const c of CASES) {
    assert.equal(c.pageNamedGate, false);
    for (const u of c.unresolved) assert.equal(isConfirmedProvenance(u.provenance as any), false, u.field);
    for (const line of c.lines) {
      assert.equal(isConfirmedProvenance(line.qty.provenance), true);
      for (const mod of line.modifiers || []) assert.equal(isConfirmedProvenance(mod.provenance), true);
    }
  }
  const inferred = CASES.flatMap((c) => c.unresolved.map((u) => `${c.id}:${u.field}`));
  for (const id of ["C09:drink-32oz", "C09:dip-chips", "C12:pozole-color", "C06:third-quesadilla-meat", "C10:soda-brand", "C02:birria-size"]) {
    assert.ok(inferred.includes(id), id);
  }
});

test("offline evidence controls stay correct on the real replay path", async () => {
  const results = await evaluateAll();
  const controls = results.filter((r) => r.role === "control");
  assert.ok(controls.length >= 4);
  for (const r of controls) assert.deepEqual(r.failures, [], `${r.id} ${r.failures.join("; ")}`);
  assert.equal(results.every((r) => r.pageNamedGateSatisfied === false), true);
  const c12 = results.find((r) => r.id === "C12")!;
  assert.equal(c12.inferredNotAsserted.includes("pozole-color"), true);
  assert.equal(c12.verdict, "pass");
});

test("a declined soup ask is removed, and a missing required option stays visible", () => {
  const cart = [{ itemId: "sq-pozole-rojo-red-pozole-DQ7X4J", quantity: 3, modifiers: [] }];
  assert.equal(dropDeclinedAsk(cart, [
    { speaker: "caller", text: "¿Tienes pozole?" },
    { speaker: "caller", text: "No, okay." },
  ] as any), true);
  assert.equal(cart.length, 0);
  const menu = phoneMenu();
  const namesOf = (g: any) => [...new Set((g.options || []).map((o: any) => (typeof o === "string" ? o : o?.name)).filter(Boolean))];
  const item = menu.find((m) => {
    const req = (m.modifierGroups || []).filter((g: any) => Number(g.minSelections) > 0);
    return req.length > 0 && req.every((g: any) => namesOf(g).length >= Number(g.minSelections) && (g.maxSelections == null || Number(g.maxSelections) <= 0 || Number(g.minSelections) <= Number(g.maxSelections)));
  });
  assert.ok(item, "site menu has a required group that distinct options can fill");
  const line: any = { itemId: item.id, quantity: 1, modifiers: [] };
  assert.equal(flagUnresolvedRequired([line], menu), true);
  assert.match(line.elviNotes.join(" "), /confirmar /);
  assert.equal(orderValidation([line]), "unresolved");
  const mods: any[] = [];
  for (const g of item.modifierGroups || []) {
    if (Number(g.minSelections) < 1) continue;
    const names = [...new Set((g.options || []).map((o: any) => (typeof o === "string" ? o : o?.name)).filter(Boolean))];
    if (names.length < Number(g.minSelections)) continue;
    for (let i = 0; i < Number(g.minSelections); i++) mods.push({ step: g.name, option: names[i] });
  }
  const filled: any = { itemId: item.id, quantity: 1, modifiers: mods };
  flagUnresolvedRequired([filled], menu);
  assert.equal(filled.validation, undefined);
  assert.equal((filled.elviNotes || []).some((n: string) => String(n).startsWith("confirmar ")), false);
});
