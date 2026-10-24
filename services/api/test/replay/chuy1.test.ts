// chuy1: CA656a1405ff88c1845fcc450d75c4bceb — Sat Oct 24 11:09 AM ET, Spanish
// "tres menús" → menudo (NOT Pack MEAL). Bare "Chuy." after ¿Nombre? = caller identity.
// Square truth: Chuy $48, 3× Menudo 32oz sin pata with 4 corn each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySharedAliases } from "../../src/aliases.js";
import { nameFromTranscriptInfo, thirdPersonName } from "../../src/order-name.js";
import { PACK_WORD, vagueTurn, preTurn } from "../../src/pre-turn.js";

test("chuy1: tres menús aliases to menudo, not pack", () => {
  const a = applySharedAliases("¿Me podría encargar tres menús, por favor?", "phone");
  assert.match(a, /tres\s+menudos/i);
  assert.doesNotMatch(a, /pack|meal/i);
  assert.equal(PACK_WORD.test(a), false);
  const a2 = applySharedAliases("tres menus", "app");
  assert.match(a2, /tres\s+menudos/i);
});

test("chuy1: vagueTurn/preTurn must not ask Pack MEAL for tres menús", async () => {
  // Minimal menu with pack sizes so a false Pack path would ask
  const menu: any[] = [
    { id: "m", name: "Menudo con Tortillas (4)", priceCents: 1600, modifierGroups: [] },
    { id: "p3", name: "3 Pack MEAL", priceCents: 3000, modifierGroups: [] },
    { id: "p4", name: "4 Pack MEAL", priceCents: 4000, modifierGroups: [] },
  ];
  const text = applySharedAliases("Hola, buenos días. ¿Me podría encargar tres menús, por favor?", "app");
  const vg = vagueTurn("chuy1-pack", text, menu as any, "es");
  assert.ok(!vg || !vg.reply || !/pack|Hay de \d/i.test(vg.reply || ""), `must not enter pack ask: ${JSON.stringify(vg)}`);
  const pre = preTurn("chuy1-pre", text, menu as any, "es");
  assert.ok(!pre.reply || !/pack|Hay de \d/i.test(pre.reply || ""), `preTurn must not ask pack: ${JSON.stringify(pre)}`);
  assert.match(pre.text || text, /menudo/i);
});

test("chuy1: bare Chuy after ¿Nombre? is caller identity", () => {
  assert.equal(thirdPersonName("Chuy."), null);
  assert.deepEqual(nameFromTranscriptInfo([
    { speaker: "staff", text: "¿Nombre?" },
    { speaker: "caller", text: "Chuy." },
  ]), { name: "Chuy", thirdPerson: false, source: "staff-ask" });
});
