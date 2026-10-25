// jose2: CA1c2f8c — Sun Oct 25. 2 menudos sin pata + 2 QD doradas (picadillo con nopales, bistec).
// Misses: cart dropped QDs; phantom Huarache; "Hasta luego" overwrote José as name.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ELVI_SIMULATED_NOW = "2026-10-25T09:55:00-04:00";
import { nameFromAnswer, nameFromStaffAsk, nameFromTranscriptInfo } from "../../src/order-name.ts";
const { shadowOrderFromTurns, DORADA_REG_ID } = await import("../../src/call-scoring.ts");

const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const CON = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";

const T = (speaker: "caller" | "staff", text: string, start = 0) =>
  ({ speaker, text, start, end: start + 1, language: "es" as const });

test("jose2: Hasta luego is never a name; José wins after ¿Tu nombre?", () => {
  assert.equal(nameFromAnswer("Hasta luego."), null);
  assert.equal(nameFromAnswer("Hasta luego"), null);
  assert.equal(nameFromAnswer("Bye bye"), null);
  assert.equal(nameFromAnswer("Nos vemos"), null);
  assert.equal(nameFromAnswer("José."), "José");
  const turns = [
    T("staff", "¿Tu nombre?"),
    T("caller", "José."),
    T("caller", "Hasta luego."),
  ];
  assert.equal(nameFromStaffAsk(turns), "José");
  assert.deepEqual(nameFromTranscriptInfo(turns), { name: "José", thirdPerson: false, source: "staff-ask" });
});

test("jose2: 2 menudo sin pata + 2 QD regular (picadillo, bistec); no huarache", async () => {
  const run = async (t: string) => {
    if (/menudo/i.test(t) && /pata/i.test(t))
      return { actions: [], reply: "Menudo: ¿Menudo con Tortillas (4) o Con Pata Menudo 32oz y Tortillas (4)?" };
    if (/menudo/i.test(t)) return { actions: [], reply: "Huarache Elvis: ¿Bistec, Cabeza, Carnitas o Chorizo?" };
    if (/dorad|picadillo|bistec|pone dos|nopales/i.test(t))
      return { actions: [], reply: "Huarache Elvis: ¿Bistec, Cabeza, Carnitas o Chorizo?" };
    return { actions: [], reply: "¿Algo más?" };
  };
  const turns = [
    T("staff", "Sí, buenos días.", 0),
    T("caller", "Hola, buenos días, me gustaría hacer una orden.", 2),
    T("staff", "Claro, dime.", 4),
    T("caller", "Van a ser dos menudos sin pata.", 6),
    T("staff", "Permíteme, dos menudos sin pata, ¿qué más, joven?", 8),
    T("caller", "Este, tiene quesadillas doradas.", 10),
    T("staff", "¿Sí?", 12),
    T("caller", "Ah, me pone dos, una de picadillo con nopales tiene.", 14),
    T("staff", "¿De qué, Manu?", 16),
    T("caller", "Ajá, picadillo con nopales y la otra de bistec.", 18),
    T("staff", "¿Qué más?", 20),
    T("caller", "Sería todo.", 22),
    T("staff", "¿Tu nombre?", 24),
    T("caller", "José.", 26),
    T("caller", "Hasta luego.", 28),
  ];
  const r: any = await shadowOrderFromTurns(turns as any, run as any);
  const menudo = r.cart.filter((l: any) => /menudo/i.test(String(l.itemId)));
  const qd = r.cart.filter((l: any) => /dorada|zzav3l|t5stuh/i.test(String(l.itemId)));
  const huarache = r.cart.filter((l: any) => /huarache|guarache/i.test(String(l.itemId)));
  const menudoQty = menudo.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  const qdQty = qd.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.ok(menudoQty >= 2, `expected ≥2 menudo, got ${menudoQty}: ${JSON.stringify(r.cart)}`);
  assert.ok(menudo.every((l: any) => l.itemId === SIN || !/con-pata/i.test(l.itemId)), `menudo must be SIN: ${JSON.stringify(menudo)}`);
  assert.ok(!r.cart.some((l: any) => l.itemId === CON), "no Con Pata");
  assert.ok(qdQty >= 2, `expected ≥2 QD doradas, got ${qdQty}: ${JSON.stringify(r.cart)}`);
  assert.ok(qd.every((l: any) => l.itemId === DORADA_REG_ID || /regular|dorada/i.test(String(l.itemId))), "QD regular");
  const meats = qd.flatMap((l: any) => (l.modifiers || []).map((m: any) => String(m.option))).join(" ");
  assert.match(meats, /picadillo/i);
  assert.match(meats, /bistec/i);
  assert.equal(huarache.length, 0, `no phantom huarache: ${JSON.stringify(huarache)}`);
  assert.ok(!r.steps.some((s: any) => /Huarache/i.test(String(s.reply || "")) && /\?/.test(String(s.reply || ""))),
    `no open huarache Q: ${JSON.stringify(r.steps.filter((s: any) => /Huarache/i.test(String(s.reply || ""))))}`);
  assert.deepEqual(nameFromTranscriptInfo(turns as any), { name: "José", thirdPerson: false, source: "staff-ask" });
});
