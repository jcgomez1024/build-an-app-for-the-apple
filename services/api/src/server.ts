import path from "node:path";
import { rememberOrderName } from "./order-name.js";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { chatWithElvi, transcribeElviAudio, quantityCorrection, recordLastAdd } from "./elvi.js";
import { createCheckout, getFullMenu, getMenu } from "./square.js";
import { rbFormat } from "./readback.js";
import { resolveMenuRequest } from "./menu-intelligence.js";
import { resolveEspecialRequest } from "./especial-resolver.js";
import { resolvePackMealRequest } from "./pack-meal-resolver.js";
import { attachRealtimeServer, createRealtimeSession } from "./realtime.js";
import { loadSiteCatalog, itemAvailability, unavailableNowReply, siteSellsSquareItem, completeWithSiteDefaults, dropUnaskedExtras, pinnedMenu, rescoreSingleChoices, withDefaultSalsa, fixBurritoFillings, fixNamedMeats, fixToppingNegations, salsaAsk, withoutSalsaWords, salsaAnswerWords, pickVariation, variationQuestion, followUpStep, withoutSkuWords } from "./site-catalog.js";
import { unavailableItemReply, answerMenuQuestion, requiredChoiceQuestion } from "./menu-info.js";
import { normalizeSpokenCatalogAliases } from "./text-intents.js";
import { getComboGuide, isGuidedCombo, isApprovedItem, getApprovedMenuItems } from "./guides.js";
import { extractReplacementBuildText } from "./text-intents.js";
import { preTurn } from "./pre-turn.js";
import { orderContextTurn, clearOrderContext, logTurn, pendingSummary } from "./order-context.js";
import { listPublicTenants, resolveTenant } from "./tenant.js";
import { getLaunchConfig, publicLaunchConfig } from "./launch-config.js";
import { registerTwilioRoutes, phoneAuth } from "./twilio.js";
import { rateLimit, gatedCheckoutConfig, CHECKOUT_CLOSED_MESSAGE, accessZone, PHONE_OK, ORDER_DENY, loginPage, hitLimit, clientIp, passwordOk, makePreviewCookie, previewCookieOk } from "./customer-guard.js";
import fs from "node:fs";
import { detectFulfillment, detectAddress, ticketFulfillment, scoreFulfillment } from "./delivery.js";
import { quoteDeliveryAddress } from "./delivery-zone.js";
import { deliveryFeeLine, squareRefs } from "./call-accuracy.js";
import { loadPosCatalog, toPosLines } from "./pos-catalog.js";
import { auditorFindingsByCall } from "./auditor.js";
import { paymentReceiptReadOnly } from "./square.js";
import { loadCalls, elviLines, ticketLines, matchTicket, scoreOrder, trend, callsDir, loadExpected, saveExpected, nameMatchForCall } from "./call-accuracy.js";
import { planCallerName, saveCallerName } from "./caller-memory.js";
import { onCallerNameSaved } from "./twilio.js";
import { shadowOrderFromTurns } from "./call-scoring.js";
import { searchOrdersReadOnly, findCustomerGivenNameReadOnly } from "./square.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
// custapp1: customer-app launch flags live here (not in .env)
dotenv.config({ path: path.resolve(__dirname, "../.env.custapp") });
dotenv.config();

const app = express();
// legal1: public Privacy Policy / Terms (Twilio A2P campaign) on any allowed host, no PIN/password. Static files only.
const LEGAL_DIR = path.resolve(__dirname, "../legal");
app.get(/^\/(privacy|terms)(\.html)?\/?$/, (req, res, next) => {
  if (accessZone(req) === "none") return next();
  const name = req.path.includes("privacy") ? "privacy.html" : "terms.html";
  res.setHeader("Cache-Control", "public, max-age=300");
  res.sendFile(path.join(LEGAL_DIR, name));
});
// order1: host-based public access. Localhost unrestricted; elvi host = phone only;
// order host = password-gated customer app (no staff/phone routes); any other tunneled host = 404.
app.use((req, res, next) => {
  const zone = accessZone(req);
  if (zone === "local") return next();
  if (zone === "phone") return PHONE_OK.test(req.path) ? next() : void res.status(404).type("text/plain").send("Not found");
  if (zone !== "order" || ORDER_DENY.test(req.path)) return void res.status(404).type("text/plain").send("Not found");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.path === "/health") return next();
  if (req.path === "/preview-login") {
    if (req.method === "GET") return void res.type("html").send(loginPage());
    if (req.method !== "POST") return void res.status(405).end();
    const lim = hitLimit("preview-login", clientIp(req), 8, 15 * 60_000);
    if (lim.limited) { res.setHeader("Retry-After", String(lim.retryAfterSec)); return void res.status(429).type("html").send(loginPage("Demasiados intentos. Espera unos minutos. / Too many tries, wait a few minutes.")); }
    return express.urlencoded({ extended: false, limit: "2kb" })(req, res, () => {
      const pw = String((req.body as any)?.password || "");
      const cookie = passwordOk(pw) ? makePreviewCookie() : null;
      if (!cookie) return void res.status(401).type("html").send(loginPage("Contraseña incorrecta / Wrong password"));
      res.setHeader("Set-Cookie", cookie);
      res.redirect(303, "/");
    });
  }
  if (previewCookieOk(req)) return next();
  if (req.path.startsWith("/api/")) return void res.status(401).json({ error: "Login required" });
  res.status(401).type("html").send(loginPage());
});
const port = Number(process.env.PORT || 4000);

type Language = "en" | "es";

function resolveDefaultTenant(host: string | undefined) {
  return resolveTenant(host);
}

function buildSquareConfig(tenant: ReturnType<typeof resolveTenant>) {
  return {
    env: tenant.square.env,
    accessToken: tenant.square.accessToken,
    locationId: tenant.square.locationId,
    apiVersion: tenant.square.apiVersion,
    appPublicUrl: process.env.APP_PUBLIC_URL || "http://localhost:4000",
    businessName: tenant.branding.displayName
  };
}

function extractZip(address: string) {
  const match = address.match(/\b\d{5}(?:-\d{4})?\b/);
  return (match?.[0] || "").slice(0, 5);
}

