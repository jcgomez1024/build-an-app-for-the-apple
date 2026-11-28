import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCodeAliases } from "../../src/aliases.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the older spelling fixes are unchanged and still unrecorded", () => {
  const lock = JSON.parse(readFileSync(path.join(root, "data/offline/spelling-fixes-frozen.json"), "utf8"));
  const file = path.join(root, "data/aliases/code-aliases.json");
  const raw = readFileSync(file);
  const hash = createHash("sha256").update(raw).digest("hex");
  assert.equal(hash, lock.sha256);
  const rows = JSON.parse(raw.toString()).aliases;
  assert.equal(rows.length, lock.rows);
  assert.equal(rows.every((row: { approved?: string }) => row.approved === "unrecorded"), true);
});

test("code-aliases.json fails loudly when it is missing or invalid", () => {
  assert.throws(() => assertCodeAliases(path.join(root, "data/aliases/no-such-code-aliases.json")), /missing/);
  const dir = mkdtempSync(path.join(tmpdir(), "elvi-aliases-"));
  const badJson = path.join(dir, "bad.json");
  writeFileSync(badJson, "{");
  assert.throws(() => assertCodeAliases(badJson), /not valid JSON/);
  const badRule = path.join(dir, "rule.json");
  writeFileSync(badRule, JSON.stringify({ aliases: [{ id: "broken", match: "(", to: "x" }] }));
  assert.throws(() => assertCodeAliases(badRule), /invalid pattern/);
  assert.doesNotThrow(() => assertCodeAliases(path.join(root, "data/aliases/code-aliases.json")));
});

test("the twelve offline rules replace the never-do list without touching the live prompt", () => {
  const rules = JSON.parse(readFileSync(path.join(root, "data/offline/never-do-12.json"), "utf8"));
  assert.equal(rules.preamble, "Rules (accuracy first; when unsure, ask one short question):");
  assert.deepEqual(rules.rules, [
    "A question about an item (\"¿tienen…?\", \"do you have…?\") adds nothing. On the menu: say yes. Not on the menu: say no. Never say out of stock.",
    "\"sí\", \"ok\", \"go ahead\", \"gracias\", \"bye\", \"that's it\" and name turns never add or change items.",
    "Add only what the caller orders. Never add drinks, sides or extras nobody asked for.",
    "Keep the caller's count. \"otra/otro\" adds one more; \"otras N\" adds N more. Split counts per meat.",
    "Use staff's readback only when the caller clearly says yes to it. If the caller doesn't clearly say yes, the caller's words win and the ticket is flagged for staff.",
    "Each dish keeps its own tortilla, meat and toppings. Repeat them only after \"igual / también / lo mismo / todas\".",
    "A correction (\"no, mejor…\", \"en vez de…\") replaces that one dish; keep everything else.",
    "Defaults (only these): plain tortillas = comal; menudo = sin pata; unsized horchata = 32oz; Platillo de Guisado, Mole, Chiles Rellenos and Fajitas with no tortilla said = comal. A quesadilla dorada with no regular or preparada said: ask, never assume Regular. Tacos or quesadillas with an unclear tortilla: ask once, then confirm \"¿de comal?\". Otherwise ask once; if the answer is vague, confirm with a yes/no question.",
    "preparada/deluxe/con todo = DELUXE (not on burritos: there it means the fillings; on tacos: the normal toppings). Gordita con queso = Queso Gordita. Cebolla asada / peppers and onions = Cebolla y Chiles Asados; said with a dish, it is the $0.75 add-on on that dish.",
    "\"Platillo\" is a plate with rice and beans, not a torta. \"Almuerzo\" means lunch. Quesitorta = Queso Torta. \"Taquitos\" = plain tacos, then ask the tortilla.",
    "Tacos al vapor / sudados / de canasta = Tacos al Vapor (orders of 5, fillings papa/frijol/prensado/pollo/queso).",
    "Never save a meat, dish, goodbye or question word as the customer's name.",
  ]);
  const live = JSON.parse(readFileSync(path.join(root, "data/elvi-donts.json"), "utf8"));
  assert.equal(live.donts.length, 33);
  const elvi = readFileSync(path.join(root, "src/elvi.ts"), "utf8");
  const realtime = readFileSync(path.join(root, "src/realtime.ts"), "utf8");
  assert.equal(elvi.includes("never-do-12"), false);
  assert.equal(realtime.includes("never-do-12"), false);
  assert.match(elvi, /elvi-donts\.json/);
});
