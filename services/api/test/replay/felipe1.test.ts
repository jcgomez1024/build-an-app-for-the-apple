// felipe1 (CA398d11 ~4:17 PM ET Oct 25): desk Spanish pickup.
// Square ~$30 name Felipe = 4× Gordita Costilla + 2× Gordita Al Pastor, regular / sin preparar.
// Live miss: 1 dual-meat Gordita $5; qty "cuatro" dropped; "dos al pastor" merged onto first line.
// Name miss: Vámonos from staff goodbye vocative (staff said Felipe twice).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T16:17:00-04:00";
const { shadowOrderFromTurns, listedMeats, rewriteCallerText } = await import("../../src/call-scoring.ts");
const { nameFromAnswer, nameFromTranscript, nameFromStaffVocative } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA398d11-turns.json", import.meta.url), "utf8"));

test("felipe1: Vámonos goodbye never a name; transcript is Felipe", () => {
  assert.equal(nameFromAnswer("Vámonos, gracias."), null);
  assert.equal(nameFromAnswer("Vámonos"), null);
  assert.equal(nameFromAnswer("Vamonos, gracias"), null);
  const n = nameFromTranscript(turns as any);
  assert.ok(n && /^felipe$/i.test(n), "name Felipe: " + n);
  assert.equal(nameFromStaffVocative(turns as any), "Felipe");
});

test("felipe1: rewrite + listedMeats recover 4 costilla + 2 pastor", () => {
  const a = rewriteCallerText("ponme unas, que sean unas cuatro de, unas gorditas, por favor, de costillas, si tienes");
  assert.match(a, /cuatro\s+gorditas\s+de\s+costillas?/i, a);
  const b = rewriteCallerText("ponme unas, que sean unas cuatro de, unas gorditas, de costillas, si tienes Ajá, y ponme dos al pastor, así regulares");
  const meats = listedMeats(b);
  const by = Object.fromEntries(meats.map((m) => [m.meat, m.qty]));
  assert.equal(by.costilla, 4, JSON.stringify(meats));
  assert.equal(by.pastor, 2, JSON.stringify(meats));
});

/** Reproduce live wrongs: stub returns qty-1 costilla then dual-meat Costilla+Alpastor. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  if (/gordita|costilla|pastor/.test(t)) {
    if (/pastor/.test(t) && /costilla/.test(t)) {
      return {
        reply: "ok",
        actions: [{
          type: "add_item", itemId: "sq-gordita-M647RE", quantity: 1,
          modifiers: [
            { step: "(A) Gordita Options", option: "(GD) Gordita" },
            { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" },
            { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" },
          ],
          readback: "gordita costilla alpastor",
        }],
      };
    }
    if (/costilla/.test(t)) {
      return {
        reply: "ok",
        actions: [{
          type: "add_item", itemId: "sq-gordita-M647RE", quantity: 1,
          modifiers: [
            { step: "(A) Gordita Options", option: "(GD) Gordita" },
            { step: "(B) Q Carnes / Meats", option: "Costilla / Beef Rib" },
          ],
          readback: "1 gordita costilla",
        }],
      };
    }
    if (/pastor/.test(t)) {
      return {
        reply: "ok",
        actions: [{
          type: "add_item", itemId: "sq-gordita-M647RE", quantity: 1,
          modifiers: [
            { step: "(A) Gordita Options", option: "(GD) Gordita" },
            { step: "(B) Q Carnes / Meats", option: "Alpastor / Roasted Pork" },
          ],
          readback: "1 gordita pastor",
        }],
      };
    }
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("felipe1: cart is 4× GD costilla + 2× GD al pastor (not dual-meat qty 1)", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const gd = r.cart.filter((l: any) => /gordita/i.test(String(l.itemId)));
  assert.ok(gd.length >= 2, "≥2 gordita lines: " + JSON.stringify(gd));
  const cost = gd.filter((l: any) => (l.modifiers || []).some((m: any) => /Costilla/i.test(String(m.option))));
  const past = gd.filter((l: any) => (l.modifiers || []).some((m: any) => /Alpastor|Pastor/i.test(String(m.option))));
  assert.ok(cost.length >= 1, "costilla line: " + JSON.stringify(gd));
  assert.ok(past.length >= 1, "pastor line: " + JSON.stringify(gd));
  const cq = cost.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const pq = past.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(cq, 4, "4 costilla: " + JSON.stringify(gd));
  assert.equal(pq, 2, "2 pastor: " + JSON.stringify(gd));
  assert.ok(gd.every((l: any) => {
    const meats = (l.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => /Costilla|Alpastor|Bistec|Pastor|Prensado|Duro/i.test(o));
    return meats.length === 1;
  }), "no dual-meat lines: " + JSON.stringify(gd));
});