function checkDeliveryZone(address: string) {
  const allowed = new Set(
    String(process.env.DELIVERY_ZONE_ZIPS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
  const blocked = new Set(
    String(process.env.DELIVERY_ZONE_BLOCKED_ZIPS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
  const allowAll = allowed.size === 0;
  const zip = extractZip(address);
  if (!zip) {
    return {
      ok: false,
      in_zone: false,
      message: "Could not detect ZIP code. Please provide full address with ZIP."
    };
  }
  if (blocked.has(zip)) {
    return { ok: true, in_zone: false, zip, message: `ZIP ${zip} is outside delivery zone.` };
  }
  if (allowAll || allowed.has(zip)) {
    return { ok: true, in_zone: true, zip, message: `Great news, we deliver to ZIP ${zip}.` };
  }
  return { ok: true, in_zone: false, zip, message: `ZIP ${zip} is outside delivery zone.` };
}

function submitOrderPreview(input: Record<string, unknown>) {
  const items = Array.isArray(input.items) ? input.items : [];
  const subtotalArg = Number(input.subtotal);
  const subtotalItems = items.reduce((sum, row) => {
    const value = row as Record<string, unknown>;
    const qty = Math.max(1, Number(value.quantity) || 1);
    const price = Math.max(0, Number(value.price) || 0);
    return sum + qty * price;
  }, 0);
  const subtotal = Number.isFinite(subtotalArg) && subtotalArg > 0 ? subtotalArg : subtotalItems;
  const taxRate = Math.max(0, Number(process.env.SALES_TAX_RATE || 0.08875));
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  const etaMin = Math.max(10, Number(process.env.ORDER_ETA_MIN || 25));
  const etaMax = Math.max(etaMin, Number(process.env.ORDER_ETA_MAX || 35));
  return {
    ok: true,
    status: "submitted",
    order_id: `ELV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    subtotal,
    tax,
    total,
    currency: "USD",
    estimated_time: `${etaMin}-${etaMax} minutes`
  };
}

async function synthesizeSpeech(tenant: ReturnType<typeof resolveTenant>, text: string, language: Language) {
  const apiKey = tenant.xai.apiKey || process.env.XAI_API_KEY;
  const voice = language === "es"
    ? (process.env.XAI_VOICE_ID_ES || process.env.XAI_VOICE_ID || "Eve")
    : (process.env.XAI_VOICE_ID || "Eve");

  if (!apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }
  if (!text.trim()) {
    throw new Error("text is required");
  }

  const response = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: text.trim().slice(0, 400),
      voice_id: voice.toLowerCase(),
      language
    })
  });

  if (!response.ok) {
    throw new Error(`xAI speech failed (${response.status})`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) {
    throw new Error("xAI speech returned empty audio");
  }

  return {
    ok: true,
    engine: "xai",
    voice,
    mimeType: response.headers.get("content-type") || "audio/mpeg",
    audioBase64: audio.toString("base64")
  };
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));
// custapp1: per-IP rate limits on customer ordering routes (phone system routes are not limited)
app.use(["/api/orders/checkout", "/api/:tenant/orders/checkout"], rateLimit("checkout", 5, 10 * 60_000));
app.use(["/api/realtime/session", "/api/:tenant/realtime/session", "/api/:tenant/xai/client-secret"], rateLimit("voice-token", 10, 10 * 60_000));
app.use(["/api/:tenant/xai/speech", "/api/:tenant/xai/transcribe"], rateLimit("voice-media", 120, 10 * 60_000));
app.use(["/api/menu/resolve", "/api/:tenant/menu/resolve", "/api/elvi/chat", "/api/:tenant/elvi/chat", "/api/menu/info", "/api/:tenant/menu/info", "/api/:tenant/tools/submit_order", "/api/:tenant/tools/check_delivery_zone"], rateLimit("order", 120, 10 * 60_000));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "cocina-elvis-api" });
});

app.get("/api/tenants", (_req, res) => {
  res.json({ tenants: listPublicTenants() });
});

app.get("/api/config", (_req, res) => {
  res.json(publicLaunchConfig());
});

app.get("/api/:tenant/menu", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
    const items = await getMenu(buildSquareConfig(tenant));
    res.json({ items, tenant: tenant.slug });
  } catch (error) {
    next(error);
  }
});

// ui1: the website's categories (site order) with the menu item ids in each and whether they sell right now.
app.get("/api/:tenant/ui/catalog", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
    const items = await getMenu(buildSquareConfig(tenant));
    const cat = loadSiteCatalog();
    // ui5: website order — categories as the feed lists them, items by the category's preferred order,
    // plus the site's "Most popular" row (top 4 by popularity) first. Closed/timed ones are kept (shown greyed).
    const ordered = (c: any, list: any[]) => {
      const order: string[] = c.productOrder || [];
      const at = (p: any) => { const i = order.indexOf(String(p.siteProductId)); return i < 0 ? 999 : i; };
      return [...list].sort((a, b) => at(a) - at(b));
    };
    const popular = { name: "MOST POPULAR", popular: true, customTimes: false, productOrder: [] as string[] };
    const popularProducts = [...(cat?.products || [])].sort((a: any, b: any) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 4);
    const categories = [popular, ...(cat?.categories || [])].map((c: any) => {
      const products = c.popular ? popularProducts : ordered(c, (cat?.products || []).filter((p) => p.categories.includes(c.name)));
      const ids = products.flatMap((p) => items.filter((m: any) => m.squareCatalogObjectId === p.squareId).map((m: any) => ({ id: m.id, product: p.name })));
      const first = ids[0] && items.find((m: any) => m.id === ids[0].id);
      const a = first ? itemAvailability((first as any).squareCatalogObjectId) : { available: true };
      return { name: c.name, ...(c.popular ? { popular: true } : {}), customTimes: c.customTimes, available: c.popular ? true : a.available, today: (a as any).today || "", window: (a as any).window || null,
        items: ids.map((x: any) => { const m: any = items.find((it: any) => it.id === x.id); const ia: any = c.popular ? itemAvailability(m?.squareCatalogObjectId) : a; return { ...x, available: ia.available, window: ia.window || null }; }) };
    }).filter((c) => c.items.length);
    res.json({ categories, store: { timezone: cat?.store?.timezone, prepMinutes: cat?.store?.prepMinutes } });
  } catch (error) {
    next(error);
  }
});

app.get("/api/menu", async (req, res, next) => {
  try {
    const tenant = resolveDefaultTenant(req.headers.host);
    const items = await getMenu(buildSquareConfig(tenant));
    res.json({ items, tenant: tenant.slug });
  } catch (error) {
    next(error);
  }
});

function buildResolverInput(body: unknown) {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const toolArgs = input.toolArgs && typeof input.toolArgs === "object"
    ? normalizeResolverToolArgs(input.toolArgs as Record<string, unknown>)
    : undefined;
  return {
    text: typeof input.text === "string" ? normalizeSpokenCatalogAliases(input.text) : "",
    language: (input.language === "es" ? "es" : "en") as Language,
    actionHint: typeof input.actionHint === "string" ? input.actionHint : undefined,
    toolArgs,
    cart: Array.isArray(input.cart) ? input.cart : [],
    comboState: input.comboState && typeof input.comboState === "object" ? input.comboState : undefined
  };
}

function normalizeResolverToolArgs(toolArgs: Record<string, unknown>) {
  const normalized = { ...toolArgs };
  for (const key of ["itemQuery", "itemId"]) {
    if (typeof normalized[key] === "string") {
      normalized[key] = normalizeSpokenCatalogAliases(normalized[key] as string);
    }
  }
  return normalized;
}


function normalizeResolverText(text: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBuildCancelIntent(text: string) {
  const normalized = normalizeResolverText(text);
  if (!normalized) return false;
  return /\b(never\s*mind|nevermind|forget\s+it|cancel|start\s+over|something\s+else|another\s+item|different\s+item|olvida|cancelar|cancela|empezar\s+de\s+nuevo|otra\s+cosa|otro\s+producto|otro\s+item)\b/.test(normalized);
}

function isBuildInterruptIntent(text: string) {
  const normalized = normalizeResolverText(text);
  if (!normalized) return false;
  return isBuildCancelIntent(normalized) || /\b(instead|rather|mejor|mejor\s+dame|mejor\s+quiero|en\s+vez|cambio\s+a)\b/.test(normalized);
}

function buildCancelledResult(language: string) {
  const es = language === "es";
  return {
    ok: true,
    reason: "build_cancelled",
    message: es ? "Cancelado. ¿Qué quieres ordenar?" : "Cancelled. What would you like to order?",
    actions: []
  };
}

function resolverText(input: ReturnType<typeof buildResolverInput>) {
  return input.text || String((input.toolArgs as Record<string, unknown> | undefined)?.itemQuery || "");
}

function isGenericComboRequest(text: string) {
  const normalized = normalizeResolverText(text);
  if (!/\b(combo|combos|combinacion|combinaciones)\b/.test(normalized)) return false;
  return !/\b(taco|tacos|quesadilla|quesadillas|burrito|mix|mixto|gordita|gorditas|torta|tortas)\b/.test(normalized);
}

function isGenericPackMealRequest(text: string) {
  const normalized = normalizeResolverText(text);
  if (!isPackMealIntentText(normalized)) return false;
  return !/\b([3-8]|three|four|five|six|seven|eight|tres|cuatro|cinco|seis|siete|ocho)\b/.test(normalized);
}

function isPackMealIntentText(normalized: string) {
  return /\b(pack\s+meals?|meals?\s+pack|packs?|paquetes?)\b/.test(normalized) ||
    /\bpaquetes?\s+(?:de\s+)?(?:comida|meal|meals)\b/.test(normalized) ||
    /\bpack\s+(?:de\s+)?comida\b/.test(normalized);
}

function unsupportedPackMealRequest(text: string) {
  const normalized = normalizeResolverText(text);
  if (!/\b(pack|packs|paquete|paquetes)\b/.test(normalized)) return false;
  const unsupportedCount = "(?:1|2|9|1[0-9]|20|two|nine|ten|dos|nueve|diez)";
  return new RegExp(
    `\\b${unsupportedCount}\\s+(?:pack\\s+)?meals?\\b`
    + `|\\b${unsupportedCount}\\s+packs?\\b`
    + `|\\b(?:meal\\s+pack|meals\\s+pack|pack|packs)(?:\\s+(?:of|de))?\\s+${unsupportedCount}\\b`
    + `|\\bpaquetes?(?:\\s+de)?\\s+${unsupportedCount}\\b`
    + `|\\b${unsupportedCount}\\s+paquetes?\\b`
  ).test(normalized);
}

function buildUnsupportedPackMealResult(items: Awaited<ReturnType<typeof getFullMenu>>, language: string) {
  const es = language === "es";
  const options = packMealMenuItems(items).map((item) => {
    const count = normalizeResolverText(item.name).match(/^([3-8])\s+pack\s+meal\b/)?.[1] || "";
    return `${count} Pack MEAL`;
  });
  return {
    ok: false,
    reason: "unknown_menu_item",
    message: es
      ? `No tenemos ese tamaño de paquete. Opciones disponibles: ${options.join(", ")}.`
      : `That pack size is not on the menu. Available pack meals are: ${options.join(", ")}.`,
    selectedItem: null,
    actions: []
  };
}

function isComboSelectionState(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return raw.ruleId === "combo-selection" && raw.itemId === "combo-selection";
}

function isPackMealSelectionState(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return raw.ruleId === "pack-meal-selection" && raw.itemId === "pack-meal-selection";
}

function comboSelectionPhrase(text: string) {
  const normalized = normalizeResolverText(text);
  if (/\b(burrito|burritos)\b/.test(normalized)) return "combo burrito";
  if (/\b(mix|mixto)\b/.test(normalized)) return "combo mix";
  if (/\b(gordita|gorditas)\b/.test(normalized)) return "combo gorditas";
  if (/\b(torta|tortas)\b/.test(normalized)) return "combo tortas";
  if (/\b(quesadilla|quesadillas)\b/.test(normalized)) return "combo quesadillas";
  if (/\b(taco|tacos)\b/.test(normalized)) return "combo tacos";
  return "";
}

function comboSelectionPhraseFromInput(
  input: ReturnType<typeof buildResolverInput>,
  items: Awaited<ReturnType<typeof getFullMenu>>
) {
  const args = (input.toolArgs || {}) as Record<string, unknown>;
  const candidates = [
    resolverText(input),
    typeof args.itemQuery === "string" ? args.itemQuery : "",
    typeof args.query === "string" ? args.query : "",
    typeof args.itemId === "string"
      ? items.find((item) => item.id === args.itemId)?.name || args.itemId
      : ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    const phrase = comboSelectionPhrase(String(candidate));
    if (phrase) return phrase;
  }
  return "";
}

function packMealSelectionPhrase(text: string) {
  const normalized = normalizeResolverText(text);
  const wordCounts: Record<string, number> = {
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8
  };
  const numeric = normalized.match(/\b([3-8])\b/);
  if (numeric) return `${numeric[1]} pack meal`;
  for (const [word, count] of Object.entries(wordCounts)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return `${count} pack meal`;
  }
  return "";
}

function comboMenuItems(items: Awaited<ReturnType<typeof getFullMenu>>) {
  const order = ["combo tacos", "combo quesadillas", "combo burrito", "combo mix", "combo gorditas", "combo tortas"];
  return items
    .filter((item) => normalizeResolverText(item.name).startsWith("combo "))
    .sort((a, b) => {
      const aIndex = order.indexOf(normalizeResolverText(a.name));
      const bIndex = order.indexOf(normalizeResolverText(b.name));
      return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || a.name.localeCompare(b.name);
    });
}

function packMealMenuItems(items: Awaited<ReturnType<typeof getFullMenu>>) {
  const seen = new Map<number, Awaited<ReturnType<typeof getFullMenu>>[number]>();
  for (const item of items) {
    const match = normalizeResolverText(item.name).match(/^([3-8])\s+pack\s+meal\b/);
    if (!match) continue;
    const count = Number(match[1]);
    const current = seen.get(count);
    if (!current || Number(item.priceCents) < Number(current.priceCents)) {
      seen.set(count, item);
    }
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
}

function buildGuideStartMessage(guide: NonNullable<ReturnType<typeof getComboGuide>>, language: Language = "en") {
  const first = guide.steps?.find((step) => step.mode === "ask" || (step.mode === undefined && step.required)) || guide.steps?.[0];
  const prompt = first?.title || "Let's build it step by step.";
  return language === "es"
    ? `Empezando ${guide.display_name}. ${prompt}.`
    : `Starting ${guide.display_name}. ${prompt}.`;
}

function formatCents(cents: unknown) {
  const value = Math.max(0, Number(cents) || 0);
  return `$${(value / 100).toFixed(2)}`;
}

function buildComboSelectionResult(items: Awaited<ReturnType<typeof getFullMenu>>, language: string) {
  const es = language === "es";
  const options = comboMenuItems(items).map((item) => `${item.name} - ${formatCents(item.priceCents)}`);
  const question = es ? "¿Qué combo: tacos, quesadillas, burrito, mix, gorditas o tortas?" : "Which combo: tacos, quesadillas, burrito, mix, gorditas or tortas?";
  return {
    ok: false,
    reason: "combo_step_required",
    message: question,
    selectedItem: {
      itemId: "combo-selection",
      name: "Combos",
      description: options.join(", ")
    },
    comboState: {
      ruleId: "combo-selection",
      itemId: "combo-selection",
      itemName: "Combos",
      selections: [],
      virtualSelections: [],
      awaitingStepKey: "combo-selection"
    },
    comboStep: {
      itemName: "Combos",
      step: 1,
      totalSteps: 1,
      stepKey: "combo-selection",
      stepName: es ? "Elige combo" : "Choose combo",
      question,
      options,
      selections: []
    },
    buildProgress: toBuildProgress({ itemName: "Combos", step: 1, totalSteps: 1, stepName: es ? "Elige combo" : "Choose combo", options }, null)
  };
}

function buildPackMealSelectionResult(items: Awaited<ReturnType<typeof getFullMenu>>, language: string) {
  const es = language === "es";
  const options = packMealMenuItems(items).map((item) => {
    const count = normalizeResolverText(item.name).match(/^([3-8])\s+pack\s+meal\b/)?.[1] || "";
    return `${count} Pack MEAL - from ${formatCents(item.priceCents)}`;
  });
  const question = es ? "¿Cuál paquete quieres? Las opciones están abajo." : "Which meal pack would you like? Options are below.";
  return {
    ok: false,
    reason: "combo_step_required",
    message: question,
    selectedItem: {
      itemId: "pack-meal-selection",
      name: "Meal Packs",
      description: options.join(", ")
    },
    comboState: {
      ruleId: "pack-meal-selection",
      itemId: "pack-meal-selection",
      itemName: "Meal Packs",
      selections: [],
      virtualSelections: [],
      awaitingStepKey: "pack-meal-selection"
    },
    comboStep: {
      itemName: "Meal Packs",
      step: 1,
      totalSteps: 1,
      stepKey: "pack-meal-selection",
      stepName: es ? "Elige paquete" : "Choose meal pack",
      question,
      options,
      selections: []
    },
    buildProgress: toBuildProgress({ itemName: "Meal Packs", step: 1, totalSteps: 1, stepName: es ? "Elige paquete" : "Choose meal pack", options }, null)
  };
}

function toBuildProgress(comboStep: any, comboState: any): any {
  if (!comboStep && !comboState) return undefined;
  const step = Number(comboStep?.step || comboState?.step || 1);
  const total = Number(comboStep?.totalSteps || comboState?.totalSteps || 1);
  return {
    active: true,
    itemId: comboStep?.itemId || comboState?.itemId,
    itemName: comboStep?.itemName || comboState?.itemName || "Build",
    step,
    totalSteps: total,
    stepName: comboStep?.stepName || comboState?.awaitingStepKey || "",
    completedSelections: comboStep?.selections || comboState?.selections || [],
    currentOptions: comboStep?.options || comboStep?.stepOptions || []
  };
}

function withComboSelectionPhrase(input: ReturnType<typeof buildResolverInput>, phrase: string) {
  return {
    ...input,
    text: phrase,
    toolArgs: {
      ...((input.toolArgs || {}) as Record<string, unknown>),
      itemQuery: phrase
    },
    comboState: undefined
  };
}

function withPackMealSelectionPhrase(input: ReturnType<typeof buildResolverInput>, phrase: string) {
  return {
    ...input,
    text: phrase,
    toolArgs: {
      ...((input.toolArgs || {}) as Record<string, unknown>),
      itemQuery: phrase
    },
    comboState: undefined
  };
}

function withReplacementBuildText(input: ReturnType<typeof buildResolverInput>, replacement: string) {
  return {
    ...input,
    text: replacement,
    toolArgs: {
      ...((input.toolArgs || {}) as Record<string, unknown>),
      itemQuery: replacement
    },
    comboState: undefined
  };
}

/** fix11: the web menu lists one variation per pack, so send the exact item (8 Pack · Tacos Comal). */
function contextSelectedItem(items: any[], itemId?: string) {
  const it = itemId && items.find((m: any) => m.id === itemId);
  return it ? { itemId: it.id, name: it.name, priceCents: it.priceCents, readbackName: it.readbackName, modifierGroups: it.modifierGroups } : undefined;
}

/** Order session id sent by the web app (orderSessionId); the voice socket uses its own session id. */
function orderSessionKey(body: any): string | undefined {
  const k = String(body?.orderSessionId || "").trim();
  return /^[a-zA-Z0-9_-]{6,64}$/.test(k) ? k : undefined;
}

// Background turn log (data/logs/sessions/*.jsonl, gitignored): heard text, result, pending dish, actions.
app.use(["/api/menu/resolve", "/api/:tenant/menu/resolve", "/api/elvi/chat", "/api/:tenant/elvi/chat"], (req, res, nextFn) => {
  const key = orderSessionKey(req.body);
  if (key) {
    const json = res.json.bind(res);
    (res as any).json = (body: any) => {
      if (res.locals.resolvedText && body && typeof body === "object" && !body.resolvedText) {
        body.resolvedText = res.locals.resolvedText;
        if (!("orderContext" in body)) body.orderContext = pendingSummary(key) || null;
      }
      logTurn(key, {
        channel: req.path.includes("resolve") ? "web-resolve" : "chat",
        heard: req.body?.text || req.body?.transcript || "",
        interpretation: body?.reason || (body?.ok ? "ok" : undefined),
        pending: pendingSummary(key),
        actions: (body?.actions || []).filter((a: any) => a?.type === "add_item").map((a: any) => `${a.quantity || 1}x ${a.itemId} [${(a.modifiers || []).map((m: any) => m.option).join(", ")}]`),
        reply: body?.message || body?.reply || ""
      });
      return json(body);
    };
  }
  nextFn();
});

// fix16 (Carlos): included mild Salsa Asada by default on every resolver add (web + voice on the web app).
// Menu items come from res.locals.menuItems (set by both resolve routes).
// fix17: registered after the turn log, so the log records the actions with the salsa default.
const salsaPending = new Map<string, { text: string; at: number }>();
const SALSA_QUESTION = (es: boolean) => es ? "¿Qué salsa: asada o tomate (mild), verde (medium) o roja (hot)?" : "Which salsa: asada or tomato (mild), verde (medium), or roja (hot)?";
function setResolverText(body: any, text: string) {
  if ("transcript" in body) { body.transcript = text; return; }
  body.text = text;
  body.toolArgs = { ...(body.toolArgs || {}), itemQuery: text };
}
// fix19: quantity corrections ("no, mejor tres") on the web/voice resolver path, same rule as chat.
app.use(["/api/menu/resolve", "/api/:tenant/menu/resolve"], async (req, res, nextFn) => {
  const body = req.body || {};
  const key = orderSessionKey(body);
  if (!key) return nextFn();
  try {
    const text = String(body.text || body.toolArgs?.itemQuery || "");
    if (!body.comboState && text) {
      const tenant = resolveTenant(String((req.params as any).tenant || req.headers.host || ""));
      const menu = await getFullMenu(buildSquareConfig(tenant));
      const fixed = quantityCorrection({ sessionKey: key, transcript: text, language: body.language === "es" ? "es" : "en", menu });
      if (fixed) {
        recordLastAdd(key, fixed.actions);
        res.json({ ok: true, actions: fixed.actions, message: fixed.reply, orderContext: { correction: true } });
        return;
      }
    }
  } catch { /* fall through to the normal resolver */ }
  const json = res.json.bind(res);
  (res as any).json = (out: any) => { try { if (out?.ok !== false) recordLastAdd(key, out?.actions); } catch {} return json(out); };
  nextFn();
});

app.use(["/api/menu/resolve", "/api/:tenant/menu/resolve", "/api/elvi/chat", "/api/:tenant/elvi/chat"], (req, res, nextFn) => {
  // fix17: conflicting salsas ("verde hot") ask once, like the guided combos; the answer finishes the dish.
  const body = req.body || {};
  const isChat = String(req.originalUrl || "").includes("/elvi/chat");
  const said = String((isChat ? body.transcript : body.text || body.toolArgs?.itemQuery) || "");
  const sKey = orderSessionKey(body) || "";
  const es = body.language === "es";
  const waiting = sKey ? salsaPending.get(sKey) : undefined;
  if (waiting && Date.now() - waiting.at < 15 * 60 * 1000) {
    salsaPending.delete(sKey);
    const words = salsaAnswerWords(said);
    if (words !== null) setResolverText(body, `${waiting.text} ${words}`.trim());
  } else if (!body.comboState && (body.actionHint || "add_item") === "add_item" && salsaAsk(said).kind === "conflict") {
    const dish = withoutSalsaWords(said);
    if (dish && dish !== said) {
      if (sKey) salsaPending.set(sKey, { text: dish, at: Date.now() });
      res.json(isChat
        ? { language: es ? "es" : "en", engine: "rules", reply: SALSA_QUESTION(es), actions: [] }
        : { ok: false, reason: "clarify", message: SALSA_QUESTION(es), orderContext: { clarify: true, salsa: true } });
      return;
    }
  }
  if (isChat) { nextFn(); return; } // chat adds get the salsa default in elvi.ts
  const json = res.json.bind(res);
  (res as any).json = (body: any) => {
    try {
      const items: any[] = res.locals.menuItems || [];
      if (body && Array.isArray(body.actions) && items.length) {
        const said = [req.body?.comboState?.said, res.locals.resolvedText || req.body?.text || req.body?.toolArgs?.itemQuery || ""].filter(Boolean).join(" ");
        const next = withDefaultSalsa(fixToppingNegations(fixNamedMeats(fixBurritoFillings(body.actions, items, said, "resolver"), items, said, "resolver"), items, said, "resolver"), items, said, "resolver");
        if (JSON.stringify(next) !== JSON.stringify(body.actions)) {
          body.actions = next;
          const lang = req.body?.language === "es" ? "es" : "en";
          if (typeof body.message === "string" && /(¿Algo más\?|Anything else\?)\s*$/.test(body.message)) {
            body.message = rbFormat(next.filter((a: any) => a?.type === "add_item").map((a: any) => {
              const it = items.find((m: any) => m.id === a.itemId);
              const q = Number(a.quantity) || 1;
              return { name: it?.name || "", alt: it?.readbackName, quantity: q, mods: (a.modifiers || []).map((m: any) => ({ option: m.option, group: m.groupName || m.step, quantity: m.quantity })), cents: ((it?.priceCents || 0) + (a.modifiers || []).reduce((c: number, m: any) => c + (Number(m.priceDeltaCents) || 0) * (Number(m.quantity) || 1), 0)) * q };
            }), lang);
          }
        }
      }
    } catch { /* never block the reply */ }
    return json(body);
  };
  nextFn();
});


app.post("/api/:tenant/menu/resolve", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
	    const items = await getFullMenu(buildSquareConfig(tenant));
	    res.locals.menuItems = items;
	    let input = buildResolverInput(req.body);
	    let text = resolverText(input);
	    // fix11: packs ("8 tacos" → 8 Pack) and the chicharrón question run first.
	    const pre = preTurn(orderSessionKey(req.body), text, items as any, (input as any).language || "en", { hasComboState: Boolean(input.comboState) });
	    if (pre.adds?.length) { res.json({ ok: true, message: pre.reply, actions: pre.adds.map((a: any) => ({ type: "add_item", itemId: a.itemId, quantity: a.quantity, modifiers: [...a.modifiers.map((m: any) => ({ ...m, quantity: 1 })), ...(a.unknownMeat ? [{ groupName: "meat_needs_ask", option: a.unknownMeat, quantity: 1 }] : [])] })), orderContext: null, selectedItem: contextSelectedItem(items as any, pre.adds[0].itemId) }); return; }
	    if (pre.reply) { res.json({ ok: false, reason: "clarify", message: pre.reply, orderContext: { clarify: true } }); return; }
	    if (pre.text !== text) {
	      text = pre.text;
	      input = { ...input, text, toolArgs: { ...((input.toolArgs || {}) as Record<string, unknown>), itemQuery: text } } as any;
	      res.locals.resolvedText = text;
	    }
	    // Persistent order context: a pending dish ("4 tacos 2 bistec") gets this answer first.
	    const ctxTurn = orderContextTurn(orderSessionKey(req.body), text, items as any, (input as any).language || "en");
	    if (ctxTurn) {
	      res.json(ctxTurn.adds.length
	        ? { ok: true, message: ctxTurn.reply, actions: ctxTurn.adds.map((a) => ({ type: "add_item", ...a, modifiers: a.modifiers.map((m) => ({ ...m, quantity: 1 })) })), orderContext: pendingSummary(orderSessionKey(req.body)), selectedItem: contextSelectedItem(items as any, ctxTurn.adds[0]?.itemId) }
	        : { ok: false, reason: "order_context", message: ctxTurn.reply, orderContext: pendingSummary(orderSessionKey(req.body)) });
	      return;
	    }
	    if (input.comboState && isBuildInterruptIntent(text)) {
	      const replacement = extractReplacementBuildText(text);
	      if (replacement) {
	        input = withReplacementBuildText(input, replacement);
	        text = resolverText(input);
	      } else if (isBuildCancelIntent(text)) {
	        res.json(buildCancelledResult(input.language));
	        return;
	      }
	    }

    if (isComboSelectionState(input.comboState)) {
      const phrase = comboSelectionPhraseFromInput(input, items);
      if (!phrase) {
        res.json(buildComboSelectionResult(items, input.language));
        return;
      }
      input = withComboSelectionPhrase(input, phrase);
      text = resolverText(input);
    } else if (isPackMealSelectionState(input.comboState)) {
      const phrase = packMealSelectionPhrase(text);
      if (!phrase) {
        res.json(buildPackMealSelectionResult(items, input.language));
        return;
      }
      input = withPackMealSelectionPhrase(input, phrase);
      text = resolverText(input);
    }

    // === Root-cause guard: consult the single source of truth (combo-guide.json) first ===
    // If the current context matches any guided combo (fuzzy name match), we must never
    // emit the legacy hardcoded "elige una opción / las opciones están abajo" (or English)
    // from buildComboSelectionResult / buildPackMealSelectionResult. Those paths are bypassed.
    const cs = (input.comboState || {}) as Record<string, any>;
    const candidateNames = [
      text,
      cs.itemName,
      cs.ruleId,
      cs.itemId,
      cs.originalItemName
    ].filter(Boolean) as string[];
    const hasGuide = candidateNames.some((name) => getComboGuide(name) !== null);

    if (unsupportedPackMealRequest(text)) {
      res.json(buildUnsupportedPackMealResult(items, input.language));
      return;
    }

    if (!hasGuide) {
      if (isGenericComboRequest(text)) {
	        res.json(buildComboSelectionResult(items, input.language));
	        return;
	      } else if (isGenericPackMealRequest(text)) {
	        res.json(buildPackMealSelectionResult(items, input.language));
	        return;
	      }
    }
    // When hasGuide is true we skip the legacy early returns entirely. The normal resolver
    // runs, the guide is attached below, and any stray legacy fields are stripped.

    // Web follow-up to "Gordita: Bistec, Cabeza…?": answer it for that dish (same rule as chat / voice).
    const follow: any = (input as any).comboState?.ruleId === "site-followup" ? (input as any).comboState : null;
    let pinned = pinnedMenu(text, items as any) as typeof items;
    let resolveInput: any = input;
    let followResult: any = null;
    let followChosen: any[] = [];
    if (follow) {
      const dish = (items as any[]).filter((m: any) => m.squareCatalogObjectId === follow.squareId);
      const startsOver = pinned.length < items.length && !pinned.some((m: any) => m.squareCatalogObjectId === follow.squareId);
      if (dish.length && !startsOver) {
        const run = (t: string) => {
          const inp: any = { ...input, text: t, transcript: t, toolArgs: { ...((input as any).toolArgs || {}), itemQuery: t }, comboState: undefined };
          const list = pickVariation(t, dish as any) as any;
          if ((dish as any[]).length > 1) { const q = withoutSkuWords(t, list, dish as any); inp.text = q; inp.transcript = q; inp.toolArgs = { ...(inp.toolArgs || {}), itemQuery: q }; }
          return completeWithSiteDefaults(resolveEspecialRequest(list, inp) || resolveMenuRequest(list, inp), items as any, t);
        };
        const step = followUpStep(run, String(follow.said || ""), Array.isArray(follow.chosen) ? follow.chosen : [], text, items as any, (input as any).language || "en");
        followResult = step.result;
        followChosen = step.chosen;
        resolveInput = { ...input, text: step.said, transcript: step.said, comboState: undefined };
      }
    }
    let result: any = followResult || resolvePackMealRequest(pinned, resolveInput) || resolveEspecialRequest(pinned, resolveInput) || resolveMenuRequest(pinned, resolveInput);
    const saidSoFar = String(resolveInput.text || text);

	    // Attach combo guide if the resolved item is a guided combo (for model injection)
	    const anyResult = result as any;
	    if (anyResult && anyResult.selectedItem?.name) {
	      const guide = getComboGuide(anyResult.selectedItem.name);
	      if (guide) {
	        anyResult.guide = guide;
        // When a guide is attached, suppress EVERY legacy combo/pack FSM artifact
        // so the model and UI only ever see questions defined in combo-guide.json.
        delete anyResult.comboStep;
        delete anyResult.comboState;
        delete anyResult.awaitingStepKey;
        delete anyResult.stepKey;
	        anyResult.message = buildGuideStartMessage(guide, input.language);
        if (anyResult.comboState && typeof anyResult.comboState === "object") {
          delete anyResult.comboState.awaitingStepKey;
          delete anyResult.comboState.stepKey;
        }
      }

      // Enforce approved menu (Menu Items Online)
      if (!isApprovedItem(anyResult.selectedItem.name) && !siteSellsSquareItem((items as any[]).find((it: any) => it.id === anyResult.selectedItem.itemId)?.squareCatalogObjectId) && !items.some((it: any) => it.category === "drinks" && (it.id === anyResult.selectedItem.itemId || it.name === anyResult.selectedItem.name))) {
        return res.json({
          ok: false,
          reason: "item_not_available",
          message: `I'm sorry, ${anyResult.selectedItem.name} is not currently available. Would you like one of our combos, pack meals, or other items from the menu instead?`,
          approved_items_sample: getApprovedMenuItems().slice(0, 8)
        });
      }
    }

    // === Second-chance guide forcing for any "combo" utterance ===
    // Even if the downstream resolver picked a plain "Burrito" instead of "COMBO Burrito",
    // when the original customer text contains the word "combo", we consult the single source
    // of truth and force the guided path + canonical name. This is the root fix so that
    // "i want a burrito combo" (typed or spoken) always starts the exact step-by-step from combo-guide.json
    // and includes the chips/dip choice (step 12).
	    const anyRes2 = result as any;
	    if (anyRes2 && /\bcombo\b/i.test(text)) {
	      const guideFromText = getComboGuide(text);
	      if (guideFromText) {
        anyRes2.guide = guideFromText;

        // Try to promote the selectedItem to the real catalog "COMBO ..." entry if possible
        const targetName = guideFromText.display_name || "COMBO Burrito";
        const base = targetName.toLowerCase().replace(/^combo\s+/, "");
        const betterItem: any = items.find((it: any) => {
          const n = (it?.name || "").toLowerCase();
          return n.includes("combo") && (n.includes(base) || n.includes(targetName.toLowerCase()));
        }) || items.find((it: any) => (it?.name || "").toLowerCase().includes(base) && (it?.name || "").toLowerCase().includes("combo"));

        if (betterItem) {
          anyRes2.selectedItem = {
            ...(anyRes2.selectedItem || {}),
            itemId: betterItem.id || betterItem.itemId || anyRes2.selectedItem?.itemId,
            name: betterItem.name,
            priceCents: betterItem.priceCents ?? anyRes2.selectedItem?.priceCents
          };
        } else if (anyRes2.selectedItem) {
          // At minimum canonicalize the name so the model and tracker use "Combo Burrito"
          anyRes2.selectedItem.name = targetName;
        }

        // Give the local text path and the model a useful starting message (first step instruction)
	        anyRes2.message = buildGuideStartMessage(guideFromText, input.language);
        // fix10: the guide builds it (COMBO Mix asks both items) — drop a half-built add of the same combo.
        if (Array.isArray(anyRes2.actions) && anyRes2.selectedItem?.itemId) {
          const kept = anyRes2.actions.filter((a: any) => !(a?.type === "add_item" && a.itemId === anyRes2.selectedItem.itemId));
          if (kept.length !== anyRes2.actions.length) { anyRes2.actions = kept; if (!kept.length) anyRes2.ok = false; }
        }

        // Strip any legacy junk again
        delete anyRes2.comboStep;
        delete anyRes2.comboState;
        delete anyRes2.awaitingStepKey;
        delete anyRes2.stepKey;
      }
    }

    if ((result as any)?.ok === false && (result as any).reason === "unknown_menu_item") {
      (result as any).message = await unavailableItemReply(text, input.language, items as any);
      (result as any).instruction = "Nothing was added to the cart. Do not say added. Say this message.";
    }
    {
      const r: any = result;
      const add = (r?.actions || []).find((a: any) => a?.type === "add_item");
      const pickedId = add?.itemId || r?.selectedItem?.itemId;
      const it: any = pickedId && (items as any[]).find((m: any) => m.id === pickedId);
      const blocked = it ? unavailableNowReply(it, it.squareCatalogObjectId, input.language) : null;
      if (blocked) {
        r.ok = false; r.reason = "outside_website_hours"; r.actions = []; r.message = blocked;
        r.instruction = "Nothing was added to the cart. Do not say added. Say this message.";
      }
    }
    result = completeWithSiteDefaults(result, items as any, saidSoFar) as any;
    result = variationQuestion(result, items as any, saidSoFar, input.language);
    if (Array.isArray((result as any)?.actions)) (result as any).actions = rescoreSingleChoices(dropUnaskedExtras((result as any).actions, text), items as any, text);
    if ((result as any)?.ok === false && (result as any).reason === "missing_required_modifiers") {
      (result as any).message = requiredChoiceQuestion(result as any, input.language, items as any);
      const picked: any = (items as any[]).find((m: any) => m.id === (result as any).selectedItem?.itemId);
      if (picked?.squareCatalogObjectId) {
        (result as any).comboState = { ruleId: "site-followup", squareId: picked.squareCatalogObjectId, said: saidSoFar, chosen: followChosen };
        (result as any).comboStep = { key: "site-required", question: (result as any).message };
      }
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/menu/resolve", async (req, res, next) => {
  try {
	    const tenant = resolveDefaultTenant(req.headers.host);
	    const items = await getFullMenu(buildSquareConfig(tenant));
	    res.locals.menuItems = items;
	    let input = buildResolverInput(req.body);
	    let text = resolverText(input);
	    // fix11: packs ("8 tacos" → 8 Pack) and the chicharrón question run first.
	    const pre = preTurn(orderSessionKey(req.body), text, items as any, (input as any).language || "en", { hasComboState: Boolean(input.comboState) });
	    if (pre.adds?.length) { res.json({ ok: true, message: pre.reply, actions: pre.adds.map((a: any) => ({ type: "add_item", itemId: a.itemId, quantity: a.quantity, modifiers: [...a.modifiers.map((m: any) => ({ ...m, quantity: 1 })), ...(a.unknownMeat ? [{ groupName: "meat_needs_ask", option: a.unknownMeat, quantity: 1 }] : [])] })), orderContext: null, selectedItem: contextSelectedItem(items as any, pre.adds[0].itemId) }); return; }
	    if (pre.reply) { res.json({ ok: false, reason: "clarify", message: pre.reply, orderContext: { clarify: true } }); return; }
	    if (pre.text !== text) {
	      text = pre.text;
	      input = { ...input, text, toolArgs: { ...((input.toolArgs || {}) as Record<string, unknown>), itemQuery: text } } as any;
	      res.locals.resolvedText = text;
	    }
	    // Persistent order context: a pending dish ("4 tacos 2 bistec") gets this answer first.
	    const ctxTurn = orderContextTurn(orderSessionKey(req.body), text, items as any, (input as any).language || "en");
	    if (ctxTurn) {
	      res.json(ctxTurn.adds.length
	        ? { ok: true, message: ctxTurn.reply, actions: ctxTurn.adds.map((a) => ({ type: "add_item", ...a, modifiers: a.modifiers.map((m) => ({ ...m, quantity: 1 })) })), orderContext: pendingSummary(orderSessionKey(req.body)), selectedItem: contextSelectedItem(items as any, ctxTurn.adds[0]?.itemId) }
	        : { ok: false, reason: "order_context", message: ctxTurn.reply, orderContext: pendingSummary(orderSessionKey(req.body)) });
	      return;
	    }
	    if (input.comboState && isBuildInterruptIntent(text)) {
	      const replacement = extractReplacementBuildText(text);
	      if (replacement) {
	        input = withReplacementBuildText(input, replacement);
	        text = resolverText(input);
	      } else if (isBuildCancelIntent(text)) {
	        res.json(buildCancelledResult(input.language));
	        return;
	      }
	    }

    if (isComboSelectionState(input.comboState)) {
      const phrase = comboSelectionPhraseFromInput(input, items);
      if (!phrase) {
        res.json(buildComboSelectionResult(items, input.language));
        return;
      }
      input = withComboSelectionPhrase(input, phrase);
      text = resolverText(input);
    } else if (isPackMealSelectionState(input.comboState)) {
      const phrase = packMealSelectionPhrase(text);
      if (!phrase) {
        res.json(buildPackMealSelectionResult(items, input.language));
        return;
      }
      input = withPackMealSelectionPhrase(input, phrase);
      text = resolverText(input);
    }

    // === Root-cause guard: consult the single source of truth (combo-guide.json) first ===
    // If the current context matches any guided combo (fuzzy name match), we must never
    // emit the legacy hardcoded "elige una opción / las opciones están abajo" (or English)
    // from buildComboSelectionResult / buildPackMealSelectionResult. Those paths are bypassed.
    const cs = (input.comboState || {}) as Record<string, any>;
    const candidateNames = [
      text,
      cs.itemName,
      cs.ruleId,
      cs.itemId,
      cs.originalItemName
    ].filter(Boolean) as string[];
    const hasGuide = candidateNames.some((name) => getComboGuide(name) !== null);

    if (unsupportedPackMealRequest(text)) {
      res.json(buildUnsupportedPackMealResult(items, input.language));
      return;
    }

    if (!hasGuide) {
      if (isGenericComboRequest(text)) {
	        res.json(buildComboSelectionResult(items, input.language));
	        return;
	      } else if (isGenericPackMealRequest(text)) {
	        res.json(buildPackMealSelectionResult(items, input.language));
	        return;
	      }
    }
    // When hasGuide is true we skip the legacy early returns entirely. The normal resolver
    // runs, the guide is attached below, and any stray legacy fields are stripped.

    // Web follow-up to "Gordita: Bistec, Cabeza…?": answer it for that dish (same rule as chat / voice).
    const follow: any = (input as any).comboState?.ruleId === "site-followup" ? (input as any).comboState : null;
    let pinned = pinnedMenu(text, items as any) as typeof items;
    let resolveInput: any = input;
    let followResult: any = null;
    let followChosen: any[] = [];
    if (follow) {
      const dish = (items as any[]).filter((m: any) => m.squareCatalogObjectId === follow.squareId);
      const startsOver = pinned.length < items.length && !pinned.some((m: any) => m.squareCatalogObjectId === follow.squareId);
      if (dish.length && !startsOver) {
        const run = (t: string) => {
          const inp: any = { ...input, text: t, transcript: t, toolArgs: { ...((input as any).toolArgs || {}), itemQuery: t }, comboState: undefined };
          const list = pickVariation(t, dish as any) as any;
          if ((dish as any[]).length > 1) { const q = withoutSkuWords(t, list, dish as any); inp.text = q; inp.transcript = q; inp.toolArgs = { ...(inp.toolArgs || {}), itemQuery: q }; }
          return completeWithSiteDefaults(resolveEspecialRequest(list, inp) || resolveMenuRequest(list, inp), items as any, t);
        };
        const step = followUpStep(run, String(follow.said || ""), Array.isArray(follow.chosen) ? follow.chosen : [], text, items as any, (input as any).language || "en");
        followResult = step.result;
        followChosen = step.chosen;
        resolveInput = { ...input, text: step.said, transcript: step.said, comboState: undefined };
      }
    }
    let result: any = followResult || resolvePackMealRequest(pinned, resolveInput) || resolveEspecialRequest(pinned, resolveInput) || resolveMenuRequest(pinned, resolveInput);
    const saidSoFar = String(resolveInput.text || text);

	    // Attach combo guide if the resolved item is a guided combo (for model injection)
	    const anyResult = result as any;
	    if (anyResult && anyResult.selectedItem?.name) {
	      const guide = getComboGuide(anyResult.selectedItem.name);
	      if (guide) {
	        anyResult.guide = guide;
        // When a guide is attached, suppress EVERY legacy combo/pack FSM artifact
        // so the model and UI only ever see questions defined in combo-guide.json.
        delete anyResult.comboStep;
        delete anyResult.comboState;
        delete anyResult.awaitingStepKey;
        delete anyResult.stepKey;
	        anyResult.message = buildGuideStartMessage(guide, input.language);
        if (anyResult.comboState && typeof anyResult.comboState === "object") {
          delete anyResult.comboState.awaitingStepKey;
          delete anyResult.comboState.stepKey;
        }
      }

      // Enforce approved menu (Menu Items Online)
      if (!isApprovedItem(anyResult.selectedItem.name) && !siteSellsSquareItem((items as any[]).find((it: any) => it.id === anyResult.selectedItem.itemId)?.squareCatalogObjectId) && !items.some((it: any) => it.category === "drinks" && (it.id === anyResult.selectedItem.itemId || it.name === anyResult.selectedItem.name))) {
        return res.json({
          ok: false,
          reason: "item_not_available",
          message: `I'm sorry, ${anyResult.selectedItem.name} is not currently available. Would you like one of our combos, pack meals, or other items from the menu instead?`,
          approved_items_sample: getApprovedMenuItems().slice(0, 8)
        });
      }
    }

    // === Second-chance guide forcing for any "combo" utterance ===
    // Even if the downstream resolver picked a plain "Burrito" instead of "COMBO Burrito",
    // when the original customer text contains the word "combo", we consult the single source
    // of truth and force the guided path + canonical name. This is the root fix so that
    // "i want a burrito combo" (typed or spoken) always starts the exact step-by-step from combo-guide.json
    // and includes the chips/dip choice (step 12).
	    const anyRes2 = result as any;
	    if (anyRes2 && /\bcombo\b/i.test(text)) {
	      const guideFromText = getComboGuide(text);
	      if (guideFromText) {
        anyRes2.guide = guideFromText;

        // Try to promote the selectedItem to the real catalog "COMBO ..." entry if possible
        const targetName = guideFromText.display_name || "COMBO Burrito";
        const base = targetName.toLowerCase().replace(/^combo\s+/, "");
        const betterItem: any = items.find((it: any) => {
          const n = (it?.name || "").toLowerCase();
          return n.includes("combo") && (n.includes(base) || n.includes(targetName.toLowerCase()));
        }) || items.find((it: any) => (it?.name || "").toLowerCase().includes(base) && (it?.name || "").toLowerCase().includes("combo"));

        if (betterItem) {
          anyRes2.selectedItem = {
            ...(anyRes2.selectedItem || {}),
            itemId: betterItem.id || betterItem.itemId || anyRes2.selectedItem?.itemId,
            name: betterItem.name,
            priceCents: betterItem.priceCents ?? anyRes2.selectedItem?.priceCents
          };
        } else if (anyRes2.selectedItem) {
          // At minimum canonicalize the name so the model and tracker use "Combo Burrito"
          anyRes2.selectedItem.name = targetName;
        }

        // Give the local text path and the model a useful starting message (first step instruction)
	        anyRes2.message = buildGuideStartMessage(guideFromText, input.language);
        // fix10: the guide builds it (COMBO Mix asks both items) — drop a half-built add of the same combo.
        if (Array.isArray(anyRes2.actions) && anyRes2.selectedItem?.itemId) {
          const kept = anyRes2.actions.filter((a: any) => !(a?.type === "add_item" && a.itemId === anyRes2.selectedItem.itemId));
          if (kept.length !== anyRes2.actions.length) { anyRes2.actions = kept; if (!kept.length) anyRes2.ok = false; }
        }

        // Strip any legacy junk again
        delete anyRes2.comboStep;
        delete anyRes2.comboState;
        delete anyRes2.awaitingStepKey;
        delete anyRes2.stepKey;
      }
    }

    if ((result as any)?.ok === false && (result as any).reason === "unknown_menu_item") {
      (result as any).message = await unavailableItemReply(text, input.language, items as any);
      (result as any).instruction = "Nothing was added to the cart. Do not say added. Say this message.";
    }
    {
      const r: any = result;
      const add = (r?.actions || []).find((a: any) => a?.type === "add_item");
      const pickedId = add?.itemId || r?.selectedItem?.itemId;
      const it: any = pickedId && (items as any[]).find((m: any) => m.id === pickedId);
      const blocked = it ? unavailableNowReply(it, it.squareCatalogObjectId, input.language) : null;
      if (blocked) {
        r.ok = false; r.reason = "outside_website_hours"; r.actions = []; r.message = blocked;
        r.instruction = "Nothing was added to the cart. Do not say added. Say this message.";
      }
    }
    result = completeWithSiteDefaults(result, items as any, saidSoFar) as any;
    result = variationQuestion(result, items as any, saidSoFar, input.language);
    if (Array.isArray((result as any)?.actions)) (result as any).actions = rescoreSingleChoices(dropUnaskedExtras((result as any).actions, text), items as any, text);
    if ((result as any)?.ok === false && (result as any).reason === "missing_required_modifiers") {
      (result as any).message = requiredChoiceQuestion(result as any, input.language, items as any);
      const picked: any = (items as any[]).find((m: any) => m.id === (result as any).selectedItem?.itemId);
      if (picked?.squareCatalogObjectId) {
        (result as any).comboState = { ruleId: "site-followup", squareId: picked.squareCatalogObjectId, said: saidSoFar, chosen: followChosen };
        (result as any).comboStep = { key: "site-required", question: (result as any).message };
      }
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/:tenant/orders/checkout", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
    const sq = gatedCheckoutConfig(buildSquareConfig(tenant));
    if (!sq) { res.status(503).json({ error: CHECKOUT_CLOSED_MESSAGE, checkoutClosed: true }); return; }
    const result = await createCheckout(req.body, sq);
    clearOrderContext(orderSessionKey(req.body), "submitted");
    rememberPhoneOrderName(req);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/** ordername1: an Elvi phone order (internal, localhost only — never a web body) saves its name as Elvi-heard. */
function rememberPhoneOrderName(req: express.Request) {
  const b = req.body || {};
  const host = String(req.headers.host || "").split(":")[0];
  const internal = !(req.headers["cf-connecting-ip"] || req.headers["cf-ray"] || req.headers["x-forwarded-for"]) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);
  if (!internal || b.metadata?.source !== "phone" || !b.customer?.phone || !b.customer?.name) return;
  try { rememberOrderName(String(b.customer.phone), String(b.customer.name)); } catch { /* best effort */ }
}

app.post("/api/orders/checkout", async (req, res, next) => {
  try {
    const tenant = resolveDefaultTenant(req.headers.host);
    const sq = gatedCheckoutConfig(buildSquareConfig(tenant));
    if (!sq) { res.status(503).json({ error: CHECKOUT_CLOSED_MESSAGE, checkoutClosed: true }); return; }
    const result = await createCheckout(req.body, sq);
    clearOrderContext(orderSessionKey(req.body), "submitted");
    rememberPhoneOrderName(req);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/:tenant/elvi/chat", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
    const transcript = String(req.body?.transcript || "").trim();
    const language = req.body?.language === "es" ? "es" : "en";
    if (!transcript) {
      throw new Error("Transcript is required");
    }

    const menu = await getMenu(buildSquareConfig(tenant));
    const history = Array.isArray(req.body?.history)
      ? (req.body.history as any[])
          .filter((turn) => turn && (turn.role === "customer" || turn.role === "assistant") && typeof turn.text === "string")
          .slice(-24) // ui4: a combo asked step by step needs the turn that named it
          .map((turn) => ({ role: turn.role as "customer" | "assistant", text: String(turn.text).slice(0, 500) }))
      : undefined;
    const resolverMenu = await getFullMenu(buildSquareConfig(tenant)).catch(() => menu);
    const result = await chatWithElvi(
      { transcript, language, menu, history, resolverMenu, sessionKey: orderSessionKey(req.body) },
      {
        apiKey: tenant.xai.apiKey,
        baseUrl: tenant.xai.baseUrl,
        model: tenant.xai.model,
      }
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Short spoken answer for menu questions ("what's on the menu", "qué combos tienen").
// Returns { reply: null } when the text isn't a menu question.
app.post(["/api/menu/info", "/api/:tenant/menu/info"], async (req, res, next) => {
  try {
    const text = String(req.body?.text || "").slice(0, 300);
    const language = req.body?.language === "es" ? "es" : "en";
    res.json({ reply: text ? await answerMenuQuestion(text, language) : null });
  } catch (error) {
    next(error);
  }
});

app.post("/api/elvi/chat", async (req, res, next) => {
  try {
    const tenant = resolveDefaultTenant(req.headers.host);
    const transcript = String(req.body?.transcript || "").trim();
    const language = req.body?.language === "es" ? "es" : "en";
    if (!transcript) {
      throw new Error("Transcript is required");
    }

    const menu = await getMenu(buildSquareConfig(tenant));
    const history = Array.isArray(req.body?.history)
      ? (req.body.history as any[])
          .filter((turn) => turn && (turn.role === "customer" || turn.role === "assistant") && typeof turn.text === "string")
          .slice(-24) // ui4: a combo asked step by step needs the turn that named it
          .map((turn) => ({ role: turn.role as "customer" | "assistant", text: String(turn.text).slice(0, 500) }))
      : undefined;
    const resolverMenu = await getFullMenu(buildSquareConfig(tenant)).catch(() => menu);
    const result = await chatWithElvi(
      { transcript, language, menu, history, resolverMenu, sessionKey: orderSessionKey(req.body) },
      {
        apiKey: tenant.xai.apiKey,
        baseUrl: tenant.xai.baseUrl,
        model: tenant.xai.model,
      }
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/:tenant/realtime/session", (req, res) => {
  const tenant = resolveTenant(req.params.tenant || req.headers.host);
  const session = createRealtimeSession(tenant);
  res.status(201).json({
    ...session,
    tenant: {
      slug: tenant.slug,
      branding: tenant.branding
    }
  });
});

app.post("/api/:tenant/xai/client-secret", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
    const apiKey = tenant.xai.apiKey || process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error("XAI_API_KEY is not configured");
    }

    const response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ expires_after: { seconds: 300 } })
    });

    const body = (await response.json().catch(() => ({}))) as {
      value?: string;
      expires_at?: number;
      error?: { message?: string };
    };
    if (!response.ok || !body.value) {
      throw new Error(body.error?.message || `Failed to mint xAI client secret (${response.status})`);
    }

    res.status(201).json({ token: body.value, expiresAt: body.expires_at || 0 });
  } catch (error) {
    next(error);
  }
});

app.post("/api/:tenant/xai/speech", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
    const text = String(req.body?.text || "").trim().slice(0, 400);
    const language = req.body?.language === "es" ? "es" : "en";
    res.json(await synthesizeSpeech(tenant, text, language));
  } catch (error) {
    next(error);
  }
});

app.post("/api/:tenant/xai/transcribe", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
    const language = req.body?.language === "es" ? "es" : "en";
    const audioChunks = Array.isArray(req.body?.audioChunks)
      ? req.body.audioChunks.map((chunk: unknown) => String(chunk || "")).filter(Boolean).slice(-180)
      : [];
    res.json(await transcribeElviAudio(
      { audioChunks, language },
      {
        apiKey: tenant.xai.apiKey,
        baseUrl: tenant.xai.baseUrl,
        model: tenant.xai.model
      }
    ));
  } catch (error) {
    next(error);
  }
});

