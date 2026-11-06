// Spanish pickup: pozole is confirmed available ("ya tienen pozole" / "del rojo") at qty 1,
// then "¿me puede poner cuatro?" and staff "serían cuatro pozoles" + "sí" SET the bowl to 4.
// Drinks stay 2 Coca Cola + 1 horchata 32oz. Not a call-SID or name special case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { makeItN, makeItNAsUpdate, applyMakeItNMerge, statedDishPutQty } from "../../src/modifier-turns.ts";
import { applyStaffOrderCount, affirmedStaffSoupQty } from "../../src/readback-pass.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CAa74e1e-luis1.json", import.meta.url), "utf8"));
const POZ = "sq-pozole-rojo-red-pozole-DQ7X4J";
const COKE = "sq-drink-coca-cola-JJE4KC";
const HOR = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";

/** Live miss: availability/confirm rings one pozole, the "poner cuatro" turn returns nothing, drinks are right. */
function missStub() {
  let poz = false;
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/pozole/.test(t) && !/cuatro/.test(t) && !poz) {
      poz = true;
      return { actions: [{ type: "add_item", itemId: POZ, quantity: 1, modifiers: [], readback: "pozole rojo" }], reply: "Pozole rojo. ¿Algo más?" };
    }
    if (/coca|horchata/.test(t)) {
      return {
        actions: [
          { type: "add_item", itemId: COKE, quantity: 2, modifiers: [], readback: "2 coca cola de vidrio" },
          { type: "add_item", itemId: HOR, quantity: 1, modifiers: [], readback: "horchata" },
        ],
        reply: "Dos cocas y una horchata. ¿Algo más?",
      };
    }
    return { actions: [], reply: "Muy bien. ¿Algo más?" };
  };
  r.menu = () => [];
  return r;
}

/** Model hears the bump as another add of 4 on top of the bowl already rung. */
function additiveStub() {
  let poz = false;
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/ya tienen pozole/.test(t) && !poz) {
      poz = true;
      return { actions: [{ type: "add_item", itemId: POZ, quantity: 1, modifiers: [] }], reply: "Pozole rojo." };
    }
    if (/poner cuatro/.test(t)) return { actions: [{ type: "add_item", itemId: POZ, quantity: 4, modifiers: [] }], reply: "Cuatro pozoles." };
    if (/coca|horchata/.test(t)) {
      return { actions: [
        { type: "add_item", itemId: COKE, quantity: 2, modifiers: [] },
        { type: "add_item", itemId: HOR, quantity: 1, modifiers: [] },
      ], reply: "Bebidas." };
    }
    return { actions: [], reply: "Muy bien." };
  };
  r.menu = () => [];
  return r;
}

const qty = (ls: any[]) => ls.reduce((n, l) => n + (Number(l.quantity) || 1), 0);

