// rolando1 (CA4f6740, Oct 31 1:21 PM ET): 3 QCO bistec, 2 QD preparadas bistec ("las que dicen verdura"), 2 gorditas bistec; name Rolando.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const N = await import("../../src/order-name.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const meats = (l: any) => l.modifiers.map((m: any) => m.option).filter((o: string) => / \/ /.test(o) && !/Homemade|Gordita|Dorada|Preparada/.test(o)).sort().join("+");
const show = (c: any[]) => c.map((l: any) => `${l.quantity} ${l.itemId.split("-").slice(0, 2).join("-")} ${meats(l)}`);

test("rolando1: split staff recap 'tengo en la primera orden… dos doradas de biste' + 'las que dicen verdura' = 2 QD DELUXE", () => {
  const d = fx("CA4f6740-rolando1"); const c = d.cart.cart; L.applyStaffRecap(c, d.turns, menu);
  assert.deepEqual(show(c), ["2 sq-qd Bistec / Steak", "3 sq-quesadilla Bistec / Steak", "2 sq-gordita Bistec / Steak"]);
  assert.match(c[0].itemId, /deluxe-preparada/);
});
test("rolando1: stutter-hyphen names normalize", () => {
  assert.equal(N.nameFromTranscriptInfo(fx("CA4f6740-rolando1").turns)?.name, "Rolando");
  assert.equal(N.destutterName("Ro-Rolando"), "Rolando"); assert.equal(N.destutterName("Jean-Pierre"), "Jean-Pierre"); assert.equal(N.destutterName("Ana Maria"), "Ana Maria");
});
