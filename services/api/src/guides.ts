import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteProductFor } from './site-catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BuildStep {
  step: number;
  title: string;
  instruction: string;
  required: boolean;
  selection_type?: "single" | "multiple";
  min_selections?: number;
  max_selections: number | null;
  options: Array<{
    name: string;
    code?: string;
    price_note?: string;
    aliases?: string[];
    family?: string;
    value?: string;
    askOnlyWhenMentioned?: boolean;
    label?: string;
  }>;
  key?: string;
  /** ask = required question, default = not asked (default applied + read back), optional = only if caller says it. */
  mode?: "ask" | "default" | "optional";
  slot?: string;
  default?: string;
  defaultLabel?: string;
  defaultSendsModifier?: boolean;
  kind?: string;
  askOnlyWhenMentioned?: boolean;
  supportsOnly?: boolean;
}

export interface ComboGuide {
  display_name: string;
  price: number;
  description: string;
  aliases?: string[];
  summary?: string;
  steps: BuildStep[];
}

export interface GuidesData {
  version: string;
  guides: Record<string, ComboGuide>;
}

type ComboRuleOption = {
  name?: string;
  code?: string;
  price_note?: string;
  priceNote?: string;
  aliases?: string[];
  family?: string;
  value?: string;
  label?: string;
};

type ComboRuleStep = {
  mode?: "ask" | "default" | "optional";
  slot?: string;
  default?: string;
  defaultLabel?: string;
  defaultSendsModifier?: boolean;
  key?: string;
  label?: string;
  title?: string;
  kind?: string;
  instruction?: string;
  required?: boolean;
  minSelections?: number;
  maxSelections?: number | null;
  selection_type?: "single" | "multiple";
  options?: Array<string | ComboRuleOption>;
  askOnlyWhenMentioned?: boolean;
  supportsOnly?: boolean;
};

type ComboRule = {
  id?: string;
  displayName?: string;
  display_name?: string;
  price?: number;
  description?: string;
  aliases?: string[];
  summary?: string;
  steps?: ComboRuleStep[];
};

type ComboRulesData = {
  version?: string;
  comboItems?: ComboRule[];
};

const EMPTY_GUIDES: GuidesData = { version: "0", guides: {} };

const COMBO_RULES_PATH = path.resolve(__dirname, '../data/combo-guide.json');
const MENU_CATALOG_PATH = path.resolve(__dirname, '../data/menu-catalog.json');

let cachedGuides: GuidesData | null = null;
let cachedGuidesMtimeMs = 0;
let cachedMenuCatalog: Set<string> | null = null;
let cachedMenuCatalogMtimeMs = 0;

function readJsonIfChanged<T>(filePath: string, cachedMtime: number): { data: T | null; mtimeMs: number } {
  try {
    const stat = fs.statSync(filePath);
    if (cachedMtime === stat.mtimeMs) return { data: null, mtimeMs: cachedMtime };
    const raw = fs.readFileSync(filePath, 'utf-8');
    return { data: JSON.parse(raw) as T, mtimeMs: stat.mtimeMs };
  } catch (err) {
    console.warn(`[guides] failed to load ${filePath}:`, (err as Error).message);
    return { data: null, mtimeMs: cachedMtime };
  }
}

function loadGuides(): GuidesData {
  const { data, mtimeMs } = readJsonIfChanged<ComboRulesData>(COMBO_RULES_PATH, cachedGuidesMtimeMs);
  if (data) {
    cachedGuides = normalizeComboRules(data);
    cachedGuidesMtimeMs = mtimeMs;
  } else if (!cachedGuides) {
    cachedGuides = EMPTY_GUIDES;
  }
  return cachedGuides;
}

function normalizeComboRules(data: ComboRulesData): GuidesData {
  const guides: Record<string, ComboGuide> = {};
  for (const combo of data.comboItems || []) {
    const displayName = combo.displayName || combo.display_name || titleFromComboId(combo.id || "");
    if (!displayName) continue;
    guides[displayName] = {
      display_name: displayName,
      price: Number(combo.price) || 0,
      description: String(combo.description || ""),
      aliases: Array.isArray(combo.aliases) ? combo.aliases.map(String) : [],
      ...(combo.summary ? { summary: String(combo.summary) } : {}),
      // Steps keep the website's order (Carlos, fix7: not meat-first).
      steps: siteOrderSteps(combo.steps || [], (combo as any).squareItemId).map((step, index) => withAsk(normalizeComboRuleStep(step, index + 1)))
    };
  }
  return {
    version: String(data.version || "2.0"),
    guides
  };
}

