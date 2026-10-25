// gerardo1 (CAdf3a048ec36223b28cb804827fba5965 ~6:50 PM ET Oct 25): desk Spanish delivery.
// Auditor: 1 large lengua burrito + guacamole; 1 QD DELUXE preparada bistec; 2× Mild Salsa Asada 4oz;
// 1 Solo Chips/totopos; $5 delivery fee; name Gerardo (not Vale).
// Live miss: 2nd burrito; phantom Chilaquiles; QD REGULAR; missed salsas+chips; fee null; Vale from "Vale, a ti es".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T18:50:00-04:00";
const { shadowOrderFromTurns, DORADA_DELUXE_ID, DORADA_REG_ID, EXTRAS_ID, DIPS_ID } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo, nameFromAnswer, nameFromStaffAsk, nameFromStaffVocative } = await import("../../src/order-name.ts");
const { detectAddress, detectFulfillment } = await import("../../src/delivery.ts");
const { provisionalDeliveryFeeCents } = await import("../../src/delivery-zone.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAdf3a04-turns.json", import.meta.url), "utf8"));
const BUR = "sq-burrito-TGWBEN";
const CHIL = "sq-chilaquiles-con-huevo-YWKBQV";

/** Reproduce live wrongs: 2 burritos, QD REG, phantom chilaquiles, no salsa/chips. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/burrito|lengua|guacamole|aguacate/.test(t)) {
    return {
      reply: "Burrito. ¿Algo más?",
      actions: [
        {
          type: "add_item", itemId: BUR, quantity: 1,
          modifiers: [
            { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" },
            { step: "(B) Burrito Carne Options", option: "Lengua / Beef Tongue (+$1.00)" },
            { step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" },
          ],
        },
        {
          type: "add_item", itemId: BUR, quantity: 1,
          modifiers: [
            { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" },
            { step: "(B) Burrito Carne Options", option: "Lengua / Beef Tongue (+$1.00)" },
            { step: "(C) Burrito Options", option: "Guacamole Dip (+$2.00)" },
            { step: "(E) DELUXE Options", option: "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$0.75)" },
          ],
        },
      ],
    };
  }
  if (/dorad|quesadilla|bistec|preparad|aceite/.test(t)) {
    return {
      reply: "Quesadilla dorada. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: DORADA_REG_ID, quantity: 1,
        modifiers: [
          { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
      }],
    };
  }
  if (/chilaquil|liberia|huevo/.test(t)) {
    return {
      reply: "Chilaquiles. ¿Algo más?",
      actions: [{ type: "add_item", itemId: CHIL, quantity: 1, modifiers: [] }],
    };
  }
  return { reply: "", actions: [] };
};

test("gerardo1: Vale is closing junk — never order name; Gerardo from ask/vocative", () => {
  assert.equal(nameFromAnswer("Vale"), null);
  assert.equal(nameFromAnswer("Vale, a ti es"), null);
  assert.equal(nameFromAnswer("Tú digo Gerardo. Ajá."), "Gerardo");
  assert.equal(nameFromAnswer("te digo Gerardo"), "Gerardo");
  assert.equal(nameFromStaffAsk(turns as any), "Gerardo");
  const voc = nameFromStaffVocative(turns as any);
  assert.ok(voc && /^Gerardo$/i.test(voc), "vocative Gerardo not Vale: " + voc);
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.match(info!.name, /^Gerardo$/i);
  assert.notEqual(info!.name.toLowerCase(), "vale");
});

test("gerardo1: Fairground 85 address + provisional $5 fee", () => {
  const a = detectAddress(turns as any);
  assert.ok(a.address, "address");
  assert.match(a.address!.street, /85.*Fairground|Fairground.*85/i);
  assert.equal(detectFulfillment(turns as any).fulfillment, "DELIVERY");
  assert.equal(provisionalDeliveryFeeCents(null, true), 500);
});

test("gerardo1: 1 lengua burrito+guac, QD DELUXE, 2 salsa 4oz, solo chips; no chilaquiles; DELIVERY", async () => {
  const r = await shadowOrderFromTurns(turns as any, stubLiveMiss);
  const ids = r.cart.map((l: any) => `${l.quantity}×${l.itemId}`);
  assert.equal(r.fulfillment, "DELIVERY", JSON.stringify({ fulfillment: r.fulfillment, address: r.address }));
  assert.ok(r.address && /fairground/i.test(String(r.address)), "address on shadow: " + r.address);

  const burs = r.cart.filter((l: any) => /burrito/i.test(l.itemId));
  assert.equal(burs.reduce((a: number, l: any) => a + (l.quantity || 1), 0), 1, "one burrito: " + ids.join(","));
  const b = burs[0];
  assert.ok((b.modifiers || []).some((m: any) => /grande/i.test(String(m.option))), "grande");
  assert.ok((b.modifiers || []).some((m: any) => /lengua/i.test(String(m.option))), "lengua");
  assert.ok((b.modifiers || []).some((m: any) => /guacamole/i.test(String(m.option))), "guacamole");

  const qds = r.cart.filter((l: any) => l.itemId === DORADA_DELUXE_ID || l.itemId === DORADA_REG_ID);
  assert.equal(qds.length, 1, "one QD: " + ids.join(","));
  assert.equal(qds[0].itemId, DORADA_DELUXE_ID, "DELUXE not REGULAR");
  assert.ok((qds[0].modifiers || []).some((m: any) => /bistec|steak/i.test(String(m.option))), "bistec");

  const salsa = r.cart.filter((l: any) => l.itemId === EXTRAS_ID);
  assert.ok(salsa.some((l: any) => (l.quantity || 1) >= 2 && (l.modifiers || []).some((m: any) => /Mild Salsa Asada 4oz/i.test(String(m.option)))),
    "2× Mild Salsa Asada 4oz: " + JSON.stringify(salsa));

  assert.ok(r.cart.some((l: any) => l.itemId === DIPS_ID && (l.modifiers || []).some((m: any) => /SOLO\s*CHIPS/i.test(String(m.option)))),
    "Solo Chips: " + ids.join(","));
  assert.ok(!r.cart.some((l: any) => /chilaquiles/i.test(String(l.itemId))), "no phantom chilaquiles");
});
