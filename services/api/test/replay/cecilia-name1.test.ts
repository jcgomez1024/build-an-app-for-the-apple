// cecilia1: staff "Cecilia, ¿verdad?" → name on ticket; compare close to Square typo Caceli
import test from "node:test";
import assert from "node:assert/strict";
import { nameFromTranscript, nameFromStaffVocative } from "../../src/order-name.ts";
import { heardName, compareNames } from "../../src/name-accuracy.ts";

test("cecilia1: 'Cecilia, ¿verdad?' is the order name", () => {
  const turns = [
    { speaker: "staff" as const, text: "Es, está bien, yo le pongo el horario, señora. Cecilia, ¿verdad?" },
    { speaker: "caller" as const, text: "Am, sí." },
  ];
  assert.equal(nameFromStaffVocative(turns), "Cecilia");
  assert.equal(nameFromTranscript(turns), "Cecilia");
  assert.equal(heardName(turns), "Cecilia");
});

test("cecilia1: ¿Name, verdad? and close match to Square typo", () => {
  assert.equal(nameFromStaffVocative([{ speaker: "staff", text: "¿Zuleika, verdad?" }]), "Zuleika");
  assert.equal(compareNames("Cecilia", "Caceli"), "close");
  assert.equal(compareNames("Zuleika", "Suleika"), "close");
  assert.equal(compareNames("Enrique", "Erinque"), "close");
});
