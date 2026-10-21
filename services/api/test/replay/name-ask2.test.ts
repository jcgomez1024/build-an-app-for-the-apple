// name2: informal staff asks — synthetic names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromTranscript } from "../../src/order-name.ts";
const T = (ask: string, ans: string) => [{ speaker: "staff" as const, text: "¿Será todo?" }, { speaker: "caller" as const, text: "Sí, por favor." }, { speaker: "staff" as const, text: ask }, { speaker: "caller" as const, text: ans }];
test("name2: '¿Tu nombre?' / '¿Cómo te llamas?' / '¿Nombre?' / 'Your name?' → the caller's answer", () => {
  for (const ask of ["¿Tu nombre?", "¿Cómo te llamas?", "¿Nombre?", "¿Y el nombre?", "Your name?", "Name?"]) assert.equal(nameFromTranscript(T(ask, "Zed.")), "Zed", ask);
  assert.equal(nameFromTranscript(T("¿Quieres rojos o verdes?", "Zed.")), null);
});
test("rec1: 'Okay, está bien, gracias' after the ask is not a name; an answer just before the ask (overlap) is", () => {
  const t = [{ speaker: "caller" as const, text: "sería todo. Zed." }, { speaker: "staff" as const, text: "¿Tu nombre?" }, { speaker: "staff" as const, text: "Dame quince minutos." }, { speaker: "caller" as const, text: "Okay, está bien, gracias." }];
  assert.equal(nameFromTranscript(t), "Zed");
  assert.equal(nameFromTranscript([t[1], t[3]]), null);
});
