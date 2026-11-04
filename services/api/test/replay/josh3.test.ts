import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns, isClosing } from "../../src/call-scoring.js";
import { nameFromAnswer, nameFromStaffAsk } from "../../src/order-name.js";
import { cleanFullName } from "../../src/caller-memory.js";
import { applySharedAliases } from "../../src/aliases.js";
import { addToThatAsUpdate, applyStaffDrinkConfirm } from "../../src/modifier-turns.js";

// josh3 (CA1fb72332): large chicken burrito, "add chorizo to that", "double meat", "that's all. Josh. … one of those cinnamon drinks" → horchata.
const d = JSON.parse(readFileSync(new URL("../fixtures/CA1fb723-josh3.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const B = "sq-burrito-TGWBEN", H = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
const G = { step: "(A) Burrito Size", option: "Grande '12 (+$3.00)" };
const meat = (o: string) => ({ step: "(B) Burrito Carne Options", option: o });
const stub = (drink: boolean) => { const r: any = async (t: string) => {
  if (/chicken burrito/i.test(t)) return { actions: [{ type: "add_item", itemId: B, quantity: 1, modifiers: [G, meat("Pollo / Chicken")] }], reply: "Burrito: large, chicken." };
  if (/add chorizo/i.test(t)) return { actions: [{ type: "add_item", itemId: B, quantity: 1, modifiers: [G, meat("Chorizo / Mexican Sausage")] }], reply: "Burrito: large, chorizo." };
  if (/double meat/i.test(t)) return { actions: [{ type: "update_item", itemId: B, quantity: 1, modifiers: [meat("Chorizo / Mexican Sausage"), meat("Pollo / Chicken"), G] }], reply: "Burrito: chorizo and chicken." };
  if (drink && /horchata/i.test(t)) return { actions: [{ type: "add_item", itemId: H, quantity: 1, modifiers: [] }], reply: "Horchata." };
  return { actions: [], reply: "Anything else?" }; }; r.menu = () => M; return r; };
const check = (cart: any[]) => {
  const bs = cart.filter((l) => l.itemId === B); assert.equal(bs.length, 1, JSON.stringify(cart));
  const o = JSON.stringify(bs[0].modifiers); assert.match(o, /Pollo/); assert.match(o, /Chorizo/); assert.match(o, /Grande/);
  assert.equal(cart.filter((l) => l.itemId === H).reduce((s, l) => s + l.quantity, 0), 1, JSON.stringify(cart));
};
test("josh3: one large burrito chicken+chorizo + 1 horchata (model rings the drink)", async () => { check((await shadowOrderFromTurns(d.turns, stub(true)) as any).cart); });
test("josh3: staff 'one horchata' confirms the drink after-call even if the model rang nothing", async () => { check((await shadowOrderFromTurns(d.turns, stub(false)) as any).cart); });
test("josh3: closings are never names; the name is Josh", () => {
  for (const s of ["No, that's all.", "That s all", "that's it", "That'll be all", "eso es todo"]) assert.equal(nameFromAnswer(s), null, s);
  for (const s of ["That S All", "That's It", "That'll Be All"]) assert.equal(cleanFullName(s), null, s);
  assert.equal(nameFromAnswer("No, that's all. Josh."), "Josh");
  assert.equal(nameFromStaffAsk(d.turns), "Josh");
  assert.equal(nameFromAnswer("It's under Thatcher"), "Thatcher");
});
test("josh3: an order in a closing turn is not a closing; cinnamon drink alias", () => {
  assert.equal(isClosing("No, that's all Josh. Oh, you know what, can I get one of those cinnamon drinks?"), false);
  assert.equal(isClosing("No, that's all."), true);
  assert.match(applySharedAliases("one of those cinnamon drinks", "phone"), /horchata/);
  assert.doesNotMatch(applySharedAliases("cinnamon churros", "phone"), /horchata/);
});
test("josh3: add-to-that / double meat units; staff drink confirm needs a caller drink ask", () => {
  const cart = [{ itemId: B, quantity: 1, modifiers: [G, meat("Pollo / Chicken")] }];
  const a: any[] = [{ type: "add_item", itemId: B, quantity: 1, modifiers: [G, meat("Chorizo / Mexican Sausage")] }];
  assert.equal(addToThatAsUpdate(a, cart, "can you add chorizo to that too"), true); assert.equal(a[0].type, "update_item");
  assert.equal(a[0].modifiers.length, 3);
  const b: any[] = [{ type: "add_item", itemId: B, quantity: 1, modifiers: [G, meat("Chorizo / Mexican Sausage")] }];
  assert.equal(addToThatAsUpdate(b, cart, "and another large chorizo burrito"), false); assert.equal(b[0].type, "add_item");
  const c: any[] = []; applyStaffDrinkConfirm(c, [{ speaker: "caller", text: "my name is Ana" }, { speaker: "staff", text: "Got it, one horchata." }]); assert.equal(c.length, 0);
});
