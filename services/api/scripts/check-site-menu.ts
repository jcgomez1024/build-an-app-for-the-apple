/**
 * Whole-menu checker: every item the cocinaelvis.com storefront sells (all online categories)
 * must be in the app catalog (by Square item ID), every website option (sku) must be orderable at
 * the website price, and every modifier group must follow the website's min / max / preselect rules.
 *   npm run check:site-menu            (uses data/site-catalog.json)
 *   npm run check:site-menu -- --live  (re-fetches the storefront feed first)
 * Square is read only.
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const live = process.argv.includes("--live");
const { fetchSiteCatalog } = await import("./site-menu-sync.ts");
const snapshot = live ? await fetchSiteCatalog() : JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/site-catalog.json"), "utf8"));
const { getMenu, getFullMenu } = await import("../src/square.ts");
const { itemAvailability } = await import("../src/site-catalog.ts");
const menu: any[] = await getMenu();
const full: any[] = await getFullMenu();
const fullById = new Map(full.map((i) => [i.id, i]));

const errors: string[] = [];
const warnings: string[] = [];
const key = (s: string) => String(s || "").toLowerCase().replace(/\s*\([+-]\$[\d.]+\)\s*$/, "").replace(/^\s*\([a-z]{1,3}\)\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();

const rows: any[] = [];
for (const cat of snapshot.categories) {
  const products = snapshot.products.filter((p: any) => p.categories.includes(cat.name));
  let inApp = 0;
  for (const p of products) {
    const tag = `${cat.name} / ${p.name}`;
    const items = menu.filter((i) => i.squareCatalogObjectId === p.squareId);
    if (!items.length) { errors.push(`${tag}: not in the app catalog (Square item ${p.squareId})`); continue; }
    let ok = true;
    // Every website option (sku) must be orderable at the website price.
    const variationIds = new Map<string, number>();
    for (const i of items) {
      variationIds.set(i.squareVariationId, i.priceCents);
      for (const g of i.modifierGroups || []) if (/^reviewed-/.test(g.id)) for (const o of g.options) {
        const v = fullById.get(o.id); if (v) variationIds.set(v.squareVariationId, v.priceCents);
      }
    }
    for (const sku of p.skus) {
      if (!variationIds.has(sku.squareId)) { ok = false; errors.push(`${tag}: website option "${sku.name}" is not orderable in the app`); continue; }
      if (sku.priceCents != null && variationIds.get(sku.squareId) !== sku.priceCents) { ok = false; errors.push(`${tag}: "${sku.name}" app $${(variationIds.get(sku.squareId)! / 100).toFixed(2)} but site $${(sku.priceCents / 100).toFixed(2)}`); }
      if (sku.soldOut) warnings.push(`${tag}: "${sku.name}" is sold out on the website`);
    }
    // Modifier rules (checked on the item that carries the groups).
    const item = items.find((i) => (i.modifierGroups || []).length) || items[0];
    for (const sg of p.groups) {
      const g = (item.modifierGroups || []).find((x: any) => x.id === sg.squareId) || (item.modifierGroups || []).find((x: any) => key(x.name) === key(sg.name));
      if (!g) { ok = false; errors.push(`${tag}: website group "${sg.name}" missing in the app`); continue; }
      const appMax = g.maxSelections ?? 0;
      if ((g.minSelections ?? 0) !== sg.min) { ok = false; errors.push(`${tag} / ${sg.name}: min ${g.minSelections ?? 0} but site ${sg.min}`); }
      if (appMax !== sg.max && !(sg.max === 0 && appMax >= sg.choices.length)) { ok = false; errors.push(`${tag} / ${sg.name}: max ${appMax || "any"} but site ${sg.max || "any"}`); }
      const sitePre = sg.choices.filter((c: any) => c.preselected).map((c: any) => key(c.name)).sort().join("|");
      const appPre = (g.defaultOptions || []).map(key).sort().join("|");
      if (sitePre !== appPre) { ok = false; errors.push(`${tag} / ${sg.name}: preselect "${appPre || "none"}" but site "${sitePre || "none"}"`); }
      const appOpts = new Set((g.options || []).map((o: any) => key(typeof o === "string" ? o : o.name)));
      for (const c of sg.choices) if (!appOpts.has(key(c.name))) { ok = false; errors.push(`${tag} / ${sg.name}: choice "${c.name}" missing in the app`); }
    }
    if (ok) inApp++;
    const a = itemAvailability(p.squareId);
    if (a.window) warnings.push(`${tag}: site shows ${a.window.en}`);
  }
  rows.push({ category: cat.name, onSite: products.length, inApp, hours: cat.customTimes ? "custom" : "always" });
}

// Question order must match the website (fix7): sku picker first, then the site's groups in order,
// and the resolver must ask the required choices in that same order.
const { resolveMenuRequest } = await import("../src/menu-intelligence.ts");
const { resolveEspecialRequest } = await import("../src/especial-resolver.ts");
const { completeWithSiteDefaults, applyChosen } = await import("../src/site-catalog.ts");
const { getComboGuide } = await import("../src/guides.ts");
let orderChecked = 0;
const before: number[] = [];
const after: number[] = [];
const orderRows: string[] = [];
for (const p of snapshot.products) {
  const items = menu.filter((i) => i.squareCatalogObjectId === p.squareId);
  const item = items.find((i) => (i.modifierGroups || []).length) || items[0];
  if (!item) continue;
  const tag = `ORDER ${p.name}`;
  const siteIdx = (g: any) => p.groups.findIndex((sg: any) => sg.squareId === g.id || key(sg.name) === key(g.name));
  const groups = (item.modifierGroups || []);
  const reviewedAt = groups.findIndex((g: any) => /^reviewed-/.test(g.id));
  if (reviewedAt > 0) errors.push(`${tag}: size/option picker is not asked first`);
  const seq = groups.map(siteIdx).filter((i: number) => i >= 0);
  if (seq.some((v: number, i: number) => i && v < seq[i - 1])) errors.push(`${tag}: app group order ${groups.map((g: any) => g.name).join(" > ")} differs from site ${p.groups.map((g: any) => g.name).join(" > ")}`);
  // Combo guides: steps follow the site group order.
  const guide: any = /\bcombo\b/i.test(p.name) ? getComboGuide(item.name) : null;
  if (guide?.steps) {
    const gs = guide.steps.map((s: any) => p.groups.findIndex((sg: any) => sg.squareId === s.squareGroupId)).filter((i: number) => i >= 0);
    if (gs.some((v: number, i: number) => i && v < gs[i - 1])) errors.push(`${tag}: combo steps out of site order`);
    for (const st of guide.steps) if (/size/i.test(String(st.squareGroupName || "")) && st.mode === "ask") errors.push(`${tag}: combo size is asked but should default to Grande '12`);
  }
  // Ask order the customer hears (resolver), answering each question with its first choice.
  // The one allowed defaulted step: burrito / chimichanga size (Grande '12 unless the caller says small).
  // Least-friction rules (fix9): ask meat + required groups with no site preselect; preselects are silent.
  const isMeatG = (sg: any) => /carne|meat/i.test(sg.name) && !/extra/i.test(sg.name);
  const silent = (sg: any) => sg.min >= 1 && !isMeatG(sg) && sg.choices.some((c: any) => c.preselected);
  const isSize = (n: string) => { const sg = p.groups.find((x: any) => key(x.name) === key(n)); return Boolean(sg && silent(sg)); };
  const expected = p.groups.filter((sg: any) => sg.min >= 1 && sg.choices.length > 1 && !silent(sg)).map((sg: any) => key(sg.name));
  const everyStep = p.groups.filter((sg: any) => sg.min >= 1 && sg.choices.length > 1).length + (p.skus.length > 1 ? 1 : 0);
  const asked: string[] = [];
  let lastResult: any = null;
  if (guide?.steps) {
    // Combos: asked = steps left in "ask" mode; preselected ones must be defaults equal to the site preselect.
    const ask = guide.steps.filter((st: any) => st.mode === "ask" || (st.required && !st.default));
    for (const st of guide.steps) {
      const sg = p.groups.find((x: any) => x.squareId === st.squareGroupId);
      if (!sg) continue;
      // Exception (Carlos, fix10): COMBO Mix always asks which two items, even though the site preselects Street Taco.
      const mixItem = /\bmix\b/i.test(p.name) && /^item-\d-option$/.test(String(st.key));
      if (mixItem) { if (st.mode !== "ask") errors.push(`${tag}: COMBO Mix must ask "${sg.name}" (item type)`); continue; }
      if (silent(sg) && st.mode === "ask") errors.push(`${tag}: combo asks "${sg.name}" but the site preselects it`);
      if (silent(sg) && st.default) { const pre = sg.choices.find((c: any) => c.preselected); if (pre && !String(st.default).startsWith(pre.name)) errors.push(`${tag}: combo default "${st.default}" ≠ site "${pre.name}"`); }
      if (sg.min === 0 && st.mode === "ask") errors.push(`${tag}: combo asks optional "${sg.name}"`);
    }
    before.push(everyStep); after.push(ask.length);
    orderRows.push(`${p.name}: ${ask.map((st: any) => st.key).join(" > ")}`);
  }
  else if (items.length > 1 && !(item.modifierGroups || []).length) { before.push(everyStep); after.push(1); }
  if (!guide && items.length === 1) {
    try {
      const text = String(item.name);
      const run = () => completeWithSiteDefaults(resolveEspecialRequest([item] as any, { text, language: "en", actionHint: "add_item", toolArgs: { itemQuery: text }, cart: [] } as any) || resolveMenuRequest([item] as any, { text, language: "en", actionHint: "add_item", toolArgs: { itemQuery: text }, cart: [] } as any), [item], text);
      const chosen: any[] = [];
      let r: any = run();
      for (let n = 0; n < 12 && r?.ok === false && r.reason === "missing_required_modifiers" && r.requiredGroups?.length; n++) {
        const g = r.requiredGroups[0];
        asked.push(key(g.groupName));
        const first = (g.options || [])[0];
        chosen.push({ groupId: g.groupId, groupName: g.groupName, option: typeof first === "string" ? first : first?.name });
        r = applyChosen(run(), chosen, [item], text);
      }
      lastResult = r;
      // Especial resolver asks its own way ("Pambazo Elvis: Which meat would you like?").
      if (!asked.length && r?.ok === false && r.reason !== "missing_required_modifiers" && (r.comboState || /meat|carne/i.test(String(r.message || "")))) {
        const mg = p.groups.find((x: any) => isMeatG(x) && x.min >= 1);
        if (mg) asked.push(key(mg.name));
      }
    } catch (e) { warnings.push(`${tag}: could not simulate (${(e as Error).message})`); }
    if (p.groups.some((sg: any) => isSize(sg.name) && asked.includes(key(sg.name)))) errors.push(`${tag}: asks a group the site preselects (should be silent + read back)`);
    for (const sg of p.groups.filter((x: any) => x.min >= 1 && isMeatG(x) && x.choices.length > 1)) if (!asked.includes(key(sg.name))) errors.push(`${tag}: meat "${sg.name}" is not asked`);
    // Required groups filled at the end.
    if (asked.length < 12 && lastResult && lastResult.ok) {
      const mods = (lastResult.actions?.[0]?.modifiers || []).map((m: any) => key(m.groupName || ""));
      for (const sg of p.groups.filter((x: any) => x.min >= 1)) if (!mods.includes(key(sg.name)) && !(item.modifierGroups || []).every((g: any) => key(g.name) !== key(sg.name))) errors.push(`${tag}: required "${sg.name}" not filled`);
    }
    before.push(everyStep); after.push(asked.length + (items.length > 1 ? 1 : 0));
    const pos = asked.map((a) => expected.indexOf(a));
    if (pos.some((v, i) => v < 0 ? false : i && v < pos[i - 1])) errors.push(`${tag}: Elvi asks ${asked.join(" > ")} but site order is ${expected.join(" > ")}`);
    orderChecked++;
    orderRows.push(`${p.name}: ${asked.join(" > ") || "(nothing to ask)"}`);
  }
}
fs.writeFileSync("/tmp/site-order-check.txt", orderRows.join("\n"));
const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);
console.log(`\nQuestions per item (${after.length} items): ask-every-step ${avg(before)} → least-friction ${avg(after)}`);
console.log(`\nQuestion order checked on ${orderChecked} single-option items (+ all multi-option items and combos by group order). Ask order: /tmp/site-order-check.txt`);

console.log("\nCategory | on site | in app (rules OK) | hours");
for (const r of rows) console.log(`${r.category} | ${r.onSite} | ${r.inApp} | ${r.hours}`);
for (const w of warnings) console.log("WARN   ", w);
for (const e of errors) console.log("ERROR  ", e);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
fs.writeFileSync("/tmp/site-menu-check.json", JSON.stringify({ rows, errors, warnings }, null, 2));
process.exitCode = errors.length ? 1 : 0;
