import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { fallbackMenu, type MenuItem, type ModifierGroup, type ModifierOption } from "./menu.js";

type CartItem = {
  id: string;
  quantity: number;
  unitPriceCents?: number;
  modifiers?: Array<{
    groupId?: string;
    groupName?: string;
    option?: string;
    optionId?: string;
    priceDeltaCents?: number;
    quantity?: number;
  }>;
};

type CheckoutRequest = {
  cart: CartItem[];
  fulfillment: "PICKUP" | "DELIVERY";
  customer: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
  };
};

export type SquareRuntimeConfig = {
  env: "sandbox" | "production";
  accessToken?: string;
  locationId?: string;
  apiVersion: string;
  appPublicUrl: string;
  businessName: string;
};

function getSquareConfig(config?: Partial<SquareRuntimeConfig>): SquareRuntimeConfig {
  return {
    env: config?.env || (process.env.SQUARE_ENV === "production" ? "production" : "sandbox"),
    accessToken: config?.accessToken || process.env.SQUARE_ACCESS_TOKEN,
    locationId: config?.locationId || process.env.SQUARE_LOCATION_ID,
    apiVersion: config?.apiVersion || process.env.SQUARE_API_VERSION || "2026-01-22",
    appPublicUrl: config?.appPublicUrl || process.env.APP_PUBLIC_URL || "http://localhost:4000",
    businessName: config?.businessName || process.env.RESTAURANT_NAME || "Cocina Elvis"
  };
}

function getSquareBaseUrl(env: "sandbox" | "production") {
  return env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
}

