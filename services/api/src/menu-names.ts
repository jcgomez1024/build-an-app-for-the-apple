import { readFileSync } from "node:fs";
import { applySharedAliases } from "./aliases.js";

// One spoken name for a catalog row. Runtime Square menus and the frozen phone menu both use it.
// Phone-only rows are the in-store variations already listed in this file. No network and no POS fetch.

// priceCents is the amount the phone repairs already speak when the catalog row has no price
// (Menudo SOLO Caldo $10, Aguacate FULL $4). These rows are not in site-catalog.json, so they are not $0.
export const IN_STORE_VARIATIONS = new Map<string, { name: string; aliases: string[]; priceCents: number }>([
  ["PYTW56MHJJGL6JKTZGSXGVWQ", { name: "Menudo SOLO Caldo", aliases: ["menudo solo caldo", "solo caldo menudo", "menudo de puro caldo", "menudo puro caldo", "menudo solamente caldo", "menudo sin carne", "puro caldo de menudo", "menudo broth only"], priceCents: 1000 }],
  ["QGR5AQTWVHNW347NOPAKX44U", { name: "Aguacate FULL", aliases: ["aguacate", "un aguacate", "aguacate entero", "aguacate completo", "whole avocado", "an avocado", "avocado"], priceCents: 400 }],
]);

