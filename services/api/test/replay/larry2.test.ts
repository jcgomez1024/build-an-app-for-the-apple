// larry2 (CA04884ea, Oct 30 12:42 PM ET, English pickup, staff-answered).
// Staff read-back: 2 quesadillas (1 flour, 1 homemade), 8 flour steak quesadillas, 2 grande steak burritos deluxe w/ rice & beans,
// 2 steak street tacos, 2 onions & peppers. Elvi rang only the 8 quesadillas + 2 tacos; "Oh, the peppers" re-added the tacos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA04884ea-turns.json", import.meta.url), "utf8"));
const Q = "sq-quesadilla-HLT6CR", B = "sq-burrito-TGWBEN", TC = "sq-taco-TAR7L5", X = "sq-extras-mild-salsa-asada-2oz-T6PGNT";
const TACO = { type: "add_item", itemId: TC, quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] };
const miss = async (t: string) => {
  if (/eight of your steak quesadillas/i.test(t)) return { reply: "ok", actions: [{ type: "add_item", itemId: Q, quantity: 8, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }] };
  if (/street tacos|the peppers/i.test(t)) return { reply: "ok", actions: [TACO] };
  return { reply: "ok", actions: [] };
};
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join("|");
const units = (ls: any[]) => ls.reduce((n, l) => n + l.quantity, 0);
test("larry2: read-back fills 2 plain quesadillas, 2 grande steak deluxe burritos, 2 onions & peppers", async () => {
  const c = (await shadowOrderFromTurns(turns, miss as any) as any).cart;
  const q = c.filter((l: any) => l.itemId === Q);
  assert.equal(units(q), 10);
  assert.equal(units(q.filter((l: any) => /Bistec/.test(opts(l)))), 8);
  assert.ok(q.some((l: any) => /QCO/.test(opts(l)) && !/Bistec/.test(opts(l))) && q.some((l: any) => /QHR/.test(opts(l)) && !/Bistec/.test(opts(l))));
  const b = c.filter((l: any) => l.itemId === B);
  assert.equal(units(b), 2);
  for (const re of [/Grande/, /Bistec/, /Arroz/, /Frijoles/, /DELUXE/]) assert.ok(b.every((l: any) => re.test(opts(l))), opts(b[0]));
  assert.equal(units(c.filter((l: any) => l.itemId === TC)), 2);
  assert.equal(units(c.filter((l: any) => l.itemId === X && /Cebolla y Chiles/.test(opts(l)))), 2);
});
