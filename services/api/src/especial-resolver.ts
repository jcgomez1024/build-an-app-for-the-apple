import type { MenuItem, ModifierGroup, ModifierOption } from "./menu.js";

type ResolverInput = {
  text?: string;
  language?: string;
  toolArgs?: object;
  comboState?: object;
};

type EspecialKind = "quesadilla-dorada" | "birria" | "queso-birrias" | "pambazo";
type EspecialStepKind = "item-option" | "multi" | "meat" | "regular-deluxe" | "salsa" | "extras";

type EspecialState = {
  ruleId: string;
  itemId: string;
  itemName: string;
  kind: EspecialKind;
  selections: EspecialModifier[];
  awaitingStepKey?: string;
  offeredOptional?: boolean;
  pendingText?: string;
};

type EspecialModifier = {
  groupId?: string;
  groupName?: string;
  option?: string;
  optionId?: string;
  priceDeltaCents?: number;
  quantity?: number;
};

type EspecialStep = {
  key: string;
  kind: EspecialStepKind;
  label: string;
  required: boolean;
  min?: number;
  max?: number;
};

const ESPECIAL_EXTRAS_STEP = "especial-extras";
const QD_OPTION_GROUP_ID = "__qd-variation-options";
const BIRRIA_OPTION_GROUP_ID = "__birria-variation-options";
const QUESO_BIRRIA_OPTION_GROUP_ID = "__queso-birria-variation-options";

const VIRTUAL_QUESO_BIRRIA_BASE_CENTS = 1500;
const VIRTUAL_QUESO_BIRRIA_OPTIONS: ModifierOption[] = [
  {
    id: "reviewed-queso-birrias-qst",
    name: "(QST) 3 x Queso Birrias Taquera / Street con Consome / Broth",
    priceDeltaCents: 0
  },
  {
    id: "reviewed-queso-birrias-qhr",
    name: "(QHR) 3 x Queso Birrias Harina / Flour con Consome / Broth",
    priceDeltaCents: 300
  },
  {
    id: "reviewed-queso-birrias-qco",
    name: "(QCO) 3 x Queso Birrias Comal / Homemade con Consome / Broth",
    priceDeltaCents: 500
  }
];

const RULES: Array<{
  kind: EspecialKind;
  aliases: RegExp[];
  namePattern: RegExp;
  steps: EspecialStep[];
}> = [
  {
    kind: "quesadilla-dorada",
    aliases: [/\b(qd|quesadilla\s+dorada|dorada|fried\s+quesadilla)\b/],
    namePattern: /\bquesadilla\s+dorada\b/,
    steps: [
      { key: "qd-meat", kind: "meat", label: "Meat", required: true, min: 1, max: 2 },
      { key: "qd-option", kind: "item-option", label: "Regular or deluxe", required: true, min: 1, max: 1 },
      { key: "qd-salsa", kind: "salsa", label: "Salsa", required: true, min: 1, max: 1 },
      { key: ESPECIAL_EXTRAS_STEP, kind: "extras", label: "Extras", required: false }
    ]
  },
  {
    kind: "queso-birrias",
    aliases: [/\b(queso\s+birria|queso\s+birrias|quesabirria|quesabirrias)\b/],
    namePattern: /\bqueso\s+birrias?\b/,
    steps: [
      { key: "queso-birria-option", kind: "item-option", label: "Queso birria option", required: true, min: 1, max: 1 },
      { key: "queso-birria-salsa", kind: "salsa", label: "Salsa", required: true, min: 1, max: 1 }
    ]
  },
  {
    kind: "birria",
    aliases: [/\b(birria\s+de\s+chivo|goat\s+birria|birria|consome|consome)\b/],
    namePattern: /\bbirria\s+de\s+chivo\b|\bgoat\s+birria\b/,
    steps: [
      { key: "birria-option", kind: "item-option", label: "Birria option", required: true, min: 1, max: 1 },
      { key: ESPECIAL_EXTRAS_STEP, kind: "extras", label: "Extras", required: false }
    ]
  },
  {
    kind: "pambazo",
    aliases: [/\bpambazo\b/],
    namePattern: /\bpambazo\b/,
    steps: [
      { key: "pambazo-options", kind: "multi", label: "Pambazo options", required: true, min: 1, max: 16 },
      { key: "pambazo-meat", kind: "meat", label: "Meat", required: true, min: 1, max: 2 },
      { key: "pambazo-salsa", kind: "salsa", label: "Salsa", required: true, min: 1, max: 1 },
      { key: ESPECIAL_EXTRAS_STEP, kind: "extras", label: "Extras", required: false }
    ]
  }
];

