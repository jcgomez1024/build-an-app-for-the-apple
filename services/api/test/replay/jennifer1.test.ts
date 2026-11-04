import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.js";
import { applyMenudoCountConfirm } from "../../src/modifier-turns.js";
import { cleanFullName } from "../../src/caller-memory.js";
import { nameFromTranscript, nameFromTranscriptInfo } from "../../src/order-name.js";

// jennifer1 (CA8da140): "dos órdenes de menudo" … "Pues las dos. Y serían tres." … "¿Tres van a ser?" "Sí" ($48) → 3 menudo (mix note), not 2; "Ciao" never a name.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA8da140-jennifer1.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const PATA = "sq-menudo-con-pata-menudo-32oz-y-tortillas-4-JOVEZG";
const line = (q: number) => ({ itemId: PATA, quantity: q, modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }] });
const stub = () => { const r: any = async (t: string) => /dos [oó]rdenes de menudo/i.test(t) ? { actions: [{ type: "add_item", ...line(2) }], reply: "Menudo." } : { actions: [], reply: "Muy bien." }; r.menu = () => M; return r; };

test("jennifer1: staff-confirmed 'tres' → 3 menudo total with mix note", async () => {
  const r: any = await shadowOrderFromTurns(d.turns, stub());
  const ms = r.cart.filter((l: any) => /^sq-menudo/.test(l.itemId));
  assert.equal(ms.reduce((a: number, l: any) => a + l.quantity, 0), 3, JSON.stringify(r.cart));
  assert.match(JSON.stringify(ms), /Mix pancita/);
});
test("jennifer1: unit — count never lowered; no confirm → unchanged", () => {
  const a: any[] = [line(4)]; applyMenudoCountConfirm(a, d.turns); assert.equal(a[0].quantity, 4);
  const b: any[] = [line(2)]; applyMenudoCountConfirm(b, [{ speaker: "caller", text: "dos de menudo" }, { speaker: "staff", text: "¿Tres van a ser?" }, { speaker: "caller", text: "No, dos." }] as any); assert.equal(b[0].quantity, 2);
});
test("jennifer1: goodbyes are never names", () => {
  for (const s of ["Ciao", "Chao", "Bye", "Adiós", "Chau"]) assert.equal(cleanFullName(s), null, s);
  assert.equal(cleanFullName("Jennifer"), "Jennifer");
  assert.equal(nameFromTranscriptInfo(d.turns.slice(-3)), null); // live tail segment "Muchas gracias." / "Ciao."
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "¿A qué nombre pongo su orden?" }, { speaker: "caller", text: "Ciao." }]), null);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Jennifer");
  const n: any = nameFromTranscript(d.turns); assert.notEqual(n && (n.name ?? n), "Ciao");
});
