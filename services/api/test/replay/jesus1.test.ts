// jesus1: CAdd6ef2c9ecd001befe64deaabd5bbbe8 — Sat Oct 24 ~2:23 PM ET
// 2× COMBO Gorditas (chorizo + carnitas, arroz y frijol) + 1 TCO carnitas solo/sin nada.
// Name: "¿Ves, Jesús, por favor?" / "Ves, Jesús" → Jesús (strip filler Ves).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromAnswer, nameFromStaffAsk, nameFromTranscript } from "../../src/order-name.ts";
import { prepMergedCallerTurns, shadowOrderFromTurns, kindOfItem } from "../../src/call-scoring.ts";
import { applySharedAliases } from "../../src/aliases.ts";

const COMBO = "sq-combo-gorditas-PSPNTZ";
const TACO = "sq-taco-TAR7L5";

test("jesus1: Ves filler never becomes a name; Jesús wins", () => {
  assert.equal(nameFromAnswer("¿Ves, Jesús, por favor?"), "Jesús");
  assert.equal(nameFromAnswer("Ves, Jesús, por favor"), "Jesús");
  assert.equal(nameFromAnswer("Ves Jesús"), "Jesús");
  assert.equal(nameFromAnswer("Jesús, por favor"), "Jesús");
  const turns = [
    { speaker: "staff" as const, text: "Ok, ¿a qué nombre sería la orden?" },
    { speaker: "caller" as const, text: "Ves, Jesús, por favor" },
    { speaker: "staff" as const, text: "Jesús, muy bien, Jesús, este, dame unos quince minutos, por favor." },
  ];
  assert.equal(nameFromStaffAsk(turns), "Jesús");
  assert.equal(nameFromTranscript(turns), "Jesús");
});

test("jesus1: combo de las gorditas rewrite + carnita→carnitas", () => {
  const m = [{ speaker: "caller", text: "dos órdenes del el combo de las gorditas" }];
  prepMergedCallerTurns(m as any);
  assert.match(m[0].text, /COMBO Gorditas/i);
  assert.match(applySharedAliases("carnita", "phone"), /carnitas/i);
});

test("jesus1: shadow — 2 COMBO Gorditas chorizo+carnitas arroz/frijol + TCO carnitas solo", async () => {
  const seen: string[] = [];
  const run = async (t: string) => {
    const s = applySharedAliases(t, "phone");
    seen.push(s);
    const acts: any[] = [];
    // Model under-orders: 1 combo no meats + wrong SOLO frijoles; misses 2nd combo
    if (/COMBO\s+Gorditas|combo.*gorditas/i.test(s) && !/taco/i.test(s)) {
      acts.push({
        type: "add_item", itemId: COMBO, quantity: 1, modifiers: [
          { step: "A", option: "(GD) 2 x Gorditas" },
          { step: "C", option: "1 x Arroz / Rice" },
          { step: "C", option: "1 x Frijoles Refritos / Refried Beans" },
          { step: "C", option: "SOLO Frijoles Refritos - Refried Beans" },
        ],
      });
    }
    if (/taco/i.test(s) && /carnitas/i.test(s)) {
      acts.push({
        type: "add_item", itemId: TACO, quantity: 1, modifiers: [
          { step: "A", option: "(TCO) Tortilla Comal / Homemade" },
          { step: "B", option: "Carnitas / Pulled Pork" },
          { step: "S", option: "Mild Salsa Asada" },
        ],
      });
    }
    return { reply: "¿Algo más?", actions: acts };
  };
  const turns = [
    { speaker: "caller", text: "quiero pedir dos órdenes del el combo de las gorditas", language: "es" },
    { speaker: "staff", text: "Claro, entonces, dos órdenes del combo de las gorditas, muy bien. En la primera, ¿qué te voy a poner?", language: "es" },
    { speaker: "caller", text: "Ajá. Um, sí, las dos bases iguales, una de chorizo y la otra de carnita, para las dos.", language: "es" },
    { speaker: "staff", text: "Ok, so en el combo vienen arroz y frijol, arroz o solamente frijoles. ¿Arroz y frijol?", language: "es" },
    { speaker: "caller", text: "Sí.", language: "es" },
    { speaker: "staff", text: "Muy bien, entonces tengo dos órdenes de combo gorditas, las dos órdenes van a ser de chorizo y carnitas y arroz y frijol llevan.", language: "es" },
    { speaker: "caller", text: "Sí, y llámanos, por favor, aparte un taco de carnitas.", language: "es" },
    { speaker: "staff", text: "Un taco de carnitas, claro, ¿del comal?", language: "es" },
    { speaker: "caller", text: "Ah, sí, por favor.", language: "es" },
    { speaker: "staff", text: "Muy bien, ¿algo más?", language: "es" },
    { speaker: "caller", text: "Así, y que esté solo, por favor, así sin nada. Sí, sería todo.", language: "es" },
    { speaker: "staff", text: "Ok, ¿a qué nombre sería la orden?", language: "es" },
    { speaker: "caller", text: "¿Ves, Jesús, por favor?", language: "es" },
    { speaker: "staff", text: "Jesús, muy bien, Jesús, dame unos quince minutos.", language: "es" },
  ].map((t, i) => ({ ...t, start: i, end: i + 1, speaker: t.speaker as "caller" | "staff" }));

  const r: any = await shadowOrderFromTurns(turns as any, run as any);
  const combos = r.cart.filter((l: any) => /combo.*gordita/i.test(l.itemId));
  const comboQty = combos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(comboQty, 2, `combo qty ${comboQty}: ${JSON.stringify(r.cart)}`);
  for (const c of combos) {
    const opts = (c.modifiers || []).map((m: any) => String(m.option)).join("; ");
    assert.match(opts, /chorizo/i, opts);
    assert.match(opts, /carnitas/i, opts);
    assert.match(opts, /arroz/i, opts);
    assert.match(opts, /frijol/i, opts);
    assert.doesNotMatch(opts, /SOLO\s+Frijoles/i, opts);
  }
  const tacos = r.cart.filter((l: any) => kindOfItem(l.itemId) === "taco");
  assert.ok(tacos.length >= 1, JSON.stringify(r.cart));
  const t0 = tacos[0];
  const to = (t0.modifiers || []).map((m: any) => String(m.option)).join("; ");
  assert.match(to, /comal|TCO|homemade/i, to);
  assert.match(to, /carnitas/i, to);
  // solo/sin nada → no salsa piled on
  assert.doesNotMatch(to, /Mild Salsa/i, to);
  assert.equal(nameFromTranscript(turns as any), "Jesús");
});

