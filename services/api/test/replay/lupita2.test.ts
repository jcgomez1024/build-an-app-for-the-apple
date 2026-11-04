import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { staffUnavailable } from "../../src/spoken-ledger.js";
import { shouldPersistOrderName, nameFromTranscriptInfo } from "../../src/order-name.js";

// lupita2 (CAbcdfda): staff "tengo pozole rojo … Sí, hay menudo todavía … De arriba se acabó." made pozole AND menudo "staff-unavailable"
// → the ordered Pozole Rojo was dropped, final cart empty. Only the sold-out clause names what's off.
const d = JSON.parse(readFileSync(new URL("../fixtures/CAbcdfda-lupita2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const POZ = "sq-pozole-rojo-red-pozole-DQ7X4J";
const stub = () => { const r: any = async (t: string) => /orden de pozole para llevar/i.test(t) ? { actions: [{ type: "add_item", itemId: POZ, quantity: 1, modifiers: [] }], reply: "Pozole Rojo. $14.99." } : { actions: [], reply: "Muy bien." }; r.menu = () => M; return r; };

test("lupita2: 'De arriba se acabó' never marks affirmed pozole/menudo off; ordered pozole lands", async () => {
  const off = staffUnavailable(d.turns);
  assert.ok(!off.includes("pozole"), JSON.stringify(off)); assert.ok(!off.includes("menudo"), JSON.stringify(off));
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  assert.equal(r.cart.filter((l: any) => l.itemId === POZ).length, 1, JSON.stringify(r.cart));
  assert.equal(r.cart.find((l: any) => l.itemId === POZ).quantity, 1);
});
test("lupita2: real sold-out clauses still count", () => {
  assert.ok(staffUnavailable([{ speaker: "caller", text: "¿Tienen pozole?" }, { speaker: "staff", text: "No, el pozole se acabó." }] as any).includes("pozole"));
  assert.ok(staffUnavailable([{ speaker: "caller", text: "¿Qué caldos hay?" }, { speaker: "staff", text: "Tengo menudo. El pozole ya se acabó." }] as any).includes("pozole"));
  assert.ok(!staffUnavailable([{ speaker: "caller", text: "¿Qué caldos hay?" }, { speaker: "staff", text: "Tengo menudo. El pozole ya se acabó." }] as any).includes("menudo"));
});
test("lupita2: staff-ask name answer persists even with an empty cart; volunteer names don't", () => {
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Lupita");
  assert.equal(shouldPersistOrderName(false, "staff-ask", d.turns), true);
  assert.equal(shouldPersistOrderName(false, "volunteer", d.turns), false);
  assert.equal(shouldPersistOrderName(true, "volunteer"), true);
});
