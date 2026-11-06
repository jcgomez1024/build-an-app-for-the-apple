import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { nameFromTranscriptInfo, nameFromStaffVocative, nameFromAnswer, isFoodNameBlocked, isCloseFoodStt, callerSelfNamed, shouldPersistOrderName } from "../../src/order-name.js";
import { cleanFirstName } from "../../src/caller-memory.js";
import { noUnknownFoodAck } from "../../src/elvi.js";

// doritas1 (CA7901911, Nov 5 ~7:02 PM ET, staff-answered): 2 taquero bistec tacos.
// Caller never said their name. Staff's "¿Doritas…?" / "Volcanes, …" is them parsing an unknown dish
// (catalog has no volcan/durita/dorita). Live miss: customerName Doritas, savedToMemory, SMS used Doritas.
// Unknown dish was acknowledged and not added — do not invent nachos, QD, tacos dorados, or gordita.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA7901911-doritas1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const TACO = "sq-taco-TAR7L5";
const TST = { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" };
const BISTEC = { step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" };
const stub = () => { const r: any = async (t: string) => {
  if (/duritas|doritas|volc[aá]n/i.test(t)) return { actions: [], reply: "Muy bien." };
  if (/tacos de bistec/i.test(t)) return { actions: [], reply: "Tacos: ¿Taco Comal, Taco Harina o Taco Taquero?" };
  if (/taquer/i.test(t)) return { actions: [{ type: "add_item", itemId: TACO, quantity: 2, modifiers: [TST, BISTEC] }], reply: "2 × Taco: taquero, bistec. ¿Algo más?" };
  return { actions: [], reply: "Muy bien." };
}; r.menu = () => M; return r; };

test("doritas1: 2 TST bistec; no Doritas name; no invented volcanes/nachos/QD/gordita", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const c = r.cart;
  const mods = (l: any) => JSON.stringify(l.modifiers || []);
  const tacos = c.filter((l: any) => /^sq-taco-/.test(l.itemId));
  assert.equal(tacos.reduce((n: number, l: any) => n + l.quantity, 0), 2, JSON.stringify(c));
  assert.ok(tacos.every((l: any) => /TST|Taquero|Street/.test(mods(l)) && /Bistec|Steak/.test(mods(l))), mods(tacos[0] || {}));
  assert.equal(c.some((l: any) => /nacho|quesadilla|gordita|dorada|torta|volcan/i.test(l.itemId)), false, JSON.stringify(c));
  const info = nameFromTranscriptInfo(d.turns);
  const name = info?.name || "";
  assert.equal(name, "");
  assert.equal(nameFromStaffVocative(d.turns), null);
  assert.equal(/doritas|duritas|volc[aá]n/i.test(name), false);
});

test("doritas1: food words and close STT are not names unless the caller self-identified", () => {
  const T = (s: string, x: string) => ({ speaker: s as "staff" | "caller", text: x });
  for (const w of ["Doritas", "Duritas", "Volcanes", "Volcán", "Volcan"]) {
    assert.equal(nameFromAnswer(w), null, w);
    assert.equal(cleanFirstName(w), null, w);
    assert.equal(isFoodNameBlocked(w, "vocative"), true, w);
    assert.equal(nameFromStaffVocative([T("staff", `¿${w}, o qué?`)]), null, w);
    assert.equal(nameFromTranscriptInfo([T("staff", `Gracias, ${w}.`)]), null, w);
  }
  // one-edit STT of doritas ("Dorita") is not a vocative name…
  assert.equal(isCloseFoodStt("Dorita"), true);
  assert.equal(nameFromTranscriptInfo([T("staff", "Gracias, Dorita.")]), null);
  assert.equal(nameFromTranscriptInfo([T("caller", "Duritas.")]), null);
  // …unless they actually said who they are, or answered the name ask
  assert.equal(callerSelfNamed([T("caller", "Me llamo Dorita.")], "Dorita"), true);
  assert.equal(nameFromTranscriptInfo([T("caller", "Me llamo Dorita.")])?.name, "Dorita");
  assert.equal(nameFromTranscriptInfo([T("staff", "¿A nombre de quién?"), T("caller", "Dorita.")])?.name, "Dorita");
  // a real vocative is untouched
  assert.equal(nameFromTranscriptInfo([T("staff", "Gracias, Martín.")])?.name, "Martín");
  assert.equal(isFoodNameBlocked("Martín", "vocative"), false);
  assert.equal(isFoodNameBlocked("Gerardo", "vocative"), false);
  assert.equal(isFoodNameBlocked("Horacio", "vocative"), false);
  assert.equal(isCloseFoodStt("Gloria"), false);
  assert.equal(shouldPersistOrderName(true, "vocative", d.turns, "Doritas"), false);
  assert.equal(shouldPersistOrderName(true, "vocative", d.turns, "Volcanes"), false);
  assert.equal(shouldPersistOrderName(true, "staff-ask", [T("staff", "¿A nombre de quién?"), T("caller", "Martín.")], "Martín"), true);
});

test("doritas1: unrecognized duritas/volcanes is not a successful add", () => {
  const ack = noUnknownFoodAck({ language: "es", reply: "Muy bien.", actions: [] } as any, { transcript: "Y dos duritas.", language: "es" } as any);
  assert.match(ack.reply, /no lo tengo en el menú/i);
  assert.doesNotMatch(ack.reply, /nacho|quesadilla|gordita|dorad/i);
  assert.equal(ack.actions.length, 0);
  const mapped = noUnknownFoodAck({ language: "es", reply: "Nachos. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-nachos-elvis", quantity: 2 }] } as any, { transcript: "dos volcanes", language: "es" } as any);
  assert.equal(mapped.actions.length, 0);
  assert.match(mapped.reply, /no lo tengo en el menú/i);
  const kept = noUnknownFoodAck({ language: "es", reply: "2 × Taco: taquero, bistec. ¿Algo más?", actions: [{ type: "add_item", itemId: TACO, quantity: 2 }] } as any, { transcript: "dos tacos de bistec", language: "es" } as any);
  assert.equal(kept.actions.length, 1);
  const ask = noUnknownFoodAck({ language: "es", reply: "¿Gorditas?", actions: [] } as any, { transcript: "duritas", language: "es" } as any);
  assert.equal(ask.reply, "¿Gorditas?");
});
