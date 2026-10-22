// i18n1 + dflt1: bilingual option labels and "it comes with … — want verde instead?" (synthetic data only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { i18n, optionLabel } from "../../src/opt-i18n.js";
import { rbOptionLabel } from "../../src/readback.js";

test("EN shows 'Cheese (Queso)', ES shows 'Queso'", () => {
  assert.equal(optionLabel("Queso / Cheese", "en"), "Cheese (Queso)");
  assert.equal(optionLabel("Queso / Cheese", "es"), "Queso");
  assert.equal(optionLabel("***EXTRA Medium Salsa Verde 2oz (+$0.75)", "es"), "Extra Salsa Verde Media 2oz");
  assert.equal(optionLabel("Cebolla y Chiles Asados", "en"), "Grilled Onions & Peppers (Cebolla y Chiles Asados)");
  assert.equal(optionLabel("SOLO / ONLY Queso Dip", "en"), "Only Queso Dip (Dip de Queso)");
  assert.equal(optionLabel("Grande '12 (+$2.00)", "en"), 'Large 12" (Grande 12")');
  assert.equal(optionLabel("Pico de Gallo", "en"), "Pico de Gallo");
});
test("unknown names fall back to the name, flagged unknown", () => {
  const q = i18n()!.pair("Zzz Test Option 9");
  assert.equal(q.known, false); assert.equal(q.en, "Zzz Test Option 9");
});
test("read-backs use one language", () => {
  assert.equal(rbOptionLabel("1 x EXTRA Huevo (+$1.25)", "extras", "en"), "1 × extra egg");
  assert.equal(rbOptionLabel("Chips", "side", "es"), "totopos");
});

const src = readFileSync(new URL("../../../../apps/web/app.js", import.meta.url), "utf8");
const grab = (re: RegExp) => { const m = src.match(re); assert.ok(m, `missing ${re}`); return m![0]; };
const ctx: any = { rbOptionLabel };
vm.createContext(ctx);
vm.runInContext([grab(/function ui4Plain.*\n/), grab(/const UI4_GENERIC.*\n/), grab(/function defaultChoiceNote[\s\S]*?\n}\n/), "this.note = defaultChoiceNote;"].join("\n"), ctx);
const salsa = { id: "g2", name: "Salsa Options", maxSelections: 1, options: [{ name: "Mild Salsa Asada" }, { name: "Medium Salsa Verde" }, { name: "Hot Salsa Roja" }] };
const line = { item: { name: "Test Enchiladas", modifierGroups: [salsa] }, modifiers: [{ groupId: "g2", groupName: "Salsa Options", option: "Mild Salsa Asada", isDefault: true }] };

test("dflt1: EN states the default salsa and offers verde", () => {
  assert.equal(ctx.note([line], "en"), "It comes with mild asada salsa — want verde or another salsa instead?");
});
test("dflt1: ES", () => {
  assert.equal(ctx.note([line], "es"), "Viene con salsa asada — ¿la quieres verde u otra salsa?");
});
test("dflt1: no note when the customer named it", () => {
  assert.equal(ctx.note([line], "en", "enchiladas with salsa asada"), "");
  assert.equal(ctx.note([{ ...line, modifiers: [{ ...line.modifiers[0], option: "Medium Salsa Verde", isDefault: false }] }], "en"), "");
});
