// Per-turn catalog slice for a shadow model prompt. Not called from registerTwilioRoutes.
// Matching uses spoken labels and the approved option-alias file. It does not add aliases.
// Token counts elsewhere use UTF-8 bytes / 4. That is not a BPE tokenizer.
import { readFileSync } from "node:fs";
import { applySharedAliases } from "./aliases.js";
import { spokenLabels } from "./menu-names.js";

export type SliceOption = { id?: string; name: string };
export type SliceGroup = { id?: string; name: string; options: SliceOption[] };
export type SliceItem = { id: string; name?: string; nameEs?: string; groups: SliceGroup[] };
export type NameOnlyItem = { id: string; name?: string; nameEs?: string };

export type CatalogItem = {
  id: string;
  name?: string;
  nameEs?: string;
  aliases?: string[];
  variationName?: string;
  modifierGroups?: Array<{ id?: string; name?: string; minSelections?: number; maxSelections?: number; options?: Array<string | { id?: string; name?: string }> }>;
};

export type SliceCartLine = {
  itemId: string;
  modifiers?: Array<{ step?: string; option?: string; optionId?: string }>;
};

export type MenuSlice = {
  matched: SliceItem[];
  /** Full item name list, no groups or options. Used when matched is empty. */
  fallbackNames: NameOnlyItem[];
};

export type CartAction = {
  type: "add_item" | "update_item" | "remove_item";
  item_id: string;
  quantity: number;
  option_ids?: string[];
  line_index?: number;
};

export type SyntheticTurn = {
  id: string;
  synthetic: true;
  verified: true;
  language: "en" | "es";
  utterance: string;
  pendingQuestion?: string;
  cart?: SliceCartLine[];
  actions: CartAction[];
};

type OptionAlias = { optionId: string; aliases: string[] };

const ACTION_TYPES = ["add_item", "update_item", "remove_item"] as const;

