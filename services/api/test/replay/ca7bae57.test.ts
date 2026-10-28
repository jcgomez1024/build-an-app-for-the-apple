// ca7bae57 (CA7bae57ece84f74a59d4b4d34f78fcc45 ~4:38 PM ET Oct 28): desk Spanish group pickup.
// Square: Ronal = QD deluxe preparada bistec + quesabirrias; Kevin = quesabirrias + esquite 16oz +
// burrito grande bistec con todo; Pedro = quesabirrias + burrito grande bistec.
// Live miss: 1 lb birria (meant quesabirrias); phantom gorditas; missed 3× QB + esquite + 2nd burrito;
// never split into 3 orders; only order_name Kevin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-28T16:38:00-04:00";
const { shadowOrderFromTurns, personSwitch, DORADA_DELUXE_ID } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo, thirdPersonName } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA7bae57-turns.json", import.meta.url), "utf8"));
const QD = DORADA_DELUXE_ID;
const QB = "sq-queso-birrias-qst-3-x-queso-birrias-taquera-street-con-consome-broth-VUBNR7";
const ESQ = "sq-esquite-elvis-esquite-16oz-SGPEZK";
const BUR = "sq-burrito-TGWBEN";
const BIRRIA_LB = "sq-birria-de-chivo-goat-birria-1-lb-of-birria-de-chivo-goat-con-consome-broth-y-tortillas-de-comal-NHFHDD";
const GD = "sq-gordita-M647RE";

const meatOf = (l: any) => (l.modifiers || []).find((m: any) => /Carnes|Meats|Carne/i.test(String(m.step)))?.option || "";
const isDeluxe = (l: any) => (l.modifiers || []).some((m: any) => /DELUXE|Preparada/i.test(String(m.option)));
const isGrande = (l: any) => (l.modifiers || []).some((m: any) => /Grande/i.test(String(m.option)));
const hasFill = (l: any) => {
  const opts = (l.modifiers || []).map((m: any) => String(m.option));
  return opts.some((o) => /Arroz|Rice/i.test(o)) && opts.some((o) => /Frijoles|Beans/i.test(o));
};
const personOf = (l: any) => String(l.person || "");

/** Stub: reproduces live wrongs — 1 lb birria + phantom gorditas + QD only + one burrito; no QB/esquite/split. */
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/birria/.test(t) && !/quesi|quesadilla de birria|queso birria/.test(t)) {
    return {
      reply: "Orden de birria. ¿Algo más?",
      actions: [{ type: "add_item", itemId: BIRRIA_LB, quantity: 1, modifiers: [], readback: "orden de birria" }],
    };
  }
  if (/quesadilla dorada|dorada preparada/.test(t)) {
    return {
      reply: "QD deluxe bistec. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: QD, quantity: 1,
        modifiers: [
          { step: "(QD) Style", option: "(QD) DELUXE Preparada" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "QD deluxe bistec",
      }],
    };
  }
  if (/gordita/.test(t)) {
    return {
      reply: "Gordita. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: GD, quantity: 1,
        modifiers: [
          { step: "(A) Gordita Options", option: "(GD) Gordita" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "gordita bistec",
      }],
    };
  }
  if (/burrito/.test(t)) {
    return {
      reply: "Burrito grande. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: BUR, quantity: 1,
        modifiers: [
          { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" },
          { step: "(B) Burrito Carne Options", option: "Bistec / Steak" },
        ],
        readback: "burrito grande bistec",
      }],
    };
  }
  // live: quesibirrias not mapped — kept treating as 1 lb / ignored
  if (/quesi[bv]irrias?|quesadillas?\s+de\s+birria|queso\s+birrias?/.test(t)) {
    return { reply: "¿Birria de libra? ¿Algo más?", actions: [] };
  }
  if (/esquite/.test(t)) {
    return { reply: "¿Mezquite? ¿Algo más?", actions: [] };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("ca7bae57: personSwitch a nombre de / sería nombre Ronald", () => {
  assert.equal(personSwitch("Eso sería nombre Ronald."), "Ronald");
  assert.equal(personSwitch("A nombre de Kevin, por favor."), "Kevin");
  assert.equal(personSwitch("En nombre de Pedro, por favor."), "Pedro");
  assert.equal(thirdPersonName("Eso sería nombre Ronald."), "Ronald");
});

test("ca7bae57: 3-way rebuild Ronald/Kevin/Pedro — QB not 1lb, no gorditas", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const dump = JSON.stringify(r.cart.map((l: any) => ({
    id: String(l.itemId).slice(0, 28), q: l.quantity, person: l.person, meat: meatOf(l),
  })));

  assert.ok(!r.cart.some((l: any) => /birria-de-chivo|1-lb|NHFHDD/i.test(String(l.itemId))),
    "no 1 lb birria (quesabirrias): " + dump);
  assert.ok(!r.cart.some((l: any) => /gordita/i.test(String(l.itemId))),
    "no phantom gorditas: " + dump);

  const ronald = r.cart.filter((l: any) => /ronald/i.test(personOf(l)));
  const kevin = r.cart.filter((l: any) => /kevin/i.test(personOf(l)));
  const pedro = r.cart.filter((l: any) => /pedro/i.test(personOf(l)));
  assert.ok(ronald.length >= 2, "Ronald lines: " + dump);
  assert.ok(kevin.length >= 3, "Kevin lines: " + dump);
  assert.ok(pedro.length >= 2, "Pedro lines: " + dump);

  // Ronald: QD deluxe bistec + QB
  assert.ok(ronald.some((l: any) => String(l.itemId) === QD && isDeluxe(l) && /bistec/i.test(meatOf(l))),
    "Ronald QD deluxe bistec: " + dump);
  assert.ok(ronald.some((l: any) => /queso-birrias|quesabirria/i.test(String(l.itemId)) || String(l.itemId) === QB),
    "Ronald QB: " + dump);

  // Kevin: QB + esquite + burrito grande bistec con todo
  assert.ok(kevin.some((l: any) => /queso-birrias|quesabirria/i.test(String(l.itemId)) || String(l.itemId) === QB),
    "Kevin QB: " + dump);
  assert.ok(kevin.some((l: any) => /esquite/i.test(String(l.itemId)) || String(l.itemId) === ESQ),
    "Kevin esquite: " + dump);
  assert.ok(kevin.some((l: any) => /burrito/i.test(String(l.itemId)) && isGrande(l) && /bistec/i.test(meatOf(l)) && hasFill(l)),
    "Kevin burrito grande con todo: " + dump);

  // Pedro: QB + burrito grande bistec (no fill required)
  assert.ok(pedro.some((l: any) => /queso-birrias|quesabirria/i.test(String(l.itemId)) || String(l.itemId) === QB),
    "Pedro QB: " + dump);
  assert.ok(pedro.some((l: any) => /burrito/i.test(String(l.itemId)) && isGrande(l) && /bistec/i.test(meatOf(l))),
    "Pedro burrito grande bistec: " + dump);

  const qbCount = r.cart.filter((l: any) => /queso-birrias|quesabirria/i.test(String(l.itemId)) || String(l.itemId) === QB)
    .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qbCount, 3, "3× Queso Birrias: " + dump);

  assert.equal(r.fulfillment, "PICKUP", "pickup: " + dump);
});
