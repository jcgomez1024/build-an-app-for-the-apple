import type { MenuItem, ModifierGroup, ModifierOption } from "./menu.js";

type ResolverInput = {
  text?: string;
  language?: string;
  toolArgs?: object;
  comboState?: object;
};

type PackState = {
  ruleId: string;
  itemId: string;
  itemName: string;
  selections: PackModifier[];
  virtualSelections: string[];
  awaitingStepKey?: string;
  offeredOptional?: boolean;
  pendingText?: string;
};

type PackModifier = {
  groupId?: string;
  groupName?: string;
  option?: string;
  optionId?: string;
  priceDeltaCents?: number;
  quantity?: number;
};

const PACK_OPTION_STEP = "pack-meal-option";
const QUANTITY_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8
};

export function resolvePackMealRequest(menu: MenuItem[], input: ResolverInput) {
  const text = getInputText(input);
  const existing = normalizePackState(input.comboState);
  const pendingText = existing?.pendingText || "";
  const count = existing ? packCountFromRule(existing.ruleId) : inferPackCount(text);
  const isPackRequest = Boolean(existing || /\bpack\s+meals?\b|\bmeals?\s+pack\b|\bpaquete\b/i.test(normalizeText(text)));
  if (!isPackRequest || !count) {
    return null;
  }

  const packItems = findPackItems(menu, count);
  if (!packItems.length) {
    return null;
  }

  let state: PackState = existing || {
    ruleId: `pack-meal-${count}`,
    itemId: packItems[0].id,
    itemName: `${count} Pack MEAL`,
    selections: [],
    virtualSelections: []
  };

  let selectedItem = packItems.find((item) => item.id === state.itemId) || null;
  const variant = findPackVariant(packItems, text);
  if (variant) {
    selectedItem = variant;
    state = {
      ...state,
      itemId: variant.id,
      itemName: variant.name,
      virtualSelections: [cleanPackVariantName(variant.name, count)],
      awaitingStepKey: undefined,
      pendingText: undefined
    };
  }

  if (!selectedItem || state.awaitingStepKey === PACK_OPTION_STEP || (!variant && !hasResolvedPackVariant(selectedItem, text, Boolean(existing)))) {
    state.awaitingStepKey = PACK_OPTION_STEP;
    state.pendingText = mergePendingText(pendingText, text);
    return buildPackOptionStep(packItems, count, state, getLanguage(input));
  }

  state.selections = normalizePackModifiers(state.selections);
  const meatText = variant
    ? mergePendingText(pendingText, stripPackVariantSelectionText(text, variant, count))
    : mergePendingText(pendingText, text);
  applyPackMeatText(selectedItem, state, meatText);

  const missing = firstMissingMeatGroup(selectedItem, state);
  if (missing) {
    state.awaitingStepKey = `item-${missing.index + 1}-meat`;
    return buildPackMeatStep(selectedItem, count, state, missing.group, missing.index, getLanguage(input));
  }

  return finishPackMeal(selectedItem, count, state, getLanguage(input));
}

function getInputText(input: ResolverInput) {
  const args = (input.toolArgs || {}) as Record<string, unknown>;
  return String(args.itemQuery || input.text || args.itemId || "").trim();
}

function getLanguage(input: ResolverInput): "en" | "es" {
  return input.language === "es" ? "es" : "en";
}

function normalizePackState(value: unknown): PackState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const ruleId = String(raw.ruleId || "");
  if (!/^pack-meal-[3-8]$/.test(ruleId)) return null;
  const itemId = String(raw.itemId || "");
  if (!itemId) return null;
  return {
    ruleId,
    itemId,
    itemName: String(raw.itemName || ""),
    selections: normalizePackModifiers(Array.isArray(raw.selections) ? raw.selections : []),
    virtualSelections: Array.isArray(raw.virtualSelections) ? raw.virtualSelections.map(String) : [],
    awaitingStepKey: typeof raw.awaitingStepKey === "string" ? raw.awaitingStepKey : undefined,
    offeredOptional: Boolean(raw.offeredOptional),
    pendingText: typeof raw.pendingText === "string" ? raw.pendingText : undefined
  };
}

function mergePendingText(...values: string[]) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join(" ");
}

