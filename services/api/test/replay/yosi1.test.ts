// yosi1 (CAa3f533fe, Fri Nov 6 ~3:47 PM ET, pickup): quesadillas fritas, two steak and two picadillo,
// preparadas deluxe, sin salsa on the steak ones. ASR name "Yo, sí" / staff "Yo sí" is Yosi.
// Live miss rang Tacos Dorados, then a steak-only street quesadilla, and saved no name.
// A spoken taco dorado stays the platter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyFriedQuesadillaTicket, friedQuesadillaWants } from "../../src/list-repair.ts";
import { heardName } from "../../src/name-accuracy.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CAa3f533fe-yosi1.json", import.meta.url), "utf8"));
const QD = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const Q = "sq-quesadilla-HLT6CR";
const TD = "sq-tacos-dorados-tacos-dorados-OHFWF3";
const BISTEC = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
const PICA = { step: "(B) Q Carnes / Meats", option: "Picadillo / Ground Beef with Potatoes" };
const DELUXE = { step: "(QD) Style", option: "(QD) DELUXE Preparada" };
const QST = { step: "(A) Q Tortilla Options", option: "(QST) Quesadilla Taquera / Street Quesadilla" };
const SALSA = { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" };

const MENU = [
  { id: QD, name: "Quesadilla Dorada", modifierGroups: [{ name: "(QD) Style", options: [{ name: "(QD) DELUXE Preparada" }, { name: "(QD) REGULAR Dorada" }] }, { name: "(B) Q Carnes / Meats", options: [{ name: "Bistec / Steak" }, { name: "Picadillo / Ground Beef with Potatoes" }] }] },
  { id: Q, name: "Quesadilla", modifierGroups: [{ name: "(A) Q Tortilla Options", options: [{ name: "(QST) Quesadilla Taquera / Street Quesadilla" }] }, { name: "(B) Q Carnes / Meats", options: [{ name: "Bistec / Steak" }] }] },
  { id: TD, name: "Tacos Dorados", modifierGroups: [{ name: "(A) Nachos Carne Options", options: [{ name: "Bistec / Steak" }, { name: "Picadillo / Ground Beef with Potatoes" }] }] },
];

/** Stub repeats the live miss: each "N de meat" is Tacos Dorados with salsa, then the name turn merges them. */
function stub() {
  let bistec = false, pica = false, merged = false;
  const r: any = async (text: string) => {
    const t = text.toLowerCase();
    if (/bistec/.test(t) && !bistec) {
      bistec = true;
      return { actions: [{ type: "add_item", itemId: TD, quantity: 2, modifiers: [{ step: "(A) Nachos Carne Options", option: "Bistec / Steak" }, SALSA] }], reply: "Dos." };
    }
    if (/picadillo/.test(t) && !pica) {
      pica = true;
      return { actions: [{ type: "add_item", itemId: TD, quantity: 2, modifiers: [SALSA, { step: "(A) Nachos Carne Options", option: "Picadillo / Ground Beef with Potatoes" }] }], reply: "Dos de picadillo." };
    }
    if (/yo/.test(t) && /s[ií]/.test(t) && !merged) {
      merged = true;
      return { actions: [{ type: "update_item", itemId: TD, quantity: 2, modifiers: [{ step: "(A) Nachos Carne Options", option: "Picadillo / Ground Beef with Potatoes" }, { step: "(A) Nachos Carne Options", option: "Bistec / Steak" }, SALSA] }], reply: "Listo." };
    }
    if (/sin salsa/.test(t)) return { actions: [], reply: "Listo." };
    return { actions: [], reply: "¿Algo más?" };
  };
  r.menu = () => MENU;
  return r;
}

const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join(" | ");
const line = (cart: any[], meat: RegExp) => cart.find((l) => l.itemId === QD && meat.test(opts(l)) && (l.modifiers || []).filter((m: any) => /Carnes|Meats/i.test(String(m.step)) && meat.test(String(m.option))).length === 1);

test("yosi1: quesadillas fritas are two deluxe lines, not the platter and not a street quesadilla", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart;
  const dump = JSON.stringify(c.map((l: any) => ({ id: l.itemId, q: l.quantity, m: opts(l), n: l.elviNotes })));
  assert.equal(c.some((l: any) => l.itemId === Q || /HLT6CR|QST/.test(opts(l))), false, dump);
  assert.equal(c.some((l: any) => /tacos-dorados|OHFWF3|BJ333JTEF5/.test(String(l.itemId))), false, dump);
  const steak = line(c, /Bistec/);
  const pica = line(c, /Picadillo/);
  assert.ok(steak, dump);
  assert.ok(pica, dump);
  assert.equal(steak.quantity, 2, dump);
  assert.equal(pica.quantity, 2, dump);
  assert.match(opts(steak), /DELUXE Preparada/);
  assert.match(opts(pica), /DELUXE Preparada/);
  assert.match(opts(pica), /Ground Beef with Potatoes/);
  assert.ok((steak.elviNotes || []).includes("sin salsa"), dump);
  assert.equal((pica.elviNotes || []).includes("sin salsa"), false, dump);
  assert.equal(c.filter((l: any) => l.itemId === QD).length, 2, dump);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Yosi");
  assert.equal(heardName(d.turns), "Yosi");
});

test("yosi1: a QST steak line and a merged Tacos Dorados line both rebuild to the two deluxe lines", () => {
  const qst: any[] = [{ itemId: Q, quantity: 2, modifiers: [QST, BISTEC] }];
  assert.equal(applyFriedQuesadillaTicket(qst, d.turns), true);
  assert.equal(qst.some((l) => l.itemId === Q), false);
  assert.equal(line(qst, /Bistec/)?.quantity, 2);
  assert.equal(line(qst, /Picadillo/)?.quantity, 2);
  assert.ok((line(qst, /Bistec/)?.elviNotes || []).includes("sin salsa"));
  const td: any[] = [{ itemId: TD, quantity: 2, modifiers: [{ step: "(A) Nachos Carne Options", option: "Bistec / Steak" }, { step: "(A) Nachos Carne Options", option: "Picadillo / Ground Beef" }, SALSA] }];
  applyFriedQuesadillaTicket(td, d.turns);
  assert.equal(td.some((l) => /tacos-dorados/.test(l.itemId)), false);
  assert.equal(line(td, /Bistec/)?.quantity, 2);
  assert.match(opts(line(td, /Picadillo/)), /with Potatoes/);
  assert.match(opts(line(td, /Bistec/)), /DELUXE/);
});

test("yosi1: a spoken taco dorado stays the platter; a comal quesadilla is not rewritten", () => {
  const platter = [{ speaker: "caller", text: "Can I get one taco dorado with chorizo, con todo?" }];
  assert.equal(friedQuesadillaWants(platter as any), null);
  const cart: any[] = [{ itemId: TD, quantity: 1, modifiers: [{ step: "(A) Nachos Carne Options", option: "Chorizo / Mexican Sausage" }] }];
  assert.equal(applyFriedQuesadillaTicket(cart, platter as any), false);
  assert.equal(cart[0].itemId, TD);
  const comal = [{ speaker: "caller", text: "Me pones dos quesadillas de comal de bistec." }];
  assert.equal(friedQuesadillaWants(comal as any), null);
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "¿A nombre de quién?" }, { speaker: "caller", text: "Sí." }] as any)?.name, undefined);
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "¿A nombre de quién?" }, { speaker: "caller", text: "Yo, sí." }] as any)?.name, undefined);
});
