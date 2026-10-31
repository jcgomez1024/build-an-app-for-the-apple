// braulio1 (CA690aaab, Oct 30 8:48 PM ET, Braulio, Spanish staff-answered pickup, 119 s). Right: 2 huaraches. Wrong: phantom 2 QD DELUXE
// tripa ("tortas de tripas bien doradas"), taquero bistec 2 not 3, Queso Torta for "solas", missing notes, rice "Chica" not set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { applyMeatBienDorada, applySolasVerduraAparte, applySpokenCount, applySideSize, liveSideSize } = await import("../../src/list-repair.ts");
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const TURNS = fx("CA690aaab-turns.json"), MENU = fx("CA4bdd506-menu.json");
const fix = () => { const c = fx("CA690aaab-cart.json"); applyMeatBienDorada(c, TURNS); applySpokenCount(c, TURNS); applySolasVerduraAparte(c, TURNS, MENU); applySideSize(c, TURNS, MENU); return c; };
test("braulio1: no QD from 'tortas de tripas bien doradas'; torta gets 'tripa bien dorada' + 'verdura aparte', plain", () => {
  const c = fix();
  assert.ok(!c.some((l: any) => /^sq-qd-/.test(l.itemId)), JSON.stringify(c));
  const t = c.find((l: any) => /^sq-torta-/.test(l.itemId));
  assert.equal(t.quantity, 2); assert.ok(t.elviNotes.includes("tripa bien dorada")); assert.ok(t.elviNotes.includes("verdura aparte"));
  assert.ok(t.modifiers.some((m: any) => m.option === "(TO) Torta")); assert.ok(!t.modifiers.some((m: any) => /Queso Torta/.test(m.option)));
  assert.equal(c.filter((l: any) => /huarache/.test(l.itemId)).length, 2);
});
test("braulio1: 'dos tacos, tres tacos chicos de bistec' → 3 taqueros", () => {
  assert.equal(fix().find((l: any) => /^sq-taco-/.test(l.itemId)).quantity, 3);
});
test("braulio1: rice 'Chica' → Arroz / Rice (regular); grande → GRANDE", () => {
  assert.deepEqual(fix().find((l: any) => /sides-arroz/.test(l.itemId)).modifiers.map((m: any) => m.option), ["Arroz / Rice"]);
  const t2 = TURNS.map((t: any) => (t.text === "Chica." ? { ...t, text: "Grande." } : t)); const c = fx("CA690aaab-cart.json"); applySideSize(c, t2, MENU);
  assert.equal(c.find((l: any) => /sides-arroz/.test(l.itemId)).modifiers[0].option, "GRANDE Arroz - Rice");
});
test("braulio1: real QD dorada orders untouched", () => {
  const c = [{ itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe" }] }];
  applyMeatBienDorada(c, [{ speaker: "caller", text: "dos quesadillas doradas de tripa y una torta de tripa bien dorada" }] as any); assert.equal(c.length, 1);
});
test("braulio1 live: bare 'Chica' after '¿chica o grande?' sets the side size", () => {
  const cart = [{ itemId: "sq-sides-arroz-rice-26S6E6", quantity: 1, modifiers: [] }];
  const r = liveSideSize({ actions: [], reply: "Not added. Did you mean a different item?" }, { transcript: "Chica.", history: [{ role: "assistant", text: "la orden de arroz la quiere chica o grande" }], cart, menu: MENU, language: "es" });
  assert.equal(r.actions[0].type, "update_item"); assert.equal(r.actions[0].modifiers[0].option, "Arroz / Rice"); assert.match(r.reply, /Chica/);
});
