// martin-pozole1 (CA0655b2, Nov 6 ~5:46 PM ET, desk-answered pickup).
// "Me puede poner tres pozoles" never said rojo. The live menu query was
// "señorita sí escucha tres pozoles" and then kept gluing "es todo señorita",
// "nombre", "hasta luego", so the resolver said not-on-menu and actions stayed empty.
// Saved caller Luis; staff guessed Luis; the caller said no, Martín.
// Does not write caller memory. Square is not touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { guardClaimedAdds } from "../../src/elvi.ts";
import { resolveMenuRequest } from "../../src/menu-intelligence.ts";
import { callerNameCorrection, nameFromTranscriptInfo } from "../../src/order-name.ts";
import { loadSiteCatalog } from "../../src/site-catalog.ts";
import { isClosingFragment, menuIdForVariation, menuQueryForMatch } from "../../src/retain-spoken.ts";

const d = JSON.parse(readFileSync(new URL("../fixtures/CA0655b2-martin-pozole1.json", import.meta.url), "utf8"));
const site = loadSiteCatalog()!;
const MENU = site.products.flatMap((p) => (p.skus || []).map((sku) => ({
  id: menuIdForVariation(p.name, sku.name, sku.squareId),
  name: /^regular$/i.test(sku.name) ? p.name : `${p.name} ${sku.name}`,
  nameEs: p.siteName || p.name,
  aliases: [p.name],
  squareCatalogObjectId: p.squareId,
  squareVariationId: sku.squareId,
  priceCents: sku.priceCents || 0,
  modifierGroups: [],
})));
const POZ = "sq-pozole-rojo-red-pozole-DQ7X4J";
const ENCH = "sq-enchiladas-orden-de-enchiladas-6-6QOYJ5";
const VAPOR = MENU.find((m) => /vapor|steamed/i.test(m.name))!;
const FAJITAS = MENU.filter((m) => /fajita/i.test(m.name)).map((m) => m.id);

function ask(text: string) {
  const q = menuQueryForMatch(text);
  return resolveMenuRequest(MENU as any, { text: q, language: "es", actionHint: "add_item", toolArgs: { itemQuery: q } }) as any;
}

test("martin-pozole1: full phone menu, greeting filler still matches red pozole and not a competitor", () => {
  assert.ok(MENU.length > 40);
  assert.ok(MENU.some((m) => m.id === POZ));
  assert.ok(MENU.some((m) => m.id === ENCH));
  assert.ok(VAPOR);
  assert.equal(menuQueryForMatch("Señorita, sí, escucha, tres pozoles es todo señorita nombre hasta luego"), "tres pozole");
  assert.equal(isClosingFragment("Es todo, señorita."), true);
  assert.equal(isClosingFragment("Hasta luego."), true);
  const dirty = ask("Señorita, sí, escucha, me puede poner tres pozoles, por favor. Es todo señorita. Nombre. Hasta luego.");
  assert.equal(dirty.ok, true, JSON.stringify(dirty));
  assert.equal(dirty.actions[0].itemId, POZ);
  assert.equal(dirty.actions[0].quantity, 3);
  assert.equal(FAJITAS.includes(dirty.actions[0].itemId), false);
  assert.equal(/vapor|steamed/i.test(dirty.actions[0].itemId), false);
  const ench = ask("una orden de enchiladas");
  assert.equal(ench.actions[0].itemId, ENCH);
  assert.equal(/vapor|steamed/i.test(ench.actions[0].itemId), false);
});

test("martin-pozole1: empty model actions still ring 3 default-red pozole; a closing fragment adds nothing", async () => {
  const added = await guardClaimedAdds({ reply: "", actions: [], language: "es" } as any, "Señorita, sí, escucha, me puede poner tres pozoles, por favor.", "es", MENU as any, []);
  assert.equal(added.actions.length, 1, JSON.stringify(added));
  assert.equal(added.actions[0].itemId, POZ);
  assert.equal(added.actions[0].quantity, 3);
  assert.equal((added.actions[0].modifiers || []).some((m: any) => /puerco|pork|protein/i.test(String(m.option || ""))), false);
  const closing = await guardClaimedAdds({ reply: "", actions: [], language: "es" } as any, "Es todo, señorita.", "es", MENU as any, [
    { role: "customer", text: "Señorita, sí, escucha, tres pozoles" },
    { role: "assistant", text: "¿Tres pozoles?" },
  ]);
  assert.equal(closing.actions.length, 0, JSON.stringify(closing));
  const stub: any = async () => ({ actions: [], reply: "" });
  stub.menu = () => MENU;
  const r: any = await shadowOrderFromTurns(d.turns, stub);
  const poz = r.cart.filter((l: any) => /pozole/i.test(String(l.itemId)));
  assert.equal(poz.length, 1, JSON.stringify(r.cart));
  assert.equal(poz[0].itemId, POZ);
  assert.equal(poz[0].quantity, 3);
  assert.equal((poz[0].modifiers || []).some((m: any) => /puerco|pork/i.test(String(m.option || ""))), false);
  assert.equal(r.cart.some((l: any) => /fajita|vapor|steamed/i.test(String(l.itemId))), false);
  assert.equal(r.fulfillment, "PICKUP");
});

test("martin-pozole1: caller correction Martín beats the staff guess Luis; a bare staff name does not", () => {
  const noEcho = d.turns.filter((t: any) => t.text !== "Martín." && t.text !== "Sí.");
  const corrected = nameFromTranscriptInfo(noEcho);
  assert.equal(corrected?.name, "Martín");
  assert.equal(corrected?.source, "volunteer");
  assert.equal(callerNameCorrection(d.turns), "Martín");
  const confirmed = nameFromTranscriptInfo([
    { speaker: "staff", text: "Al nombre de Luis, ¿verdad?" },
    { speaker: "caller", text: "Sí." },
  ]);
  assert.equal(confirmed?.name, "Luis");
  assert.notEqual(confirmed?.source, "volunteer");
  assert.equal(nameFromTranscriptInfo([
    { speaker: "caller", text: "Me puede poner tres pozoles." },
    { speaker: "staff", text: "Martín." },
  ]), null);
  assert.equal(nameFromTranscriptInfo(d.turns)?.name, "Martín");
});