export function resolveEspecialRequest(menu: MenuItem[], input: ResolverInput) {
  const text = getInputText(input);
  const language = getLanguage(input);
  const existing = normalizeEspecialState(input.comboState);
  const requested = findEspecialItem(menu, text);
  const activeState = existing && (!requested || requested.rule.kind === existing.kind) ? existing : null;

  if (!activeState && !requested) return null;

  const rule = requested?.rule || RULES.find((candidate) => candidate.kind === activeState?.kind);
  if (!rule) return null;
  const item = requested?.item || findEspecialStateItem(menu, activeState, rule);
  if (!item) return null;

  let state: EspecialState = activeState || {
    ruleId: `especial-${rule.kind}`,
    itemId: item.id,
    itemName: item.name,
    kind: rule.kind,
    selections: []
  };

  const navigation = activeState ? navigationIntent(text) : null;
  if (navigation === "back") {
    return rewindEspecialStep(item, rule.steps, state, language);
  }

  state.selections = normalizeModifiers(state.selections);
  const focused = state.awaitingStepKey && state.awaitingStepKey !== ESPECIAL_EXTRAS_STEP
    ? rule.steps.find((step) => step.key === state.awaitingStepKey)
    : null;
  const effectiveText = mergeText(state.pendingText || "", text);
  if (navigation !== "next") {
    const steps = focused ? [focused] : rule.steps.filter((step) => step.required);
    applyTextToSteps(item, steps, state, effectiveText);
  }

  if (state.awaitingStepKey === ESPECIAL_EXTRAS_STEP) {
    if (textSkipsOptional(text) || navigation === "next") {
      return finishEspecial(item, state, language);
    }
    const beforeExtras = state.selections.length;
    applyTextToSteps(item, [extrasStep()], state, text);
    if (state.selections.length > beforeExtras) {
      return finishEspecial(item, state, language);
    }
    return buildStepResult(item, state, extrasStep(), language, true);
  }

  const missing = firstMissingStep(item, rule.steps, state);
  if (missing) {
    state.awaitingStepKey = missing.key;
    state.pendingText = effectiveText;
    return buildStepResult(item, state, missing, language, false);
  }

  const extraGroup = findStepGroup(item, extrasStep());
  if (extraGroup && !state.offeredOptional && !textSkipsOptional(text)) {
    state.awaitingStepKey = ESPECIAL_EXTRAS_STEP;
    state.offeredOptional = true;
    return buildStepResult(item, state, extrasStep(), language, true);
  }

  return finishEspecial(item, state, language);
}

function getInputText(input: ResolverInput) {
  const args = (input.toolArgs || {}) as Record<string, unknown>;
  return String(args.itemQuery || input.text || args.itemId || "").trim();
}

function getLanguage(input: ResolverInput): "en" | "es" {
  return input.language === "es" ? "es" : "en";
}

function findEspecialItem(menu: MenuItem[], text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  for (const rule of RULES) {
    if (!rule.aliases.some((alias) => alias.test(normalized))) continue;
    const matches = menu.filter((candidate) => rule.namePattern.test(normalizeText(candidate.name)));
    const item = buildEspecialVariationItem(rule.kind, matches);
    if (item) return { item, rule };
  }
  return null;
}

function findEspecialStateItem(menu: MenuItem[], state: EspecialState | null, rule: (typeof RULES)[number]) {
  if (!state) return null;
  return buildEspecialVariationItem(rule.kind, menu.filter((candidate) => rule.namePattern.test(normalizeText(candidate.name))))
    || menu.find((candidate) => candidate.id === state.itemId)
    || null;
}

function buildEspecialVariationItem(kind: EspecialKind, matches: MenuItem[]) {
  if (kind === "quesadilla-dorada") return buildVariationChoiceItem(matches, {
    baseName: "(QD) Quesadilla Dorada",
    groupId: QD_OPTION_GROUP_ID,
    groupName: "(QD) Quesadilla Dorada options",
    primaryPattern: /\bregular\b/,
    trim: trimQuesadillaDoradaVariantName
  });
  if (kind === "birria") return buildVariationChoiceItem(matches, {
    baseName: "Birria de Chivo / Goat Birria",
    groupId: BIRRIA_OPTION_GROUP_ID,
    groupName: "Birria de Chivo / Goat Birria options",
    primaryPattern: /consome.*tortillas\s+de\s+comal|broth.*tortillas\s+de\s+comal/,
    trim: trimBirriaVariantName
  });
  if (kind === "queso-birrias") return buildVariationChoiceItem(matches, {
    baseName: "Queso Birrias",
    groupId: QUESO_BIRRIA_OPTION_GROUP_ID,
    groupName: "Queso Birria options",
    primaryPattern: /\bqst\b|\btaquera\b|\bstreet\b/,
    trim: trimQuesoBirriaVariantName
  }) || buildVirtualQuesoBirriasItem();
  return matches[0] || null;
}