function stripPackVariantSelectionText(text: string, variant: MenuItem, count: number) {
  const optionTokens = new Set(
    normalizeText(cleanPackVariantName(variant.name, count))
      .split(" ")
      .filter(Boolean)
  );
  const ignored = new Set(["x", "pack", "meal", "meals", "paquete", "paquetes", "de", String(count)]);
  return normalizeText(text)
    .split(" ")
    .filter((token) => token && !ignored.has(token) && !optionTokens.has(token))
    .join(" ");
}

function normalizePackModifiers(value: unknown[]) {
  return value
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

function packCountFromRule(ruleId: string) {
  const count = Number(ruleId.match(/pack-meal-(\d+)/)?.[1] || 0);
  return count >= 3 && count <= 8 ? count : 0;
}

function inferPackCount(text: string) {
  const normalized = normalizeText(text);
  const numeric = normalized.match(/\b([3-8])\s+(?:pack\s+)?meals?\b|\b([3-8])\s+pack\b|\bpaquete(?:\s+de)?\s+([3-8])\b|\b([3-8])\s+paquete\b/);
  if (numeric) return Number(numeric[1] || numeric[2] || numeric[3] || numeric[4]);
  const words = Object.entries(QUANTITY_WORDS).filter(([, value]) => value >= 3 && value <= 8);
  for (const [word, value] of words) {
    if (new RegExp(`\\b${word}\\s+(?:pack\\s+)?meals?\\b|\\b${word}\\s+pack\\b|\\bpaquete(?:\\s+de)?\\s+${word}\\b|\\b${word}\\s+paquete\\b`).test(normalized)) {
      return value;
    }
  }
  return 0;
}

function findPackItems(menu: MenuItem[], count: number) {
  const prefix = `${count} pack meal`;
  return menu
    .filter((item) => normalizeText(item.name).startsWith(prefix))
    .sort((a, b) => packVariantSort(a) - packVariantSort(b) || a.name.localeCompare(b.name));
}

function packVariantSort(item: MenuItem) {
  const order = ["tst", "thr", "tco", "to", "gd", "qst", "qhr", "qco", "qto", "qgd"];
  const code = normalizeText(item.name).match(/\b(tst|thr|tco|to|gd|qst|qhr|qco|qto|qgd)\b/)?.[1] || "";
  const index = order.indexOf(code);
  return index >= 0 ? index : 999;
}

function hasResolvedPackVariant(item: MenuItem, text: string, fromExistingState: boolean) {
  if (fromExistingState) return true;
  return Boolean(findPackVariant([item], text));
}

function findPackVariant(packItems: MenuItem[], text: string) {
  const query = normalizeText(text);
  if (!query) return null;
  const direct = query.match(/\b(tst|thr|tco|to|gd|qst|qhr|qco|qto|qgd)\b/);
  if (direct) return packItems.find((item) => normalizeText(item.name).includes(` ${direct[1]} `)) || null;

  const wantsQueso = /\b(queso|cheese)\b/.test(query);
  const wantsTorta = /\b(torta|tortas)\b/.test(query);
  const wantsGordita = /\b(gordita|gorditas)\b/.test(query);
  const wantsQuesadilla = /\b(quesadilla|quesadillas)\b/.test(query);
  const wantsTaco = /\b(taco|tacos)\b/.test(query);
  const wantsComal = /\b(comal|homemade|handmade|corn|maiz|maíz)\b/.test(query);
  const wantsFlour = /\b(flour|harina)\b/.test(query);
  const wantsStreet = /\b(street|taquero|taquera)\b/.test(query);

  if (wantsQueso && wantsTorta) return findVariantCode(packItems, "qto");
  if (wantsQueso && wantsGordita) return findVariantCode(packItems, "qgd");
  if (wantsTorta) return findVariantCode(packItems, "to");
  if (wantsGordita) return findVariantCode(packItems, "gd");
  if (wantsQuesadilla && wantsComal) return findVariantCode(packItems, "qco");
  if (wantsQuesadilla && wantsFlour) return findVariantCode(packItems, "qhr");
  if (wantsQuesadilla && wantsStreet) return findVariantCode(packItems, "qst");
  if ((wantsTaco || wantsComal) && wantsComal) return findVariantCode(packItems, "tco");
  if ((wantsTaco || wantsFlour) && wantsFlour) return findVariantCode(packItems, "thr");
  if (wantsTaco && wantsStreet) return findVariantCode(packItems, "tst");
  return null;
}

function findVariantCode(packItems: MenuItem[], code: string) {
  return packItems.find((item) => new RegExp(`\\b${code}\\b`, "i").test(normalizeText(item.name))) || null;
}

function buildPackOptionStep(packItems: MenuItem[], count: number, state: PackState, language: "en" | "es") {
  const question = language === "es"
    ? `Elige el tipo para el paquete de ${count}: tacos de comal, harina, taquero, quesadillas, tortas o gorditas.`
    : `Choose the ${count} pack type: comal tacos, flour tacos, street tacos, quesadillas, tortas, or gorditas.`;
  return {
    ok: false,
    reason: "combo_step_required",
    message: question,
    selectedItem: describePackItem(packItems[0], `${count} Pack MEAL`),
    comboState: { ...state, awaitingStepKey: PACK_OPTION_STEP },
    comboStep: {
      itemName: `${count} Pack MEAL`,
      step: 1,
      totalSteps: count + 1,
      stepKey: PACK_OPTION_STEP,
      stepName: "Pack option",
      question,
      options: packItems.map((item) => cleanPackVariantName(item.name, count)),
      selections: state.virtualSelections || []
    }
  };
}

function applyPackMeatText(item: MenuItem, state: PackState, text: string) {
  const groups = getPackMeatGroups(item);
  if (!groups.length) return;
  const query = normalizeText(text);
  if (!query) return;

  const applyToNextGroups = (option: string | ModifierOption, quantity: number) => {
    let remaining = Math.max(1, quantity);
    for (const { group } of groups) {
      if (remaining <= 0) break;
      if (state.selections.some((selection) => selection.groupId === group.id)) continue;
      state.selections.push(selectionFromOption(group, option));
      remaining -= 1;
    }
  };

  const allMatch = findPackOptionMention(groups[0].group.options, query, true);
  if (allMatch) {
    applyToNextGroups(allMatch.option, groups.length);
    return;
  }

  const counted = findCountedPackMeatMentions(groups[0].group.options, query);
  if (counted.length) {
    for (const mention of counted) {
      applyToNextGroups(mention.option, mention.quantity);
    }
    return;
  }

  const single = findPackOptionMention(groups[0].group.options, query, false);
  if (!single) return;
  const focused = Number(state.awaitingStepKey?.match(/item-(\d+)-meat/)?.[1] || 0) - 1;
  const group = focused >= 0 ? groups[focused]?.group : firstMissingMeatGroup(item, state)?.group;
  if (group && !state.selections.some((selection) => selection.groupId === group.id)) {
    state.selections.push(selectionFromOption(group, single.option));
  }
}

function findPackOptionMention(options: Array<string | ModifierOption>, query: string, requireAll: boolean) {
  const allPattern = "\\b(?:all|every|todo|todos|todas|puro|pura)\\b";
  const matches = options
    .map((option) => {
      const aliases = optionAliases(optionName(option));
      let best = -1;
      for (const alias of aliases) {
        const aliasPattern = escapeRegex(alias).replace(/\s+/g, "\\s+");
        const pattern = requireAll
          ? new RegExp(`${allPattern}\\s+(?:de\\s+)?${aliasPattern}\\b|\\b${aliasPattern}\\s+${allPattern}`, "i")
          : new RegExp(`\\b${aliasPattern}\\b`, "i");
        const match = query.match(pattern);
        if (match?.index !== undefined) best = best < 0 ? match.index : Math.min(best, match.index);
      }
      return best >= 0 ? { option, index: best } : null;
    })
    .filter((entry): entry is { option: string | ModifierOption; index: number } => Boolean(entry))
    .sort((a, b) => a.index - b.index);
  return matches[0] || null;
}

function findCountedPackMeatMentions(options: Array<string | ModifierOption>, query: string) {
  const mentions: Array<{ option: string | ModifierOption; quantity: number; index: number }> = [];
  const quantity = `(?:[1-8]|${Object.keys(QUANTITY_WORDS).join("|")})`;
  for (const option of options) {
    for (const alias of optionAliases(optionName(option))) {
      const aliasPattern = escapeRegex(alias).replace(/\s+/g, "\\s+");
      const regex = new RegExp(`\\b(${quantity})\\s+(?:x\\s+)?(?:de\\s+)?${aliasPattern}(?:\\s+(?:meat|carne|carnes))?\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(query))) {
        const parsed = parseQuantity(match[1] || "");
        if (parsed > 0) {
          mentions.push({ option, quantity: parsed, index: match.index });
        }
      }
    }
  }
  return mentions.sort((a, b) => a.index - b.index);
}

function firstMissingMeatGroup(item: MenuItem, state: PackState) {
  return getPackMeatGroups(item).find(({ group }) => !state.selections.some((selection) => selection.groupId === group.id)) || null;
}

function getPackMeatGroups(item: MenuItem) {
  return (item.modifierGroups || [])
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => /\bitem\s*#?\s*\d+\b/.test(normalizeText(group.name)) && /\b(meat|carne)\b/.test(normalizeText(group.name)))
    .sort((a, b) => packGroupNumber(a.group) - packGroupNumber(b.group));
}

function buildPackMeatStep(item: MenuItem, count: number, state: PackState, group: ModifierGroup, index: number, language: "en" | "es") {
  const question = language === "es"
    ? `Carne ${index + 1}: elige una. Puedes decir "todos bistec" o "dos bistec y tres chorizo".`
    : `Item ${index + 1} meat: choose one. You can say "all steak" or "two steak and three chorizo".`;
  return {
    ok: false,
    reason: "combo_step_required",
    message: question,
    selectedItem: describePackItem(item),
    comboState: state,
    comboStep: {
      itemName: item.name,
      step: index + 2,
      totalSteps: count + 1,
      stepKey: state.awaitingStepKey,
      stepName: `Item ${index + 1} meat`,
      question,
      options: (group.options || []).map(optionName),
      selections: packSelectionLabels(state)
    }
  };
}

function finishPackMeal(item: MenuItem, _count: number, state: PackState, language: "en" | "es") {
  const action = {
    type: "add_item",
    itemId: item.id,
    quantity: 1,
    modifiers: state.selections
  };
  return {
    ok: true,
    actions: [action],
    selectedItem: describePackItem(item),
    orderSummary: language === "es" ? `1 x ${item.name}` : `1 x ${item.name}`
  };
}

function selectionFromOption(group: ModifierGroup, option: string | ModifierOption): PackModifier {
  const optionObject = typeof option === "object" ? option : { name: String(option) };
  return {
    groupId: group.id,
    groupName: group.name,
    option: optionObject.name,
    quantity: 1,
    optionId: optionObject.id,
    priceDeltaCents: optionObject.priceDeltaCents
  };
}

function describePackItem(item: MenuItem, nameOverride?: string) {
  return {
    itemId: item.id,
    name: nameOverride || item.name,
    nameEs: nameOverride || item.nameEs || item.name,
    priceCents: item.priceCents,
    description: item.description,
    imageUrl: item.imageUrl,
    modifierGroups: item.modifierGroups
  };
}

function packSelectionLabels(state: PackState) {
  return [...(state.virtualSelections || []), ...state.selections.map((selection) => cleanOptionLabel(selection.option || ""))];
}

function cleanPackVariantName(name: string, count: number) {
  return name
    .replace(new RegExp(`^${count}\\s+Pack\\s+MEAL\\s*`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOptionLabel(value: string) {
  return value.replace(/^\s*\d+\s*x\s+/i, "").replace(/\s+/g, " ").trim();
}

function packGroupNumber(group: ModifierGroup) {
  return Number(group.name.match(/#\s*(\d+)/)?.[1] || 999);
}

function optionName(option: string | ModifierOption) {
  return typeof option === "object" ? option.name : String(option);
}

function optionAliases(value: string) {
  const cleaned = cleanOptionLabel(value.replace(/\([^)]*\)/g, " "));
  const aliases = new Set<string>();
  const add = (entry: string) => {
    const normalized = normalizeText(entry);
    if (normalized.length > 2 && !["beef", "pork", "meat", "carne", "carnes"].includes(normalized)) {
      aliases.add(normalized);
    }
  };
  add(cleaned);
  for (const part of cleaned.split(/\s*\/\s*|\s+-\s+|\s+or\s+|\s+y\s+|\s+and\s+/i)) {
    add(part);
  }
  for (const token of normalizeText(cleaned).split(" ")) {
    add(token);
  }
  return Array.from(aliases).sort((a, b) => b.length - a.length);
}

function parseQuantity(value: string) {
  const normalized = normalizeText(value);
  const numeric = Number(normalized);
  if (Number.isInteger(numeric)) return numeric;
  return QUANTITY_WORDS[normalized] || 0;
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
