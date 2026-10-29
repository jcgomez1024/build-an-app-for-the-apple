// ca2e1da7 (CA2e1da74a7bb1dd69774578f010b24e1d ~10:25 AM ET Oct 29): Santiago pickup, staff answered.
// Correct: 2 QCO picadillo; 1 Menudo con Tortillas (grande, sin pata); 3 more QCO = 2 prensado + 1 combinada
// bistec con chorizo; 2 horchata 32oz + 1 jamaica 32oz; PICKUP; name Santiago.
// Live miss: combinada QCO lost ("…y una de de" | "de combinada, de bistec con chorizo" split across turns);
// horchata rung ×1 though "dos de horchata y una de jamaica" (staff repeated); menudo pata prompt looped on "plato grande".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-29T10:25:00-04:00";
const { shadowOrderFromTurns, prepMergedCallerTurns } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo } = await import("../../src/order-name.ts");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA2e1da7-turns.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR";
const SIN = "sq-menudo-menudo-con-tortillas-4-ZSRUX4";
const HOR = "sq-drink-agua-fresca-horchata-32oz-HL6HPK", JAM = "sq-drink-agua-fresca-jamaica-32oz-ZLA3ZG";
const QCO = { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" };
const meat = (o: string) => ({ step: "(B) Q Carnes / Meats", option: o });
const PIC = "Picadillo / Ground Beef with Potatoes", PRE = "Prensado / Spicy Pork (+$0.50)";
const PATA_Q = "Menudo: ¿Menudo con Tortillas (4) o Con Pata Menudo 32oz y Tortillas (4)?";

/** Stub reproduces live wrongs: drops the 2nd (mixed) clause, horchata ×1, pata prompt on "plato grande", phantom re-add on close. */
let menudoRung = false; // the live model sees its cart: a 2nd "Menudo con Tortillas" pick is not a 2nd bowl
const stub = async (text: string) => {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/menudo con tortillas \(4\)/.test(t) && !menudoRung && (menudoRung = true)) return { reply: "Menudo con Tortillas. ¿Algo más?", actions: [{ type: "add_item", itemId: SIN, quantity: 1, modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }] }] };
  if (/menudo con tortillas \(4\)/.test(t)) return { reply: "¿Algo más?", actions: [] };
  if (/menudo|plato grande/.test(t) && !/quesadilla/.test(t)) return { reply: PATA_Q, actions: [] };
  if (/picadillo/.test(t)) return { reply: "2 × Quesadilla comal picadillo. ¿Algo más?", actions: [{ type: "add_item", itemId: Q, quantity: 2, modifiers: [QCO, meat(PIC)] }] };
  if (/prensado/.test(t)) return { reply: "2 × Quesadilla comal prensado. ¿Algo más?", actions: [{ type: "add_item", itemId: Q, quantity: 2, modifiers: [QCO, meat(PRE)] }] };
  if (/horchata|jamaica/.test(t)) return { reply: "Horchata; Jamaica. ¿Algo más?", actions: [
    { type: "add_item", itemId: HOR, quantity: 1, modifiers: [] }, { type: "add_item", itemId: JAM, quantity: 1, modifiers: [] }] };
  if (/esta bien\. okay/.test(t)) return { reply: "Quesadilla: comal, bistec. ¿Algo más?", actions: [{ type: "add_item", itemId: Q, quantity: 1, modifiers: [meat("Bistec / Steak"), QCO] }] };
  return { reply: "¿Algo más?", actions: [] };
};

test("ca2e1da7: split 'una de de' | 'de combinada, de bistec con chorizo' joins + stamps the comal dish; plato grande → menudo", () => {
  const m = [
    { speaker: "caller", text: "A un menudo grande y me puedes poner otras tres quesadillas de comal." },
    { speaker: "staff", text: "¿Ah?" },
    { speaker: "caller", text: "Pero si me las pones dos de prensado y una de de" },
    { speaker: "caller", text: "de combinada, de bistec con chorizo." },
  ];
  prepMergedCallerTurns(m);
  assert.match(m[2].text, /dos quesadillas de comal de prensado y una quesadilla de comal de bistec con chorizo/);
  const p = [{ speaker: "caller", text: "Ah, menudo no venden ahora, ¿verdad?" }, { speaker: "caller", text: "Okey, ¿me puede poner un plato grande?" }];
  prepMergedCallerTurns(p);
  assert.match(p[1].text, /Menudo con Tortillas \(4\)/);
});

test("ca2e1da7: name Santiago", () => {
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "Santiago");
});

test("ca2e1da7: 2 QCO picadillo + 2 QCO prensado + 1 QCO bistec/chorizo + menudo + 2 horchata + 1 jamaica; PICKUP", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const lines = r.cart.map((l: any) => ({ id: String(l.itemId), q: Number(l.quantity) || 1, mods: (l.modifiers || []).map((m: any) => String(m.option)) }));
  const dump = JSON.stringify(lines);
  const qco = (want: RegExp[]) => lines.filter((l: any) => l.id === Q && l.mods.some((o: string) => /QCO/.test(o))
    && l.mods.filter((o: string) => / \/ /.test(o) && !/QCO|Salsa/.test(o)).length === want.length
    && want.every((re) => l.mods.some((o: string) => re.test(o)))).reduce((n: number, l: any) => n + l.q, 0);
  assert.equal(qco([/Picadillo/]), 2, "picadillo ×2: " + dump);
  assert.equal(qco([/Prensado/]), 2, "prensado ×2: " + dump);
  assert.equal(qco([/Bistec/, /Chorizo/]), 1, "combinada bistec+chorizo ×1: " + dump);
  assert.equal(lines.filter((l: any) => l.id === Q).reduce((n: number, l: any) => n + l.q, 0), 5, "5 quesadillas total: " + dump);
  assert.equal(lines.filter((l: any) => /menudo/.test(l.id)).length, 1, "one menudo: " + dump);
  assert.ok(lines.some((l: any) => l.id === SIN), "menudo con tortillas (sin pata): " + dump);
  assert.equal(lines.find((l: any) => l.id === HOR)?.q, 2, "horchata ×2: " + dump);
  assert.equal(lines.find((l: any) => l.id === JAM)?.q, 1, "jamaica ×1: " + dump);
  assert.equal(r.fulfillment, "PICKUP", "pickup: " + dump);
  const loops = (r.steps || []).filter((s: any) => s.reply === PATA_Q && /plato grande/i.test(String(s.heard || "")));
  assert.equal(loops.length, 0, "no pata loop on 'plato grande'");
});
