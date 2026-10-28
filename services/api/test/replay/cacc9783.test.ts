// cacc9783 (CAcc978320157a80eb2571728057b28945 ~5:47 PM ET Oct 28): Tabby English pickup, staff answered.
// Square $37.25 / ticket Tary: 4 TCO steak + 1 QD deluxe steak (cheese+meat only; no lettuce/pico/crema)
// + 2 TCO chorizo + 2 Side Rice + 1 Side Beans. Name Tabby (caller×2; Auditor callers.json Tabby).
// Live miss: QD REGULAR + DELUXE APARTE + Melted Cheese-as-meat; phantom 2 chorizo Con Frijoles;
// missed 2 Side Rice; order_name "And" from staff filler "Okay, and" (vocative).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-28T17:47:00-04:00";
const { shadowOrderFromTurns, DORADA_DELUXE_ID, DORADA_REG_ID } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAcc9783-turns.json", import.meta.url), "utf8"));
const TACO = "sq-taco-TAR7L5";
const RICE = "sq-sides-arroz-rice-26S6E6";
const BEANS = "sq-sides-frijoles-beans-FK2O6W";

const meatOf = (l: any) => (l.modifiers || []).find((m: any) => /Carnes|Meats/i.test(String(m.step)) || /Bistec|Chorizo|Steak|Sausage|Melted|Queso/i.test(String(m.option)))?.option || "";
const isTco = (l: any) => (l.modifiers || []).some((m: any) => /\(TCO\)|Comal|Homemade/i.test(String(m.option)));
const hasAparte = (l: any) => (l.modifiers || []).some((m: any) => /APARTE/i.test(String(m.option)));
const hasFrijoles = (l: any) => (l.modifiers || []).some((m: any) => /Con Frijoles|With Beans/i.test(String(m.option)));
const qty = (cart: any[], pred: (l: any) => boolean) => cart.filter(pred).reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);

/** Stub: reproduces live wrongs — QD REG+APARTE+MeltedCheese-as-meat; phantom chorizo+frijoles; no rice. */
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/steak\s*tacos|four\s+steak|4\s+steak|cilantro/.test(t) && /taco|steak|corn|cilantro/.test(t) && !/chorizo|quesad|deluxe|rice|bean/.test(t)) {
    return {
      reply: "4 steak tacos. Anything else?",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 4,
        modifiers: [
          { step: "(A) Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" },
          { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" },
        ],
        readback: "4 TCO steak",
      }],
    };
  }
  if (/deluxe|fried\s+quesad|quesadilla/.test(t)) {
    // live wrong: REGULAR + APARTE + Melted Cheese as meat (no Bistec)
    return {
      reply: "1 fried quesadilla. Anything else?",
      actions: [{
        type: "add_item", itemId: DORADA_REG_ID, quantity: 1,
        modifiers: [
          { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
          { step: "(QD) Side", option: "DELUXE ***APARTE / EVERTHING ON SIDE*** (+$1.50)" },
          { step: "(B) Q Carnes / Meats", option: "Queso Derretido / Melted Cheese" },
        ],
        readback: "1 QD reg aparte melted cheese",
      }],
    };
  }
  if (/chorizo/.test(t)) {
    return {
      reply: "2 chorizo. Anything else?",
      actions: [
        {
          type: "add_item", itemId: TACO, quantity: 2,
          modifiers: [
            { step: "(A) Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" },
            { step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" },
          ],
          readback: "2 TCO chorizo",
        },
        // phantom second line
        {
          type: "add_item", itemId: TACO, quantity: 2,
          modifiers: [
            { step: "(A) Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" },
            { step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" },
            { step: "(C)", option: "**Con Frijoles / With Beans (+$0.50)" },
          ],
          readback: "2 TCO chorizo frijoles",
        },
      ],
    };
  }
  if (/side of beans|sides? of beans|frijoles/.test(t) && !/rice/.test(t)) {
    return {
      reply: "side beans. Anything else?",
      actions: [{ type: "add_item", itemId: BEANS, quantity: 1, modifiers: [], readback: "side beans" }],
    };
  }
  // live: rice never added
  if (/rice|arroz/.test(t)) return { reply: "Anything else?", actions: [] };
  return { reply: "Anything else?", actions: [] };
};

test("cacc9783: name And blocked; Tabby from Your name, please", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.equal(info.name, "Tabby", "name=" + JSON.stringify(info));
  assert.notEqual(info.name, "And");
  assert.ok(!/and/i.test(String(info.name || "")), "never And: " + JSON.stringify(info));
});

test("cacc9783: cart = 4 TCO steak + QD deluxe Bistec (no APARTE/Melted-as-meat) + 2 TCO chorizo (no frijoles) + rice×2 + beans×1", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const cart = r.cart || [];
  const summary = cart.map((l: any) => ({
    id: String(l.itemId).slice(0, 40), q: l.quantity, meat: meatOf(l),
    tco: isTco(l), aparte: hasAparte(l), frijoles: hasFrijoles(l), notes: l.elviNotes,
  }));

  assert.equal(qty(cart, (l) => /taco/i.test(String(l.itemId)) && /Bistec|Steak/i.test(meatOf(l))), 4,
    "4 TCO steak: " + JSON.stringify(summary));
  assert.ok(cart.filter((l: any) => /taco/i.test(String(l.itemId)) && /Bistec|Steak/i.test(meatOf(l))).every(isTco),
    "steak tacos TCO: " + JSON.stringify(summary));

  const qd = cart.filter((l: any) => /dorada|qd-|zzav3l|t5stuh/i.test(String(l.itemId)));
  assert.equal(qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, "1 QD: " + JSON.stringify(summary));
  assert.ok(qd.every((l: any) => l.itemId === DORADA_DELUXE_ID || /deluxe|zzav3l/i.test(String(l.itemId))),
    "QD deluxe SKU not REG: " + JSON.stringify(summary));
  assert.ok(qd.every((l: any) => /Bistec|Steak/i.test(meatOf(l))), "QD meat Bistec: " + JSON.stringify(summary));
  assert.ok(qd.every((l: any) => !/Melted|Queso Derretido/i.test(meatOf(l))), "Melted Cheese not meat: " + JSON.stringify(summary));
  assert.ok(qd.every((l: any) => !hasAparte(l)), "no APARTE: " + JSON.stringify(summary));
  assert.ok(qd.every((l: any) => (l.elviNotes || []).some((n: string) => /lechuga|lettuce/i.test(n))),
    "no-lettuce note: " + JSON.stringify(summary));

  assert.equal(qty(cart, (l) => /taco/i.test(String(l.itemId)) && /Chorizo/i.test(meatOf(l))), 2,
    "2 TCO chorizo only (no phantom frijoles line): " + JSON.stringify(summary));
  assert.ok(!cart.some((l: any) => /taco/i.test(String(l.itemId)) && hasFrijoles(l)),
    "no Con Frijoles on tacos: " + JSON.stringify(summary));

  assert.equal(qty(cart, (l) => /26S6E6|sides-arroz|rice/i.test(String(l.itemId))), 2,
    "2 side rice: " + JSON.stringify(summary));
  assert.equal(qty(cart, (l) => /FK2O6W|sides-frijoles|beans/i.test(String(l.itemId))), 1,
    "1 side beans: " + JSON.stringify(summary));

  assert.equal(r.fulfillment, "PICKUP", "PICKUP: " + JSON.stringify(r.fulfillment));
});
