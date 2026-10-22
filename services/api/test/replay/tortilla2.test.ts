import test from "node:test"; import assert from "node:assert/strict";
import { caseFix } from "../../src/elvi.js"; import { auditCall } from "../../src/auditor.js"; import { ticketLines, tortillaUnconfirmed } from "../../src/call-accuracy.js";
const menu: any[] = [{ id: "plat", name: "Guisado Platillo", priceCents: 1400, modifierGroups: [
  { id: "T", name: "(C) Tortilla Options", minSelections: 1, maxSelections: 1, options: [{ id: "c", name: "3 x (Corn) Corn Tortilla" }, { id: "h", name: "3 x (Flour) Harina Tortilla" }] },
  { id: "X", name: "(CC) EXTRA Tortillas", minSelections: 0, options: [{ id: "xc", name: "***EXTRA 3 x Comal / Homemade Tortilla (+$4.00)", priceDeltaCents: 400 }, { id: "xh", name: "***EXTRA 3 x Harina / Four Tortilla (+$4.00)", priceDeltaCents: 400 }] }] }];
const run = (transcript: string, mods: string[]) => caseFix({ reply: "ok", actions: [{ type: "add_item", itemId: "plat", quantity: 1, modifiers: mods.map((option) => ({ step: "", option })) }] } as any,
  { transcript, history: [], menu, language: "es" } as any) as any;
test("tortilla3: no type said → Elvi asks ¿comal o harina? instead of defaulting", () => {
  const r = run("un platillo de guisado", ["3 x (Corn) Corn Tortilla"]);
  assert.equal(r.actions.length, 0); assert.match(r.reply, /comal o harina/);
});
test("tortilla2: 'más tortillas' = the paid Extras add-on, one type only", () => {
  const r = run("un platillo de guisado de harina y más tortillas", ["3 x (Corn) Corn Tortilla", "3 x (Flour) Harina Tortilla"]);
  const o = r.actions[0].modifiers.map((m: any) => m.option);
  assert.deepEqual(o.filter((x: string) => /^3 x/.test(x)), ["3 x (Flour) Harina Tortilla"]);
  assert.ok(o.some((x: string) => /EXTRA 3 x Harina/.test(x)), o.join("|"));
  const r2 = run("un platillo de guisado de harina", ["3 x (Flour) Harina Tortilla", "***EXTRA 3 x Harina / Four Tortilla (+$4.00)"]);
  assert.ok(!r2.actions[0].modifiers.some((m: any) => /EXTRA/.test(m.option)));
});
const audit = (texts: string[], mods: any[], elviChoices: string[] = []) => {
  const t = ticketLines({ line_items: [{ name: "Guisado Platillo", catalog_object_id: "V9", quantity: "1", gross_sales_money: { amount: 1400 }, modifiers: mods }] })[0];
  const e = { name: "Guisado Platillo", quantity: 1, choices: elviChoices, unitCents: 1400, totalCents: 1400 };
  const turns = texts.map((text, i) => ({ speaker: i % 2 ? "staff" : "caller", text }));
  return auditCall({ recordingSid: "R", at: new Date(0).toISOString(), recordingSec: 60, turns, elvi: [e], ticket: { lines: [t] }, pairs: [{ ticket: t, elvi: e }] })!.flags;
};
const H = { name: "3 x (Flour) Harina Tortilla", total_price_money: { amount: 0 } }, XH = { name: "***EXTRA 3 x Harina / Four Tortilla (+$4.00)", total_price_money: { amount: 400 } };
test("tortilla2: Extras rung but never asked flags; asked but not rung flags", () => {
  assert.ok(audit(["un platillo de guisado de harina"], [H, XH]).some((f) => f.type === "STAFF_EXTRA" && /EXTRA/.test(f.detail)));
  assert.ok(audit(["un platillo de guisado de harina con extra tortillas"], [H], ["3 x (Flour) Harina Tortilla", XH.name]).some((f) => f.type === "STAFF_MISSING" && /EXTRA/.test(f.detail)));
});
test("tortilla3: type never said nor confirmed → minor TORTILLA_UNCONFIRMED; said or confirmed → none", () => {
  assert.ok(audit(["un platillo de guisado"], [H]).some((f) => f.type === "TORTILLA_UNCONFIRMED"));
  assert.ok(!audit(["un platillo de guisado", "¿de comal o harina?", "harina"], [H]).some((f) => f.type === "TORTILLA_UNCONFIRMED"));
  assert.ok(!audit(["un platillo de guisado con harina"], [H]).some((f) => /TORTILLA_UNCONFIRMED|STAFF_EXTRA/.test(f.type)));
  assert.deepEqual(tortillaUnconfirmed([{ text: "guisado" }], [{ name: "P", quantity: 1, choices: [XH.name], unitCents: 0, totalCents: 0 }]), []);
});
