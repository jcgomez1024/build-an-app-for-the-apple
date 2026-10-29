// gloria1 (CA8ce34225302743d0d79ef572771c8041 ~11:59 AM ET Oct 29): Spanish pickup, staff answered, ~3.5 min.
// Correct: 3 QD DELUXE Preparada (1 carnitas, 1 bistec, 1 al pastor "alpas"); 3 street tacos (2 deshebrada — one with
// queso inside — + 1 al pastor); 1 Dips Guacamole Dip con Chips; salsa verde ("¿Quieres pura verde?" sí); PICKUP; name Gloria.
// Live miss: 6 QD deluxe (5 carnitas + 1 bistec, no pastor) — opening "tres quesadillas doradas" re-counted per meat;
// 3 deshebrada + 1 pastor tacos (no queso); no guacamole dip / salsa verde; REGULAR Dorada locked from staff "Sí, dime."
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T11:59:00-04:00";
const { shadowOrderFromTurns, staffPick } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA8ce342-turns.json", import.meta.url), "utf8"));
const REG = "sq-qd-quesadilla-dorada-qd-regular-dorada", DLX = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const TACO = "sq-taco-TAR7L5", DIPS = "sq-dips-MAIPCN";
const QD_ASK = "(QD) Quesadilla Dorada: ¿REGULAR Dorada o DELUXE Preparada?";
const MEAT: Record<string, string> = { carnitas: "Carnitas / Pulled Pork", bistec: "Bistec / Steak", pastor: "Alpastor / Roasted Pork", deshebrada: "Deshebrada / Shredded Beef with Potatoes" };
const N: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3 };
/** Stub with the live failure modes: a count before "QD" multiplies the first meat; every meat mention rings again;
 *  "alpas" unknown; tacos wait for the missing meat; guacamole / salsa verde never rung. */
function stubElvi() {
  let taco: { n: number; have: Record<string, number> } | null = null;
  return async (text: string) => {
    const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    if (/recoger/.test(t)) return { reply: QD_ASK, actions: [] }; // live: the opening pickup turn got the QD style question
    if (/\bqd\b|quesadillas? doradas?/.test(t) && !/regular|deluxe|preparad/.test(t) && !/carnitas|bistec|pastor/.test(t)) return { reply: QD_ASK, actions: [] };
    if (/\bregular dorada\b/.test(t) && !/carnitas|bistec|pastor/.test(t)) return { reply: "REGULAR Dorada: ¿Qué carne quieres?", actions: [] };
    if (/carnitas|bistec|\bal ?pastor/.test(t) && !/taco/.test(t)) {
      const deluxe = /deluxe|preparad/.test(t);
      const lead = N[(t.match(/\b(una|dos|tres)\s+(?:qd|quesadillas?)\b/) || [])[1]] || 0;
      const acts = [...t.matchAll(/carnitas|bistec|\bal ?pastor/g)].map((m, i) => ({ type: "add_item", itemId: deluxe ? DLX : REG,
        quantity: i === 0 && lead ? lead : 1, modifiers: [{ step: "(QD) Style", option: deluxe ? "(QD) DELUXE Preparada" : "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: MEAT[m[0].replace(/^al ?/, "")] }] }));
      return { reply: "Quesadilla Dorada. ¿Algo más?", actions: acts };
    }
    if (/tacos?/.test(t) && /deshebrada/.test(t)) { taco = { n: N[(t.match(/\b(una|dos|tres)\s+tacos/) || [])[1]] || 3, have: { deshebrada: 2 } }; return { reply: "Taco: ya tengo 2 deshebrada. ¿Los otros 1 tacos de qué carne?", actions: [] }; }
    if (taco && /pastor/.test(t)) { const acts = [{ type: "add_item", itemId: TACO, quantity: 2, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: MEAT.deshebrada }] },
      { type: "add_item", itemId: TACO, quantity: 1, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: MEAT.pastor }] }]; taco = null;
      return { reply: "3 tacos taqueros: 2 deshebrada, 1 pastor. ¿Algo más?", actions: acts }; }
    return { reply: taco ? "Perdón, no te entendí. Taco: ya tengo 2 deshebrada. ¿Los otros 1 tacos de qué carne?" : "¿Algo más?", actions: [] };
  };
}

test("gloria1: staff 'Sí, dime.' is not a REGULAR/DELUXE pick", () => {
  assert.equal(staffPick(["REGULAR Dorada", "DELUXE Preparada"], "Sí, dime."), null);
});

test("gloria1: name Gloria", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Gloria");
});

test("gloria1: 3 QD deluxe (carnitas/bistec/pastor) + 3 street tacos (2 deshebrada, 1 w/ queso; 1 pastor) + guac dip + verde; PICKUP", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubElvi() as any);
  const lines = r.cart.map((l: any) => ({ id: String(l.itemId), q: Number(l.quantity) || 1, mods: (l.modifiers || []).map((m: any) => String(m.option)) }));
  const dump = JSON.stringify(lines);
  const sum = (f: (l: any) => boolean) => lines.filter(f).reduce((n: number, l: any) => n + l.q, 0);
  const has = (l: any, re: RegExp) => l.mods.some((o: string) => re.test(o));
  assert.equal(sum((l) => /quesadilla-dorada/.test(l.id)), 3, "3 QD total: " + dump);
  assert.equal(sum((l) => l.id === REG || has(l, /REGULAR Dorada/)), 0, "no REGULAR: " + dump);
  for (const m of [/Carnitas/, /Bistec/, /Alpastor/]) assert.equal(sum((l) => l.id === DLX && has(l, m)), 1, `QD deluxe ${m}: ` + dump);
  assert.equal(sum((l) => l.id === TACO), 3, "3 tacos: " + dump);
  assert.equal(sum((l) => l.id === TACO && has(l, /Deshebrada/)), 2, "2 deshebrada: " + dump);
  assert.equal(sum((l) => l.id === TACO && has(l, /Deshebrada/) && has(l, /Queso/)), 1, "1 deshebrada with queso: " + dump);
  assert.equal(sum((l) => l.id === TACO && has(l, /Alpastor/)), 1, "1 pastor taco: " + dump);
  assert.ok(lines.filter((l: any) => l.id === TACO).every((l: any) => has(l, /TST/)), "street tacos: " + dump);
  assert.equal(sum((l) => l.id === DIPS && has(l, /Guacamole Dip con Chips/)), 1, "guacamole dip con chips: " + dump);
  const food = lines.filter((l: any) => l.id === DLX || l.id === TACO);
  assert.ok(food.every((l: any) => has(l, /Medium Salsa Verde/) && !has(l, /Mild Salsa Asada/)), "salsa verde: " + dump);
  assert.equal(r.fulfillment, "PICKUP", "pickup: " + dump);
});