function normalizeComboRuleStep(step: ComboRuleStep, stepNumber: number): BuildStep {
  const maxSelections = step.maxSelections === null || step.maxSelections === undefined
    ? null
    : Math.max(0, Number(step.maxSelections) || 0);
  const minSelections = Math.max(0, Number(step.minSelections) || (step.required ? 1 : 0));
  return {
    step: stepNumber,
    key: step.key,
    kind: step.kind,
    title: String(step.title || step.label || `Step ${stepNumber}`),
    instruction: String(step.instruction || defaultStepInstruction(step, maxSelections)),
    required: step.required !== false,
    min_selections: minSelections,
    max_selections: maxSelections,
    selection_type: step.selection_type || ((maxSelections || 1) > 1 ? "multiple" : "single"),
    options: (step.options || []).map(normalizeComboRuleOption),
    ...(step.askOnlyWhenMentioned ? { askOnlyWhenMentioned: true } : {}),
    ...(step.supportsOnly ? { supportsOnly: true } : {}),
    ...(step.mode ? { mode: step.mode } : {}),
    ...(step.slot ? { slot: String(step.slot) } : {}),
    ...(step.default ? { default: String(step.default), defaultLabel: String(step.defaultLabel || step.default), defaultSendsModifier: step.defaultSendsModifier !== false } : {})
  };
}

function normalizeComboRuleOption(option: string | ComboRuleOption) {
  if (typeof option === "string") return { name: option };
  return {
    name: String(option.name || ""),
    ...(option.code ? { code: String(option.code) } : {}),
    ...(option.price_note || option.priceNote ? { price_note: String(option.price_note || option.priceNote) } : {}),
    ...(Array.isArray(option.aliases) ? { aliases: option.aliases.map(String) } : {}),
    ...(option.family ? { family: String(option.family) } : {}),
    ...(option.value ? { value: String(option.value) } : {}),
    ...(option.label ? { label: String(option.label) } : {})
  };
}

function defaultStepInstruction(step: ComboRuleStep, maxSelections: number | null) {
  const label = step.label || step.title || "option";
  if (step.required === false) return `Select ${label} only if the customer asks for it.`;
  return (maxSelections || 1) > 1
    ? `Ask the customer to choose one or more ${label}.`
    : `Ask the customer to choose ${label}.`;
}

function titleFromComboId(id: string) {
  const base = String(id || "").replace(/^combo-/, "").replace(/-/g, " ").trim();
  if (!base) return "";
  return `COMBO ${base.replace(/\b\w/g, (char) => char.toUpperCase())}`;
}

export function getComboGuide(itemName: string): ComboGuide | null {
  const data = loadGuides();
  if (!itemName) return null;

  const normalized = itemName.toLowerCase().trim();

  if (data.guides[itemName]) return data.guides[itemName];

  // Exact key, display_name, or configured alias.
  for (const [key, guide] of Object.entries(data.guides)) {
    if (guideMatchPhrases(key, guide).some((phrase) => phrase === normalized)) {
      return guide;
    }
  }

  // Prefer explicit full combo names/aliases before base-word fallbacks. Without
  // this, "combo mix street taco" can match COMBO Tacos before COMBO Mix.
  for (const [key, guide] of Object.entries(data.guides)) {
    const phrases = guideMatchPhrases(key, guide);
    if (phrases.some((phrase) => containsNormalizedPhrase(normalized, phrase))) {
      return guide;
    }
  }

  // "combo mix, un taco …": the word right next to "combo" names it (fix10), before base-word fallbacks.
  for (const guide of Object.values(data.guides) as ComboGuide[]) {
    const base = String(guide.display_name || "").toLowerCase().replace(/^combo\s+/, "").replace(/s$/, "").trim();
    if (base && new RegExp(`\\bcombo\\s+(de\\s+)?${base}s?\\b|\\b${base}s?\\s+combo\\b`).test(normalized)) return guide;
  }

  // Robust combo phrasing support: "burrito combo", "combo burrito", "a combo burrito", etc.
  // Many users say "combo burrito" or "burrito combo" interchangeably.
  const hasComboWord = containsNormalizedPhrase(normalized, "combo");
  for (const [key, guide] of Object.entries(data.guides)) {
    const phrases = guideMatchPhrases(key, guide);
    const basePhrases = phrases
      .map((phrase) => phrase.replace(/^combo\s+/, "").replace(/\s+combo$/, "").trim())
      .filter(Boolean);

    if (hasComboWord && basePhrases.some((base) => (
      containsNormalizedPhrase(normalized, base) ||
      containsNormalizedPhrase(normalized, `${base} combo`) ||
      containsNormalizedPhrase(normalized, `combo ${base}`)
    ))) {
      return guide;
    }
  }

  // Legacy substring fallback
  for (const [key, guide] of Object.entries(data.guides)) {
    if (guideMatchPhrases(key, guide).some((phrase) => containsNormalizedPhrase(normalized, phrase))) {
      return guide;
    }
  }

  return null;
}

