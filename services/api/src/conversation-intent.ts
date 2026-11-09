// Versioned conversation intent. The same file feeds the model instructions and the
// deterministic turns that return before the model. Patterns are general; the examples
// illustrate them. A turn that does not match is left to the existing parser.
import { readFileSync } from "node:fs";
import { enforceSiteAvailability } from "./site-catalog.js";

export type IntentAction = {
  type: "add_item" | "remove_item" | "update_item";
  itemId: string;
  quantity: number;
  modifiers?: Array<{ step: string; option: string }>;
  /** Remove or update this cart index when several lines share an item id. */
  lineIndex?: number;
};

export type IntentPending = {
  operation: "replace" | "add";
  itemId: string;
  quantity: number | null;
  modifiers: Array<{ step: string; option: string }>;
  targetIndex: number | null;
  unresolved: string[];
};

export type IntentDecision = {
  kind: "availability" | "accept" | "replace" | "add" | "clarify";
  reply: string;
  actions: IntentAction[];
  pending?: IntentPending | null;
};

type IntentFile = {
  version: number;
  marker: string;
  rules: string[];
  examples: Array<{ language: string; lines: string[] }>;
  availabilityCues: string[];
  orderVerbs: string[];
  replacementCues: string[];
  additiveCues: string[];
  quantities: Record<string, number>;
  unclearQuantities: string[];
};

export type IntentMenuItem = {
  id: string;
  name?: string;
  nameEs?: string;
  aliases?: string[];
  soldOut?: boolean;
  available?: boolean;
  unavailable?: boolean;
  squareCatalogObjectId?: string;
  modifierGroups?: Array<{ name: string; minSelections?: number; options?: Array<string | { name: string }> }>;
};

export type IntentInput = {
  transcript: string;
  language: "en" | "es";
  menu: IntentMenuItem[];
  history?: Array<{ role: string; text: string }>;
  cart?: Array<{ itemId: string; quantity?: number; modifiers?: any[] }>;
  discussedTexts?: string[];
  staffTexts?: string[];
  /** Open clarification from the previous turn. Callers that keep a session may omit it. */
  pending?: IntentPending | null;
  sessionKey?: string;
};

const STOP = new Set(["with", "para", "from", "that", "this", "have", "your", "just", "some", "also", "them", "please", "favor", "de", "del", "of", "con", "the", "los", "las", "una", "uno", "por"]);
const SAME_COUNT = /\b(?:same(?:\s+number)?|mismos|mismas|igual(?:es)?)\b/;

let cached: IntentFile | null = null;
export function loadConversationIntent(): IntentFile | null {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(new URL("../data/conversation-intent.json", import.meta.url), "utf8")) as IntentFile;
    return cached;
  } catch {
    return null;
  }
}

/** Text actually appended to the ordering instructions. Empty when the file cannot be read. */
export function conversationIntentPrompt(): string {
  const file = loadConversationIntent();
  if (!file) return "";
  const examples = file.examples.map((ex) => ex.lines.join("\n")).join("\n\n");
  return [
    file.marker,
    "Conversation intent. These are rules, not a list of orders to memorize.",
    ...file.rules.map((rule) => `- ${rule}`),
    "Illustrations:",
    examples,
  ].join("\n");
}

const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const stem = (w: string) => w.replace(/es$/, "").replace(/s$/, "");
const words = (s: string) => fold(s).split(" ").filter(Boolean);
const hasWord = (phrase: string, token: string) => words(phrase).some((w) => stem(w) === stem(token) || w === token);

function significant(name: string): string[] {
  return words(name).map(stem).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w));
}

function namesOf(item: IntentMenuItem): string[] {
  return [item.name, item.nameEs, ...(item.aliases || [])].filter((x): x is string => !!x && fold(x).length > 0);
}

function strictMatch(item: IntentMenuItem, phrase: string): boolean {
  return namesOf(item).some((name) => {
    const tokens = significant(name);
    return tokens.length > 0 && tokens.every((token) => hasWord(phrase, token));
  });
}

function headMatch(item: IntentMenuItem, phrase: string): boolean {
  return namesOf(item).some((name) => {
    const head = significant(name)[0];
    return !!head && hasWord(phrase, head);
  });
}

function optionName(option: string | { name: string }): string {
  return typeof option === "string" ? option : option.name;
}

function tokenNegated(phrase: string, token: string): boolean {
  return new RegExp(`\\b(?:no|not|sin|without)\\s+(?:\\w+\\s+){0,2}${token}\\b`).test(phrase);
}

function spokenOptions(item: IntentMenuItem, phrase: string, includeNegated = false): Array<{ step: string; option: string }> | "ambiguous" {
  const generic = new Set([...significant(item.name || ""), ...significant(item.nameEs || "")]);
  const attached: Array<{ step: string; option: string }> = [];
  for (const group of item.modifierGroups || []) {
    const hits = (group.options || []).map(optionName).filter((name) => {
      const tokens = significant(name).filter((token) => !generic.has(token) && (includeNegated || !tokenNegated(phrase, token)));
      return tokens.some((token) => hasWord(phrase, token));
    });
    const unique = [...new Set(hits)];
    if (unique.length > 1) return "ambiguous";
    if (unique.length === 1) attached.push({ step: group.name, option: unique[0] });
  }
  return attached;
}

function unavailable(item: IntentMenuItem): boolean {
  return item.soldOut === true || item.available === false || item.unavailable === true;
}

function declineOf(staff: string[], item: IntentMenuItem): boolean {
  const folded = staff.map(fold);
  return folded.some((text) => {
    if (!/\bno (?:tenemos|hay|esta)\b|\bnot available\b|\bsold out\b|\bwe don t have\b|\bno esta disponible\b/.test(text)) return false;
    return namesOf(item).some((name) => significant(name).some((token) => hasWord(text, token)));
  });
}

