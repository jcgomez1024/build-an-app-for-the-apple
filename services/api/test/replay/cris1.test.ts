// cris1: CAd25680c1fb7ac8342b931c428998b328 — Sat Oct 24 ~3:32 PM ET
// 2 QCO costilla + 2 QCO buche + 1 QCO cabeza. "pomal"/"de normal" = comal (not doradas).
// Live missed costilla and doubled cabeza. Name Cris from staff vocative.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { shadowOrderFromTurns, kindOfItem, listedMeats, prepMergedCallerTurns } from "../../src/call-scoring.ts";
import { applySharedAliases } from "../../src/aliases.ts";

const QCO = "sq-quesadilla-HLT6CR";

test("cris1: pomal→comal; de normal (reject doradas)→comal; listed meats qty", () => {
  assert.match(applySharedAliases("del pomal de buche", "phone"), /comal/i);
  const m = [{ speaker: "caller", text: "No, eh, de normal, tomar, sí." }, { speaker: "staff", text: "De doradas," }];
  // prep only touches caller; seed doradas in a caller echo so doradCtx hits
  const merged = [
    { speaker: "caller", text: "dos quesadillas de costilla" },
    { speaker: "caller", text: "No, eh, de normal, tomar, sí." },
    { speaker: "caller", text: "doradas no" },
  ];
  prepMergedCallerTurns(merged as any);
  assert.match(merged[1].text, /comal/i);
  const listed = listedMeats("dos quesadillas de costilla y dos de buche");
  const by = Object.fromEntries(listed.map((w) => [w.meat, w.qty]));
  assert.equal(by.costilla, 2, JSON.stringify(listed));
  assert.equal(by.buche, 2, JSON.stringify(listed));
});

test("cris1: name Cris from staff vocative", () => {
  const turns = [
    { speaker: "staff" as const, text: "dos quesadillas del pomal de buche, dos de costilla y una de cabeza, Cris." },
    { speaker: "caller" as const, text: "Sí." },
    { speaker: "staff" as const, text: "Okay, Cris, gracias." },
  ];
  assert.equal(nameFromTranscriptInfo(turns)?.name, "Cris");
});

test("cris1: shadow — 2 costilla + 2 buche + 1 cabeza QCO; live missed costilla/doubled cabeza", async () => {
  const run = async (t: string) => {
    const s = applySharedAliases(t, "phone");
    const acts: any[] = [];
    // Live bug: only buche×2, then cabeza (and another cabeza) — no costilla
    if (/buche/i.test(s) && /quesadill|comal/i.test(s) && !/costilla|cabeza/i.test(s)) {
      acts.push({
        type: "add_item", itemId: QCO, quantity: 2, modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
          { step: "(B) Q Carnes / Meats", option: "Buche / Pork Stomach (+$0.50)" },
          { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" },
        ],
      });
    }
    if (/cabeza/i.test(s)) {
      acts.push({
        type: "add_item", itemId: QCO, quantity: 1, modifiers: [
          { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" },
          { step: "(B) Q Carnes / Meats", option: "Cabeza / Beef Head" },
        ],
      });
    }
    // model never adds costilla
    return { reply: /quesadill/i.test(s) && !/comal|harina|dorad|normal/i.test(s) ? "¿Doradas?" : "OK", actions: acts };
  };
  const turns = [
    { speaker: "caller", text: "Este, dame dos quesadillas de costilla y dos de buche.", language: "es" },
    { speaker: "staff", text: "De, de doradas,", language: "es" },
    { speaker: "caller", text: "No, eh, de normal, tomar, sí.", language: "es" },
    { speaker: "staff", text: "pomal, okay. Dos de de buche y dos de costilla.", language: "es" },
    { speaker: "caller", text: "Y, y me da, ¿tiene cabeza?", language: "es" },
    { speaker: "staff", text: "Sí.", language: "es" },
    { speaker: "caller", text: "Una, una quesadilla de cabeza.", language: "es" },
    { speaker: "staff", text: "Y una quesadilla del pomal de cabeza, ¿algo más?", language: "es" },
    { speaker: "caller", text: "Eso sería todo.", language: "es" },
    { speaker: "staff", text: "Okay, entonces tengo dos quesadillas del pomal de buche, dos quesadillas de pomal de costilla y una quesadilla de pomal de cabeza, Cris.", language: "es" },
    { speaker: "caller", text: "Sí.", language: "es" },
    { speaker: "staff", text: "Okay, Cris, gracias.", language: "es" },
  ].map((t, i) => ({ ...t, start: i, end: i + 1, speaker: t.speaker as "caller" | "staff" }));

  const r: any = await shadowOrderFromTurns(turns as any, run as any);
  const qds = r.cart.filter((l: any) => /quesadilla/i.test(String(l.itemId)) && !/dorada/i.test(String(l.itemId)));
  const qtyOf = (meat: string) => qds.filter((l: any) => (l.modifiers || []).some((m: any) => new RegExp(meat, "i").test(String(m.option))))
    .reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qtyOf("costilla"), 2, JSON.stringify(r.cart));
  assert.equal(qtyOf("buche"), 2, JSON.stringify(r.cart));
  assert.equal(qtyOf("cabeza"), 1, JSON.stringify(r.cart));
  for (const l of qds) {
    const opts = (l.modifiers || []).map((m: any) => String(m.option)).join("; ");
    assert.match(opts, /comal|QCO|homemade/i, opts);
  }
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Cris");
});
