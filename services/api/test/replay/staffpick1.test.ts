import { test } from "node:test";
import assert from "node:assert/strict";
import { staffPick } from "../../src/call-scoring.ts";
test("staffpick1: staff's stated option answers Elvi's open choice", () => {
  assert.equal(staffPick(["Taco Comal", "Taco Harina", "Taco Taquero"], "Taco normal, taquero."), "Taco Taquero");
  assert.equal(staffPick(["REGULAR Dorada", "DELUXE Preparada"], "Normales. Una de bistec con chorizo,"), "REGULAR Dorada");
  assert.equal(staffPick(["REGULAR Dorada", "DELUXE Preparada"], "Preparadas."), "DELUXE Preparada");
});
test("staffpick1: no pick when staff names none or several", () => {
  assert.equal(staffPick(["Taco Comal", "Taco Harina", "Taco Taquero"], "Sí, sí tenemos."), null);
  assert.equal(staffPick(["Bistec", "Cabeza", "Carnitas", "Chorizo"], "dos de bistec y dos de chorizo"), null);
  assert.equal(staffPick(["Taco Comal", "Taco Harina"], ""), null);
});