function buildVirtualQuesoBirriasItem(): MenuItem {
  return {
    id: "reviewed-queso-birrias",
    name: "Queso Birrias",
    nameEs: "Queso Birrias",
    aliases: ["Queso Birrias", "queso birrias", "queso birria", "quesabirria", "quesabirrias"],
    priceCents: VIRTUAL_QUESO_BIRRIA_BASE_CENTS,
    description: "Three queso birrias with consome. Choose street, flour, or comal.",
    modifierGroups: [
      {
        id: QUESO_BIRRIA_OPTION_GROUP_ID,
        name: "Queso Birria options",
        minSelections: 0,
        maxSelections: 1,
        options: VIRTUAL_QUESO_BIRRIA_OPTIONS
      },
      {
        id: "reviewed-queso-birrias-salsa",
        name: "Salsa Preferencia / Preference",
        minSelections: 0,
        maxSelections: 1,
        options: [
          { id: "reviewed-queso-birrias-salsa-mild-asada", name: "Mild Salsa Asada", priceDeltaCents: 0 },
          { id: "reviewed-queso-birrias-salsa-medium-verde", name: "Medium Salsa Verde", priceDeltaCents: 0 },
          { id: "reviewed-queso-birrias-salsa-hot-roja", name: "Hot Salsa Roja", priceDeltaCents: 0 }
        ]
      }
    ]
  };
}

function buildVariationChoiceItem(matches: MenuItem[], config: {
  baseName: string;
  groupId: string;
  groupName: string;
  primaryPattern: RegExp;
  trim: (name: string) => string;
}) {
  if (!matches.length) return null;
  const primary = matches.find((item) => config.primaryPattern.test(normalizeText(item.name))) || matches[0];
  const hasOptionGroup = (primary.modifierGroups || []).some((group) => group.id === config.groupId || normalizeText(group.name) === normalizeText(config.groupName));
  if (hasOptionGroup) {
    return {
      ...primary,
      name: config.baseName,
      nameEs: config.baseName
    };
  }

  const seen = new Set<string>();
  const options = matches
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .map((item) => ({
      id: item.id,
      name: config.trim(item.name),
      priceDeltaCents: item.priceCents - primary.priceCents
    }));

  return {
    ...primary,
    name: config.baseName,
    nameEs: config.baseName,
    aliases: Array.from(new Set([...(primary.aliases || []), config.baseName, normalizeText(config.baseName)])),
    modifierGroups: [
      {
        id: config.groupId,
        name: config.groupName,
        minSelections: 0,
        maxSelections: 1,
        options
      },
      ...(primary.modifierGroups || [])
    ]
  };
}

function trimQuesadillaDoradaVariantName(name: string) {
  const trimmed = String(name || "")
    .replace(/^\s*\(QD\)\s*Quesadilla\s+Dorada\s*/i, "")
    .trim();
  if (trimmed) return trimmed;
  const key = normalizeText(name);
  if (/\bdeluxe\b|\bpreparad[ao]\b/.test(key)) return "(QD) DELUXE Preparada";
  return "(QD) REGULAR Dorada";
}

function trimBirriaVariantName(name: string) {
  return String(name || "")
    .replace(/^\s*Birria\s+de\s+Chivo\s*\/\s*Goat\s+Birria\s*/i, "")
    .trim() || name;
}

function trimQuesoBirriaVariantName(name: string) {
  return String(name || "")
    .replace(/^\s*Queso\s+Birrias?\s*/i, "")
    .trim() || name;
}

function normalizeEspecialState(value: unknown): EspecialState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const ruleId = String(raw.ruleId || "");
  if (!ruleId.startsWith("especial-")) return null;
  const kind = String(raw.kind || ruleId.replace(/^especial-/, "")) as EspecialKind;
  if (!RULES.some((rule) => rule.kind === kind)) return null;
  return {
    ruleId,
    itemId: String(raw.itemId || ""),
    itemName: String(raw.itemName || ""),
    kind,
    selections: normalizeModifiers(Array.isArray(raw.selections) ? raw.selections : []),
    awaitingStepKey: typeof raw.awaitingStepKey === "string" ? raw.awaitingStepKey : undefined,
    offeredOptional: Boolean(raw.offeredOptional),
    pendingText: typeof raw.pendingText === "string" ? raw.pendingText : undefined
  };
}

function normalizeModifiers(values: unknown[]) {
  return values
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      groupId: String(entry.groupId || ""),
      groupName: String(entry.groupName || ""),
      option: String(entry.option || ""),
      optionId: String(entry.optionId || ""),
      priceDeltaCents: Number.isFinite(Number(entry.priceDeltaCents)) ? Number(entry.priceDeltaCents) : undefined,
      quantity: Math.max(1, Number(entry.quantity) || 1)
    }))
    .filter((entry) => entry.groupId && entry.option);
}

