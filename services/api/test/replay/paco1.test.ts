// paco1 (CAcadbe8d, Oct 30 10:32 AM ET): 4 QCO quesadillas (papas con rajas, picadillo, huevo con chile, deshebrada);
// "una de …, otra de …, otra de …" is one line each; huevo con chile / guisados are real fillings — never denied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { expandOtraList, noFalseFillingDenial } from "../../src/elvi.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CAcadbe8d-turns.json", import.meta.url), "utf8"));
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join("|");

test("paco1: replay → 4 QCO quesadillas, one per filling", async () => {
  const r: any = await shadowOrderFromTurns(turns, (async () => ({ reply: "¿Algo más?", actions: [] })) as any);
  const q = r.cart.filter((l: any) => l.itemId === "sq-quesadilla-HLT6CR");
  assert.equal(q.reduce((n: number, l: any) => n + l.quantity, 0), 4);
  assert.equal(r.cart.length, 4);
  assert.ok(q.every((l: any) => /\(QCO\)/.test(opts(l))));
  for (const f of ["Papas Con Rajas", "Picadillo", "Huevo con Chile", "Deshebrada"]) assert.equal(q.filter((l: any) => opts(l).includes(f)).length, 1, f);
});

test("paco1: live — 'una quesadilla de A, otra de B, otra de C' names the dish on every una/otra", () => {
  assert.equal(expandOtraList("Me puede dar una quesadilla, ah, de papas con rajas, otra de picadillo, otra de huevo con chile,"),
    "Me puede dar una quesadilla de papas con rajas, una quesadilla de picadillo, una quesadilla de huevo con chile,");
  assert.equal(expandOtraList("dos tacos de bistec"), "dos tacos de bistec");
});

test("paco1: live — Elvi never says huevo con chile / guisado quesadillas aren't on the menu", () => {
  const r: any = noFalseFillingDenial({ language: "es", reply: "No, eso no está en el menú. ¿Le gustaría otra cosa?", actions: [] } as any,
    { language: "es", transcript: "Hola, ah, quería ver si tienen quesadillas de guisado o de huevo con chile." } as any);
  assert.doesNotMatch(r.reply, /no está en el menú/);
  assert.match(r.reply, /^Sí, tenemos quesadillas de huevo con chile/);
  assert.match(r.reply, /papas con rajas/);
  const keep: any = noFalseFillingDenial({ language: "es", reply: "No tenemos mole hoy.", actions: [] } as any, { language: "es", transcript: "¿tienen mole?" } as any);
  assert.equal(keep.reply, "No tenemos mole hoy.");
});