function fold(value: string): string {
  return String(value || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function wordsOf(value: string): string[] {
  return fold(value).split(" ").filter((word) => word.length >= 4);
}

function stems(word: string): string[] {
  const out = [word];
  if (word.endsWith("es") && word.length > 5) out.push(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 4) out.push(word.slice(0, -1));
  return out;
}

function hits(label: string, words: Set<string>): boolean {
  return wordsOf(label).some((token) => stems(token).some((form) => words.has(form)));
}

function optionName(option: string | { id?: string; name?: string }): string {
  return typeof option === "string" ? option : option?.name || "";
}

function optionId(option: string | { id?: string; name?: string }): string | undefined {
  return typeof option === "object" && option?.id ? String(option.id) : undefined;
}

export function loadOptionAliases(): OptionAlias[] {
  try {
    const file = JSON.parse(readFileSync(new URL("../data/option-aliases.json", import.meta.url), "utf8"));
    return Array.isArray(file?.options) ? file.options : [];
  } catch {
    return [];
  }
}

function expandedWords(text: string): Set<string> {
  const spoken = applySharedAliases(text, "phone");
  return new Set(wordsOf(spoken).flatMap(stems));
}

function aliasHits(optionIdValue: string | undefined, name: string, words: Set<string>, aliases: OptionAlias[]): boolean {
  if (hits(name, words)) return true;
  return aliases.some((row) => row.optionId === optionIdValue && (row.aliases || []).some((alias) => words.has(fold(alias))));
}

export function sliceMenu(input: {
  menu: CatalogItem[];
  utterance: string;
  pendingQuestion?: string;
  cart?: SliceCartLine[];
  aliases?: OptionAlias[];
}): MenuSlice {
  const menu = input.menu || [];
  const aliases = input.aliases || loadOptionAliases();
  const words = expandedWords(`${input.utterance || ""} ${input.pendingQuestion || ""}`);
  const fallbackNames = menu.map((item) => ({ id: item.id, name: item.name, nameEs: item.nameEs }));
  const cartIds = new Set((input.cart || []).map((line) => line.itemId));
  const matched: SliceItem[] = [];
  for (const item of menu) {
    const labels = spokenLabels(item);
    const named = labels.some((label) => hits(label, words)) || cartIds.has(item.id);
    if (!named) continue;
    const selected = (input.cart || []).filter((line) => line.itemId === item.id).flatMap((line) => line.modifiers || []);
    const groups: SliceGroup[] = [];
    for (const group of item.modifierGroups || []) {
      const options = (group.options || []).map((choice) => ({ id: optionId(choice), name: optionName(choice) })).filter((choice) => choice.name);
      const kept = options.filter((choice) => aliasHits(choice.id, choice.name, words, aliases) || selected.some((mod) => (mod.optionId && mod.optionId === choice.id) || fold(mod.option || "") === fold(choice.name)));
      const groupNamed = hits(group.name || "", words) || selected.some((mod) => fold(mod.step || "") === fold(group.name || ""));
      if (!kept.length && !groupNamed) continue;
      groups.push({ id: group.id, name: group.name || "", options: kept });
    }
    matched.push({ id: item.id, name: item.name, nameEs: item.nameEs, groups });
  }
  return { matched: rankByStyleWords(menu, matched, words), fallbackNames };
}

/** Style words are the catalog name tokens that are not shared by every item in a matched cluster. No separate stop list. */
function rankByStyleWords(menu: CatalogItem[], matched: SliceItem[], words: Set<string>): SliceItem[] {
  if (matched.length <= 1) return matched;
  const byId = new Map(menu.map((item) => [item.id, item]));
  const tokensOf = (id: string) => {
    const item = byId.get(id);
    const labels = item ? spokenLabels(item) : [];
    return [...new Set(labels.flatMap((label) => wordsOf(label).flatMap(stems)))];
  };
  const parent = matched.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const share = (left: string[], right: string[]) => left.some((token) => right.includes(token));
  for (let i = 0; i < matched.length; i++) {
    const left = tokensOf(matched[i].id);
    for (let j = i + 1; j < matched.length; j++) if (share(left, tokensOf(matched[j].id))) parent[find(j)] = find(i);
  }
  const keep = new Set<string>();
  const clusters = new Map<number, SliceItem[]>();
  matched.forEach((item, index) => {
    const root = find(index);
    clusters.set(root, [...(clusters.get(root) || []), item]);
  });
  for (const cluster of clusters.values()) {
    if (cluster.length === 1) { keep.add(cluster[0].id); continue; }
    const sets = cluster.map((item) => new Set(tokensOf(item.id)));
    const common = [...sets[0]].filter((token) => sets.every((set) => set.has(token)));
    const score = (item: SliceItem) => [...tokensOf(item.id)].filter((token) => !common.includes(token)).reduce((total, token) => total + (words.has(token) ? 1 : -1), 0);
    const best = Math.max(...cluster.map(score));
    for (const item of cluster) if (score(item) === best) keep.add(item.id);
  }
  return matched.filter((item) => keep.has(item.id));
}

/** Catalog text the prompt would send. Matched items when any exist, otherwise the name list. */
export function promptCatalog(slice: MenuSlice): unknown {
  if (slice.matched.length) return slice.matched;
  return slice.fallbackNames;
}

export function fullCatalogPrompt(menu: CatalogItem[]): unknown {
  return (menu || []).map((item) => ({
    id: item.id,
    name: item.name,
    nameEs: item.nameEs,
    groups: (item.modifierGroups || []).map((group) => ({
      id: group.id,
      name: group.name,
      options: (group.options || []).map((choice) => ({ id: optionId(choice), name: optionName(choice) })),
    })),
  }));
}

/** UTF-8 byte length divided by 4. Not a BPE tokenizer. */
export function approxTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function idsOf(slice: MenuSlice): { items: string[]; options: string[] } {
  const source = slice.matched.length ? slice.matched : [];
  const items = source.map((item) => item.id);
  const options = source.flatMap((item) => item.groups.flatMap((group) => group.options.map((option) => option.id).filter((id): id is string => !!id)));
  return { items: [...new Set(items)], options: [...new Set(options)] };
}

export function cartActionSchema(slice: MenuSlice): Record<string, unknown> {
  const ids = idsOf(slice);
  const itemEnum = ids.items.length ? ids.items : slice.fallbackNames.map((item) => item.id);
  const properties: Record<string, unknown> = {
    type: { enum: [...ACTION_TYPES] },
    item_id: { enum: itemEnum },
    quantity: { type: "integer", minimum: 1 },
    line_index: { type: "integer", minimum: 0 },
  };
  if (ids.options.length) properties.option_ids = { type: "array", items: { enum: ids.options } };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["actions"],
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "item_id", "quantity"],
          properties,
        },
      },
    },
  };
}

