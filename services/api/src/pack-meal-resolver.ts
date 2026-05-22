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
  pendingShell?: PackShell;
  itemTypeShell?: PackShell;
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
const PACK_ITEM_TYPE_STEP = "pack-meal-item-type";
const PACK_DELUXE_STEP = "pack-meal-deluxe";
const PACK_SALSA_STEP = "pack-meal-salsa";
const PACK_AGUA_STEP = "pack-meal-agua";
const PACK_EXTRAS_STEP = "pack-meal-extras";
type PackShell = "street" | "flour" | "comal";
type PackItemType = "tacos" | "quesadillas";
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
  const requestedCount = inferPackCount(text);
  const existingCount = existing ? packCountFromRule(existing.ruleId) : 0;
  const activeState = existing && (!requestedCount || requestedCount === existingCount) ? existing : null;
  const pendingText = activeState?.pendingText || "";
  const count = requestedCount || existingCount;
  const isPackRequest = Boolean(activeState || requestedCount || /\bpack\s+meals?\b|\bmeals?\s+pack\b|\bpaquete\b/i.test(normalizeText(text)));
  if (!isPackRequest || !count) {
    return null;
  }

  const packItems = findPackItems(menu, count);
  if (!packItems.length) {
    return null;
  }

  let state: PackState = activeState || {
    ruleId: `pack-meal-${count}`,
    itemId: packItems[0].id,
    itemName: `${count} Pack MEAL`,
    selections: [],
    virtualSelections: []
  };

  let selectedItem = packItems.find((item) => item.id === state.itemId) || null;
  const navigation = activeState ? packNavigationIntent(text) : null;
  if (navigation === "back") {
    return rewindPackMealStep(packItems, count, state, selectedItem, getLanguage(input));
  }

  let variant = findPackVariant(packItems, text);
  if (!variant && state.awaitingStepKey === PACK_ITEM_TYPE_STEP && state.pendingShell) {
    const type = findPackItemTypeIntent(text);
    if (type) {
      variant = findVariantCode(packItems, packVariantCodeForShellType(state.pendingShell, type));
    } else {
      state.pendingText = mergePendingText(pendingText, text);
      return buildPackItemTypeStep(packItems, count, state, getLanguage(input));
    }
  }

  if (variant) {
    selectedItem = variant;
    const itemTypeShell = state.awaitingStepKey === PACK_ITEM_TYPE_STEP ? state.pendingShell : state.itemTypeShell;
    state = {
      ...state,
      itemId: variant.id,
      itemName: variant.name,
      virtualSelections: [cleanPackVariantName(variant.name, count)],
      awaitingStepKey: undefined,
      pendingText: undefined,
      pendingShell: undefined,
      itemTypeShell
    };
  }

  const ambiguousShell = !variant ? findAmbiguousPackShellIntent(text) : null;
  if (ambiguousShell && (state.awaitingStepKey === PACK_OPTION_STEP || !hasResolvedPackVariant(selectedItem || packItems[0], text, Boolean(activeState)))) {
    state = {
      ...state,
      itemId: packItems[0].id,
      itemName: `${count} Pack MEAL`,
      awaitingStepKey: PACK_ITEM_TYPE_STEP,
      pendingShell: ambiguousShell,
      pendingText: mergePendingText(pendingText, stripPackShellIntentText(text, ambiguousShell)),
      virtualSelections: [packShellLabel(ambiguousShell)]
    };
    return buildPackItemTypeStep(packItems, count, state, getLanguage(input));
  }

  if (!selectedItem || state.awaitingStepKey === PACK_OPTION_STEP || (!variant && !hasResolvedPackVariant(selectedItem, text, Boolean(activeState)))) {
    state.awaitingStepKey = PACK_OPTION_STEP;
    state.pendingText = mergePendingText(pendingText, text);
    return buildPackOptionStep(packItems, count, state, getLanguage(input));
  }

  state.selections = normalizePackModifiers(state.selections);
  const meatText = variant
    ? mergePendingText(pendingText, stripPackVariantSelectionText(text, variant, count))
    : mergePendingText(pendingText, text);
  if (state.awaitingStepKey === PACK_DELUXE_STEP) {
    applyPackOptionalText(selectedItem, state, text, "deluxe");
    return buildPackSalsaStepOrNext(selectedItem, count, state, getLanguage(input));
  }
  if (state.awaitingStepKey === PACK_SALSA_STEP) {
    applyPackOptionalText(selectedItem, state, text, "salsa");
    return buildPackAguaStepOrNext(selectedItem, count, state, getLanguage(input));
  }
  if (state.awaitingStepKey === PACK_AGUA_STEP) {
    applyPackOptionalText(selectedItem, state, text, "agua");
    return buildPackExtrasStepOrNext(selectedItem, count, state, getLanguage(input));
  }
  if (state.awaitingStepKey === PACK_EXTRAS_STEP) {
    applyPackOptionalText(selectedItem, state, text, "extras");
    if (packTextSkipsOptional(text) || packNavigationIntent(text) === "next") {
      return finishPackMeal(selectedItem, count, state, getLanguage(input));
    }
    return buildPackExtrasStepOrNext(selectedItem, count, state, getLanguage(input));
  }

  applyPackMeatText(selectedItem, state, meatText);

  const missing = firstMissingMeatGroup(selectedItem, state);
  if (missing) {
    state.awaitingStepKey = `item-${missing.index + 1}-meat`;
    return buildPackMeatStep(selectedItem, count, state, missing.group, missing.index, getLanguage(input));
  }

  return buildPackDeluxeStepOrNext(selectedItem, count, state, getLanguage(input));
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
    pendingText: typeof raw.pendingText === "string" ? raw.pendingText : undefined,
    pendingShell: isPackShell(raw.pendingShell) ? raw.pendingShell : undefined,
    itemTypeShell: isPackShell(raw.itemTypeShell) ? raw.itemTypeShell : undefined
  };
}

