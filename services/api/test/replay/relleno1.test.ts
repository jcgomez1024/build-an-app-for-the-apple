// relleno1 + pickup1 + yesopt1 + orders1: synthetic, no PII.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowOrderFromTurns, isClosing, type CallTurn } from "../../src/call-scoring.ts";
import { normalizeSpokenCatalogAliases } from "../../src/text-intents.ts";
const T = (speaker: "caller" | "staff", text: string, start: number): CallTurn => ({ speaker, start, end: start + 1, text, language: "en" });
test("relleno1: misheard chiles rellenos normalize; other chile words don't", () => {
  for (const s of ["chili rainos", "chile reyenos", "chilly rellanos", "chile relleno"]) assert.match(normalizeSpokenCatalogAliases(s), /chiles rellenos/i, s);
  for (const s of ["chili beans", "chile verde"]) assert.doesNotMatch(normalizeSpokenCatalogAliases(s), /rellenos/i, s);
});
test("orders1: 'that's it, I'd like five orders' is not a goodbye", () => {
  assert.equal(isClosing("that's it, I'd like, I would like five orders if that's okay."), false);
  assert.equal(isClosing("that's it, thank you"), true);
});
test("pickup1/yesopt1/orders1: dish asked about, sides answered to staff, then 'five orders'", async () => {
  const line = { type: "add_item", itemId: "sq-plate-X", quantity: 1, modifiers: [{ step: "Lado", option: "Rice and Beans" }, { step: "Tortilla", option: "Flour" }] };
  const seen: string[] = [];
  const run = async (text: string) => { seen.push(text);
    if (/^Plate X, Rice and Beans, flour$/i.test(text)) return { reply: "Plate X: rice and beans, flour. Anything else?", actions: [line] };
    if (/plate x/i.test(text)) return { reply: "Plate X: Rice and Beans, SOLO Rice or SOLO Beans? And Corn Tortilla or Flour Tortilla?", actions: [] };
    return { reply: "Plate X: Rice and Beans, SOLO Rice or SOLO Beans?", actions: [] }; };
  const r: any = await shadowOrderFromTurns([
    T("caller", "do you have plate x today?", 0), T("staff", "Yes we have. You like a rice and beans?", 2),
    T("caller", "can I order some for pickup, yes, please. flour.", 4), T("staff", "Okay, anything else?", 6),
    T("caller", "that's it, I would like five orders if that's okay.", 8), T("staff", "Name for the order?", 10), T("caller", "Thank you.", 12)], run as any);
  assert.ok(seen.includes("Plate X, Rice and Beans, flour"), seen.join(" | "));
  assert.deepEqual(r.cart.map((l: any) => [l.itemId, l.quantity]), [["sq-plate-X", 5]]);
});
