import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns, tacoSegComal } from "../../src/call-scoring.ts";
import { stampAskedCount, repeatsAddressNumber, liveEtaAddressQty } from "../../src/eta-qty.ts";
const d = JSON.parse(readFileSync(new URL("../fixtures/CA6dd8e7-rodolfo2.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const it = (id: string, n: number, mods: any[]) => ({ type: "add_item", itemId: id, quantity: n, modifiers: mods });
const QCO = (n: number) => it("sq-quesadilla-HLT6CR", n, [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }]);
const TST = (n: number) => it("sq-taco-TAR7L5", n, [{ step: "(A) Taco Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) Carnes / Meats", option: "Bistec / Steak" }]);
const G = (n: number) => it("sq-gordita-M647RE", n, [{ step: "(A) Gordita Options", option: "(GD) Gordita" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }]);
const key = (l: any) => `${l.quantity} ${l.itemId} ${(l.modifiers || []).map((m: any) => (m.option.match(/^\((\w+)\)/) || [])[1]).filter(Boolean).join(",")}`;

test("rodolfo2: replay rings 2 GD, 5 QCO, 4 TST, 2 horchata, then another order of 3 GD", async () => {
  const run: any = async (t: string) => { const p = t.toLowerCase();
    if (/cinco quesadillas/.test(p)) return { actions: [QCO(5), QCO(2), QCO(97), TST(4)], reply: "x" };
    if (/otra orden/.test(p)) return { actions: [TST(2)], reply: "x" };
    if (/tres gorditas/.test(p)) return { actions: [G(3)], reply: "x" };
    return { actions: [], reply: "?" }; };
  run.menu = () => M;
  const r: any = await shadowOrderFromTurns(d.turns, run);
  const k = r.cart.map(key);
  assert.deepEqual(k, ["2 sq-gordita-M647RE GD", "5 sq-quesadilla-HLT6CR QCO", "4 sq-taco-TAR7L5 TST", "2 sq-drink-agua-fresca-horchata-32oz-HL6HPK ", "3 sq-gordita-M647RE GD"]);
  assert.ok(!r.cart.some((l: any) => /TCO/.test(key(l))));
  assert.equal(r.cart[4].person, "plato 2"); assert.ok(!r.cart[1].person);
});
test("rodolfo2: asked-about drink carries into a bare count", () => {
  const turns: any[] = [{ speaker: "caller", text: "¿Sí tiene agua de horchata?" }, { speaker: "staff", text: "Sí." }, { speaker: "caller", text: "Me pone dos, por favor." }];
  stampAskedCount(turns, 0);
  assert.match(turns[2].text, /dos aguas? de horchata/i);
});
test("rodolfo2: house-number echo is not a qty; comal applies only to its own clause", () => {
  assert.ok(repeatsAddressNumber("Sí, 97, 197.", ["Aquí a la 197 Jackson Street"]));
  assert.ok(!repeatsAddressNumber("dos gorditas", ["Aquí a la 197 Jackson Street"]));
  assert.equal(tacoSegComal("cinco quesadillas de comal de bistec y cuatro tacos de tortilla taquera de bistec"), false);
});
test("rodolfo2: live cap drops a house-number line and rebuilds the readback", () => {
  const r = { actions: [QCO(5), QCO(97)], reply: "104 quesadillas de comal: 5 bistec, 97 bistec... $482.00" };
  const out = liveEtaAddressQty(r, { transcript: "cinco quesadillas de comal de bistec, sí 97", history: [{ role: "caller", text: "a la 197 Jackson Street" }], language: "es" });
  assert.equal(out.actions.length, 1); assert.equal(out.actions[0].quantity, 5);
  assert.doesNotMatch(out.reply, /97|104|482/);
});
