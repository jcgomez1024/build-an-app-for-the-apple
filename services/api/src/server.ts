import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { chatWithElvi } from "./elvi.js";
import { createCheckout, getFullMenu, getMenu } from "./square.js";
import { resolveMenuRequest } from "./menu-intelligence.js";
import { resolveEspecialRequest } from "./especial-resolver.js";
import { resolvePackMealRequest } from "./pack-meal-resolver.js";
import { attachRealtimeServer, createRealtimeSession } from "./realtime.js";
import { getComboGuide, isGuidedCombo, isApprovedItem, getApprovedMenuItems } from "./guides.js";
import { extractReplacementBuildText } from "./text-intents.js";
import { listPublicTenants, resolveTenant } from "./tenant.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

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

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "cocina-elvis-api" });
});

app.get("/api/tenants", (_req, res) => {
  res.json({ tenants: listPublicTenants() });
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
  return {
    text: typeof input.text === "string" ? input.text : "",
    language: input.language === "es" ? "es" : "en",
    actionHint: typeof input.actionHint === "string" ? input.actionHint : undefined,
    toolArgs: input.toolArgs && typeof input.toolArgs === "object" ? input.toolArgs : undefined,
    cart: Array.isArray(input.cart) ? input.cart : [],
    comboState: input.comboState && typeof input.comboState === "object" ? input.comboState : undefined
  };
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
  if (!/\b(pack\s+meals?|meals?\s+pack|paquete|paquetes)\b/.test(normalized)) return false;
  return !/\b([3-8]|three|four|five|six|seven|eight|tres|cuatro|cinco|seis|siete|ocho)\b/.test(normalized);
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

function formatCents(cents: unknown) {
  const value = Math.max(0, Number(cents) || 0);
  return `$${(value / 100).toFixed(2)}`;
}

function buildComboSelectionResult(items: Awaited<ReturnType<typeof getFullMenu>>, language: string) {
  const es = language === "es";
  const options = comboMenuItems(items).map((item) => `${item.name} - ${formatCents(item.priceCents)}`);
  const question = es ? "¿Cuál combo quieres? Las opciones están abajo." : "Which combo would you like? Options are below.";
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

app.post("/api/:tenant/menu/resolve", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
    const items = await getFullMenu(buildSquareConfig(tenant));
    let input = buildResolverInput(req.body);
    const text = resolverText(input);
    if (input.comboState && isBuildInterruptIntent(text)) {
      const replacement = extractReplacementBuildText(text);
      if (replacement) {
        input = withReplacementBuildText(input, replacement);
      } else if (isBuildCancelIntent(text)) {
        res.json(buildCancelledResult(input.language));
        return;
      }
    }
    if (isComboSelectionState(input.comboState)) {
      const phrase = comboSelectionPhrase(text);
      if (!phrase) {
        res.json(buildComboSelectionResult(items, input.language));
        return;
      }
      input = withComboSelectionPhrase(input, phrase);
    } else if (isPackMealSelectionState(input.comboState)) {
      const phrase = packMealSelectionPhrase(text);
      if (!phrase) {
        res.json(buildPackMealSelectionResult(items, input.language));
        return;
      }
      input = withPackMealSelectionPhrase(input, phrase);
    } else if (isGenericComboRequest(text)) {
      res.json(buildComboSelectionResult(items, input.language));
      return;
    } else if (isGenericPackMealRequest(text)) {
      res.json(buildPackMealSelectionResult(items, input.language));
      return;
    }
    const result = resolvePackMealRequest(items, input) || resolveEspecialRequest(items, input) || resolveMenuRequest(items, input);

    // Attach combo guide if the resolved item is a guided combo (for model injection)
    const anyResult = result as any;
    if (anyResult && anyResult.selectedItem?.name) {
      const guide = getComboGuide(anyResult.selectedItem.name);
      if (guide) {
        anyResult.guide = guide;
        // When a guide is attached, suppress legacy comboStep data so the model
        // only ever sees the question from the single source of truth (the guide).
        delete anyResult.comboStep;
        delete anyResult.comboState;
      }

      // Enforce approved menu (Menu Items Online)
      if (!isApprovedItem(anyResult.selectedItem.name)) {
        return res.json({
          ok: false,
          reason: "item_not_available",
          message: `I'm sorry, ${anyResult.selectedItem.name} is not currently available. Would you like one of our combos, pack meals, or other items from the menu instead?`,
          approved_items_sample: getApprovedMenuItems().slice(0, 8)
        });
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
    let input = buildResolverInput(req.body);
    const text = resolverText(input);
    if (input.comboState && isBuildInterruptIntent(text)) {
      const replacement = extractReplacementBuildText(text);
      if (replacement) {
        input = withReplacementBuildText(input, replacement);
      } else if (isBuildCancelIntent(text)) {
        res.json(buildCancelledResult(input.language));
        return;
      }
    }
    if (isComboSelectionState(input.comboState)) {
      const phrase = comboSelectionPhrase(text);
      if (!phrase) {
        res.json(buildComboSelectionResult(items, input.language));
        return;
      }
      input = withComboSelectionPhrase(input, phrase);
    } else if (isPackMealSelectionState(input.comboState)) {
      const phrase = packMealSelectionPhrase(text);
      if (!phrase) {
        res.json(buildPackMealSelectionResult(items, input.language));
        return;
      }
      input = withPackMealSelectionPhrase(input, phrase);
    } else if (isGenericComboRequest(text)) {
      res.json(buildComboSelectionResult(items, input.language));
      return;
    } else if (isGenericPackMealRequest(text)) {
      res.json(buildPackMealSelectionResult(items, input.language));
      return;
    }
    const result = resolvePackMealRequest(items, input) || resolveEspecialRequest(items, input) || resolveMenuRequest(items, input);

    // Attach combo guide if the resolved item is a guided combo (for model injection)
    const anyResult = result as any;
    if (anyResult && anyResult.selectedItem?.name) {
      const guide = getComboGuide(anyResult.selectedItem.name);
      if (guide) {
        anyResult.guide = guide;
        // When a guide is attached, suppress legacy comboStep data so the model
        // only ever sees the question from the single source of truth (the guide).
        delete anyResult.comboStep;
        delete anyResult.comboState;
      }

      // Enforce approved menu (Menu Items Online)
      if (!isApprovedItem(anyResult.selectedItem.name)) {
        return res.json({
          ok: false,
          reason: "item_not_available",
          message: `I'm sorry, ${anyResult.selectedItem.name} is not currently available. Would you like one of our combos, pack meals, or other items from the menu instead?`,
          approved_items_sample: getApprovedMenuItems().slice(0, 8)
        });
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
    const result = await createCheckout(req.body, buildSquareConfig(tenant));
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/checkout", async (req, res, next) => {
  try {
    const tenant = resolveDefaultTenant(req.headers.host);
    const result = await createCheckout(req.body, buildSquareConfig(tenant));
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
    const result = await chatWithElvi(
      { transcript, language, menu },
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

app.post("/api/elvi/chat", async (req, res, next) => {
  try {
    const tenant = resolveDefaultTenant(req.headers.host);
    const transcript = String(req.body?.transcript || "").trim();
    const language = req.body?.language === "es" ? "es" : "en";
    if (!transcript) {
      throw new Error("Transcript is required");
    }

    const menu = await getMenu(buildSquareConfig(tenant));
    const result = await chatWithElvi(
      { transcript, language, menu },
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
    const apiKey = tenant.xai.apiKey || process.env.XAI_API_KEY;
    const text = String(req.body?.text || "").trim().slice(0, 400);
    const language = req.body?.language === "es" ? "es" : "en";
    const voice = language === "es"
      ? (process.env.XAI_VOICE_ID_ES || process.env.XAI_VOICE_ID || "Eve")
      : (process.env.XAI_VOICE_ID || "Eve");

    if (!apiKey) {
      throw new Error("XAI_API_KEY is not configured");
    }
    if (!text) {
      throw new Error("text is required");
    }

    const response = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
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

    res.json({
      ok: true,
      engine: "xai",
      voice,
      mimeType: response.headers.get("content-type") || "audio/mpeg",
      audioBase64: audio.toString("base64")
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/:tenant/tools/check_delivery_zone", (req, res, next) => {
  try {
    const address = String(req.body?.address || "").trim();
    if (!address) {
      throw new Error("address is required");
    }
    res.json(checkDeliveryZone(address));
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
app.use(express.static(webRoot));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/health")) {
    return next();
  }

  return res.sendFile(path.join(webRoot, "index.html"));
});

const server = createServer(app);
attachRealtimeServer(server);

server.listen(port, () => {
  console.log(`Cocina Elvis API listening on http://localhost:${port}`);
});