function applyTextToSteps(item: MenuItem, steps: EspecialStep[], state: EspecialState, text: string) {
  for (const step of steps) {
    const group = findStepGroup(item, step);
    if (!group) continue;
    const current = selectionsForGroup(state, group.id);
    const max = stepMax(step, group);
    if (current.length >= max && step.kind !== "extras") continue;
    const matches = findOptionMentions(group.options || [], text, step.kind);
    for (const option of matches) {
      if (selectionsForGroup(state, group.id).length >= max) break;
      const optionLabel = optionName(option);
      if (state.selections.some((selection) => selection.groupId === group.id && normalizeText(selection.option || "") === normalizeText(optionLabel))) continue;
      if (step.kind === "regular-deluxe" || step.kind === "salsa" || step.kind === "item-option") {
        state.selections = state.selections.filter((selection) => selection.groupId !== group.id);
      }
      state.selections.push(selectionFromOption(group, option));
    }
  }
}

function firstMissingStep(item: MenuItem, steps: EspecialStep[], state: EspecialState) {
  return steps.find((step) => {
    if (!step.required) return false;
    const group = findStepGroup(item, step);
    if (!group) return false;
    return selectionsForGroup(state, group.id).length < stepMin(step);
  }) || null;
}

function findStepGroup(item: MenuItem, step: EspecialStep) {
  const groups = item.modifierGroups || [];
  if (step.kind === "salsa") {
    return groups.find((group) => /\bsalsa\b/.test(normalizeText(group.name)))
      || groups.find((group) => group.options?.some((option) => /\bsalsa\b/.test(normalizeText(optionName(option)))))
      || null;
  }
  if (step.kind === "meat") {
    return groups.find((group) => /\b(carne|carnes|meat|meats)\b/.test(normalizeText(group.name)) || countMeatOptions(group) >= 8) || null;
  }
  if (step.kind === "regular-deluxe") {
    return groups.find((group) => group.options?.some((option) => /regular|deluxe|lettuce|pico|cilantro|lime|crema|sour/.test(normalizeText(optionName(option))))) || null;
  }
  if (step.kind === "extras") {
    return groups.find((group) => /\b(extra|extras|agua)\b/.test(normalizeText(group.name))) || null;
  }
  if (step.kind === "multi") {
    return groups.find((group) => {
      const name = normalizeText(group.name);
      if (/\b(carne|carnes|meat|meats)\b/.test(name)) return false;
      return group.options?.some((option) => /\b(frijoles|beans|arroz|rice|queso fresco|crema|sour cream|cebolla|onion|cilantro|lettuce|pico)\b/.test(normalizeText(optionName(option))));
    }) || null;
  }
  if (step.kind === "item-option") {
    if (step.key === "qd-option") {
      return groups.find((group) => group.id === QD_OPTION_GROUP_ID || /\bquesadilla\b.*\bdorada\b.*\boptions?\b|\bqd\b.*\boptions?\b/.test(normalizeText(group.name))) || null;
    }
    if (step.key === "birria-option") {
      return groups.find((group) => group.id === BIRRIA_OPTION_GROUP_ID || /\bbirria\b.*\boptions?\b/.test(normalizeText(group.name))) || null;
    }
    if (step.key === "queso-birria-option") {
      return groups.find((group) => group.id === QUESO_BIRRIA_OPTION_GROUP_ID || /\bqueso\b.*\bbirria\b.*\boptions?\b/.test(normalizeText(group.name))) || null;
    }
    return groups.find((group) => {
      const name = normalizeText(group.name);
      if (/\b(options?|option)\b/.test(name) && !/\b(extra|salsa|carne|meat)\b/.test(name)) return true;
      return false;
    }) || groups.find((group) => {
      const name = normalizeText(group.name);
      if (/\b(extra|extras|salsa|agua|carne|meat)\b/.test(name)) return false;
      return group.options?.some((option) => /consome|broth|tortilla|taquera|street|harina|flour|comal|homemade|regular|dorada/.test(normalizeText(optionName(option))));
    }) || null;
  }
  return null;
}

function countMeatOptions(group: ModifierGroup) {
  return (group.options || []).filter((option) => /bistec|steak|chorizo|pollo|chicken|buche|tripa|carnitas|lengua|birria/.test(normalizeText(optionName(option)))).length;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}

function fuzzyAliasIndex(alias: string, query: string): number {
  if (alias.includes(" ") || alias.length < 4) return -1;
  const tolerance = alias.length >= 7 ? 2 : 1;
  let charIndex = 0;
  for (const token of query.split(/\s+/)) {
    if (token.length >= alias.length - tolerance && token.length <= alias.length + tolerance) {
      if (levenshtein(token, alias) <= tolerance) return charIndex;
    }
    charIndex += token.length + 1;
  }
  return -1;
}