app.post("/api/:tenant/tools/check_delivery_zone", async (req, res, next) => {
  try {
    const launchConfig = getLaunchConfig();
    if (!launchConfig.deliveryEnabled) {
      res.json({
        ok: false,
        in_zone: false,
        delivery_enabled: false,
        message: launchConfig.deliveryDisabledMessage
      });
      return;
    }
    const address = String(req.body?.address || "").trim();
    if (!address) {
      throw new Error("address is required");
    }
    // delivery1: geocoded distance zones (data/delivery.json); a failed lookup asks to confirm instead of guessing.
    const q = await quoteDeliveryAddress(address);
    const lang = String(req.body?.language || "es") === "en" ? "en" : "es";
    res.json({ ok: true, available: true, in_zone: q.ok, needs_confirm: q.needsConfirm, reason: q.reason || null, zone: q.zone || null,
      fee_cents: q.feeCents ?? null, eta_minutes: q.etaMinutes ?? null, miles: q.miles ?? null, city: q.city ?? null, fee_confirmed: q.feeConfirmed !== false, delivery_cents: q.deliveryCents ?? null, service_cents: q.serviceCents ?? null, breakdown: q.breakdown ?? null, minimum_subtotal_cents: q.minimumCents ?? 1000, message: q.message[lang] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/:tenant/tools/submit_order", (req, res, next) => {
  try {
    res.status(201).json(submitOrderPreview((req.body || {}) as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
});

app.post("/api/realtime/session", (req, res) => {
  const tenant = resolveDefaultTenant(req.headers.host);
  const session = createRealtimeSession(tenant);
  res.status(201).json({
    ...session,
    tenant: {
      slug: tenant.slug,
      branding: tenant.branding
    }
  });
});

// Listen-only phone training (shadow order only; never checkout).
const shadowTurn = (sessionKey: string) => async (transcript: string, language: "es" | "en", history: Array<{ role: "customer" | "assistant"; text: string }>) => {
  const tenant = resolveTenant(undefined);
  const menu = await getMenu(buildSquareConfig(tenant));
  const resolverMenu = await getFullMenu(buildSquareConfig(tenant)).catch(() => menu);
  return chatWithElvi(
    { transcript: transcript.slice(0, 1000), language, menu, history, resolverMenu, sessionKey } as any,
    { apiKey: tenant.xai.apiKey, baseUrl: tenant.xai.baseUrl, model: tenant.xai.model }
  );
};
registerTwilioRoutes(app, shadowTurn, (e164, signal) => findCustomerGivenNameReadOnly(e164, buildSquareConfig(resolveTenant(undefined)), signal),
  // auditor1: ticket lines use the exact Square POS item/variation names and POS prices (read-only catalog).
  async (cart) => { const cfg = buildSquareConfig(resolveTenant(undefined)); return toPosLines(elviLines(cart, await getFullMenu(cfg)), await loadPosCatalog(cfg)); });

// Call Accuracy (staff-only): recordings and caller numbers never leave this Mac through the public tunnel.
function localOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
  const host = String(req.headers.host || "").split(":")[0];
  const viaTunnel = req.headers["cf-connecting-ip"] || req.headers["cf-ray"] || req.headers["x-forwarded-for"];
  if (!viaTunnel && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) return next();
  res.status(403).json({ error: "Call Accuracy is only available on this computer (localhost)." });
}
let ordersCache: { key: string; at: number; orders: any[] } | null = null;
// names1: learn caller names from Square tickets (read-only Orders Search). Same phone + call window only.
export async function learnTicketNames(opts: { dry?: boolean; days?: number } = {}) {
  const calls = loadCalls(opts.days ?? 1).filter((c) => c.caller);
  if (!calls.length) return [];
  const cfg = buildSquareConfig(resolveTenant(undefined));
  const startAt = new Date(Math.min(...calls.map((c) => Date.parse(c.at))) - 5 * 60000).toISOString();
  const endAt = new Date(Math.max(...calls.map((c) => Date.parse(c.at))) + 90 * 60000).toISOString();
  const orders = await searchOrdersReadOnly(startAt, endAt, cfg);
  const out: Array<{ callSid: string; at: string; caller: string; ticketName?: string; orderId?: string; action: string; saved?: string }> = [];
  for (const c of calls) {
    const m = nameMatchForCall(c, orders);
    if (!m) { out.push({ callSid: c.callSid, at: c.at, caller: c.caller, action: "no-phone-matched-ticket" }); continue; }
    const plan = planCallerName(c.caller, m.name, "ticket");
    let saved: string | undefined;
    if (!opts.dry && plan.save) { const s = saveCallerName(c.caller, m.name, "ticket"); if (s) { saved = s; onCallerNameSaved(c.caller, s, "ticket"); } }
    out.push({ callSid: c.callSid, at: c.at, caller: c.caller, ticketName: m.name, orderId: m.orderId, action: plan.save ? (opts.dry ? `would-save "${plan.name}"` : "saved") : plan.reason, saved });
  }
  return { ordersSearched: orders.length, rows: out };
}
if (process.env.ELVI_NAMES_TIMER !== "0") setInterval(() => { learnTicketNames().catch(() => {}); }, 10 * 60 * 1000).unref?.();
app.get("/api/calls/names", localOnly, async (req, res, next) => {
  try { res.json(await learnTicketNames({ dry: req.query.dry !== "0", days: Math.min(30, Number(req.query.days) || 1) })); } catch (e) { next(e); }
});
// remotecalls1: localhost, or the phone host with the same PIN header the counter phone uses (x-phone-pin).
app.get("/api/calls/accuracy", phoneAuth, async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const tenant = resolveTenant(undefined);
    const cfg = buildSquareConfig(tenant);
    const menu = await getFullMenu(cfg);
    const calls = loadCalls(days);
    const expected = loadExpected();
    let orders: any[] = [];
    let squareError: string | undefined;
    if (calls.length) {
      const startAt = new Date(Math.min(...calls.map((c) => Date.parse(c.at))) - 5 * 60000).toISOString();
      const endAt = new Date(Math.max(...calls.map((c) => Date.parse(c.at))) + 90 * 60000).toISOString();
      const key = `${startAt}|${endAt}`;
      if (ordersCache && ordersCache.key === key && Date.now() - ordersCache.at < 3 * 60000) orders = ordersCache.orders;
      else {
        try { orders = await searchOrdersReadOnly(startAt, endAt, cfg); ordersCache = { key, at: Date.now(), orders }; }
        catch (e) { squareError = e instanceof Error ? e.message.slice(0, 200) : String(e); }
      }
    }
    const posCat = await loadPosCatalog(cfg);
    const audits = auditorFindingsByCall();
    const rows = calls.map((c) => {
      const elvi = toPosLines(elviLines(c.elviCart || [], menu), posCat);
      if (c.fulfillment === "DELIVERY" && elvi.length) elvi.push(deliveryFeeLine(c.deliveryFeeCents));
      const m = c.recordingSid ? matchTicket(c, elvi, orders) : null;
      // Training calls with no Square ticket can be scored against an order Carlos typed by hand.
      const exp = !m ? expected[c.callSid] : undefined;
      const ticket = m ? ticketLines(m.order) : exp ? elviLines(exp.cart, menu) : [];
      const scored = m || exp ? scoreOrder(elvi, ticket) : null;
      return {
        callSid: c.callSid, at: c.at, caller: c.caller, language: c.language || null, answered: c.answered ?? null, dialStatus: c.dialStatus || null,
        talkSec: c.talkSec || 0, hasAudio: !!(c.recordingSid && fs.existsSync(`${callsDir}/${c.recordingSid}.wav`)), recordingSid: c.recordingSid || null,
        turns: c.turns || [], error: c.error || null,
        elvi, elviTotalCents: elvi.reduce((a, l) => a + l.totalCents, 0),
        source: c.source,
        expected: exp ? { text: exp.text, savedAt: exp.savedAt } : null,
        ticket: !m && exp ? { id: "manual", createdAt: exp.savedAt, matchedBy: "manual", source: "manual", lines: ticket, totalCents: ticket.reduce((a, l) => a + l.totalCents, 0) } : m ? { id: m.order.id, ...squareRefs(m.order), receiptUrl: null as string | null, createdAt: m.order.created_at, matchedBy: m.by, source: m.order.source?.name || null, lines: ticket, totalCents: Number(m.order.total_money?.amount || 0) } : null,
        score: scored ? scored.score : null, misses: scored ? scored.misses : [], pairs: scored ? scored.pairs : [],
        elviFulfillment: c.fulfillment || null, deliveryFeeCents: c.deliveryFeeCents ?? null, recordingSec: c.recordingSec || 0,
        audit: audits[c.callSid] || null,
        orderName: (c as any).orderName || null, orderNameFrom: (c as any).orderNameFrom || null, // ordername1
        // delivery1: fulfillment + address, transcript vs the Square ticket (read-only order JSON). Separate from the item score.
        fulfillment: (() => {
          const ef = detectFulfillment(c.turns || []);
          const ea = ef.fulfillment === "DELIVERY" ? detectAddress(c.turns || []).address?.full || null : null;
          const elviF = { fulfillment: ef.fulfillment, address: ea };
          if (!m) return { elvi: elviF, ticket: null, score: null, misses: [] as string[] };
          const tf = ticketFulfillment(m.order);
          const sc = scoreFulfillment(elviF, tf);
          return { elvi: elviF, ticket: tf, score: sc.score, misses: sc.misses, ticketMissedDelivery: sc.ticketMissedDelivery };
        })()
      };
    });
    // ticketno1: real Square receipt number + public receipt link (read-only Payments API, cached).
    await Promise.all(rows.map(async (r: any) => {
      if (!r.ticket?.paymentId) return;
      const rc = await Promise.race([paymentReceiptReadOnly(r.ticket.paymentId, cfg), new Promise<null>((ok) => setTimeout(() => ok(null), 2500))]);
      if (rc?.receiptNumber) r.ticket.receiptNumber = rc.receiptNumber;
      r.ticket.receiptUrl = rc?.receiptUrl || null;
    }));
    const customer = rows.filter((r) => r.source !== "training"), training = rows.filter((r) => r.source === "training");
    res.json({ calls: rows, trend: trend(customer), trainingTrend: trend(training), squareError: squareError || null, ordersSearched: orders.length });
  } catch (error) { next(error); }
});
// Training: type the expected order ("2 tacos de bistec de comal, 2 de chorizo"); preview with Elvi's resolver, then save.
app.post("/api/calls/:sid/expected", phoneAuth, async (req, res, next) => {
  try {
    const sid = String(req.params.sid || "");
    if (!/^CA[0-9a-f]{32}$/.test(sid)) return res.status(400).json({ error: "bad call id" });
    if (req.body?.clear) { saveExpected(sid, null); return res.json({ ok: true }); }
    const text = String(req.body?.text || "").trim().slice(0, 800);
    if (!text) return res.status(400).json({ error: "Escribe la orden esperada." });
    const language = /\b(the|and|with|steak|chicken|beans|rice)\b/i.test(text) ? "en" : "es";
    // One line per item; a staff marker between lines keeps the scorer from joining them into one sentence.
    const turns = text.split(/\n+/).map((t) => t.trim()).filter(Boolean).flatMap((t, i) => [
      ...(i ? [{ speaker: "staff" as const, start: i - 0.5, end: i - 0.4, text: "(siguiente)", language }] : []),
      { speaker: "caller" as const, start: i, end: i + 0.5, text: t, language }
    ]);
    const r = await shadowOrderFromTurns(turns as any, shadowTurn(`expected-${sid.slice(-12)}-${Date.now()}`));
    const menu = await getFullMenu(buildSquareConfig(resolveTenant(undefined)));
    const lines = elviLines(r.cart, menu);
    if (req.body?.save && r.cart.length) saveExpected(sid, { text, cart: r.cart, savedAt: new Date().toISOString() });
    res.json({ ok: true, saved: !!(req.body?.save && r.cart.length), lines, open: (() => { const last: any = r.steps.filter((s: any) => s.reply).slice(-1)[0]; return last && /\?\s*$/.test(String(last.reply)) && !/algo más|anything else/i.test(String(last.reply)) ? last.reply : null; })() });
  } catch (error) { next(error); }
});

app.get("/api/calls/:sid/audio", phoneAuth, (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const sid = String(req.params.sid || "");
  if (!/^RE[0-9a-f]{32}$/.test(sid)) return res.status(400).end();
  const file = `${callsDir}/${sid}.wav`;
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file, { headers: { "Content-Type": "audio/wav", "Accept-Ranges": "bytes" }, acceptRanges: true });
});

app.post("/api/square/webhooks", (req, res) => {
  console.log("Square webhook", JSON.stringify(req.body));
  res.sendStatus(200);
});

app.get("/checkout/success", (_req, res) => {
  res.type("html").send("<h1>Gracias. Your Cocina Elvis order was received.</h1>");
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  res.status(400).json({ error: message });
});

const webRoot = path.resolve(__dirname, "../../../apps/web");
const avatarRoot = path.resolve(__dirname, "../../../avatar");
app.use("/avatar", express.static(avatarRoot));
app.use(express.static(webRoot, {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (/\.(?:html|js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
  }
}));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/health")) {
    return next();
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  return res.sendFile(path.join(webRoot, "index.html"));
});

const server = createServer(app);
attachRealtimeServer(server);

server.listen(port, () => {
  console.log(`Cocina Elvis API listening on http://localhost:${port}`);
});

