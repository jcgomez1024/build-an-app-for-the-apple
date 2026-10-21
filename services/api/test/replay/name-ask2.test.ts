// name2: informal staff asks — synthetic names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromTranscript } from "../../src/order-name.ts";
const T = (ask: string, ans: string) => [{ speaker: "staff" as const, text: "¿Será todo?" }, { speaker: "caller" as const, text: "Sí, por favor." }, { speaker: "staff" as const, text: ask }, { speaker: "caller" as const, text: ans }];
test("name2: '¿Tu nombre?' / '¿Cómo te llamas?' / '¿Nombre?' / 'Your name?' → the caller's answer", () => {
  for (const ask of ["¿Tu nombre?", "¿Cómo te llamas?", "¿Nombre?", "¿Y el nombre?", "Your name?", "Name?"]) assert.equal(nameFromTranscript(T(ask, "Zed.")), "Zed", ask);
  assert.equal(nameFromTranscript(T("¿Quieres rojos o verdes?", "Zed.")), null);
});
