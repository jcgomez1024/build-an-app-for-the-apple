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

test("cecilia1: ¿Qué, qué más? must not overwrite Cecilia, ¿verdad?", () => {
  const turns = [
    { speaker: "staff" as const, text: "Es, está bien, yo le pongo el horario, señora. Cecilia, ¿verdad?" },
    { speaker: "caller" as const, text: "Am, sí." },
    { speaker: "staff" as const, text: "¿Qué, qué más, señora?" },
  ];
  assert.equal(nameFromStaffVocative(turns), "Cecilia");
  assert.equal(nameFromTranscript(turns), "Cecilia");
});

test("suleika1: ¿Tu nombre? → ¿Zuleika? (not Sería todo)", () => {
  const turns = [
    { speaker: "caller" as const, text: "Sería todo." },
    { speaker: "staff" as const, text: "¿Tu nombre?" },
    { speaker: "caller" as const, text: "¿Zuleika?" },
    { speaker: "staff" as const, text: "Dame veinte minutos, bueno, unos quince, veinte, Zuleika, por favor." },
  ];
  assert.equal(nameFromTranscript(turns), "Zuleika");
});
