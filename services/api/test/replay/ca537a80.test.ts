// ca537a80 (CA537a8050d9870f83f1f5439728eb1e85 ~7:47 PM ET Oct 28): Omar pickup, staff answered.
// Correct: 2 QD DELUXE preparada (bistec + prensado) + 1 aguacate; PICKUP; name Omar.
// Live miss: EMPTY cart — aceite avail-dropped; meats→torta then phantom-drop; REGULAR/DELUXE loop
// on "Old man"/"What I said"; fulfillment null; Omar noOrder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-28T19:47:00-04:00";
const { shadowOrderFromTurns, DORADA_DELUXE_ID, rewriteCallerText } = await import("../../src/call-scoring.ts");
const { detectFulfillment } = await import("../../src/delivery.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA537a80-turns.json", import.meta.url), "utf8"));
const TOR = "sq-torta-4GNTTE";
const DIPS = "sq-dips-MAIPCN";

/** Stub: reproduces live wrongs — torta on meat pair; empty on style scraps; ignore aceite. */
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/torta|prensado.*bistec|bistec.*prensado/.test(t) && !/quesadilla|dorad|aceite|qd|deluxe|preparad/.test(t)) {
    return {
      reply: "Torta: chicharrón prensado y bistec, salsa asada. $5.25. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TOR, quantity: 1,
        modifiers: [
          { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" },
          { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
        ],
        readback: "torta prensado bistec",
      }],
    };
  }
  if (/regular dorada|deluxe preparada|quesadilla dorada/.test(t) && !/bistec|prensado|aguacate/.test(t)) {
    return { reply: "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?", actions: [] };
  }
  if (/old man|what i said|^old$|^man/.test(t)) {
    return { reply: "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?", actions: [] };
  }
  if (/aguacate|guacamole/.test(t)) {
    return { reply: "Muy bien. ¿Algo más?", actions: [] };
  }
  if (/quesadilla|aceite|dorad|preparad/.test(t)) {
    return { reply: "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?", actions: [] };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("ca537a80: aceite rewrite; Para la → preparadas", () => {
  assert.match(rewriteCallerText("sí, tiene quesadillas en aceite."), /quesadillas doradas de aceite/i);
  assert.match(rewriteCallerText("Para la."), /preparadas/i);
});

test("ca537a80: detectFulfillment PICKUP; name Omar", () => {
  assert.equal(detectFulfillment(turns as any).fulfillment, "PICKUP");
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Omar");
});

test("ca537a80: 2 QD deluxe (bistec+prensado) + aguacate; PICKUP; no torta; no style loop", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const dump = JSON.stringify(r.cart.map((l: any) => ({
    id: l.itemId, q: l.quantity, mods: (l.modifiers || []).map((m: any) => m.option),
  })));

  assert.equal(r.fulfillment, "PICKUP", "fulfillment: " + dump);
  assert.ok(!r.cart.some((l: any) => String(l.itemId) === TOR), "no torta: " + dump);

  const qd = r.cart.filter((l: any) => String(l.itemId) === DORADA_DELUXE_ID
    || /deluxe|zzav3l/i.test(String(l.itemId)));
  const qdQty = qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.ok(qdQty >= 2, "2 QD deluxe: " + dump);
  const qdMods = qd.flatMap((l: any) => (l.modifiers || []).map((m: any) => String(m.option)));
  assert.ok(qdMods.some((o: string) => /bistec|steak/i.test(o)), "bistec: " + dump);
  assert.ok(qdMods.some((o: string) => /prensado/i.test(o)), "prensado: " + dump);
  assert.ok(qdMods.some((o: string) => /deluxe|preparada/i.test(o)), "deluxe: " + dump);

  assert.ok(r.cart.some((l: any) => String(l.itemId) === DIPS
    || /guacamole|aguacate|dips/i.test(String(l.itemId) + " " + (l.modifiers || []).map((m: any) => m.option).join(" "))),
    "aguacate: " + dump);

  const styleAsks = (r.steps || []).filter((s: any) => /REGULAR Dorada|DELUXE Preparada/i.test(String(s.reply || "")));
  const bad = styleAsks.filter((s: any) => /old|what i said|man/i.test(String(s.heard || "")));
  assert.equal(bad.length, 0, "no QD style loop on name scraps: " + JSON.stringify(bad));
});
