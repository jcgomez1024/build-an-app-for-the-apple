// relleno2 (CA8f33ce5, Oct 30 8:46 PM ET, Spanish staff-answered, 24 s): "una orden de chiles rellenos" → staff "Chile relleno se me
// acabaron, no hay" → caller "Ahorita hablo para atrás". Elvi rang a Chiles Rellenos Platillo and auto-accepted; must end empty.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-30T20:46:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { staffUnavailable, UNAVAIL_ES } = await import("../../src/spoken-ledger.ts");
const { dropStaffUnavailable } = await import("../../src/order-repair.ts");
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const TURNS = fx("CA8f33ce5-turns.json"), CR = fx("CA8f33ce5-cart.json")[0];
const tt = (TURNS as any[]).map((t) => ({ role: t.speaker === "staff" ? "assistant" : "user", text: t.text }));
test("relleno2: unavailable phrases", () => {
  for (const p of ["se me acabaron", "se acabo", "ya no hay", "ya no tengo", "no me quedan", "no nos queda", "se terminaron", "estan agotados"]) assert.ok(UNAVAIL_ES.test(p), p);
  assert.ok(!UNAVAIL_ES.test("sí hay, claro"));
});
test("relleno2: staffUnavailable finds chile relleno; drop empties the real cart", () => {
  assert.deepEqual(staffUnavailable(TURNS), ["chile relleno"]);
  const cart = [structuredClone(CR)]; dropStaffUnavailable(cart, TURNS); assert.equal(cart.length, 0);
});
test("relleno2: a later re-order after 'se acabaron' is kept", () => {
  const t2 = [...TURNS, { speaker: "caller", text: "Bueno, entonces sí deme el chile relleno de queso que le quede" }];
  const cart = [structuredClone(CR)]; dropStaffUnavailable(cart, t2); assert.equal(cart.length, 1);
});
test("relleno2 replay: re-add passes can't bring it back; no auto-accept; call-back no-order", async () => {
  const run = async (text: string) => /rellenos/i.test(text) ? { actions: [{ type: "add_item", ...CR }], reply: "Chiles rellenos. ¿Con arroz y frijoles?" } : { actions: [{ type: "confirm_order" }], reply: "Listo." };
  const r: any = await shadowOrderFromTurns(TURNS, run as any);
  assert.equal(r.cart.length, 0, JSON.stringify(r.cart)); assert.equal(r.autoAccepted, false); assert.equal(r.noOrder, true);
});
test("relleno2 live: noOfferUnavailable drops the add and takes the carted line back off", async () => {
  const { noOfferUnavailable } = (await import("../../src/elvi.ts")) as any;
  if (typeof noOfferUnavailable !== "function") return;
  const hist = tt.slice(0, 5);
  const out = noOfferUnavailable({ actions: [{ type: "add_item", itemId: CR.itemId }], reply: "¿Con arroz y frijoles?" }, { transcript: "O deja hablo, a ver", history: hist, cart: [CR], language: "es" });
  assert.ok(!out.actions.some((a: any) => a.type === "add_item"));
  assert.ok(out.actions.some((a: any) => a.type === "remove_item" && a.itemId === CR.itemId)); assert.ok(!/arroz/i.test(out.reply));
});
