// angel1 (CA898bd1, Oct 31 11:23 AM ET): "¿A nombre de quién sería?" → "De Ángel." + "me conoce como Ángel o hasta Guamas";
// staff misheard nickname "Kawama" became order_name + memory. Should be Ángel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { nameFromTranscriptInfo, directNameAnswer } = await import("../../src/order-name.ts");
const { turns } = JSON.parse(readFileSync(new URL("../fixtures/CA898bd1-angel1.json", import.meta.url), "utf8"));
type T = { speaker: "caller" | "staff"; text: string };
test("angel1: caller's 'De Ángel' beats staff's nickname repeat 'Kawama'", () => {
  assert.equal(directNameAnswer(turns), "Ángel");
  assert.equal(nameFromTranscriptInfo(turns)?.name, "Ángel");
});
test("angel1 general: 'me dicen X' nickname never beats 'Para X' answer", () => {
  const t: T[] = [{ speaker: "staff", text: "¿Su nombre?" }, { speaker: "caller", text: "Para Roberto." }, { speaker: "staff", text: "Roberto." },
    { speaker: "caller", text: "Sí, pero me dicen Beto." }, { speaker: "staff", text: "Okay, Beto." }];
  assert.notEqual(nameFromTranscriptInfo(t)?.name, "Beto");
});
