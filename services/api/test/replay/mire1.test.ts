// mire1 (CAebae5f, Oct 30): order_name was set to "Mire" from staff "Mire, mándeme la,". Mire/Mira/Mándeme/Mande are fillers, not names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromTranscriptInfo, nameFromAnswer } from "../../src/order-name.ts";
test("mire1: 'Mire, mándeme…' never becomes the order name", () => {
  const turns: any[] = [
    { speaker: "staff", text: "¿Me tiene la dirección?" }, { speaker: "caller", text: "Okay, ahorita, ahorita se lo mando pa' que," },
    { speaker: "staff", text: "Mire, mándeme la," }, { speaker: "caller", text: "pa' que me digas si, si. Ajá, ahorita se lo mando en uno." },
  ];
  const n = nameFromTranscriptInfo(turns)?.name || "";
  assert.ok(!/^(?:mire|mira|m[aá]ndeme|mande)$/iu.test(n), n);
  for (const w of ["Mire", "Mira", "Mándeme", "Mande"]) assert.equal(nameFromAnswer(w), null, w);
});
