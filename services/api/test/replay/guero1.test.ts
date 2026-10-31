// guero1 (CA0376b4, Oct 31 12:43 PM ET): staff recap = 2 TCO lengua, 1 TCO pastor, 3 QD deluxe sin crema (2 pastor, 1 bistec); name Güero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../../src/list-repair.ts");
const N = await import("../../src/order-name.ts");
const raw = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const menu = Array.isArray(raw) ? raw : raw.menu || raw.items;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}.json`, import.meta.url), "utf8"));
const show = (c: any[]) => c.map((l: any) => `${l.quantity} ${l.itemId} ${l.modifiers.map((m: any) => m.option).filter((o: string) => / \/ /.test(o) && !/Homemade/.test(o)).join("|")}`);

test("guero1: staff recap split over turns rebuilds tacos + deluxe QDs, drops phantoms", () => {
  const d = fx("CA0376b4-guero1"); const c = d.cart.cart; assert.equal(L.applyStaffRecap(c, d.turns, menu), true);
  assert.deepEqual(show(c), ["2 sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L Alpastor / Roasted Pork", "1 sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L Bistec / Steak", "2 sq-taco-TAR7L5 Lengua / Beef Tongue (+$0.50)", "1 sq-taco-TAR7L5 Alpastor / Roasted Pork"]);
  assert.ok(c.filter((l: any) => /deluxe/.test(l.itemId)).every((l: any) => (l.elviNotes || []).some((n: string) => /crema/.test(n))));
});
test("guero1: staff-stated order name after its own name question", () => {
  assert.equal(N.nameFromTranscriptInfo(fx("CA0376b4-guero1").turns)?.name, "Güero");
  assert.equal(N.staffStatedName([{ speaker: "staff", text: "¿Cómo te pongo? Okay." }] as any), null);
});
