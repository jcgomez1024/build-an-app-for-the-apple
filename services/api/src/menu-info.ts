// Answers "what's on the menu / what do you recommend / what combos do you have" the way
// cocinaelvis.com shows it: "Most popular" first, then the menu categories.
// Data comes from the site's own public storefront feed (read-only), cached for 10 minutes.

type Language = "en" | "es";
type InfoItem = { name: string; priceLow: number; priceHigh: number; popularity: number };
type InfoCategory = { key: string; name: string; items: InfoItem[] };
type MenuInfo = { popular: InfoItem[]; categories: InfoCategory[] };

const STORE = "https://www.cocinaelvis.com/app/store/api/v28/editor/users/129352762/sites/426206690500291198";
const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; info: MenuInfo } | null = null;

// Site category name -> key + how Elvi says it. Order = order on the website.
const CATEGORY_DEFS: Array<{ key: string; match: RegExp; en: string; es: string; words: RegExp }> = [
  { key: "combos", match: /^elvis combos$/i, en: "combos", es: "combos", words: /\bcombos?\b/ },
  { key: "meals", match: /^elvis meals$/i, en: "pack meals", es: "paquetes", words: /\b(meals?|packs?|paquetes?|pack meals?)\b/ },
  { key: "especial", match: /^especial del dia/i, en: "specials of the day", es: "especiales del día", words: /\b(especial(es)?|specials?|del dia|day special)\b/ },
  { key: "weekend", match: /^sabado \/ domingo/i, en: "weekend specials", es: "especiales de fin de semana", words: /\b(sabado|domingo|weekend|fin de semana)\b/ },
  { key: "enchiladas", match: /^enchiladas/i, en: "enchiladas and steamed tacos", es: "enchiladas y tacos al vapor", words: /\b(enchiladas?|al vapor|steamed)\b/ },
  { key: "platters", match: /^fiesta platters$/i, en: "fiesta platters", es: "charolas para fiesta", words: /\b(platters?|fiesta|charolas?|para fiesta|catering)\b/ },
  { key: "drinks", match: /^bebidas/i, en: "drinks", es: "bebidas", words: /\b(drinks?|bebidas?|aguas?|tomar|refrescos?|sodas?)\b/ },
  { key: "sides", match: /^dips \/ sides$/i, en: "dips and sides", es: "dips y acompañantes", words: /\b(dips?|sides?|acompanantes?|botanas?)\b/ },
  { key: "seafood", match: /^mariscos/i, en: "seafood", es: "mariscos", words: /\b(mariscos?|seafood|camarones?|shrimp|ceviche)\b/ },
  { key: "favorites", match: /^top favorites$/i, en: "top favorites", es: "favoritos", words: /\b(favorites?|favoritos?)\b/ },
  { key: "traditional", match: /^traditional meals$/i, en: "traditional plates", es: "platillos tradicionales", words: /\b(traditional|tradicional(es)?|platillos?|plates?)\b/ }
];

function clean(name: string) {
  return String(name || "").replace(/\s*\((online|mesa)\)\s*/gi, " ").replace(/^\([A-Z]{2,4}\)\s*/, "").replace(/\s+/g, " ").trim();
}

function norm(text: string) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9$.? ]+/g, " ").replace(/\s+/g, " ").trim();
}

async function getJson(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`storefront ${res.status}`);
  return res.json() as Promise<any>;
}

export async function getMenuInfo(): Promise<MenuInfo | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.info;
  try {
    const cats = await getJson(`${STORE}/categories?per_page=100`);
    const products: any[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const json = await getJson(`${STORE}/products?per_page=100&page=${page}`);
      products.push(...(json.data || []));
      if (!json.meta?.pagination?.links?.next) break;
    }
    const online = products.filter((p) => /\(online\)/i.test(p.name) && p.visibility === "visible" && !p.badges?.out_of_stock);
    const toItem = (p: any): InfoItem => ({
      name: clean(p.name),
      priceLow: Number(p.price?.low ?? 0),
      priceHigh: Number(p.price?.high ?? p.price?.low ?? 0),
      popularity: Number(p.popularity_score || 0)
    });
    const categories: InfoCategory[] = [];
    for (const def of CATEGORY_DEFS) {
      const cat = (cats.data || []).find((c: any) => !/\(mesa\)/i.test(c.name) && def.match.test(String(c.name).trim()));
      if (!cat) continue;
      const items = online.filter((p) => (p.categoryIds || []).includes(cat.id)).map(toItem);
      if (items.length) categories.push({ key: def.key, name: String(cat.name).trim(), items });
    }
    // "Most popular" on the website = the store's popularity ranking.
    const popular = online.map(toItem)
      .filter((i) => !/^(extras?|sides?)$/i.test(i.name))
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 5);
    const info = { popular, categories };
    cache = { at: Date.now(), info };
    return info;
  } catch (error) {
    console.warn(`[menu-info] storefront unavailable: ${error instanceof Error ? error.message : error}`);
    return cache?.info || null;
  }
}

