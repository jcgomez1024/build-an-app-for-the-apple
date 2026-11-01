import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA21471f-luis-phantoms1.json", import.meta.url), "utf8"));
const none = (async () => ({ reply: "", actions: [] })) as any;
const opts = (l: any) => (l.modifiers || []).map((m: any) => m.option).join(" ");
test("luis-phantoms1: repeated 'una quesadilla de chorizo' (comal) adds no QD", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, none);
  assert.ok(!r.cart.some((l: any) => /T5STUH|ZZAV3L/.test(l.itemId)));
});
test("luis-phantoms1: 'un taco de bistec' after gorditas adds no gordita bistec", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, none);
  assert.ok(!r.cart.some((l: any) => /gordita/.test(l.itemId) && /Bistec/.test(opts(l))));
  assert.equal(r.cart.filter((l: any) => /gordita/.test(l.itemId)).length, 2);
});
test("luis-phantoms1 rule: bare 'y una de bistec' after a gordita still adds a gordita", async () => {
  const t: any = [{ speaker: "caller", text: "me da una gordita de chorizo" }, { speaker: "staff", text: "¿Qué más?" }, { speaker: "caller", text: "y una de bistec" }, { speaker: "staff", text: "¿Qué más?" }];
  const r: any = await shadowOrderFromTurns(t, none);
  assert.ok(r.cart.some((l: any) => /gordita/.test(l.itemId) && /Bistec/.test(opts(l))));
});