function findOptionMentions(options: Array<string | ModifierOption>, text: string, kind: EspecialStepKind) {
  const query = normalizeText(text);
  if (!query) return [];
  return options
    .map((option) => {
      const name = optionName(option);
      if (!optionAllowedForKind(name, query, kind)) return null;
      let best = -1;
      let score = 0;
      const aliases = optionAliases(name, kind);
      for (const alias of aliases) {
        const match = query.match(new RegExp(`\\b${escapeRegex(alias).replace(/\s+/g, "\\s+")}\\b`, "i"));
        if (match?.index !== undefined && (best < 0 || alias.length > score)) {
          best = match.index;
          score = alias.length;
        }
      }
      if (best < 0 && kind === "meat") {
        for (const alias of aliases) {
          const idx = fuzzyAliasIndex(alias, query);
          if (idx >= 0 && (best < 0 || alias.length > score)) {
            best = idx;
            score = alias.length;
          }
        }
      }
      return best >= 0 ? { option, index: best, score } : null;
    })
    .filter((entry): entry is { option: string | ModifierOption; index: number; score: number } => Boolean(entry))
    .sort((a, b) => a.index - b.index || b.score - a.score)
    .map((entry) => entry.option);
}

function optionAllowedForKind(name: string, query: string, kind: EspecialStepKind) {
  const key = normalizeText(name);
  if (kind === "item-option") {
    const asksQuesoBirria = /\b(queso\s+birrias?|quesabirrias?)\b/.test(query);
    const hasQuesoBirriaOption = /\bqueso\s+birrias?\b/.test(key);
    if (asksQuesoBirria && hasQuesoBirriaOption) {
      const specificQuesoBirriaChoice = /\b(harina|flour|comal|homemade|street|taquera|taquero)\b/.test(query);
      if (!specificQuesoBirriaChoice) return false;
      if (/\b(harina|flour)\b/.test(query)) return /\b(harina|flour)\b/.test(key);
      if (/\b(comal|homemade)\b/.test(query)) return /\b(comal|homemade)\b/.test(key);
      if (/\b(street|taquera|taquero)\b/.test(query)) return /\b(street|taquera|taquero)\b/.test(key);
    }

    const asksBirria = /\b(birria|birria\s+de\s+chivo|goat\s+birria)\b/.test(query) && !asksQuesoBirria;
    const hasBirriaOption = /\bbirria\b/.test(key);
    if (asksBirria && hasBirriaOption) {
      const specificBirriaChoice = /\b(consome|broth|tortillas?|comal|solo|only|16\s*oz|16oz|1\s*lb|libra|por\s+libra)\b/.test(query);
      if (!specificBirriaChoice) return false;
    }
  }
  if (kind === "meat") {
    const hasProtein = /\b(bistec|steak|chorizo|pollo|chicken|buche|tripa|tripas|carnitas|lengua|prensado|duro|alpastor|pastor|cabeza|costilla|birria|picadillo|deshebrada|vegetales|vegetarian|huevo)\b/.test(query);
    const looksLikeToppingList = /\b(pambazo|beans|frijoles|lettuce|lechuga|pico|crema|sour|cream|queso fresco|cheese|queso dip|dip|cebolla|onion|cilantro)\b/.test(query);
    if (/\b(frijoles|beans|arroz|rice|queso|cheese)\b/.test(key) && (hasProtein || looksLikeToppingList)) {
      return false;
    }
  }
  if (kind === "multi") {
    if (/\bdouble\b/.test(key) && !/\b(double|doble)\b/.test(query)) return false;
    if (/\b(side|5oz)\b/.test(key) && !/\b(side|lado|aparte|5\s*oz|5oz)\b/.test(query)) return false;
    if (/\b(side|lado|aparte|5\s*oz|5oz)\b/.test(query) && /\bdip\b/.test(key) && !/\b(side|5oz)\b/.test(key)) return false;
    if (
      /\b(queso\s+dip|cheese\s+dip)\b/.test(query) &&
      !/\b(queso\s+fresco|fresco\s+cheese|fresh\s+cheese)\b/.test(query) &&
      /\b(queso\s+fresco|fresco\s+cheese)\b/.test(key)
    ) return false;
    if (/\bqueso\b/.test(query) && /\b(dip)\b/.test(key) && !/\bdip\b/.test(query)) return false;
    if (/\bguacamole\b/.test(key) && !/\bguacamole\b/.test(query)) return false;
  }
  if (kind === "salsa") {
    if (/\bmild\b|\basada\b/.test(key) && /\btomato\b/.test(key) && !/\btomato\b|\btomate\b/.test(query)) return false;
    if (/\bmild\b|\btomato\b/.test(key) && /\basada\b/.test(key) && !/\basada\b/.test(query)) return false;
  }
  return true;
}

