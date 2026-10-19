// Build or check pack-meal-guide.json and especial-guide.json from the website rules.
//   npm run build:pack-guides [-- --dry]   write the guides (backs them up first)
//   npm run check:pack-guides              compare guides vs. rules CSVs + cocinaelvis.com, exit 1 on errors
import fs from "node:fs";
import { PACK_RULES, ESPECIAL_RULES, PACK_GUIDE, ESPECIAL_GUIDE, readRuleRows, loadStorefrontProducts, key, ruleWord, storeSourceFor, type RuleRow, type StoreProduct } from "./pack-especial-rules-lib.js";
import { cleanLabel } from "./guide-rules-lib.js";

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const DRY = args.includes("--dry");
const errors: string[] = [];
const warnings: string[] = [];
const changes: string[] = [];

const code = (s: string) => String(s).match(/^\s*\(([A-Z]{1,4})\)/)?.[1] || "";
let currentWord = "";
const isVirtual = (name: string) => currentWord === "deluxe" && /^(regular\b|onion cilantro)/.test(key(name));
const sing = (t: string) => t.split(" ").map((w) => w.replace(/s$/, "")).join(" ");
function sameOption(guideOpt: any, siteName: string, word = "") {
  if (word === "deluxe") return /deluxe|lettuce|lechuga/.test(key(guideOpt.name)) && /deluxe/.test(key(siteName));
  const a = sing(key(guideOpt.websiteName || guideOpt.name)), b = sing(key(siteName));
  if (guideOpt.websiteName) return guideOpt.websiteName === siteName;
  if (guideOpt.code && code(siteName) && guideOpt.code === code(siteName) && code(siteName) !== "QD") return true;
  return a === b || a.startsWith(b + " ") || b.startsWith(a + " ");
}