function mergePendingText(...values: string[]) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join(" ");
}

function isPackShell(value: unknown): value is PackShell {
  return value === "street" || value === "flour" || value === "comal";
}

function packNavigationIntent(text: string) {
  const normalized = normalizeText(text);
  if (/^(back|previous|go back|previous step|atras|anterior|regresar|volver)$/.test(normalized)) return "back";
  if (/^(next|continue|done|listo|siguiente|adelante|seguir|continuar)$/.test(normalized)) return "next";
  return null;
}

function packTextSkipsOptional(text: string) {
  return /\b(no|none|skip|regular|listo|done|finish|finished|sin|ninguno|ninguna|no gracias|asi esta|ya)\b/.test(normalizeText(text));
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

function stripPackShellIntentText(text: string, shell: PackShell) {
  const shellTokens = new Set(packShellTokens(shell));
  return normalizeText(text)
    .split(" ")
    .filter((token) => token && !shellTokens.has(token))
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
  if (wantsTaco && wantsComal) return findVariantCode(packItems, "tco");
  if (wantsTaco && wantsFlour) return findVariantCode(packItems, "thr");
  if (wantsTaco && wantsStreet) return findVariantCode(packItems, "tst");
  return null;
}

function findVariantCode(packItems: MenuItem[], code: string) {
  return packItems.find((item) => new RegExp(`\\b${code}\\b`, "i").test(normalizeText(item.name))) || null;
}

function findPackItemTypeIntent(text: string): PackItemType | null {
  const query = normalizeText(text);
  if (/\b(quesadilla|quesadillas)\b/.test(query)) return "quesadillas";
  if (/\b(taco|tacos)\b/.test(query)) return "tacos";
  return null;
}

function findAmbiguousPackShellIntent(text: string): PackShell | null {
  const query = normalizeText(text);
  if (!query || /\b(tst|thr|tco|qst|qhr|qco)\b/.test(query) || findPackItemTypeIntent(query)) {
    return null;
  }
  if (/\b(torta|tortas|gordita|gorditas|queso\s+torta|queso\s+gordita)\b/.test(query)) {
    return null;
  }

  const matches: PackShell[] = [];
  if (packShellTokens("street").some((token) => new RegExp(`\\b${escapeRegex(token)}\\b`).test(query))) matches.push("street");
  if (packShellTokens("flour").some((token) => new RegExp(`\\b${escapeRegex(token)}\\b`).test(query))) matches.push("flour");
  if (packShellTokens("comal").some((token) => new RegExp(`\\b${escapeRegex(token)}\\b`).test(query))) matches.push("comal");
  return matches.length === 1 ? matches[0] : null;
}

function packVariantCodeForShellType(shell: PackShell, type: PackItemType) {
  if (shell === "street") return type === "tacos" ? "tst" : "qst";
  if (shell === "flour") return type === "tacos" ? "thr" : "qhr";
  return type === "tacos" ? "tco" : "qco";
}

function packShellLabel(shell: PackShell) {
  if (shell === "street") return "Street / Taquero";
  if (shell === "flour") return "Harina / Flour";
  return "Comal / Homemade";
}

function packShellTokens(shell: PackShell) {
  if (shell === "street") return ["street", "taquero", "taquera"];
  if (shell === "flour") return ["flour", "harina"];
  return ["comal", "homemade", "handmade", "corn", "maiz"];
}

function buildPackOptionStep(packItems: MenuItem[], count: number, state: PackState, language: "en" | "es") {
  const question = language === "es"
    ? `Elige el tipo para el paquete de ${count}: taquero, harina, comal, tortas, gorditas, queso tortas o queso gorditas.`
    : `Choose the ${count} pack type: street, flour, comal, tortas, gorditas, queso tortas, or queso gorditas.`;
  return {
    ok: false,
    reason: "combo_step_required",
    message: question,
    selectedItem: describePackItem(packItems[0], `${count} Pack MEAL`),
    comboState: { ...state, awaitingStepKey: PACK_OPTION_STEP },
    comboStep: {
      itemName: `${count} Pack MEAL`,
      step: 1,
      totalSteps: count + 5,
      stepKey: PACK_OPTION_STEP,
      stepName: "Pack option",
      question,
      options: packOptionStepLabels(packItems),
      selections: state.virtualSelections || []
    }
  };
}

function packOptionStepLabels(packItems: MenuItem[]) {
  const labels: string[] = [];
  const add = (label: string, codePattern: RegExp) => {
    if (packItems.some((item) => codePattern.test(normalizeText(item.name)))) {
      labels.push(label);
    }
  };
  add("Street / Taquero", /\b(tst|qst)\b/);
  add("Harina / Flour", /\b(thr|qhr)\b/);
  add("Comal / Homemade", /\b(tco|qco)\b/);
  add("Tortas", /\bto\b/);
  add("Gorditas", /\bgd\b/);
  add("Queso Tortas", /\bqto\b/);
  add("Queso Gorditas", /\bqgd\b/);
  return labels;
}

function buildPackItemTypeStep(packItems: MenuItem[], count: number, state: PackState, language: "en" | "es") {
  const shell = state.pendingShell || "comal";
  const question = language === "es"
    ? `${packShellLabel(shell)}: ¿tacos o quesadillas?`
    : `${packShellLabel(shell)}: tacos or quesadillas?`;
  return {
    ok: false,
    reason: "combo_step_required",
    message: question,
    selectedItem: describePackItem(packItems[0], `${count} Pack MEAL`),
    comboState: { ...state, awaitingStepKey: PACK_ITEM_TYPE_STEP },
    comboStep: {
      itemName: `${count} Pack MEAL`,
      step: 2,
      totalSteps: count + 6,
      stepKey: PACK_ITEM_TYPE_STEP,
      stepName: "Tacos or quesadillas",
      question,
      options: ["Tacos", "Quesadillas"],
      selections: state.virtualSelections || []
    }
  };
}

function rewindPackMealStep(packItems: MenuItem[], count: number, state: PackState, selectedItem: MenuItem | null, language: "en" | "es") {
  const selected = selectedItem || packItems.find((item) => item.id === state.itemId) || packItems[0];
  if (state.awaitingStepKey === PACK_EXTRAS_STEP) {
    const agua = getPackOptionalGroup(selected, "agua");
    const nextState = {
      ...state,
      selections: agua ? state.selections.filter((selection) => selection.groupId !== agua.id) : state.selections,
      awaitingStepKey: PACK_AGUA_STEP,
      pendingText: undefined
    };
    return buildPackAguaStepOrNext(selected, count, nextState, language);
  }
  if (state.awaitingStepKey === PACK_AGUA_STEP) {
    const salsa = getPackOptionalGroup(selected, "salsa");
    const nextState = {
      ...state,
      selections: salsa ? state.selections.filter((selection) => selection.groupId !== salsa.id) : state.selections,
      awaitingStepKey: PACK_SALSA_STEP,
      pendingText: undefined
    };
    return buildPackSalsaStepOrNext(selected, count, nextState, language);
  }
  if (state.awaitingStepKey === PACK_SALSA_STEP) {
    const deluxe = getPackOptionalGroup(selected, "deluxe");
    const nextState = {
      ...state,
      selections: deluxe ? state.selections.filter((selection) => selection.groupId !== deluxe.id) : state.selections,
      awaitingStepKey: PACK_DELUXE_STEP,
      pendingText: undefined
    };
    return buildPackDeluxeStepOrNext(selected, count, nextState, language);
  }
  if (state.awaitingStepKey === PACK_DELUXE_STEP) {
    const groups = getPackMeatGroups(selected);
    const previous = groups[groups.length - 1];
    if (previous) {
      const nextState = {
        ...state,
        selections: state.selections.filter((selection) => selection.groupId !== previous.group.id),
        awaitingStepKey: `item-${previous.index + 1}-meat`,
        pendingText: undefined
      };
      return buildPackMeatStep(selected, count, nextState, previous.group, previous.index, language);
    }
  }

  if (state.awaitingStepKey === PACK_ITEM_TYPE_STEP) {
    return buildPackOptionStep(packItems, count, {
      ...state,
      itemId: packItems[0].id,
      itemName: `${count} Pack MEAL`,
      selections: [],
      virtualSelections: [],
      awaitingStepKey: PACK_OPTION_STEP,
      pendingShell: undefined,
      itemTypeShell: undefined,
      pendingText: undefined
    }, language);
  }

  const meatStep = state.awaitingStepKey?.match(/^item-(\d+)-meat$/);
  if (meatStep) {
    const groups = getPackMeatGroups(selected);
    const currentIndex = Math.max(0, Number(meatStep[1]) - 1);
    if (currentIndex > 0) {
      const previous = groups[currentIndex - 1];
      if (!previous) {
        return buildPackOptionStep(packItems, count, {
          ...state,
          itemId: packItems[0].id,
          itemName: `${count} Pack MEAL`,
          selections: [],
          virtualSelections: [],
          awaitingStepKey: PACK_OPTION_STEP,
          pendingShell: undefined,
          itemTypeShell: undefined,
          pendingText: undefined
        }, language);
      }
      const nextState = {
        ...state,
        selections: state.selections.filter((selection) => selection.groupId !== previous?.group.id),
        awaitingStepKey: `item-${currentIndex}-meat`,
        pendingText: undefined
      };
      return buildPackMeatStep(selected, count, nextState, previous.group, previous.index, language);
    }

    if (state.itemTypeShell) {
      const nextState = {
        ...state,
        itemId: packItems[0].id,
        itemName: `${count} Pack MEAL`,
        selections: [],
        virtualSelections: [packShellLabel(state.itemTypeShell)],
        awaitingStepKey: PACK_ITEM_TYPE_STEP,
        pendingShell: state.itemTypeShell,
        itemTypeShell: undefined,
        pendingText: undefined
      };
      return buildPackItemTypeStep(packItems, count, nextState, language);
    }

    return buildPackOptionStep(packItems, count, {
      ...state,
      itemId: packItems[0].id,
      itemName: `${count} Pack MEAL`,
      selections: [],
      virtualSelections: [],
      awaitingStepKey: PACK_OPTION_STEP,
      pendingShell: undefined,
      itemTypeShell: undefined,
      pendingText: undefined
    }, language);
  }

  return buildPackOptionStep(packItems, count, {
    ...state,
    itemId: packItems[0].id,
    itemName: `${count} Pack MEAL`,
    selections: [],
    virtualSelections: [],
    awaitingStepKey: PACK_OPTION_STEP,
    pendingShell: undefined,
    itemTypeShell: undefined,
    pendingText: undefined
  }, language);
}

function applyPackOptionalText(item: MenuItem, state: PackState, text: string, kind: "deluxe" | "salsa" | "agua" | "extras") {
  if (packTextSkipsOptional(text) || packNavigationIntent(text) === "next") return;
  const group = getPackOptionalGroup(item, kind);
  if (!group) return;
  if (kind !== "extras") {
    state.selections = state.selections.filter((selection) => selection.groupId !== group.id);
  }
  const query = normalizeText(text);
  if (!query) return;
  let matches = findAllPackOptionMentions(group.options || [], query);
  if (kind === "salsa") {
    matches = matches.filter((match) => packSalsaOptionCompatible(optionName(match.option), query));
  }
  if (!matches.length && kind === "deluxe" && /\b(deluxe|de lujo|preparad[ao])\b/.test(query) && group.options?.[0]) {
    matches.push({ option: group.options[0], index: 0, score: optionName(group.options[0]).length });
  }
  const max = kind === "extras" ? Math.max(1, Number(group.maxSelections) || 10) : 1;
  for (const match of matches) {
    if (state.selections.filter((selection) => selection.groupId === group.id).length >= max) break;
    const option = optionName(match.option);
    if (state.selections.some((selection) => selection.groupId === group.id && normalizeText(selection.option || "") === normalizeText(option))) continue;
    state.selections.push(selectionFromOption(group, match.option));
  }
}

function packSalsaOptionCompatible(option: string, query: string) {
  const key = normalizeText(option);
  if (!/\bsalsa\b/.test(key)) return true;
  if (/\bverde|medium\b/.test(query)) return /\bverde|medium\b/.test(key);
  if (/\broja|hot\b/.test(query)) return /\broja|hot\b/.test(key);
  if (/\btomate|tomato\b/.test(query)) return /\btomato|tomate\b/.test(key);
  if (/\basada|mild\b/.test(query)) return /\basada|mild\b/.test(key) && !/\btomato|tomate\b/.test(key);
  return true;
}

function findAllPackOptionMentions(options: Array<string | ModifierOption>, query: string) {
  return options
    .map((option) => {
      const aliases = optionAliases(optionName(option));
      let best = -1;
      let bestLength = 0;
      for (const alias of aliases) {
        const aliasPattern = escapeRegex(alias).replace(/\s+/g, "\\s+");
        const match = query.match(new RegExp(`\\b${aliasPattern}\\b`, "i"));
        if (match?.index !== undefined && (best < 0 || alias.length > bestLength || (alias.length === bestLength && match.index < best))) {
          best = match.index;
          bestLength = alias.length;
        }
      }
      return best >= 0 ? { option, index: best, score: bestLength } : null;
    })
    .filter((entry): entry is { option: string | ModifierOption; index: number; score: number } => Boolean(entry))
    .sort((a, b) => a.index - b.index || b.score - a.score);
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
      let score = 0;
      for (const alias of aliases) {
        const aliasPattern = escapeRegex(alias).replace(/\s+/g, "\\s+");
        const pattern = requireAll
          ? new RegExp(`${allPattern}\\s+(?:de\\s+)?${aliasPattern}\\b|\\b${aliasPattern}\\s+${allPattern}`, "i")
          : new RegExp(`\\b${aliasPattern}\\b`, "i");
        const match = query.match(pattern);
        if (match?.index !== undefined && (best < 0 || match.index < best || (match.index === best && alias.length > score))) {
          best = match.index;
          score = alias.length;
        }
      }
      return best >= 0 ? { option, index: best, score } : null;
    })
    .filter((entry): entry is { option: string | ModifierOption; index: number; score: number } => Boolean(entry))
    .sort((a, b) => a.index - b.index || b.score - a.score);
  return matches[0] || null;
}