test("luis1: 'me puede poner N' replaces the identified soup; availability alone does not", () => {
  assert.equal(makeItN("¿Me puede poner cuatro, por favor, señorita?")?.n, 4);
  assert.equal(makeItN("me pones cuatro")?.n, 4);
  assert.equal(makeItN("Me puede poner cuatro pozoles")?.n, 4);
  assert.match(makeItN("Me puede poner cuatro pozoles")?.tail || "", /pozole/);
  assert.equal(makeItN("Ya tienen pozole."), null);
  assert.equal(makeItN("Del rojo, ah, muy bien."), null);
  assert.deepEqual(makeItN("Mm, ¿me puedes poner mejor las tres?"), { n: 3, tail: "" });
  assert.equal(makeItN("can you just make it four regular quesadillas")?.n, 4);
  assert.equal(makeItN("me pone dos quesadillas de bistec"), null);
  assert.equal(makeItN("¿me puede poner otra orden más?"), null);
  assert.equal(makeItN("me pone dos, yo creo, con la taparrosca"), null);

  const cart = [{ itemId: POZ, quantity: 1, modifiers: [] }];
  const acts: any[] = [];
  assert.equal(makeItNAsUpdate(acts, cart, "¿Me puede poner cuatro, por favor, señorita?"), true);
  assert.equal(acts[0].type, "update_item");
  assert.equal(acts[0].quantity, 4);
  assert.equal(acts[0].itemId, POZ);
  const added: any[] = [{ type: "add_item", itemId: POZ, quantity: 4, modifiers: [] }];
  assert.equal(makeItNAsUpdate(added, cart, "¿Me puede poner cuatro, por favor, señorita?"), true);
  assert.equal(added[0].type, "update_item");
  assert.equal(added[0].quantity, 4);

  const lines = [{ itemId: POZ, quantity: 1, modifiers: [] }, { itemId: POZ, quantity: 4, modifiers: [] }];
  applyMakeItNMerge(lines, d.turns);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 4);
  assert.equal(statedDishPutQty(d.turns, /pozoles?/i), 4);
  const avail = d.turns.filter((t: any) => !/poner cuatro|serían cuatro/i.test(t.text));
  assert.equal(statedDishPutQty(avail, /pozoles?/i), 0);
  assert.equal(affirmedStaffSoupQty(avail, "pozole"), 0);
  assert.equal(affirmedStaffSoupQty(d.turns, "pozole"), 4);
  const staffOnly = [{ itemId: POZ, quantity: 1, modifiers: [] }];
  applyStaffOrderCount(staffOnly, d.turns);
  assert.equal(staffOnly.length, 1);
  assert.equal(staffOnly[0].quantity, 4);
  const noYes = d.turns.map((t: any) => (/^Sí\.$/.test(t.text) ? { ...t, text: "No, tres." } : t));
  assert.equal(affirmedStaffSoupQty(noYes, "pozole"), 0);
});

test("luis1: missed bump still rings 4 pozole rojo + 2 Coke + 1 horchata, name Luis", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, missStub());
  const c = r.cart || [];
  const dump = JSON.stringify(c.map((l: any) => ({ id: l.itemId, q: l.quantity })));
  const poz = c.filter((l: any) => /pozole/i.test(String(l.itemId)));
  assert.equal(poz.length, 1, dump);
  assert.equal(qty(poz), 4, dump);
  assert.match(String(poz[0].itemId), /pozole-rojo|DQ7X4J/i);
  const coke = c.filter((l: any) => /coca/i.test(String(l.itemId)));
  assert.equal(coke.length, 1, dump);
  assert.equal(qty(coke), 2, dump);
  const hor = c.filter((l: any) => /horchata/i.test(String(l.itemId)));
  assert.equal(hor.length, 1, dump);
  assert.equal(qty(hor), 1, dump);
  assert.match(nameFromTranscriptInfo(d.turns)?.name || "", /^Luis\b/i);
});

test("luis1: an add of 4 on top of the existing bowl becomes 4, not 5", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, additiveStub());
  const poz = (r.cart || []).filter((l: any) => /pozole/i.test(String(l.itemId)));
  assert.equal(poz.length, 1, JSON.stringify(r.cart));
  assert.equal(qty(poz), 4, JSON.stringify(poz));
});

test("luis1: confirming pozole is available is not an order for four", async () => {
  const turns = d.turns.map((t: any) => ({
    ...t,
    text: String(t.text)
      .replace("¿Me puede poner cuatro, por favor, señorita?", "¿Me puede poner, por favor, señorita?")
      .replace("serían cuatro pozoles", "sería el pozole"),
  }));
  const r: any = await shadowOrderFromTurns(turns, missStub());
  const poz = (r.cart || []).filter((l: any) => /pozole/i.test(String(l.itemId)));
  assert.equal(poz.length, 1, JSON.stringify(r.cart));
  assert.equal(qty(poz), 1, JSON.stringify(r.cart));
  assert.equal(qty((r.cart || []).filter((l: any) => /coca/i.test(String(l.itemId)))), 2);
  assert.equal(qty((r.cart || []).filter((l: any) => /horchata/i.test(String(l.itemId)))), 1);
});