function processGuide(file: string, listKey: string, rules: RuleRow[], products: StoreProduct[]) {
  const guide = JSON.parse(fs.readFileSync(file, "utf-8"));
  for (const item of guide[listKey]) {
    const name = item.displayName;
    const rule = rules.find((r) => key(r.squareItem) === key(name));
    const product = products.find((p) => key(p.name) === key(name));
    if (!rule) { errors.push(`${name}: no row in the rules CSV`); continue; }
    if (!product) { errors.push(`${name}: not found on cocinaelvis.com`); continue; }
    const words = new Set(item.steps.map(ruleWord));
    for (const w of [...rule.ask, ...rule.optional]) if (!words.has(w)) errors.push(`${name}: rules CSV names "${w}" but the guide has no such step`);
    // Item-level: aliases + summary + price range from the site
    const aliases = Array.from(new Set([...(item.aliases || []), ...rule.callersSay.map((s) => s.toLowerCase())]));
    if (aliases.length !== (item.aliases || []).length) { changes.push(`${name}: +aliases`); item.aliases = aliases; }
    if (rule.summary && item.summary !== rule.summary) { changes.push(`${name}: summary`); item.summary = rule.summary; }
    if (product.skus.length) {
      const lo = Math.min(...product.skus.map((s) => s.priceCents)) / 100, hi = Math.max(...product.skus.map((s) => s.priceCents)) / 100;
      if (item.priceRange) { if (item.priceRange.min !== lo || item.priceRange.max !== hi) { errors.push(`${name}: price range ${item.priceRange.min}-${item.priceRange.max} but site says ${lo}-${hi}`); item.priceRange = { min: lo, max: hi }; } }
      else if (typeof item.price === "number" && product.skus.length === 1 && item.price !== lo) { errors.push(`${name}: price ${item.price} but site says ${lo}`); item.price = lo; }
    }
    item.squareItemId = product.squareItemId;
    const used = new Set<string>();
    for (const step of item.steps) {
      const word = ruleWord(step);
      currentWord = word;
      const mode = rule.ask.includes(word) ? "ask" : rule.optional.includes(word) ? "optional" : null;
      if (!mode) { errors.push(`${name} / ${step.key}: not listed as ask or optional in the rules CSV`); continue; }
      const src = storeSourceFor(step, product);
      if (!src) { (mode === "ask" ? errors : warnings).push(`${name} / ${step.key}: no matching option group on the website`); continue; }
      const siteMin = "skus" in src ? 1 : src.group.min;
      const siteMax = "skus" in src ? 1 : (src.group.max ?? src.group.choices.filter((c) => !c.hidden).length);
      if ("group" in src) used.add(src.group.name);
      if (siteMin > 0 && mode !== "ask") errors.push(`${name} / ${step.key}: the website requires it (min ${siteMin}) but the rules make it optional`);
      const wantRequired = mode === "ask";
      if (step.required !== wantRequired) { errors.push(`${name} / ${step.key}: required=${step.required} but rules say ${mode}`); step.required = wantRequired; }
      if (step.mode !== mode) { changes.push(`${name} / ${step.key}: mode ${mode}`); step.mode = mode; }
      const min = wantRequired ? Math.max(1, siteMin) : 0;
      if (step.minSelections !== min) { errors.push(`${name} / ${step.key}: min ${step.minSelections} but site says ${min}`); step.minSelections = min; }
      if ((step.maxSelections ?? null) !== siteMax) { errors.push(`${name} / ${step.key}: max ${step.maxSelections ?? "any"} but site says ${siteMax ?? "any"}`); step.maxSelections = siteMax; }
      // Options: names, prices, preselects from the site
      const site = "skus" in src
        ? src.skus.map((s) => ({ name: s.name, cents: s.priceCents, pre: false, isSku: true }))
        : src.group.choices.filter((c) => !c.hidden).map((c) => ({ name: c.name, cents: c.priceCents, pre: c.preselected, isSku: false }));
      const keep: any[] = [];
      for (const s of site) {
        const old = (step.options || []).find((o: any) => !isVirtual(o.name) && sameOption(o, s.name, word));
        const opt = old ? { ...old } : { name: cleanLabel(s.name), aliases: [key(cleanLabel(s.name))] };
        if (!old) errors.push(`${name} / ${step.key}: website option "${s.name}" missing from the guide`);
        opt.websiteName = s.name;
        if (s.isSku) { if (opt.price !== s.cents / 100) { if (old && opt.price !== undefined) errors.push(`${name} / ${step.key}: "${opt.name}" price ${opt.price} but site says ${s.cents / 100}`); opt.price = s.cents / 100; } }
        else if (opt.priceDeltaCents !== s.cents) { opt.priceDeltaCents = s.cents; changes.push(`${name} / ${step.key}: price ${s.name}`); }
        if (s.pre) opt.preselected = true; else delete opt.preselected;
        if (code(s.name) && !opt.code) opt.code = code(s.name);
        keep.push(opt);
      }
      for (const o of step.options || []) {
        if (isVirtual(o.name)) { keep.unshift(o); continue; }
        if (!site.some((s) => sameOption(o, s.name, word))) errors.push(`${name} / ${step.key}: guide option "${o.name}" is not on the website`);
      }
      step.options = keep;
      step.website = { min: siteMin, max: siteMax, preselected: site.filter((s) => s.pre).map((s) => s.name) };
    }
    for (const g of product.groups) if (!used.has(g.name) && !g.hidden) warnings.push(`${name}: website group "${g.name}" (min ${g.min}) has no guide step`);
  }
  return guide;
}

const products = await loadStorefrontProducts();
const pack = processGuide(PACK_GUIDE, "packMealItems", readRuleRows(PACK_RULES), products);
const esp = processGuide(ESPECIAL_GUIDE, "especialItems", readRuleRows(ESPECIAL_RULES), products);
for (const e of errors) console.log(`ERROR   ${e}`);
for (const w of warnings) console.log(`warning ${w}`);
if (!CHECK) {
  console.log(`${changes.length} field update(s), ${errors.length} correction(s).`);
  if (!DRY) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
    for (const [file, data, ver] of [[PACK_GUIDE, pack, "3.0"], [ESPECIAL_GUIDE, esp, "2.0"]] as const) {
      fs.copyFileSync(file, file.replace(/\.json$/, `.backup-${stamp}.json`));
      (data as any).version = ver;
      (data as any).source = "cocinaelvis.com storefront + data/rules/" + (file === PACK_GUIDE ? "pack-rules.csv" : "especial-rules.csv");
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    }
    console.log("Wrote pack-meal-guide.json and especial-guide.json (backups saved).");
  }
}
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
if (CHECK && errors.length) process.exit(1);
