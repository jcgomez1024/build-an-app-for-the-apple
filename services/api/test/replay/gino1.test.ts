// gino1: CAcc8e1093 — 2 QD Deluxe bistec + 1 TST lengua + 1 TST chorizo; name Gino (not Guino); "tienen" ≠ order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromAnswer, nameFromStaffAsk, nameFromTranscript } from "../../src/order-name.ts";
import {
  shadowOrderFromTurns, rewriteCallerText, listedMeats, DORADA_DELUXE_ID, kindOfItem, type CallTurn,
} from "../../src/call-scoring.ts";
import { applySharedAliases } from "../../src/aliases.ts";

const T = (speaker: "caller" | "staff", text: string, start = 0): CallTurn =>
  ({ speaker, text, start, end: start + 1, language: "es" } as any);

test("gino1: ¿Guino? is not a name; staff Gino wins", () => {
  assert.equal(nameFromAnswer("¿Guino?"), null);
  assert.equal(nameFromAnswer("¿Y no?"), null);
  const turns = [
    T("staff", "¿Al nombre de quién sería?"),
    T("caller", "¿Y no?"),
    T("staff", "¿Perdón?"),
    T("caller", "¿Guino?"),
    T("staff", "Gino, Gino."),
    T("staff", "Okay, muy bien, Gino, este, te tengo los dos tacos taqueros."),
    T("staff", "Okay, okay, Gino, dame unos quince minutos, por favor."),
  ];
  assert.equal(nameFromStaffAsk(turns), "Gino");
  assert.equal(nameFromTranscript(turns), "Gino");
});

test("gino1: supreme + un taco de X y uno de Y rewrites", () => {
  assert.match(applySharedAliases("dos quesadillas de bistec supreme", "phone"), /doradas deluxe preparadas/i);
  assert.match(rewriteCallerText("dos quesadillas de bistec supreme"), /doradas deluxe preparadas/i);
  const rw = rewriteCallerText("Me pones un taco taquero de lengua y uno de chorizo.");
  assert.match(rw, /taco\s+taquero\s+de\s+lengua/i);
  assert.match(rw, /taco\s+taquero\s+de\s+chorizo/i);
  const meats = listedMeats(rw);
  assert.ok(meats.some((m) => /lengua/i.test(m.meat)), JSON.stringify(meats));
  assert.ok(meats.some((m) => /chorizo/i.test(m.meat)), JSON.stringify(meats));
});

