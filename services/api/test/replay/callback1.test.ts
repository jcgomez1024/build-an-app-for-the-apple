// callback1 (CA8e3de9a540a201d103dfe502e5df4aa2, Oct 30 7:26 PM ET, English, staff-answered, 28 s): availability only —
// pozole verde (no), ceviche ("Not today."), camarones (yes, cocktail) — then "I will call you back". Elvi rang 1 Ceviche
// de Pescado (final ticket), said "Yes, we have ceviche" after staff's "Not today", and named the order "Bye".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAvailQ, staffUnavailable } from "../../src/spoken-ledger.ts";
import { shadowOrderFromTurns, isCallBackNoOrder } from "../../src/call-scoring.ts";
import { noOfferUnavailable } from "../../src/elvi.ts";
import { isNumberName } from "../../src/order-name.ts";
import { dropStaffUnavailable } from "../../src/order-repair.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA8e3de9a-turns.json", import.meta.url), "utf8"));
const CEV = "sq-ceviche-ceviche-de-pescado-fish-IRLHUM";

test("callback1: English availability questions are not orders; Spanish ¿tiene/hay still are", () => {
  for (const s of ["Hi, I was calling to see if you guys have, pozole verde.", "Okay, how about ceviche?", "What about tamales?", "Is there menudo today?", "Any birria today?", "Do you have chiles rellenos?", "¿Tienen pozole?", "Hay menudo?"]) assert.equal(isAvailQ(s), true, s);
  for (const s of ["Can I get two tacos de asada?", "I'll take the ceviche", "Dame una quesadilla de bistec", "Quiero dos tacos"]) assert.equal(isAvailQ(s), false, s);
});

test("callback1: staff 'Not today' / 'we don't have' marks the asked dish unavailable", () => {
  assert.deepEqual(staffUnavailable(turns).sort(), ["ceviche", "pozole"]);
});

test("callback1 live: 'Yes, we have ceviche' after staff 'Not today' is corrected and the add dropped", () => {
  const history = turns.slice(0, 6).map((t: any) => ({ role: t.speaker === "staff" ? "assistant" : "customer", text: t.text }));
  const o: any = noOfferUnavailable({ language: "en", reply: "Yes, we have ceviche. Which ceviche?", actions: [{ type: "add_item", itemId: CEV, quantity: 1 }] } as any, { transcript: "Camarones?", language: "en", history, menu: [] } as any);
  assert.equal(o.actions.length, 0); assert.match(o.reply, /isn't available/); assert.doesNotMatch(o.reply, /we have ceviche/i);
});

test("callback1: call-back with no order language → no cart, not a final ticket", async () => {
  assert.equal(isCallBackNoOrder(turns), true);
  const r: any = await shadowOrderFromTurns(structuredClone(turns), Object.assign(async () => ({ reply: "Yes, we have ceviche.", actions: [{ type: "add_item", itemId: CEV, quantity: 1 }] }), { menu: () => [] }) as any);
  assert.deepEqual(r.cart, []); assert.equal(r.statusCall, true);
  // a real order that ends with "I'll call you back if…" still orders
  assert.equal(isCallBackNoOrder([{ speaker: "caller", text: "Can I get two tacos de asada?" }, { speaker: "caller", text: "I'll call you back if I need more" }]), false);
});

test("callback1 post-call: an unavailable dish is dropped unless reordered", () => {
  const cart: any[] = [{ itemId: CEV, quantity: 1, modifiers: [], asked: true }];
  assert.ok(dropStaffUnavailable(cart, turns)); assert.equal(cart.length, 0);
});

test("callback1: Bye/goodbye/thanks/later are never an order name", () => {
  for (const n of ["Bye", "Goodbye", "Thanks", "Thank you", "Later", "Bye-bye", "Gracias"]) assert.equal(isNumberName(n), true, n);
  assert.equal(isNumberName("Nicky"), false);
});
