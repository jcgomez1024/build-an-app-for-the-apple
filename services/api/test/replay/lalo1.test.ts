// lalo1 (CA72b325 ~5:24 PM ET Oct 25): desk Spanish pickup, phone …2481.
// Square bwdaGhmUsGeaz7ATruSGcy9reDLZY $9.50 ticket Lalo =
//   2 QCO: 1 tripa + 1 duro.
// Mid-call "¿Tienes quesadilla de aceite?" + staff "Del comal, ¿verdad?" / "Sí, de comal"
// = clarify comal tortilla only (not a new item).
// Live miss: 3rd phantom QCO with tripa+duro; order_name "Va" from filler ¿Va? (savedToMemory).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T17:24:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromAnswer, nameFromTranscript, nameFromTranscriptInfo } =
  await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA72b325-turns.json", import.meta.url), "utf8"));
const QCO = "sq-quesadilla-HLT6CR";
const TORT = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };

test("lalo1: Va / ¿Va? never a name; transcript is Lalo", () => {
  assert.equal(nameFromAnswer("Va"), null);
  assert.equal(nameFromAnswer("¿Va?"), null);
  assert.equal(nameFromAnswer("va"), null);
  assert.equal(nameFromAnswer("Vámonos"), null);
  const n = nameFromTranscript(turns as any);
  assert.ok(n && /^lalo$/i.test(n), "name Lalo: " + n);
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(info, "heard info");
  assert.ok(/^lalo$/i.test(info!.name), "info name Lalo: " + info!.name);
  assert.notEqual(info!.name.toLowerCase(), "va");
  assert.equal(info!.source, "staff-ask");
});

/** Reproduce live wrongs: tripa + duro OK, then phantom dual-meat QCO on the name turn. */
const stubLiveMiss = async (text: string) => {
  const t = text.toLowerCase();
  // Name / filler turns — live model invented dual-meat QCO here
  if (/\blalo\b/.test(t) || /^\W*va\W*$/.test(t) || /\bestás diciendo/.test(t) || /\bera todo para decir/.test(t)) {
    if (/\blalo\b/.test(t)) {
      return {
        reply: "Quesadilla: comal, tripa y chicharrón duro. ¿Algo más?",
        actions: [{
          type: "add_item", itemId: QCO, quantity: 1,
          modifiers: [
            TORT,
            { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe (+$0.50)" },
            { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" },
          ],
          readback: "QCO tripa+duro",
        }],
      };
    }
    return { reply: "¿Algo más?", actions: [] };
  }
  // Aceite availability — must not add (also dropped as avail Q upstream)
  if (/aceite/.test(t) && /(?:tienen|tienes|hay|tiene)/.test(t) && !/dame|deme|me das|quiero|otra/.test(t)) {
    return { reply: "¿Comal o dorada?", actions: [] };
  }
  if (/tripas?/.test(t) && /quesadilla/.test(t) && !/duro|chicharr/.test(t)) {
    return {
      reply: "Quesadilla: comal, tripa. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: QCO, quantity: 1,
        modifiers: [TORT, { step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe (+$0.50)" }],
        readback: "1 QCO tripa",
      }],
    };
  }
  if (/duro|chicharr/.test(t) && /quesadilla|comal/.test(t)) {
    return {
      reply: "Quesadilla: comal, duro. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: QCO, quantity: 1,
        modifiers: [TORT, { step: "(B) Q Carnes / Meats", option: "Duro / Pork Rinds" }],
        readback: "1 QCO duro",
      }],
    };
  }
  if (/comal/.test(t) && !/quesadilla|tripa|duro/.test(t)) {
    return { reply: "Comal. ¿Algo más?", actions: [] };
  }
  return { reply: "¿Algo más?", actions: [] };
};

test("lalo1: exactly 2 QCO (tripa + duro); no dual-meat phantom; no aceite extra", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stubLiveMiss as any);
  const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
  const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option))
    .filter((o: string) => /Tripa|Duro|Bistec|Pastor|Chorizo|Prensado|Picadillo/i.test(o) && !/salsa/i.test(o));

  const qcos = r.cart.filter((l: any) => /quesadilla-HLT6CR|quesadilla/i.test(String(l.itemId)) && !/dorada/i.test(String(l.itemId)));
  const qTotal = qcos.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(qTotal, 2, "2 QCO: " + JSON.stringify(qcos.map((l: any) => ({ q: l.quantity, m: meatOf(l), o: opts(l) }))));
  assert.ok(qcos.every((l: any) => meatOf(l).length === 1), "no dual-meat: " + JSON.stringify(qcos.map(meatOf)));
  assert.ok(qcos.every((l: any) => /QCO|Comal|Homemade/i.test(opts(l))), "all comal");

  const has = (re: RegExp) => qcos.some((l: any) => meatOf(l).some((m: string) => re.test(m)));
  assert.ok(has(/Tripa/i), "tripa line");
  assert.ok(has(/Duro/i), "duro line");

  // No dorada / aceite phantom from availability clarify
  assert.ok(!r.cart.some((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId))), "no QD dorada from aceite ask");
});