function discussedItems(input: IntentInput, file: IntentFile): IntentMenuItem[] {
  const texts = [
    ...(input.discussedTexts || []),
    ...(input.history || []).filter((turn) => turn.role === "customer" || turn.role === "user").map((turn) => turn.text),
  ];
  const avail = texts.filter((text) => isAvailability(fold(text), file));
  const last = avail[avail.length - 1];
  if (!last) return [];
  return matchItems(input.menu, fold(last)).items.filter((item) => !declineOf(input.staffTexts || [], item));
}

function matchesOwnName(item: IntentMenuItem, phrase: string): boolean {
  return [item.name, item.nameEs].some((name) => {
    const tokens = significant(name || "");
    return tokens.length > 0 && tokens.every((token) => hasWord(phrase, token));
  });
}

function matchItems(menu: IntentMenuItem[], phrase: string): { items: IntentMenuItem[]; ambiguous: boolean } {
  const strict = menu.filter((item) => strictMatch(item, phrase));
  const pick = (items: IntentMenuItem[]) => {
    if (items.length <= 1) return { items, ambiguous: false };
    // An alias on a combo can contain the same words as the dish the caller named.
    // Prefer the item whose own name matches. Two real dishes with that name stay ambiguous.
    const named = items.filter((item) => matchesOwnName(item, phrase));
    if (named.length === 1) return { items: named, ambiguous: false };
    if (named.length > 1) return { items: named, ambiguous: true };
    return { items, ambiguous: true };
  };
  if (strict.length) return pick(strict);
  return pick(menu.filter((item) => headMatch(item, phrase)));
}

function takeQuantity(phrase: string, file: IntentFile): { quantity: number | null; rest: string; unclear: boolean } {
  const cleaned = phrase.replace(/^(?:please|por favor)\s+/, "");
  const unclear = file.unclearQuantities.find((q) => cleaned === fold(q) || cleaned.startsWith(fold(q) + " "));
  if (unclear) return { quantity: null, rest: cleaned.slice(fold(unclear).length).trim(), unclear: true };
  if (/^(?:a|an)\s+\S/.test(cleaned)) return { quantity: 1, rest: cleaned.replace(/^(?:a|an)\s+/, ""), unclear: false };
  const first = cleaned.split(" ")[0];
  const quantity = file.quantities[first];
  if (quantity) return { quantity, rest: cleaned.split(" ").slice(1).join(" "), unclear: false };
  return { quantity: null, rest: cleaned, unclear: false };
}

function isAvailability(folded: string, file: IntentFile): boolean {
  if (folded.split(" ").length > 14) return false;
  if (file.orderVerbs.some((verb) => folded.includes(fold(verb)))) return false;
  if (file.replacementCues.some((cue) => folded.startsWith(fold(cue)))) return false;
  const head = folded.slice(0, 48);
  return file.availabilityCues.some((cue) => head.includes(fold(cue)));
}

function startsWithCue(folded: string, cues: string[]): string | null {
  const hit = cues.map(fold).sort((a, b) => b.length - a.length).find((cue) => folded.startsWith(cue));
  return hit || null;
}

function replyFor(language: "en" | "es", kind: IntentDecision["kind"], name: string, quantity: number, choices: string): string {
  const es = language === "es";
  const qty = `${quantity} ${name}`;
  if (kind === "accept") return es ? `${qty}.` : `${qty}.`;
  if (kind === "add") return es ? `Agregué ${qty}. Lo anterior se queda.` : `Added ${qty}. The earlier item stays.`;
  if (kind === "replace") return es ? `Cambié a ${qty}. No dejé las dos.` : `Replaced with ${qty}. I did not keep both.`;
  if (kind === "availability") return es ? "No puedo confirmar disponibilidad. No lo agregué." : "I can't confirm availability. I did not add it.";
  return choices;
}

function clarify(language: "en" | "es", es: string, en: string): IntentDecision {
  return { kind: "clarify", reply: language === "es" ? es : en, actions: [] };
}

function blocked(language: "en" | "es", item: IntentMenuItem, actions: IntentAction[]): IntentDecision | null {
  if (unavailable(item)) {
    return clarify(language, "No está disponible, no lo agregué.", "That is not available, so I did not add it.");
  }
  try {
    const gated = enforceSiteAvailability({ reply: "", actions }, [item] as any, language, undefined, { channel: "phone" });
    if ((gated.actions || []).length !== actions.length) {
      return { kind: "clarify", reply: gated.reply || (language === "es" ? "Ahora no está disponible, no lo agregué." : "That is not available right now, so I did not add it."), actions: [] };
    }
  } catch { /* catalog window stays a no-add when the check itself fails */ }
  return null;
}

const SIZE_WORD = new Set(["ounce", "ounces", "onza", "onzas", "oz", "treinta", "veinte", "grande", "chica", "chico", "large", "small"]);
const pendingBySession = new Map<string, IntentPending>();

function requiredMissing(item: IntentMenuItem, modifiers: Array<{ step: string; option: string }>): string[] {
  return (item.modifierGroups || [])
    .filter((group) => (group.minSelections || 0) >= 1 && !modifiers.some((modifier) => modifier.step === group.name))
    .map((group) => group.name);
}

function lineIndexes(cart: IntentInput["cart"], menu: IntentMenuItem[], phrase: string): number[] | "ambiguous" {
  const lines = cart || [];
  const matched = matchItems(menu, phrase);
  if (matched.ambiguous || matched.items.length !== 1) return matched.ambiguous ? "ambiguous" : [];
  const item = matched.items[0];
  const options = spokenOptions(item, phrase);
  if (options === "ambiguous") return "ambiguous";
  const indexes = lines.map((line, index) => index).filter((index) => lines[index].itemId === item.id);
  if (!options.length) return indexes;
  return indexes.filter((index) => options.every((option) => (lines[index].modifiers || []).some((modifier) => modifier.option === option.option)));
}

