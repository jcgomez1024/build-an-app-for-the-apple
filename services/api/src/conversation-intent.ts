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
};

export type IntentDecision = {
  kind: "availability" | "accept" | "replace" | "add" | "clarify";
  reply: string;
  actions: IntentAction[];
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

function spokenOptions(item: IntentMenuItem, phrase: string): Array<{ step: string; option: string }> | "ambiguous" {
  const attached: Array<{ step: string; option: string }> = [];
  for (const group of item.modifierGroups || []) {
    const hits = (group.options || []).map(optionName).filter((name) => significant(name).some((token) => hasWord(phrase, token)) || hasWord(phrase, fold(name)));
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

function matchItems(menu: IntentMenuItem[], phrase: string): { items: IntentMenuItem[]; ambiguous: boolean } {
  const strict = menu.filter((item) => strictMatch(item, phrase));
  if (strict.length === 1) return { items: strict, ambiguous: false };
  if (strict.length > 1) return { items: strict, ambiguous: true };
  const loose = menu.filter((item) => headMatch(item, phrase));
  return { items: loose, ambiguous: loose.length > 1 };
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
  if (kind === "availability") return es ? "Sí. No lo agregué." : "Yes. I did not add it.";
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

/**
 * Decide a whole short turn. Returns null when this is not one of the conversation-intent
 * shapes, so the existing parser keeps the turn.
 */
export function resolveConversationIntent(input: IntentInput): IntentDecision | null {
  const file = loadConversationIntent();
  if (!file || !Array.isArray(input.menu) || !input.menu.length) return null;
  const folded = fold(input.transcript);
  if (!folded) return null;
  const language = input.language === "en" ? "en" : "es";
  const cart = input.cart || [];
  const distinct = [...new Map(cart.map((line) => [line.itemId, line])).values()];

  if (isAvailability(folded, file)) {
    return { kind: "availability", reply: replyFor(language, "availability", "", 0, ""), actions: [] };
  }
  const replacementCue = startsWithCue(folded, file.replacementCues);
  const additiveCue = startsWithCue(folded, file.additiveCues);
  const bareVerb = startsWithCue(folded, file.orderVerbs);
  if (!replacementCue && !additiveCue && !bareVerb) {
    const unclear = file.unclearQuantities.find((q) => folded === fold(q) || folded.endsWith(fold(q)));
    if (unclear && discussedItems(input, file).length) {
      return clarify(language, "Necesito un número. No inventé la cantidad.", "I need a number. I did not invent the quantity.");
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
    if (block) return block;
    const already = cart.filter((line) => line.itemId === item.id);
    const action: IntentAction = already.length
      ? { type: "update_item", itemId: item.id, quantity: taken.quantity, modifiers: already[already.length - 1].modifiers || [] }
      : { type: "add_item", itemId: item.id, quantity: taken.quantity, modifiers: [] };
    return { kind: "accept", reply: replyFor(language, "accept", item.name || item.nameEs || item.id, taken.quantity, ""), actions: [action] };
  }

  const cue = replacementCue || additiveCue || "";
  const body = takeQuantity(folded.slice(cue.length).trim(), file);
  const phrase = body.rest;
  if (!phrase) return null;
  const matched = matchItems(input.menu, phrase);
  if (matched.ambiguous || matched.items.length !== 1) return null;
  const item = matched.items[0];
  const optionWords = (item.modifierGroups || []).flatMap((group) => (group.options || []).map(optionName).flatMap((name) => significant(name)));
  if (hasLeftover(folded, [cue, ...significant(item.name || ""), ...significant(item.nameEs || ""), ...optionWords], file)) return null;
  const options = spokenOptions(item, phrase);
  if (options === "ambiguous") return null;
  const sameCount = SAME_COUNT.test(folded);
  const quantity = body.unclear ? null : body.quantity ?? (sameCount && distinct.length === 1 ? Number(distinct[0].quantity) || null : null);
  if (!quantity) {
    return clarify(language, "¿Cuántos? No cambié la orden.", "How many? I did not change the order.");
  }
  const add: IntentAction = { type: "add_item", itemId: item.id, quantity, modifiers: options };
  const block = blocked(language, item, [add]);
  if (block) return block;
  if (additiveCue) {
    return { kind: "add", reply: replyFor(language, "add", item.name || item.id, quantity, ""), actions: [add] };
  }
  if (distinct.length !== 1) {
    const names = distinct.map((line) => input.menu.find((entry) => entry.id === line.itemId)?.name || line.itemId).join(", ");
    return clarify(language, names ? `Necesito saber cuál cambio: ${names}.` : "No hay una línea clara que cambiar.", names ? `I need to know which one to replace: ${names}.` : "There is no clear line to replace.");
  }
  return {
    kind: "replace",
    reply: replyFor(language, "replace", item.name || item.id, quantity, ""),
    actions: [
      { type: "remove_item", itemId: distinct[0].itemId, quantity: Number(distinct[0].quantity) || 1 },
      add,
    ],
  };
}

function hasLeftover(folded: string, consumed: string[], file: IntentFile): boolean {
  const gone = new Set(consumed.flatMap((piece) => fold(piece).split(" ")).map(stem).filter(Boolean));
  for (const word of Object.keys(file.quantities)) gone.add(stem(word));
  gone.add("same"); gone.add("number"); gone.add("mismo"); gone.add("misma"); gone.add("igual");
  return folded.split(" ").some((word) => {
    const token = stem(word);
    return token.length >= 4 && !STOP.has(token) && !gone.has(token);
  });
}

export function applyIntentCart<T extends { itemId: string; quantity: number; modifiers?: any[] }>(cart: T[], actions: IntentAction[]): T[] {
  const next = cart.map((line) => ({ ...line, modifiers: [...(line.modifiers || [])] }));
  for (const action of actions) {
    if (action.type === "add_item") next.push({ itemId: action.itemId, quantity: action.quantity, modifiers: action.modifiers || [] } as T);
    else if (action.type === "remove_item") {
      const index = next.map((line) => line.itemId).lastIndexOf(action.itemId);
      if (index >= 0) next.splice(index, 1);
    } else if (action.type === "update_item") {
      const index = next.map((line) => line.itemId).lastIndexOf(action.itemId);
      if (index >= 0) next[index] = { ...next[index], quantity: action.quantity };
    }
  }
  return next;
}
