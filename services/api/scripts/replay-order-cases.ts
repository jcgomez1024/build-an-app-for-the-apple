/**
 * fix20: replay order cases (sopesazo meats + no crema) and unit checks for cleanPhrase / meats / toppings.
 *   npx tsx scripts/replay-order-cases.ts           # unit + shadow replay (needs .env / Square / xAI)
 *   npx tsx scripts/replay-order-cases.ts --unit    # unit only
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

import { cleanPhrase, isClosing, shadowOrderFromTurns, detectContainerSplit, type CallTurn } from "../src/call-scoring.ts";
import { buildTicketLines, applyContainerPlan, deluxeTicketLabel, NO_BEBIDA, noticeLine, dominantCallerLanguage, tempoSuffix, tempoEligible } from "../src/twilio.ts";
import { rbOptionLabel } from "../src/readback.ts";
import { applyGuideGate, plainDishForCombo } from "../src/elvi.ts";
import { getComboGuide, evaluateGuideText, bothMeatQuestion } from "../src/guides.ts";
import { fixNamedMeats, fixToppingNegations, loadSiteCatalog, applySiteGroupRules, siteCallerWords } from "../src/site-catalog.ts";
import { getMenu } from "../src/square.ts";
import { chatWithElvi } from "../src/elvi.ts";

let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS ${name}`);
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`); }
};

const unit = process.argv.includes("--unit");

console.log("\n== unit: cleanPhrase keeps \"no crema\" (fix20) ==");
ok("no crema", cleanPhrase("no crema") === "no crema", JSON.stringify(cleanPhrase("no crema")));
ok("No crema,", /^No crema,?$/i.test(cleanPhrase("No crema,")), JSON.stringify(cleanPhrase("No crema,")));
ok("sin crema", cleanPhrase("sin crema") === "sin crema", JSON.stringify(cleanPhrase("sin crema")));
ok("still strips Hola/dame", /sopesazo|sopesaso|bistec/i.test(cleanPhrase("Hola, dame un sopesazo de bistec")), cleanPhrase("Hola, dame un sopesazo de bistec"));
ok("no, discourse only", cleanPhrase("no, dame un taco").toLowerCase().includes("dame un taco") || cleanPhrase("no, dame un taco").toLowerCase().includes("taco"), cleanPhrase("no, dame un taco"));
console.log("\n== unit: fix22 isClosing / huarache ==");
ok("Bueno alone closes", isClosing("Bueno,") === true);
ok("Bueno + guarache order NOT closing", isClosing("Bueno, quiero un guarache de prensado con duro") === false);
ok("guarache counts as food", isClosing("un guarache de duro") === false);

console.log("\n== unit: ticket5 NO BEBIDA container split ==");
{
  const yes = [
    "seis quesadillas de bistec en diferentes recipientes",
    "en dos contenedores por favor",
    "me las pone en diferentes recipientes",
    "separado, por favor",
    "por separado",
    "en dos órdenes",
    "son dos órdenes separadas",
    "the six quesadillas in separate containers",
    "can you split it",
    "split them into two",
    "and the other three aparte",
    "tres y tres",
    "3 and 3",
    "mitad y mitad",
  ];
  const SHARES = new Set(["tres y tres", "3 and 3", "mitad y mitad"]);
  for (const t of yes) { const o = { afterSplit: SHARES.has(t) }; ok(`split: "${t}"`, !!detectContainerSplit(t, o), JSON.stringify(detectContainerSplit(t, o))); }
  const no = [
    "seis quesadillas de bistec",
    "la salsa aparte",
    "con la crema por separado",
    "y aparte una horchata",
    "salsa on the side",
    "dos órdenes de tacos de pastor",
    "tres tacos de asada",
    "tres tacos y tres quesadillas",
  ];
  for (const t of no) ok(`not split: "${t}"`, !detectContainerSplit(t), JSON.stringify(detectContainerSplit(t)));
  const three = detectContainerSplit("en tres recipientes");
  ok("tres recipientes → 3 parts", three?.parts === 3, JSON.stringify(three));
  const rest = detectContainerSplit("seis quesadillas de bistec en diferentes recipientes");
  ok("split phrase stripped for Elvi", rest?.rest === "seis quesadillas de bistec", JSON.stringify(rest?.rest));

  const q = (n: number) => ({ name: "Quesadilla", quantity: n, choices: ["Bistec / Steak"], totalCents: n * 450 });
  const fmt = (ls: any[]) => ls.map((l) => `${l.quantity}×${l.name}${l.choices?.length ? "(" + l.choices.join(",") + ")" : ""}`).join(" | ");
  const split6 = buildTicketLines([q(6)], [{}], [], "note", { breaks: [], splits: [{ parts: 2, from: 0, to: null }], phrases: [] });
  ok("6 bistec split → 3 | NO BEBIDA | 3", fmt(split6) === `3×Quesadilla(Bistec / Steak) | 1×${NO_BEBIDA} | 3×Quesadilla(Bistec / Steak)`, fmt(split6));
  ok("divider kind", split6[1]?.kind === "divider", JSON.stringify(split6[1]));
  const noSplit = buildTicketLines([q(3), q(3)], [{}, {}], [], "note", null);
  ok("no split → merged 6", fmt(noSplit) === "6×Quesadilla(Bistec / Steak)", fmt(noSplit));
  const across = applyContainerPlan([
    { name: "Quesadilla", quantity: 3, choices: ["Bistec / Steak"], kind: "food" },
    { name: NO_BEBIDA, quantity: 1, choices: [], kind: "divider" },
    { name: "Quesadilla", quantity: 3, choices: ["Bistec / Steak"], kind: "food" },
  ], null);
  ok("merge never crosses NO BEBIDA", fmt(across) === `3×Quesadilla(Bistec / Steak) | 1×${NO_BEBIDA} | 3×Quesadilla(Bistec / Steak)`, fmt(across));
  const brk = buildTicketLines([q(3), { name: "Taco", quantity: 3, choices: ["Asada / Grilled Steak"] }], [{}, {}], [], "note", { breaks: [1], splits: [], phrases: [] });
  ok("aparte break → Quesadilla | NO BEBIDA | Taco", fmt(brk) === `3×Quesadilla(Bistec / Steak) | 1×${NO_BEBIDA} | 3×Taco(Asada / Grilled Steak)`, fmt(brk));
  const withDrink = buildTicketLines([q(6), { name: "Horchata", quantity: 1, choices: [] }], [{}, {}], [], "note", { breaks: [], splits: [{ parts: 2, from: 0, to: null }], phrases: [] });
  ok("drink rides in last container", fmt(withDrink) === `3×Quesadilla(Bistec / Steak) | 1×${NO_BEBIDA} | 3×Quesadilla(Bistec / Steak) | 1×Horchata`, fmt(withDrink));

  console.log("\n== unit: fix24 shares only after a split request ==");
  ok("'una y una' alone is not a split", !detectContainerSplit("una y una"), JSON.stringify(detectContainerSplit("una y una")));
  ok("'tres y tres' alone is not a split", !detectContainerSplit("tres y tres"));
  ok("'una y una' after split → 2", detectContainerSplit("una y una", { afterSplit: true })?.parts === 2, JSON.stringify(detectContainerSplit("una y una", { afterSplit: true })));

  console.log("\n== unit: fix24 readback says bistec ==");
  ok("Bistec / Steak → bistec (es)", rbOptionLabel("Bistec / Steak", "(B) Q Carnes / Meats", "es") === "bistec", rbOptionLabel("Bistec / Steak", "(B) Q Carnes / Meats", "es"));
  ok("Bistec / Steak → steak (en)", rbOptionLabel("Bistec / Steak", "(B) Q Carnes / Meats", "en") === "steak");
  ok("salsa asada unchanged", rbOptionLabel("Mild Salsa Asada", "(I) Salsa Preferencia / Preference", "es") === "salsa asada", rbOptionLabel("Mild Salsa Asada", "(I) Salsa Preferencia / Preference", "es"));

  console.log("\n== unit: fix24 no crema only on the Deluxe dish meant ==");
  const DLX = "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream)";
  const two = [
    { name: "Sopesaso Elvis", quantity: 1, choices: ["Bistec / Steak", DLX] },
    { name: "Gordita", quantity: 1, choices: ["Bistec / Steak", DLX] },
  ];
  const att = buildTicketLines(two, [{ elviNotes: ["no crema"] }, {}], ["no crema"], "note", null, { attributed: true, ambiguous: [] });
  ok("attributed: sopesaso gets no crema", JSON.stringify(att[0].notes) === '["no crema"]' && !att[0].flag, JSON.stringify(att[0]));
  ok("attributed: gordita has no note", !(att[1].notes || []).length && !att[1].flag, JSON.stringify(att[1]));
  const amb = buildTicketLines(two, [{}, {}], ["no crema"], "note", null, { attributed: true, ambiguous: ["no crema"] });
  ok("ambiguous: no notes, both flagged", amb.every((l) => !(l.notes || []).length && /Confirmar: no crema/.test(String(l.flag))), JSON.stringify(amb));
  const legacy = buildTicketLines(two, [{}, {}], ["no crema"], "note", null);
  ok("legacy (no attribution) + 2 Deluxe → flag, no guess", legacy.every((l) => !(l.notes || []).length && /¿en cuál DELUXE/.test(String(l.flag))), JSON.stringify(legacy));
  const one = buildTicketLines([two[0], { name: "Taco", quantity: 2, choices: ["Pastor / Marinated Pork"] }], [{}, {}], [], "note", null, { attributed: true, ambiguous: ["no crema"] });
  ok("one Deluxe dish: bare no crema goes on it", JSON.stringify(one[0].notes) === '["no crema"]' && !one[0].flag, JSON.stringify(one));

  // Deterministic shadow replays (fake Elvi) for attribution + shares.
  const fake = async (text: string) => {
    const t = text.toLowerCase();
    const acts: any[] = [];
    const dlx = /deluxe/.test(t) ? [{ step: "(E) DELUXE Options", option: DLX }] : [];
    for (const piece of t.split(/\by\b/)) {
      if (/sopes/.test(piece)) acts.push({ type: "add_item", itemId: "sopesaso", quantity: 1, modifiers: [...dlx] });
      if (/gordita/.test(piece)) acts.push({ type: "add_item", itemId: "gordita", quantity: 1, modifiers: [...dlx] });
      const q = piece.match(/(seis|6)\s+quesadillas/); if (q) acts.push({ type: "add_item", itemId: "quesadilla", quantity: 6, modifiers: [] });
    }
    return { reply: "Listo. ¿Algo más?", actions: acts };
  };
  const T = (speaker: "caller" | "staff", text: string, i: number): CallTurn => ({ speaker, start: i * 3, end: i * 3 + 2, text, language: "es" });
  const r1 = await shadowOrderFromTurns([T("caller", "Un sopesazo de bistec deluxe sin crema", 0), T("staff", "¿Algo más?", 1), T("caller", "Y una gordita de bistec deluxe", 2), T("caller", "Es todo", 3)], fake as any);
  ok("shadow: 'sin crema' said with the sopesazo → only sopesazo", JSON.stringify(r1.cart.map((l: any) => l.elviNotes || [])) === '[["no crema"],[]]' && !r1.ambiguousRemovals.length, JSON.stringify({ c: r1.cart, a: r1.ambiguousRemovals }));
  const r2 = await shadowOrderFromTurns([T("caller", "Un sopesazo de bistec deluxe y una gordita de bistec deluxe", 0), T("staff", "¿Algo más?", 1), T("caller", "Sin crema.", 2), T("caller", "Es todo", 3)], fake as any);
  ok("shadow: bare 'sin crema' after 2 Deluxe → ambiguous", r2.ambiguousRemovals.includes("no crema") && r2.cart.every((l: any) => !(l.elviNotes || []).length), JSON.stringify({ c: r2.cart, a: r2.ambiguousRemovals }));
  const r3 = await shadowOrderFromTurns([T("caller", "Seis quesadillas de bistec", 0), T("staff", "¿De harina o de comal?", 1), T("caller", "una y una", 2), T("caller", "Es todo", 3)], fake as any);
  ok("shadow: 'una y una' without split request → no split", !r3.containers.splits.length, JSON.stringify(r3.containers));
  const r4 = await shadowOrderFromTurns([T("caller", "Seis quesadillas de bistec", 0), T("caller", "en dos recipientes", 0.5), T("staff", "¿Cómo las divido?", 1), T("caller", "tres y tres", 2), T("caller", "Es todo", 3)], fake as any);
  ok("shadow: 'tres y tres' after split request → 2 parts", r4.containers.splits.some((x: any) => x.parts === 2), JSON.stringify(r4.containers));

  console.log("\n== unit: fix25 asada = bistec in combos ==");
  {
    const qg = getComboGuide("COMBO Quesadillas");
    ok("guide COMBO Quesadillas", !!qg);
    if (qg) {
      for (const t of ["combo de quesadillas de asada", "combo de quesadillas de carne asada"]) {
        const ev = evaluateGuideText(qg, t);
        const m1 = ev.filled.find((f) => f.stepKey === "item-1-meat");
        const salsa = ev.filled.find((f) => /salsa/i.test(f.stepKey) && /asada/i.test(f.option));
        ok(`"${t}" → item 1 Bistec, no salsa asada pick`, /bistec/i.test(String(m1?.option)) && !salsa, JSON.stringify(ev.filled));
        ok(`"${t}" → asks "¿Las dos de bistec?"`, !!m1 && bothMeatQuestion(qg.display_name, m1.option, "es") === "¿Las dos de bistec?", m1 ? bothMeatQuestion(qg.display_name, m1.option, "es") : "no m1");
      }
      ok("English: Both steak?", bothMeatQuestion(qg.display_name, "1 x Bistec / Steak", "en") === "Both steak?");
    }
    const tg = getComboGuide("COMBO Tacos");
    if (tg) ok("tacos: ¿Los dos de pastor?", bothMeatQuestion(tg.display_name, "1 x AlPastor / Marinated Pork", "es") === "¿Los dos de pastor?", bothMeatQuestion(tg.display_name, "1 x AlPastor / Marinated Pork", "es"));
  }

  console.log("\n== unit: fix25 combo Deluxe covers both items ==");
  {
    const DLXC = "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream)";
    const combo = { name: "COMBO Quesadillas", quantity: 1, choices: ["(QCO) 2 x Comal / Homemade", "1 x Bistec / Steak", "1 x Bistec / Steak", "Arroz y Frijoles / Rice and Beans", DLXC] };
    const c1 = buildTicketLines([combo], [{ elviNotes: ["no crema"] }], ["no crema"], "note", null, { attributed: true, ambiguous: [] });
    ok("combo: one Deluxe line + italic no crema, no flag", c1[0].choices.filter((c) => /DELUXE/.test(c)).length === 1 && JSON.stringify(c1[0].notes) === '["no crema"]' && !c1[0].flag, JSON.stringify(c1[0]));
    const c2 = buildTicketLines([{ ...combo, quantity: 2 }], [{}], ["no crema"], "note", null, { attributed: true, ambiguous: ["no crema"] });
    ok("combo ×2 with bare no crema: applies to the combo, no ¿en cuál?", JSON.stringify(c2[0].notes) === '["no crema"]' && !c2[0].flag, JSON.stringify(c2[0]));
    const c3 = buildTicketLines([combo], [{}], ["no crema"], "note", null);
    ok("combo legacy path: note, no flag", JSON.stringify(c3[0].notes) === '["no crema"]' && !c3[0].flag, JSON.stringify(c3[0]));
    const fakeC = async (text: string) => ({ reply: "Listo. ¿Algo más?", actions: /combo/i.test(text) ? [{ type: "add_item", itemId: "combo-quesadillas", quantity: 1, modifiers: [{ step: "item-1-meat", option: "1 x Bistec / Steak" }, { step: "item-2-meat", option: "1 x Bistec / Steak" }, ...(/deluxe/i.test(text) ? [{ step: "regular-deluxe", option: DLXC }] : [])] }] : [] });
    const T2 = (speaker: "caller" | "staff", text: string, i: number): CallTurn => ({ speaker, start: i * 3, end: i * 3 + 2, text, language: "es" });
    const rc = await shadowOrderFromTurns([T2("caller", "Un combo de quesadillas de bistec deluxe", 0), T2("staff", "¿Algo más?", 1), T2("caller", "Sin crema.", 2), T2("caller", "Es todo", 3)], fakeC as any);
    ok("shadow: bare 'sin crema' with one Deluxe combo → on the combo, not ambiguous", JSON.stringify(rc.cart[0]?.elviNotes) === '["no crema"]' && !rc.ambiguousRemovals.length, JSON.stringify({ c: rc.cart, a: rc.ambiguousRemovals }));
  }

  console.log("\n== unit: ticket5 DELUXE label includes Queso Fresco ==");
  const full = "DELUXE (Lechuga/Lettuce, Pico, Crema/Sour Cream, Queso Fresco)";
  ok("old Square label → full 4-topping label", deluxeTicketLabel("DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$1.50)") === full, deluxeTicketLabel("DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream)"));
  const renamed = "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream,Queso Fresco/Fresh Cheese)";
  ok("renamed Square label used exactly", deluxeTicketLabel(renamed) === renamed, deluxeTicketLabel(renamed));
  const dl = buildTicketLines([{ name: "Sopesaso Elvis (ONLINE)", quantity: 1, choices: ["Bistec / Steak", "DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream) (+$1.50)"] }], [{}], ["no crema"], "note", null);
  ok("deluxe ticket line shows Queso Fresco", dl[0]?.choices.includes(full), JSON.stringify(dl[0]?.choices));
  ok("note mode keeps italic 'no crema'", JSON.stringify(dl[0]?.notes) === JSON.stringify(["no crema"]), JSON.stringify(dl[0]?.notes));
  const ex = buildTicketLines([{ name: "Sopesaso Elvis", quantity: 1, choices: ["DELUXE (Lechuga/Lettuce,Pico,Crema/Sour Cream)"] }], [{}], ["no crema"], "expand", null);
  ok("expand mode lists Queso Fresco", ex[0]?.choices.includes("Queso Fresco") && !ex[0]?.choices.some((c) => /crema/i.test(c)), JSON.stringify(ex[0]?.choices));
}

console.log("\n== unit: sopesazo alias pins Sopesaso Elvis ==");
siteCallerWords(); // load CSV
const words = siteCallerWords().get("RTJX4FI3SB23R3CBPR74L3VU") || [];
ok("alias list has sopesazo", words.includes("sopesazo"), words.join("; "));

console.log("\n== unit: fixNamedMeats + fixToppingNegations on Sopesaso ==");
const catalog = loadSiteCatalog();
const product = catalog?.products.find((p) => /sopesaso/i.test(p.name));
ok("site catalog has Sopesaso Elvis", !!product, product?.name || "missing");

async function withMenu() {
  const menu = (await getMenu()).map((m: any) => applySiteGroupRules(m));
  const item = menu.find((m: any) => m.squareCatalogObjectId === "RTJX4FI3SB23R3CBPR74L3VU" || /sopesaso/i.test(m.name));
  ok("menu has Sopesaso Elvis", !!item, item?.id || "missing");
  if (!item) return menu;

  {
    console.log("\n== unit: fix24 plain dish booked as COMBO ==");
    const combo = menu.find((m: any) => /^combo quesadillas$/i.test(String(m.name).trim()));
    const plainQ = combo ? plainDishForCombo(combo.name, menu) : null;
    ok("COMBO Quesadillas → plain Quesadilla", !!plainQ && /quesadilla/i.test(plainQ.name) && !/combo/i.test(plainQ.name), plainQ?.name || "none");
    if (combo) {
      const g1 = applyGuideGate({ language: "es", reply: "Listo.", actions: [{ type: "add_item", itemId: combo.id, quantity: 6 }] } as any,
        { transcript: "6 quesadillas de harina de bistec", language: "es", menu, history: [] } as any);
      ok("no combo asked → plain dish, no '¿Y el segundo?'", (g1.actions as any[]).some((a) => a.itemId === plainQ?.id) && !(g1 as any).pendingGuides && !/segundo/i.test(String(g1.reply)), JSON.stringify({ a: g1.actions, r: g1.reply }));
      const g2 = applyGuideGate({ language: "es", reply: "Listo.", actions: [{ type: "add_item", itemId: combo.id, quantity: 1 }] } as any,
        { transcript: "un combo de quesadillas de harina de bistec", language: "es", menu, history: [] } as any);
      ok("combo named → still a combo build", !!(g2 as any).pendingGuides?.length || (g2.actions as any[]).some((a) => a.itemId === combo.id), JSON.stringify({ a: g2.actions, r: g2.reply }));
    }
  }
  const meatG = (item.modifierGroups || []).find((g: any) => /carne|meat/i.test(g.name));
  ok("meat max is 2", Number(meatG?.maxSelections) === 2, String(meatG?.maxSelections));

  const bare = [{ type: "add_item", itemId: item.id, quantity: 1, modifiers: [{ step: "(D) Salsa Options", option: "Mild Salsa Asada", isDefault: true }] }];
  const withMeats = fixNamedMeats(bare as any, menu, "Dame un sopesazo de bistec con chorizo", "elvi");
  const meatOpts = (withMeats[0].modifiers || []).filter((m: any) => /carne|meat/i.test(String(m.step || m.groupName || "")));
  ok("picks bistec+chorizo", meatOpts.length === 2 && meatOpts.some((m: any) => /bistec/i.test(m.option)) && meatOpts.some((m: any) => /chorizo/i.test(m.option)), JSON.stringify(meatOpts));

  const withCrema = fixNamedMeats([{ type: "add_item", itemId: item.id, quantity: 1, modifiers: [
    { step: meatG.name, option: "Bistec / Steak" },
    { step: "(B) Toppings", option: "Crema / Sour Cream" },
    { step: "(D) Salsa Options", option: "Mild Salsa Asada", isDefault: true },
  ] }] as any, menu, "sopesazo de bistec", "elvi");
  const noCrema = fixToppingNegations(withCrema as any, menu, "sopesazo de bistec no crema", "elvi");
  ok("no crema strips crema", !(noCrema[0].modifiers || []).some((m: any) => /crema/i.test(m.option)), JSON.stringify(noCrema[0].modifiers));

  const three = fixNamedMeats(bare as any, menu, "sopesazo de bistec con chorizo y pollo", "elvi");
  const threeMeats = (three[0].modifiers || []).filter((m: any) => /carne|meat/i.test(String(m.step || "")));
  ok("3 meats → conflict (no silent pick)", threeMeats.length === 0 && (three[0] as any).meatConflict === true, JSON.stringify(three[0]));

  const taco = menu.find((m: any) => /^taco$/i.test(String(m.name)) || /sq-taco-TAR7L5/i.test(m.id));
  if (taco) {
    const tActs = fixNamedMeats([{ type: "add_item", itemId: taco.id, quantity: 2, modifiers: [] }] as any, menu, "dos tacos de harina de tripas", "elvi");
    ok("tripas on taco", (tActs[0].modifiers || []).some((m: any) => /tripa/i.test(m.option)), JSON.stringify(tActs[0].modifiers));
    const tepaActs = fixNamedMeats([{ type: "add_item", itemId: taco.id, quantity: 1, modifiers: [] }] as any, menu, "un taco de tepa", "elvi");
    ok("tepa→tripa on taco", (tepaActs[0].modifiers || []).some((m: any) => /tripa/i.test(m.option)), JSON.stringify(tepaActs[0].modifiers));
  }
  // fix21: one-each meat list
  const { splitSinglesTurn } = await import("../src/pre-turn.ts");
  const { splitItems, cleanPhrase } = await import("../src/call-scoring.ts");
  const qPhrase = "tres quesadillas de comal, una de chorizo, una de tepa y otra de buche";
  ok("splitItems keeps meat list together", splitItems(qPhrase).length === 1, JSON.stringify(splitItems(qPhrase)));
  const split = splitSinglesTurn(qPhrase, menu, "es");
  ok("splitSingles 3 quesadillas", !!split && split.adds.length === 3, JSON.stringify(split?.adds?.map((a: any) => a.modifiers.map((m: any) => m.option))));
  ok("tepa became tripa", !!split && split.adds.some((a: any) => a.modifiers.some((m: any) => /tripa/i.test(m.option))), JSON.stringify(split?.adds));
  const unk = splitSinglesTurn("tres quesadillas de comal, una de chorizo, una de xyzzy y otra de buche", menu, "es");
  ok("unknown meat kept (3 lines)", !!unk && unk.adds.length === 3 && unk.adds.some((a: any) => a.unknownMeat === "xyzzy"), JSON.stringify(unk?.adds?.map((a: any) => ({ mods: a.modifiers.map((m: any) => m.option), unk: a.unknownMeat }))));
  ok("unknown meat asks", !!unk && (unk as any).asks?.includes("xyzzy"), JSON.stringify((unk as any)?.asks));
  console.log("\n== unit: fix23 campechana / milanesa / algo-más ==");
  {
    const { preTurn } = await import("../src/pre-turn.ts");
    const { followUpContext, pinnedMenu } = await import("../src/site-catalog.ts");
    const rw = preTurn("u", "una torta de campechana", menu as any, "es");
    ok("campechana → bistec y chorizo", /bistec y chorizo/i.test(rw.text), rw.text);
    const mila = preTurn("u2", "unas milanesas de pollo", menu as any, "es");
    ok("milanesas refused", /no tenemos milanesas/i.test(String(mila.reply || "")), mila.reply);
    const pin = pinnedMenu("una torta de bistec", menu as any);
    ok("torta pinned", pin.length === 1 && /torta/i.test(pin[0].name), pin.map((m: any) => m.name).join(","));
    const ctx = followUpContext([
      { role: "customer", text: "dos quesadillas" },
      { role: "assistant", text: "Quesadilla: comal, asada. $4.50. ¿Algo más?" },
    ] as any, menu as any);
    ok("algo más is not follow-up", ctx === null, JSON.stringify(ctx));
  }
  return menu;
}

const menu = await withMenu();

if (!unit) {
  console.log("\n== fix25 live combo conversations (one meat → ¿Las dos de …?) ==");
  {
    const converse = async (lang: "es" | "en", turns: string[]) => {
      const key = `replay-fix25-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const history: Array<{ role: "customer" | "assistant"; text: string }> = [];
      const replies: string[] = [];
      let added: any = null;
      const send = async (t: string) => {
        const r: any = await chatWithElvi({ sessionKey: key, transcript: t, language: lang, history: history.slice(-24), menu: menu as any, resolverMenu: menu as any, cart: [], fulfillment: "pickup" } as any);
        history.push({ role: "customer", text: t }, { role: "assistant", text: String(r?.reply || "") });
        replies.push(String(r?.reply || ""));
        const a = (r?.actions || []).find((x: any) => x.type === "add_item" && /combo/i.test(String(x.itemId)));
        if (a) added = a;
      };
      for (const t of turns) await send(t);
      for (let i = 0; i < 6 && !added; i++) await send(lang === "es" ? "así está bien" : "that's fine");
      const meats = (added?.modifiers || []).filter((m: any) => /item-\d-meat|carne|meat/i.test(String(m.step || m.groupName || ""))).map((m: any) => String(m.option));
      return { replies, added, meats };
    };
    const show = (r: any) => JSON.stringify({ replies: r.replies, meats: r.meats, mods: (r.added?.modifiers || []).map((m: any) => m.option) });
    // yes
    const y = await converse("es", ["Un combo de quesadillas de bistec", "de comal", "sí"]);
    ok("combo yes: asks ¿Las dos de bistec? → both Bistec", y.replies.some((r) => /¿Las dos de bistec\?/.test(r)) && y.meats.length === 2 && y.meats.every((m) => /bistec/i.test(m)), show(y));
    // asada + no then meat
    const n = await converse("es", ["Un combo de quesadillas de asada", "de comal", "no", "pastor"]);
    ok("combo asada → ¿Las dos de bistec?; no → ¿Y la otra…? → bistec + pastor", n.replies.some((r) => /¿Las dos de bistec\?/.test(r)) && n.replies.some((r) => /¿Y la otra de qué carne\?/.test(r)) && n.meats.some((m) => /bistec/i.test(m)) && n.meats.some((m) => /pastor/i.test(m)), show(n));
    ok("combo asada: never salsa asada as the meat", !n.meats.some((m) => /salsa/i.test(m)), show(n));
    // two meats up front
    const t2 = await converse("es", ["Un combo de tortas, una de bistec y otra de chorizo"]);
    ok("combo two meats up front: no both-question, bistec + chorizo", !t2.replies.some((r) => /dos de|la otra|el otro/i.test(r)) && t2.meats.some((m) => /bistec/i.test(m)) && t2.meats.some((m) => /chorizo/i.test(m)), show(t2));
    // English
    const e = await converse("en", ["A steak quesadilla combo", "comal", "yes"]);
    ok("combo English: Both steak? → both steak", e.replies.some((r) => /Both steak\?/.test(r)) && e.meats.length === 2 && e.meats.every((m) => /bistec|steak/i.test(m)), show(e));
    // Deluxe on a combo: one Deluxe for the whole combo, never asked per item
    const d = await converse("es", ["Un combo de quesadillas de carne asada deluxe", "de comal", "sí"]);
    const dl = (d.added?.modifiers || []).filter((m: any) => /deluxe/i.test(String(m.option)));
    ok("combo deluxe: one DELUXE modifier, no per-item question", dl.length === 1 && !d.replies.some((r) => /cu[aá]l.*deluxe|which.*deluxe|primer[oa].*deluxe/i.test(r)), show(d));
  }

  console.log("\n== shadow replay (live Elvi) ==");
  const run = (sessionKey: string) => async (text: string, language: "es" | "en", history: Array<{ role: "customer" | "assistant"; text: string }>) => {
    return chatWithElvi({
      sessionKey,
      transcript: text,
      language,
      history,
      menu: menu as any,
      resolverMenu: menu as any,
      cart: [],
      fulfillment: "pickup",
    } as any);
  };

  const cases: Array<{ name: string; turns: CallTurn[]; expect: (cart: any[], r?: any) => string | null }> = [
    {
      name: "fix24 call: seis quesadillas de harina de bistec → plain, readback 'bistec', no 2nd-meat question",
      turns: [
        { speaker: "caller", start: 0, end: 3, text: "Me da seis quesadillas de harina de bistec.", language: "es" },
        { speaker: "caller", start: 4, end: 5, text: "Es todo.", language: "es" },
      ],
      expect: (cart, r) => {
        const replies = (r?.steps || []).map((s: any) => String(s.reply || "")).join(" | ");
        if (/segundo|second one/i.test(replies)) return "asked for a second meat: " + replies;
        if (cart.some((l) => /combo/i.test(l.itemId))) return "booked a combo: " + JSON.stringify(cart.map((l) => l.itemId));
        const q = cart.find((l) => /quesadilla/i.test(l.itemId));
        if (!q || Number(q.quantity) !== 6) return "expected 6 quesadillas: " + JSON.stringify(cart);
        const opts = (q.modifiers || []).map((m: any) => String(m.option || ""));
        if (!opts.some((o: string) => /bistec/i.test(o))) return "missing bistec modifier: " + opts.join(", ");
        if (/\basada\b/i.test(replies.replace(/salsa asada/gi, ""))) return "readback says asada for bistec: " + replies;
        if (!/bistec/i.test(replies)) return "readback missing bistec: " + replies;
        return null;
      },
    },
    {
      name: "ticket5 call: 6 quesadillas de bistec en diferentes recipientes (3 + NO BEBIDA + 3)",
      turns: [
        { speaker: "caller", start: 0, end: 3, text: "Hola, quiero seis quesadillas de comal de bistec,", language: "es" },
        { speaker: "caller", start: 3.5, end: 5, text: "en diferentes recipientes, tres y tres.", language: "es" },
        { speaker: "caller", start: 6, end: 7, text: "Sería todo, gracias.", language: "es" },
      ],
      expect: (cart, r) => {
        const qs = cart.filter((l) => /quesadilla/i.test(l.itemId));
        const total = qs.reduce((n, l) => n + Number(l.quantity || 0), 0);
        if (total !== 6) return `expected 6 quesadillas, got ${total}: ` + JSON.stringify(qs.map((l) => ({ q: l.quantity, m: (l.modifiers || []).map((m: any) => m.option) })));
        const opts = qs.flatMap((l) => (l.modifiers || []).map((m: any) => String(m.option || "")));
        if (!opts.some((o) => /bistec|steak/i.test(o))) return "missing bistec: " + opts.join(", ");
        const splits = r?.containers?.splits || [];
        if (!splits.some((s: any) => s.parts === 2)) return "no 2-container split recorded: " + JSON.stringify(r?.containers);
        const described = qs.map((l) => ({ name: "Quesadilla", quantity: Number(l.quantity), choices: ["Bistec / Steak"] }));
        const lines = buildTicketLines(described, qs, [], "note", r.containers);
        const shape = lines.map((l) => `${l.quantity}×${l.kind === "divider" ? "NB" : "Q"}`).join(" ");
        if (shape !== "3×Q 1×NB 3×Q") return "ticket shape " + shape;
        return null;
      },
    },
    {
      name: "ticket5 call: staff asks ¿separado? → caller sí",
      turns: [
        { speaker: "caller", start: 0, end: 3, text: "Me da seis quesadillas de harina de bistec.", language: "es" },
        { speaker: "staff", start: 4, end: 5, text: "¿Las quiere en diferentes recipientes?", language: "es" },
        { speaker: "caller", start: 6, end: 7, text: "Sí, por favor.", language: "es" },
        { speaker: "caller", start: 8, end: 9, text: "Es todo.", language: "es" },
      ],
      expect: (cart, r) => {
        const total = cart.filter((l) => /quesadilla/i.test(l.itemId)).reduce((n, l) => n + Number(l.quantity || 0), 0);
        if (total !== 6) return `expected 6 quesadillas, got ${total}`;
        if (!(r?.containers?.splits || []).some((s: any) => s.parts === 2)) return "no split from staff question: " + JSON.stringify(r?.containers);
        return null;
      },
    },
    {
      name: "call transcript: sopesazo bistec+chorizo, no crema, 2 tacos harina tripas",
      turns: [
        { speaker: "caller", start: 0, end: 1, text: "Sí, bueno, me gustaría hacer una orden, por favor.", language: "es" },
        { speaker: "caller", start: 2, end: 5, text: "Dame un sopesazo de bistec con chorizo,", language: "es" },
        { speaker: "caller", start: 5.5, end: 6, text: "no crema,", language: "es" },
        { speaker: "caller", start: 7, end: 10, text: "y dos tacos de harina de tripas.", language: "es" },
        { speaker: "caller", start: 11, end: 12, text: "Sería todo.", language: "es" },
      ],
      expect: (cart) => {
        const sope = cart.find((l) => /sopesaso/i.test(l.itemId) || /sopesaso/i.test(String(l.readback || "")));
        const byId = cart.find((l) => String(l.itemId || "").includes("sopesaso"));
        const s = sope || byId || cart[0];
        if (!s) return "missing sopesaso line";
        const opts = (s.modifiers || []).map((m: any) => String(m.option || ""));
        if (!opts.some((o: string) => /bistec/i.test(o))) return "missing bistec: " + opts.join(", ");
        if (!opts.some((o: string) => /chorizo/i.test(o))) return "missing chorizo: " + opts.join(", ");
        if (opts.some((o: string) => /^crema\b/i.test(o) || /sour cream/i.test(o))) return "crema should be absent: " + opts.join(", ");
        const taco = cart.find((l) => /taco/i.test(l.itemId) && !/sopesaso/i.test(l.itemId));
        if (!taco || Number(taco.quantity) !== 2) return "expected 2 tacos";
        const to = (taco.modifiers || []).map((m: any) => String(m.option || ""));
        if (!to.some((o: string) => /tripa/i.test(o))) return "taco missing tripas: " + to.join(", ");
        if (!to.some((o: string) => /harina|flour/i.test(o))) return "taco missing harina: " + to.join(", ");
        return null;
      },
    },
    {
      name: "variant: sopesaso spelling + sin crema",
      turns: [
        { speaker: "caller", start: 0, end: 3, text: "Un sopesaso de bistec con chorizo sin crema", language: "es" },
        { speaker: "caller", start: 4, end: 5, text: "es todo", language: "es" },
      ],
      expect: (cart) => {
        const s = cart.find((l) => String(l.itemId || "").includes("sopesaso")) || cart[0];
        if (!s) return "missing item";
        const opts = (s.modifiers || []).map((m: any) => String(m.option || ""));
        if (!opts.some((o: string) => /bistec/i.test(o)) || !opts.some((o: string) => /chorizo/i.test(o))) return "meats: " + opts.join(", ");
        if (opts.some((o: string) => /crema|sour cream/i.test(o))) return "had crema";
        return null;
      },
    },
    {
      name: "fix21 call: tres quesadillas comal chorizo/tepa/buche",
      turns: [
        { speaker: "caller", start: 0, end: 2, text: "Bueno, me gustaría hacer una orden, porfa.", language: "es" },
        { speaker: "caller", start: 2, end: 5, text: "Este, quiero tres quesadillas de comal,", language: "es" },
        { speaker: "caller", start: 5, end: 9, text: "una de chorizo, una de tepa y otra de buche,", language: "es" },
        { speaker: "caller", start: 9, end: 11, text: "y sería todo. Gracias.", language: "es" },
      ],
      expect: (cart) => {
        const qs = cart.filter((l) => /quesadilla/i.test(l.itemId));
        if (qs.length !== 3) return `expected 3 quesadilla lines, got ${qs.length}: ` + JSON.stringify(qs.map((l) => l.modifiers));
        const meats = qs.flatMap((l) => (l.modifiers || []).map((m: any) => String(m.option || ""))).join(" | ");
        if (!/chorizo/i.test(meats)) return "missing chorizo: " + meats;
        if (!/tripa/i.test(meats)) return "missing tripa (from tepa): " + meats;
        if (!/buche/i.test(meats)) return "missing buche: " + meats;
        return null;
      },
    },
    {
      name: "fix21 variant: unknown meat kept + flagged",
      turns: [
        { speaker: "caller", start: 0, end: 4, text: "Tres quesadillas de comal, una de chorizo, una de xyzzy y otra de buche", language: "es" },
        { speaker: "caller", start: 5, end: 6, text: "es todo", language: "es" },
      ],
      expect: (cart) => {
        const qs = cart.filter((l) => /quesadilla/i.test(l.itemId));
        if (qs.length !== 3) return `expected 3 lines, got ${qs.length}`;
        const flags = qs.flatMap((l) => (l.modifiers || []).filter((m: any) => /meat_needs_ask/i.test(String(m.step || m.groupName || ""))));
        if (!flags.some((m: any) => /xyzzy/i.test(String(m.option || "")))) return "missing meat_needs_ask xyzzy: " + JSON.stringify(qs);
        return null;
      },
    },
    {
      name: "fix23 call: 2 quesadillas bistec + torta campechana",
      turns: [
        { speaker: "caller", start: 0, end: 4, text: "me puede ordenar dos quesadillas de bistec, por favor?", language: "es" },
        { speaker: "staff", start: 5, end: 6, text: "¿Qué más?", language: "es" },
        { speaker: "caller", start: 7, end: 10, text: "Y una torta de campechana.", language: "es" },
        { speaker: "staff", start: 11, end: 13, text: "¿Quesadillas de comal o harina?", language: "es" },
        { speaker: "caller", start: 14, end: 14.5, text: "¿O mal?", language: "es" },
        { speaker: "staff", start: 15, end: 16, text: "O sea, bistec y chorizo.", language: "es" },
        { speaker: "caller", start: 17, end: 17.5, text: "Sí.", language: "es" },
        { speaker: "caller", start: 18, end: 19, text: "Nada más.", language: "es" },
      ],
      expect: (cart) => {
        const qs = cart.filter((l) => /quesadilla/i.test(l.itemId));
        const torta = cart.find((l) => /torta/i.test(l.itemId));
        if (!qs.length) return "missing quesadilla: " + JSON.stringify(cart);
        const qOpts = (qs[0].modifiers || []).map((m: any) => String(m.option || ""));
        if (!qOpts.some((o: string) => /bistec|steak/i.test(o))) return "quesadilla missing bistec: " + qOpts.join(", ");
        if (!torta) return "missing torta campechana: " + JSON.stringify(cart);
        const opts = (torta.modifiers || []).map((m: any) => String(m.option || ""));
        if (!opts.some((o: string) => /bistec|steak/i.test(o))) return "torta missing bistec: " + opts.join(", ");
        if (!opts.some((o: string) => /chorizo/i.test(o))) return "torta missing chorizo: " + opts.join(", ");
        if (cart.some((l) => /gordita|mole/i.test(l.itemId))) return "unexpected dish in cart";
        return null;
      },
    },
    {
      name: "fix22 call: guarache prensado+duro, no lechuga (Bueno opener)",
      turns: [
        { speaker: "caller", start: 0, end: 1, text: "Bueno,", language: "es" },
        { speaker: "caller", start: 2, end: 4, text: "me gustaría ponerlo en orden, por favor.", language: "es" },
        { speaker: "caller", start: 5, end: 7, text: "Quiero un guarache", language: "es" },
        { speaker: "caller", start: 7, end: 9, text: "de prensado", language: "es" },
        { speaker: "caller", start: 9, end: 11, text: "con duro,", language: "es" },
        { speaker: "caller", start: 11, end: 13, text: "no lechuga,", language: "es" },
        { speaker: "caller", start: 13, end: 15, text: "y sería todo.", language: "es" },
        { speaker: "caller", start: 15, end: 16, text: "Gracias.", language: "es" },
      ],
      expect: (cart) => {
        const h = cart.find((l) => /huarache/i.test(l.itemId));
        if (!h) return "missing huarache: " + JSON.stringify(cart);
        const opts = (h.modifiers || []).map((m: any) => String(m.option || ""));
        if (!opts.some((o) => /prensado/i.test(o))) return "missing prensado: " + opts.join(", ");
        if (!opts.some((o) => /duro|pork rinds/i.test(o))) return "missing duro: " + opts.join(", ");
        if (opts.some((o) => /lechuga|lettuce/i.test(o))) return "lechuga should be absent";
        return null;
      },
    },
    {
      name: "variant: English no sour cream",
      turns: [
        { speaker: "caller", start: 0, end: 3, text: "One sopesazo with steak and chorizo", language: "en" },
        { speaker: "caller", start: 3.5, end: 4, text: "no sour cream", language: "en" },
        { speaker: "caller", start: 5, end: 6, text: "that's all", language: "en" },
      ],
      expect: (cart) => {
        const s = cart.find((l) => String(l.itemId || "").includes("sopesaso")) || cart[0];
        if (!s) return "missing item";
        const opts = (s.modifiers || []).map((m: any) => String(m.option || ""));
        if (!opts.some((o: string) => /bistec|steak/i.test(o))) return "missing steak: " + opts.join(", ");
        if (!opts.some((o: string) => /chorizo/i.test(o))) return "missing chorizo: " + opts.join(", ");
        if (opts.some((o: string) => /crema|sour cream/i.test(o))) return "had cream";
        return null;
      },
    },
  ];

  for (const c of cases) {
    const key = `replay-fix20-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const r = await shadowOrderFromTurns(c.turns, run(key));
      const err = c.expect(r.cart || [], r);
      ok(c.name, !err, err || JSON.stringify((r.cart || []).map((l: any) => ({ id: l.itemId, q: l.quantity, mods: (l.modifiers || []).map((m: any) => m.option) }))));
      if (err) console.log("    steps:", JSON.stringify(r.steps?.slice(-6), null, 0).slice(0, 500));
    } catch (e) {
      ok(c.name, false, e instanceof Error ? e.message : String(e));
    }
  }
}

// ---- intro2: short notices (v2 clips), post-call language learning, PROMPT_TEMPO default ----
{
  const B = "https://x.test";
  const newEs = await noticeLine("es", { base: B });
  ok("intro2: new-caller es notice uses v2 clip", newEs.includes("notice-new-v2-es.mp3"), newEs);
  const newEn = await noticeLine("en", { base: B });
  ok("intro2: new-caller en notice uses v2 clip", newEn.includes("notice-new-v2-en.mp3"), newEn);
  const retEs = await noticeLine("es", { base: B, name: "Carlos", returning: true });
  ok("intro2: returning es Carlos uses named v2 clip", retEs.includes("notice-named-v2-es-carlos.mp3"), retEs);
  const retEn = await noticeLine("en", { base: B, name: "Carlos", returning: true });
  ok("intro2: returning en Carlos uses named v2 clip", retEn.includes("notice-named-v2-en-carlos.mp3"), retEn);
  const retNoName = await noticeLine("es", { base: B, returning: true });
  ok("intro2: returning without name → new-caller notice", retNoName.includes("notice-new-v2-es.mp3"), retNoName);
  ok("intro2: voicemail lead without name is empty", (await noticeLine("es", { base: B, voicemail: true })) === "");
  const vmEn = await noticeLine("en", { base: B, voicemail: true, name: "Carlos", returning: true });
  ok("intro2: voicemail lead = short named clip", vmEn.includes("notice-named-v2-en-carlos.mp3"), vmEn);
  const T = (speaker: "caller" | "staff", text: string, language: "es" | "en") => ({ speaker, start: 0, end: 1, text, language });
  ok("intro2: dominant caller language en", dominantCallerLanguage([T("caller", "hi I want two tacos please", "en"), T("staff", "hola buenas tardes que le damos", "es"), T("caller", "sí", "es")] as any) === "en");
  ok("intro2: dominant caller language es", dominantCallerLanguage([T("caller", "quiero dos tacos de bistec por favor", "es"), T("caller", "okay", "en")] as any) === "es");
  ok("intro2: too few caller words → null", dominantCallerLanguage([T("caller", "hello", "en")] as any) === null);
  ok("tempo125: 1.25 → -t125, 1.0 → none", tempoSuffix(1.25) === "-t125" && tempoSuffix(1) === "", tempoSuffix(1.25));
  ok("tempo125: intro/hold clips eligible", ["opening-es", "notice-new-v2-es", "notice-named-v2-en-carlos", "hold-es", "held-en", "hold-switch-v2-en"].every(tempoEligible));
  ok("tempo125: whisper/desk/voicemail/music stay 1.0", !["whisper-es-carlos", "desk-accept-es", "voicemail-es", "voicemail-thanks-en", "hold-music-loop"].some(tempoEligible));
}

console.log(failed ? `\n${failed} failed` : "\nAll replay checks passed");
process.exit(failed ? 1 : 0);