function parseSide(phrase: string, menu: IntentMenuItem[], file: IntentFile): { item: IntentMenuItem; quantity: number | null; modifiers: Array<{ step: string; option: string }> } | "ambiguous" | null {
  const taken = takeQuantity(phrase.replace(/^(?:add|agrega|agregar)\s+/, ""), file);
  if (taken.unclear) return null;
  const matched = matchItems(menu, taken.rest || phrase);
  if (matched.ambiguous) return "ambiguous";
  if (matched.items.length !== 1) return null;
  const item = matched.items[0];
  const modifiers = spokenOptions(item, phrase);
  if (modifiers === "ambiguous") return "ambiguous";
  return { item, quantity: taken.quantity, modifiers };
}

function splitTargeted(folded: string): { target: string; next: string } | null {
  const patterns = [
    /^instead of (.+?) (?:give me|i want) (.+)$/,
    /^en vez de (.+?) (?:dame|deme|quiero) (.+)$/,
    /^replace (.+?) with (.+)$/,
    /^swap (.+?) for (.+)$/,
    /^change (.+?) for (.+)$/,
    /^cambia (.+?) por (.+)$/,
    /^cambio (.+?) por (.+)$/,
  ];
  for (const pattern of patterns) {
    const match = folded.match(pattern);
    if (match) return { target: match[1], next: match[2] };
  }
  return null;
}

function askQuantity(language: "en" | "es", pending: IntentPending): IntentDecision {
  return { ...clarify(language, "¿Cuántos? No cambié la orden.", "How many? I did not change the order."), pending };
}

function askTarget(language: "en" | "es", cart: NonNullable<IntentInput["cart"]>, menu: IntentMenuItem[], pending: IntentPending): IntentDecision {
  const names = cart.map((line) => {
    const item = menu.find((entry) => entry.id === line.itemId);
    const options = (line.modifiers || []).map((modifier) => modifier.option).filter(Boolean).join(", ");
    const name = item?.name || line.itemId;
    return options ? `${name} (${options})` : name;
  }).join(", ");
  return {
    ...clarify(language, names ? `Necesito saber cuál cambio: ${names}.` : "No hay una línea clara que cambiar.", names ? `I need to know which one to replace: ${names}.` : "There is no clear line to replace."),
    pending,
  };
}

function askGroup(language: "en" | "es", groupName: string, pending: IntentPending): IntentDecision {
  return {
    ...clarify(language, `¿Cuál opción de ${groupName}? No cambié la orden.`, `Which ${groupName}? I did not change the order.`),
    pending,
  };
}

function settle(language: "en" | "es", pending: IntentPending, cart: NonNullable<IntentInput["cart"]>, menu: IntentMenuItem[]): IntentDecision {
  const item = menu.find((entry) => entry.id === pending.itemId);
  const missing = item ? requiredMissing(item, pending.modifiers) : [];
  const unresolved = [
    pending.quantity ? "" : "quantity",
    pending.operation === "replace" && pending.targetIndex == null ? "target" : "",
    ...missing,
  ].filter(Boolean);
  const next = { ...pending, unresolved };
  if (unresolved[0] === "quantity") return askQuantity(language, next);
  if (unresolved[0] === "target") return askTarget(language, cart, menu, next);
  if (unresolved.length) return askGroup(language, unresolved[0], next);
  const name = item?.name || item?.nameEs || pending.itemId;
  const add: IntentAction = { type: "add_item", itemId: pending.itemId, quantity: pending.quantity || 1, modifiers: pending.modifiers };
  if (pending.operation === "add") {
    return { kind: "add", reply: replyFor(language, "add", name, add.quantity, ""), actions: [add], pending: null };
  }
  const index = pending.targetIndex as number;
  const line = cart[index];
  return {
    kind: "replace",
    reply: replyFor(language, "replace", name, add.quantity, ""),
    actions: [
      { type: "remove_item", itemId: line.itemId, quantity: Number(line.quantity) || 1, lineIndex: index },
      add,
    ],
    pending: null,
  };
}

function continuePending(input: IntentInput, file: IntentFile, language: "en" | "es", pending: IntentPending, folded: string): IntentDecision | null {
  const cart = input.cart || [];
  const only = takeQuantity(folded, file);
  if (only.quantity && !only.rest && !only.unclear) return settle(language, { ...pending, quantity: only.quantity }, cart, input.menu);
  if (pending.operation === "replace" && pending.targetIndex == null && !splitTargeted(folded)) {
    const found = lineIndexes(cart, input.menu, folded);
    if (found !== "ambiguous" && found.length === 1) return settle(language, { ...pending, targetIndex: found[0] }, cart, input.menu);
  }
  const item = input.menu.find((entry) => entry.id === pending.itemId);
  if (!item) return null;
  const options = spokenOptions(item, folded);
  if (options === "ambiguous" || !options.length) return null;
  if (only.quantity && only.rest) {
    const named = matchItems(input.menu, only.rest);
    if (named.items.length === 1 && named.items[0].id !== pending.itemId) return null;
  }
  const modifiers = [...pending.modifiers];
  for (const option of options) {
    const at = modifiers.findIndex((modifier) => modifier.step === option.step);
    if (at >= 0) modifiers[at] = option;
    else modifiers.push(option);
  }
  return settle(language, { ...pending, modifiers }, cart, input.menu);
}

function optionResolution(item: IntentMenuItem, phrase: string): { modifiers: Array<{ step: string; option: string }>; openGroup: string | null } {
  const generic = new Set([...significant(item.name || ""), ...significant(item.nameEs || "")]);
  const modifiers: Array<{ step: string; option: string }> = [];
  let openGroup: string | null = null;
  for (const group of item.modifierGroups || []) {
    const hits = (group.options || []).map(optionName).filter((name) => {
      const tokens = significant(name).filter((token) => !generic.has(token) && !tokenNegated(phrase, token));
      return tokens.some((token) => hasWord(phrase, token));
    });
    const unique = [...new Set(hits)];
    // Two spoken options in one group are a question, not a guess and not a label fallback.
    if (unique.length > 1) { if (!openGroup) openGroup = group.name; continue; }
    if (unique.length === 1) modifiers.push({ step: group.name, option: unique[0] });
  }
  return { modifiers, openGroup };
}

