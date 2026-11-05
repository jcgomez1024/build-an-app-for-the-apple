import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { nameFromTranscriptInfo } from "../../src/order-name.js";
import { staffMeatsOut, applyTortaNormales } from "../../src/said-adds.js";

// CAb3ee43a (Osmar / second order for Ulises Sánchez, Nov 5 ~4:59 PM ET). Stub = the live miss:
// 5 comal cabeza kept after the outage, one dorada flipped to bistec, tortas rung QTO.
const d = JSON.parse(readFileSync(new URL("../fixtures/CAb3ee43a-osmar2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const TACO = "sq-taco-TAR7L5";
const TORTA = "sq-torta-4GNTTE";
const QD = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const TCO = { step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" };
const taco = (meat: string, n: number) => ({ type: "add_item", itemId: TACO, quantity: n, modifiers: [TCO, { step: "(B) T Carnes / Meats Opciones", option: meat }] });
const qd = (meat: string) => ({ type: "add_item", itemId: QD, quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: meat }] });
const H = { type: "add_item", itemId: "sq-drink-agua-fresca-horchata-32oz-HL6HPK", quantity: 1, modifiers: [] };
const QTO = { type: "add_item", itemId: TORTA, quantity: 2, modifiers: [{ step: "(A) Torta Options", option: "(QTO) Queso Torta (+$0.50)" }, { step: "(B) Torta Carne Options", option: "Bistec / Steak" }] };
const stub = () => { const r: any = async (t: string) => {
  if (/cinco tacos de cabeza/i.test(t)) return { actions: [taco("Cabeza / Beef Head", 5)], reply: "5 × Taco: comal, cabeza. ¿Algo más?" };
  if (/dos tacos de pastor/i.test(t)) return { actions: [taco("Alpastor / Roasted Pork", 2)], reply: "2 × Taco: comal, pastor. ¿Algo más?" };
  if (/quesadillas doradas|QD DELUXE Dorada|doradas al pastor/i.test(t)) return { actions: [qd("Alpastor / Roasted Pork"), qd("Bistec / Steak")], reply: "Quesadillas doradas. ¿Algo más?" };
  if (/horchata/i.test(t)) return { actions: [H], reply: "Horchata. ¿Algo más?" };
  if (/tortas de bistec/i.test(t)) return { actions: [QTO], reply: "2 × Torta de bistec con queso. ¿Algo más?" };
  return { actions: [], reply: "Muy bien." };
}; r.menu = () => M; return r; };
const mods = (l: any) => JSON.stringify(l.modifiers || []);

test("CAb3ee43a: pastor comal tacos, two pastor doradas sin lechuga, horchata, tortas bistec normales, caller Osmar", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart;
  const tacos = c.filter((l: any) => /^sq-taco-/.test(l.itemId));
  assert.equal(tacos.reduce((n: number, l: any) => n + l.quantity, 0), 2, JSON.stringify(c));
  assert.ok(tacos.every((l: any) => /TCO|Comal/.test(mods(l)) && /pastor/i.test(mods(l))));
  assert.equal(c.some((l: any) => /Cabeza/.test(mods(l))), false);
  const q = c.filter((l: any) => /quesadilla-dorada|qd-deluxe|qd-regular/.test(l.itemId));
  assert.equal(q.reduce((n: number, l: any) => n + l.quantity, 0), 2, JSON.stringify(q));
  assert.ok(q.every((l: any) => /DELUXE Preparada/.test(mods(l)) && /pastor/i.test(mods(l)) && !/Bistec/.test(mods(l))));
  assert.ok(q.every((l: any) => (l.elviNotes || []).some((n: string) => /lechuga/i.test(n))));
  assert.equal(c.filter((l: any) => /horchata/.test(l.itemId)).reduce((n: number, l: any) => n + l.quantity, 0), 1);
  const tortas = c.filter((l: any) => /^sq-torta-/.test(l.itemId));
  assert.equal(tortas.reduce((n: number, l: any) => n + l.quantity, 0), 2, JSON.stringify(tortas));
  assert.ok(tortas.every((l: any) => /Bistec/.test(mods(l)) && /\(TO\)/.test(mods(l)) && !/QTO|Queso/.test(mods(l))));
  assert.equal(c.some((l: any) => /sope/i.test(l.itemId)), false);
  const info = nameFromTranscriptInfo(d.turns);
  assert.match(info?.name || "", /^Osmar\b/);
  assert.equal(info?.thirdPerson, false);
  assert.doesNotMatch(info?.name || "", /Ulises/i);
});

test("CAb3ee43a helpers: meat out, normales, a nombre de is not a new identity", () => {
  assert.deepEqual(staffMeatsOut("Cabeza sí no tengo todavía."), ["Cabeza"]);
  assert.deepEqual(staffMeatsOut("Sí, tengo cabeza."), []);
  assert.deepEqual(staffMeatsOut("No tengo lengua hoy."), ["Lengua"]);
  const cart = [{ itemId: "sq-torta-4GNTTE", quantity: 2, modifiers: [{ step: "(A) Torta Options", option: "(QTO) Queso Torta (+$0.50)" }, { step: "(B) Torta Carne Options", option: "Bistec / Steak" }] }];
  assert.equal(applyTortaNormales(cart, [{ speaker: "caller", text: "dos tortas de bistec" }, { speaker: "staff", text: "¿Con queso o normales?" }, { speaker: "caller", text: "Normales." }]), true);
  assert.match(JSON.stringify(cart[0].modifiers), /\(TO\) Torta/);
  assert.doesNotMatch(JSON.stringify(cart[0].modifiers), /QTO/);
  const qdAsk = [{ speaker: "caller", text: "dos quesadillas doradas" }, { speaker: "staff", text: "¿Preparadas o normales?" }, { speaker: "caller", text: "Normales." }];
  const keep = [{ itemId: "sq-torta-4GNTTE", quantity: 1, modifiers: [{ step: "(A) Torta Options", option: "(QTO) Queso Torta (+$0.50)" }] }];
  assert.equal(applyTortaNormales(keep, qdAsk as any), false);
  assert.match(JSON.stringify(keep[0].modifiers), /QTO/);
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "¿A nombre de quién?" }, { speaker: "caller", text: "A nombre de Kevin." }] as any)?.name, "Kevin");
  const swapped = nameFromTranscriptInfo([
    { speaker: "caller", text: "Soy María López." },
    { speaker: "staff", text: "María, dígame." },
    { speaker: "caller", text: "La otra orden a nombre de Pedro Gómez." },
    { speaker: "staff", text: "¿A nombre de quién la otra?" },
    { speaker: "caller", text: "A nombre de Pedro Gómez." },
  ] as any);
  assert.match(swapped?.name || "", /^Mar[ií]a\b/);
  assert.equal(swapped?.thirdPerson, false);
});
