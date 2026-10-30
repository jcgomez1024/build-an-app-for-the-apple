// chui1 (CA95e4264e, Oct 30 4:08 PM ET, Chui, Spanish pickup, staff-answered, 84 s, caller side only):
// "de bistec, doradas" + "Supreme" → QD DELUXE bistec; "una orden de tacos al vapor" / "de" / "pollo" → vapor with Pollo;
// "un pico con chips" → Dips. Elvi rang QD REGULAR, a bare vapor line, and asked about a Traditional Elvis Bowl nobody ordered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyQdSupreme, applyVaporOrders, VAPOR_ID } from "../../src/readback-pass.ts";
import { applySharedAliases } from "../../src/aliases.ts";
import { dishNamedIn } from "../../src/elvi.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA95e4264e-turns.json", import.meta.url), "utf8"));
const QD_REG = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
const miss = async (t: string) => /bistec/i.test(t) && !/vapor/i.test(t)
  ? { reply: "ok", actions: [{ type: "add_item", itemId: QD_REG, quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }] }
  : /vapor/i.test(t) ? { reply: "ok", actions: [{ type: "add_item", itemId: VAPOR_ID, quantity: 1, modifiers: [] }] }
  : /chips/i.test(t) ? { reply: "ok", actions: [{ type: "add_item", itemId: "sq-dips-MAIPCN", quantity: 1, modifiers: [{ step: "Dips", option: "Pico de Gallo con Chips" }] }] }
  : { reply: "ok", actions: [] };
test("chui1: QD DELUXE bistec, vapor with Pollo, pico con chips — nothing else", async () => {
  const r: any = await shadowOrderFromTurns(structuredClone(turns), miss as any);
  assert.ok(!r.statusCall);
  const qd = r.cart.filter((l: any) => /^sq-qd-/.test(l.itemId));
  assert.equal(qd.length, 1); assert.equal(qd[0].itemId, "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L"); assert.equal(qd[0].quantity, 1);
  assert.ok(qd[0].modifiers.some((m: any) => m.option === "(QD) DELUXE Preparada"));
  assert.ok(qd[0].modifiers.some((m: any) => /^Bistec/.test(m.option)));
  const v = r.cart.filter((l: any) => l.itemId === VAPOR_ID);
  assert.equal(v.length, 1); assert.equal(v[0].quantity, 1);
  assert.deepEqual(v[0].modifiers.map((m: any) => m.option), ["Pollo / Chicken"]);
  assert.deepEqual(v[0].elviNotes, ["vapor: 5 pollo"]);
  assert.equal(r.cart.filter((l: any) => l.itemId === "sq-dips-MAIPCN").length, 1);
  assert.equal(r.cart.length, 3);
  assert.ok(!r.cart.some((l: any) => /bowl/i.test(l.itemId)));
});
test("chui1: 'supreme' alias → preparada; explicit regular keeps REGULAR", () => {
  assert.match(applySharedAliases("Supreme. Hey.", "phone"), /preparada/i);
  const cart: any[] = [{ itemId: QD_REG, quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }] }];
  applyQdSupreme(cart, [{ speaker: "caller", text: "una dorada de bistec, regular" }] as any);
  assert.equal(cart[0].itemId, QD_REG);
});
test("chui1: bare vapor order + 'de pollo' next turn gets the Pollo filling", () => {
  const cart: any[] = [{ itemId: VAPOR_ID, quantity: 1, modifiers: [] }];
  applyVaporOrders(cart, [{ speaker: "caller", text: "¿Y me da una orden de tacos al vapor?" }, { speaker: "caller", text: "de" }, { speaker: "caller", text: "pollo, por favor." }] as any);
  assert.equal(cart.length, 1); assert.deepEqual(cart[0].modifiers.map((m: any) => m.option), ["Pollo / Chicken"]);
});
test("chui1: a dish the caller never named (bowl from description aliases) is not 'named'", () => {
  const bowl = { name: "Traditional Elvis Bowl", readbackName: "Traditional Elvis Bowl", aliases: ["pico de gallo", "classic toppings and chips", "bowl", "elvis bowl"] };
  assert.equal(dishNamedIn(bowl, "un Dips Pico de Gallo con Chips grande Un pico Haceria todo Si Chui"), false);
  assert.equal(dishNamedIn(bowl, "un bowl de bistec"), true);
  assert.equal(dishNamedIn({ name: "(QD) Quesadilla Dorada" }, "dos doradas de duro"), true);
});
test("chui1: withGain scales and clips 16-bit samples, header untouched", async () => {
  const { withGain } = await import("../../src/call-scoring.ts");
  const b = Buffer.alloc(44 + 6); b.write("RIFF", 0); b.writeInt16LE(1000, 44); b.writeInt16LE(-20000, 46); b.writeInt16LE(30000, 48);
  const o = withGain(b, 2);
  assert.equal(o.toString("latin1", 0, 4), "RIFF"); assert.equal(o.readInt16LE(44), 2000); assert.equal(o.readInt16LE(46), -32768); assert.equal(o.readInt16LE(48), 32767);
  assert.equal(b.readInt16LE(44), 1000);
});