function parsePartial(phrase: string, menu: IntentMenuItem[], file: IntentFile): { item: IntentMenuItem; quantity: number | "same" | null; modifiers: Array<{ step: string; option: string }> } | null {
  let working = phrase.trim();
  let quantity: number | "same" | null = null;
  if (/^(?:the\s+)?same number of\b|^(?:la\s+)?misma cantidad de\b/.test(working)) {
    quantity = "same";
    working = working.replace(/^(?:the\s+)?same number of\s+|^(?:la\s+)?misma cantidad de\s+/, "");
  }
  const taken = takeQuantity(working.replace(/^(?:those|these|esos|esas)\s+/, ""), file);
  if (taken.unclear) return null;
  if (taken.quantity) quantity = taken.quantity;
  const matched = matchItems(menu, taken.rest || working);
  if (matched.ambiguous || matched.items.length !== 1) return null;
  const resolved = optionResolution(matched.items[0], phrase);
  return { item: matched.items[0], quantity, modifiers: resolved.modifiers };
}

function lineRef(cart: NonNullable<IntentInput["cart"]>, menu: IntentMenuItem[], phrase: string): number[] | "ambiguous" {
  const folded = fold(phrase);
  if (/\b(?:earlier|first|primera|primero|anterior)\b/.test(folded) && !/\b(?:second|segunda|ultimo|ultima|last)\b/.test(folded)) {
    return cart.length ? [0] : [];
  }
  return lineIndexes(cart, menu, phrase);
}

function targetedReplacement(input: IntentInput, file: IntentFile, language: "en" | "es", target: string, next: string): IntentDecision | null {
  const cart = input.cart || [];
  const parsed = parsePartial(next, input.menu, file);
  if (!parsed) return null;
  const targets = lineRef(cart, input.menu, target);
  if (targets === "ambiguous") return null;
  const targetIndex = targets.length === 1 ? targets[0] : null;
  const quantity = parsed.quantity === "same" ? (targetIndex != null ? Number(cart[targetIndex].quantity) || null : null) : parsed.quantity;
  const block = blocked(language, parsed.item, [{ type: "add_item", itemId: parsed.item.id, quantity: quantity || 1, modifiers: parsed.modifiers }]);
  if (block) return { ...block, pending: null };
  return settle(language, {
    operation: "replace",
    itemId: parsed.item.id,
    quantity,
    modifiers: parsed.modifiers,
    targetIndex,
    unresolved: [],
  }, cart, input.menu);
}

const DISCOURSE_LEADS = [
  "for a separate line ", "and separately ", "por separado agrega ", "por separado ",
  "para empezar ", "alongside those ", "alongside ", "i would like ", "i d like ",
  "id like ", "start with ", "en otra linea ", "filled with ", "separately ",
  "please ", "anota ", "anote ", "tambien ", "aparte ", "ponme ", "agrega ", "add ", "put ", "and ", "y ",
].sort((a, b) => b.length - a.length);

function stripDiscourse(folded: string): string {
  let text = folded.replace(/\bfilled with\b/g, " ").replace(/\ben otra linea\b/g, " ").replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const lead of DISCOURSE_LEADS) {
      if (text.startsWith(lead)) { text = text.slice(lead.length).trim(); changed = true; }
    }
  }
  return text;
}

function isCartEdit(folded: string): boolean {
  return /\b(?:remove|quita|quiten|cancel|sin|without|reduce|reducir|dejala|dejalo|deja|cambia la cantidad|cambiar la cantidad|preguntame|pregunta cual|ask me which|which line|not the|keep the|keep both|conserva|se quedan|stay at|stays at)\b/.test(folded);
}

function beforeKeep(folded: string): string {
  const cut = folded.split(/\b(?:not the|keep both|keep the|conserva)\b/)[0];
  return cut.replace(/\b(?:los|las|el|la|the)\s+\S+(?:\s+\S+){0,6}\s+(?=se quedan|stay at|stays at)\b/, " ").split(/\b(?:se quedan|stay at|stays at)\b/)[0];
}

function asksWhichLine(folded: string): boolean {
  return /\b(?:ask me which|which line|which one|preguntame cual|pregunta cual|cual antes)\b/.test(folded);
}

function modifierKey(modifiers: Array<{ step?: string; option?: string }> | undefined): string {
  return [...(modifiers || [])].map((modifier) => `${modifier.step || ""}\0${modifier.option || ""}`).sort().join("|");
}

function sameSpokenLine(cart: NonNullable<IntentInput["cart"]>, action: IntentAction): boolean {
  if (action.type !== "add_item") return false;
  const wanted = modifierKey(action.modifiers);
  return cart.some((line) => line.itemId === action.itemId && Number(line.quantity) === action.quantity && modifierKey(line.modifiers) === wanted);
}

function describeOwnLine(line: { itemId: string; modifiers?: Array<{ step?: string; option?: string }> }, menu: IntentMenuItem[]): string {
  const item = menu.find((entry) => entry.id === line.itemId);
  const name = item?.name || line.itemId;
  const mods = (line.modifiers || []).map((modifier) => `${modifier.step} = ${modifier.option}`).filter((text) => text !== " = ");
  return mods.length ? `${name}, ${mods.join("; ")}` : name;
}

function unresolvedEarlierEdit(folded: string): boolean {
  return /\b(?:and|y)\s+(?:change|cambia|cambie|cambiar)\b/.test(folded)
    && /\b(?:earlier|anterior|first|primera)\b/.test(folded)
    && !/\b(?:change|cambia|cambie|cambiar)\b.+\b(?:for|por|to)\b/.test(folded);
}

function splitUnspecifiedChange(folded: string): { add: string; change: string } | null {
  if (!unresolvedEarlierEdit(folded)) return null;
  const parts = folded.split(/\b(?:and|y)\s+(?=(?:change|cambia|cambie|cambiar)\b)/);
  if (parts.length < 2) return null;
  return { add: parts[0].trim(), change: parts.slice(1).join(" ").trim() };
}

