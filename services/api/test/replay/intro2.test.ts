// intro2: anonymized 8:03 PM 10/23 desk call. "Bueno, eh, quiero hacer una orden." is an order intro, never a dish;
// "quesidita" is the STT spelling of gordita. No name, phone or address.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, cleanPhrase, type CallTurn } from "../../src/call-scoring.ts";

const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn => ({ speaker, start, end: start + 1, text, language: "es" });
test("intro2: filler 'eh' before 'quiero hacer una orden' is still only an intro", async () => {
  const heard: string[] = [];
  const r: any = await shadowOrderFromTurns([
    T("staff", "Cocina Elvis.", 0), T("caller", "Bueno, eh, quiero hacer una orden.", 2), T("staff", "Sí, dígame.", 5),
  ], (async (text: string) => { heard.push(text); return { reply: "Torta: ¿Bistec?", actions: [] }; }) as any);
  assert.ok(!heard.some((h) => /orden/i.test(h)), JSON.stringify(heard));
  assert.ok((r.steps || []).some((s: any) => s.source === "caller-intro"));
});
test("intro2: 'quesidita' is a gordita", () => {
  assert.match(cleanPhrase("y una quesidita de chicharrón duro"), /gordita/);
});
