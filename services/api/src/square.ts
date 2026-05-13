import { nanoid } from "nanoid";
import { fallbackMenu, type MenuItem, type ModifierGroup } from "./menu.js";

type CartItem = {
  id: string;
  quantity: number;
  unitPriceCents?: number;
  modifiers?: Array<{
    groupId?: string;
    groupName?: string;
    option?: string;
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
    const modifierNote = Array.isArray(cartItem.modifiers) && cartItem.modifiers.length
      ? ` | Modifiers: ${cartItem.modifiers
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
      note: `${menuItem.nameEs} ordered by voice${modifierNote}`
    };
  });
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
  const menu = await getMenu(runtime);

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

export async function getMenu(config?: Partial<SquareRuntimeConfig>): Promise<MenuItem[]> {
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
    const looksMulti = /extra|extras|topping|toppings|salsa|ingredient|ingredients|add ons|add ons|addons|side|sides/.test(cleanName);
    const minSelections = rawMin ?? (looksMulti ? 0 : 1);
    const maxSelections = rawMax ?? (looksMulti ? Math.max(optionCount, Math.max(minSelections, 1)) : 1);
    return {
      minSelections,
      maxSelections: Math.max(minSelections, maxSelections),
      allowQuantities: maxSelections > 1
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
  const modifierListById = new Map<string, { name: string; options: string[] }>();
  for (const object of objects) {
    if (object.type !== "MODIFIER_LIST") continue;
    const name = object.modifier_list_data?.name?.trim() || "";
    const options = (object.modifier_list_data?.modifiers || [])
      .map((m) => {
        const embeddedName = m.modifier_data?.name?.trim() || "";
        const referenced = modifierById.get(m.id);
        const optionName = embeddedName || referenced?.name || "";
        if (!optionName) return "";

        const embeddedDelta = Number(m.modifier_data?.price_money?.amount || 0);
        const referencedDelta = Number(referenced?.priceDeltaCents || 0);
        const priceDelta = embeddedDelta || referencedDelta;
        return priceDelta ? `${optionName} (${formatSignedUsdFromCents(priceDelta)})` : optionName;
      })
      .filter(Boolean);
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