const QUESTION = /\b(what|which|whats|do you have|you guys have|got any|recommend|suggest|popular|best|good here|options|menu|list|que|cual(es)?|tienen|tienes|hay|venden|recomienda[sn]?|recomiendas|sugieres|lo mas|mas pedido|mas vendido|opciones|menu|carta)\b/;
const ORDERING = /\b(i want|i'?ll (have|take|get)|give me|can i (get|have)|add|order|quiero (un|una|uno|dos|tres|el|la|los|las|[0-9])|dame|me (da|das|pone|pones)|ponme|agrega|para llevar|pick ?up)\b/;
const GENERAL = /\b(menu|carta|what (do|else do) you (have|got|sell|serve)|whats (good|on the menu)|what is on the menu|what you got|recommend|suggest|popular|best seller|most ordered|que (tienen|tienes|hay|venden|me recomienda[s]?|recomiendas|sirven)|que hay de comer|lo mas (pedido|popular|vendido)|recomiendan|recomendacion(es)?|que es bueno)\b/;

/** Returns a short spoken answer if the text is a menu question, otherwise null. */
export async function answerMenuQuestion(text: string, language: Language): Promise<string | null> {
  const t = ` ${norm(text)} `.replace(/\bwhat s\b/g, "whats");
  const isQuestion = QUESTION.test(t) || /\?/.test(text);
  if (!isQuestion) return null;
  const wantsCategory = CATEGORY_DEFS.find((d) => d.words.test(t));
  const general = GENERAL.test(t);
  if (!general && !wantsCategory) return null;
  // "quiero un combo de tacos" is an order, not a question.
  if (ORDERING.test(t) && !/\b(menu|carta|recommend|recomienda|que tienen|what do you have)\b/.test(t)) return null;
  if (wantsCategory && !/\b(what|which|whats|do you have|got any|tienen|tienes|hay|cuales|que|list|options|opciones)\b/.test(t)) return null;

  const info = await getMenuInfo();
  const es = language === "es";
  if (!info) return es ? "Tenemos combos, paquetes, especiales del día, bebidas y más. ¿Qué se te antoja?" : "We have combos, pack meals, daily specials, drinks and more. What sounds good?";

  const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
  const say = (name: string) => {
    const n = name.replace(/^combo\s+/i, "");
    const parts = n.split(" / ");
    return parts.length === 2 && !/\//.test(parts[1]) ? (es ? parts[0] : parts[1]) : n;
  };
  const priced = (i: InfoItem) => (i.priceHigh > i.priceLow ? `${say(i.name)} ${es ? "desde" : "from"} ${money(i.priceLow)}` : `${say(i.name)} ${money(i.priceLow)}`);
  const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${es ? "y" : "and"} ${xs[xs.length - 1]}`);

  if (wantsCategory && !/\b(menu|carta)\b/.test(t)) {
    const def = wantsCategory;
    const cat = info.categories.find((c) => c.key === def.key);
    const label = es ? def.es : def.en;
    if (!cat) return es ? `Ahorita no tenemos ${label} en línea. ¿Qué más se te antoja?` : `We don't have ${label} online right now. What else sounds good?`;
    const items = cat.items.slice(0, 6);
    const names = items.length <= 6 ? items.map(priced) : items.map((i) => i.name);
    const more = cat.items.length > items.length ? (es ? " y más" : " and more") : "";
    return es ? `En ${label} tenemos: ${join(names)}${more}. ¿Cuál te gustaría?` : `For ${label} we have: ${join(names)}${more}. Which one would you like?`;
  }

  const popular = join(info.popular.slice(0, 4).map((i) => say(i.name)));
  const MAIN = ["combos", "meals", "especial", "traditional", "seafood", "drinks"];
  const cats = join(info.categories.filter((c) => MAIN.includes(c.key)).map((c) => (es ? CATEGORY_DEFS.find((d) => d.key === c.key)!.es : CATEGORY_DEFS.find((d) => d.key === c.key)!.en)));
  return es
    ? `Lo más popular: ${popular}. También tenemos ${cats}, y más. ¿Qué se te antoja?`
    : `Most popular: ${popular}. We also have ${cats}, and more. What sounds good?`;
}

const DRINK_WORDS = /\b(horchata|jamaica|tamarindo|agua|aguas|soda|sodas|coke|coca|cola|pepsi|sprite|fanta|jarrito|jarritos|juice|jugo|tea|te|cafe|coffee|lemonade|limonada|water|drink|drinks|bebida|bebidas|refresco|refrescos|beer|cerveza|milk|leche|smoothie|licuado|champurrado|atole)\b/;

