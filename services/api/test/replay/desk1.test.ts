// desk1: a desk-answered order that opens with "¿tiene nachos?" / "¿de qué carne hay?" is not an info-only call. Fake names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuestionOnlyCall } from "../../src/call-scoring.js";
const T = (speaker: "caller" | "staff", text: string) => ({ speaker, text });
test("desk1: order with an info-looking question keeps caller turns", () => {
  assert.equal(isQuestionOnlyCall([T("staff", "Cocina Elvis."), T("caller", "¿Tiene nachos?"), T("caller", "¿Me puede preparar una?"), T("staff", "¿De qué serían?"), T("caller", "¿De qué carne hay?"), T("caller", "de buche, ajá")]), false);
  assert.equal(isQuestionOnlyCall([T("caller", "¿De qué carne hay?"), T("staff", "Okay, Zuleima, dame unos quince minutos.")]), false);
});
test("desk1: a true info-only call is still info-only", () => {
  assert.equal(isQuestionOnlyCall([T("caller", "¿Los frijoles llevan manteca?"), T("staff", "No, son vegetarianos.")]), true);
});
