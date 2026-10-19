// Check combo-guide.json against what cocinaelvis.com (Square Online) actually allows,
// and against Square's catalog rules (item-level overrides + modifier-list defaults).
// Read-only everywhere. Usage: npm run check:guides  (exit 1 on any ERROR)
import fs from "node:fs";
import {
  GUIDE_JSON, readRules, loadSquareCombos, loadStorefrontCombos, findSquareItem, slotForGroup, norm,
  optionName, optionDelta, cleanLabel, valueMatchesOption, money, type StoreItem
} from "./guide-rules-lib.js";

let errors = 0, warns = 0;
const err = (m: string) => { errors += 1; console.log(`  ERROR ${m}`); };
const warn = (m: string) => { warns += 1; console.log(`  WARN  ${m}`); };
const fmtMax = (m: number | null | undefined) => (m === null || m === undefined ? "any" : String(m));
const priceOf = (note?: string) => {
  const m = String(note || "").match(/([+-])?\$(\d+(?:\.\d+)?)/);
  return m ? Math.round(Number(m[2]) * 100) * (m[1] === "-" ? -1 : 1) : 0;
};

async function main() {
  const rules = readRules();
  const guide = JSON.parse(fs.readFileSync(GUIDE_JSON, "utf-8"));
  const square = await loadSquareCombos();
  const store: StoreItem[] = await loadStorefrontCombos();

  for (const site of store) {
    if (!square.some((s) => s.squareCatalogObjectId === site.squareItemId)) { console.log(`\n${site.name}`); err("on the website but not in the app's Square menu"); }
    if (!rules.some((r) => norm(r.squareItem) === norm(site.name) || r.squareItemId === site.squareItemId)) { console.log(`\n${site.name}`); err("on the website but has no row in combo-rules.csv"); }
  }

  for (const rule of rules) {
    console.log(`\n${rule.squareItem}`);
    const before = errors;
    const item = findSquareItem(square, rule);
    const site = store.find((s) => s.squareItemId === (item?.squareCatalogObjectId || rule.squareItemId));
    const g = (guide.comboItems || []).find((c: any) => norm(c.displayName) === norm(rule.squareItem));
    if (!item) { err("not in the app's Square menu"); continue; }
    if (!site) { err("not found on cocinaelvis.com"); continue; }
    if (!g) { err("missing from combo-guide.json (run npm run build:guides)"); continue; }

    if (site.priceCents !== item.priceCents) err(`base price website ${money(site.priceCents)} vs Square menu ${money(item.priceCents)}`);
    if (Math.round(g.price * 100) !== site.priceCents) err(`base price website ${money(site.priceCents)} vs guide $${g.price}`);

    for (const sg of site.groups) {
      if (sg.hidden) continue;
      const appGroup = item.modifierGroups?.find((x) => x.id === sg.squareListId);
      const step = (g.steps || []).find((s: any) => s.squareGroupId === sg.squareListId);
      const label = `"${sg.name}" (website min ${sg.min}, max ${fmtMax(sg.max)}${sg.choices.some((c) => c.preselected) ? `, preselects ${sg.choices.filter((c) => c.preselected).map((c) => cleanLabel(c.name)).join("/")}` : ""})`;
      if (!appGroup) { err(`${label} not in the app's Square menu`); continue; }
      // Square catalog rules as the app reads them (item override, else list default) must equal the website.
      const siteMaxN = sg.max === null ? appGroup.options.length : sg.max;
      if ((appGroup.minSelections ?? 0) !== sg.min || (appGroup.maxSelections ?? 0) !== siteMaxN) {
        err(`${label}: app reads Square as min ${appGroup.minSelections}, max ${appGroup.maxSelections}`);
      }
      if (!step) { err(`${label} has no step in the guide`); continue; }
      const stepMin = step.mode === "ask" ? step.minSelections : 0;
      if (sg.min > 0) {
        const pre = sg.choices.filter((c) => c.preselected);
        if (step.mode === "optional") err(`${label} is required on the website but optional in the guide`);
        if (step.mode === "default" && !pre.length) err(`${label} is required, website preselects nothing, but the guide applies a default`);
        if (step.mode === "default" && pre.length && !pre.some((c) => valueMatchesOption(cleanLabel(c.name), step.default) || norm(c.name) === norm(cleanLabel(step.default)))) {
          err(`${label}: guide default "${step.default}" is not the website's preselected choice`);
        }
        if (step.mode === "ask" && stepMin < sg.min) err(`${label}: guide asks for ${stepMin}, website needs ${sg.min}`);
      }
      const stepMax = step.maxSelections === null ? null : Number(step.maxSelections);
      if (sg.max !== null && (stepMax === null || stepMax > sg.max)) err(`${label}: guide allows ${fmtMax(stepMax)} picks`);
      if (sg.max === null && stepMax !== null && stepMax < sg.choices.length && step.slot !== "prep") warn(`${label}: guide caps picks at ${stepMax}`);
      // choices + upcharges
      const shown = sg.choices.filter((c) => !c.hidden);
      for (const c of shown) {
        const opt = (step.options || []).find((o: any) => norm(cleanLabel(o.name)) === norm(cleanLabel(c.name)));
        if (!opt) { err(`${label}: website choice "${c.name}" missing from guide`); continue; }
        if (priceOf(opt.price_note) !== c.priceCents) err(`${label}: ${cleanLabel(c.name)} website ${money(c.priceCents)} vs guide ${opt.price_note}`);
      }
      for (const o of step.options || []) {
        if (o.value === "none") continue;
        if (!shown.some((c) => norm(cleanLabel(c.name)) === norm(cleanLabel(o.name)))) err(`${label}: guide option "${o.name}" is not offered on the website`);
      }
      // CSV wording vs website
      const slot = slotForGroup(sg.name) || "";
      if (sg.min > 0 && rule.defaults[slot] && !rule.ask.includes(slot as any)) {
        const pre = sg.choices.filter((c) => c.preselected).map((c) => cleanLabel(c.name));
        if (!pre.length) warn(`CSV default ${slot}=${rule.defaults[slot]} ignored: website requires "${sg.name}" with nothing preselected, so Elvi asks`);
        else if (!pre.some((p) => valueMatchesOption(rule.defaults[slot], p))) warn(`CSV default ${slot}=${rule.defaults[slot]} ignored: website preselects ${pre.join("/")}`);
      }
      if (sg.min === 0 && rule.defaults[slot] && slot !== "prep") warn(`default ${slot}=${rule.defaults[slot]} is Elvi's choice; the website leaves "${sg.name}" empty unless picked`);
    }
    for (const step of g.steps || []) {
      if (!site.groups.some((sg) => sg.squareListId === step.squareGroupId)) err(`guide step ${step.key} is not a website group`);
    }
    if (errors === before) console.log("  ok (matches website)");
  }
  console.log(`\n${errors} error(s), ${warns} warning(s)`);
  process.exit(errors ? 1 : 0);
}
main().catch((e) => { console.error(`check-guides failed: ${e instanceof Error ? e.message : e}`); process.exit(1); });
