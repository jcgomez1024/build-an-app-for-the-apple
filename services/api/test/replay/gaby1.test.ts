// gaby1 (CA69ea0e): Sun Oct 25 ~12:37 ET desk Spanish pickup.
// Square dFLgwlP3… $82.75 Gaby = 2 SOLO Menudo + 1 CON PATA + 4 TCO duro+arroz
// + Sides Arroz + 1 TST costilla + 1 QD REGULAR prensado + 6 Tortillas EXTRAS comal.
// Live miss: 2 SIN + 1 QD DELUXE; missed con pata/tacos/arroz/costilla/tortillas; name Menudo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T12:37:00-04:00";
const { shadowOrderFromTurns, DORADA_DELUXE_ID, DORADA_REG_ID } = await import("../../src/call-scoring.ts");
const { nameFromTranscript } = await import("../../src/order-name.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
const TCO = "sq-taco-comal-homemade-corn-tortilla-taco-comal-U6KZVH";
const TST = "sq-taco-TAR7L5";
const RICE = "sq-sides-arroz-rice-26S6E6";
const TOR_X = "sq-tortillas-extras-1-x-tortilla-comal-ADELFI";

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA69ea0e-turns.json", import.meta.url), "utf8"));

test("gaby1: name is Gaby — never menu word Menudo", () => {
  const n = nameFromTranscript(turns as any);
  assert.equal(n, "Gaby", "name Gaby not Menudo: " + n);
});

test("gaby1: 2 SOLO + 1 CON PATA + 4 TCO duro/arroz + side arroz + TST costilla + QD REG + 6 tortillas", async () => {
  const run = async (text: string) => {
    // Live miss shapes: SIN qty dump + QD DELUXE on aceite/prensado
    if (/menudo|caldo|pata|botes|normal/i.test(text) && !/taco|quesadilla|tortilla|arroz|costilla/i.test(text))
      return {
        actions: [{
          type: "add_item", itemId: SIN, quantity: 2,
          modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }],
          readback: "2 menudo",
        }],
        reply: "2 Menudo con Tortillas. ¿Con tortillas?",
      };
    if (/quesadilla|aceite|prensado/i.test(text))
      return {
        actions: [{
          type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 1,
          modifiers: [
            { step: "(QD) Style", option: "(QD) DELUXE Preparada" },
            { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" },
          ],
          readback: "QD deluxe prensado",
        }],
        reply: "quesadilla deluxe",
      };
    return { actions: [], reply: "¿Algo más?" };
  };

  const r: any = await shadowOrderFromTurns(turns as any, run as any);

  const solo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)) && l.posMenudo === "solo");
  const con = r.cart.filter((l: any) => l.itemId === CON);
  const soloQty = solo.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const conQty = con.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(soloQty, 2, "2 SOLO menudo: " + JSON.stringify(r.cart));
  assert.equal(conQty, 1, "1 CON PATA: " + JSON.stringify(r.cart));

  const tacos = r.cart.filter((l: any) => l.itemId === TCO);
  const tacoQty = tacos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(tacoQty, 4, "4 TCO: " + JSON.stringify(tacos));
  assert.ok(tacos.every((l: any) => (l.modifiers || []).some((m: any) => /Duro/i.test(String(m.option)))),
    "duro: " + JSON.stringify(tacos));
  assert.ok(tacos.every((l: any) => (l.modifiers || []).some((m: any) => /Arroz|Rice/i.test(String(m.option)))),
    "con arroz: " + JSON.stringify(tacos));

  assert.ok(r.cart.some((l: any) => l.itemId === RICE), "side arroz: " + JSON.stringify(r.cart));
  const cost = r.cart.find((l: any) => l.itemId === TST || (/taco/i.test(String(l.itemId)) && (l.modifiers || []).some((m: any) => /Costilla/i.test(String(m.option)))));
  assert.ok(cost && (Number(cost.quantity) || 1) === 1, "1 TST costilla: " + JSON.stringify(r.cart));

  const qd = r.cart.filter((l: any) => /dorada|T5STUH|ZZAV3L/i.test(String(l.itemId)));
  assert.equal(qd.length, 1, "one QD: " + JSON.stringify(qd));
  assert.equal(qd[0].itemId, DORADA_REG_ID, "QD REGULAR not DELUXE: " + JSON.stringify(qd));
  assert.ok((qd[0].modifiers || []).some((m: any) => /Prensado/i.test(String(m.option))), "prensado meat");

  const tor = r.cart.find((l: any) => /tortillas-extras|extras-1-x-tortilla/i.test(String(l.itemId)));
  assert.ok(tor && Number(tor.quantity) === 6, "6 tortillas extras: " + JSON.stringify(r.cart));
});
