// ca35be80 (CA35be8076ca9391881fc79d0660f241df ~5:06 PM ET Oct 28): desk Spanish pickup, Sonia.
// Auditor/Square vyRGE4w… $51.77: 4 TST tripa (bien doraditas) + 2 TST chorizo + 4 TST lengua
// + 2 TST bistec/carne asada + 2 horchata 32oz. Name Sonia OK.
// Live miss: 4 tripa dropped (meat prompt omitted tripa; tripita/taquitos not listed); lengua qty 2≠4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-28T17:06:00-04:00";
const { shadowOrderFromTurns, rewriteCallerText, listedMeats } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA35be80-turns.json", import.meta.url), "utf8"));
const TACO = "sq-taco-TAR7L5";
const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";

const meatOf = (l: any) => (l.modifiers || []).find((m: any) => /Carnes|Meats/i.test(String(m.step)))?.option || "";
const isTst = (l: any) => (l.modifiers || []).some((m: any) => /\(TST\)|Taquera|Street/i.test(String(m.option)));
const meatQty = (cart: any[], re: RegExp) => cart
  .filter((l: any) => /taco/i.test(String(l.itemId)) && re.test(meatOf(l)))
  .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);

/** Stub: reproduces live wrongs — tripita meat prompt loop (no add); lengua qty 2; chorizo/bistec/horchata OK. */
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/tripita|tripa/.test(t)) {
    // live: tripa not in short meat list → re-ask, never add
    return { reply: "¿Bistec, Cabeza, Carnitas o Chorizo?", actions: [] };
  }
  if (/lengua/.test(t)) {
    return {
      reply: "2 lengua. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 2,
        modifiers: [
          { step: "(A) Tortilla Options", option: "(TST) Tortilla Taquera / Street Taco" },
          { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue (+$0.50)" },
        ],
        readback: "2 TST lengua",
      }],
    };
  }
  if (/chorizo/.test(t)) {
    return {
      reply: "2 chorizo. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 2,
        modifiers: [
          { step: "(A) Tortilla Options", option: "(TST) Tortilla Taquera / Street Taco" },
          { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" },
        ],
        readback: "2 TST chorizo",
      }],
    };
  }
  if (/carne asada|bistec|asada/.test(t)) {
    return {
      reply: "2 bistec. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TACO, quantity: 2,
        modifiers: [
          { step: "(A) Tortilla Options", option: "(TST) Tortilla Taquera / Street Taco" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "2 TST bistec",
      }],
    };
  }
  if (/horchata/.test(t)) {
    return {
      reply: "2 horchata. ¿Algo más?",
      actions: [{ type: "add_item", itemId: HORCH, quantity: 2, modifiers: [], readback: "2 horchata" }],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("ca35be80: tripita/taquitos rewrite → listedMeats tripa×4", () => {
  const rw = rewriteCallerText("Necesito cuatro taquitos de de tripita, pero que esté bien doradita.");
  assert.match(rw, /\btripa\b/i, "tripita→tripa: " + rw);
  assert.match(rw, /\btacos\b/i, "taquitos→tacos: " + rw);
  assert.ok(!/\btripita\b/i.test(rw), "no tripita left: " + rw);
  const meats = listedMeats(rw);
  assert.ok(meats.some((m) => m.meat === "tripa" && m.qty === 4), "listedMeats tripa qty4: " + JSON.stringify(meats));
});

test("ca35be80: name Sonia", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.equal(info?.name, "Sonia");
});

test("ca35be80: 4 tripa + 2 chorizo + 4 lengua + 2 bistec + 2 horchata", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const dump = JSON.stringify(r.cart.map((l: any) => ({
    id: String(l.itemId).slice(0, 36), q: l.quantity, meat: meatOf(l), tst: isTst(l), notes: l.elviNotes,
  })));

  assert.equal(meatQty(r.cart, /tripa/i), 4, "4 TST tripa (not dropped): " + dump);
  assert.equal(meatQty(r.cart, /chorizo/i), 2, "2 TST chorizo: " + dump);
  assert.equal(meatQty(r.cart, /lengua/i), 4, "4 TST lengua (not 2): " + dump);
  assert.equal(meatQty(r.cart, /bistec|steak/i), 2, "2 TST bistec: " + dump);

  const tacos = r.cart.filter((l: any) => /taco/i.test(String(l.itemId)));
  assert.ok(tacos.every(isTst), "all street/taquera: " + dump);

  const tripa = tacos.find((l: any) => /tripa/i.test(meatOf(l)));
  assert.ok(tripa && (tripa.elviNotes || []).some((n: string) => /dorad/i.test(n)),
    "tripa bien doradita note: " + dump);

  const horch = r.cart.filter((l: any) => /horchata/i.test(String(l.itemId)));
  assert.equal(horch.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 2, "2 horchata: " + dump);

  assert.equal(r.fulfillment, "PICKUP", "pickup: " + dump);
  assert.ok(!r.cart.some((l: any) => /gordita|quesadilla|burrito|sopes/i.test(String(l.itemId))),
    "no phantoms: " + dump);
});
