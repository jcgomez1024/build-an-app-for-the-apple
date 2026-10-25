// docena1 / luis1 (Luis CA181080 10/24 10:52): standalone dozen tortillas + menudo sin pata from opening on phone
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-24T10:52:00-04:00";
const { applySharedAliases } = await import("../../src/aliases.ts");
const { dishesNamed, shadowOrderFromTurns, isOrderIntro } = await import("../../src/call-scoring.ts");
const { thirdPersonName, nameFromTranscriptInfo } = await import("../../src/order-name.ts");
const { itemAvailability, enforceSiteAvailability } = await import("../../src/site-catalog.ts");

const MENUDO_SQ = "NA2WYA64JRUYNKQ5ZEIKTMGZ";
const TORT_12_COMAL = "VGID3HJ6257CRFOGZIXIT4J4";

test("docena1: una docena de tortilla → 12 x Tortilla Comal", () => {
  assert.match(applySharedAliases("y una docena de tortilla.", "phone"), /12 x Tortilla Comal/i);
  assert.match(applySharedAliases("una docena de tortillas", "phone"), /12 x Tortilla Comal/i);
  assert.ok(dishesNamed("12 x Tortilla Comal").has("tortilla"));
});

test("luis1: Menudo at 10:52 Sat available on phone", () => {
  assert.equal(itemAvailability(MENUDO_SQ, undefined, { channel: "phone" }).available, true);
});

test("luis1: enforceSiteAvailability keeps menudo add on phone at 10:52", () => {
  const menu: any[] = [{ id: "menudo", name: "Menudo con Tortillas (4)", squareCatalogObjectId: MENUDO_SQ, squareVariationId: "ZSRUX4RJH2VGYXSVZTMOQIOG", priceCents: 1599, modifierGroups: [] }];
  const r: any = enforceSiteAvailability(
    { reply: "Agregado.", actions: [{ type: "add_item", itemId: "menudo", quantity: 1, modifiers: [] }] } as any,
    menu as any, "es", undefined, { channel: "phone" });
  assert.equal(r.actions.filter((a: any) => a.type === "add_item").length, 1);
  assert.doesNotMatch(r.reply || "", /11:20|solo está disponible/i);
});

test("luis1: shadow keeps menudo + dozen as two lines", async () => {
  const MEN = "sq-menudo-tortillas";
  const TOR = "sq-tortillas-12-comal";
  const seen: string[] = [];
  const run = async (t: string) => {
    const s = applySharedAliases(t, "phone");
    seen.push(s);
    const acts: any[] = [];
    if (/menudo/i.test(s) && !/11:20/.test(s)) acts.push({ type: "add_item", itemId: MEN, quantity: 1, modifiers: [{ option: "4 x (Corn) Comal Tortilla" }], readback: "menudo sin pata" });
    if (/12 x Tortilla Comal/i.test(s) || (/tortilla/i.test(s) && /12|docena/i.test(s))) acts.push({ type: "add_item", itemId: TOR, quantity: 1, modifiers: [], readback: "12 tortillas comal" });
    return { actions: acts, reply: acts.length ? "¿Algo más?" : "¿Menudo con Tortillas o Con Pata?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "te puedo ordenar un menudo?", language: "es" },
    { speaker: "staff", start: 2, end: 3, text: "Ah, claro.", language: "es" },
    { speaker: "caller", start: 4, end: 5, text: "Un menudo sin pata", language: "es" },
    { speaker: "staff", start: 6, end: 7, text: "Ujú.", language: "es" },
    { speaker: "caller", start: 8, end: 9, text: "y una docena de tortilla.", language: "es" },
    { speaker: "staff", start: 10, end: 11, text: "¿Algo más?", language: "es" },
    { speaker: "caller", start: 12, end: 13, text: "sería todo.", language: "es" },
    { speaker: "staff", start: 14, end: 15, text: "¿a qué nombre?", language: "es" },
    { speaker: "caller", start: 16, end: 17, text: "para Luis.", language: "es" },
  ] as any, run as any);
  assert.ok(r.cart.some((l: any) => /menudo/i.test(l.itemId)), `menudo missing: ${JSON.stringify(r.cart)}`);
  assert.ok(r.cart.some((l: any) => /tortilla/i.test(l.itemId)), `dozen missing: ${JSON.stringify(r.cart)} seen=${JSON.stringify(seen)}`);
  assert.ok(seen.some((s) => /12 x Tortilla Comal/i.test(s)), "alias must fire before say()");
});

test("luis1: para Luis is ticket-only third person", () => {
  assert.equal(thirdPersonName("para Luis"), "Luis");
  assert.deepEqual(nameFromTranscriptInfo([
    { speaker: "staff", text: "¿a qué nombre sería la orden?" },
    { speaker: "caller", text: "para Luis." },
  ]), { name: "Luis", thirdPerson: true, source: "staff-ask" });
});