function formatSignedUsdFromCents(cents: number) {
  const sign = cents >= 0 ? "+" : "-";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function optionName(option: string | ModifierOption) {
  return typeof option === "object" && option !== null ? option.name : String(option || "");
}

function normalizeOptionKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(\s*[+-]?\s*\$\s*\d+(?:\.\d{1,2})?\s*\)/g, " ")
    .replace(/^\s*\d+\s*x\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function squareHeaders(config: SquareRuntimeConfig) {
  if (!config.accessToken) {
    throw new Error("Missing SQUARE_ACCESS_TOKEN");
  }

  return {
    Authorization: `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
    "Square-Version": config.apiVersion
  };
}

async function squareRequest<T>(
  path: string,
  init: RequestInit,
  config: SquareRuntimeConfig
): Promise<T> {
  const response = await fetch(`${getSquareBaseUrl(config.env)}${path}`, {
    ...init,
    headers: {
      ...squareHeaders(config),
      ...(init.headers || {})
    }
  });
  const body = (await response.json().catch(() => ({}))) as T & { errors?: unknown };

  if (!response.ok) {
    throw new Error(`Square ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

function buildFulfillment(input: CheckoutRequest) {
  const recipient = {
    display_name: input.customer.name || "Cocina Elvis customer",
    phone_number: input.customer.phone,
    email_address: input.customer.email
  };

  if (input.fulfillment === "DELIVERY") {
    return {
      type: "DELIVERY",
      state: "PROPOSED",
      delivery_details: {
        recipient,
        note: input.customer.address ? `Delivery address: ${input.customer.address}` : undefined,
        schedule_type: "ASAP"
      }
    };
  }

  return {
    type: "PICKUP",
    state: "PROPOSED",
    pickup_details: {
      recipient,
      schedule_type: "ASAP"
    }
  };
}

function buildLineItems(cart: CartItem[], menu: MenuItem[]) {
  return cart.map((cartItem) => {
    const menuItem = menu.find((item) => item.id === cartItem.id);
    if (!menuItem) {
      throw new Error(`Unknown menu item: ${cartItem.id}`);
    }

    const explicitUnitPrice = Math.max(0, Number(cartItem.unitPriceCents || 0));
    const unitPriceCents = explicitUnitPrice || menuItem.priceCents;
    const hasCustomPrice = unitPriceCents !== menuItem.priceCents;
    const modifiers = Array.isArray(cartItem.modifiers) ? cartItem.modifiers : [];
    const squareModifiers = modifiers
      .map((modifier) => {
        const optionId = String(modifier.optionId || findModifierOptionCatalogId(menuItem, modifier.groupId, modifier.option) || "").trim();
        if (!optionId) return null;
        return {
          catalog_object_id: optionId,
          quantity: String(Math.max(1, Number(modifier.quantity) || 1))
        };
      })
      .filter((option): option is { catalog_object_id: string; quantity: string } => Boolean(option));
    const modifierNote = modifiers.length
      ? ` | Voice modifiers: ${modifiers
          .map((modifier) => {
            const qty = Math.max(1, Number(modifier.quantity) || 1);
            const option = String(modifier.option || "");
            return qty > 1 ? `${qty}x ${option}` : option;
          })
          .join(", ")}`
      : "";

    return {
      name: menuItem.name,
      quantity: String(Math.max(1, cartItem.quantity)),
      catalog_object_id: hasCustomPrice ? undefined : menuItem.squareVariationId,
      base_price_money: !hasCustomPrice && menuItem.squareVariationId
        ? undefined
        : {
            amount: unitPriceCents,
            currency: "USD"
          },
      modifiers: squareModifiers.length ? squareModifiers : undefined,
      note: `${menuItem.nameEs} ordered by voice${modifierNote}`
    };
  });
}

function findModifierOptionCatalogId(menuItem: MenuItem, groupId?: string, option?: string) {
  const optionKey = normalizeOptionKey(String(option || ""));
  if (!optionKey) return "";

  const groups = Array.isArray(menuItem.modifierGroups) ? menuItem.modifierGroups : [];
  const searchGroups = groupId
    ? groups.filter((group) => group.id === groupId)
    : groups;
  for (const group of searchGroups) {
    for (const candidate of group.options || []) {
      if (typeof candidate !== "object" || !candidate?.id) continue;
      if (normalizeOptionKey(optionName(candidate)) === optionKey) {
        return candidate.id;
      }
    }
  }
  for (const group of groups) {
    for (const candidate of group.options || []) {
      if (typeof candidate !== "object" || !candidate?.id) continue;
      const candidateKey = normalizeOptionKey(optionName(candidate));
      if (candidateKey === optionKey || candidateKey.includes(optionKey) || optionKey.includes(candidateKey)) {
        return candidate.id;
      }
    }
  }
  return "";
}

export async function createCheckout(input: CheckoutRequest, config?: Partial<SquareRuntimeConfig>) {
  const runtime = getSquareConfig(config);
  if (!runtime.locationId) {
    throw new Error("Missing SQUARE_LOCATION_ID");
  }
  if (!input.cart?.length) {
    throw new Error("Cart is empty");
  }
  if (input.fulfillment === "DELIVERY" && !input.customer?.address) {
    throw new Error("Delivery address is required");
  }
  const menu = await getFullMenu(runtime);

  const response = await squareRequest<{
    payment_link: { id: string; url: string; order_id?: string };
    related_resources?: { orders?: Array<{ id: string }> };
  }>("/v2/online-checkout/payment-links", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: nanoid(),
      order: {
        location_id: runtime.locationId,
        reference_id: `voice-${nanoid(10)}`,
        line_items: buildLineItems(input.cart, menu),
        fulfillments: [buildFulfillment(input)]
      },
      checkout_options: {
        redirect_url: `${runtime.appPublicUrl}/checkout/success`,
        ask_for_shipping_address: false
      },
      pre_populated_data: {
        buyer_email: input.customer.email
      },
      payment_note: `${runtime.businessName} ${input.fulfillment.toLowerCase()} voice order`
    })
  }, runtime);

  return {
    checkoutUrl: response.payment_link.url,
    paymentLinkId: response.payment_link.id,
    orderId: response.payment_link.order_id || response.related_resources?.orders?.[0]?.id
  };
}

