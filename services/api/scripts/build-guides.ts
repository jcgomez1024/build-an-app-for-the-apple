// Build data/combo-guide.json from Square's catalog (read-only) + data/rules/combo-rules.csv.
// Usage: npm run build:guides            (writes combo-guide.json, after a backup)
//        npm run build:guides -- --dry    (prints a summary, writes nothing)
import fs from "node:fs";
import path from "node:path";
import {
  DATA_DIR, GUIDE_JSON, readRules, loadSquareCombos, findSquareItem, slotForGroup, stepKeyForSlot, kindForSlot,
  norm, optionName, optionDelta, optionCode, cleanLabel, valueMatchesOption, money,
  loadStorefrontCombos, type StoreItem,
  type Slot, type SquareOption, type ComboRuleRow
} from "./guide-rules-lib.js";

const DRY = process.argv.includes("--dry");

type GuideOption = { name: string; label: string; code?: string; price_note: string; aliases: string[]; family?: string; value?: string };

const REGULAR_PREP: GuideOption = {
  name: "Regular",
  label: "Regular (onion, cilantro, lime)",
  price_note: "+$0.00",
  value: "none",
  aliases: ["regular", "normal", "sencillo", "sencilla", "onion cilantro", "cebolla cilantro", "cebolla y cilantro", "con todo normal"]
};

const SLOT_TITLES: Record<Slot, [string, string]> = {
  tortilla: ["Tortilla", "Ask which tortilla: street corn, flour (+$1) or homemade comal (+$2)."],
  option: ["Regular or queso", "Do not ask. Regular unless the customer says queso."],
  item1: ["First item", "Ask what the first item is (taco, quesadilla, torta, gordita...)."],
  item2: ["Second item", "Ask what the second item is."],
  meat1: ["First meat", "Ask for the first meat. If they say one meat for both, use it for both."],
  meat2: ["Second meat", "Ask for the second meat. If they said one meat for both, it is already filled."],
  meat: ["Meat", "Ask what meat."],
  size: ["Burrito size", "Do not ask. Regular 10 inch unless they say grande."],
  inside: ["Inside the burrito", "Do not ask. Comes with beans, rice, cheese, sour cream, onion, cilantro. Only change if they say (sin / doble)."],
  dip: ["Dip with chips", "Do not ask. Pico de gallo unless they say guacamole or queso."],
  side: ["Side", "Do not ask. Rice and beans unless they say only rice or only beans."],
  prep: ["Regular or deluxe", "Do not ask. Regular unless they say deluxe / preparada."],
  salsa: ["Salsa", "Do not ask. Medium salsa verde unless they name a salsa or say no salsa."],
  extras: ["Extras", "Do not ask. Only add extras the customer names."]
};

function autoAliases(name: string): string[] {
  const label = cleanLabel(name);
  const parts = label.split("/").map((p) => p.trim()).filter(Boolean);
  const out = new Set<string>([norm(label)]);
  for (const p of parts) out.add(norm(p));
  const code = optionCode(name);
  if (code) out.add(code.toLowerCase());
  return [...out].filter(Boolean);
}

function findExistingOption(existingSteps: any[], key: string, squareName: string) {
  const step = existingSteps.find((s) => s.key === key);
  const opts: any[] = step?.options || [];
  const code = optionCode(squareName);
  const target = norm(cleanLabel(squareName));
  return opts.find((o) => code && o.code === code)
    || opts.find((o) => norm(cleanLabel(o.name || "")) === target)
    || opts.find((o) => {
      const n = norm(cleanLabel(o.name || ""));
      return n && (n.includes(target) || target.includes(n));
    });
}

// Aliases that caused wrong matches before (e.g. "deluxe" on the Pico dip pre-filled the dip).
const BAD_ALIASES: Record<string, string[]> = {
  "burrito-side": ["deluxe", "preparada", "preparado", "de lujo"],
  "regular-deluxe": ["con todo", "pico", "crema", "sour cream", "lechuga", "lettuce"],
  // Inside the burrito: bare "queso"/"guacamole" usually mean the chips dip; "regular" means size.
  "burrito-options": ["regular", "normal", "queso", "guacamole", "guac"],
  // "asada" alone means carne asada (steak) to callers, not the salsa.
  salsa: ["asada", "tomato", "tomate"]
};

// Extra caller words by option (matched on the cleaned option label, any step).
const EXTRA_ALIASES: Array<[RegExp, string[]]> = [
  [/^bistec/i, ["asada", "carne asada", "bistek"]],
  [/^duro/i, ["chicharron", "chicharrones"]],
  [/^alpastor/i, ["pastor", "al pastor", "adobada"]],
  [/^taquer[oa] \/ street/i, ["maiz", "de maiz", "corn", "street"]],
  [/^comal \/ homemade/i, ["hecha a mano", "hechas a mano", "a mano", "handmade", "comal"]],
  [/^medium salsa verde/i, ["salsa verde", "verde", "medium"]],
  [/^hot salsa roja/i, ["salsa roja", "roja", "hot", "picante", "la que pica"]],
  [/^mild salsa asada/i, ["salsa asada", "mild asada"]],
  [/^mild salsa tomato/i, ["salsa de tomate", "salsa tomato", "mild tomato"]]
];

