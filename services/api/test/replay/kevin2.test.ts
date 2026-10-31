// kevin2 (CAdd19f3, Oct 31 6:51 PM ET): esquite asked + "¿con tajín?" "Sí" never rang; name "Solamente" from "Solamente a nombre de Kevin".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const N = await import("../../src/order-name.ts");
const CM = await import("../../src/caller-memory.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const d = JSON.parse(readFileSync(new URL("../fixtures/CAdd19f3-kevin1.json", import.meta.url), "utf8"));
test("kevin2: asked esquite added with tajín; birrias + tacos untouched", () => {
  const c = structuredClone(d.cart.cart); assert.ok(L.addAskedEsquite(c, d.turns, menu));
  assert.equal(c.length, 3); const e = c[2]; assert.match(e.itemId, /^sq-esquite-/); assert.equal(e.quantity, 1);
  assert.deepEqual(e.modifiers.map((m: any) => m.option), ["Tajin / Chilli Powder"]);
  assert.equal(L.addAskedEsquite(c, d.turns, menu), false);
});
test("kevin2: live-added bare esquite gets tajín after-call; 'sin tajín' → NO TAJIN; no esquite → nothing", () => {
  const c: any[] = [{ itemId: "sq-esquite-elvis-esquite-16oz-SGPEZK", quantity: 1, modifiers: [] }];
  assert.ok(L.addAskedEsquite(c, d.turns, menu)); assert.match(c[0].modifiers[0].option, /^Tajin/);
  const c2: any[] = []; assert.ok(L.addAskedEsquite(c2, [{ speaker: "caller", text: "dos esquites sin tajín" }] as any, menu));
  assert.equal(c2[0].quantity, 2); assert.match(c2[0].modifiers[0].option, /NO TAJIN/);
  assert.equal(L.addAskedEsquite([], [{ speaker: "caller", text: "dos tacos" }] as any, menu), false);
});
test("kevin2 live: 'un esquite, por favor' adds one esquite", () => {
  const r = L.liveEsquiteAsk({ actions: [] }, { transcript: "Eh, un esquite, por favor.", cart: [] });
  assert.equal(r.actions.length, 1); assert.match(r.actions[0].itemId, /^sq-esquite-/);
  assert.equal(L.liveEsquiteAsk({ actions: [] }, { transcript: "esquite", cart: [{ itemId: "sq-esquite-x" }] }).actions.length, 0);
});
test("kevin2: leading filler skipped before 'a nombre de'; filler words never names", () => {
  assert.equal(N.nameFromTranscriptInfo(d.turns)?.name, "Kevin");
  assert.equal(N.nameFromTranscriptInfo([{ speaker: "caller", text: "Nomás a nombre de Ana, por favor." }] as any)?.name, "Ana");
  assert.equal(N.nameFromTranscriptInfo([{ speaker: "staff", text: "¿A nombre de quién?" }, { speaker: "caller", text: "Solamente." }] as any)?.name ?? null, null);
});
test("kevin2b: late tortilla choice — 'el del comal está bien' → QCO queso birrias; '¿No tiene taqueras?' 'Sí' → TST bistec", () => {
  const c = structuredClone(d.cart.cart); assert.ok(L.applyLateTortillaChoice(c, d.turns, menu));
  const ops = (l: any) => l.modifiers.map((m: any) => m.option).join(" ");
  assert.match(ops(c[0]), /\(QCO\) 3 x Queso Birrias/); assert.doesNotMatch(ops(c[0]), /\(QST\)/);
  assert.match(ops(c[1]), /\(TST\)/); assert.doesNotMatch(ops(c[1]), /\(TCO\)/);
  assert.equal(L.applyLateTortillaChoice(c, d.turns, menu), false);
});
test("kevin2b: staff listing both prices + caller 'okay' picks nothing", () => {
  const c = [{ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(A) T Tortilla Options", option: "(TCO) Taco Comal / Homemade (+$1.00)" }] }];
  assert.equal(L.applyLateTortillaChoice(c, [{ speaker: "caller", text: "dos tacos" }, { speaker: "staff", text: "los de comal a cuatro y taqueros a tres" }, { speaker: "caller", text: "okay" }] as any, menu), false);
});
