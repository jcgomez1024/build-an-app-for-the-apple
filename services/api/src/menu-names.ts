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