export type Validation =
  | { ok: true }
  | { ok: false; route: "hold"; reviewReason: "confirmar"; errors: string[] };

type GroupIndex = { id?: string; name: string; min: number; max: number; options: Set<string> };

function menuIndex(menu: CatalogItem[]) {
  const items = new Set<string>();
  const optionItem = new Map<string, Set<string>>();
  const groups = new Map<string, GroupIndex[]>();
  for (const item of menu || []) {
    items.add(item.id);
    const itemGroups: GroupIndex[] = [];
    for (const group of item.modifierGroups || []) {
      const options = new Set<string>();
      for (const choice of group.options || []) {
        const id = optionId(choice);
        if (!id) continue;
        options.add(id);
        const owners = optionItem.get(id) || new Set<string>();
        owners.add(item.id);
        optionItem.set(id, owners);
      }
      itemGroups.push({ id: group.id, name: group.name || "", min: Number(group.minSelections) || 0, max: Number(group.maxSelections) || 0, options });
    }
    groups.set(item.id, itemGroups);
  }
  return { items, optionItem, groups };
}

/** Reject an item or option id that is not on this menu, or an option from another item. Hold is `confirmar`. */
export function validateCartActions(actions: unknown, menu: CatalogItem[]): Validation {
  const errors: string[] = [];
  if (!Array.isArray(actions)) return { ok: false, route: "hold", reviewReason: "confirmar", errors: ["actions"] };
  const index = menuIndex(menu);
  for (const action of actions) {
    const row = action as Partial<CartAction>;
    if (!ACTION_TYPES.includes(row.type as typeof ACTION_TYPES[number])) errors.push("type");
    if (!row.item_id || !index.items.has(row.item_id)) errors.push(`item:${row.item_id || ""}`);
    if (!Number.isInteger(row.quantity) || Number(row.quantity) < 1) errors.push("quantity");
    for (const id of row.option_ids || []) {
      const owners = index.optionItem.get(id);
      if (!owners) errors.push(`option:${id}`);
      else if (row.item_id && !owners.has(row.item_id)) errors.push(`group:${id}`);
    }
    if (row.type === "add_item" && row.item_id && index.items.has(row.item_id)) {
      const chosen = new Set(row.option_ids || []);
      for (const group of index.groups.get(row.item_id) || []) {
        const count = [...group.options].filter((id) => chosen.has(id)).length;
        if (group.min >= 1 && count < group.min) errors.push(`required:${group.name}`);
        if (group.max >= 1 && count > group.max) errors.push(`limit:${group.name}`);
      }
    }
  }
  return errors.length ? { ok: false, route: "hold", reviewReason: "confirmar", errors } : { ok: true };
}

export function loadMenuJson(path: string): CatalogItem[] {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed : parsed.items || parsed.menu || [];
}

function overlap(left: MenuSlice, right: MenuSlice): number {
  const ids = new Set(right.matched.map((item) => item.id));
  return left.matched.filter((item) => ids.has(item.id)).length;
}

/** Reviewer-approved few-shot cap. Not a house menu default. */
export const FEW_SHOT_CAP = 3;

/** Verified synthetic turns only. The cap defaults to the approved value of 3. */
export function fewShotBlock(turns: SyntheticTurn[], query: { menu: CatalogItem[]; utterance: string; pendingQuestion?: string; cart?: SliceCartLine[] }, cap = FEW_SHOT_CAP): SyntheticTurn[] {
  if (!Number.isInteger(cap) || cap < 0) throw new Error("few-shot cap must be a non-negative integer");
  const wanted = sliceMenu(query);
  return turns
    .filter((turn) => turn.synthetic === true && turn.verified === true)
    .map((turn) => ({ turn, score: overlap(sliceMenu({ menu: query.menu, utterance: turn.utterance, pendingQuestion: turn.pendingQuestion, cart: turn.cart }), wanted) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.turn.id.localeCompare(b.turn.id))
    .slice(0, cap)
    .map((row) => row.turn);
}

export function loadSyntheticFewShots(): SyntheticTurn[] {
  const rows = JSON.parse(readFileSync(new URL("../data/synthetic-few-shot.json", import.meta.url), "utf8"));
  return (Array.isArray(rows) ? rows : []).filter((row: SyntheticTurn) => row?.synthetic === true && row?.verified === true);
}
