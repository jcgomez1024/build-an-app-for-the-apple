import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameFromTranscriptInfo, surnameAfterReadback } from "../../src/order-name.ts";
import { NAME_FILLER } from "../../src/caller-memory.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CAb209cc-juan-uhhuh1.json", import.meta.url), "utf8"));

test("juan-uhhuh1: 'Para Juan.' + 'Uh-huh. Ah, solamente eso' → order name Juan", () => {
  assert.equal((nameFromTranscriptInfo(d.turns) as any)?.name, "Juan");
});
test("juan-uhhuh1: backchannels after the readback never join as a surname; a real surname still does", () => {
  const base = (nx: string) => [{ speaker: "staff" as const, text: "¿Qué nombre sería la orden?" }, { speaker: "caller" as const, text: "Para Juan." },
    { speaker: "staff" as const, text: "Juan, ok, muy bien, ¿algo más?" }, { speaker: "caller" as const, text: nx }];
  for (const f of ["Uh-huh. Ah, solamente eso.", "Mm-hmm. Nada más.", "Ujú, es todo.", "Ajá. Gracias.", "Okey, gracias.", "Uh huh, that's it.", "A-ha, sí."])
    assert.doesNotMatch(String(surnameAfterReadback(base(f), "Juan") ?? "Juan"), /\s/, f);
  assert.equal(surnameAfterReadback(base("Pérez. Sí, gracias."), "Juan"), "Juan Pérez");
  for (const w of ["Uh-huh", "uh huh", "Mm-hmm", "mhm", "Ujú", "Ajá", "Okey", "A-ha"]) assert.ok(NAME_FILLER.test(w), w);
  for (const w of ["Juan", "Pérez", "Uriel", "Mariana"]) assert.ok(!NAME_FILLER.test(w), w);
});
