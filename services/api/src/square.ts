import { addressesIn } from "./delivery.js";
import { quoteDeliveryAddress, deliveryMinimumCents, DELIVERY_FILE, type Quote } from "./delivery-zone.js";
import { loadSiteCatalog, siteSellsSquareItem, applySiteGroupRules, readbackName } from "./site-catalog.js";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { fallbackMenu, type MenuItem, type ModifierGroup, type ModifierOption } from "./menu.js";
import { assertFulfillmentAllowed, getLaunchConfig } from "./launch-config.js";

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
  metadata?: {
    language?: string;
    transcriptSummary?: string;
    cartSummary?: string;
    source?: string;
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
    // delivery1: structured address on the recipient + the address/zone/fee/ETA in the delivery note (staff see it on the ticket).
    const a = addressesIn(input.customer.address || "")[0];
    const q = (input as any).deliveryQuote as Quote | undefined;
    const extra = q?.ok ? ` | ${q.zoneLabel} · $${((q.feeCents || 0) / 100).toFixed(2)} · ~${q.etaMinutes} min` : "";
    return {
      type: "DELIVERY",
      state: "PROPOSED",
      delivery_details: {
        recipient: {
          ...recipient,
          ...(a ? { address: { address_line_1: a.street, address_line_2: a.unit, locality: a.city || "Painesville", administrative_district_level_1: "OH", postal_code: a.zip, country: "US" } } : {})
        },
        note: input.customer.address ? `DELIVERY / ENTREGA: ${input.customer.address}${extra}`.slice(0, 500) : undefined,
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
        if (/^(reviewed-|__)/.test(optionId)) return null;
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

function cleanNote(value: unknown, maxLength = 450) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function buildVoiceOrderNote(input: CheckoutRequest, menu: MenuItem[]) {
  const config = getLaunchConfig();
  const language = cleanNote(input.metadata?.language || "unknown", 24);
  const source = cleanNote(input.metadata?.source || config.voiceOrderSource, 80);
  const cartSummary = cleanNote(
    input.metadata?.cartSummary ||
      input.cart
        .map((line) => {
          const menuItem = menu.find((item) => item.id === line.id);
          return `${Math.max(1, Number(line.quantity) || 1)} x ${menuItem?.name || line.id}`;
        })
        .join("; ")
  );
  const transcriptSummary = cleanNote(input.metadata?.transcriptSummary, 350);
  return [
    "Voice order",
    `Source: ${source}`,
    `Language: ${language}`,
    cartSummary ? `Cart: ${cartSummary}` : "",
    transcriptSummary ? `Transcript summary: ${transcriptSummary}` : ""
  ].filter(Boolean).join(" | ");
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

// catalog1 (Carlos's rule): production orders contain ONLY real Square catalog item variations — food, drinks and the
// "Delivery Fee" item (Delivery 1 $5 / Delivery 2 $8). No ad-hoc/custom-amount lines, no ad-hoc service charges.
// Sandbox keeps its "[TEST]" ad-hoc lines (the sandbox account has no catalog).
export class CatalogOnlyError extends Error { staff = true; constructor(msg: string) { super(msg); this.name = "CatalogOnlyError"; } }
export function assertCatalogOnly(lineItems: any[]) {
  const bad = lineItems.filter((li) => !li?.catalog_object_id || li.base_price_money || /^\[TEST\]/.test(String(li.name || "")));
  if (bad.length) throw new CatalogOnlyError(`Staff must enter this order: ${bad.map((b) => b?.name || "?").join(", ")} is not a Square catalog item (no custom amounts on production orders).`);
  return lineItems;
}
export function deliveryFeeLineItem(feeCents: number, file: { squareFeeVariations?: Record<string, string> } = loadDeliveryFile()) {
  const id = file.squareFeeVariations?.[String(feeCents)];
  if (!id) throw new CatalogOnlyError(`No Square "Delivery Fee" variation for $${(feeCents / 100).toFixed(2)}; staff must confirm the delivery fee.`);
  return { catalog_object_id: id, quantity: "1" };
}
function loadDeliveryFile() { try { return JSON.parse(fs.readFileSync(DELIVERY_FILE, "utf8")); } catch { return {}; } }

export async function createCheckout(input: CheckoutRequest, config?: Partial<SquareRuntimeConfig>) {
  const runtime = getSquareConfig(config);
  if (!runtime.locationId) {
    throw new Error("Missing SQUARE_LOCATION_ID");
  }
  if (!input.cart?.length) {
    throw new Error("Cart is empty");
  }
  assertFulfillmentAllowed(input.fulfillment);
  if (input.fulfillment === "DELIVERY" && !input.customer?.address) {
    throw new Error("Delivery address is required");
  }
  // delivery1: zone/fee from data/delivery.json (geocoded). If the zone can't be confirmed, don't take payment — staff confirm.
  let deliveryQuote: Quote | undefined;
  if (input.fulfillment === "DELIVERY") {
    deliveryQuote = await quoteDeliveryAddress(input.customer.address || "");
    if (!deliveryQuote.ok) throw new Error(deliveryQuote.reason === "out_of_range" ? deliveryQuote.message.en : "We couldn't confirm the delivery zone for that address. Please call us so staff can confirm the delivery fee.");
    (input as any).deliveryQuote = deliveryQuote;
  }
  // sandbox1: the sandbox account has no catalog, so read the real menu (read-only) and send
  // ad-hoc line items (name + price, no production catalog IDs) to the sandbox.
  const sandbox = runtime.env === "sandbox";
  const menu = sandbox ? await getMenu() : await getMenu(runtime);
  // delivery2: $10 delivery minimum on the food subtotal (before the delivery fee).
  if (input.fulfillment === "DELIVERY") {
    const subtotal = cartSubtotalCents(input.cart, menu), min = deliveryMinimumCents();
    if (subtotal < min) throw new Error(`Delivery minimum is $${(min / 100).toFixed(2)} before the delivery fee (this order is $${(subtotal / 100).toFixed(2)}). Add more items or choose pickup.`);
  }
  const voiceOrderNote = buildVoiceOrderNote(input, menu);
  // catalog1: production = catalog variations only, delivery fee as the catalog "Delivery Fee" item; otherwise refuse (staff).
  if (!sandbox) {
    const prod: any[] = buildLineItems(input.cart, menu);
    if (deliveryQuote?.ok) prod.push(deliveryFeeLineItem(Number(deliveryQuote.feeCents)));
    assertCatalogOnly(prod);
  }
  const lineItems = buildLineItems(input.cart, menu).map((li) => {
    if (!sandbox) return li;
    const mi = menu.find((m) => m.name === li.name);
    const amount = li.base_price_money?.amount ?? mi?.priceCents ?? 0;
    return { name: `[TEST] ${li.name}`, quantity: li.quantity, base_price_money: { amount, currency: "USD" }, note: li.note };
  });

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
        line_items: sandbox || !deliveryQuote?.ok ? lineItems : assertCatalogOnly([...lineItems, deliveryFeeLineItem(Number(deliveryQuote.feeCents))]),
        fulfillments: [buildFulfillment(input)],
        ...(sandbox && deliveryQuote?.ok ? { service_charges: [{ name: `Delivery fee (${deliveryQuote.zoneLabel})`, amount_money: { amount: deliveryQuote.feeCents, currency: "USD" }, calculation_phase: "TOTAL_PHASE", taxable: false }] } : {}),
        metadata: {
          source: "voice_order",
          voice_order_source: cleanNote(input.metadata?.source || getLaunchConfig().voiceOrderSource, 60),
          voice_language: cleanNote(input.metadata?.language || "unknown", 20)
        }
      },
      checkout_options: {
        redirect_url: `${runtime.appPublicUrl}/checkout/success`,
        ask_for_shipping_address: false
      },
      pre_populated_data: {
        buyer_email: input.customer.email
      },
      payment_note: `${runtime.businessName} ${input.fulfillment.toLowerCase()} voice order${input.fulfillment === "DELIVERY" ? ` | DELIVERY TO: ${input.customer.address}` : ""} | ${voiceOrderNote}`.slice(0, 500)
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

  const squareMenu = buildMenuFromSquareCatalog(catalog.objects || []).map(withCallerWords)
    .map((item) => ({ ...item, readbackName: readbackName(item, "en"), readbackNameEs: readbackName(item, "es") }));
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

  // Reviewed food list + the website's online drinks, one item per drink option (own Square variation).
  const reviewed = buildReviewedOnlineMenu(fullMenu.filter((item) => item.category !== "drinks"));
  const drinks = fullMenu.filter((item) => item.category === "drinks");
  // Every other item the website sells (matched by Square item ID, not name), e.g. Menudo.
  const covered = new Set([...reviewed, ...drinks].map((item) => item.squareCatalogObjectId).filter(Boolean));
  const siteExtras: MenuItem[] = [];
  for (const product of loadSiteCatalog()?.products || []) {
    if (covered.has(product.squareId)) continue;
    const matches = fullMenu.filter((item) => item.squareCatalogObjectId === product.squareId && item.category !== "drinks");
    if (!matches.length) continue;
    covered.add(product.squareId);
    siteExtras.push(buildReviewedMenuItem(product.name, matches));
  }
  return [...reviewed, ...siteExtras, ...drinks].map((item) => withCallerWords(applySiteGroupRules(item)))
    .map((item) => ({ ...item, readbackName: readbackName(item, "en"), readbackNameEs: readbackName(item, "es") }));
}

/** Caller words from data/rules/site-items-rules.csv (square_item_id, callers_say "a; b; c"). */
let callerWordsCache: Map<string, string[]> | null = null;
function withCallerWords(item: MenuItem): MenuItem {
  if (!callerWordsCache) {
    callerWordsCache = new Map();
    try {
      const rows = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../data/rules/site-items-rules.csv"), "utf8").split(/\r?\n/).slice(1);
      for (const row of rows) {
        const [id, , words] = row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        if (id && words) callerWordsCache.set(id, words.split(";").map((w) => w.trim().toLowerCase()).filter(Boolean));
      }
    } catch { /* optional file */ }
  }
  const words = item.squareCatalogObjectId ? callerWordsCache.get(item.squareCatalogObjectId) : undefined;
  return words?.length ? { ...item, aliases: Array.from(new Set([...(item.aliases || []), ...words])) } : item;
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
    if (normalizeName(reviewedName) === "queso birrias") {
      return buildReviewedQuesoBirriasItem();
    }
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
      ? [
          // Website order: the size/option picker first, then the item's groups.
          ...variantOptions,
          ...(primary.modifierGroups || [])
        ]
      : primary.modifierGroups
  };
}

function buildReviewedQuesoBirriasItem(): MenuItem {
  return {
    id: "reviewed-queso-birrias",
    name: "Queso Birrias",
    nameEs: "Queso Birrias",
    aliases: ["Queso Birrias", "queso birrias", "queso birria", "quesabirria", "quesabirrias"],
    priceCents: 1500,
    description: "Three queso birrias with consome. Choose street, flour, or comal.",
    modifierGroups: [
      {
        id: "reviewed-queso-birrias-options",
        name: "Queso Birria options",
        minSelections: 0,
        maxSelections: 1,
        options: [
          {
            id: "reviewed-queso-birrias-qst",
            name: "(QST) 3 x Queso Birrias Taquera / Street con Consome / Broth",
            priceDeltaCents: 0
          },
          {
            id: "reviewed-queso-birrias-qhr",
            name: "(QHR) 3 x Queso Birrias Harina / Flour con Consome / Broth",
            priceDeltaCents: 300
          },
          {
            id: "reviewed-queso-birrias-qco",
            name: "(QCO) 3 x Queso Birrias Comal / Homemade con Consome / Broth",
            priceDeltaCents: 500
          }
        ]
      },
      {
        id: "reviewed-queso-birrias-salsa",
        name: "Salsa Preferencia / Preference",
        minSelections: 0,
        maxSelections: 1,
        options: [
          { id: "reviewed-queso-birrias-salsa-mild-asada", name: "Mild Salsa Asada", priceDeltaCents: 0 },
          { id: "reviewed-queso-birrias-salsa-medium-verde", name: "Medium Salsa Verde", priceDeltaCents: 0 },
          { id: "reviewed-queso-birrias-salsa-hot-roja", name: "Hot Salsa Roja", priceDeltaCents: 0 }
        ]
      }
    ]
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
    matchers.push(/^(?:\([a-z0-9]+\)\s*)?(?:\d+\s*x\s*)?queso birrias?\b/i);
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
      selection_type?: string;
      min_selected_modifiers?: number;
      max_selected_modifiers?: number;
      modifiers?: Array<{
        id: string;
        modifier_data?: {
          name?: string;
          price_money?: { amount?: number };
          on_by_default?: boolean;
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
        allow_quantities?: boolean | string;
        modifier_overrides?: Array<{ modifier_id: string; on_by_default?: boolean; on_by_default_override?: string }>;
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

  function effectiveModifierRules(
    ml: { options: ModifierOption[]; selectionType?: string; listMin?: number; listMax?: number },
    itemMin?: number,
    itemMax?: number
  ) {
    const count = ml.options.length;
    const has = (v?: number) => typeof v === "number" && Number.isFinite(v) && v >= 0;
    const min = has(itemMin) ? Number(itemMin) : has(ml.listMin) ? Number(ml.listMin) : 0;
    let max = has(itemMax) ? Number(itemMax) : has(ml.listMax) ? Number(ml.listMax) : (ml.selectionType === "SINGLE" ? 1 : 0);
    if (max === 0) max = count; // 0 = unlimited
    return { minSelections: Math.min(min, count), maxSelections: Math.max(Math.min(min, count), Math.min(max, count)) };
  }

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
  const modifierListById = new Map<string, { name: string; options: ModifierOption[]; selectionType?: string; listMin?: number; listMax?: number; defaultIds: string[] }>();
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
      const data = object.modifier_list_data || {};
      modifierListById.set(object.id, {
        name,
        options,
        selectionType: data.selection_type,
        listMin: data.min_selected_modifiers,
        listMax: data.max_selected_modifiers,
        defaultIds: (data.modifiers || []).filter((m) => m.modifier_data?.on_by_default).map((m) => m.id)
      });
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
    // Drinks: the website sells the "(ONLINE)" items from BEBIDAS / DRINKS (Aguas Frescas, Pepsi, Jarrito...).
    const isOnlineDrink = /\(\s*online\s*\)/i.test(itemName) && categoryNames.some((name) => isOnlineDrinkCategoryName(name));
    // Anything the website sells (by Square item ID) is allowed, e.g. Rice / Beans Fiesta Pan.
    if (!hasOnlineCategory && !isOnlineDrink && !siteSellsSquareItem(object.id)) {
      continue;
    }

    // Build modifier groups sorted by prefix letter (A), (B), (C)…
    const modifierGroups: ModifierGroup[] = (object.item_data?.modifier_list_info || [])
      .filter((info) => info.enabled !== false && modifierListById.has(info.modifier_list_id))
      .map((info) => {
        const ml = modifierListById.get(info.modifier_list_id)!;
        // Same rules Square Online uses: item-level min/max of -1 (or missing) inherit the
        // modifier list's own min/max; if the list has none, SINGLE = pick 0-1, MULTIPLE = 0-any.
        // A max of 0 means "no limit".
        const rules = effectiveModifierRules(ml, info.min_selected_modifiers, info.max_selected_modifiers);
        const overrides = new Map((info.modifier_overrides || []).map((o) => [o.modifier_id, o]));
        const defaultOptions = ml.options
          .filter((option) => {
            const o = option.id ? overrides.get(option.id) : undefined;
            if (o?.on_by_default_override === "YES") return true;
            if (o?.on_by_default_override === "NO") return false;
            return Boolean(option.id && ml.defaultIds.includes(option.id));
          })
          .map((option) => option.name);
        return {
          id: info.modifier_list_id,
          name: ml.name,
          options: ml.options,
          minSelections: rules.minSelections,
          maxSelections: rules.maxSelections,
          ...(defaultOptions.length ? { defaultOptions } : {}),
          allowQuantities: typeof info.allow_quantities === "boolean" ? info.allow_quantities : false
        };
      })
      .sort((a, b) => {
        // The website's (A), (B), (C)… order (applySiteGroupRules then applies the storefront's exact order).
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
        modifierGroups: modifierGroups.length > 0 ? modifierGroups : undefined,
        ...(isOnlineDrink && !hasOnlineCategory
          ? {
              category: "drinks" as const,
              id: `sq-drink-${normalizeName(drinkDisplayName(fullName, variationName || "")).replace(/\s+/g, "-")}-${variation.id.slice(0, 6)}`,
              name: drinkDisplayName(fullName, variationName || ""),
              nameEs: drinkDisplayName(fullName, variationName || ""),
              aliases: [normalizeName(drinkDisplayName(fullName, variationName || "")), ...drinkAliases(fullName, variationName || "")]
            }
          : {})
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

/** "Coca Cola / Pepsi Pepsi" -> "Pepsi"; "Aguas Frescas Orchata 32oz" -> "Agua Fresca Horchata 32oz". */
function drinkDisplayName(fullName: string, variationName: string) {
  const v = sanitizeDisplayName(variationName);
  if (/aguas?\s+frescas?/i.test(fullName)) return `Agua Fresca ${v.replace(/\bOrchata\b/i, "Horchata")}`;
  if (/^jarrito/i.test(fullName)) return `Jarrito ${v}`;
  return v || fullName;
}

function isOnlineDrinkCategoryName(value: string) {
  const v = value.trim().toUpperCase();
  return v === "BEVERAGE (ONLINE)" || v === "BEBIDAS / DRINKS";
}

/** What callers say for each drink variation ("una horchata", "a pepsi", "jarrito de mango"). */
function drinkAliases(fullName: string, variationName: string) {
  const v = normalizeName(variationName);
  const n = normalizeName(fullName);
  const out = new Set<string>();
  const add = (...xs: string[]) => xs.forEach((x) => out.add(normalizeName(x)));
  if (/\baguas? frescas?\b/.test(n)) {
    const flavor = v.replace(/\b\d+\s*oz\b/g, "").trim();
    const spoken = flavor.replace(/\borchata\b/g, "horchata");
    for (const f of new Set([flavor, spoken])) {
      add(f, `${f}s`, `agua de ${f}`, `agua fresca ${f}`, `agua fresca de ${f}`, `${f} grande`, `${f} large`, `large ${f}`);
    }
  } else if (/\bjarrito\b/.test(n)) {
    for (const f of variationName.split("/").map((x) => x.trim()).filter(Boolean)) add(`jarrito ${f}`, `jarrito de ${f}`, `jarritos ${f}`, `${f} jarrito`);
  } else if (/\bmineral\b/.test(v)) {
    add("mineral water", "agua mineral", "sparkling water", "topo chico", "mineral");
  } else if (/\bagua\b|\bwater\b/.test(v)) {
    add("water", "a water", "waters", "water bottle", "bottle of water", "bottled water", "agua", "botella de agua", "water bottle");
  } else {
    add(v, `${v}s`);
    if (/\bcoca cola\b/.test(v)) add(v.replace("coca cola", "coke"), v.replace("coca cola", "coca"));
  }
  return Array.from(out).filter((x) => x.length > 2);
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

/** Read-only: orders created in a time window at this location (Square Orders Search, no writes). */
export async function searchOrdersReadOnly(startAt: string, endAt: string, config?: Partial<SquareRuntimeConfig>): Promise<any[]> {
  const cfg = getSquareConfig(config);
  if (!cfg.locationId) throw new Error("Missing SQUARE_LOCATION_ID");
  const out: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const body: any = {
      location_ids: [cfg.locationId],
      limit: 100,
      return_entries: false,
      query: { filter: { date_time_filter: { created_at: { start_at: startAt, end_at: endAt } } }, sort: { sort_field: "CREATED_AT", sort_order: "ASC" } },
      ...(cursor ? { cursor } : {})
    };
    const r = await squareRequest<{ orders?: any[]; cursor?: string }>("/v2/orders/search", { method: "POST", body: JSON.stringify(body) }, cfg);
    out.push(...(r.orders || []));
    if (!r.cursor) break;
    cursor = r.cursor;
  }
  return out;
}

/** Read-only: the given name on the Square customer with this phone (Customers Search). */
export async function findCustomerGivenNameReadOnly(phoneE164: string, config?: Partial<SquareRuntimeConfig>, signal?: AbortSignal): Promise<string | null> {
  const cfg = getSquareConfig(config);
  const r = await squareRequest<{ customers?: Array<{ given_name?: string; nickname?: string }> }>(
    "/v2/customers/search",
    { method: "POST", body: JSON.stringify({ limit: 1, query: { filter: { phone_number: { exact: phoneE164 } } } }), signal },
    cfg
  );
  const c = r.customers?.[0];
  return (c?.given_name || c?.nickname || "").trim() || null;
}

// ticketno1: read-only payment receipt (receipt_number + public receipt_url), cached per payment.
const receiptCache = new Map<string, { receiptNumber: string | null; receiptUrl: string | null }>();
export async function paymentReceiptReadOnly(paymentId: string, config?: Partial<SquareRuntimeConfig>) {
  if (!paymentId) return null;
  const hit = receiptCache.get(paymentId);
  if (hit) return hit;
  try {
    const r = await squareRequest<{ payment?: { receipt_number?: string; receipt_url?: string } }>(`/v2/payments/${encodeURIComponent(paymentId)}`, { method: "GET" }, getSquareConfig(config));
    const v = { receiptNumber: r.payment?.receipt_number || null, receiptUrl: r.payment?.receipt_url || null };
    receiptCache.set(paymentId, v);
    return v;
  } catch { return null; }
}

/** delivery2: food subtotal in cents (menu price or unitPriceCents + paid modifiers) × quantity. */
export function cartSubtotalCents(cart: CartItem[], menu: MenuItem[]): number {
  let t = 0;
  for (const c of cart || []) {
    const mi = menu.find((m) => m.id === c.id);
    const unit = Number(c.unitPriceCents ?? mi?.priceCents ?? 0);
    const mods = (c.modifiers || []).reduce((a, m) => a + Number(m.priceDeltaCents || 0) * Number(m.quantity || 1), 0);
    t += (unit + mods) * Math.max(1, Number(c.quantity) || 1);
  }
  return t;
}