function findCountedPackMeatMentions(options: Array<string | ModifierOption>, query: string) {
  const mentions: Array<{ option: string | ModifierOption; quantity: number; index: number; score: number }> = [];
  const quantity = `(?:[1-8]|${Object.keys(QUANTITY_WORDS).join("|")})`;
  const seen = new Map<string, { option: string | ModifierOption; quantity: number; index: number; score: number }>();
  for (const option of options) {
    for (const alias of optionAliases(optionName(option))) {
      const aliasPattern = escapeRegex(alias).replace(/\s+/g, "\\s+");
      const regex = new RegExp(`\\b(${quantity})\\s+(?:x\\s+)?(?:de\\s+)?${aliasPattern}(?:\\s+(?:meat|carne|carnes))?\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(query))) {
        const parsed = parseQuantity(match[1] || "");
        if (parsed > 0) {
          const key = `${match.index}:${parsed}`;
          const entry = { option, quantity: parsed, index: match.index, score: alias.length };
          const current = seen.get(key);
          if (!current || entry.score > current.score) {
            seen.set(key, entry);
          }
        }
      }
    }
  }
  mentions.push(...seen.values());
  return mentions.sort((a, b) => a.index - b.index || b.score - a.score);
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

function getPackOptionalGroup(item: MenuItem, kind: "deluxe" | "salsa" | "agua" | "extras") {
  return (item.modifierGroups || []).find((group) => {
    const name = normalizeText(group.name || "");
    if (kind === "deluxe") return /\bdeluxe\b/.test(name);
    if (kind === "salsa") return /\bsalsa\b/.test(name) && /\bpreferencia|preference\b/.test(name);
    if (kind === "agua") return /\bagua\b|\bfresca\b/.test(name);
    return /\bextras?\b/.test(name);
  }) || null;
}

function packOptionalStepOffset(state: PackState) {
  return state.itemTypeShell ? 3 : 2;
}

function packRequiredStepCount(count: number, state: PackState) {
  return count + (state.itemTypeShell ? 2 : 1);
}

function packTotalSteps(count: number, state: PackState) {
  return packRequiredStepCount(count, state) + 4;
}

function buildPackDeluxeStepOrNext(item: MenuItem, count: number, state: PackState, language: "en" | "es") {
  const group = getPackOptionalGroup(item, "deluxe");
  if (!group) return buildPackSalsaStepOrNext(item, count, state, language);
  state.awaitingStepKey = PACK_DELUXE_STEP;
  const question = language === "es" ? "¿Regular o deluxe?" : "Regular or deluxe?";
  return buildPackOptionalStep(item, count, state, group, question, PACK_DELUXE_STEP, "Regular or deluxe", ["Regular", ...(group.options || []).map(optionName)], language);
}

function buildPackSalsaStepOrNext(item: MenuItem, count: number, state: PackState, language: "en" | "es") {
  const group = getPackOptionalGroup(item, "salsa");
  if (!group) return buildPackAguaStepOrNext(item, count, state, language);
  state.awaitingStepKey = PACK_SALSA_STEP;
  const question = language === "es" ? "¿Qué salsa prefieres?" : "Which salsa?";
  return buildPackOptionalStep(item, count, state, group, question, PACK_SALSA_STEP, "Salsa", ["No salsa", ...(group.options || []).map(optionName)], language);
}

function buildPackAguaStepOrNext(item: MenuItem, count: number, state: PackState, language: "en" | "es") {
  const group = getPackOptionalGroup(item, "agua");
  if (!group) return buildPackExtrasStepOrNext(item, count, state, language);
  state.awaitingStepKey = PACK_AGUA_STEP;
  const question = language === "es" ? "¿Agua fresca extra? Di listo si no." : "Extra agua fresca? Say done for none.";
  return buildPackOptionalStep(item, count, state, group, question, PACK_AGUA_STEP, "Agua extra", ["No agua extra", ...(group.options || []).map(optionName)], language);
}

function buildPackExtrasStepOrNext(item: MenuItem, count: number, state: PackState, language: "en" | "es") {
  const group = getPackOptionalGroup(item, "extras");
  if (!group) return finishPackMeal(item, count, state, language);
  state.awaitingStepKey = PACK_EXTRAS_STEP;
  const question = language === "es" ? "¿Extras? Di listo si no." : "Any extras? Say done for none.";
  return buildPackOptionalStep(item, count, state, group, question, PACK_EXTRAS_STEP, "Extras", ["No extras", ...(group.options || []).map(optionName)], language);
}

function buildPackOptionalStep(item: MenuItem, count: number, state: PackState, _group: ModifierGroup, question: string, stepKey: string, stepName: string, options: string[], _language: "en" | "es") {
  return {
    ok: false,
    reason: "combo_step_required",
    message: question,
    selectedItem: describePackItem(item),
    comboState: state,
    comboStep: {
      itemName: item.name,
      step: packRequiredStepCount(count, state) + (stepKey === PACK_DELUXE_STEP ? 1 : stepKey === PACK_SALSA_STEP ? 2 : stepKey === PACK_AGUA_STEP ? 3 : 4),
      totalSteps: packTotalSteps(count, state),
      stepKey,
      stepName,
      question,
      options,
      selections: packSelectionLabels(state)
    }
  };
}

function buildPackMeatStep(item: MenuItem, count: number, state: PackState, group: ModifierGroup, index: number, language: "en" | "es") {
  const question = language === "es"
    ? `Carne ${index + 1}: elige una. Puedes decir "todos bistec" o "dos bistec y tres chorizo".`
    : `Item ${index + 1} meat: choose one. You can say "all steak" or "two steak and three chorizo".`;
  const totalSteps = packTotalSteps(count, state);
  const stepOffset = packOptionalStepOffset(state);
  return {
    ok: false,
    reason: "combo_step_required",
    message: question,
    selectedItem: describePackItem(item),
    comboState: state,
    comboStep: {
      itemName: item.name,
      step: index + stepOffset,
      totalSteps,
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
  const cleanedKey = normalizeText(cleaned);
  const aliases = new Set<string>();
  const genericTokens = new Set(["beef", "pork", "meat", "carne", "carnes", "extra", "side", "chips", "chip", "with", "oz", "double"]);
  const isAmbiguousPotatoOption = /\b(papas con rajas|poblano with potatoes|nopales con papas|cacti with potatoes)\b/.test(cleanedKey);
  const ambiguousPotatoTokens = new Set(["papas", "potato", "potatoes"]);
  const add = (entry: string) => {
    const normalized = normalizeText(entry);
    if (
      normalized.length > 2 &&
      !genericTokens.has(normalized) &&
      !(isAmbiguousPotatoOption && ambiguousPotatoTokens.has(normalized))
    ) {
      aliases.add(normalized);
    }
  };
  add(cleaned);
  if (/\b(papas con rajas|poblano with potatoes)\b/.test(cleanedKey)) {
    add("papas con rajas");
    add("rajas con papas");
    add("poblano with potatoes");
  }
  if (/\b(nopales con papas|cacti with potatoes)\b/.test(cleanedKey)) {
    add("nopales con papas");
    add("cactus with potatoes");
    add("cacti with potatoes");
  }
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
