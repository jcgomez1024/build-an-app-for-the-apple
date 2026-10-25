// juan1 (CA5dddcd): STT "con papa" + staff "con patas" (+ Sí) → Menudo CON; keep horchata; DELIVERY; 872 Bank St.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn =>
  ({ speaker, start, end: start + 1, text, language: "es" });

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";

const stub = async (text: string) => {
  // Model hears "papa" as SIN menudo dump — capture must flip to CON after staff confirm
  if (/menudo/i.test(text))
    return {
      actions: [{
        type: "add_item",
        itemId: SIN,
        quantity: 1,
        modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }],
        readback: "menudo",
      }],
      reply: "¿Algo más?",
    };
  if (/horchata/i.test(text))
    return {
      actions: [{ type: "add_item", itemId: "sq-drink-agua-fresca-horchata-32oz", quantity: 1, modifiers: [], readback: "horchata" }],
      reply: "¿Algo más?",
    };
  return { actions: [] as any[], reply: "?" };
};

const juan: CallTurn[] = [
  T("staff", "Buenos días.", 0),
  T("caller", "Buenos días, ah, disculpe, ¿tendrá delivery?", 2),
  T("staff", "Sí, claro.", 5),
  T("caller", "Sí, ah, ok. Ah, quisiera encargar un menudo con papa, por favor. Un agua de horchata, un menudo con papa.", 7),
  T("staff", "Un agua de horchata, ¿y qué más me dijiste?", 13),
  T("caller", "Y un menudo con papa, por favor.", 16),
  T("staff", "Un menudo con patas, para delivery, ¿verdad?", 19),
  T("caller", "Sí, por favor.", 22),
  T("staff", "¿A qué dirección sería? 8 7 2 Bank Street, ¿a qué nombre sería la orden?", 24),
  T("caller", "Es 8 7 2 Bank Street. Va, sí. Ah. Ah, Juan.", 28),
  T("staff", "Juan. Okay. ¿Me puedes pasar tu número de teléfono, por favor?", 33),
  T("caller", "Sí, Juan. Es 4 40. 3", 36),
  T("staff", "Ajá. 3 43. Okay, ujú.", 39),
  T("caller", "46 12 8, 46, sí, 12 82, ajá, 82. Ah, en vez de 28", 41),
  T("staff", "Muy bien, dirección es 8 72 Bank Street, Juan, teléfono es 4 40 3 4 6 12 82.", 44),
  T("caller", "es 12 8 2, sí. Ujú. Sí. Sí, así es. Sí, gracias.", 50),
];

test("juan1: papa→pata staff confirm → CON + horchata + DELIVERY + 872 Bank", async () => {
  const r: any = await shadowOrderFromTurns(juan, stub as any);
  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  assert.equal(menudo.length, 1, `menudo: ${JSON.stringify(menudo)}`);
  assert.equal(String(menudo[0].itemId), CON, "must be CON not SIN after staff patas");
  assert.equal(Number(menudo[0].quantity), 1);
  assert.ok((menudo[0].modifiers || []).some((m: any) => /tortilla/i.test(String(m.option))), "keep tortillas");
  assert.ok(!(menudo[0].modifiers || []).some((m: any) => /extra\s*pata/i.test(String(m.option))), "no EXTRA pata");
  assert.ok(r.cart.some((l: any) => /horchata/i.test(String(l.itemId))), "horchata stays");
  assert.equal(r.fulfillment, "DELIVERY");
  const addr = String(r.address || r.street || r.delivery?.address || "");
  assert.match(addr, /872.*Bank/i, `address digit: ${addr}`);
});
