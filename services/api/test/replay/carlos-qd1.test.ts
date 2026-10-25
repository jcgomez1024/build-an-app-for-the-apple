// carlos-qd1 (CAfc6b32 ~6:01 PM ET Oct 25): desk Spanish pickup.
// Square $18.75 ticket Carlos =
//   3× Quesadilla Dorada DELUXE Preparada with picadillo.
// Live miss: meatless 3× DELUXE + 3× REGULAR picadillo + invented Mild Salsa Asada.
// Root: split "¿Tendrá" + "quesadillas de aceite?" avail left pending REGULAR;
// "preparadas" made a separate deluxe line without meat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T18:01:00-04:00";
const { shadowOrderFromTurns, DORADA_REG_ID, DORADA_DELUXE_ID } = await import("../../src/call-scoring.ts");
const { nameFromTranscript } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CAfc6b32-turns.json", import.meta.url), "utf8"));

test("carlos-qd1: name is Carlos", () => {
  const n = nameFromTranscript(turns as any);
  assert.ok(n && /^carlos$/i.test(n), "name Carlos: " + n);
});

/** Reproduce live wrongs: avail aceite → pending REGULAR; preparadas → meatless DELUXE twin + salsa. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/tendr|aceite|dorad|qd regular/.test(t) && !/picadillo|preparad|tres|pone|me pone/.test(t))
    return { reply: "REGULAR Dorada: ¿Qué carne quieres?", actions: [] as any[] };
  if (/me pone tres|tres orden|tres quesad/.test(t) && !/picadillo/.test(t))
    return { reply: "Quesadilla: ¿Comal, Harina o Taquera?", actions: [] as any[] };
  if (/picadillo/.test(t))
    return { reply: "Quesadilla: ¿Comal…?", actions: [] as any[] };
  if (/preparad/.test(t))
    return {
      reply: "ok",
      actions: [{
        type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 3,
        modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }],
        readback: "qd dlx",
      }],
    };
  if (/carlos|much[ií]simas|s[ií] est[aá] bien|quesadilla comal/.test(t))
    return {
      reply: "ok",
      actions: [{
        type: "add_item", itemId: DORADA_REG_ID, quantity: 3,
        modifiers: [
          { step: "(B) Q Carnes / Meats", option: "Picadillo / Ground Beef with Potatoes" },
          { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" },
        ],
        readback: "qd reg",
      }],
    };
  return { reply: "¿Algo más?", actions: [] as any[] };
};

test("carlos-qd1: one line 3× QD DELUXE picadillo; no REGULAR twin; no Mild Salsa Asada", async () => {
  const seen: string[] = [];
  const run = async (text: string) => { seen.push(text); return stubLiveMiss(text); };
  const r: any = await shadowOrderFromTurns(turns as any, run as any);
  const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
  const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option))
    .filter((o: string) => /Picadillo|Bistec|Prensado|Duro|Tripa|Pastor|Chorizo/i.test(o) && !/salsa/i.test(o));

  const qd = r.cart.filter((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
  const dump = JSON.stringify(qd.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l) })));

  assert.equal(qd.length, 1, "exactly one QD line: " + dump);
  assert.equal(qd[0].itemId, DORADA_DELUXE_ID, "DELUXE id: " + dump);
  assert.equal(Number(qd[0].quantity), 3, "qty 3: " + dump);
  assert.ok(/DELUXE Preparada/i.test(opts(qd[0])), "DELUXE style: " + dump);
  assert.ok(meatOf(qd[0]).some((m: string) => /Picadillo/i.test(m)), "picadillo meat: " + dump);
  assert.ok(!/REGULAR Dorada/i.test(opts(qd[0])), "not REGULAR: " + dump);
  assert.ok(!r.cart.some((l: any) => l.itemId === DORADA_REG_ID), "no REGULAR twin: " + dump);
  assert.ok(!r.cart.some((l: any) => (l.modifiers || []).some((m: any) => /Mild Salsa Asada/i.test(String(m.option)))),
    "no invented Mild Salsa Asada: " + dump);

  // Availability ask must not be sent as an order that opens REGULAR
  assert.ok(!seen.some((s) => /^\W*¿?tendr/i.test(s) && /aceite/i.test(s) && !/pone|picadillo|preparad/i.test(s)),
    "avail aceite must not be ordered: " + seen.join(" | "));
});