export async function getFullMenu(config?: Partial<SquareRuntimeConfig>): Promise<MenuItem[]> {
  const runtime = getSquareConfig(config);
  if (!runtime.accessToken || !runtime.locationId) {
    return fallbackMenu;
  }

  const catalog = await squareRequest<{
    objects?: Array<{
      id: string;
      type: string;
      category_data?: {
        name?: string;
      };
      image_data?: {
        url?: string;
      };
      modifier_list_data?: {
        name?: string;
        modifiers?: Array<{
          id: string;
          modifier_data?: {
            name?: string;
            price_money?: { amount?: number };
          };
        }>;
      };
      modifier_data?: {
        name?: string;
        price_money?: { amount?: number };
      };
      item_data?: {
        name?: string;
        image_ids?: string[];
        categories?: Array<{ id?: string }>;
        channels?: string[];
        modifier_list_info?: Array<{
          modifier_list_id: string;
          enabled?: boolean;
          min_selected_modifiers?: number;
          max_selected_modifiers?: number;
          allow_quantities?: boolean;
        }>;
        variations?: Array<{
          id: string;
          item_variation_data?: {
            channels?: string[];
            price_money?: { amount?: number };
          };
        }>;
      };
    }>;
  }>("/v2/catalog/search", {
    method: "POST",
    body: JSON.stringify({
      object_types: ["ITEM", "CATEGORY", "IMAGE", "MODIFIER_LIST", "MODIFIER"],
      include_deleted_objects: false,
      include_related_objects: true
    })
  }, runtime).catch((error) => {
    console.warn(`Square catalog sync skipped: ${error instanceof Error ? error.message : error}`);
    return { objects: [] };
  });

  const squareMenu = buildMenuFromSquareCatalog(catalog.objects || []);
  if (squareMenu.length > 0) {
    return squareMenu;
  }

  // When Square is configured, do not silently switch to hardcoded fallback
  // if there are no ONLINE items. Returning [] makes the issue explicit.
  return [];
}

export async function getMenu(config?: Partial<SquareRuntimeConfig>): Promise<MenuItem[]> {
  const runtime = getSquareConfig(config);
  const fullMenu = await getFullMenu(runtime);
  if (!runtime.accessToken || !runtime.locationId) {
    return fullMenu;
  }

  return buildReviewedOnlineMenu(fullMenu);
}

type ReviewedMenuEntry = {
  name: string;
  matchers: RegExp[];
};

const DEFAULT_REVIEWED_ONLINE_NAMES = [
  "COMBO Mix",
  "COMBO Gorditas",
  "COMBO Tortas",
  "COMBO Burrito",
  "COMBO Quesadillas",
  "COMBO Tacos",
  "8 Pack MEAL",
  "7 Pack MEAL",
  "6 Pack MEAL",
  "5 Pack MEAL",
  "4 Pack MEAL",
  "3 Pack MEAL",
  "(QD) Quesadilla Dorada",
  "Birria de Chivo / Goat Birria",
  "Queso Birrias",
  "Pambazo Elvis",
  "Tacos al Vapor / Steamed Tacos",
  "Enchiladas",
  "Large Fiesta Platter",
  "Medium Fiesta Platter",
  "Small Fiesta Platter",
  "Rice / Beans Fiesta Pan",
  "Tortillas",
  "Fiesta Fajitas",
  "Dips",
  "Elvis Dip",
  "Esquite Elvis",
  "Sides",
  "Extras",
  "Coctel de Camarones / Shrimp Cocktail",
  "Ceviche",
  "Nachos Elvis",
  "Tacos Dorados",
  "Traditional Elvis Bowl",
  "Burrito",
  "Gordita",
  "Torta",
  "Quesadilla",
  "Taco",
  "Mole Tradicional Platillo",
  "Fajitas Elvis",
  "Platillo de Guisado",
  "Chiles Rellenos / Stuffed Poblano Peppers",
  "Sopesaso Elvis",
  "Huarache Elvis",
  "Pozole Rojo / Red Pozole",
  "Chimichanga",
  "Chilaquiles con Huevo"
];

function buildReviewedOnlineMenu(fullMenu: MenuItem[]) {
  const entries = getReviewedOnlineEntries();
  const usedIds = new Set<string>();

  return entries.map((entry) => {
    const matches = fullMenu.filter((item) => {
      if (usedIds.has(item.id)) return false;
      const text = normalizeName(`${item.name} ${item.nameEs}`);
      return entry.matchers.some((matcher) => matcher.test(text));
    });

    for (const match of matches) {
      usedIds.add(match.id);
    }

    return buildReviewedMenuItem(entry.name, matches);
  });
}