function normalizeName(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** ASR and alias fold used before a required choice is compared with what was said. */
export function normalizeSpoken(value: string): string {
  let text = normalizeName(applySharedAliases(String(value || ""), "phone"));
  text = text.replace(/\benjombo\b/g, "combo");
  text = text.replace(/\bhechas a mano\b/g, "comal").replace(/\bhecha a mano\b/g, "comal").replace(/\bhechas mano\b/g, "comal").replace(/\bhecha mano\b/g, "comal");
  text = text.replace(/\bcarnita\b/g, "carnitas");
  text = text.replace(/\bnuditos\b/g, "gorditas").replace(/\bgorditos\b/g, "gorditas");
  text = text.replace(/\bcebrada\b/g, "deshebrada");
  text = text.replace(/\bcharrones\b/g, "chicharrones").replace(/\bcharron\b/g, "chicharron");
  text = text.replace(/\b(?:roast|rost|ros|rose)\b(?=\s+(?:y|con|and|e)\s+frijol)/g, "arroz");
  text = text.replace(/(\bcombo\s+(?:de|con)\s+)(?:roast|rost|ros|rose)\b/g, "$1arroz");
  return text.replace(/\s+/g, " ").trim();
}

export type OptionAlias = { optionId: string; name: string; aliases: string[] };

let optionAliasCache: OptionAlias[] | null = null;

/** Approved spoken names for catalog option ids. pastor and chicken are not approved aliases. */
export function loadOptionAliases(): OptionAlias[] {
  if (optionAliasCache) return optionAliasCache;
  try {
    const file = JSON.parse(readFileSync(new URL("../data/option-aliases.json", import.meta.url), "utf8"));
    optionAliasCache = Array.isArray(file.options) ? file.options : [];
  } catch {
    optionAliasCache = [];
  }
  return optionAliasCache;
}

/** A fused display name such as Alpastor yields the same token as "al pastor" or "el pastor". */
export function compoundForms(word: string): string[] {
  const token = normalizeName(word).replace(/[^a-z0-9]/g, "");
  if ((token.startsWith("al") || token.startsWith("el")) && token.length >= 6) {
    const rest = token.slice(2);
    if (rest.length >= 4) return [rest];
  }
  return [];
}

export function optionAliasWords(token: string): string[] {
  const folded = normalizeName(token);
  const rows = loadOptionAliases().filter((row) => (row.aliases || []).some((alias) => normalizeName(alias) === folded));
  const words = new Set<string>();
  for (const row of rows) {
    words.add(folded);
    for (const word of normalizeName(row.name || "").split(" ")) if (word.length >= 4) words.add(word);
  }
  return [...words];
}

/** One fold for a required choice. The cart meat list and the hold both use it. */
export function spokenChoiceWords(value: string): Set<string> {
  let spoken = normalizeSpoken(value);
  spoken = spoken.replace(/\btreinta y dos\s+(?:onzas?|ounces?|oz)\b/g, "32oz");
  spoken = spoken.replace(/\bdieciseis\s+(?:onzas?|ounces?|oz)\b/g, "16oz");
  spoken = spoken.replace(/\bveinticuatro\s+(?:onzas?|ounces?|oz)\b/g, "24oz");
  spoken = spoken.replace(/\bveinte\s+(?:onzas?|ounces?|oz)\b/g, "20oz");
  spoken = spoken.replace(/\b(\d+)\s+(?:onzas?|ounces?|oz)\b/g, "$1oz");
  const hits = new Set(spoken.split(" ").filter(Boolean));
  const add = (...words: string[]) => words.forEach((word) => hits.add(word));
  for (const word of [...hits]) {
    for (const part of compoundForms(word)) hits.add(part);
    for (const extra of optionAliasWords(word)) hits.add(extra);
  }
  if (/\bduros?\b/.test(spoken) || /\bchicharron/.test(spoken)) add("duro", "chicharron");
  if (/\bdorad/.test(spoken)) add("dorada");
  if (/\bhomemade\b/.test(spoken) || /\bcomal\b/.test(spoken)) add("comal", "homemade");
  if (/\bmaiz\b/.test(spoken) || /\bcorn\b/.test(spoken)) add("corn", "comal", "maiz");
  if (/\bharina\b/.test(spoken) || /\bflour\b/.test(spoken)) add("harina", "flour");
  if (/\bstreet\b/.test(spoken) || /\btaquer/.test(spoken)) add("street", "taquera");
  if (/\bgrande\b/.test(spoken) || /\blarge\b/.test(spoken) || /\bbig\b/.test(spoken)) add("grande", "big", "large");
  return hits;
}

export function isDrinkProduct(productName: string): boolean {
  return /bebida|drink|aguas?\s+frescas?|jarrito|coca|pepsi|soda|mineral/i.test(productName);
}

/** The name a caller hears. Drinks use the variation. Food keeps the product plus the variation. */
export function spokenItemName(productName: string, variationName: string): string {
  const variation = String(variationName || "").trim();
  const product = String(productName || "").trim();
  if (!variation || /^regular$/i.test(variation) || normalizeName(variation) === normalizeName(product)) return product;
  if (!isDrinkProduct(product)) return `${product} ${variation}`.trim();
  const spoken = variation.replace(/\bOrchata\b/i, "Horchata");
  if (/aguas?\s+frescas?/i.test(productName)) return `Agua Fresca ${spoken}`.trim();
  if (/^jarrito/i.test(productName)) return `Jarrito ${spoken}`.trim();
  return spoken || productName;
}

export function spokenDrinkAliases(productName: string, variationName: string): string[] {
  const variation = normalizeName(variationName);
  const product = normalizeName(productName);
  const out = new Set<string>();
  const add = (...values: string[]) => values.forEach((value) => { const n = normalizeName(value); if (n.length > 2) out.add(n); });
  if (/\baguas? frescas?\b/.test(product)) {
    const flavor = variation.replace(/\b\d+\s*oz\b/g, "").trim();
    const spoken = flavor.replace(/\borchata\b/g, "horchata");
    for (const name of new Set([flavor, spoken])) add(name, `${name}s`, `agua de ${name}`, `agua fresca ${name}`, `agua fresca de ${name}`, `${name} grande`, `${name} large`, `large ${name}`);
  } else if (/\bjarrito\b/.test(product)) {
    for (const flavor of variationName.split("/").map((part) => part.trim()).filter(Boolean)) add(`jarrito ${flavor}`, `jarrito de ${flavor}`, `jarritos ${flavor}`, `${flavor} jarrito`);
  } else if (/\bmineral\b/.test(variation)) {
    add("mineral water", "agua mineral", "sparkling water", "topo chico", "mineral");
  } else if (/\bagua\b|\bwater\b/.test(variation)) {
    add("water", "a water", "waters", "water bottle", "bottle of water", "bottled water", "agua", "botella de agua");
  } else {
    add(variation, `${variation}s`);
    if (/\bcoca cola\b/.test(variation)) add(variation.replace("coca cola", "coke"), variation.replace("coca cola", "coca"));
  }
  return [...out];
}

/** "en aceite" is how callers name a dorada. It is an alias of that catalog row, not a separate phrase rule. */
export function spokenFoodAliases(name: string): string[] {
  const folded = normalizeName(name);
  if (/\bdorada\b|\bfrita\b/.test(folded)) return ["en aceite", "aceite"];
  return [];
}

/** Labels used to match a caller word. A runtime row has name and aliases. A frozen row also has variationName. */
export function spokenLabels(item: { name?: string; nameEs?: string; aliases?: string[]; variationName?: string }): string[] {
  const labels = [item.name, item.nameEs, ...(item.aliases || []), ...spokenFoodAliases(`${item.name || ""} ${item.variationName || ""}`)];
  if (item.variationName) labels.unshift(spokenItemName(item.name || "", item.variationName));
  return [...new Set(labels.filter((label): label is string => !!label && label.trim().length > 0 && !/^regular$/i.test(label)))];
}

const CATALOG_STOP = new Set(["with", "para", "from", "online", "regular", "homemade", "street", "combo", "meal", "pack", "full", "half", "solo", "only", "tortilla", "tortillas", "corn", "flour", "order", "orden", "grande", "large", "small", "chica", "bottle", "botella", "bote", "platter", "platillo", "pollo", "chicken", "bistec", "steak", "asada", "pastor", "alpastor", "carne", "meat", "cheese", "taco", "tacos", "quesadilla", "quesadillas", "dorada", "doradas", "preparada", "preparadas", "deluxe", "comal", "harina", "taquero", "taquera", "rice", "beans", "arroz", "frijoles", "frijol", "chorizo"]);

export type CatalogMention = { id: string; label: string };

/** Catalog rows named in the text. A shorter row wins over a longer one that only adds unspoken words (diet vs regular). */
export function catalogMentions(text: string, items: Array<{ id: string; name?: string; nameEs?: string; aliases?: string[]; variationName?: string }>): CatalogMention[] {
  const words = new Set(normalizeName(text).split(" ").filter(Boolean));
  const hits: Array<CatalogMention & { extra: number; shared: string[] }> = [];
  for (const item of items) {
    const labels = spokenLabels(item);
    let matched = false;
    for (const raw of labels) {
      const tokens = normalizeName(raw).split(" ").filter((token) => token.length >= 4 && !CATALOG_STOP.has(token));
      if (tokens.length && tokens.every((token) => words.has(token))) matched = true;
    }
    if (!matched) continue;
    const nameTokens = normalizeName(item.name || "").split(" ").filter((token) => token.length >= 4 && !CATALOG_STOP.has(token));
    hits.push({
      id: item.id,
      label: item.name || item.id,
      extra: nameTokens.filter((token) => !words.has(token)).length,
      shared: nameTokens.filter((token) => words.has(token)),
    });
  }
  return hits
    .filter((hit) => !hits.some((other) => other.id !== hit.id && other.extra < hit.extra && other.shared.some((token) => hit.shared.includes(token))))
    .map(({ id, label }) => ({ id, label }));
}

export type SpokenCatalogMatch = {
  id: string;
  label: string;
  product: string;
  options: Array<{ step: string; option: string }>;
};

function wordSet(text: string): Set<string> {
  return new Set(normalizeName(text).split(" ").filter((token) => token.length >= 4 && !CATALOG_STOP.has(token)));
}

function looseWords(text: string): Set<string> {
  const skip = new Set(["with", "para", "from", "online", "regular", "that", "this", "your", "have", "want", "bien", "esta"]);
  return new Set(normalizeName(text).split(" ").filter((token) => token.length >= 4 && !skip.has(token)));
}

function optionTokens(name: string): string[] {
  const skip = new Set(["with", "para", "from", "online", "regular", "only", "solo", "full", "half", "side", "extra", "and"]);
  return normalizeName(name).split(" ").filter((token) => token.length >= 4 && !skip.has(token));
}

function tokenHit(token: string, words: Set<string>): boolean {
  if (words.has(token)) return true;
  if (token.endsWith("s") && words.has(token.slice(0, -1))) return true;
  return words.has(`${token}s`);
}

function nameTokens(name: string): string[] {
  return normalizeName(name).split(" ").filter((token) => token.length >= 4 && !CATALOG_STOP.has(token));
}

/** True when two catalog names share a dish word, so a second product would repeat the line. */
export function sameSpokenDish(left: string, right: string): boolean {
  const other = new Set(nameTokens(right));
  return nameTokens(left).some((token) => tokenHit(token, other));
}

function editDistance(left: string, right: string): number {
  const a = left;
  const b = right;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = a[i - 1] === b[j - 1] ? prev : Math.min(prev, row[j - 1], row[j]) + 1;
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

function isPlural(left: string, right: string): boolean {
  return left === right || left === `${right}s` || right === `${left}s` || left === `${right}es` || right === `${left}es`;
}

/** "libra" / "media libra" are the spoken sizes of a catalog lb / half-lb row. */
export function spokenSizeWords(text: string): string[] {
  const folded = normalizeName(text);
  if (/\bmedia\s+libra\b|\bhalf\s+(?:a\s+)?pound\b/.test(folded)) return ["half", "lb"];
  if (/\blibras?\b|\bpounds?\b|\blb\b/.test(folded)) return ["lb"];
  return [];
}

/** family = same dish word. garbled = one name swallows the other (quesabirria vs birria), not a plural. */
export function nameRelation(left: string, right: string): "garbled" | "family" | null {
  const a = nameTokens(left);
  const b = nameTokens(right);
  let family = false;
  let garbled = false;
  for (const leftToken of a) for (const rightToken of b) {
    if (isPlural(leftToken, rightToken)) family = true;
    else if (leftToken.length >= 5 && rightToken.length >= 5 && (leftToken.includes(rightToken) || rightToken.includes(leftToken))) garbled = true;
  }
  if (garbled) return "garbled";
  if (family || sameSpokenDish(left, right)) return "family";
  return null;
}

/** One catalog row for a dish the text names. Variations of the same product collapse to the closest row. A tie between products adds nothing. */
export function matchSpokenCatalog(
  dishText: string,
  optionText: string,
  items: Array<{ id: string; name?: string; squareCatalogObjectId?: string; modifierGroups?: Array<{ name?: string; options?: Array<string | { name?: string }> }> }>,
): SpokenCatalogMatch[] {
  const dishWords = wordSet(dishText);
  const optionWords = looseWords(`${dishText} ${optionText}`);
  if (!dishWords.size) return [];
  const ranked = items.map((item) => {
    const tokens = nameTokens(item.name || "");
    const nameWords = new Set(optionTokens(item.name || ""));
    const matched = tokens.filter((token) => tokenHit(token, dishWords));
    const options: Array<{ step: string; option: string }> = [];
    let optionHits = 0;
    for (const group of item.modifierGroups || []) {
      let best: { name: string; n: number } | null = null;
      for (const raw of group.options || []) {
        const name = typeof raw === "string" ? raw : raw?.name || "";
        const n = optionTokens(name).filter((token) => tokenHit(token, optionWords) && !tokenHit(token, nameWords)).length;
        if (n > 0 && (!best || n > best.n)) best = { name, n };
      }
      if (!best) continue;
      options.push({ step: group.name || "", option: best.name });
      optionHits += best.n;
    }
    return {
      id: item.id,
      label: item.name || item.id,
      product: item.squareCatalogObjectId || item.id,
      options,
      matched: matched.length,
      head: matched.some((token) => tokenHit(token, new Set(tokens.slice(0, 1)))) ? 1 : 0,
      extra: normalizeName(item.name || "").split(" ").filter((token) => token.length >= 3 && !tokenHit(token, dishWords)).length,
      optionHits,
    };
  }).filter((row) => row.matched > 0);
  const bestByProduct = new Map<string, typeof ranked[number]>();
  for (const row of ranked) {
    const have = bestByProduct.get(row.product);
    const better = !have || row.matched + row.optionHits > have.matched + have.optionHits || (row.matched + row.optionHits === have.matched + have.optionHits && (row.head > have.head || (row.head === have.head && row.extra < have.extra)));
    if (better) bestByProduct.set(row.product, row);
  }
  const products = [...bestByProduct.values()].sort((a, b) => (b.matched + b.optionHits) - (a.matched + a.optionHits) || b.head - a.head || a.extra - b.extra);
  if (!products.length) return [];
  const top = products[0];
  const tied = products.some((row) => row.product !== top.product && row.matched + row.optionHits === top.matched + top.optionHits && row.head === top.head && row.extra === top.extra);
  if (tied) return [];
  return [{ id: top.id, label: top.label, product: top.product, options: top.options }];
}