function earlierTarget(cart: NonNullable<IntentInput["cart"]>, menu: IntentMenuItem[], changeClause: string): { index: number } | "ambiguous" | "none" {
  if (!cart.length) return "none";
  const hits: number[] = [];
  for (let index = 0; index < cart.length; index++) {
    const item = menu.find((entry) => entry.id === cart[index].itemId);
    if (!item) continue;
    const options = spokenOptions(item, changeClause);
    if (options === "ambiguous") return "ambiguous";
    if (options.length && options.every((option) => (cart[index].modifiers || []).some((modifier) => modifier.step === option.step && modifier.option === option.option))) hits.push(index);
  }
  if (hits.length > 1) return "ambiguous";
  if (hits.length === 1) return { index: hits[0] };
  if (cart.length === 1) return { index: 0 };
  return "ambiguous";
}

function addActionFromUtterance(input: IntentInput, file: IntentFile, language: "en" | "es", text: string): IntentAction | null {
  const folded = fold(text);
  const split = splitUnspecifiedChange(folded);
  const source = split ? split.add : folded;
  const stripped = stripDiscourse(source);
  const decided = directOrder(input, file, language, stripped || source);
  return decided?.actions.find((action) => action.type === "add_item") || null;
}

// The cart array is the object both pipelines already hand to the next turn.
// Phone records a witness only after apply() pushes the intent actions.
// The reducer records it inside applyIntentCart, on the array that function returns.
// An empty witness means the previous intent turn applied no add. Pending is untouched.
const appliedRequestWitness = new WeakMap<object, IntentAction[]>();

export function recordAppliedRequest(cart: object | null | undefined, actions: IntentAction[]): void {
  if (!cart || typeof cart !== "object") return;
  const adds = (actions || []).filter((action) => action?.type === "add_item").map((action) => ({
    type: "add_item" as const,
    itemId: action.itemId,
    quantity: Number(action.quantity) || 1,
    modifiers: (action.modifiers || []).map((modifier) => ({ step: modifier.step || "", option: modifier.option || "" })),
  }));
  appliedRequestWitness.set(cart, adds);
}

function readAppliedRequest(cart: object | null | undefined): IntentAction[] {
  if (!cart || typeof cart !== "object") return [];
  return appliedRequestWitness.get(cart) || [];
}

function unresolvedConstraint(priorText: string, action: IntentAction, menu: IntentMenuItem[], file: IntentFile): string {
  const item = menu.find((entry) => entry.id === action.itemId);
  const consumed = new Set<string>();
  const absorb = (value: string) => { for (const word of fold(value).split(" ")) { const token = stem(word); if (token) consumed.add(token); } };
  absorb(item?.name || "");
  absorb(item?.nameEs || "");
  for (const modifier of action.modifiers || []) { absorb(modifier.step || ""); absorb(modifier.option || ""); }
  for (const lead of DISCOURSE_LEADS) absorb(lead);
  for (const word of Object.keys(file.quantities)) absorb(word);
  absorb("those these esos esas only solo solamente");
  return fold(priorText).split(" ").filter((word) => {
    const token = stem(word);
    return token.length >= 3 && !STOP.has(word) && !STOP.has(token) && !consumed.has(token);
  }).join(" ");
}

function sameAdd(left: IntentAction, right: IntentAction): boolean {
  return left.type === "add_item" && right.type === "add_item"
    && left.itemId === right.itemId
    && left.quantity === right.quantity
    && modifierKey(left.modifiers) === modifierKey(right.modifiers);
}

function directOrder(input: IntentInput, file: IntentFile, language: "en" | "es", folded: string): IntentDecision | null {
  const taken = takeQuantity(folded, file);
  if (!taken.quantity || taken.unclear || !taken.rest) return null;
  const matched = matchItems(input.menu, taken.rest);
  if (matched.ambiguous || matched.items.length !== 1) return null;
  const item = matched.items[0];
  const modifiers = spokenOptions(item, folded);
  if (modifiers === "ambiguous") return null;
  // A bare "una quesadilla" still belongs to the model/parser so it can collect the missing choices.
  // A direct order is committed here only when every required group was actually spoken.
  if (requiredMissing(item, modifiers).length) return null;
  const consumed = [taken.rest, item.name || "", item.nameEs || "", ...modifiers.flatMap((modifier) => [modifier.step, modifier.option])];
  if (hasLeftover(folded, consumed, file, SIZE_WORD)) return null;
  const action: IntentAction = { type: "add_item", itemId: item.id, quantity: taken.quantity, modifiers };
  const block = blocked(language, item, [action]);
  if (block) return { ...block, pending: null };
  const kind = (input.cart || []).length ? "add" : "accept";
  return { kind, reply: replyFor(language, kind, item.name || item.nameEs || item.id, taken.quantity, ""), actions: [action], pending: null };
}

/**
 * Decide a whole short turn. Returns null when this is not one of the conversation-intent
 * shapes, so the existing parser keeps the turn.
 */
