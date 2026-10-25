// francisco1 (CA69876ba9cd6db0b8d2e49e69f71f6a4d ~6:08 PM ET Oct 25): desk Spanish pickup.
// Auditor cart: 2 QHR (pastor+bistec) + 1 TCO pastor + 1 chimi chorizo+arroz+frijol+queso fresco
// + 1 burrito chico chorizo + 1 sopesaso bistec + 1 TST bistec + 2 horchata chicas.
// Name: Francisco, pickupOnly (sería nombre de — not caller identity).
// Live miss: 2× TST pastor; dual chimi; burro→2 Sope Elvis; horchata qty 1; no order_name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T18:08:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo, thirdPersonName } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA69876b-turns.json", import.meta.url), "utf8"));

const Q = "sq-quesadilla-HLT6CR";
const TACO = "sq-taco-TAR7L5";
const CHIMI = "sq-chimichanga-RVGPKQ";
const BUR = "sq-burrito-TGWBEN";
const SOPE = "sq-sopesaso-elvis";
const HORCH = "sq-drink-agua-fresca-horchata-32oz";

test("francisco1: sería nombre de Francisco → pickupOnly / thirdPerson", () => {
  assert.equal(thirdPersonName("Ah, sería nombre de Francisco."), "Francisco");
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "nameFromTranscriptInfo");
  assert.equal(info!.name, "Francisco");
  assert.equal(info!.thirdPerson, true, "pickupOnly / thirdPerson");
});

