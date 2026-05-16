import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { chatWithElvi } from "./elvi.js";
import { createCheckout, getMenu } from "./square.js";
import { resolveMenuRequest } from "./menu-intelligence.js";
import { attachRealtimeServer, createRealtimeSession } from "./realtime.js";
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

app.post("/api/:tenant/menu/resolve", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req.params.tenant || req.headers.host);
    const items = await getMenu(buildSquareConfig(tenant));
    const result = resolveMenuRequest(items, buildResolverInput(req.body));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/menu/resolve", async (req, res, next) => {
  try {
    const tenant = resolveDefaultTenant(req.headers.host);
    const items = await getMenu(buildSquareConfig(tenant));
    const result = resolveMenuRequest(items, buildResolverInput(req.body));
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