function optionAliases(value: string, kind: EspecialStepKind) {
  const cleaned = cleanOptionLabel(value.replace(/\([^)]*\)/g, " "));
  const aliases = new Set<string>();
  const add = (...entries: string[]) => {
    for (const entry of entries) {
      const normalized = normalizeText(entry);
      if (normalized.length > 2 && !["extra", "side", "with", "and", "con", "solo", "only", "qd", "dorada"].includes(normalized)) aliases.add(normalized);
    }
  };
  const key = normalizeText(cleaned);
  if (kind === "meat") {
    if (/bistec|steak/.test(key)) {
      add("bistec", "steak");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/cabeza|beef\s+head/.test(key)) {
      add("cabeza", "beef head");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/carnitas|pulled\s+pork/.test(key)) {
      add("carnitas", "pulled pork");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/chorizo|mexican\s+sausage/.test(key)) {
      add("chorizo", "mexican sausage");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/costilla|beef\s+rib/.test(key)) {
      add("costilla", "beef rib");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/pollo|chicken/.test(key)) {
      add("pollo", "chicken");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/alpastor|al\s+pastor|roasted\s+pork/.test(key)) {
      add("alpastor", "al pastor", "pastor", "roasted pork");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/buche|pork\s+stomach/.test(key)) {
      add("buche", "pork stomach");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/lengua|beef\s+tongue/.test(key)) {
      add("lengua", "beef tongue");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/tripa|tripe/.test(key)) {
      add("tripa", "tripas", "beef tripe");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/papas\s+con\s+rajas|poblano\s+with\s+potatoes/.test(key)) {
      add("papas con rajas", "poblano with potatoes", "rajas", "papas con chile");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/nopales\s+con\s+papas|cacti\s+with\s+potatoes/.test(key)) {
      add("nopales con papas", "cacti with potatoes", "nopales", "cactus with potatoes");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/deshebrada|shredded\s+beef/.test(key)) {
      add("deshebrada", "shredded beef", "deshebrada con papas", "shredded beef with potatoes");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/picadillo|ground\s+beef/.test(key)) {
      add("picadillo", "ground beef", "carne molida", "molida", "ground beef with potatoes");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/huevo\s+con\s+chile|spicy\s+egg/.test(key)) {
      add("huevo con chile", "huevo", "egg", "spicy egg");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/prensado|spicy\s+pork/.test(key)) {
      add("prensado", "spicy pork", "pork prensado");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/duro|pork\s+rinds/.test(key)) {
      add("duro", "pork rinds", "chicharron", "chicharrón");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/vegetales|vegetarian/.test(key)) {
      add("vegetales", "vegetarian", "vegetables");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/frijoles|beans/.test(key)) {
      add("frijoles", "frijoles refritos", "refried beans");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/arroz|rice/.test(key)) {
      add("arroz", "rice");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/queso\s+derretido|melted\s+cheese/.test(key)) {
      add("queso derretido", "melted cheese", "solo queso");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
    if (/birria\s+de\s+chivo|goat\s+birria/.test(key)) {
      add("birria", "birria de chivo", "goat birria", "chivo");
      return Array.from(aliases).sort((a, b) => b.length - a.length);
    }
  }
  add(cleaned);
  for (const part of cleaned.split(/\s*\/\s*|\s+-\s+|\s+or\s+|\s+y\s+|\s+and\s+/i)) add(part);
  for (const token of normalizeText(cleaned).split(" ")) add(token);
  if (/bistec|steak/.test(key)) add("bistec");
  if (/chorizo/.test(key)) add("chorizo");
  if (/buche/.test(key)) add("buche");
  if (/tripa/.test(key)) add("tripas");
  if (/frijoles|beans/.test(key)) add("frijoles", "beans");
  if (/arroz|rice/.test(key)) add("arroz", "rice");
  if (/queso fresco|cheese/.test(key) && kind === "multi") add("queso", "cheese");
  if (/crema|sour cream/.test(key)) add("crema", "sour cream");
  if (/cebolla|onion/.test(key)) add("cebolla", "onion");
  if (/cilantro/.test(key)) add("cilantro");
  if (/deluxe|lettuce|pico/.test(key)) add("deluxe", "de lujo", "preparada", "preparado");
  if (/regular|onion.*cilantro|lime/.test(key)) add("regular", "sencillo");
  if (/consome|broth/.test(key)) add("consome", "broth");
  if (/solo|only/.test(key)) add("solo", "only");
  if (/1\s+lb/.test(key)) add("1 lb", "libra", "por libra");
  if (/tortillas?\s+de\s+comal|homemade/.test(key)) add("tortillas", "con tortillas", "comal");
  if (/taquera|street/.test(key)) add("street", "taquera", "taquero");
  if (/harina|flour/.test(key)) add("harina", "flour");
  if (/comal|homemade/.test(key)) add("comal", "homemade");
  if (/mild salsa asada/.test(key)) add("mild", "asada", "salsa asada");
  if (/mild salsa tomato/.test(key)) add("tomato", "tomate", "salsa tomate");
  if (/medium salsa verde/.test(key)) add("medium", "verde", "salsa verde");
  if (/hot salsa roja/.test(key)) add("hot", "roja", "salsa roja");
  return Array.from(aliases).sort((a, b) => b.length - a.length);
}

