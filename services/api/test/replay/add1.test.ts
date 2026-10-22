// add1: manual card/sheet adds and "change the salsa to verde" with no voice session (synthetic data only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../../../../apps/web/app.js", import.meta.url), "utf8");
const grab = (re: RegExp) => { const m = src.match(re); assert.ok(m, `missing ${re}`); return m![0]; };
const ctx: Record<string, unknown> = {};
vm.createContext(ctx);
vm.runInContext([
  grab(/function optionDisplayName[\s\S]*?\n}\n/),
  grab(/function ui4Plain.*\n/),
  grab(/function ui4CorrectionText[\s\S]*?\n}\n/),
  grab(/const UI4_GENERIC[\s\S]*?function ui4TokenPick[\s\S]*?\n}\n/),
  "this.f = { optionDisplayName, ui4CorrectionText, ui4TokenPick };"
].join("\n"), ctx);
const f = (ctx as any).f;
const salsa = { id: "g1", options: [{ name: "Mild Salsa Asada" }, { name: "Medium Salsa Verde" }, { name: "Hot Salsa Roja" }] };

test("option sets compare names, not [object Object]", () => {
  assert.ok(!/options \|\| \[\]\)\.map\(\(o\) => String\(o\)\)/.test(src));
  assert.equal(f.optionDisplayName({ name: "Queso / Cheese" }), "Queso / Cheese");
});
test("checkout does not call an undefined helper", () => {
  assert.ok(!src.includes("describeCurrentOrderForSpeech()"));
});
test("'change the salsa to verde not asada' picks verde", () => {
  const t = f.ui4CorrectionText("could you change the salsa to verde not asada");
  assert.ok(!t.includes("asada"));
  assert.equal(f.ui4TokenPick(salsa, t)?.name, "Medium Salsa Verde");
});
test("ES: 'cambia la salsa a verde en vez de asada'", () => {
  assert.equal(f.ui4TokenPick(salsa, f.ui4CorrectionText("cambia la salsa a verde en vez de asada"))?.name, "Medium Salsa Verde");
});
test("generic words alone pick nothing", () => {
  assert.equal(f.ui4TokenPick(salsa, f.ui4CorrectionText("change the salsa")), null);
});