test("jesus1: invents TCO carnitas solo when model omits taco", async () => {
  const run = async (t: string) => {
    const s = applySharedAliases(t, "phone");
    const acts: any[] = [];
    if (/COMBO\s+Gorditas|combo.*gorditas/i.test(s) && !/taco/i.test(s)) {
      acts.push({
        type: "add_item", itemId: COMBO, quantity: 1, modifiers: [
          { step: "A", option: "(GD) 2 x Gorditas" },
          { step: "C", option: "1 x Arroz / Rice" },
          { step: "C", option: "1 x Frijoles Refritos / Refried Beans" },
        ],
      });
    }
    // deliberately never add taco
    return { reply: "¿Algo más?", actions: acts };
  };
  const turns = [
    { speaker: "caller", text: "quiero pedir dos órdenes del el combo de las gorditas", language: "es" },
    { speaker: "caller", text: "las dos bases iguales, una de chorizo y la otra de carnita, para las dos.", language: "es" },
    { speaker: "staff", text: "¿Arroz y frijol?", language: "es" },
    { speaker: "caller", text: "Sí.", language: "es" },
    { speaker: "caller", text: "Sí, y llámanos, por favor, aparte un taco de carnitas.", language: "es" },
    { speaker: "staff", text: "Un taco de carnitas, claro, ¿del comal?", language: "es" },
    { speaker: "caller", text: "Ah, sí, por favor.", language: "es" },
    { speaker: "caller", text: "Así, y que esté solo, por favor, así sin nada. Sí, sería todo.", language: "es" },
  ].map((t, i) => ({ ...t, start: i, end: i + 1, speaker: t.speaker as "caller" | "staff" }));
  const r: any = await shadowOrderFromTurns(turns as any, run as any);
  const tacos = r.cart.filter((l: any) => kindOfItem(l.itemId) === "taco");
  assert.equal(tacos.length, 1, JSON.stringify(r.cart));
  const to = (tacos[0].modifiers || []).map((m: any) => String(m.option)).join("; ");
  assert.match(to, /comal|TCO|homemade/i, to);
  assert.match(to, /carnitas/i, to);
  assert.doesNotMatch(to, /Mild Salsa/i, to);
});