/** Reply for an item that is not on the menu: say so, then offer the closest things the site sells. */
export async function unavailableItemReply(
  text: string,
  language: Language,
  catalog: Array<{ name: string; modifierGroups?: Array<{ name: string; options: Array<string | { name: string }> }> }> = []
): Promise<string> {
  const es = language === "es";
  const t = ` ${norm(text)} `;
  const asked = norm(text)
    .replace(/\b(i|want|would|like|can|get|give|me|please|quiero|dame|me|da|una?|uno|one|two|three|a|an|the|de|del|por|favor|order|ordenar|add|agrega|un|\d+)\b/g, " ")
    .replace(/\s+/g, " ").trim() || (es ? "eso" : "that");
  const info = await getMenuInfo();
  const say = (name: string) => {
    const parts = name.replace(/^combo\s+/i, "").split(" / ");
    return parts.length === 2 && !/\//.test(parts[1]) ? (es ? parts[0] : parts[1]) : name;
  };
  const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${es ? "o" : "or"} ${xs[xs.length - 1]}`);
  // Sold only as an add-on ("Horchata" is an Agua Fresca add-on with meals)? Say where it is.
  const words = asked.split(" ").filter((w) => w.length >= 4);
  const hosts: string[] = [];
  let addOnGroup = "";
  for (const item of catalog) {
    for (const group of item.modifierGroups || []) {
      const hit = (group.options || []).some((o) => { const n = norm(typeof o === "string" ? o : o.name); return words.length > 0 && words.every((w) => n.includes(w)); });
      if (hit) { hosts.push(clean(item.name).split(" / ")[0].trim()); addOnGroup = addOnGroup || clean(group.name).replace(/^\(?[A-Z]\)\s*/, "").replace(/^add\s+/i, ""); }
    }
  }
  const uniqueHosts = Array.from(new Set(hosts))
    .filter((h) => !/^\d\s*pack/i.test(h) && !/\b(\w+)\s+\1\b/i.test(h))
    .sort((a, b) => a.length - b.length)
    .slice(0, 3);
  const addOn = hosts.length
    ? (es
      ? ` La ${asked} viene como ${addOnGroup ? `${addOnGroup} adicional` : "adicional"} con platillos como ${join([...uniqueHosts, "los paquetes"])}.`
      : ` ${asked[0].toUpperCase()}${asked.slice(1)} comes as an ${addOnGroup ? `${addOnGroup} add-on` : "add-on"} with items like ${join([...uniqueHosts, "the pack meals"])}.`)
    : "";
  const drinks = info?.categories.find((c) => c.key === "drinks");
  if (DRINK_WORDS.test(t) && drinks?.items.length) {
    const names = join(drinks.items.slice(0, 5).map((i) => say(i.name)));
    return es
      ? `Perdón, no tenemos ${asked} ${hosts.length ? "por separado" : "en el menú"}.${addOn} De bebidas tenemos ${names}. ¿Cuál te gustaría?`
      : `Sorry, ${asked} isn't on our menu ${hosts.length ? "by itself" : ""}`.trim() + `.${addOn} For drinks we have ${names}. Which one would you like?`;
  }
  const popular = info?.popular.length ? join(info.popular.slice(0, 4).map((i) => say(i.name))) : "";
  return es
    ? `Perdón, no tenemos ${asked} en el menú.${popular ? ` Lo más popular es ${popular}.` : ""} ¿Qué se te antoja?`
    : `Sorry, ${asked} isn't on our menu.${popular ? ` Our most popular are ${popular}.` : ""} What sounds good?`;
}

/** "Missing required choices: Esquite Options." -> a real question with the website's choices. */
export function requiredChoiceQuestion(result: any, language: string, menu?: any[]) {
  const es = language === "es";
  const group = (result.requiredGroups || [])[0];
  if (!group) return result.message;
  const clean = (o: string) => String(o).replace(/\*+/g, "").replace(/\s*\(\+?\$[\d.]+\)/g, "").replace(/^\s*\([A-Z]{1,4}\)\s*/, "").split(" / ")[0];
  const options = (group.options || []).filter((o: string) => !/^double\b/i.test(o)).map((o: string) => clean(o).trim()).slice(0, 4);
  const picked = (menu || []).find((m: any) => m.id === result.selectedItem?.itemId);
  const name = String(picked?.readbackName || result.selectedItem?.name || "").replace(/\s*\([A-Z]{1,4}\)\s*/g, " ").trim();
  const list = options.length > 1 ? `${options.slice(0, -1).join(", ")} ${es ? "o" : "or"} ${options[options.length - 1]}` : options[0] || group.groupName;
  // Two questions left: ask them together, in site order ("¿Bistec, Cabeza… y Arroz y frijoles, Solo arroz…?"), fix9.
  const second = (result.requiredGroups || [])[1];
  if (second && (result.requiredGroups || []).length === 2) {
    const o2 = (second.options || []).map((o: string) => clean(o).trim()).slice(0, 4);
    const list2 = o2.length > 1 ? `${o2.slice(0, -1).join(", ")} ${es ? "o" : "or"} ${o2[o2.length - 1]}` : o2[0] || second.groupName;
    return es ? `${name}: ¿${list}? ¿Y ${list2}?` : `${name}: ${list}? And ${list2}?`;
  }
  return es ? `${name}: ¿${list}?` : `${name}: ${list}?`;
}