function selectionsForGroup(state: EspecialState, groupId: string) {
  return state.selections.filter((selection) => selection.groupId === groupId);
}

function stepMin(step: EspecialStep) {
  return Math.max(0, Number(step.min) || (step.required ? 1 : 0));
}

function stepMax(step: EspecialStep, group: ModifierGroup) {
  const square = Number(group.maxSelections);
  const squareMax = Number.isFinite(square) && square > 0 ? square : (group.options || []).length || 1;
  if (step.kind === "multi" || step.kind === "extras") {
    return Math.max(stepMin(step), Number(step.max) || squareMax || 1);
  }
  return Math.max(stepMin(step), Math.min(Number(step.max) || squareMax, squareMax));
}

function buildStepResult(item: MenuItem, state: EspecialState, step: EspecialStep, language: "en" | "es", optional: boolean) {
  const group = findStepGroup(item, step);
  const options = group ? stepOptions(group, step, optional) : [];
  const question = questionForStep(step, language);
  const orderedSteps = RULES.find((rule) => rule.kind === state.kind)?.steps || [];
  const required = orderedSteps.filter((candidate) => candidate.required);
  const stepIndex = optional ? required.length + 1 : Math.max(1, required.findIndex((candidate) => candidate.key === step.key) + 1);
  return {
    ok: false,
    reason: "combo_step_required",
    message: question,
    selectedItem: describeItem(item),
    comboState: { ...state, awaitingStepKey: step.key, offeredOptional: optional || state.offeredOptional },
    comboStep: {
      itemName: item.name,
      step: stepIndex,
      totalSteps: required.length + (findStepGroup(item, extrasStep()) ? 1 : 0),
      stepKey: step.key,
      stepName: step.label,
      question,
      options,
      selections: selectionLabels(state),
      ...(optional ? { optional: true } : {})
    }
  };
}

function questionForStep(step: EspecialStep, language: "en" | "es") {
  const es = language === "es";
  if (step.kind === "meat") return es ? "¿Qué carne quieres?" : "Which meat would you like?";
  if (step.kind === "regular-deluxe") return es ? "¿Regular o deluxe?" : "Regular or deluxe?";
  if (step.kind === "salsa") return es ? "¿Qué salsa prefieres?" : "Which salsa would you like?";
  if (step.kind === "extras") return es ? "¿Extras? Di listo si no." : "Any extras? Say done for none.";
  if (step.key === "qd-option") return es ? "¿Regular o deluxe?" : "Regular or deluxe?";
  if (step.key === "queso-birria-option") return es ? "Elige la opción de queso birria." : "Choose the queso birria option.";
  if (step.key.includes("birria")) return es ? "Elige la opción de birria." : "Choose the birria option.";
  if (step.key.includes("pambazo")) return es ? "Elige las opciones del pambazo." : "Choose the pambazo options.";
  return es ? "Elige una opción." : "Choose one option.";
}

function stepOptions(group: ModifierGroup, step: EspecialStep, optional: boolean) {
  const options = (group.options || []).map(optionName);
  if (optional) return ["No extras", ...options];
  if (step.kind === "salsa") return ["No salsa", ...options];
  return options;
}

function rewindEspecialStep(item: MenuItem, steps: EspecialStep[], state: EspecialState, language: "en" | "es") {
  const currentIndex = state.awaitingStepKey === ESPECIAL_EXTRAS_STEP
    ? steps.filter((step) => step.required).length
    : steps.findIndex((step) => step.key === state.awaitingStepKey);
  const target = steps[Math.max(0, currentIndex - 1)] || steps[0] || null;
  if (!target) return finishEspecial(item, state, language);
  const group = findStepGroup(item, target);
  state.selections = group ? state.selections.filter((selection) => selection.groupId !== group.id) : state.selections;
  state.awaitingStepKey = target.key;
  state.pendingText = undefined;
  state.offeredOptional = false;
  return buildStepResult(item, state, target, language, false);
}