/** Reproduce live wrongs so end-rebuild must win. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/taco/.test(t) && /comal/.test(t) && /pastor/.test(t))
    return {
      reply: "Taco: taquero, pastor",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 1,
        modifiers: [
          { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" },
          { step: "(B) T Carnes / Meats Opciones", option: "Alpastor / Roasted Pork" },
        ],
        readback: "taco taquero",
      }],
    };
  if (/chimichanga/.test(t) && /pollo/.test(t))
    return {
      reply: "Chimichanga: chico, pollo",
      actions: [{
        type: "add_item", itemId: CHIMI, quantity: 1,
        modifiers: [
          { step: "(A) Chimichanga Size", option: "Elvis '10" },
          { step: "(C) Chimichanga Carne Options", option: "Pollo / Chicken" },
        ],
        readback: "chimi pollo",
      }],
    };
  if (/^\W*(?:ah[,.]?\s*)?de\s+chorizo\b/iu.test(text) || (/chorizo/.test(t) && !/burro|burrito|taco|quesad|sope|chimichanga/.test(t)))
    return {
      reply: "Chimichanga: chico, chorizo",
      actions: [{
        type: "add_item", itemId: CHIMI, quantity: 1,
        modifiers: [
          { step: "(A) Chimichanga Size", option: "Elvis '10" },
          { step: "(C) Chimichanga Carne Options", option: "Chorizo / Mexican Sausage" },
          { step: "(C) Chimichanga Carne Options", option: "Pollo / Chicken" },
          { step: "(E) Chimichanga Topped", option: "Crema / Sour Cream" },
        ],
        readback: "chimi chorizo pollo crema",
      }],
    };
  if (/burro|burrito/.test(t) && /chorizo/.test(t))
    return {
      reply: "Sopesaso",
      actions: [{
        type: "add_item", itemId: SOPE, quantity: 2,
        modifiers: [
          { step: "(A) Size", option: "Sope Elvis" },
          { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" },
        ],
        readback: "sopes chicos",
      }],
    };
  if (/quesadilla/.test(t) && /pastor|harina/.test(t))
    return {
      reply: "QHR pastor",
      actions: [{
        type: "add_item", itemId: Q, quantity: 1,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" },
          { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" },
        ],
        readback: "qhr pastor",
      }],
    };
  if (/bistec/.test(t) && /más|mas|una más/.test(t))
    return {
      reply: "QHR bistec",
      actions: [{
        type: "add_item", itemId: Q, quantity: 1,
        modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "qhr bistec",
      }],
    };
  if (/sopesa/.test(t) && /bistec/.test(t))
    return {
      reply: "sopesaso",
      actions: [{
        type: "add_item", itemId: SOPE, quantity: 1,
        modifiers: [
          { step: "(A) Size", option: "Sope Elvis" },
          { step: "(A) Elvis Carne / Meat Options", option: "Bistec / Steak" },
        ],
        readback: "sopesaso bistec",
      }],
    };
  if (/taco/.test(t) && /taquero/.test(t) && /bistec/.test(t))
    return {
      reply: "TST bistec",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 1,
        modifiers: [
          { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" },
          { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" },
        ],
        readback: "taco taquero",
      }],
    };
  if (/horchata/.test(t))
    return {
      reply: "horchata",
      actions: [{
        type: "add_item", itemId: HORCH, quantity: 1, modifiers: [], readback: "horchata",
      }],
    };
  return { reply: "¿Algo más?", actions: [] as any[] };
};

test("francisco1: cart matches Auditor (5 fixes + OK lines)", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
  const dump = JSON.stringify(r.cart.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l), rb: l.readback, notes: l.elviNotes, sz: l.posSize })));

  const qhr = r.cart.filter((l: any) => l.itemId === Q);
  assert.equal(qhr.length, 2, "2 QHR lines: " + dump);
  assert.ok(qhr.some((l: any) => /Alpastor|Pastor/i.test(opts(l))), "QHR pastor: " + dump);
  assert.ok(qhr.some((l: any) => /Bistec/i.test(opts(l))), "QHR bistec: " + dump);
  assert.ok(qhr.every((l: any) => /QHR|Harina|Flour/i.test(opts(l))), "flour: " + dump);

  const tacos = r.cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  const tcoPastor = tacos.filter((l: any) => /TCO|Comal|Homemade/i.test(opts(l)) && /Alpastor|Pastor/i.test(opts(l)));
  const tstPastor = tacos.filter((l: any) => /TST|Taquero|Street/i.test(opts(l)) && /Alpastor|Pastor/i.test(opts(l)));
  const tstBistec = tacos.filter((l: any) => /TST|Taquero|Street/i.test(opts(l)) && /Bistec/i.test(opts(l)));
  assert.equal(tcoPastor.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, "1 TCO pastor: " + dump);
  assert.equal(tstPastor.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 0, "no TST pastor: " + dump);
  assert.equal(tstBistec.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, "1 TST bistec: " + dump);

  const chimis = r.cart.filter((l: any) => /chimichanga/i.test(String(l.itemId)));
  assert.equal(chimis.length, 1, "exactly 1 chimi: " + dump);
  assert.equal(Number(chimis[0].quantity), 1, "chimi qty 1: " + dump);
  assert.ok(/Chorizo/i.test(opts(chimis[0])), "chimi chorizo: " + dump);
  assert.ok(!/Pollo|Chicken/i.test(opts(chimis[0])), "no pollo on chimi: " + dump);
  assert.ok(/Arroz|Rice/i.test(opts(chimis[0])), "arroz: " + dump);
  assert.ok(/Frijol|Bean/i.test(opts(chimis[0])), "frijol: " + dump);
  assert.ok(/Queso Fresco/i.test(opts(chimis[0])), "queso fresco: " + dump);
  assert.ok(!/Crema|Sour Cream/i.test(opts(chimis[0])), "no crema on chimi: " + dump);

  const burs = r.cart.filter((l: any) => /burrito/i.test(String(l.itemId)));
  assert.equal(burs.length, 1, "1 burrito: " + dump);
  assert.ok(/Chorizo/i.test(opts(burs[0])), "burrito chorizo: " + dump);
  assert.ok(/Regular/i.test(opts(burs[0])), "burrito chico/regular: " + dump);

  const sopes = r.cart.filter((l: any) => /sopesaso|sope/i.test(String(l.itemId)));
  assert.equal(sopes.length, 1, "1 sopesaso only (not burro→sope): " + dump);
  assert.equal(Number(sopes[0].quantity), 1, "sopesaso qty 1: " + dump);
  assert.ok(/Bistec/i.test(opts(sopes[0])), "sopesaso bistec: " + dump);
  assert.ok(!/Chorizo/i.test(opts(sopes[0])), "no sope chorizo from burro: " + dump);

  const drinks = r.cart.filter((l: any) => /horchata/i.test(String(l.itemId)));
  assert.equal(drinks.length, 1, "1 horchata line: " + dump);
  assert.equal(Number(drinks[0].quantity), 2, "horchata qty 2: " + dump);
  assert.ok(drinks[0].posSize === "small" || (drinks[0].elviNotes || []).includes("chica"), "horchata chica: " + dump);
});