test("gino1: shadow — 2 QD Deluxe bistec + split TST lengua/chorizo; tienen is avail", async () => {
  const meat = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
  const tst = (meatOpt: string) => ({
    type: "add_item", itemId: "sq-taco-X", quantity: 1,
    modifiers: [{ step: "(A)", option: "(TST) Tortilla Taquera / Street Taco" }, meat(meatOpt)],
  });
  const run = async (text: string) => {
    const t = text.toLowerCase();
    // Availability — should not land as cart even if model tries
    if (/tienen/.test(t)) return { reply: "Tenemos de bistec, lengua, chorizo…", actions: [tst("Bistec / Steak")] };
    // Model stuck on tortilla / wrong platillo for aceite
    if (/aceite|preparad|dorad/.test(t) && !/taco/.test(t))
      return { reply: "¿Platillo?", actions: [{ type: "add_item", itemId: "sq-platillo-guisado-X", quantity: 1, modifiers: [] }] };
    if (/quesadilla/.test(t)) return { reply: "¿Comal, harina o doradas?", actions: [] };
    // Model merges both meats on one taco line (bug)
    if (/lengua/.test(t) && /chorizo/.test(t))
      return {
        reply: "1 taco lengua y chorizo.",
        actions: [{
          type: "add_item", itemId: "sq-taco-X", quantity: 1,
          modifiers: [
            { step: "(A)", option: "(TST) Tortilla Taquera / Street Taco" },
            meat("Lengua / Beef Tongue"),
            meat("Chorizo / Mexican Sausage"),
          ],
        }],
      };
    if (/lengua/.test(t)) return { reply: "1 lengua.", actions: [tst("Lengua / Beef Tongue")] };
    if (/chorizo/.test(t) && /taco/.test(t)) return { reply: "1 chorizo.", actions: [tst("Chorizo / Mexican Sausage")] };
    return { reply: "¿Algo más?", actions: [] };
  };
  const turns: CallTurn[] = [
    T("staff", "Cocina Elvis.", 0),
    T("caller", "Hola, si puedo hacer una orden para recoger.", 1),
    T("staff", "Ah, sí, claro, dígame.", 2),
    T("caller", "Me pones, ah, dos quesadillas de bistec supreme,", 3),
    T("staff", "Okay. ¿Dos quesadillas de qué me dijo?", 4),
    T("caller", "de bistec.", 5),
    T("staff", "¿Del comal?", 6),
    T("caller", "En aceite, sí.", 7),
    T("staff", "O en aceite. Muy bien. ¿Preparadas o regulares?", 8),
    T("caller", "En aceite.", 9),
    T("caller", "Preparadas.", 10),
    T("staff", "Muy bien, que tengo dos quesadillas en aceite de bistec preparadas, ¿algo más?", 11),
    T("caller", "Y tacos de ticket tienen.", 12),
    T("staff", "Ah, tenemos de bistec, cabeza, carnita, chorizo, costilla, pollo al pastor, buche, lengua, tripa.", 13),
    T("caller", "Me pones un un taco taquero de lengua y uno de chorizo.", 14),
    T("staff", "Muy bien, sí.", 15),
    T("staff", "¿Al nombre de quién sería?", 16),
    T("caller", "¿Guino?", 17),
    T("staff", "Gino, Gino.", 18),
  ];
  const r: any = await shadowOrderFromTurns(turns, run as any);
  const lines = r.cart.map((l: any) => ({
    id: String(l.itemId).slice(0, 40), q: l.quantity,
    mods: (l.modifiers || []).map((m: any) => m.option).join("; "),
  }));
  const deluxe = r.cart.filter((l: any) => l.itemId === DORADA_DELUXE_ID);
  const deluxeQty = deluxe.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(deluxeQty, 2, `2 QD Deluxe: ${JSON.stringify(lines)}`);
  assert.ok(deluxe.every((l: any) => /bistec/i.test((l.modifiers || []).map((m: any) => m.option).join(" "))), `deluxe bistec: ${JSON.stringify(lines)}`);
  assert.ok(!r.cart.some((l: any) => /platillo|guisado/i.test(String(l.itemId))), `no platillo: ${JSON.stringify(lines)}`);
  const tacos = r.cart.filter((l: any) => kindOfItem(l.itemId) === "taco" || /TST|Taquera|Street/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")));
  const lengua = tacos.filter((l: any) => /lengua/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")));
  const chorizo = tacos.filter((l: any) => /chorizo/i.test((l.modifiers || []).map((m: any) => m.option).join(" ")));
  assert.equal(lengua.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, `1 lengua: ${JSON.stringify(lines)}`);
  assert.equal(chorizo.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0), 1, `1 chorizo: ${JSON.stringify(lines)}`);
  // each meat on its own line (not merged)
  assert.ok(lengua.every((l: any) => !/chorizo/i.test((l.modifiers || []).map((m: any) => m.option).join(" "))), "lengua line not mixed");
  assert.ok(chorizo.every((l: any) => !/lengua/i.test((l.modifiers || []).map((m: any) => m.option).join(" "))), "chorizo line not mixed");
});

test("gino1: dual-meat taco leftover stripped when singles exist", async () => {
  const meat = (opt: string) => ({ step: "(B) Q Carnes / Meats", option: opt });
  let tacoTurn = 0;
  const run = async (text: string) => {
    const t = text.toLowerCase();
    if (/aceite|preparad/.test(t) && !/taco/.test(t)) {
      return {
        reply: "deluxe",
        actions: [{
          type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 2,
          modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, meat("Bistec / Steak")],
        }],
      };
    }
    if (/lengua/.test(t) || /chorizo/.test(t)) {
      tacoTurn++;
      // first taco utterance: model merges both meats; later turns may re-add the dual line
      if (tacoTurn === 1 || /sí|si/.test(t)) {
        return {
          reply: "merged",
          actions: [{
            type: "add_item", itemId: "sq-taco-X", quantity: 3,
            modifiers: [
              { step: "(A)", option: "(TST) Tortilla Taquera / Street Taco" },
              meat("Lengua / Beef Tongue (+$0.50)"), meat("Chorizo / Mexican Sausage"),
            ],
          }],
        };
      }
    }
    return { reply: "ok", actions: [] };
  };
  const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
    ({ speaker, text, start, end: start + 1, language: "es" });
  const turns: CallTurn[] = [
    T("caller", "Me pones dos quesadillas de bistec supreme,", 1),
    T("staff", "Okay. ¿Dos quesadillas de qué me dijo?", 2),
    T("caller", "de bistec.", 3),
    T("staff", "¿Del comal?", 4),
    T("caller", "En aceite, sí.", 5),
    T("staff", "¿Preparadas o regulares?", 6),
    T("caller", "Preparadas.", 7),
    T("staff", "Muy bien. ¿Algo más?", 8),
    T("caller", "Me pones un taco taquero de lengua y uno de chorizo.", 9),
    T("staff", "Muy bien, te tengo los dos tacos taqueros.", 10),
    T("caller", "Sí.", 11),
  ];
  const r: any = await shadowOrderFromTurns(turns, run as any);
  const dual = r.cart.filter((l: any) => {
    const meats = (l.modifiers || []).map((m: any) => String(m.option)).filter((o: string) => /lengua|chorizo/i.test(o) && !/salsa/i.test(o));
    return kindOfItem(l.itemId) === "taco" && meats.length >= 2;
  });
  assert.equal(dual.length, 0, `dual-meat taco leftover: ${JSON.stringify(r.cart)}`);
  const has = (re: RegExp) => r.cart.some((l: any) => kindOfItem(l.itemId) === "taco" && (l.modifiers || []).some((m: any) => re.test(String(m.option))));
  assert.ok(has(/lengua/i), `lengua taco: ${JSON.stringify(r.cart)}`);
  assert.ok(has(/chorizo/i), `chorizo taco: ${JSON.stringify(r.cart)}`);
});
