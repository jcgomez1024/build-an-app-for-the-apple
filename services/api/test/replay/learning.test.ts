// learn2: synthetic only.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
process.env.ELVI_LEARNING_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "learn2-"));
const K = await import("../../src/elvi-knowledge.ts");
const L = await import("../../src/learning.ts");
const { memoryTurn } = await import("../../src/elvi.ts");
const menu: any[] = [{ id: "torta", name: "Torta", priceCents: 475, modifierGroups: [{ id: "M", name: "(B) Carnes / Meats", options: [{ id: "b", name: "Bistec / Steak" }, { id: "p", name: "Prensado / Spicy Pork" }] }, { id: "X", name: "Extras", options: [{ id: "f", name: "Con Frijoles / With Beans" }] }] }];
const ln = (name: string, q: number, choices: string[]) => ({ baseName: name, name, quantity: q, choices, unitCents: 475, totalCents: 475 * q });

test("learn2: ground truth = customer's words — staff flags correct the ticket", () => {
  const ticket = [ln("Torta", 2, ["Bistec / Steak", "Arroz / Rice"]), ln("Agua", 1, [])];
  const g = L.groundTruth(ticket, [], [{ type: "STAFF_EXTRA", detail: "Torta: Arroz / Rice never mentioned" }, { type: "STAFF_MISSING", detail: "Torta: Con Frijoles / With Beans said, not rung" }, { type: "STAFF_EXTRA", detail: "ticket item never mentioned: 1 × Agua" }]);
  assert.deepEqual(g.lines.map((l) => [l.name, l.choices]), [["Torta", ["Bistec / Steak", "Con Frijoles / With Beans"]]]);
  assert.equal(g.corrected.length, 3);
});
test("learn2: PII stripped from examples", () => {
  assert.equal(L.stripPii("soy Zed, mi numero es 555 010 0199, 123 Main St", ["Zed"]), "soy <NAME>, mi numero es <PHONE>, <ADDRESS>");
});
test("learn2: staff patterns weekly by item/type + both order-to-voice accuracies", () => {
  const ex: any[] = [{ channel: "phone", at: "2026-01-06T17:00:00Z", elviScore: 90, staffScore: 100, staffMisses: [{ kind: "choices", ticket: "Taco · (TCO)", detail: "Taco: wrong tortilla harina vs comal" }] }];
  assert.deepEqual(L.staffPatterns(ex), [{ week: "2026-01-05", item: "Taco", type: "wrong tortilla", count: 1 }]);
  assert.deepEqual(L.voiceAccuracy(ex), [{ week: "2026-01-05", calls: 1, elvi: 90, staff: 100 }]);
});
test("learn2: app example — paid cart weight 1, abandoned 0.2; fine-tune row format", () => {
  const ab = L.appExample("s1", [{ heard: "tres tacos", actions: ["3x sq-taco [(TCO) Taco Comal, Bistec / Steak]"] }])!;
  assert.equal(ab.weight, 0.2); assert.deepEqual(ab.truth, ["3× sq-taco [(TCO) Taco Comal; Bistec / Steak]"]);
  const pd = L.appExample("s2", [{ heard: "tres tacos" }, { event: "checkout", paid: true, cart: [{ id: "sq-taco", quantity: 3, modifiers: [] }] }])!;
  assert.equal(pd.weight, 1);
  assert.deepEqual(L.finetuneRow(pd).messages.map((m) => m.role), ["system", "user", "assistant"]);
});
test("learn2 cross-channel: a correction learned from a PHONE call, once approved, changes the APP's answer to the same phrase", () => {
  const phrase = "me pone dos tortas de prensado con frijoles";
  const input: any = { transcript: phrase, language: "es", menu, resolverMenu: menu };
  assert.equal(memoryTurn(input), null); assert.equal(K.recall(phrase, menu), null); // nothing live before approval
  K.writePending([{ id: "cm-1", dish: "torta", key: K.clauseKey(phrase, menu), phrase, item: "Torta", choices: ["Prensado / Spicy Pork", "Con Frijoles / With Beans"], kind: "clause", source: "ex-phone",
    status: "pending", callRef: "ex-phone", before: { score: 60, lines: [] }, after: { score: 100, lines: [] }, attempts: [], similar: { checked: 1, agree: 1, disagree: 0 }, regression: { suite: "pass", replays: [] }, createdAt: "" } as any]);
  assert.equal(K.recall(phrase, menu), null); // pending ≠ live
  K.decide("cm-1", true, "dev");
  // app live voice (/menu/resolve) and typed chat (chatWithElvi → memoryTurn) both read the same module:
  const app = "una torta de prensado con frijoles por favor";
  const r = K.recall(app, menu)!; assert.equal(r[0].quantity, 1); assert.deepEqual(r[0].modifiers.map((m) => m.option), ["Prensado / Spicy Pork", "Con Frijoles / With Beans"]);
  const chat: any = memoryTurn({ ...input, transcript: app }); assert.equal(chat.actions[0].modifiers.length, 2);
  const src = fs.readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");
  assert.match(src, /menu\/resolve[\s\S]{0,600}recallMemory\(text/); // /menu/resolve consumes the shared memory
});
test("a2: staff rang a said item as a custom amount → truth uses the voice item; tracked as a staff pattern", () => {
  const coke = { ...ln("Coca Cola", 2, ["Coca Cola"]), unitCents: 350, totalCents: 700 };
  const g = L.groundTruth([ln("Torta", 1, []), { ...ln("", 1, []), unitCents: 700, totalCents: 700 }], [ln("Torta", 1, []), coke], [{ type: "CUSTOM_AMOUNT", detail: "custom amount $7.00" }]);
  assert.deepEqual(g.lines.map((l) => [l.name, l.quantity]), [["Torta", 1], ["Coca Cola", 2]]);
  assert.equal(L.errorType({ kind: "missing_item", ticket: "", detail: "Elvi missed 1 × " } as any), "custom amount instead of item");
});
test("a1: an approved slang mapping rewrites phone and app text alike; pending does nothing", () => {
  K.setMemoryOverride([{ id: "sl-1", kind: "slang", from: "taparrosca", to: "refresco", dish: "", key: [], phrase: "taparrosca", item: "", choices: [], source: "t" } as any]);
  assert.equal(K.rewriteSlang("dos con la taparrosca"), "dos con la refresco");
  K.setMemoryOverride([]); assert.equal(K.rewriteSlang("dos con la taparrosca"), "dos con la taparrosca");
  K.setMemoryOverride(null);
});
test("alex1: two nameless custom amounts at staff prices ↔ the two voice items (price order); staff pattern 'custom amount instead of item'", () => {
  const ch = (c: string[], cents: number) => ({ ...ln("Chilaquiles", 1, c), unitCents: cents, totalCents: cents });
  const elvi = [ch([], 1200), ch(["Bistec / Steak"], 1500), { ...ln("Horchata", 1, []), unitCents: 550, totalCents: 550 }];
  const ticket = [{ ...ln("", 1, []), unitCents: 1600, totalCents: 1600 }, { ...ln("Horchata", 1, []), unitCents: 550, totalCents: 550 }, { ...ln("", 1, []), unitCents: 1900, totalCents: 1900 }];
  const g = L.groundTruth(ticket, elvi, [{ type: "CUSTOM_AMOUNT", detail: "custom amount $16.00" }, { type: "CUSTOM_AMOUNT", detail: "custom amount $19.00" }]);
  assert.deepEqual(g.lines.map((l) => [l.name, l.choices]), [["Chilaquiles", []], ["Horchata", []], ["Chilaquiles", ["Bistec / Steak"]]]);
});
test("alex1: custom-amount corrections become 'custom amount instead of item', blank extras dropped", () => {
  const m = L.customAmountMisses([{ kind: "missing_item", detail: "Chilaquiles con Huevo", elvi: "Chilaquiles con Huevo" } as any, { kind: "extra_item", detail: "x", ticket: "1 × " } as any], ["custom amount → Chilaquiles con Huevo"]);
  assert.equal(m.length, 1); assert.equal(L.errorType(m[0]), "custom amount instead of item");
});