function containsNormalizedPhrase(haystack: string, phrase: string) {
  const normalizedPhrase = String(phrase || "").toLowerCase().trim();
  if (!haystack || !normalizedPhrase) return false;
  const pattern = new RegExp(`(^|\\s)${escapeRegex(normalizedPhrase).replace(/\s+/g, "\\s+")}(\\s|$)`, "i");
  return pattern.test(haystack);
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function guideMatchPhrases(key: string, guide: ComboGuide): string[] {
  return [
    key,
    guide.display_name,
    ...(guide.aliases || [])
  ]
    .map((phrase) => phrase.toLowerCase().trim())
    .filter((phrase, index, all) => phrase && all.indexOf(phrase) === index);
}

export function isGuidedCombo(itemName: string): boolean {
  return getComboGuide(itemName) !== null;
}

export function getAllGuidedComboNames(): string[] {
  return Object.keys(loadGuides().guides);
}

function loadMenuCatalog(): Set<string> {
  const { data, mtimeMs } = readJsonIfChanged<{ allowed_items?: string[] }>(MENU_CATALOG_PATH, cachedMenuCatalogMtimeMs);
  if (data) {
    const items = Array.isArray(data.allowed_items) ? data.allowed_items : [];
    cachedMenuCatalog = new Set(items.map((item) => item.toLowerCase().trim()));
    cachedMenuCatalogMtimeMs = mtimeMs;
  } else if (!cachedMenuCatalog) {
    cachedMenuCatalog = new Set();
  }
  return cachedMenuCatalog;
}

export function isApprovedItem(itemName: string): boolean {
  if (!itemName) return false;
  const catalog = loadMenuCatalog();
  if (catalog.size === 0) return true;
  const normalized = itemName.toLowerCase().trim();
  if (catalog.has(normalized)) return true;
  for (const allowed of catalog) {
    if (!allowed) continue;
    if (normalized.startsWith(allowed)) {
      const nextChar = normalized.charAt(allowed.length);
      if (nextChar === "" || /[\s(\-/]/.test(nextChar)) return true;
    }
  }
  return false;
}

export function getApprovedMenuItems(): string[] {
  return Array.from(loadMenuCatalog());
}

// ---------------------------------------------------------------------------
// Server-side slot check (used by /api/elvi/chat so it never adds a combo
// before its required ("ask") steps are filled).

export type GuideFill = {
  stepKey: string;
  title: string;
  option: string;
  label: string;
  isDefault: boolean;
  sendsModifier: boolean;
};

export type GuideEvaluation = {
  complete: boolean;
  filled: GuideFill[];
  missing: BuildStep[];
};

function normText(text: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bal\s+pastor\b/g, "alpastor")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, one: 1, a: 1, dos: 2, two: 2, both: 2, ambos: 2, ambas: 2 };

function optionHits(step: BuildStep, text: string) {
  const hits: Array<{ option: BuildStep["options"][number]; index: number; count: number }> = [];
  for (const option of step.options || []) {
    const aliases = [...(option.aliases || []), option.label || "", option.name]
      .map(normText).filter((a) => a.length >= 3 || /^[a-z]{2,4}$/.test(a));
    let best = -1;
    let bestLen = 0;
    for (const alias of aliases) {
      const m = new RegExp(`(^|\\s)${alias.replace(/\s+/g, "\\s+")}(\\s|$)`).exec(text);
      if (m && alias.length > bestLen) { best = m.index; bestLen = alias.length; }
    }
    if (best < 0) continue;
    const before = text.slice(0, best).trim().split(" ").slice(-3);
    let count = 1;
    for (const w of before) if (NUMBER_WORDS[w] || /^[12]$/.test(w)) count = NUMBER_WORDS[w] || Number(w);
    if (/\b(los dos|las dos|both|ambos|ambas|todos?)\b/.test(text.slice(best, best + 60)) || /\b(los dos|las dos|both|ambos|ambas)\b/.test(before.join(" "))) count = 2;
    hits.push({ option, index: best, count, len: bestLen } as any);
  }
  // Drop hits fully inside a longer hit ("comal" inside "taco comal", "pollo" inside "pollo asado").
  const kept = hits.filter((h: any) => !hits.some((o: any) => o !== h && o.len > h.len && h.index >= o.index && h.index + h.len <= o.index + o.len));
  return kept.sort((a, b) => a.index - b.index);
}

/** Fill guide steps from free text. Meat steps are filled in order of mention, with counts ("dos de pastor"). */
export function evaluateGuideText(guide: ComboGuide, rawText: string, opts: { resolved?: Set<string>; skipRest?: boolean } = {}): GuideEvaluation {
  const text = normText(/mix/i.test(String(guide.display_name || "")) ? normalizeMixItems(rawText) : rawText);
  const filled: GuideFill[] = [];
  const missing: BuildStep[] = [];
  const meatSteps = guide.steps.filter((s) => s.kind === "meat");
  const meatQueue: Array<BuildStep["options"][number]> = [];
  if (meatSteps.length) {
    // fix18: side answers ("solo arroz", "con arroz y frijoles") belong to the sides step, never a meat pick.
    const hasSides = guide.steps.some((s) => (s.options || []).some((o: any) => /\bsolo\s+arroz\b/i.test(String(o.name || ""))));
    const meatText = hasSides
      ? text.replace(/\b(?:con|with)\s+(?:arroz|rice)\s+(?:y|and|&)\s+(?:frijoles|beans)\b/g, " ").replace(/\b(?:solo|sola|only|just|sin|no|without|con|with|y|and)\s+(?:de\s+)?(?:arroz|rice|frijoles|beans)\b/g, " ")
      : text;
    for (const hit of optionHits(meatSteps[0], meatText)) for (let i = 0; i < hit.count; i += 1) meatQueue.push(hit.option);
    // One meat named fills ONE item; both only with "los dos / both / 2 de asada" (counted above). (Carlos, fix8)
  }
  // Combo Mix: "un taco ... y una gordita ..." -> item-1-option, item-2-option in order of mention.
  const itemSteps = guide.steps.filter((s) => /^item-\d-option$/.test(String(s.key || "")));
  const itemQueue: Array<BuildStep["options"][number]> = [];
  if (itemSteps.length) {
    const generic = optionHits(itemSteps[0], text);
    for (const hit of generic as any[]) {
      // The same item named twice ("a steak taco and a chicken taco") fills both items.
      const alias = text.substr(hit.index, hit.len + 1).trim();
      const times = alias ? (text.match(new RegExp(`(^|\\s)${alias.replace(/\s+/g, "\\s+")}(?=\\s|$)`, "g")) || []).length : 1;
      for (let i = 0; i < Math.max(hit.count, times); i += 1) itemQueue.push(hit.option);
    }
  }
  for (const step of guide.steps) {
    const mode = step.mode || (step.required ? "ask" : "optional");
    let chosen: BuildStep["options"][number] | undefined;
    if (step.kind === "meat") chosen = meatQueue.shift();
    else if (/size/i.test(String((step as any).squareGroupName || step.key || "")) && /\b(chic[oa]s?|chiquit[oa]s?|small|pequen[oa]s?|regular|10 ?(inch|in|pulgadas))\b/.test(text)) {
      // Small burrito → 10 inch; otherwise the size step's default (Grande '12).
      chosen = (step.options || []).find((o: any) => /'\s*10\b/.test(String(o.name)));
    }
    else if (itemSteps.includes(step)) chosen = itemQueue.shift();
    else {
      const hits = optionHits(step, text);
      if (step.kind === "regularDeluxe") {
        // "pico" alone is the dip, not Deluxe; Deluxe needs its own word.
        chosen = /\b(deluxe|de lujo|preparad[oa]s?)\b/.test(text)
          ? hits.find((h) => h.option.value !== "none")?.option
          : hits.find((h) => h.option.value === "none")?.option;
      }
      else chosen = hits[hits.length ? hits.length - 1 : 0]?.option;
      if (step.kind === "salsa") {
        // Salsa is optional (like the website): only when the caller asks for salsa AND names one.
        const distinct = [...new Set(hits.map((h) => h.option))];
        const saysSalsa = /\b(salsa|salsas|picante)\b/.test(text);
        if (distinct.length === 1 && (saysSalsa || /\b(verde|roja|mild|medium|hot)\b/.test(text))) chosen = distinct[0];
        else {
          chosen = undefined;
          if (saysSalsa && !/\b(sin salsa|no salsa)\b/.test(text)) { missing.push(step); continue; } // "con salsa" / two salsas -> ask which
        }
      }
      if (step.kind === "extras" && !/\bextra|\bmas\b|\badd\b|\bagrega/.test(text)) chosen = undefined;
      if (step.kind === "multi") {
        // Several picks allowed (e.g. what goes inside the burrito). "con todo" = the normal fillings.
        const wantsDouble = /\b(doble|double|extra)\b/.test(text);
        const picks = hits.map((h) => h.option)
          .filter((option) => wantsDouble || !/^double\b/i.test(option.name))
          .filter((option, i, all) => all.indexOf(option) === i)
          // "doble arroz" also matches plain "arroz": keep only the DOUBLE one of a family.
          .filter((option, _i, all) => !(option.family && option.value !== "double" && all.some((o) => o !== option && o.family === option.family && o.value === "double")));
        if (picks.length) {
          for (const option of picks) {
            filled.push({ stepKey: String(step.key || ""), title: step.title, option: option.name, label: option.label || option.name, isDefault: false, sendsModifier: true });
          }
          continue;
        }
        chosen = undefined;
      }
    }
    if (chosen) {
      filled.push({ stepKey: String(step.key || ""), title: step.title, option: chosen.name, label: chosen.label || chosen.name, isDefault: false, sendsModifier: chosen.value !== "none" });
      continue;
    }
    // ui4: like cocinaelvis.com every group is asked in order — a preselect is offered as the suggested
    // answer ("suggest"), an optional group is offered and can be skipped ("offer").
    if ((mode as string) === "suggest" || (mode as string) === "offer") {
      const done = opts.skipRest || opts.resolved?.has(String(step.key || step.title));
      if (!done) { missing.push(step); continue; }
      if ((mode as string) === "suggest" && step.default) filled.push({ stepKey: String(step.key || ""), title: step.title, option: step.default, label: step.defaultLabel || step.default, isDefault: true, sendsModifier: step.defaultSendsModifier !== false });
      continue;
    }
    if (mode === "ask") { missing.push(step); continue; }
    if (mode === "default" && step.default) {
      filled.push({ stepKey: String(step.key || ""), title: step.title, option: step.default, label: step.defaultLabel || step.default, isDefault: true, sendsModifier: step.defaultSendsModifier !== false });
    }
  }
  return { complete: missing.length === 0, filled, missing };
}

export function guideQuestion(step: BuildStep, language: "en" | "es") {
  const key = String(step.key || "");
  const es = language === "es";
  const ask = (step as any)[es ? "ask_es" : "ask_en"];
  if (ask) return ask;
  if (key === "item-1-meat") return es ? "¿De qué carne el primero?" : "What meat for the first one?";
  if (key === "item-2-meat") return es ? "¿Y el segundo, de qué carne?" : "And the second one, what meat?";
  if (key === "burrito-meat") return es ? "¿De qué carne el burrito?" : "What meat for the burrito?";
  if (key.endsWith("-shell")) return es ? "¿Tortilla de maíz, harina o hecha a mano?" : "Corn street, flour, or homemade tortilla?";
  if (step.kind === "salsa") return es ? "¿Qué salsa: asada o tomate (mild), verde (medium) o roja (hot)?" : "Which salsa: asada or tomato (mild), verde (medium), or roja (hot)?";
  if (key === "burrito-options") return es ? "¿Qué lleva adentro? Puedes decir con todo: frijoles, arroz, queso, crema, cebolla y cilantro." : "What goes inside? You can say everything: beans, rice, cheese, sour cream, onion and cilantro.";
  if (key === "burrito-side") return es ? "¿Qué dip con los chips: pico de gallo, guacamole o queso?" : "Which dip with the chips: pico de gallo, guacamole or queso?";
  if (key === "item-1-option") return es ? "¿Qué es el primero: taco, quesadilla, torta o gordita?" : "What's the first item: taco, quesadilla, torta or gordita?";
  if (key === "item-2-option") return es ? "¿Y el segundo?" : "And the second item?";
  return es ? `¿${step.title}?` : `${step.title}?`;
}


/**
 * fix25 (Carlos): a 2-item combo where only one meat was named asks "¿Las dos de bistec?" / "Both steak?".
 * Yes → both items get that meat. No (or unclear) → "¿Y la otra de qué carne?" and the answer fills item 2.
 * Two meats named up front fill both and nothing is asked.
 */
const MASC_COMBO = /\b(tacos?|burritos?|mix)\b/i;
const meatWord = (option: string, language: "en" | "es") => {
  const raw = String(option || "").replace(/\s*\(\+?\$[\d.]+\)/g, "").replace(/^\s*\d+\s*x\s+/i, "").trim();
  const parts = raw.split(" / ");
  if (/^bistec/i.test(raw)) return language === "es" ? "bistec" : "steak";
  if (/alpastor|^al\s*pastor|^pastor/i.test(raw)) return language === "es" ? "pastor" : "al pastor";
  return (language === "es" ? parts[0] : (parts[1] || parts[0])).toLowerCase().trim();
};
export function bothMeatQuestion(displayName: string, option: string, language: "en" | "es") {
  if (language !== "es") return `Both ${meatWord(option, "en")}?`;
  return `¿${MASC_COMBO.test(displayName) ? "Los" : "Las"} dos de ${meatWord(option, "es")}?`;
}
export function otherMeatQuestion(displayName: string, language: "en" | "es") {
  if (language !== "es") return "And the other one, what meat?";
  return MASC_COMBO.test(displayName) ? "¿Y el otro de qué carne?" : "¿Y la otra de qué carne?";
}
export const BOTH_MEAT_Q = /^\s*(?:.*\s)?(?:¿(?:las|los)\s+dos\s+de\s+[^?]+\?|both\s+[^?]+\?)\s*$/i;
export const OTHER_MEAT_Q = /(?:¿y\s+(?:la\s+otra|el\s+otro)\s+de\s+qu[eé]\s+carne\?|and\s+the\s+other\s+one,\s+what\s+meat\?)\s*$/i;
export const YES_ANSWER = /^[¿¡\s]*(?:s[ií]|yes|yeah|yep|yup|claro|[aá]ndale|exacto|correcto|eso|sure|both|ambas?|ambos|(?:las|los)\s+dos|as[ií]\s+est[aá]\s+bien|that'?s\s+fine|ok(?:ay)?|perfecto|sale|right|correct)(?![\p{L}\p{N}])/iu;
export const NO_ANSWER = /^[¿¡\s]*(?:no|nope|nah|nel)(?![\p{L}\p{N}])/iu;

/** Kept for callers: steps now stay in the website order (meat-first was reverted in fix7). */
export function meatFirst<T extends { kind?: string; key?: string; name?: string; title?: string }>(steps: T[]): T[] {
  return [...steps];
}

/**
 * fix7: combo steps follow the storefront feed — same order as the website's groups, and a group the
 * website requires (min ≥ 1) with several choices is asked, even if the site preselects one.
 */
export const MIX_ITEM_STEP = /^item-\d-option$/;

/**
 * COMBO Mix: a bare "taco" / "quesadilla" is the usual default (Comal), "de maíz" / street → Street,
 * "harina" / flour → Flour. "un taco de asada y una gordita de chicharrón" keeps working.
 */
export function normalizeMixItems(text: string) {
  const words = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const SHELL = /^(comal|homemade|harina|flour|taquer[oa]s?|street|maiz|corn)$/;
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^(tacos?|quesadillas?)$/.test(w) && !SHELL.test(words[i - 1] || "") && !SHELL.test(words[i + 1] || "")) {
      const stop = words.slice(i + 1, i + 5).findIndex((x) => /^(y|and|e|un|una|uno|a|an|one|plus|mas)$/.test(x));
      const near = words.slice(i + 1, stop < 0 ? i + 5 : i + 1 + stop).join(" ");
      const kind = /\b(de maiz|street|taquer)/.test(near) ? (w.startsWith("q") ? "taquera" : "taquero") : /\b(harina|flour)\b/.test(near) ? "harina" : "comal";
      out.push(w, kind);
      continue;
    }
    out.push(w);
  }
  return out.join(" ");
}

export const BURRITO_SIZE = /\b(burrito|chimichanga)\b.*\bsize\b/i;
export function siteOrderSteps<T extends Record<string, any>>(steps: T[], squareItemId?: string): T[] {
  const product: any = siteProductFor(squareItemId);
  if (!product) return [...steps];
  const at = (s: T) => {
    const i = product.groups.findIndex((g: any) => g.squareId === s.squareGroupId || (s.squareGroupName && g.name === s.squareGroupName));
    return i < 0 ? 1000 : i;
  };
  return steps
    .map((s, n) => ({ s, n, i: at(s) }))
    .sort((a, b) => a.i - b.i || a.n - b.n)
    .map(({ s, i }) => {
      const g = i < 1000 ? product.groups[i] : null;
      // Least friction (Carlos, fix9): meat always asked; a required group with a site preselect is applied
      // silently (and read back); a required group without one is asked; optional groups are never asked.
      if (!g) return s;
      // Exception (Carlos, fix10): COMBO Mix always asks which two items, even though the site preselects Street Taco.
      if (MIX_ITEM_STEP.test(String(s.key || ""))) return { ...s, mode: "ask", required: true, askOnlyWhenMentioned: false } as T;
      const isMeatStep = s.kind === "meat" || (/carne|meat/i.test(g.name) && !/extra/i.test(g.name));
      const pre = (g.choices || []).filter((c: any) => c.preselected);
      if (isMeatStep && g.min >= 1) return { ...s, mode: "ask", required: true, askOnlyWhenMentioned: false } as T;
      if (g.min >= 1 && pre.length && (g.choices || []).length > 1) {
        const opt = (s.options || []).find((o: any) => String(o.name || "").startsWith(pre[0].name) || String(o.label || "") === pre[0].name);
        return { ...s, mode: "default", required: false, ...(opt ? { default: opt.name, defaultLabel: opt.label || pre[0].name, defaultSendsModifier: true } : {}) } as T;
      }
      if (g.min >= 1 && (g.choices || []).length > 1) return { ...s, mode: "ask", required: true, askOnlyWhenMentioned: false } as T;
      if (g.min === 0 && s.mode === "ask") return { ...s, mode: "optional", required: false } as T;
      return s;
    })
    .map((s: any) => {
      // ui4 (Carlos): ask ALL groups step by step, website order. Preselect = suggested answer; optional = offered.
      if (s.mode === "ask") return s;
      if (s.kind === "salsa" && !s.default) {
        const asada = (s.options || []).find((o: any) => /mild\s+salsa\s+asada/i.test(String(o.name || o)));
        if (asada) return { ...s, mode: "suggest", default: String(asada.name || asada), defaultLabel: String(asada.label || asada.name || asada), defaultSendsModifier: true };
      }
      if (s.mode === "default" && s.default) return { ...s, mode: "suggest" };
      return { ...s, mode: "offer" };
    });
}

const optLabel = (o: any, es: boolean) => {
  const raw = String(o?.label || o?.name || o || "").replace(/\s*\(\+?\$[\d.]+\)\s*/g, " ").replace(/^\(\w+\)\s*/, "").replace(/^\d+\s*x\s+/i, "").replace(/^\*+/, "").trim();
  const parts = raw.split(" / ");
  return (es ? parts[0] : (parts[1] || parts[0])).replace(/^SOLO\s+/i, es ? "solo " : "only ").replace(/\s+-\s+\w+.*$/, (m) => (es ? "" : m)).trim();
};
const price = (o: any) => { const m = String(o?.name || "").match(/\(\+\$([\d.]+)\)/); return m ? ` (+$${m[1]})` : ""; };
/** ui4: the question for a suggested / offered step, with the preselect as the suggested answer. */
export function suggestQuestion(step: any, language: "en" | "es") {
  const es = language === "es";
  const key = String(step.key || "");
  const os = step.options || [];
  const def = os.find((o: any) => o.name === step.default);
  const others = os.filter((o: any) => o !== def && o.value !== "none");
  const or = es ? " o " : " or ";
  const list = (l: any[]) => l.map((o) => optLabel(o, es) + price(o)).join(or);
  if (/shell/.test(key) && /comal/i.test(String(def?.name))) { const f = os.find((o: any) => /harina/i.test(o.name)); return es ? `¿Tortilla hecha a mano (comal) como siempre, o de harina${price(f)} o taquera de maíz?` : `Homemade (comal) tortilla as usual, or flour${price(f)} or street corn?`; }
  if (/shell/.test(key)) return es ? `¿Tortilla ${optLabel(def, true).toLowerCase()} como siempre, o ${list(others).toLowerCase()}?` : `${optLabel(def, false)} tortilla as usual, or ${list(others).toLowerCase()}?`;
  if (key === "combo-side") return es ? "¿Con arroz y frijoles, o solo arroz o solo frijoles?" : "With rice and beans, or only rice or only beans?";
  if (step.kind === "regularDeluxe") { const d = os.find((o: any) => o.value !== "none"); return es ? `¿Regular, o deluxe con lechuga, pico y crema${price(d)}?` : `Regular, or deluxe with lettuce, pico and sour cream${price(d)}?`; }
  if (/size/.test(key)) return es ? `¿Grande de 12 como siempre, o regular de 10?` : `Large 12-inch as usual, or regular 10-inch?`;
  if (step.kind === "salsa") return es ? "¿Salsa asada (mild) como siempre, o tomate, verde (medium) o roja (hot)?" : "Mild asada salsa as usual, or tomato, verde (medium) or roja (hot)?";
  if (step.kind === "extras") return es ? "¿Algún extra (crema, queso fresco, limón, salsa), o así está bien?" : "Any extras (sour cream, cheese, lime, salsa), or is that it?";
  if (step.mode === "suggest" && def) return es ? `¿${optLabel(def, true)} está bien, o ${list(others)}?` : `${optLabel(def, false)} OK, or ${list(others)}?`;
  return es ? `¿Algo de ${step.title}: ${list(os.slice(0, 4))}…, o no?` : `Any ${step.title}: ${list(os.slice(0, 4))}…, or no?`;
}
function withAsk<T extends Record<string, any>>(step: T): T {
  if (step.mode !== "suggest" && step.mode !== "offer") return step;
  return { ...step, ask_es: suggestQuestion(step, "es"), ask_en: suggestQuestion(step, "en") };
}
/** ui4: "así está bien" / "that's it" = keep the suggested answers and skip the rest. */
export const SKIP_REST = /\b(asi esta bien|asi nomas|asi como viene|lo demas (normal|asi|como siempre)|todo lo demas (normal|igual)|eso es todo|that'?s it|that is it|that'?s all|everything else (normal|as usual|regular)|rest as usual|nothing else)\b/;
export const PLAIN_ACCEPT = /^(si|ok|okay|okey|yes|yeah|yep|sure|claro|esta bien|perfecto|correcto|normal|como siempre|as usual|regular|no|no gracias|nada|ninguno|nope|no thanks|sin extras|sin nada|asi)\b/;