function buildReviewedMenuItem(reviewedName: string, matches: MenuItem[]) {
  const slug = normalizeName(reviewedName).replace(/\s+/g, "-") || "reviewed-online-item";
  const primary = matches[0];
  if (!primary) {
    return {
      id: `reviewed-${slug}`,
      name: reviewedName,
      nameEs: reviewedName,
      aliases: [reviewedName, normalizeName(reviewedName)].filter(Boolean),
      priceCents: 0,
      description: `${reviewedName} from the reviewed Cocina Elvis ONLINE menu.`
    };
  }

  const aliases = new Set<string>([
    reviewedName,
    normalizeName(reviewedName),
    ...matches.flatMap((item) => [item.name, item.nameEs, ...(item.aliases || [])])
  ].filter(Boolean));
  const variantOptions = matches.length > 1
    ? [{
        id: `reviewed-${slug}-options`,
        name: `${reviewedName} options`,
        options: matches.map((item) => ({
          id: item.id,
          name: trimReviewedVariantName(reviewedName, item.name),
          priceDeltaCents: item.priceCents - primary.priceCents
        })),
        minSelections: 0,
        maxSelections: 1
      }]
    : [];

  return {
    ...primary,
    name: reviewedName,
    nameEs: reviewedName,
    aliases: Array.from(aliases),
    description: primary.description || `${reviewedName} from the reviewed Cocina Elvis ONLINE menu.`,
    modifierGroups: variantOptions.length
      ? [...variantOptions, ...(primary.modifierGroups || [])]
      : primary.modifierGroups
  };
}

function getReviewedOnlineEntries(): ReviewedMenuEntry[] {
  return getReviewedOnlineNames().map((name) => ({
    name,
    matchers: buildReviewedNameMatchers(name)
  }));
}

function getReviewedOnlineNames() {
  const candidates = [
    path.resolve(process.cwd(), "Menu Elvi Step by Step Build/Menu Items Online.rtf"),
    path.resolve(process.cwd(), "../Menu Elvi Step by Step Build/Menu Items Online.rtf"),
    path.resolve(process.cwd(), "../../Menu Elvi Step by Step Build/Menu Items Online.rtf")
  ];
  for (const reviewedFile of candidates) {
    try {
      const content = fs.readFileSync(reviewedFile, "utf8");
      const names = Array.from(content.matchAll(/(?:^|\\|\n)\s*([^\\{}\n]+?)\s*\(ONLINE\)/g))
        .map((match) => match[1]?.replace(/\\[a-z]+\d*\s*/gi, "").trim())
        .filter((name): name is string => Boolean(name));
      if (names.length > 0) {
        return Array.from(new Set(names));
      }
    } catch {
      // Try the next likely working directory.
    }
  }
  return DEFAULT_REVIEWED_ONLINE_NAMES;
}

function buildReviewedNameMatchers(name: string) {
  const normalized = normalizeName(name);
  const exactPrefix = (value: string) => new RegExp(`^${escapeRegExp(value)}(?:\\b|$)`, "i");
  const matchers: RegExp[] = [];

  if (/^\d+\s+pack meal$/.test(normalized)) {
    matchers.push(exactPrefix(normalized));
  } else if (/^qd quesadilla dorada$/.test(normalized)) {
    matchers.push(/^(qd )?quesadilla dorada\b/i);
  } else if (normalized === "tacos dorados") {
    matchers.push(/^tacos dorados\b/i);
  } else if (normalized === "rice beans fiesta pan") {
    matchers.push(/^rice beans fiesta pan\b/i);
  } else if (normalized === "queso birrias") {
    matchers.push(/^queso birrias?\b/i);
  } else if (normalized === "chiles rellenos stuffed poblano peppers") {
    matchers.push(/^chiles rellenos\b/i);
  } else {
    matchers.push(exactPrefix(normalized));
  }

  return matchers;
}

function trimReviewedVariantName(reviewedName: string, variantName: string) {
  const reviewedKey = normalizeName(reviewedName);
  const variantKey = normalizeName(variantName);
  if (!variantKey.startsWith(reviewedKey)) {
    return variantName;
  }

  const trimmed = variantName.slice(reviewedName.length)
    .replace(/^\s*[-:/]?\s*/, "")
    .trim();
  return trimmed || variantName;
}

