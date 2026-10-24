// alejandro1: CA1b34c9f3a6bcb187a79d22761ca47756 — Sat Oct 24 ~4:52 PM ET
// Desk-answered Spanish. Truth Square xvJfmUsFbxRccrGuOKKjCNIc2baZY:
//   1 QCO tripa + 1 QCO bistec + horchata + $5 delivery ("¿me los puedes enviar?").
// Live miss @ 25910c4: only 1 QCO bistec + horchata 32oz; missed QCO tripa; fulfillment null
//   (alias had pueden/envían, not puedes/enviar; listedMeats missed plural "tripas").
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shadowOrderFromTurns, listedMeats, meatFragment, expandMeatAnswer, kindOfItem, type CallTurn,
} from "../../src/call-scoring.ts";
import { fulfillmentIn } from "../../src/delivery.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

/** Live desk turns from recording RE8097035e3ad38d49a94dfe1bd5e6f29b (order-relevant). */
const turns = [
  { speaker: "staff", text: "Cocina de alguien.", start: 0.36, end: 1.24, language: "es" },
  { speaker: "caller", text: "Buenas tardes, este, ¿qué menú tiene hoy?", start: 2.541, end: 4.562, language: "es" },
  { speaker: "staff", text: "Hoy tenemos pozole, tenemos birria, tenemos, todavía tenemos menudo.", start: 9.043, end: 14.185, language: "es" },
  { speaker: "caller", text: "De quesadillas gorditas, todo eso.", start: 17.586, end: 19.607, language: "es" },
  { speaker: "staff", text: "todavía tenemos eso también, claro, y quesadillas doradas.", start: 20.347, end: 23.448, language: "es" },
  { speaker: "caller", text: "O que me pone dos quesadillas de comal.", start: 25.089, end: 28.47, language: "es" },
  { speaker: "staff", text: "Muy bien, dos quesadillas de comal, ¿de qué te las voy a dar?", start: 29.67, end: 32.651, language: "es" },
  { speaker: "caller", text: "Una de,", start: 33.791, end: 34.152, language: "es" },
  { speaker: "caller", text: "¿de qué de qué tiene?", start: 35.512, end: 36.132, language: "es" },
  { speaker: "staff", text: "Tengo biste, a ver, espérame.", start: 37.252, end: 39.553, language: "es" },
  { speaker: "caller", text: "Ujú.", start: 40.694, end: 40.834, language: "es" },
  { speaker: "staff", text: "Tengo biste, cabeza, carnita, chorizo, costilla, pollo al pastor, buche, lengua, tripa.", start: 40.874, end: 45.695, language: "es" },
  { speaker: "caller", text: "O que me pones una de, una de tripas y una de bistec. Ujú.", start: 47.176, end: 53.658, language: "es" },
  { speaker: "staff", text: "Una de tripa y una de biste, claro, ¿algo más?", start: 50.957, end: 53.818, language: "es" },
  { speaker: "caller", text: "Y un agua de horchata.", start: 54.839, end: 55.859, language: "es" },
  { speaker: "staff", text: "Muy bien.", start: 56.939, end: 57.879, language: "es" },
  { speaker: "caller", text: "Nada más, ¿me los puedes enviar?", start: 61.641, end: 63.341, language: "es" },
  { speaker: "caller", text: "Sí.", start: 66.582, end: 66.682, language: "es" },
  { speaker: "caller", text: "Es en la 419 Stay.", start: 69.182, end: 70.742, language: "es" },
  { speaker: "caller", text: "Stay.", start: 75.143, end: 75.403, language: "es" },
  { speaker: "caller", text: "Es Alejandro.", start: 127.616, end: 128.216, language: "es" },
  { speaker: "caller", text: "Ujú. Okey, muchas gracias.", start: 131.037, end: 133.838, language: "es" },
] as CallTurn[];

test("alejandro1: listedMeats + meatFragment keep plural tripas with bistec", () => {
  const t = "O que me pones una de, una de tripas y una de bistec. Ujú.";
  assert.deepEqual(listedMeats(t).map((x) => x.meat), ["tripa", "bistec"]);
  assert.match(String(meatFragment(t)), /tripa/i);
  assert.match(String(meatFragment(t)), /bistec/i);
  // expandMeatAnswer optional when meatFragment already carries both meats for julio1 force-add
  const ex = expandMeatAnswer("dos quesadillas de comal", "una de tripas y una de bistec");
  assert.ok(ex && ex.length === 2, "expand clean → 2: " + JSON.stringify(ex));
});

test("alejandro1: 'me los puedes enviar' → DELIVERY", () => {
  assert.equal(fulfillmentIn("Nada más, ¿me los puedes enviar?"), "DELIVERY");
  assert.equal(fulfillmentIn("¿Me los puedes enviar?"), "DELIVERY");
});

test("alejandro1: name Alejandro from 'Es Alejandro.'", () => {
  const info = nameFromTranscriptInfo(turns as any);
  assert.equal(info?.name, "Alejandro");
});

test("alejandro1: QCO tripa + QCO bistec + horchata + delivery (stub)", async () => {
  const run = async () => ({ actions: [], reply: "?" });
  const r: any = await shadowOrderFromTurns(turns, run as any);
  const qcos = (r.cart || []).filter((l: any) => /quesadilla|HLT6CR/i.test(String(l.itemId)));
  const meats = qcos.map((l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" "));
  assert.equal(qcos.length, 2, `expected 2 QCO, got ${qcos.length}: ${JSON.stringify(r.cart)}`);
  assert.ok(meats.some((m: string) => /tripa/i.test(m)), `missing tripa: ${meats.join(" | ")}`);
  assert.ok(meats.some((m: string) => /bistec|steak/i.test(m)), `missing bistec: ${meats.join(" | ")}`);
  assert.ok(qcos.every((l: any) => (l.quantity || 1) === 1), `qty 1 each: ${JSON.stringify(qcos)}`);
  const drinks = (r.cart || []).filter((l: any) => /horchata/i.test(String(l.itemId)));
  assert.ok(drinks.length >= 1, "horchata missing");
  assert.equal(r.fulfillment, "DELIVERY", `fulfillment=${r.fulfillment}`);
});