function decideConversationIntent(input: IntentInput): IntentDecision | null {
  const file = loadConversationIntent();
  if (!file || !Array.isArray(input.menu) || !input.menu.length) return null;
  const folded = fold(input.transcript);
  if (!folded) return null;
  const language = input.language === "en" ? "en" : "es";
  const cart = input.cart || [];
  const pending = input.pending !== undefined ? input.pending : (input.sessionKey ? pendingBySession.get(input.sessionKey) || null : null);
  const remember = (decision: IntentDecision): IntentDecision => {
    if (input.sessionKey) {
      if (decision.pending) pendingBySession.set(input.sessionKey, decision.pending);
      else pendingBySession.delete(input.sessionKey);
    }
    return decision;
  };
  if (isCartEdit(folded) && cart.length) {
    if (asksWhichLine(folded) && cart.length > 1) {
      const asked = askTarget(language, cart, input.menu, { operation: "replace", itemId: cart[0].itemId, quantity: null, modifiers: [], targetIndex: null, unresolved: ["target"] });
      return remember({ kind: "clarify", reply: asked.reply, actions: [], pending: null });
    }
    const clause = beforeKeep(folded);
    const qtyWord = clause.match(/\b(?:to|en|hasta|a)\s+(one|two|three|four|five|six|un|una|uno|dos|tres|cuatro|cinco|seis|[1-6])\b/);
    const quantity = qtyWord ? (file.quantities[qtyWord[1]] || Number(qtyWord[1]) || 0) : 0;
    if (/\b(?:reduce|reducir|cambia la cantidad|cambiar la cantidad|dejala|dejalo|deja)\b/.test(clause) && quantity) {
      const named = lineIndexes(cart, input.menu, clause);
      let found: number[] | "ambiguous" = named;
      if (named === "ambiguous" || !named.length) {
        const hits: number[] = [];
        for (let index = 0; index < cart.length; index++) {
          const item = input.menu.find((entry) => entry.id === cart[index].itemId);
          const options = item ? spokenOptions(item, clause) : [];
          if (options === "ambiguous") { found = "ambiguous"; break; }
          if (options.length && options.every((option) => (cart[index].modifiers || []).some((modifier) => modifier.option === option.option))) hits.push(index);
        }
        if (found !== "ambiguous") found = hits.length > 1 ? "ambiguous" : hits;
      }
      if (found !== "ambiguous" && found.length === 1) {
        const line = cart[found[0]];
        const item = input.menu.find((entry) => entry.id === line.itemId);
        return remember({
          kind: "accept",
          reply: replyFor(language, "accept", item?.name || line.itemId, quantity, ""),
          actions: [{ type: "update_item", itemId: line.itemId, quantity, lineIndex: found[0] }],
          pending: null,
        });
      }
    }
    const adding = takeQuantity(stripDiscourse(clause), file).quantity;
    if (/\b(?:remove|quita|quiten|cancel|sin|without)\b/.test(clause) && !adding) {
      const itemIds = [...new Set(cart.map((line) => line.itemId))];
      const groups: number[][] = [];
      let removalAmbiguous = false;
      for (const itemId of itemIds) {
        const item = input.menu.find((entry) => entry.id === itemId);
        if (!item) continue;
        const nameHit = [item.name, item.nameEs].some((name) => significant(name || "").some((token) => hasWord(clause, token)));
        const options = spokenOptions(item, clause, true);
        if (options === "ambiguous") { removalAmbiguous = true; break; }
        if (!nameHit && !options.length) continue;
        const indexes = cart.map((_, index) => index).filter((index) => cart[index].itemId === itemId && (!options.length ? nameHit : options.every((option) => (cart[index].modifiers || []).some((modifier) => modifier.option === option.option))));
        if (indexes.length) groups.push(indexes);
      }
      if (!removalAmbiguous && groups.length === 1) {
        const indexes = groups[0];
        if (indexes.length && indexes.length < cart.length) {
            return remember({
              kind: "accept",
              reply: language === "es" ? "Quité solo esa línea. Lo demás se queda." : "I removed only that line. The other line stays.",
              actions: [...indexes].sort((a, b) => b - a).map((index) => ({ type: "remove_item" as const, itemId: cart[index].itemId, quantity: Number(cart[index].quantity) || 1, lineIndex: index })),
              pending: null,
            });
        }
      }
    }
  }
  if (!isCartEdit(folded)) {
    const split = splitUnspecifiedChange(folded);
    const source = split ? split.add : folded;
    const stripped = stripDiscourse(source);
    if (stripped && (stripped !== source || split)) {
      const added = directOrder(input, file, language, stripped);
      if (added?.actions.length) {
        if (split && cart.length) {
          const target = earlierTarget(cart, input.menu, split.change);
          if (target === "ambiguous") {
            const listed = cart.map((line) => describeOwnLine(line, input.menu)).join(" ");
            const ask = language === "es"
              ? ` ¿Cuál línea anterior cambio? ${listed}`
              : ` Which earlier line should I change? ${listed}`;
            return remember({ ...added, reply: `${added.reply}${ask}`, pending: null });
          }
          if (target !== "none") {
            const named = describeOwnLine(cart[target.index], input.menu);
            const note = language === "es"
              ? ` No cambié la línea anterior porque no dijeron el cambio: ${named}.`
              : ` I did not change the earlier line because the change was not specified: ${named}.`;
            return remember({ ...added, reply: `${added.reply}${note}`, pending: null });
          }
        }
        return remember({ ...added, pending: null });
      }
    }
  }
  const replacementCues = [...file.replacementCues, "instead of ", "en vez de ", "replace ", "cambia ", "cambio "];
  const additiveCues = [...file.additiveCues, "also add ", "agrega ", "add ", "plus ", "mas "];
  const preserve = (): IntentDecision => remember({ ...clarify(language, "No cambié la orden.", "I did not change the order."), pending: null });
  const nounLines = (noun: string) => {
    const token = stem(noun);
    return cart.map((line, index) => {
      const item = input.menu.find((entry) => entry.id === line.itemId);
      const names = [item?.name, item?.nameEs, ...(item?.aliases || [])].filter((name): name is string => !!name);
      return names.some((name) => words(name).some((word) => stem(word) === token)) ? index : -1;
    }).filter((index) => index >= 0);
  };
  const excluded = folded.match(/\b(?:sin|without|no)\s+(?:any\s+|ningun\s+|ningunos\s+)?(tacos?|quesadillas?|tortas?|burritos?|gorditas?|sopes?|horchatas?)\b/);
  const refusal = /\b(?:do not put|do not add|don t put|don t add|no me ponga|no me pongas)\b/.test(folded);
  if (excluded || refusal) {
    const named = excluded?.[1] || folded.match(/\b(tacos?|quesadillas?|tortas?|burritos?|gorditas?|sopes?|horchatas?)\b/)?.[1] || "";
    const removes = (named ? nounLines(named) : []).sort((a, b) => b - a).map((index) => ({
      type: "remove_item" as const, itemId: cart[index].itemId, quantity: Number(cart[index].quantity) || 1, lineIndex: index,
    }));
    const rest = folded
      .replace(/\b(?:sin|without|no)\s+(?:any\s+|ningun\s+|ningunos\s+)?(?:tacos?|quesadillas?|tortas?|burritos?|gorditas?|sopes?|horchatas?)\b/g, " ")
      .replace(/\b(?:bueno|okay|ok|alright|just|solo|solamente|only|entonces|then|do|not|put|add|any|my|order|me|ponga|pongas)\b/g, " ")
      .replace(/\s+/g, " ").trim();
    const added = refusal ? null : directOrder(input, file, language, rest);
    if (refusal || added?.actions.length || removes.length) {
      return remember({
        kind: added?.actions.length ? (removes.length || cart.length ? "add" : "accept") : "accept",
        reply: added?.actions.length ? added.reply : (language === "es" ? "No lo agregué." : "I did not add it."),
        actions: [...removes, ...(added?.actions || [])],
        pending: null,
      });
    }
  }
  if (/\b(?:keeping its choices|keeping the choices|con las mismas opciones|las mismas opciones)\b/.test(folded)) {
    const qtyWord = folded.match(/\b(one|two|three|four|five|six|un|una|uno|dos|tres|cuatro|cinco|seis|[1-6])\b/);
    const quantity = qtyWord ? (file.quantities[qtyWord[1]] || Number(qtyWord[1])) : 0;
    const found = lineIndexes(cart, input.menu, folded);
    if (quantity && found !== "ambiguous" && found.length === 1) {
      const line = cart[found[0]];
      const item = input.menu.find((entry) => entry.id === line.itemId);
      return remember({
        kind: "accept",
        reply: replyFor(language, "accept", item?.name || line.itemId, quantity, ""),
        actions: [{ type: "update_item", itemId: line.itemId, quantity, lineIndex: found[0] }],
        pending: null,
      });
    }
  }
  const onlyAdd = folded.match(/\b(?:only add|solo agrega|solamente agrega)\s+(.+)$/);
  if (onlyAdd) {
    const anaphoric = /^(?:those|these|esos|esas)\b/.test(onlyAdd[1]);
    const added = directOrder(input, file, language, onlyAdd[1].replace(/^(?:those|these|esos|esas)\s+/, ""));
    const addAction = added?.actions.find((action) => action.type === "add_item");
    if (added?.actions.length && addAction) {
      const onCart = sameSpokenLine(cart, addAction);
      const witnessed = readAppliedRequest(cart).some((action) => sameAdd(action, addAction));
      const priorText = [...(input.history || [])].reverse().find((turn) => turn.role === "customer" || turn.role === "user")?.text || "";
      const prior = priorText ? addActionFromUtterance(input, file, language, priorText) : null;
      if (anaphoric && witnessed && onCart) {
        const line = cart.find((entry) => entry.itemId === addAction.itemId && Number(entry.quantity) === addAction.quantity && modifierKey(entry.modifiers) === modifierKey(addAction.modifiers));
        const named = line ? describeOwnLine(line, input.menu) : "";
        const reply = language === "es"
          ? `Eso ya está en la orden, no lo agregué otra vez.${named ? ` ${named}.` : ""}`
          : `That is already on the order, so I did not add it again.${named ? ` ${named}.` : ""}`;
        return remember({ kind: "accept", reply, actions: [], pending: null });
      }
      if (anaphoric && prior && sameAdd(prior, addAction) && !witnessed) {
        const unresolved = unresolvedConstraint(priorText, addAction, input.menu, file);
        const reply = language === "es"
          ? `No apliqué el pedido anterior, así que no lo tomé como ya cumplido.${unresolved ? ` Sin resolver: ${unresolved}.` : ""} No lo agregué.`
          : `I did not apply the previous request, so I did not treat it as fulfilled.${unresolved ? ` Unresolved: ${unresolved}.` : ""} I did not add it.`;
        return remember({ kind: "clarify", reply, actions: [], pending: null });
      }
      if (anaphoric && onCart && !witnessed) {
        const matches = cart.filter((entry) => entry.itemId === addAction.itemId && Number(entry.quantity) === addAction.quantity && modifierKey(entry.modifiers) === modifierKey(addAction.modifiers));
        const listed = matches.map((entry) => describeOwnLine(entry, input.menu)).join(" ");
        const reply = language === "es"
          ? `¿Cuál pedido son esos? No lo agregué y no tomé esta línea como esa referencia: ${listed}`
          : `Which order does those mean? I did not add it, and I did not decide this line is the one: ${listed}`;
        return remember({ kind: "clarify", reply, actions: [], pending: null });
      }
      return remember({ ...added, kind: cart.length ? "add" : "accept", pending: null });
    }
  }
  if (/\b(?:and|y)\s+(?:change|cambia|cambie|cambiar|swap|replace)\b/.test(folded)
    && /\b(?:earlier|anterior|first|primera)\b/.test(folded)
    && !/\b(?:change|cambia|cambie|swap|replace)\b.+\b(?:for|por|to)\b/.test(folded)) {
    return preserve();
  }

  if (isAvailability(folded, file)) {
    return remember({ kind: "availability", reply: replyFor(language, "availability", "", 0, ""), actions: [], pending: null });
  }
  if (pending) {
    const continued = continuePending(input, file, language, pending, folded);
    if (continued) return remember(continued);
  }
  const split = splitTargeted(folded);
  if (split) {
    const targeted = targetedReplacement(input, file, language, split.target, split.next);
    if (targeted) return remember(targeted);
  }
  const replacementCue = startsWithCue(folded, replacementCues);
  const additiveCue = startsWithCue(folded, additiveCues);
  const bareVerb = startsWithCue(folded, file.orderVerbs);
  if (!replacementCue && !additiveCue && !bareVerb) {
    const direct = directOrder(input, file, language, folded);
    if (direct) return remember(direct);
    const unclear = file.unclearQuantities.find((q) => folded === fold(q) || folded.endsWith(fold(q)));
    if (unclear && discussedItems(input, file).length) {
      return remember(clarify(language, "Necesito un número. No inventé la cantidad.", "I need a number. I did not invent the quantity."));
    }
    return null;
  }

  if (bareVerb && !replacementCue && !additiveCue) {
    const rest = folded.slice(bareVerb.length).trim();
    const taken = takeQuantity(rest, file);
    if (taken.unclear) {
      const leftover = taken.rest.replace(/^(?:of|de)\s+/, "");
      if (leftover && !matchItems(input.menu, leftover).items.length) return null;
      return clarify(language, "Necesito un número. No inventé la cantidad.", "I need a number. I did not invent the quantity.");
    }
    if (!taken.quantity) return null;
    const discussed = discussedItems(input, file).filter((item) => !declineOf(input.staffTexts || [], item));
    if (taken.rest) {
      const named = matchItems(input.menu, taken.rest);
      if (discussed.length !== 1 || named.items.length !== 1 || named.items[0].id !== discussed[0].id) return null;
    }
    if (discussed.length !== 1) return null;
    const item = discussed[0];
    const block = blocked(language, item, [{ type: "add_item", itemId: item.id, quantity: taken.quantity, modifiers: [] }]);
    if (block) return remember({ ...block, pending: null });
    const already = cart.filter((line) => line.itemId === item.id);
    const action: IntentAction = already.length
      ? { type: "update_item", itemId: item.id, quantity: taken.quantity, modifiers: already[already.length - 1].modifiers || [] }
      : { type: "add_item", itemId: item.id, quantity: taken.quantity, modifiers: [] };
    return remember({ kind: "accept", reply: replyFor(language, "accept", item.name || item.nameEs || item.id, taken.quantity, ""), actions: [action], pending: null });
  }

  const cue = replacementCue || additiveCue || "";
  const body = takeQuantity(folded.slice(cue.length).trim().replace(/^(?:add|agrega|agregar)\s+/, ""), file);
  const phrase = body.rest;
  if (!phrase) return null;
  const matched = matchItems(input.menu, phrase);
  if (matched.ambiguous || matched.items.length !== 1) return null;
  const item = matched.items[0];
  const optionWords = (item.modifierGroups || []).flatMap((group) => (group.options || []).map(optionName).flatMap((name) => significant(name)));
  if (hasLeftover(folded, [cue, "agrega", "agregar", "add", ...significant(item.name || ""), ...significant(item.nameEs || ""), ...optionWords], file)) return null;
  const options = spokenOptions(item, phrase);
  if (options === "ambiguous") return null;
  const sameCount = SAME_COUNT.test(folded);
  const quantity = body.unclear ? null : body.quantity ?? (sameCount && cart.length === 1 ? Number(cart[0].quantity) || null : null);
  if ((fold(additiveCue || "") === "plus" || fold(additiveCue || "") === "mas") && !quantity) return null;
  if (!quantity) {
    return remember({ ...clarify(language, "¿Cuántos? No cambié la orden.", "How many? I did not change the order."), pending: null });
  }
  const add: IntentAction = { type: "add_item", itemId: item.id, quantity, modifiers: options };
  const block = blocked(language, item, [add]);
  if (block) return remember({ ...block, pending: null });
  if (additiveCue) {
    return remember({ kind: "add", reply: replyFor(language, "add", item.name || item.id, quantity, ""), actions: [add], pending: null });
  }
  if (cart.length !== 1) {
    const names = cart.map((line) => input.menu.find((entry) => entry.id === line.itemId)?.name || line.itemId).join(", ");
    return remember({ ...clarify(language, names ? `Necesito saber cuál cambio: ${names}.` : "No hay una línea clara que cambiar.", names ? `I need to know which one to replace: ${names}.` : "There is no clear line to replace."), pending: null });
  }
  return remember({
    kind: "replace",
    reply: replyFor(language, "replace", item.name || item.id, quantity, ""),
    actions: [
      { type: "remove_item", itemId: cart[0].itemId, quantity: Number(cart[0].quantity) || 1, lineIndex: 0 },
      add,
    ],
    pending: null,
  });
}