function buildMenuFromSquareCatalog(
  objects: Array<{
    id: string;
    type: string;
    category_data?: {
      name?: string;
    };
    image_data?: {
      url?: string;
    };
    modifier_list_data?: {
      name?: string;
      modifiers?: Array<{
        id: string;
        modifier_data?: {
          name?: string;
          price_money?: { amount?: number };
        };
      }>;
    };
    modifier_data?: {
      name?: string;
      price_money?: { amount?: number };
    };
      item_data?: {
        name?: string;
        description?: string;
        image_ids?: string[];
        categories?: Array<{ id?: string }>;
        channels?: string[];
        modifier_list_info?: Array<{
          modifier_list_id: string;
          enabled?: boolean;
        min_selected_modifiers?: number;
        max_selected_modifiers?: number;
        allow_quantities?: boolean;
      }>;
      variations?: Array<{
        id: string;
        item_variation_data?: {
          name?: string;
          channels?: string[];
          price_money?: { amount?: number };
        };
      }>;
    };
  }>
): MenuItem[] {
  const result: MenuItem[] = [];

  function inferModifierRules(name: string, optionCount: number, rawMin?: number, rawMax?: number) {
    const cleanName = name.toLowerCase();
    const looksMulti = /extra|extras|topping|toppings|salsa|ingredient|ingredients|add ons|addons|side|sides|\bcon\b|\bwith\b/.test(cleanName);
    const cleanMin = Number.isFinite(Number(rawMin)) && Number(rawMin) > 0 ? Number(rawMin) : 0;
    const inferredMax = looksMulti ? Math.max(optionCount, Math.max(cleanMin, 1)) : Math.max(1, cleanMin || 1);
    const cleanMax = Number.isFinite(Number(rawMax)) && Number(rawMax) > 0 ? Number(rawMax) : inferredMax;
    return {
      minSelections: cleanMin,
      maxSelections: Math.max(cleanMin, cleanMax),
      allowQuantities: Math.max(cleanMin, cleanMax) > 1
    };
  }

  const categoryNameById = new Map(
    objects
      .filter((object) => object.type === "CATEGORY")
      .map((object) => [object.id, object.category_data?.name || ""])
  );

  const imageUrlById = new Map(
    objects
      .filter((object) => object.type === "IMAGE")
      .map((object) => [object.id, object.image_data?.url || ""])
  );

  const modifierById = new Map<string, { name: string; priceDeltaCents: number }>();
  for (const object of objects) {
    if (object.type !== "MODIFIER") continue;
    const name = object.modifier_data?.name?.trim() || "";
    if (!name) continue;
    modifierById.set(object.id, {
      name,
      priceDeltaCents: Number(object.modifier_data?.price_money?.amount || 0)
    });
  }

  // Build modifier list map: id → { name, options with Square price deltas }
  const modifierListById = new Map<string, { name: string; options: ModifierOption[] }>();
  for (const object of objects) {
    if (object.type !== "MODIFIER_LIST") continue;
    const name = object.modifier_list_data?.name?.trim() || "";
    const options = (object.modifier_list_data?.modifiers || [])
      .flatMap((m): ModifierOption[] => {
        const embeddedName = m.modifier_data?.name?.trim() || "";
        const referenced = modifierById.get(m.id);
        const optionName = embeddedName || referenced?.name || "";
        if (!optionName) return [];

        const embeddedDelta = Number(m.modifier_data?.price_money?.amount || 0);
        const referencedDelta = Number(referenced?.priceDeltaCents || 0);
        const priceDelta = embeddedDelta || referencedDelta;
        return [{
          id: m.id,
          name: priceDelta ? `${optionName} (${formatSignedUsdFromCents(priceDelta)})` : optionName,
          priceDeltaCents: priceDelta
        }];
      });
    if (name) {
      modifierListById.set(object.id, { name, options });
    }
  }

  for (const object of objects) {
    if (object.type !== "ITEM") continue;
    const itemName = object.item_data?.name?.trim();
    if (!itemName) continue;
    if (/\bVOICE\s+ONLINE\b/i.test(itemName)) continue;

    const categoryIds = (object.item_data?.categories || []).map((entry) => entry.id).filter(Boolean);
    const categoryNames = categoryIds.map((id) => categoryNameById.get(id as string) || "");

    const hasOnlineCategory = categoryNames.some((name) => isOnlineCategoryName(name));
    if (!hasOnlineCategory) {
      continue;
    }

    // Build modifier groups sorted by prefix letter (A), (B), (C)…
    const modifierGroups: ModifierGroup[] = (object.item_data?.modifier_list_info || [])
      .filter((info) => info.enabled !== false && modifierListById.has(info.modifier_list_id))
      .map((info) => {
        const ml = modifierListById.get(info.modifier_list_id)!;
        const rules = inferModifierRules(
          ml.name,
          ml.options.length,
          info.min_selected_modifiers,
          info.max_selected_modifiers
        );
        return {
          id: info.modifier_list_id,
          name: ml.name,
          options: ml.options,
          minSelections: rules.minSelections,
          maxSelections: rules.maxSelections,
          allowQuantities: info.allow_quantities ?? rules.allowQuantities
        };
      })
      .sort((a, b) => {
        const prefixA = a.name.match(/^\(([A-Z]+)\)/i)?.[1]?.toUpperCase() || "Z";
        const prefixB = b.name.match(/^\(([A-Z]+)\)/i)?.[1]?.toUpperCase() || "Z";
        return prefixA.localeCompare(prefixB);
      });

    const variations = object.item_data?.variations?.length
      ? object.item_data.variations
      : [{ id: `${object.id}-variation`, item_variation_data: {} }];

    for (const variation of variations) {
      if (!isOnlineVariation(variation.item_variation_data)) {
        continue;
      }

      const variationName = variation.item_variation_data?.name?.trim();
      const rawFullName =
        variationName && variationName.toLowerCase() !== "regular"
          ? `${itemName} ${variationName}`
          : itemName;

      const fullName = sanitizeDisplayName(rawFullName);

      const slug = normalizeName(fullName).replace(/\s+/g, "-") || object.id;
      result.push({
        id: `sq-${slug}-${variation.id.slice(0, 6)}`,
        name: fullName,
        nameEs: fullName,
        aliases: buildAliases(fullName, object.item_data?.description, rawFullName),
        priceCents: variation.item_variation_data?.price_money?.amount || 0,
        description: object.item_data?.description?.trim() || undefined,
        imageUrl: resolveItemImageUrl(object.item_data?.image_ids, imageUrlById),
        squareCatalogObjectId: object.id,
        squareVariationId: variation.id,
        modifierGroups: modifierGroups.length > 0 ? modifierGroups : undefined
      });
    }
  }

  return result;
}