function pickOption(options: GuideOption[], value: string) {
  return options.find((o) => norm(o.label) === norm(value))
    || options.find((o) => valueMatchesOption(value, o.name))
    || options.find((o) => valueMatchesOption(value, o.label));
}

// "Con todo" for the burrito inside step = the normal fillings (what the menu description lists).
const CON_TODO = /^(frijoles refritos|arroz|queso fresco|crema|cebolla|cilantro)\b/i;

function buildCombo(rule: ComboRuleRow, item: any, existing: any, store: StoreItem | undefined) {
  const existingSteps: any[] = existing?.steps || [];
  const steps: any[] = [];
  const warnings: string[] = [];
  const askSet = new Set(rule.ask);

  if (!store) warnings.push(`not found on cocinaelvis.com storefront; using Square catalog rules only`);
  for (const group of item.modifierGroups || []) {
    const slot = slotForGroup(group.name);
    if (!slot) { warnings.push(`no slot for Square group "${group.name}" (skipped)`); continue; }
    // Website rules win: min/max, preselected choice, hidden groups.
    const site = store?.groups.find((g) => g.squareListId === group.id);
    if (store && !site) { warnings.push(`group "${group.name}" is not shown on the website (skipped)`); continue; }
    if (site?.hidden) { warnings.push(`group "${group.name}" is hidden on the website (skipped)`); continue; }
    const siteMin = site ? site.min : Number(group.minSelections || 0);
    const siteMax = site ? site.max : (group.maxSelections ?? null);
    const sitePreselected = site
      ? site.choices.filter((c) => c.preselected && !c.hidden).map((c) => c.name)
      : (group.defaultOptions || []).map((n: string) => cleanLabel(n));
    const key = stepKeyForSlot(slot, item.name);
    const prev = existingSteps.find((s) => s.key === key);
    let options: GuideOption[] = (group.options as Array<string | SquareOption>).map((o) => {
      const name = optionName(o);
      const match = findExistingOption(existingSteps, key, name);
      const bad = new Set(BAD_ALIASES[key] || []);
      const extra = EXTRA_ALIASES.filter(([re]) => re.test(cleanLabel(name))).flatMap(([, a]) => a);
      const aliases = [...new Set([...(match?.aliases || []), ...autoAliases(name), ...extra])].filter((a) => !bad.has(a));
      return {
        name,
        label: cleanLabel(name),
        ...(optionCode(name) ? { code: optionCode(name) } : {}),
        price_note: money(optionDelta(o)),
        aliases,
        ...(match?.family ? { family: match.family } : {}),
        ...(match?.value ? { value: match.value } : {})
      };
    });
    if (slot === "prep") {
      options = [REGULAR_PREP, ...options.map((o) => ({ ...o, aliases: [...new Set([...o.aliases, "deluxe", "de lujo", "preparada", "preparado"])] }))];
    }

    if (site) {
      // Drop choices the website hides.
      const shown = new Set(site.choices.filter((c) => !c.hidden).map((c) => norm(c.name)));
      options = options.filter((o) => o.value === "none" || shown.has(norm(o.name)) || shown.has(norm(cleanLabel(o.name))));
    }
    if (slot === "inside") {
      options = options.map((o) => CON_TODO.test(o.label) ? { ...o, aliases: [...new Set([...o.aliases, "con todo", "todo", "everything", "with everything"])] } : o);
    }

    // Mode: the CSV only chooses wording (ask vs default) and can never loosen a group the website requires.
    let mode: "ask" | "default" | "optional" = askSet.has(slot) ? "ask" : (rule.defaults[slot] !== undefined ? "default" : "optional");
    let defaultOption: GuideOption | undefined;
    if (siteMin > 0 && mode !== "ask") {
      if (sitePreselected.length) {
        mode = "default";
        defaultOption = pickOption(options, sitePreselected[0]);
        if (rule.defaults[slot] && defaultOption && !valueMatchesOption(rule.defaults[slot], defaultOption.name)) {
          warnings.push(`CSV default ${slot}=${rule.defaults[slot]} differs from website preselect "${sitePreselected[0]}"; using the website's`);
        }
      } else {
        mode = "ask";
        warnings.push(`website requires "${group.name}" and preselects nothing; Elvi must ask (CSV said ${rule.defaults[slot] !== undefined ? "default" : "optional"})`);
      }
    } else if (mode === "default") {
      defaultOption = pickOption(options, rule.defaults[slot]);
      if (!defaultOption) warnings.push(`default ${slot}=${rule.defaults[slot]} not found in Square group "${group.name}"`);
    }
    const isMultiSlot = siteMax === null || Number(siteMax) > 1;
    const maxSelections = slot === "prep" ? 1 : siteMax === null ? (slot === "extras" ? null : options.length) : Number(siteMax);
    const minSelections = mode === "ask" ? Math.max(1, siteMin) : 0;
    const [title, instruction] = SLOT_TITLES[slot];
    steps.push({
      key,
      label: title,
      kind: kindForSlot(slot),
      slot,
      mode,
      required: mode === "ask",
      askOnlyWhenMentioned: mode !== "ask",
      minSelections,
      website: { min: siteMin, max: siteMax, preselected: sitePreselected },
      maxSelections,
      selection_type: isMultiSlot ? "multiple" : "single",
      instruction: mode === "ask" ? (prev?.instruction || instruction) : instruction,
      ...(defaultOption ? { default: defaultOption.name, defaultLabel: defaultOption.label, defaultSendsModifier: defaultOption.value !== "none" } : {}),
      ...(slot === "inside" ? { supportsOnly: true } : {}),
      squareGroupId: group.id,
      squareGroupName: group.name,
      options
    });
  }

  const meatSteps = steps.filter((s) => s.kind === "meat" && s.mode === "ask").length;
  const agentShouldAsk = steps.filter((s) => s.mode === "ask").map((s) => s.label);
  const aliases = [...new Set([...(existing?.aliases || []), ...rule.callersSay.map((s) => s.toLowerCase())])];
  return {
    combo: {
      id: existing?.id || `combo-${norm(item.name.replace(/^combo\s+/i, "")).replace(/\s+/g, "-")}`,
      displayName: item.name,
      squareItemId: item.squareCatalogObjectId,
      price: Number((item.priceCents / 100).toFixed(2)),
      description: existing?.description || "",
      originalDescription: existing?.originalDescription || existing?.description || "",
      summary: rule.summary || existing?.summary || "",
      includes: existing?.includes || [],
      commonOrderPhrases: rule.callersSay,
      agentShouldAsk,
      meatCount: meatSteps,
      itemNamePattern: existing?.itemNamePattern,
      aliases,
      steps
    },
    warnings
  };
}

