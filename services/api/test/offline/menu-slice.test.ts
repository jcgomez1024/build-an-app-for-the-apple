import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { approxTokens, cartActionSchema, fewShotBlock, fullCatalogPrompt, loadSyntheticFewShots, promptCatalog, sliceMenu, validateCartActions, type CatalogItem, type SyntheticTurn } from "../../src/menu-slice.ts";

const bistec = { id: "bistec-taco", name: "Bistec / Steak" };
const pastor = { id: "pastor-taco", name: "Alpastor / Roasted Pork" };
const asada = { id: "UF7YCLXFT2FBZIWIXXF7OSWU", name: "Bistec / Steak" };
const menu: CatalogItem[] = [
  { id: "sq-taco-TAR7L5", name: "Taco", nameEs: "Taco", modifierGroups: [{ id: "meats", name: "Carnes", options: [bistec, pastor, asada] }] },
  { id: "sq-gordita-M647RE", name: "Gordita", modifierGroups: [{ id: "gopts", name: "Gordita Options", options: [{ id: "WLHGZCJ422ECZZJ6FOCDMD7G", name: "(QGD) Queso Gordita" }, { id: "gd", name: "(GD) Gordita" }] }] },
  { id: "sq-coke", name: "Coca Cola", modifierGroups: [{ id: "size", name: "Size", options: [{ id: "can", name: "Lata" }] }] },
];

test("slice keeps the named item and option, and the name list is always available", () => {
  const slice = sliceMenu({ menu, utterance: "Dos tacos de bistec.", pendingQuestion: "", cart: [] });
  assert.equal(slice.fallbackNames.length, 3);
  assert.ok(slice.matched.some((item) => item.id === "sq-taco-TAR7L5"));
  const taco = slice.matched.find((item) => item.id === "sq-taco-TAR7L5");
  assert.ok(taco?.groups.some((group) => group.options.some((option) => option.id === "bistec-taco")));
  assert.equal(taco?.groups.some((group) => group.options.some((option) => option.id === "pastor-taco")), false);
  assert.ok(approxTokens(promptCatalog(slice)) < approxTokens(fullCatalogPrompt(menu)));
});

test("an unmatched utterance falls back to names without options", () => {
  const slice = sliceMenu({ menu, utterance: "Hola, buenas tardes.", cart: [] });
  assert.equal(slice.matched.length, 0);
  assert.deepEqual(promptCatalog(slice), slice.fallbackNames);
  assert.equal(JSON.stringify(promptCatalog(slice)).includes("Bistec"), false);
});

test("an approved alias selects the option id", () => {
  const slice = sliceMenu({ menu, utterance: "Two asada tacos." });
  const taco = slice.matched.find((item) => item.id === "sq-taco-TAR7L5");
  assert.ok(taco?.groups.some((group) => group.options.some((option) => option.id === "UF7YCLXFT2FBZIWIXXF7OSWU")));
});

test("schema enums come from the slice and invented ids hold", () => {
  const slice = sliceMenu({ menu, utterance: "Una gordita." });
  const schema = cartActionSchema(slice) as { properties: { actions: { items: { properties: { item_id: { enum: string[] } } } } } };
  assert.ok(schema.properties.actions.items.properties.item_id.enum.includes("sq-gordita-M647RE"));
  const invented = validateCartActions([{ type: "add_item", item_id: "sq-not-real", quantity: 1 }], menu);
  assert.equal(invented.ok, false);
  if (!invented.ok) assert.equal(invented.reviewReason, "confirmar");
});

test("a stale id and an option from another item hold", () => {
  const live = menu.filter((item) => item.id !== "sq-coke");
  const stale = validateCartActions([{ type: "add_item", item_id: "sq-coke", quantity: 1 }], live);
  assert.equal(stale.ok, false);
  const wrong = validateCartActions([{ type: "add_item", item_id: "sq-taco-TAR7L5", quantity: 1, option_ids: ["WLHGZCJ422ECZZJ6FOCDMD7G"] }], menu);
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.ok(wrong.errors.some((error) => error.startsWith("group:")));
  const ok = validateCartActions([{ type: "add_item", item_id: "sq-taco-TAR7L5", quantity: 2, option_ids: ["bistec-taco"] }], menu);
  assert.equal(ok.ok, true);
});

test("style words from the catalog rank a plain taco above a dorada", () => {
  const ranked = sliceMenu({
    menu: [
      ...menu,
      { id: "sq-dorados", name: "Tacos Dorados", modifierGroups: [{ id: "meats", name: "Carnes", options: [bistec] }] },
    ],
    utterance: "Dos tacos.",
  });
  assert.deepEqual(ranked.matched.map((item) => item.id), ["sq-taco-TAR7L5"]);
  const dorados = sliceMenu({
    menu: [
      ...menu,
      { id: "sq-dorados", name: "Tacos Dorados", modifierGroups: [{ id: "meats", name: "Carnes", options: [bistec] }] },
    ],
    utterance: "Dos tacos dorados.",
  });
  assert.ok(dorados.matched.some((item) => item.id === "sq-dorados"));
  assert.equal(dorados.matched.some((item) => item.id === "sq-taco-TAR7L5"), false);
});

const frozenMenuPath = fileURLToPath(new URL("../fixtures/frozen-menu.json", import.meta.url));
test("every few-shot id is on the freeze menu", { skip: existsSync(frozenMenuPath) ? false : "frozen menu fixture services/api/test/fixtures/frozen-menu.json is missing" }, () => {
  const bytes = readFileSync(frozenMenuPath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha, "06f4400d578f55dfa7c996aa4656ece60d9977921071e6e6083b80dfff8379a7");
  const menu = JSON.parse(bytes.toString("utf8"));
  for (const turn of loadSyntheticFewShots()) {
    const result = validateCartActions(turn.actions, menu);
    assert.equal(result.ok, true, `${turn.id} ${JSON.stringify(result)}`);
  }
  const bare = validateCartActions([{ type: "add_item", item_id: "sq-gordita-M647RE", quantity: 1 }], menu);
  assert.equal(bare.ok, false);
  const bothStyles = validateCartActions([{ type: "add_item", item_id: "sq-gordita-M647RE", quantity: 1, option_ids: ["NUR2M5MPCNR2D4MDARRXHB7I", "WLHGZCJ422ECZZJ6FOCDMD7G", "Q567C5ONYK4GFIKEJPNZCIMA"] }], menu);
  assert.equal(bothStyles.ok, false);
});

test("few-shot uses verified synthetic rows and the approved cap of 3", () => {
  const rows = loadSyntheticFewShots();
  assert.ok(rows.every((row) => row.synthetic && row.verified));
  const counted = { id: "counted-real", synthetic: false, verified: true, language: "es", utterance: "Dos tacos de bistec.", actions: [] } as unknown as SyntheticTurn;
  const picked = fewShotBlock([...rows, counted], { menu, utterance: "Dos tacos de bistec." });
  assert.ok(picked.length > 0 && picked.length <= 3);
  assert.ok(picked.every((row) => row.id.startsWith("syn-")));
  assert.throws(() => fewShotBlock(rows, { menu, utterance: "Dos tacos." }, -1));
});