function buildAliases(name: string, description?: string, rawName?: string) {
  const parts = [name, rawName || "", ...(description ? description.split(/[,.]/) : [])]
    .map((value) => normalizeName(value))
    .filter((value) => value.length > 0);

  const set = new Set(parts);
  const normalizedName = normalizeName(`${name} ${rawName || ""}`);
  if (/\btaco\b/.test(normalizedName) && !/\b(combo|fiesta|love box|hard shell|pack|meal|tacos|trio|sampler)\b/.test(normalizedName)) {
    set.add("taco");
    set.add("single taco");
    set.add("one taco");
    if (/\b(co|comal|homemade)\b/.test(normalizedName)) {
      set.add("homemade taco");
      set.add("handmade taco");
      set.add("comal taco");
      set.add("corn taco");
    }
    if (/\b(hr|harina|flour)\b/.test(normalizedName)) {
      set.add("flour taco");
      set.add("harina taco");
    }
    if (/\b(st|taquero|street)\b/.test(normalizedName)) {
      set.add("street taco");
      set.add("taquero taco");
      set.add("steak taco");
      set.add("bistec taco");
    }
  }
  if (/\bquesadilla\b/.test(normalizedName) && !/\b(combo|fiesta|love box|pack|meal|dorada|fried|quesadillas|trio|sampler)\b/.test(normalizedName)) {
    set.add("quesadilla");
    set.add("single quesadilla");
    set.add("one quesadilla");
    set.add("cheese quesadilla");
    if (/\b(co|comal|homemade)\b/.test(normalizedName)) {
      set.add("homemade quesadilla");
      set.add("handmade quesadilla");
      set.add("comal quesadilla");
      set.add("corn quesadilla");
    }
    if (/\b(hr|harina|flour)\b/.test(normalizedName)) {
      set.add("flour quesadilla");
      set.add("harina quesadilla");
    }
    if (/\b(st|taquera|street)\b/.test(normalizedName)) {
      set.add("street quesadilla");
      set.add("taquera quesadilla");
      set.add("steak quesadilla");
      set.add("bistec quesadilla");
    }
  }
  return Array.from(set);
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOnlineCategoryName(value: string) {
  return value.trim().toUpperCase() === "FOOD (ONLINE)";
}

function isOnlineVariation(variation?: { channels?: string[] }) {
  return Array.isArray(variation?.channels) && variation.channels.length > 0;
}

function sanitizeDisplayName(value: string) {
  return value
    .replace(/\s*\(\s*online\s*\)\s*/gi, " ")
    .replace(/\s*\/+\s*/g, " / ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function resolveItemImageUrl(imageIds: string[] | undefined, imageUrlById: Map<string, string>) {
  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    return undefined;
  }

  for (const id of imageIds) {
    const url = imageUrlById.get(id);
    if (url) {
      return url;
    }
  }

  return undefined;
}
