type TenantSquareConfig = {
  env: "sandbox" | "production";
  accessToken?: string;
  locationId?: string;
  apiVersion: string;
};

type TenantXaiConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
};

type TenantRivaConfig = {
  asrUrl?: string;
  ttsUrl?: string;
  apiKey?: string;
};

type TenantAudio2FaceConfig = {
  url?: string;
  apiKey?: string;
};

type TenantBrandingConfig = {
  displayName: string;
  accentColor: string;
  avatarModelUrl?: string;
};

export type TenantConfig = {
  slug: string;
  hostnames: string[];
  square: TenantSquareConfig;
  xai: TenantXaiConfig;
  riva: TenantRivaConfig;
  audio2face: TenantAudio2FaceConfig;
  branding: TenantBrandingConfig;
};

type TenantPublicConfig = {
  slug: string;
  hostnames: string[];
  branding: TenantBrandingConfig;
};

type TenantFileEntry = Partial<TenantConfig> & { slug?: string };

let cachedTenants: TenantConfig[] | null = null;

function sanitizeSlug(value: string | undefined): string {
  const slug = (value || "").toLowerCase().trim();
  if (!slug) return "cocina-elvis";
  return slug.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
}

function toArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function envToTenant(): TenantConfig {
  return {
    slug: sanitizeSlug(process.env.DEFAULT_TENANT_SLUG || "cocina-elvis"),
    hostnames: toArray((process.env.DEFAULT_TENANT_HOSTNAMES || "").split(",")),
    square: {
      env: process.env.SQUARE_ENV === "production" ? "production" : "sandbox",
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      locationId: process.env.SQUARE_LOCATION_ID,
      apiVersion: process.env.SQUARE_API_VERSION || "2026-01-22"
    },
    xai: {
      apiKey: process.env.XAI_API_KEY,
      baseUrl: "https://api.x.ai/v1",
      model: process.env.XAI_MODEL || "grok-3-beta",
    },
    riva: {
      asrUrl: undefined,
      ttsUrl: undefined,
      apiKey: undefined,
    },
    audio2face: {
      url: undefined,
      apiKey: undefined,
    },
    branding: {
      displayName: process.env.RESTAURANT_NAME || "Cocina Elvis",
      accentColor: process.env.BRAND_ACCENT_COLOR || "#e2511d",
      avatarModelUrl: process.env.AVATAR_MODEL_URL
    }
  };
}

function normalizeTenantEntry(raw: TenantFileEntry): TenantConfig {
  const defaults = envToTenant();

  return {
    slug: sanitizeSlug(raw.slug || defaults.slug),
    hostnames: toArray(raw.hostnames || defaults.hostnames),
    square: {
      env: raw.square?.env === "production" ? "production" : defaults.square.env,
      accessToken: raw.square?.accessToken || defaults.square.accessToken,
      locationId: raw.square?.locationId || defaults.square.locationId,
      apiVersion: raw.square?.apiVersion || defaults.square.apiVersion
    },
    xai: {
      apiKey: (raw as TenantConfig).xai?.apiKey || defaults.xai.apiKey,
      baseUrl: (raw as TenantConfig).xai?.baseUrl || defaults.xai.baseUrl,
      model: (raw as TenantConfig).xai?.model || defaults.xai.model,
    },
    riva: {
      asrUrl: raw.riva?.asrUrl || defaults.riva.asrUrl,
      ttsUrl: raw.riva?.ttsUrl || defaults.riva.ttsUrl,
      apiKey: raw.riva?.apiKey || defaults.riva.apiKey
    },
    audio2face: {
      url: raw.audio2face?.url || defaults.audio2face.url,
      apiKey: raw.audio2face?.apiKey || defaults.audio2face.apiKey
    },
    branding: {
      displayName: raw.branding?.displayName || defaults.branding.displayName,
      accentColor: raw.branding?.accentColor || defaults.branding.accentColor,
      avatarModelUrl: raw.branding?.avatarModelUrl || defaults.branding.avatarModelUrl
    }
  };
}

function loadFromEnvJson(): TenantConfig[] {
  const raw = process.env.TENANTS_JSON;
  if (!raw) {
    return [envToTenant()];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [envToTenant()];
    }

    const tenants = parsed.map((entry) => normalizeTenantEntry((entry || {}) as TenantFileEntry));
    return tenants;
  } catch (error) {
    console.warn(`TENANTS_JSON parse failed: ${error instanceof Error ? error.message : error}`);
    return [envToTenant()];
  }
}

function getTenants(): TenantConfig[] {
  if (!cachedTenants) {
    cachedTenants = loadFromEnvJson();
  }
  return cachedTenants;
}

export function resetTenantCache() {
  cachedTenants = null;
}

export function resolveTenant(slugOrHost?: string): TenantConfig {
  const candidates = getTenants();
  if (!slugOrHost) {
    return candidates[0];
  }

  const normalized = slugOrHost.toLowerCase().trim();
  const bySlug = candidates.find((tenant) => tenant.slug === sanitizeSlug(normalized));
  if (bySlug) {
    return bySlug;
  }

  const hostname = normalized.split(":")[0];
  const byHost = candidates.find((tenant) => tenant.hostnames.includes(hostname));
  if (byHost) {
    return byHost;
  }

  return candidates[0];
}

export function listPublicTenants(): TenantPublicConfig[] {
  return getTenants().map((tenant) => ({
    slug: tenant.slug,
    hostnames: tenant.hostnames,
    branding: tenant.branding
  }));
}
