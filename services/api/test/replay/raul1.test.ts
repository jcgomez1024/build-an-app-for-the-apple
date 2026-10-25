// raul1 (CA8debe0369d79b132c83a77710158c5b0 ~6:24 PM ET Oct 25): desk Spanish, returning caller.
// Auditor: 1 QD REGULAR bistec + 1 torta bistec + 1 horchata; PICKUP; name Raúl (not Dale/Saúl).
// Live miss: meatless QD; missed torta; bare horchata $0; DELIVERY; name Dale from "Dale, joven".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T18:24:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromAnswer, nameFromTranscriptInfo } = await import("../../src/order-name.ts");
const { detectFulfillment } = await import("../../src/delivery.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA8debe0-turns.json", import.meta.url), "utf8"));
const QD = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
const TOR = "sq-torta-4GNTTE";
const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
const BARE_HORCH = "sq-drink-agua-fresca-horchata-32oz";

test("raul1: Dale never a name; Saúl+domicilio → Saúl; staff Raúl wins", () => {
  assert.equal(nameFromAnswer("Dale"), null);
  assert.equal(nameFromAnswer("Dale, joven."), null);
  assert.equal(nameFromAnswer("Saúl Becerra, ¿no tiene servicio a domicilio?"), "Saúl Becerra");
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "name info");
  assert.match(info!.name, /^Ra[uú]l$/i);
  assert.notEqual(info!.name.toLowerCase(), "dale");
});

test("raul1: staff no delivery / driver out → PICKUP", () => {
  const f = detectFulfillment(turns as any);
  assert.equal(f.fulfillment, "PICKUP", JSON.stringify(f));
});

/** Reproduce live wrongs. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/quesadilla|aceite|qd/.test(t) && !/torta|horchata|bistec/.test(t)) {
    return {
      reply: "REGULAR Dorada: ¿Qué carne quieres?",
      actions: [{
        type: "add_item", itemId: QD, quantity: 1,
        modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }],
        readback: "quesadilla dorada regular",
      }],
    };
  }
  if (/^\W*de\s+bistec\b/iu.test(text) || (/bistec/.test(t) && !/torta|horchata/.test(t))) {
    return {
      reply: "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?",
      actions: [{
        type: "add_item", itemId: QD, quantity: 1,
        modifiers: [
          { step: "(QD) Style", option: "(QD) REGULAR Dorada" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "quesadilla dorada regular",
      }],
    };
  }
  if (/torta/.test(t) && /bistec/.test(t)) {
    // Live: reply claimed add but cart missed — return add_item (force path also covers miss)
    return {
      reply: "Torta: bistec, salsa asada. $4.75. ¿Algo más?",
      actions: [], // reproduce miss; end-rebuild / force must win
    };
  }
  if (/torta/.test(t)) {
    return { reply: "Torta: ¿Bistec, Cabeza, Carnitas o Chorizo?", actions: [] };
  }
  if (/horchata/.test(t)) {
    return {
      reply: "For drinks we have: Aguas Frescas…",
      actions: [{ type: "add_item", itemId: BARE_HORCH, quantity: 1, modifiers: [], readback: "horchata" }],
    };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("raul1: QD bistec + torta bistec + priced horchata; PICKUP; no meatless QD", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  assert.equal(r.fulfillment, "PICKUP", "fulfillment " + r.fulfillment);
  const qds = r.cart.filter((l: any) => /dorada|t5stuh/i.test(String(l.itemId)));
  assert.equal(qds.length, 1, "one QD: " + JSON.stringify(r.cart));
  assert.ok((qds[0].modifiers || []).some((m: any) => /Bistec/i.test(m.option)), "QD has bistec");
  const tortas = r.cart.filter((l: any) => /torta/i.test(String(l.itemId)));
  assert.equal(tortas.length, 1, "torta present");
  assert.ok((tortas[0].modifiers || []).some((m: any) => /Bistec/i.test(m.option)), "torta bistec");
  const horch = r.cart.filter((l: any) => /horchata/i.test(String(l.itemId)));
  assert.equal(horch.length, 1);
  assert.equal(horch[0].itemId, HORCH, "priced not bare $0 id");
});