test("luis181b: drop phantom 6-pack when caller asked for a dozen", async () => {
  const MEN = "sq-menudo-tortillas";
  const TOR6 = "sq-tortillas-6-x-tortilla-comal-handmade-XXXX";
  const run = async (t: string) => {
    const s = applySharedAliases(t, "phone");
    const acts: any[] = [];
    if (/menudo/i.test(s)) acts.push({ type: "add_item", itemId: MEN, quantity: 1, modifiers: [{ option: "4 x (Corn) Comal Tortilla" }] });
    if (/12 x Tortilla Comal|docena|tortilla/i.test(s)) {
      acts.push({ type: "add_item", itemId: "sq-tortillas-12-comal", quantity: 1, modifiers: [] });
      acts.push({ type: "add_item", itemId: TOR6, quantity: 1, modifiers: [] }); // phantom
    }
    return { actions: acts, reply: "¿Algo más?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "Un menudo sin pata", language: "es" },
    { speaker: "caller", start: 2, end: 3, text: "y una docena de tortilla.", language: "es" },
  ] as any, run as any);
  assert.ok(r.cart.some((l: any) => /menudo/i.test(l.itemId)), JSON.stringify(r.cart));
  assert.ok(r.cart.some((l: any) => /12|tortilla/i.test(l.itemId) && !/6-x-tortilla/i.test(l.itemId)), "dozen: " + JSON.stringify(r.cart));
  assert.ok(!r.cart.some((l: any) => /6-x-tortilla|tortillas-6/i.test(l.itemId)), "phantom 6: " + JSON.stringify(r.cart));
});

// angelica1 (CA6c61da 10/25 ~8:55 ET): tortillas avail STT-garbled + "dos docenas" → 2×12 Comal, not dates / "not on menu"
test("angelica1: STT enviar fecha a semana → tienen tortillas", () => {
  assert.match(applySharedAliases("¿tendrás que enviar fecha a semana?", "phone"), /tienen tortillas/i);
  assert.match(applySharedAliases("tendras que enviar fecha a semana", "phone"), /tienen tortillas/i);
  assert.doesNotMatch(applySharedAliases("¿tendrás que enviar fecha a semana?", "phone"), /fecha/i);
});

test("angelica1: dos docenas → dos × 12 x Tortilla Comal", () => {
  assert.match(applySharedAliases("¿Les podría poner dos docenas?", "phone"), /dos\s+12 x Tortilla Comal/i);
  assert.match(applySharedAliases("dos docenas", "phone"), /dos\s+12 x Tortilla Comal/i);
  assert.match(applySharedAliases("una docena", "phone"), /12 x Tortilla Comal/i);
});

test("angelica1: docena de tacos must NOT become Tortilla Comal", () => {
  assert.doesNotMatch(applySharedAliases("una docena de tacos", "phone"), /12 x Tortilla Comal/i);
  assert.doesNotMatch(applySharedAliases("dos docenas de pastor", "phone"), /12 x Tortilla Comal/i);
});

test("angelica1: shadow — tortillas ask + dos docenas → qty 2 dozen packs", async () => {
  const TOR = "sq-tortillas-12-x-tortilla-comal-handmade-VGID3H";
  const seen: string[] = [];
  const replies: string[] = [];
  const run = async (t: string) => {
    const s = applySharedAliases(t, "phone");
    seen.push(s);
    // Simulate pre-fix Elvi: invent dates / deny docenas when raw STT or bare docenas
    if (/fecha|enviar/i.test(t) && !/tortilla/i.test(s)) {
      replies.push("No puedo enviar fechas");
      return { actions: [], reply: "No puedo enviar fechas." };
    }
    if (/\bdocenas?\b/i.test(t) && !/12 x Tortilla Comal/i.test(s)) {
      replies.push("No tengo docenas en el menú");
      return { actions: [], reply: "No tengo docenas en el menú." };
    }
    const acts: any[] = [];
    // Model still empty — force-add in shadow must ring the line
    return { actions: acts, reply: acts.length ? "¿Algo más?" : "¿Algo más?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "¿tendrás que enviar fecha a semana?", language: "es" },
    { speaker: "staff", start: 2, end: 3, text: "Sí, tenemos tortillas.", language: "es" },
    { speaker: "caller", start: 4, end: 5, text: "¿Les podría poner dos docenas?", language: "es" },
    { speaker: "staff", start: 6, end: 7, text: "¿Algo más?", language: "es" },
    { speaker: "caller", start: 8, end: 9, text: "Sería todo.", language: "es" },
    { speaker: "staff", start: 10, end: 11, text: "¿A qué nombre?", language: "es" },
    { speaker: "caller", start: 12, end: 13, text: "Angélica.", language: "es" },
  ] as any, run as any);
  const line = r.cart.find((l: any) => /tortillas?-12|12-x-tortilla|tortilla-comal/i.test(String(l.itemId)));
  assert.ok(line, `dozen missing: ${JSON.stringify(r.cart)} seen=${JSON.stringify(seen)}`);
  assert.equal(Number(line.quantity) || 1, 2, `want qty 2 packs, got ${JSON.stringify(line)}`);
  assert.ok(seen.some((s) => /12 x Tortilla Comal/i.test(s)), "alias must map docenas before say()");
  // Fecha STT is either dropped as avail (tendrás…?) or rewritten before say — never invent dates
  assert.ok(!replies.some((r) => /enviar fechas|fecha/i.test(r)), `must not invent dates: ${JSON.stringify(replies)}`);
});

test("angelica1: una docena still qty 1 (luis1 regression)", async () => {
  const TOR = "sq-tortillas-12-x-tortilla-comal-handmade-VGID3H";
  const run = async (t: string) => {
    const s = applySharedAliases(t, "phone");
    const acts: any[] = [];
    if (/12 x Tortilla Comal/i.test(s)) acts.push({ type: "add_item", itemId: TOR, quantity: 12, modifiers: [], readback: "12" }); // model inflated
    return { actions: acts, reply: "¿Algo más?" };
  };
  const r: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, text: "y una docena de tortilla.", language: "es" },
  ] as any, run as any);
  const line = r.cart.find((l: any) => /tortillas?-12|12-x-tortilla|tortilla-comal/i.test(String(l.itemId)));
  assert.ok(line, JSON.stringify(r.cart));
  assert.equal(Number(line.quantity) || 1, 1, `una docena must stay qty 1: ${JSON.stringify(line)}`);
});