function finishEspecial(item: MenuItem, state: EspecialState, language: "en" | "es") {
  const resolved = resolveEspecialActionItem(item, state);
  const action = {
    type: "add_item",
    itemId: resolved.itemId,
    quantity: 1,
    modifiers: resolved.modifiers,
    selectedItem: resolved.selectedItem
  };
  return {
    ok: true,
    actions: [action],
    selectedItem: resolved.selectedItem,
    orderSummary: language === "es" ? `1 x ${resolved.selectedItem.name}` : `1 x ${resolved.selectedItem.name}`
  };
}

function resolveEspecialActionItem(item: MenuItem, state: EspecialState) {
  let itemId = item.id;
  let selectedItem = describeItem(item);
  let modifiers = state.selections;
  if (state.kind === "quesadilla-dorada") {
    const optionStep = RULES.find((rule) => rule.kind === state.kind)?.steps.find((step) => step.key === "qd-option");
    const optionGroup = optionStep ? findStepGroup(item, optionStep) : null;
    const selectedOption = optionGroup ? selectionsForGroup(state, optionGroup.id)[0] : null;
    if (optionGroup && selectedOption?.optionId) {
      itemId = selectedOption.optionId;
      const priceDeltaCents = Number(selectedOption.priceDeltaCents) || 0;
      selectedItem = {
        ...selectedItem,
        itemId,
        name: `${item.name} ${selectedOption.option || ""}`.trim(),
        nameEs: `${item.nameEs || item.name} ${selectedOption.option || ""}`.trim(),
        priceCents: Math.max(0, (item.priceCents || 0) + priceDeltaCents)
      };
      modifiers = state.selections.filter((selection) => selection.groupId !== optionGroup.id);
    }
  }
  if (state.kind === "birria" || state.kind === "queso-birrias") {
    const optionStepKey = state.kind === "birria" ? "birria-option" : "queso-birria-option";
    const optionStep = RULES.find((rule) => rule.kind === state.kind)?.steps.find((step) => step.key === optionStepKey);
    const optionGroup = optionStep ? findStepGroup(item, optionStep) : null;
    const selectedOption = optionGroup ? selectionsForGroup(state, optionGroup.id)[0] : null;
    if (optionGroup && selectedOption?.optionId) {
      const isReviewedQuesoBirriaOption = state.kind === "queso-birrias"
        && String(selectedOption.optionId).startsWith("reviewed-queso-birrias-");
      itemId = isReviewedQuesoBirriaOption ? item.id : selectedOption.optionId;
      const priceDeltaCents = Number(selectedOption.priceDeltaCents) || 0;
      selectedItem = {
        ...selectedItem,
        itemId,
        name: `${item.name} ${selectedOption.option || ""}`.trim(),
        nameEs: `${item.nameEs || item.name} ${selectedOption.option || ""}`.trim(),
        priceCents: Math.max(0, (item.priceCents || 0) + priceDeltaCents)
      };
      modifiers = isReviewedQuesoBirriaOption
        ? state.selections
        : state.selections.filter((selection) => selection.groupId !== optionGroup.id);
    }
  }
  return { itemId, selectedItem, modifiers };
}

function extrasStep(): EspecialStep {
  return { key: ESPECIAL_EXTRAS_STEP, kind: "extras", label: "Extras", required: false };
}

function selectionFromOption(group: ModifierGroup, option: string | ModifierOption): EspecialModifier {
  const optionObject = typeof option === "object" ? option : { name: String(option) };
  return {
    groupId: group.id,
    groupName: group.name,
    option: optionObject.name,
    optionId: optionObject.id,
    priceDeltaCents: optionObject.priceDeltaCents,
    quantity: 1
  };
}

function selectionLabels(state: EspecialState) {
  return state.selections.map((selection) => cleanOptionLabel(selection.option || ""));
}

function describeItem(item: MenuItem) {
  return {
    itemId: item.id,
    name: item.name,
    nameEs: item.nameEs || item.name,
    priceCents: item.priceCents,
    description: item.description,
    imageUrl: item.imageUrl,
    modifierGroups: item.modifierGroups
  };
}

function navigationIntent(text: string) {
  const normalized = normalizeText(text);
  if (/^(back|previous|go back|previous step|atras|anterior|regresar|volver)$/.test(normalized)) return "back";
  if (/^(next|continue|done|listo|siguiente|adelante|seguir|continuar)$/.test(normalized)) return "next";
  return null;
}

function textSkipsOptional(text: string) {
  return /\b(no|none|skip|listo|done|finish|finished|sin|ninguno|ninguna|no gracias|asi esta|ya)\b/.test(normalizeText(text));
}

function mergeText(...values: string[]) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join(" ");
}

function cleanOptionLabel(value: string) {
  return value.replace(/^\s*\*+\s*/g, "").replace(/^\s*\d+\s*x\s+/i, "").replace(/\s+/g, " ").trim();
}

function optionName(option: string | ModifierOption) {
  return typeof option === "object" ? option.name : String(option);
}

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
