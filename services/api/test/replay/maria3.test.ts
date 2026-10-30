// maria3 (CA2a89f700, Oct 30 5:43 PM ET, María callback, 55 s): "acabo de hacer una orden… ¿no me pueden adherir un pambazo?"
// staff: papas con nopales y chorizo, lleva todo (lechuga, crema, queso fresco). Elvi said "Agregado."/"Listo." with no add → noOrder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { attachAddOnNote, ADD_ON_NOTE } from "../../src/asked-dishes.ts";
import { noHollowAdd } from "../../src/elvi.ts";
import { isStatusFollowUpCall } from "../../src/readback-pass.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA2a89f700-turns.json", import.meta.url), "utf8"));
const menu = JSON.parse(readFileSync(new URL("../fixtures/CA2a89f700-menu.json", import.meta.url), "utf8"));
const PB = "sq-pambazo-elvis-pb-pambazo-YQYLVY";
const run = Object.assign(async () => ({ reply: "Agregado.", actions: [] }), { menu: () => menu });

test("maria3: add-on callback rings 1 Pambazo (nopales con papas + chorizo, lechuga/crema/queso fresco) tagged for the earlier order", async () => {
  const r: any = await shadowOrderFromTurns(structuredClone(turns), run as any);
  assert.equal(r.cart.length, 1);
  const l = r.cart[0];
  assert.equal(l.itemId, PB); assert.equal(l.quantity, 1);
  const opts = l.modifiers.map((m: any) => m.option).join(" | ");
  assert.match(opts, /Nopales con Papas/); assert.match(opts, /Chorizo/);
  assert.match(opts, /Lechuga/); assert.match(opts, /Crema/); assert.match(opts, /Queso Fresco/);
  assert.doesNotMatch(opts, /DOUBLE|Pico|Frijoles/i);
  assert.ok(l.elviNotes.includes(ADD_ON_NOTE)); assert.equal(r.addOn, true);
});

test("maria3: add-on note points at the same caller's earlier order", () => {
  const order: any = { addOn: true, cart: [{ addOn: true, elviNotes: [ADD_ON_NOTE] }] };
  const ev = [{ event: "recording", caller: "+15550001111", callSid: "CA329b3324abc123", ts: "2026-10-30T21:37:00Z", lines: [{}], name: "María" },
    { event: "recording", caller: "+15559999999", callSid: "CAother", ts: "2026-10-30T21:40:00Z", lines: [{}] }];
  assert.equal(attachAddOnNote(order, "+15550001111", ev, Date.parse("2026-10-30T21:44:00Z"), "CA2a89"), "CA329b3324abc123");
  assert.match(order.cart[0].elviNotes[0], /AGREGAR a la orden de 5:37 PM \(María\).*abc123/);
});

test("maria3: add-on callback is never a status follow-up", () => {
  assert.equal(isStatusFollowUpCall([{ speaker: "caller", text: "¿Ya está mi orden? Se me olvidó, agrégame un taco", end: 20 }] as any), false);
});

test("maria3: never 'Agregado'/'Listo' without an add_item", () => {
  const input: any = { language: "es", transcript: "¿no me pueden adherir un pambazo?" };
  assert.doesNotMatch(noHollowAdd({ reply: "Agregado.", actions: [] } as any, input).reply, /agregado/i);
  assert.doesNotMatch(noHollowAdd({ reply: "Listo.", actions: [] } as any, input).reply, /^listo/i);
  const ok: any = { reply: "Agregado.", actions: [{ type: "add_item", itemId: PB, quantity: 1 }] };
  assert.equal(noHollowAdd(ok, input).reply, "Agregado.");
});