function hasLeftover(folded: string, consumed: string[], file: IntentFile, ignore: Set<string> = new Set()): boolean {
  const gone = new Set(consumed.flatMap((piece) => fold(piece).split(" ")).map(stem).filter(Boolean));
  for (const word of Object.keys(file.quantities)) gone.add(stem(word));
  gone.add("same"); gone.add("number"); gone.add("mismo"); gone.add("misma"); gone.add("igual");
  return folded.split(" ").some((word) => {
    const token = stem(word);
    return token.length >= 4 && !STOP.has(token) && !gone.has(token) && !ignore.has(word) && !ignore.has(token);
  });
}

export function resolveConversationIntent(input: IntentInput): IntentDecision | null {
  const decision = decideConversationIntent(input);
  // A returned add is not yet a witness. The caller records one only if it applies the actions.
  // A turn with no add leaves no witness, including when the caller keeps this same cart.
  if (!decision?.actions?.some((action) => action.type === "add_item")) recordAppliedRequest(input.cart, []);
  return decision;
}

export function applyIntentCart<T extends { itemId: string; quantity: number; modifiers?: any[] }>(cart: T[], actions: IntentAction[]): T[] {
  const next = cart.map((line) => ({ ...line, modifiers: [...(line.modifiers || [])] }));
  for (const action of actions) {
    if (action.type === "add_item") next.push({ itemId: action.itemId, quantity: action.quantity, modifiers: action.modifiers || [] } as T);
    else if (action.type === "remove_item") {
      const indexed = action.lineIndex != null && next[action.lineIndex]?.itemId === action.itemId ? action.lineIndex : -1;
      const index = indexed >= 0 ? indexed : next.map((line) => line.itemId).lastIndexOf(action.itemId);
      if (index >= 0) next.splice(index, 1);
    }     else if (action.type === "update_item") {
      const indexed = action.lineIndex != null && next[action.lineIndex]?.itemId === action.itemId ? action.lineIndex : -1;
      const index = indexed >= 0 ? indexed : next.map((line) => line.itemId).lastIndexOf(action.itemId);
      if (index >= 0) next[index] = { ...next[index], quantity: action.quantity };
    }
  }
  recordAppliedRequest(next, actions);
  return next;
}