async function main() {
  const rules = readRules();
  const current = JSON.parse(fs.readFileSync(GUIDE_JSON, "utf-8"));
  const squareCombos = await loadSquareCombos();
  const storefront = await loadStorefrontCombos().catch((e) => { console.warn(`! storefront unavailable (${e.message}); falling back to Square catalog rules`); return [] as StoreItem[]; });
  const out: any[] = [];
  for (const rule of rules) {
    const item = findSquareItem(squareCombos, rule);
    const existing = (current.comboItems || []).find((c: any) => norm(c.displayName) === norm(rule.squareItem));
    if (!item) {
      console.warn(`! ${rule.squareItem}: not found in Square, keeping existing entry unchanged`);
      if (existing) out.push(existing);
      continue;
    }
    const store = storefront.find((s) => s.squareItemId === item.squareCatalogObjectId);
    const { combo, warnings } = buildCombo(rule, item, existing, store);
    out.push(combo);
    const modes = combo.steps.map((s: any) => `${s.slot}:${s.mode}${s.defaultLabel ? `(${s.defaultLabel})` : ""}`).join(" ");
    console.log(`- ${combo.displayName} $${combo.price.toFixed(2)}  ${modes}`);
    for (const w of warnings) console.log(`    ! ${w}`);
  }
  // Keep any combo that exists in the old file but has no rule row.
  for (const c of current.comboItems || []) {
    if (!out.some((o) => norm(o.displayName) === norm(c.displayName))) out.push(c);
  }
  const next = {
    version: "4.0",
    description: "Generated by scripts/build-guides.ts from Square catalog + data/rules/combo-rules.csv. Edit the CSV, then run npm run build:guides.",
    generatedAt: new Date().toISOString(),
    structureNote: "Each step has mode: ask (required, Elvi asks), default (not asked, default applied and read back), optional (only if the caller says it). required/askOnlyWhenMentioned mirror mode for older loaders.",
    comboItems: out
  };
  if (DRY) { console.log("(dry run, nothing written)"); return; }
  const stamp = new Date().toISOString().replace(/[:]/g, "").replace(/\..+/, "");
  const backup = path.join(DATA_DIR, `combo-guide.backup-${stamp}.json`);
  fs.copyFileSync(GUIDE_JSON, backup);
  fs.writeFileSync(GUIDE_JSON, JSON.stringify(next, null, 2) + "\n");
  console.log(`Backed up old guide to ${path.relative(process.cwd(), backup)}`);
  console.log(`Wrote ${path.relative(process.cwd(), GUIDE_JSON)} (${out.length} combos)`);
}

main().catch((err) => { console.error(`build-guides failed: ${err instanceof Error ? err.message : err}`); process.exit(1); });
