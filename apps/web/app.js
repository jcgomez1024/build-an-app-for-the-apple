import { mountElviHalo } from "./halo.js?v=20261016-ui5";

const APP_BUILD_VERSION = "extras-done-followup-20260530-006";
window.__ELVI_BUILD_VERSION = APP_BUILD_VERSION;
console.log("[ELVI] App build:", APP_BUILD_VERSION);

// ── App state ─────────────────────────────────────────────────────────────
function newOrderSessionId() {
  try { return "web" + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : String(Date.now()) + Math.random().toString(36).slice(2)); } catch { return "web" + Date.now(); }
}

const state = {
  tenant: null,
  tenantSlug: resolveTenantSlug(),
  runtimeConfig: {
    fulfillmentModes: ["PICKUP"],
    deliveryEnabled: false,
    deliveryDisabledMessage: "Delivery by voice ordering is coming soon. Please use the regular online ordering site for delivery.",
    voiceOrderSource: "cocinaelvis.com"
  },
  sessionId: "",
  // Order context lives on the server per order session, until checkout (fix7).
  orderSessionId: newOrderSessionId(),
  ws: null,
  menu: [],
  cart: [],
  lastSelectedItem: null,
  language: "",
  fulfillment: "PICKUP",
  customer: {
    name: "",
    phone: "",
    email: "",
    address: ""
  },
  mediaRecorder: null,
  stream: null,
  recognition: null,
  localTranscript: "",
  activeSection: "Most Popular",
  menuSections: [],
  modifierDraft: null,
  modifierStepIndex: 0,
  pendingComboState: null,
  pendingComboPreview: null,
  lastComboAnimationKey: "",
  autoListen: false,
  elviSpeaking: false,
  vadRunning: false,
  turnInFlight: false,
  audioContext: null,
  audioProcessor: null,
  audioSourceNode: null,
  audioSilentNode: null,
  localTtsAudio: null,
  speechActive: false,
  prespeechChunks: [],
  turnAudioChunks: [],
  lastSpeechAt: 0,
  noiseFloor: 0.008,
  speechFrameCount: 0,
  silenceFrameCount: 0,
  turnSpeechFrameCount: 0,
  turnPeakRms: 0,
  speechStartedAt: 0,
  listenCooldownUntil: 0,
  xaiSessionReady: false,
  xaiTokenExpiresAt: 0,
  xaiTokenRefreshTimer: null,
  lastOrderContextDigest: "",
  micChunkBuffer: [],
  activeResponseId: "",
  activeReplyText: "",
  pendingActions: [],
  lastUserText: "",
  languagePromptLoopActive: false,
  languagePromptTimers: [],
  realtimeStarted: false,
  recognitionFinalTimer: null,
  recognitionPaused: false,
  voiceInputCooldownUntil: 0,
  currentBuildGuide: null,
  currentGuideStep: 0,
  currentBuildItem: null,
  currentBuildSelections: [],
};

const ui = {
  title: document.getElementById("brand-title"),
  heroDesc: document.getElementById("hero-description"),
  status: document.getElementById("hero-status"),
  reply: document.getElementById("assistant-reply"),
  engine: document.getElementById("assistant-engine"),
  listenButton: document.getElementById("listen-button"),
  stopButton: document.getElementById("stop-button"),
  promptForm: document.getElementById("prompt-form"),
  promptInput: document.getElementById("prompt-input"),
  langPills: [...document.querySelectorAll("[data-lang]")],
  cartList: document.getElementById("cart-list"),
  cartTotal: document.getElementById("cart-total"),
  checkoutForm: document.getElementById("checkout-form"),
  name: document.getElementById("customer-name"),
  phone: document.getElementById("customer-phone"),
  email: document.getElementById("customer-email"),
  address: document.getElementById("customer-address"),
  fulfillment: document.getElementById("fulfillment"),
  micWrap: document.getElementById("mic-wrap"),
  cartToggle: document.getElementById("cart-toggle"),
  cartDrawer: document.getElementById("cart-drawer"),
  cartClose: document.getElementById("cart-close"),
  cartBadge: document.getElementById("cart-badge"),
  drawerBackdrop: document.getElementById("drawer-backdrop"),
  selectionPreview: document.getElementById("selection-preview"),
  selectionPreviewImage: document.getElementById("selection-preview-image"),
  selectionPreviewName: document.getElementById("selection-preview-name"),
  selectionPreviewDescription: document.getElementById("selection-preview-description"),
  menuSections: document.getElementById("menu-sections"),
  menuGrid: document.getElementById("menu-grid"),
  modifierModal: document.getElementById("modifier-modal"),
  modifierSheet: document.getElementById("modifier-sheet"),
  modifierClose: document.getElementById("modifier-close"),
  modifierTitle: document.getElementById("modifier-title"),
  modifierSubtitle: document.getElementById("modifier-subtitle"),
  modifierGroups: document.getElementById("modifier-groups"),
  modifierAdd: document.getElementById("modifier-add"),
  selectedItemsList: document.getElementById("selected-items-list"),
  comboBack: document.getElementById("combo-tracker-back"),
  comboNext: document.getElementById("combo-tracker-next"),
};

// Hoisted early to avoid TDZ errors during boot() / language prompt loop
let _sharedAudioCtx      = null;
let _currentAudioSource  = null;
let _queuedSources       = [];
let _nextPlayTime        = 0;

// ── Mount Elvi halo (replaces 3-D avatar) ──────────────────────────────────
let elvi = null;
try {
  elvi = mountElviHalo(document.getElementById("elvi-halo"));
} catch (error) {
  console.warn("[HALO] Halo disabled; continuing with ordering UI:", error);
}

function setAvatarState(s) {
  if (elvi) {
    elvi.setState(s);
    if (s === "listening" && state.stream) elvi.attachStream?.(state.stream);
  }
  if (ui.micWrap) {
    ui.micWrap.classList.toggle("listening", s === "listening");
    ui.micWrap.classList.toggle("talking", s === "talking_neutral" || s === "happy" || s === "excited" || s === "questioning");
    ui.micWrap.classList.toggle("frustrated", s === "frustrated" || s === "error");
  }
}

let avatarPulseToken = 0;

const LANGUAGE_PROMPT_EN = "Please select your preferred language to continue.";
const LANGUAGE_PROMPT_ES = "Por favor selecciona tu idioma preferido para continuar.";
const LANGUAGE_PROMPT_BILINGUAL = `${LANGUAGE_PROMPT_EN} / ${LANGUAGE_PROMPT_ES}`;

function pulseAvatarState(stateName, durationMs, fallbackState = "idle") {
  const token = ++avatarPulseToken;
  setAvatarState(stateName);
  window.setTimeout(() => {
    if (token !== avatarPulseToken) {
      return;
    }
    setAvatarState(fallbackState);
  }, durationMs);
}

function getEffectiveLanguage() {
  return state.language === "es" ? "es" : "en";
}

function hasSelectedLanguage() {
  return state.language === "en" || state.language === "es";
}

// carlos-ux: v3 menu-first — language gate only on Hablar (ui1), not on boot
function isV3MenuUi() {
  try { return new URLSearchParams(location.search).get("menu") !== "old"; } catch { return true; }
}

function getLanguageIntro() {
  return getEffectiveLanguage() === "es"
    ? "Español seleccionado. Soy Elvi. Lista para tomar tu orden."
    : "English selected. My name is Elvi. Ready to take your order.";
}

function clearLanguagePromptTimers() {
  state.languagePromptTimers.forEach((timer) => window.clearTimeout(timer));
  state.languagePromptTimers = [];
}

function queueLanguagePromptTimer(callback, delayMs) {
  const timer = window.setTimeout(() => {
    state.languagePromptTimers = state.languagePromptTimers.filter((id) => id !== timer);
    callback();
  }, delayMs);
  state.languagePromptTimers.push(timer);
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function markLocalTurnReady() {
  state.turnInFlight = false;
  ui.status.textContent = "Connected";
}

function isLocalBuildActive() {
  return Boolean(state.currentBuildGuide || state.pendingComboState);
}

function cancelRealtimeResponseDuringLocalBuild() {
  if (!isLocalBuildActive()) return false;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendWs({ type: "response.cancel" });
    sendWs({ type: "input_audio_buffer.clear" });
  }
  state.activeReplyText = "";
  state.pendingActions = [];
  state.turnInFlight = false;
  return true;
}

function speakBrowserText(text, lang) {
  if (!("speechSynthesis" in window) || !text) {
    return null;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
  return utterance;
}

function stopLocalTtsAudio() {
  if (!state.localTtsAudio) {
    return;
  }

  try {
    state.localTtsAudio.pause();
    state.localTtsAudio.currentTime = 0;
  } catch {}
  state.localTtsAudio = null;
}

async function speakLocalText(text, language = getEffectiveLanguage(), options = {}) {
  clearReplyWatchdog();
  const cleanText = formatCentsForSpeech(text, language).trim();
  if (!cleanText) {
    return;
  }

  if (typeof options.shouldContinue === "function" && !options.shouldContinue()) {
    return;
  }
  pauseBrowserRecognition();
  stopCurrentAudio();

  try {
    const response = await fetch(`/api/${state.tenantSlug}/xai/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: cleanText, language })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.audioBase64) {
      throw new Error(result.error || "xAI speech unavailable");
    }

    if (typeof options.shouldContinue === "function" && !options.shouldContinue()) {
      return;
    }
    await playLocalAudioBase64(result.audioBase64, result.mimeType || "audio/mpeg");
  } catch (error) {
    console.warn("[TTS] xAI local speech fallback:", error);
    speakBrowserText(cleanText, language === "es" ? "es-US" : "en-US");
    await wait(Math.max(1800, cleanText.length * 55));
  } finally {
    state.voiceInputCooldownUntil = performance.now() + 650;
    resumeBrowserRecognition();
  }
}

function playLocalAudioBase64(audioBase64, mimeType = "audio/mpeg") {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    state.localTtsAudio = audio;
    state.elviSpeaking = true;
    setAvatarState("talking_neutral");
    audio.onended = () => {
      if (state.localTtsAudio === audio) {
        state.localTtsAudio = null;
        state.elviSpeaking = false;
        if (!state.turnInFlight) setAvatarState("idle");
      }
      resolve();
    };
    audio.onerror = () => {
      if (state.localTtsAudio === audio) {
        state.localTtsAudio = null;
        state.elviSpeaking = false;
        if (!state.turnInFlight) setAvatarState("idle");
      }
      reject(new Error("xAI local audio playback failed"));
    };
    audio.play().catch((error) => {
      if (state.localTtsAudio === audio) {
        state.localTtsAudio = null;
        state.elviSpeaking = false;
        if (!state.turnInFlight) setAvatarState("idle");
      }
      reject(error);
    });
  });
}

async function speakXAIOnly(text, lang) {
  // Always use xAI TTS for the language prompt — never fall back to robotic browser voice
  try {
    const res = await fetch(`/api/${state.tenantSlug}/xai/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language: lang })
    });
    const data = await res.json();
    if (res.ok && data.audioBase64) {
      await playLocalAudioBase64(data.audioBase64, data.mimeType || "audio/mpeg");
    }
  } catch (err) {
    console.warn("[LanguagePrompt] xAI speech failed, skipping (no robotic fallback)");
  }
}

async function announceLanguagePromptLoop() {
  if (!state.languagePromptLoopActive || hasSelectedLanguage()) {
    return;
  }

  if (!state.xaiSessionReady) {
    queueLanguagePromptTimer(announceLanguagePromptLoop, 800);
    return;
  }

  const shouldContinue = () => state.languagePromptLoopActive && !hasSelectedLanguage();

  await speakXAIOnly(LANGUAGE_PROMPT_EN, "en");
  if (!state.languagePromptLoopActive || hasSelectedLanguage()) return;

  await wait(900);

  if (!state.languagePromptLoopActive || hasSelectedLanguage()) return;
  await speakXAIOnly(LANGUAGE_PROMPT_ES, "es");

  // Repeat after ~5 seconds of inactivity
  queueLanguagePromptTimer(announceLanguagePromptLoop, 5000);
}

function startLanguagePromptLoop() {
  if (hasSelectedLanguage() || state.languagePromptLoopActive) {
    return;
  }

  state.languagePromptLoopActive = true;
  clearLanguagePromptTimers();

  // First gentle reminder after ~5 seconds of inactivity
  queueLanguagePromptTimer(announceLanguagePromptLoop, 5000);
}

function stopLanguagePromptLoop() {
  state.languagePromptLoopActive = false;
  clearLanguagePromptTimers();
  stopLocalTtsAudio();
  window.speechSynthesis?.cancel();
}

function restartLanguagePromptLoop() {
  if (hasSelectedLanguage()) {
    return;
  }

  stopLanguagePromptLoop();
  startLanguagePromptLoop();
}

function speakSelectedLanguageIntro() {
  void speakLocalText(getLanguageIntro(), getEffectiveLanguage());
}

function formatCentsForSpeech(text, language = getEffectiveLanguage()) {
  const centsWord = language === "es" ? "centavos" : "cents";
  return String(text || "")
    .replace(/\$0\.(\d{1,2})\b/g, (_, cents) => {
      const value = Number(cents.padEnd(2, "0"));
      return `${value} ${centsWord}`;
    })
    .replace(/\b0\.(\d{1,2})\s*(?:dollars?|dolares|dólares)\b/gi, (_, cents) => {
      const value = Number(cents.padEnd(2, "0"));
      return `${value} ${centsWord}`;
    })
    .replace(/(^|[^\d])\.(\d{1,2})\s*(?:dollars?|dolares|dólares)?\b/gi, (match, prefix, cents) => {
      const value = Number(cents.padEnd(2, "0"));
      return `${prefix}${value} ${centsWord}`;
    });
}

function interpolateReplyText(template, values = {}) {
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => (
    values[key] === undefined || values[key] === null ? "" : String(values[key])
  ));
}

function updateLanguageGate() {
  const selected = hasSelectedLanguage();
  const v3 = isV3MenuUi();
  if (ui.promptInput) {
    // v3: browsing/typing never blocked; Hablar gates voice language
    ui.promptInput.disabled = v3 ? false : !selected;
    ui.promptInput.placeholder = selected
      ? (getEffectiveLanguage() === "es" ? "Escribe tu orden..." : "Type your order...")
      : (v3 ? (getEffectiveLanguage() === "es" ? "Escribe tu orden..." : "Type your order...") : "Select language first...");
  }
  if (ui.listenButton) {
    ui.listenButton.disabled = v3 ? false : !selected;
    ui.listenButton.setAttribute("aria-disabled", (v3 || selected) ? "false" : "true");
  }
  if (!selected && ui.reply && !v3) {
    ui.reply.textContent = LANGUAGE_PROMPT_BILINGUAL;
    startLanguagePromptLoop();
  }
  // v3: skip boot language nag — Hablar capsule shows "Selecciona tu idioma…" only if lang unknown
}

function setLanguageMode(mode) {
  state.language = mode === "es" ? "es" : "en";
  stopLanguagePromptLoop();

  ui.langPills.forEach((pill) => {
    pill.classList.toggle("pill-active", pill.dataset.lang === state.language);
  });

  ui.reply.textContent = getLanguageIntro();
  updateLanguageGate();
  renderMenuExplorer();
  renderCart();
  syncRealtimeOrderContext();

  // Start xAI realtime voice only after language is confirmed
  if (!state.realtimeStarted) {
    state.realtimeStarted = true;
    ui.status.textContent = "Starting voice agent…";
    console.log("[BOOT] Language selected — starting xAI realtime session");
    openRealtimeSession()
      .then(() => {
        // On success, the internal logic in openRealtimeSession will set "Connected"
        // when the session.updated message arrives.
      })
      .catch((err) => {
        ui.status.textContent = "Failed to start voice. Please refresh the page.";
        console.error("[VOICE] Failed to start realtime after language selection:", err);
      });
  }

  // Optional short welcome using proper xAI voice (after session is ready)
  setTimeout(() => {
    if (state.xaiSessionReady) {
      speakSelectedLanguageIntro();
    }
  }, 800);
}

boot().catch((error) => {
  ui.status.textContent = `Startup failed: ${error.message}`;
  console.error("[BOOT] Error during startup:", error);
});

async function boot() {
  try {
    console.log("[BOOT] Starting application boot");
    if (ui.engine) ui.engine.textContent = `Build ${APP_BUILD_VERSION}`;
    attachUiHandlers();
    renderSelectedPreview(null);
    updateLanguageGate();
    console.log("[BOOT] Loading tenant branding");
    await loadTenantBranding();
    console.log("[BOOT] Loading runtime config");
    await loadRuntimeConfig();
    console.log("[BOOT] Loading menu");
    await loadMenu();
    console.log("[BOOT] Building menu sections");
    buildMenuSections();
    renderMenuExplorer();
    console.log("[BOOT] Opening realtime session early (for language prompt)");
    // Start session early so we can use proper xAI voice for the language selection prompt
    openRealtimeSession().catch(() => {});
    ui.status.textContent = isV3MenuUi() ? "Ready" : "Select language to begin";
  } catch (err) {
    console.error("[BOOT] Error:", err);
    throw err;
  }
}

function resolveTenantSlug() {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("tenant");
  if (fromQuery) {
    return fromQuery;
  }

  const hostBits = window.location.hostname.split(".");
  if (hostBits.length > 2) {
    return hostBits[0].toLowerCase();
  }

  return "cocina-elvis";
}

async function loadTenantBranding() {
  const response = await fetch("/api/tenants");
  if (!response.ok) {
    return;
  }

  const body = await response.json();
  const tenants = Array.isArray(body.tenants) ? body.tenants : [];
  const tenant = tenants.find((item) => item.slug === state.tenantSlug) || tenants[0];
  if (!tenant) {
    return;
  }

  state.tenant = tenant;
  state.tenantSlug = tenant.slug;
  ui.title.textContent = `${tenant.branding.displayName} — Elvi`;
  ui.heroDesc.textContent =
    "Ask Elvi in English or Spanish. She listens, confirms your order, and sends it straight to checkout.";
  document.documentElement.style.setProperty("--accent", tenant.branding.accentColor || "#e2511d");
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      return;
    }
    const config = await response.json();
    state.runtimeConfig = {
      ...state.runtimeConfig,
      ...config,
      fulfillmentModes: Array.isArray(config.fulfillmentModes) && config.fulfillmentModes.length
        ? config.fulfillmentModes
        : ["PICKUP"],
      deliveryEnabled: Boolean(config.deliveryEnabled)
    };
  } finally {
    applyFulfillmentAvailability();
  }
}

function isDeliveryEnabled() {
  return Boolean(state.runtimeConfig.deliveryEnabled && state.runtimeConfig.fulfillmentModes.includes("DELIVERY"));
}

function deliveryDisabledMessage() {
  return state.runtimeConfig.deliveryDisabledMessage || "Delivery by voice ordering is coming soon. Please use the regular online ordering site for delivery.";
}

function applyFulfillmentAvailability() {
  if (!ui.fulfillment) return;
  [...ui.fulfillment.options].forEach((option) => {
    if (option.value === "DELIVERY") {
      option.disabled = !isDeliveryEnabled();
      option.hidden = !isDeliveryEnabled();
    }
  });
  if (!state.runtimeConfig.fulfillmentModes.includes(state.fulfillment) || (state.fulfillment === "DELIVERY" && !isDeliveryEnabled())) {
    state.fulfillment = "PICKUP";
  }
  ui.fulfillment.value = state.fulfillment;
  ui.address?.closest(".field-row")?.classList.toggle("is-hidden", !isDeliveryEnabled());
}

async function loadMenu() {
  console.log("[MENU] Loading menu for tenant:", state.tenantSlug);
  const response = await fetch(`/api/${state.tenantSlug}/menu`);
  console.log("[MENU] Response status:", response.status);
  if (!response.ok) {
    const errText = await response.text();
    console.error("[MENU] Menu load failed:", errText);
    throw new Error("Unable to load menu");
  }

  const body = await response.json();
  state.menu = Array.isArray(body.items) ? body.items : [];
  console.log("[MENU] Loaded", state.menu.length, "items");
}

function sectionForItem(item) {
  const name = String(item.name || "").toLowerCase();
  if (/combo|burrito|family pack/.test(name)) return "Elvis Combos";
  if (/meal|plate|bowl/.test(name)) return "Elvis Meals";
  if (/taco|empanada|maduros|sandwich|quesadilla/.test(name)) return "Most Popular";
  return "More Favorites";
}

function buildMenuSections() {
  const base = ["Most Popular", "Elvis Combos", "Elvis Meals", "More Favorites"];
  const hasBySection = new Map(base.map((k) => [k, false]));
  for (const item of state.menu) {
    hasBySection.set(sectionForItem(item), true);
  }
  state.menuSections = base.filter((name) => hasBySection.get(name));
  if (!state.menuSections.length) {
    state.menuSections = ["Most Popular"];
  }
  if (!state.menuSections.includes(state.activeSection)) {
    state.activeSection = state.menuSections[0];
  }
}

function getItemsForActiveSection() {
  const items = state.menu.filter((item) => sectionForItem(item) === state.activeSection);
  return state.activeSection === "Most Popular" ? items.slice(0, 10) : items;
}

function renderMenuExplorer() {
  if (!ui.menuSections || !ui.menuGrid) return;

  ui.menuSections.innerHTML = "";
  for (const sectionName of state.menuSections) {
    const button = document.createElement("button");
    button.className = `menu-section-pill${sectionName === state.activeSection ? " active" : ""}`;
    button.type = "button";
    button.textContent = sectionName;
    button.addEventListener("click", () => {
      state.activeSection = sectionName;
      renderMenuExplorer();
    });
    ui.menuSections.appendChild(button);
  }

  const items = getItemsForActiveSection();
  ui.menuGrid.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "menu-card";
    card.addEventListener("click", () => {
      handleMenuItemSelected(item);
    });

    const image = document.createElement("img");
    image.src = item.imageUrl || "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=640&q=70";
    image.alt = item.name;
    card.appendChild(image);

    const body = document.createElement("div");
    body.className = "menu-card-body";

    const name = document.createElement("p");
    name.className = "menu-card-name";
    name.textContent = getEffectiveLanguage() === "es" ? item.nameEs : item.name;

    const meta = document.createElement("p");
    meta.className = "menu-card-meta";
    const modifierCount = Array.isArray(item.modifierGroups) ? item.modifierGroups.length : 0;
    meta.textContent = modifierCount > 0
      ? `${modifierCount} customizable group${modifierCount > 1 ? "s" : ""}`
      : "Quick add";

    const row = document.createElement("div");
    row.className = "menu-card-row";

    const price = document.createElement("strong");
    price.textContent = centsToUsd(item.priceCents || 0);

    const addBtn = document.createElement("button");
    addBtn.className = "menu-add-btn";
    addBtn.type = "button";
    addBtn.textContent = "Customize";
    addBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      handleMenuItemSelected(item);
      openModifierModal(item);
    });

    row.appendChild(price);
    row.appendChild(addBtn);
    body.appendChild(name);
    body.appendChild(meta);
    body.appendChild(row);
    card.appendChild(body);
    ui.menuGrid.appendChild(card);
  }
}

function handleMenuItemSelected(item) {
  state.lastSelectedItem = item;
  renderSelectedPreview(item);

  if (elvi && typeof elvi.presentItemSelection === "function") {
    void elvi.presentItemSelection();
  }
}

function openModifierModal(item) {
  if (!ui.modifierModal || !ui.modifierGroups || !ui.modifierTitle || !ui.modifierSubtitle || !ui.modifierAdd) return;
  const groups = Array.isArray(item.modifierGroups) ? item.modifierGroups : [];

  if (!groups.length) {
    addCartItem(item, 1);
    renderCart();
    pulseAvatarState("happy", 1000, "talking_neutral");
    return;
  }

  state.modifierDraft = {
    item,
    groups,
    selections: Object.fromEntries(groups.map((g) => [g.id, {}]))
  };
  // fix16: the included mild Salsa Asada starts selected (tap another salsa to switch).
  for (const { group, option } of includedSalsaDefaultsWeb(item)) {
    state.modifierDraft.selections[group.id] = { [optionDisplayName(option)]: 1 };
  }
  state.modifierStepIndex = 0;

  ui.modifierTitle.textContent = getEffectiveLanguage() === "es" ? `Personaliza ${item.nameEs}` : `Customize ${item.name}`;

  renderModifierGroups();
  ui.modifierModal.classList.remove("is-hidden");
  ui.modifierModal.setAttribute("aria-hidden", "false");
}

function closeModifierModal() {
  if (!ui.modifierModal) return;
  ui.modifierModal.classList.add("is-hidden");
  ui.modifierModal.setAttribute("aria-hidden", "true");
  state.modifierDraft = null;
  state.modifierStepIndex = 0;
  clearComboTracker();
}

function selectedModifierCount(groupId) {
  const selected = state.modifierDraft?.selections?.[groupId] || {};
  return Object.values(selected).filter((n) => Number(n) > 0).length;
}

function toModifierLines() {
  if (!state.modifierDraft) return [];
  const lines = [];
  for (const group of state.modifierDraft.groups) {
    const selected = state.modifierDraft.selections[group.id] || {};
    for (const [option, qty] of Object.entries(selected)) {
      if (qty > 0) {
        const meta = findModifierOption(group, option);
        lines.push({
          groupId: group.id,
          groupName: group.name,
          option,
          optionId: meta?.id,
          priceDeltaCents: meta?.priceDeltaCents,
          quantity: qty
        });
      }
    }
  }
  return lines;
}

function optionDisplayName(option) {
  return typeof option === "object" && option !== null ? String(option.name || "") : String(option || "");
}

function findModifierOption(group, optionName) {
  const key = normalizeOptionKey(optionName);
  return (group.options || []).find((option) => normalizeOptionKey(optionDisplayName(option)) === key);
}

function validateModifierDraft() {
  if (!state.modifierDraft) return false;
  return state.modifierDraft.groups.every((group) => {
    const min = Math.max(0, Number(group.minSelections || 0));
    const count = selectedModifierCount(group.id);
    return count >= min;
  });
}

function isModifierGroupSatisfied(group) {
  const min = Math.max(0, Number(group?.minSelections || 0));
  if (!group) return false;
  return selectedModifierCount(group.id) >= min;
}

function getModifierStepSelections(group) {
  const selected = state.modifierDraft?.selections?.[group.id] || {};
  const values = [];
  for (const [option, qty] of Object.entries(selected)) {
    const count = Math.max(1, Number(qty) || 1);
    values.push(count > 1 ? `${count} x ${option}` : option);
  }
  return values;
}

function animateModifierBuildStep(group) {
  if (!state.modifierDraft || !group) return;

  const step = state.modifierStepIndex + 1;
  const totalSteps = state.modifierDraft.groups.length;
  const stepName = group.name || "";
  const selections = toModifierLines().map((line) =>
    line.quantity > 1 ? `${line.quantity} x ${line.option}` : line.option
  );
  const groupSelections = getModifierStepSelections(group);
  const currentOption = groupSelections?.[0] || "";

  renderComboTracker(
    getEffectiveLanguage() === "es" ? state.modifierDraft.item.nameEs : state.modifierDraft.item.name,
    step,
    totalSteps,
    selections,
    stepName,
    Array.isArray(group.options) ? group.options.map(optionDisplayName) : []
  );

  if (elvi && typeof elvi.performBuildStep === "function") {
    void elvi.performBuildStep({
      step,
      totalSteps,
      stepName,
      option: currentOption,
      selections: groupSelections
    });
  }
}

function handleModifierStepAdvance() {
  if (!state.modifierDraft || !ui.modifierAdd) return;

  const groups = state.modifierDraft.groups;
  const stepIndex = Math.max(0, Math.min(state.modifierStepIndex, groups.length - 1));
  const currentGroup = groups[stepIndex];
  if (!currentGroup || !isModifierGroupSatisfied(currentGroup)) {
    return;
  }

  animateModifierBuildStep(currentGroup);

  if (stepIndex < groups.length - 1) {
    state.modifierStepIndex = stepIndex + 1;
    renderModifierGroups();
    return;
  }

  const modifierLines = toModifierLines();
  addCartItem(state.modifierDraft.item, 1, modifierLines);
  renderCart();
  closeModifierModal();
  pulseAvatarState("happy", 1000, "talking_neutral");
}

function renderModifierGroups() {
  if (!state.modifierDraft || !ui.modifierGroups || !ui.modifierAdd) return;
  ui.modifierGroups.innerHTML = "";

  const groups = state.modifierDraft.groups;
  const stepIndex = Math.max(0, Math.min(state.modifierStepIndex, groups.length - 1));
  const group = groups[stepIndex];
  if (!group) {
    ui.modifierAdd.disabled = true;
    return;
  }

  const min = Math.max(0, Number(group.minSelections || 0));
  const max = Math.max(min || 0, Number(group.maxSelections || 1));
  const allowQuantities = Boolean(group.allowQuantities || max > 1);
  const selected = state.modifierDraft.selections[group.id] || {};

  ui.modifierSubtitle.textContent = getEffectiveLanguage() === "es"
    ? `Paso ${stepIndex + 1} de ${groups.length}: ${group.name}`
    : `Step ${stepIndex + 1} of ${groups.length}: ${group.name}`;

  const shell = document.createElement("section");
  shell.className = "modifier-group";

  const title = document.createElement("p");
  title.className = "modifier-group-title";
  title.textContent = group.name;

  const limit = document.createElement("p");
  limit.className = "modifier-group-limit";
  limit.textContent = `Min ${min} · Max ${max}`;

  shell.appendChild(title);
  shell.appendChild(limit);

  for (const option of group.options || []) {
    const optionLabel = optionDisplayName(option);
    if (!optionLabel) continue;
    const row = document.createElement("div");
    row.className = "modifier-option-row";

    const label = document.createElement("span");
    label.className = "modifier-option-name";
    label.textContent = optionLabel;

    const controls = document.createElement("div");
    controls.className = "modifier-stepper";

    const dec = document.createElement("button");
    dec.type = "button";
    dec.textContent = "-";

    const count = document.createElement("span");
    const currentQty = Number(selected[optionLabel] || 0);
    count.textContent = String(currentQty);

    const inc = document.createElement("button");
    inc.type = "button";
    inc.textContent = "+";

    dec.addEventListener("click", () => {
      const next = Math.max(0, Number((state.modifierDraft.selections[group.id] || {})[optionLabel] || 0) - 1);
      if (!state.modifierDraft.selections[group.id]) state.modifierDraft.selections[group.id] = {};
      if (next <= 0) {
        delete state.modifierDraft.selections[group.id][optionLabel];
      } else {
        state.modifierDraft.selections[group.id][optionLabel] = next;
      }
      renderModifierGroups();
    });

    inc.addEventListener("click", () => {
      const groupSelections = state.modifierDraft.selections[group.id] || {};
      const distinctCount = Object.values(groupSelections).filter((v) => Number(v) > 0).length;
      const current = Number(groupSelections[optionLabel] || 0);
      const addingNewDistinct = current <= 0;
      if (addingNewDistinct && distinctCount >= max) {
        return;
      }

      if (!state.modifierDraft.selections[group.id]) state.modifierDraft.selections[group.id] = {};
      if (!allowQuantities) {
        state.modifierDraft.selections[group.id] = { [optionLabel]: 1 };
      } else {
        state.modifierDraft.selections[group.id][optionLabel] = Math.min(9, current + 1);
      }
      renderModifierGroups();
    });

    controls.appendChild(dec);
    controls.appendChild(count);
    controls.appendChild(inc);
    row.appendChild(label);
    row.appendChild(controls);
    shell.appendChild(row);
  }

  ui.modifierGroups.appendChild(shell);

  const isLastStep = stepIndex >= groups.length - 1;
  ui.modifierAdd.textContent = isLastStep
    ? (getEffectiveLanguage() === "es" ? "Agregar al carrito" : "Add to cart")
    : (getEffectiveLanguage() === "es" ? "Siguiente paso" : "Next step");
  ui.modifierAdd.disabled = !isModifierGroupSatisfied(group);
}

async function openRealtimeSession() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    try { state.ws.close(); } catch {}
  }

  console.log("[REALTIME] Opening session, tenant slug:", state.tenantSlug);
  const tokenRes = await fetch(`/api/${state.tenantSlug}/xai/client-secret`, { method: "POST" });
  console.log("[REALTIME] Token response status:", tokenRes.status);
  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error("[REALTIME] Token mint failed:", tokenRes.status, errBody);
    throw new Error("Unable to mint xAI realtime token");
  }
  const tokenBody = await tokenRes.json();
  console.log("[REALTIME] Token body received:", !!tokenBody.token);
  const token = String(tokenBody.token || "");
  if (!token) {
    throw new Error("xAI token mint failed");
  }

  state.xaiTokenExpiresAt = Number(tokenBody.expiresAt || 0);
  scheduleTokenRefresh();

  console.log("[REALTIME] Connecting to WebSocket with token");
  const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0", [
    `xai-client-secret.${token}`
  ]);
  state.ws = ws;
  state.xaiSessionReady = false;
  state.activeReplyText = "";
  state.pendingActions = [];

  ws.addEventListener("open", () => {
    console.log("[REALTIME] WebSocket connected");
    ui.status.textContent = "Connecting voice agent…";
    ws.send(JSON.stringify(buildSessionUpdatePayload()));
  });

  ws.addEventListener("close", () => {
    console.log("[REALTIME] WebSocket closed");
    if (state.turnInFlight) void speakFallbackReply(); // reply1: a dropped live session mid-turn still gets an answer
    state.xaiSessionReady = false;
    state.turnInFlight = false;
    ui.status.textContent = "Realtime disconnected";
    setAvatarState("idle");
  });

  ws.addEventListener("error", (event) => {
    console.error("[REALTIME] WebSocket error:", event);
  });

  ws.addEventListener("message", async (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "session.updated") {
      state.xaiSessionReady = true;
      flushMicChunkBuffer();
      ui.status.textContent = "Connected";
      if (!isLocalBuildActive()) ui.engine.textContent = "";
      syncRealtimeOrderContext();
      return;
    }

    if (payload.type === "response.created") {
      if (cancelRealtimeResponseDuringLocalBuild()) {
        return;
      }
      state.turnInFlight = true; setAvatarState("thinking");
      state.activeResponseId = payload.response?.id || "";
      state.activeReplyText = "";
      state.pendingActions = [];
      ui.status.textContent = "Processing…";
      return;
    }

    if (payload.type === "input_audio_buffer.speech_started") {
      beginRealtimeTurnCartCheck();
      if (isLocalBuildActive()) return;
      if (!state.autoListen || state.speechActive) {
        stopCurrentAudio();
        sendWs({ type: "response.cancel" });
      }
      return;
    }

    if (payload.type === "input_audio_buffer.speech_stopped") {
      if (isLocalBuildActive()) return;
      if (!state.autoListen) {
        sendWs({ type: "response.create" });
      }
      return;
    }

    if (payload.type === "response.output_audio.delta" && payload.delta) {
      clearReplyWatchdog();
      if (isLocalBuildActive()) return;
      console.log("[AUDIO] Received output_audio.delta, type:", typeof payload.delta, "length:", String(payload.delta).length);
      queuePcmDeltaForPlayback(payload.delta);
      return;
    }

    if ((payload.type === "response.output_audio_transcript.delta" || payload.type === "response.output_text.delta") && payload.delta) {
      clearReplyWatchdog();
      if (isLocalBuildActive()) return;
      state.activeReplyText += String(payload.delta || "");
      ui.reply.textContent = formatCentsForSpeech(state.activeReplyText);
      setAvatarState(detectMood(state.activeReplyText));
      return;
    }

    if (/input_audio.*transcription.*(completed|done|final)/i.test(String(payload.type || "")) && payload.transcript) {
      state.lastUserText = String(payload.transcript || "").trim();
      armReplyWatchdog();
      return;
    }

    if (payload.type === "response.function_call_arguments.done") {
      if (cancelRealtimeResponseDuringLocalBuild()) {
        return;
      }
      // reply1: a failed tool call (server restart, network) used to throw here → no function output → Elvi went silent.
      let result;
      try { result = await handleToolCall(payload.name, payload.arguments || "{}"); }
      catch (err1) {
        console.warn("[TOOL] failed, retrying once", err1);
        await new Promise((r) => setTimeout(r, 1500));
        try { result = await handleToolCall(payload.name, payload.arguments || "{}"); }
        catch (err2) { console.warn("[TOOL] failed twice", err2); result = { output: { ok: false, reason: "server_unavailable", message: fallbackReplyText(), instruction: "Nothing changed in the cart. Say the message, then wait." } }; }
      }
      result = result || { output: { ok: false, reason: "no_result", message: fallbackReplyText() } };
      const actions = result.actions || (result.action ? [result.action] : []);
      if (result.output?.ok === false && /unknown_menu_item|item_not_available/.test(String(result.output.reason || ""))) {
        state.lastUnavailableMessage = String(state.lastUnavailableMessage || result.output.message || "");
        result.output = { ...result.output, message: state.lastUnavailableMessage || result.output.message, instruction: "Nothing was added to the cart. Do not say added. Say the message." };
      }
      if (actions.length) {
        state.pendingActions.push(...actions);
        applyActions(actions);
        result.output = {
          ...(result.output || {}),
          orderState: buildOrderStateSnapshot(),
          cartItemCount: getCartItemCount(),
          lastAdded: describeCartLine(state.cart[state.cart.length - 1])
        };
      }
      sendWs({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: payload.call_id,
          output: JSON.stringify(result.output)
        }
      });

      // Reactive build UI update using the new consistent helper
      // Model is free to speak naturally; visuals stay beautiful
      if (result.output?.comboStep || result.output?.buildProgress) {
        const bp = normalizeBuildProgress(result.output);
        if (bp) state.lastBuildProgress = bp;
        updateBuildVisuals(result.output);
        pulseAvatarState("questioning", 900, "idle");
      }

      // Let the model continue naturally (new behavior)
      sendWs({ type: "response.create" });
      return;
    }

    if (payload.type === "response.done") {
      if (isLocalBuildActive()) {
        state.turnInFlight = false;
        ui.status.textContent = "Connected";
        state.activeReplyText = "";
        return;
      }
      state.turnInFlight = false;
      ui.status.textContent = "Connected";
      ui.engine.textContent = "";
      if (!state.elviSpeaking) {
        setAvatarState("idle");
      }
      correctFalseAddedClaim(state.activeReplyText);

      // Guide step advancement: if the model has started talking about the next step in the guide, advance the visual
      if (state.currentBuildGuide && state.currentGuideStep) {
        const guide = state.currentBuildGuide;
        const currentIdx = state.currentGuideStep - 1;

        if (currentIdx + 1 < guide.steps.length) {
          const nextStep = guide.steps[currentIdx + 1];
          const lastReply = (state.activeReplyText || "").toLowerCase();
          const nextTitle = nextStep.title.toLowerCase();

          // Check if the model is now on the next step (common keywords or exact title)
          const hasMovedOn = lastReply.includes(nextTitle) ||
                             (nextTitle.includes("deluxe") && lastReply.includes("deluxe")) ||
                             (nextTitle.includes("dip") && lastReply.includes("dip"));

          if (hasMovedOn) {
            state.currentGuideStep = state.currentGuideStep + 1;
            updateBuildVisuals({});
          }
        }
      }

      syncRealtimeOrderContext();
      return;
    }

    if (payload.type === "error") {
      state.turnInFlight = false;
      ui.status.textContent = payload.message || "Realtime error";
      setAvatarState("frustrated");
      setTimeout(() => setAvatarState("idle"), 2500);
    }
  });
}

function getResilientElviInstructions(language) {
  const langLock = language === "es"
    ? "OUTPUT_LANGUAGE_LOCK=Spanish. Responde solo en español. Frases cortas y naturales: 'Agregado.', 'Quitado.', '¿Algo más?', '¿Para recoger?'. Nunca mezcles idiomas en una misma respuesta salvo nombres exactos del menú."
    : "OUTPUT_LANGUAGE_LOCK=English. Reply only in English. Keep replies short and natural: 'Added.', 'Removed.', 'Anything else?', 'Pickup?'. Never mix languages in one reply except exact menu item names.";

  return (
    "You are Elvi, the fast, confident, direct order taker at Cocina Elvis.\n\n" +
    "Your only job is to take accurate orders. Speak like experienced restaurant staff — short, clear, warm but efficient. Never make small talk, never upsell, never explain the app or how to use it.\n\n" +
    "Core principles:\n" +
    "- The 'Current Order State' provided below is the single source of truth. Always trust it over your memory.\n" +
    "- Never invent menu items, pack sizes, combos, modifier names, fees, or delivery options. If the customer asks for 'another combo' or a vague combo, ask which real combo: COMBO Mix, COMBO Gorditas, COMBO Tortas, COMBO Burrito, COMBO Quesadillas, or COMBO Tacos.\n" +
    "- When the current build is asking which combo, the next customer answer must be interpreted ONLY as one of those combo choices. 'Gordita' or 'gorditas' means COMBO Gorditas, never a fiesta platter or standalone gordita item.\n" +
    "- Restaurant background noise is not an order. Ignore side conversations, kitchen noise, music, fragments, laughter, one-word unclear sounds, and anything not clearly directed at you as a customer order or correction.\n" +
    "- Accuracy beats speed. If speech is noisy or unclear, do not guess. Ask one short clarification question before changing the order.\n" +
    "- When the customer says something unclear, changes their mind, or goes off-script, acknowledge naturally in one short sentence and steer back to the current order or the next logical choice. Recovery must feel human.\n" +
    "- Builds and combos (pack meals, etc.) are handled conversationally. You decide what question to ask next based on what has already been decided. You do NOT follow a rigid external script.\n" +
    "- After any successful change, give a tiny confirmation ('Added.', 'Got the two asada.', 'Removed it.') then ask 'Anything else?' or move on.\n" +
    "- Only ask for name, phone, or pickup confirmation when the customer is finishing or the order is otherwise complete.\n" +
    (isDeliveryEnabled()
      // delivery1: same rules as services/api/src/delivery.ts deliveryDialogRules(); the app never offers a saved address (no phone verification).
      ? "- Before checkout, if pickup/delivery is not set yet, ask exactly: \"¿Para entrega a domicilio o para recoger hoy?\" (English: \"Delivery or pickup today?\"). \"Para llevar\" / \"to go\" / \"recoger\" means PICKUP, not delivery. If DELIVERY: ask for the full address (street, number, apartment, city); never mention or guess a saved address. Then call set_address and check_delivery_zone, and say the city, delivery fee and ETA from its result. If it says needs_confirm, say staff will confirm the zone and fee — never guess a fee. If outside the delivery area, offer pickup. Delivery needs a food subtotal of at least $10 before the delivery fee: if under $10, say \"El mínimo para entrega es de $10.\" / \"The delivery minimum is $10.\" and offer to add something or switch to pickup. No service fee.\n\n"
      : `- Voice ordering is pickup-only right now. If the customer asks for delivery, say exactly: "${deliveryDisabledMessage()}" and keep fulfillment as PICKUP.\n\n`) +
    "Tool usage:\n" +
    "- Use the tools (add_to_order, update_order_item, remove_from_order, etc.) for every real change to the order.\n" +
    "- 'Taqueros', 'taquitos', 'street tacos' or 'de maíz' mean the Taco Taquero / Street Taco tortilla. 'Make them X', 'change it to X', 'mejor X', 'que sean X' on items already in the cart = update_order_item on those lines (never a new add), then confirm the change in one short sentence.\n" +
    "- A required choice the customer didn't say (like the taco tortilla: comal, harina or taquero) must be asked, not assumed.\n" +
    "- Always answer every customer turn out loud, even if a tool fails: say a short sorry and ask them to repeat.\n" +
    "- When a customer refers to 'the last one', 'that taco', '#2', etc., use the exact reference they gave.\n" +
    "- For complex builds, call the tool once you have a complete choice. You can ask one focused question at a time.\n\n" +
    "Recovery style examples:\n" +
    "- 'Sorry, did you want to change the last one or add something new?'\n" +
    "- 'No problem — so the 4-pack with two chicken and two asada?'\n" +
    "- 'Got it, let's clarify the second taco.'\n\n" +
    "Language: Match the customer's selected language exactly. " + langLock + "\n\n" +
    `Current order state (authoritative): ${buildOrderStateSnapshot()}. Use this as the latest truth, especially after reconnects or mid-build changes.` +
    (state.currentBuildGuide
      ? (() => {
          const guide = state.currentBuildGuide;
          const stepNum = state.currentGuideStep || 1;
          const currentStep = guide.steps[stepNum - 1] || {};
          const nextStep = guide.steps[stepNum] || null;
          const isMulti = currentStep.selection_type === "multiple";

          const orderSnapshot = buildOrderStateSnapshot();
const selectedSoFar = orderSnapshot.includes(guide.display_name) 
  ? "See the cart in the Current order state above (items added to this combo are visible there)."
  : "none yet";

          let guideContext = `
CURRENT BUILD STATUS (this is the ONLY thing you should follow right now):
You are building: ${guide.display_name}
Current step: ${stepNum} of ${guide.steps.length} — "${currentStep.title}"
Selection type: ${isMulti ? 'MULTIPLE selections allowed (min ' + (currentStep.min_selections || 1) + ')' : 'SINGLE selection only'}

Already selected for this step: ${selectedSoFar}

${nextStep ? `Next step after this one: "${nextStep.title}"` : 'This is the final step.'}

${isMulti && selectedSoFar !== "none yet" 
  ? "The detailed options for this step are shown on the screen. Do not re-list them. Just ask if the user wants anything else or if they are finished."
  : (currentStep.options && currentStep.options.length > 0 
      ? `Available options for this step: ${currentStep.options.map((o) => {
          if (!o || typeof o !== "object") return String(o);
          const name = o.name || String(o);
          return o.price_note ? `${name} (${o.price_note})` : name;
        }).join(", ")}`
      : "")}

CRITICAL INSTRUCTIONS FOR MULTI-SELECT STEP ${stepNum} (READ CAREFULLY AND OBEY — THIS IS THE HIGHEST PRIORITY RULE):
- You are on a MULTI-SELECT step. The user picks from the options shown on screen.
- The ONLY way to finish this step is when the user says one of these exact words: "siguiente", "next", "ya", "es todo", "nadamas", "listo", "done", "I'm done", "finished", "that is all".
- **THE MOMENT** the user uses any of those words, you MUST:
  - Immediately stop talking about the options list for this step.
  - Never say "elige una opción", "las opciones están abajo", or anything similar again in the entire conversation.
  - Move straight to the next step in the guide.
- This rule is absolute. Even if the user adds one more item after saying the word, treat the step as finished. Do not go back.

At the very start of this step (and again after the customer has selected a couple of options), you MUST clearly tell the customer:

"When you are done selecting options, say 'next', 'siguiente', or anything similar so we can continue to the next step."

If the user has not used a completion phrase yet, you can ask "Anything else?" but you must always include the sentence above.

This rule overrides the entire guide for this step. You are forbidden from re-asking the options list once the user has signaled completion.
`;

          let note = "";
          if (state.stepCompletionNote) {
            note = `\n\nLATEST UPDATE FROM USER: ${state.stepCompletionNote}`;
            delete state.stepCompletionNote;
          }

          return `\n\n${guideContext}${note}`;
        })()
      : "")
  );
}

function buildSessionUpdatePayload() {
  const lang = getEffectiveLanguage();

  return {
    type: "session.update",
    session: {
      voice: lang === "es" ? (window.XAI_VOICE_ID_ES || "Eve") : (window.XAI_VOICE_ID || "Eve"),
      instructions: getResilientElviInstructions(lang),
      turn_detection: { type: "server_vad", threshold: 0.72, silence_duration_ms: 650, prefix_padding_ms: 180 },
      tools: buildRealtimeToolsForClient(),
      input_audio_transcription: { model: "grok-2-audio" },
      audio: {
        input: { format: { type: "audio/pcm", rate: 24000 } },
        output: { format: { type: "audio/pcm", rate: 24000 } }
      }
    }
  };
}

function buildOrderStateSnapshot() {
  const lines = state.cart.map((line, index) => {
    return `#${index + 1} ${describeCartLine(line)}`;
  });

  const cartText = lines.length ? lines.join(" | ") : "cart empty";
  const lastLine = state.cart[state.cart.length - 1];
  const lastText = describeCartLine(lastLine) || "none";
  const knownCustomer = [];
  if (state.customer.name) knownCustomer.push(`name=${state.customer.name}`);
  if (state.customer.phone) knownCustomer.push(`phone=${state.customer.phone}`);
  if (state.customer.email) knownCustomer.push(`email=${state.customer.email}`);
  if (state.customer.address) knownCustomer.push(`address=${state.customer.address}`);

  const customerText = knownCustomer.length ? knownCustomer.join(", ") : "none";

  // Build progress using the new consistent shape (preferred for model context)
  let buildText = "none";
  let buildJson = "";

  const freshProgress = normalizeBuildProgress(state.lastBuildProgress || state.pendingComboState || state.modifierDraft);
  if (freshProgress && freshProgress.active) {
    buildText = `building ${freshProgress.itemName} step ${freshProgress.step}/${freshProgress.totalSteps} (${freshProgress.stepName || freshProgress.phase || ""})`;
    const compact = {
      item: freshProgress.itemName,
      step: freshProgress.step,
      total: freshProgress.totalSteps,
      done: freshProgress.completedSelections || [],
      options: freshProgress.currentOptions || []
    };
    buildJson = ` | buildProgress=${JSON.stringify(compact)}`;
  } else if (state.currentBuildGuide) {
    const step = getCurrentGuideStep();
    buildText = `building ${state.currentBuildGuide.display_name || "combo"} step ${state.currentGuideStep}/${state.currentBuildGuide.steps.length} (${step?.title || ""})`;
    buildJson = ` | buildProgress=${JSON.stringify({
      item: state.currentBuildGuide.display_name,
      step: state.currentGuideStep,
      total: state.currentBuildGuide.steps.length,
      done: getGuideSelectionLabels(),
      options: Array.isArray(step?.options) ? step.options.map((option) => guideOptionName(option)) : []
    })}`;
  } else if (state.pendingComboState) {
    const p = state.pendingComboState;
    buildText = `building ${p.itemName || "combo"} step ${p.step || "?"}/${p.totalSteps || "?"} (${p.stepName || ""})`;
  } else if (state.modifierDraft) {
    const m = state.modifierDraft;
    const step = (state.modifierStepIndex || 0) + 1;
    const total = (m.groups && m.groups.length) || 1;
    buildText = `customizing ${m.item?.name || "item"} step ${step}/${total}`;
  }

  return `fulfillment=${state.fulfillment}; itemCount=${getCartItemCount()}; cart=${cartText}; lastAdded=${lastText}; customer=${customerText}; activeBuild=${buildText}${buildJson}`;
}

/** "una horchata", "a pepsi", "jarrito de mango": drinks resolve locally like other simple adds. */
function mentionsMenuDrink(text) {
  const t = ` ${String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ")} `;
  if (MENU_QUESTION_HINT.test(text)) return false;
  return state.menu.some((item) => item.category === "drinks" && (item.aliases || []).some((alias) => alias.length > 3 && t.includes(` ${alias} `)));
}

function cartSignature() {
  return JSON.stringify(state.cart.map((line) => [line.item?.id, line.quantity, (line.modifiers || []).map((m) => m.option)]));
}

/** Start of a customer turn on the live session: remember the cart so "added" can be checked. */
function beginRealtimeTurnCartCheck() {
  state.turnCartBaseline = cartSignature();
  state.lastUnavailableMessage = "";
}

/**
 * The live model sometimes says "Added." when nothing went in the cart (e.g. "one horchata").
 * If it claims an add and the cart didn't change this turn, stop it and say what really happened.
 */
function correctFalseAddedClaim(replyText) {
  const text = String(replyText || "");
  if (!/\b(added|i added|agregu[eé]|agregad[oa]s?|lo agrego|ya est[aá])\b/i.test(text)) return false;
  if (typeof state.turnCartBaseline !== "string" || cartSignature() !== state.turnCartBaseline) return false;
  const es = getEffectiveLanguage() === "es";
  const fix = state.lastUnavailableMessage || (es ? "Perdón, todavía no agregué nada. ¿Qué te gustaría?" : "Sorry, nothing was added yet. What would you like?");
  stopCurrentAudio();
  ui.reply.textContent = formatCentsForSpeech(fix);
  state.lastUnavailableMessage = "";
  void speakLocalText(fix, getEffectiveLanguage());
  return true;
}

function getCartItemCount() {
  return state.cart.reduce((sum, line) => sum + line.quantity, 0);
}

/** Short read-back like chat: "Added: 8 Pack MEAL … (4 Alpastor, 4 Bistec). Anything else?" */
// fix10 read-back: copy of services/api/src/readback.ts (keep in sync).
const KIND_EN = { comal: "comal", harina: "flour", taquero: "street", taquera: "street", homemade: "comal" };

function rbCleanOption(option) {
  return String(option || "")
    .replace(/\s*\(\+?\$[\d.]+\)/g, "")
    .replace(/\*+/g, "")
    .replace(/^\s*\([A-Za-z]{1,4}\)\s*/, "")
    .replace(/^\s*\d+\s*x\s+/i, "")
    .replace(/^\s*\([A-Za-z]{1,4}\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rbOptionLabel(option, group, lang) {
  const es = lang === "es";
  const raw = rbCleanOption(option);
  const low = raw.toLowerCase();
  const g = String(group || "").toLowerCase();
  if (/deluxe/.test(g) && /^regular\b/.test(low)) return "";
  // fix16: included salsa — "salsa asada" / "mild asada salsa" (DOUBLE add-ons keep their name).
  { const sm = /salsa/.test(g) ? raw.match(/^(mild|medium|hot)\s+salsa\s+(.+)$/i) : null; if (sm) return es ? `salsa ${sm[2].toLowerCase()}` : `${sm[1].toLowerCase()} ${sm[2].toLowerCase()} salsa`; }
  if (/(arroz|rice).*(frijol|beans)/.test(low) && !/^solo|^only|grande/.test(low)) return es ? "arroz y frijoles" : "rice and beans";
  if (/^solo arroz|only rice/.test(low)) return es ? "solo arroz" : "rice only";
  if (/^solo frijol|only beans/.test(low)) return es ? "solo frijoles" : "beans only";
  if (/grande\s*'?\s*12/.test(low)) return es ? "grande" : "large";
  if (/(regular|elvis)\s*'?\s*10/.test(low)) return es ? "chico" : "small";
  const parts = raw.split(" / ");
  let label = (/^(no|sin)\b/i.test(raw) ? parts[0] : es ? parts[0] : (parts[1] || parts[0])).trim();
  // ui3: "DOUBLE Crema / Sour Cream" → "double sour cream" in English too.
  if (!es && /^\W*(double|doble)\s/i.test(parts[0]) && !/\b(double|doble)\b/i.test(label)) label = `double ${label}`;
  // Item type in COMBO Mix: "Taco Comal" → "taco de comal" / "comal taco".
  if (/item-\d-option|mix/.test(g)) {
    const m = parts[0].match(/^(taco|quesadilla)\s+(comal|harina|taquer[oa])/i);
    if (m) return es ? (/taquer/i.test(m[2]) ? `${m[1].toLowerCase()} ${m[2].toLowerCase()}` : `${m[1].toLowerCase()} de ${m[2].toLowerCase()}`) : `${KIND_EN[m[2].toLowerCase()] || m[2]} ${m[1].toLowerCase()}`;
    return parts[0].toLowerCase();
  }
  // Tortilla / shell: drop the dish word ("Taco Comal" → "comal").
  if (/tortilla|shell/.test(g)) {
    const kind = parts[0].match(/\b(comal|harina|taquer[oa])\b/i)?.[1]?.toLowerCase();
    if (kind) return es ? kind : (KIND_EN[kind] || kind);
  }
  if (/carne|meat/.test(g)) {
    if (/alpastor/i.test(raw)) return es ? "pastor" : "al pastor";
    if (/^bistec/i.test(raw)) return es ? "bistec" : "steak"; // fix24: say the modifier staff ring in (Bistec), not "asada" (sounds like salsa asada)
    if (/^duro\b/i.test(raw)) return es ? "chicharrón duro" : "pork rinds";
    if (/^prensado\b/i.test(raw)) return es ? "chicharrón prensado" : "spicy pork";
  }
  // i18n1: names without a "ES / EN" pair go through the shared translation map (apps/web/opt-i18n.js).
  if (!raw.includes(" / ")) { const q = I18N()?.pair(option); if (q?.known) return (es ? q.es : q.en).toLowerCase(); }
  return label.toLowerCase();
}

function rbItemName(name, lang, alt) {
  const es = lang === "es";
  const n = String(/pack/i.test(String(name)) && alt ? `${name} ${alt}` : name || "").replace(/\s*\([A-Z]{1,4}\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const pack = n.match(/(\d+)\s*pack\b.*?\b\d+\s*x\s+(.+)$/i);
  if (pack) {
    const rest = pack[2].split(" / ")[0].trim();
    const m = rest.match(/^(tacos|quesadillas|tortas|gorditas|queso tortas|queso gorditas)\s*(comal|harina|taquer[oa]s?)?/i);
    const noun = (m?.[1] || rest).toLowerCase();
    const kind = m?.[2]?.toLowerCase().replace(/s$/, "");
    if (!kind) return `${pack[1]} ${noun}`;
    return es ? `${pack[1]} ${noun} ${kind.startsWith("taquer") ? kind.replace(/s?$/, "s") : `de ${kind}`}` : `${pack[1]} ${KIND_EN[kind] || kind} ${noun}`;
  }
  const combo = n.match(/^combo\s+(\w+)/i);
  if (combo) {
    const noun = combo[1].toLowerCase();
    if (noun === "mix") return es ? "Combo mix" : "Mix combo";
    return es ? `Combo de ${noun}` : `${combo[1].charAt(0).toUpperCase()}${noun.slice(1)} combo`;
  }
  const parts = n.split(" / ");
  // fix14: "Tacos Dorados Tacos Dorados" (name repeated in Square) → "Tacos Dorados".
  return parts[0].trim().replace(/^(.+?)\s+\1$/i, "$1");
}

/** "8 tacos de comal" / "8 comal tacos" for one dish split by meat. */
function rbSplitName(name, total, kind, lang) {
  const noun = String(name || "").split(/[ /(]/).filter(Boolean)[0] || String(name || "");
  const plural = total > 1 ? `${noun.toLowerCase()}${/[aeiou]$/i.test(noun) ? "s" : "es"}` : noun.toLowerCase();
  return lang === "es" ? `${total} ${plural}${kind ? (/taquer/.test(kind) ? ` ${kind}s` : ` de ${kind}`) : ""}` : `${total} ${kind ? `${kind} ` : ""}${plural}`;
}

const isMeatGroup = (g) => /carne|meat/i.test(String(g || "")) && !/extra/i.test(String(g || ""));

/** Same dish added once per meat (4 pastor + 4 asada, same tortilla) → one line. */
function rbMergeSplit(lines, lang) {
  const out = [];
  const groups = new Map();
  for (const line of lines) {
    const meats = (line.mods || []).filter((m) => isMeatGroup(m.group));
    const rest = (line.mods || []).filter((m) => !isMeatGroup(m.group));
    const key = `${line.name}|${rest.map((m) => rbCleanOption(m.option)).sort().join(",")}`;
    if (meats.length !== 1 || /combo|pack/i.test(String(line.name))) { out.push(line); continue; }
    if (!groups.has(key)) { const g = { lines: [], rest }; groups.set(key, g); out.push(g); }
    groups.get(key).lines.push(line);
  }
  return out.map((x) => {
    if (!x.lines) return x;
    if (x.lines.length === 1) return x.lines[0];
    const total = x.lines.reduce((n, l) => n + (Number(l.quantity) || 1), 0);
    const shell = x.rest.find((m) => /tortilla|shell/i.test(String(m.group || "")));
    const kind = shell ? rbOptionLabel(shell.option, shell.group, lang) : "";
    const meats = x.lines.map((l) => `${Number(l.quantity) || 1} ${rbOptionLabel(l.mods.find((m) => isMeatGroup(m.group)).option, "meat", lang)}`);
    const others = x.rest.filter((m) => m !== shell).map((m) => rbOptionLabel(m.option, m.group, lang)).filter(Boolean);
    return { text: `${rbSplitName(x.lines[0].name, total, kind, lang)}: ${[...meats, ...others].join(", ")}`, cents: x.lines.reduce((c, l) => c + (Number(l.cents) || 0), 0) };
  });
}

/** lines: [{ name, quantity, mods: [{ option, group }], cents }] → one short read-back with the total. */
function rbFormat(input, lang) {
  const es = lang === "es";
  const lines = rbMergeSplit(input, lang);
  const and = es ? " y " : " and ";
  const texts = lines.map((line) => {
    if (line.text) return line.text;
    const entries = [];
    let meatEntry = null;
    // COMBO Mix: pair each item with its meat ("taco comal de asada, gordita de chicharrón").
    const itemNo = (g) => String(g || "").match(/item[- #]*(\d)/i)?.[1];
    const mixKinds = {};
    for (const m of line.mods || []) if (/mix|item-\d-option/i.test(String(m.group || ""))) mixKinds[itemNo(m.group) || "1"] = m;
    const mixMeats = {};
    for (const m of line.mods || []) if (/carne|meat/i.test(String(m.group || "")) && Object.keys(mixKinds).length) mixMeats[itemNo(m.group) || "1"] = m;
    for (const n of Object.keys(mixKinds).sort()) {
      const raw = rbCleanOption(mixKinds[n].option).split(" / ")[0];
      const k = raw.match(/^(taco|quesadilla)\s+(comal|harina|taquer[oa])/i);
      const meat = mixMeats[n] ? rbOptionLabel(mixMeats[n].option, "meat", lang) : "";
      const dish = k ? k[1].toLowerCase() : raw.toLowerCase();
      if (es) entries.push(`${dish}${k ? ` ${k[2].toLowerCase()}` : ""}${meat ? ` de ${meat}` : ""}`);
      else entries.push(`${meat ? `${meat} ` : ""}${k ? `${KIND_EN[k[2].toLowerCase()]} ` : ""}${dish}`);
    }
    const shellFirst = [...(line.mods || [])].sort((a, b) => Number(!/tortilla|shell/i.test(String(a.group || ""))) - Number(!/tortilla|shell/i.test(String(b.group || ""))));
    for (const m of shellFirst) {
      if (Object.keys(mixKinds).length && (/mix|item-\d-option/i.test(String(m.group || "")) || /carne|meat/i.test(String(m.group || "")))) continue;
      const label = rbOptionLabel(m.option, m.group, lang);
      if (!label || label === rbItemName(line.name, lang).toLowerCase()) continue;
      const isMeat = /carne|meat/i.test(String(m.group || "")) && !/extra/i.test(String(m.group || ""));
      const q = Math.max(1, Number(m.quantity) || 1);
      if (isMeat) {
        if (!meatEntry) { meatEntry = { meats: new Map() }; entries.push(meatEntry); }
        meatEntry.meats.set(label, (meatEntry.meats.get(label) || 0) + q);
      } else if (!entries.includes(label)) entries.push(label);
    }
    const parts = entries.map((e) => {
      if (typeof e === "string") return e;
      const list = [...e.meats].map(([l, c]) => (c > 1 ? `${c} ${l}` : l));
      const counted = [...e.meats.values()].some((c) => c > 1);
      return counted ? list.join(", ") : list.length > 1 ? `${list.slice(0, -1).join(", ")}${and}${list[list.length - 1]}` : list[0];
    });
    const qty = Number(line.quantity) > 1 ? `${line.quantity} × ` : "";
    const name = rbItemName(line.name, lang, line.alt);
    return `${qty}${name}${parts.length ? `: ${parts.join(", ")}` : ""}`;
  });
  const cents = lines.reduce((s, l) => s + (Number(l.cents) || 0), 0);
  const total = cents ? ` $${(cents / 100).toFixed(2)}.` : "";
  return `${texts.join("; ")}.${total} ${es ? "¿Algo más?" : "Anything else?"}`;
}

const I18N = () => globalThis.ElviI18n || null;
/* dflt1: say the choice we picked for them, and offer the switch:
   "… It comes with mild asada salsa — want verde or another salsa instead?" / "… Viene con salsa asada — ¿la quieres verde u otra salsa?" */
function defaultChoiceNote(lines, lang, userText = "") {
  const es = lang === "es";
  const said = ui4Plain(userText);
  for (const line of lines || []) {
    const groups = line?.item?.modifierGroups || [];
    for (const m of line?.modifiers || []) {
      const g = groups.find((x) => x.id === m.groupId || x.name === m.groupName);
      if (!g || (g.maxSelections ?? 1) !== 1) continue;
      const opt = ui4Plain(String(m.option).replace(/\(\+?\$[\d.]+\)/g, ""));
      const isSalsa = /salsa/i.test(g.name || "");
      const dflt = m.isDefault || (isSalsa && /^mild salsa asada$/.test(opt));
      if (!dflt || (said && opt.split(" ").some((w) => w.length >= 4 && !UI4_GENERIC.has(w) && said.includes(w)))) continue;
      const alts = (g.options || []).filter((o) => (o.name || o) !== m.option && !Number(o.priceDeltaCents || 0));
      if (!alts.length) continue;
      const cur = rbOptionLabel(m.option, g.name, lang);
      const altName = alts.find((o) => /verde/i.test(o.name || o)) || alts[0];
      const alt = isSalsa ? (String(altName.name || altName).match(/salsa\s+(\w+)/i)?.[1] || rbOptionLabel(altName.name || altName, g.name, lang)).toLowerCase() : rbOptionLabel(altName.name || altName, g.name, lang);
      const word = isSalsa ? "salsa" : (es ? "opción" : "choice");
      return es ? `Viene con ${cur} — ¿la quieres ${alt} u otra ${word}?` : `It comes with ${cur} — want ${alt} or another ${word} instead?`;
    }
  }
  return "";
}
function withDefaultNote(text, lines, userText) {
  const note = defaultChoiceNote(lines, getEffectiveLanguage() === "es" ? "es" : "en", userText);
  if (!note || !text) return text;
  return `${String(text).replace(/\s*(¿Algo más\?|Anything else\?)\s*$/, "").replace(/\.?\s*$/, ".")} ${note}`;
}
function shortAddReadback(lines) {
  const lang = getEffectiveLanguage() === "es" ? "es" : "en";
  const rows = lines.filter((line) => line?.item).map((line) => ({
    name: line.item.name,
    alt: line.item.readbackName,
    quantity: line.quantity,
    mods: (line.modifiers || []).map((m) => ({ option: m.option, group: m.groupName || m.step, quantity: m.quantity })),
    cents: getCartLineTotalCents(line) || 0
  }));
  return rows.length ? rbFormat(rows, lang) : "";
}

function describeCartLine(line) {
  if (!line?.item) return "";
  const base = `${line.quantity} x ${line.item.name}`;
  if (!Array.isArray(line.modifiers) || !line.modifiers.length) {
    return base;
  }
  const mods = line.modifiers
    .map((mod) => `${mod.quantity > 1 ? `${mod.quantity} x ` : ""}${mod.option}`)
    .join(", ");
  return `${base} [${mods}]`;
}

function handleMultiSelectCompletion(text) {
  if (!state.currentBuildGuide || !state.currentGuideStep) return false;

  // Normalize: lowercase + remove accents for better Spanish/English matching
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  // Bilingual completion phrases (English + Spanish)
  const donePhrases = [
    // English
    "that is all", "thats all", "that all",
    "done", "im done", "i am done",
    "finished", "im finished", "i am finished",
    "no more", "no more options",
    "thats it", "that is it",
    "im good", "i am good",
    "all set", "all done",
    "next", "next step",
    // Spanish
    "nada mas", "nadamas", "no mas", "nomas",
    "ya", "ya esta", "ya esta bien",
    "listo", "ya termine", "termine",
    "eso es todo", "es todo",
    "ya no", "ya no mas",
    "ya me", "ya con eso",
    "siguiente", "siguiente paso", "next"
  ];

  const matched = donePhrases.some(phrase => normalized.includes(phrase));

  if (matched) {
      const step = state.currentBuildGuide.steps[state.currentGuideStep - 1];
      // ui4: suggested/offered steps are answered in the guide turn (marks them done, or keeps the rest).
      if (step && (step.mode === "suggest" || step.mode === "offer")) return false;
      const stepTitle = String(step?.title || step?.label || "");
      const isSelectionStep = step && (
        step.selection_type === "multiple" ||
        stepTitle.toLowerCase().includes("option") ||
        stepTitle.toLowerCase().includes("choice") ||
        stepTitle.toLowerCase().includes("opcion")
      );

    // Special case: "siguiente" or "next" always advances the current guide step when a guide is active
    const isNextWord = normalized.includes("siguiente") || normalized.includes("next");

    if (isSelectionStep || isNextWord) {
      const oldStepNum = state.currentGuideStep;
      const oldStep = state.currentBuildGuide.steps[oldStepNum - 1];
      if (oldStep?.required !== false && !guideStepIsComplete(oldStep, oldStepNum - 1)) {
        return false;
      }
      if (!advanceGuideToNextRequiredStep()) {
        void finishGuideBuildLocally();
        return true;
      }
      state.stepCompletionNote = `User just completed step ${oldStepNum} by saying "${text}". Do not re-ask about the previous step. Now on step ${state.currentGuideStep}: "${state.currentBuildGuide.steps[state.currentGuideStep-1]?.title}".`;
      updatePendingGuidePreview();
      updateBuildVisuals({});
      const reply = guideCurrentPrompt();
      ui.reply.textContent = formatCentsForSpeech(reply);
      markLocalTurnReady();
      void speakLocalText(reply, getEffectiveLanguage());

      return true;
    }
  }
  return false;
}

function isCurrentOrderQuestion(text) {
  const normalized = normalizeOptionKey(text);
  return /\b(what|whats|what s|show|read|tell)\b.*\b(order|cart)\b/.test(normalized)
    || /\b(order|cart)\b.*\b(current|now|have|inside|in it)\b/.test(normalized)
    || /\bque tengo\b.*\b(orden|carrito)\b/.test(normalized)
    || /\bmi\b.*\b(orden|carrito)\b/.test(normalized);
}

function summarizeCurrentOrderForCustomer() {
  if (!state.cart.length) {
    return getEffectiveLanguage() === "es"
      ? "Tu orden está vacía."
      : "Your cart is empty.";
  }

  const lines = state.cart.map((line) => {
    const name = getEffectiveLanguage() === "es" ? line.item.nameEs : line.item.name;
    const modifiers = Array.isArray(line.modifiers) && line.modifiers.length
      ? ` with ${line.modifiers.map((modifier) => stripModifierPriceText(modifier.option)).join(", ")}`
      : "";
    return `${line.quantity} ${name}${modifiers}`;
  });
  const total = state.cart.reduce((sum, line) => sum + getCartLineTotalCents(line), 0);
  if (getEffectiveLanguage() === "es") {
    return `Tu orden: ${lines.join("; ")}. Total ${centsToUsd(total)}.`;
  }
  return `Your order: ${lines.join("; ")}. Total ${centsToUsd(total)}.`;
}

function syncRealtimeOrderContext() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.xaiSessionReady) {
    return;
  }
  if (isLocalBuildActive()) {
    return;
  }
  if (state.turnInFlight || state.elviSpeaking) {
    return;
  }

  const digest = JSON.stringify({
    language: getEffectiveLanguage(),
    fulfillment: state.fulfillment,
    cart: state.cart.map((line) => ({
      id: line.item.id,
      quantity: line.quantity,
      modifiers: Array.isArray(line.modifiers)
        ? line.modifiers.map((mod) => ({ groupId: mod.groupId, option: mod.option, quantity: mod.quantity }))
        : []
    })),
    customer: {
      name: state.customer.name,
      phone: state.customer.phone,
      email: state.customer.email,
      address: state.customer.address
    }
  });

  if (digest === state.lastOrderContextDigest) {
    return;
  }

  state.lastOrderContextDigest = digest;
  sendWs(buildSessionUpdatePayload());
}

// ── Mood detection ───────────────────────────────────────────────────────
function detectMood(reply) {
  if (!reply) return "talking_neutral";
  const frustrated = /sorry|i didn'?t|not sure|didn'?t catch|pardon|could you repeat|lo siento|no entend|no pude|disculpa/i;
  const question = /\?|would you like|what would you like|which one|anything else|algo mas|que deseas|cual/i;
  const excited = /how can i help|ready for your order|with pleasure|i'?d be happy|encantad|con gusto|me da gusto ayudarte/i;
  const positive = /perfect|great|wonderful|delici|enjoy|love|feliz|excelente|fant[áa]stico|bueno|gracias|claro/i;
  if (frustrated.test(reply)) return "frustrated";
  if (excited.test(reply)) return "excited";
  if (question.test(reply)) return "questioning";
  return positive.test(reply) ? "happy" : "talking_neutral";
}

function buildRealtimeToolsForClient() {
  // New resilient tool set — model owns ordering + build flow
  return [
    {
      type: "function",
      name: "add_to_order",
      description: "Add item(s) to the order. Accepts natural language (e.g. 'two deluxe steak tacos' or 'the 4-pack with chicken and asada'). Use for both simple items and starting/completing builds.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Customer's exact words or clear description of what to add." },
          quantity: { type: "number", description: "How many (default 1)" },
          modifiers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                group: { type: "string" },
                option: { type: "string" },
                quantity: { type: "number" }
              }
            }
          }
        },
        required: ["query"]
      }
    },
    {
      type: "function",
      name: "update_order_item",
      description: "Change quantity or modifiers on an existing item in the cart. Use natural references the customer gave ('the last taco', 'that one', '#2', 'the chicken pack').",
      parameters: {
        type: "object",
        properties: {
          reference: { type: "string", description: "How the customer referred to the item (last, that, the second one, #3, etc.)" },
          quantity: { type: "number" },
          change_modifiers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                group: { type: "string" },
                option: { type: "string" }
              }
            }
          }
        },
        required: ["reference"]
      }
    },
    {
      type: "function",
      name: "remove_from_order",
      description: "Remove item(s) using natural customer references ('last one', 'the two tacos', '#1').",
      parameters: {
        type: "object",
        properties: {
          reference: { type: "string" },
          quantity: { type: "number" }
        },
        required: ["reference"]
      }
    },
    {
      type: "function",
      name: "set_fulfillment",
      description: isDeliveryEnabled()
        ? "Set the order to pickup or delivery."
        : "Set the order to pickup only. Delivery is disabled for voice ordering.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: isDeliveryEnabled() ? ["PICKUP", "DELIVERY"] : ["PICKUP"] }
        },
        required: ["type"]
      }
    },
    {
      type: "function",
      name: "set_delivery_address",
      description: "Record the delivery address when the customer provides it.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string" }
        },
        required: ["address"]
      }
    },
    {
      type: "function",
      name: "set_customer_info",
      description: "Record name, phone, or email for the order.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" }
        }
      }
    },
    {
      type: "function",
      name: "request_checkout",
      description: "Customer wants to pay now. Only call after we have the required info (name/phone + fulfillment)."
    },
    {
      type: "function",
      name: "resolve_menu_item",
      description: "Lightweight helper: fuzzy search the menu for a phrase and return best matches + their modifier groups. Use only when genuinely unsure about an item name.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" }
        },
        required: ["query"]
      }
    }
  ];
}

function scheduleTokenRefresh() {
  if (state.xaiTokenRefreshTimer) {
    clearTimeout(state.xaiTokenRefreshTimer);
    state.xaiTokenRefreshTimer = null;
  }
  if (!state.xaiTokenExpiresAt) return;
  const msUntilRefresh = Math.max(5000, state.xaiTokenExpiresAt * 1000 - Date.now() - 5000);
  state.xaiTokenRefreshTimer = setTimeout(() => {
    openRealtimeSession().catch(() => {
      ui.status.textContent = "Token refresh failed";
    });
  }, msUntilRefresh);
}

function flushMicChunkBuffer() {
  if (!state.xaiSessionReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const hadBufferedAudio = state.micChunkBuffer.length > 0;
  for (const chunk of state.micChunkBuffer) {
    sendWs({ type: "input_audio_buffer.append", audio: chunk });
  }
  state.micChunkBuffer = [];
  if (hadBufferedAudio && state.turnInFlight) {
    sendWs({ type: "response.create" });
  }
}

function buildResolverCartSnapshot() {
  return state.cart.map((line, index) => ({
    id: line.item.id,
    itemId: line.item.id,
    cartIndex: index,
    quantity: line.quantity,
    modifiers: Array.isArray(line.modifiers) ? line.modifiers : []
  }));
}

function getResolverToolText(name, args) {
  const explicit = String(args.itemQuery || args.query || "").trim();
  if (explicit) return explicit;
  if (name === "add_item" && args.itemId) {
    const item = state.menu.find((candidate) => candidate.id === args.itemId);
    return item?.name || String(args.itemId);
  }
  return state.lastUserText || String(args.itemId || "");
}

function comboBuildingActionFromResolver(result) {
  if (!result?.comboStep) return null;
  const selectedItem = result.selectedItem || {};
  return {
    type: "combo_building",
    itemId: selectedItem.itemId || result.comboState?.itemId || "",
    selectedItem,
    itemName: result.comboStep.itemName || selectedItem.name || "",
    step: result.comboStep.step || 1,
    totalSteps: result.comboStep.totalSteps || 1,
    stepName: result.comboStep.stepName || "",
    stepOptions: Array.isArray(result.comboStep.options) ? result.comboStep.options : [],
    selections: Array.isArray(result.comboStep.selections) ? result.comboStep.selections : []
  };
}

function isPendingComboSelectionState() {
  return state.pendingComboState?.ruleId === "combo-selection"
    && state.pendingComboState?.itemId === "combo-selection";
}

function comboSelectionPhraseFromText(text) {
  const normalized = normalizeOptionKey(text);
  if (/\b(burrito|burritos)\b/.test(normalized)) return "combo burrito";
  if (/\b(mix|mixto)\b/.test(normalized)) return "combo mix";
  if (/\b(gordita|gorditas)\b/.test(normalized)) return "combo gorditas";
  if (/\b(torta|tortas)\b/.test(normalized)) return "combo tortas";
  if (/\b(quesadilla|quesadillas)\b/.test(normalized)) return "combo quesadillas";
  if (/\b(taco|tacos)\b/.test(normalized)) return "combo tacos";
  return "";
}

function comboSelectionReminderOutput() {
  return {
    ok: false,
    reason: "combo_step_required",
    message: getEffectiveLanguage() === "es"
      ? "¿Cuál combo quieres? Elige Tacos, Quesadillas, Burrito, Mix, Gorditas o Tortas."
      : "Which combo would you like? Choose Tacos, Quesadillas, Burrito, Mix, Gorditas, or Tortas.",
    comboState: state.pendingComboState,
    comboStep: {
      itemName: "Combos",
      step: 1,
      totalSteps: 1,
      stepKey: "combo-selection",
      stepName: getEffectiveLanguage() === "es" ? "Elige combo" : "Choose combo",
      options: [
        "COMBO Tacos",
        "COMBO Quesadillas",
        "COMBO Burrito",
        "COMBO Mix",
        "COMBO Gorditas",
        "COMBO Tortas"
      ],
      selections: []
    }
  };
}

async function resolveOrderToolWithMenuBrain(name, args) {
  if (!["add_item", "remove_item", "update_item"].includes(name)) return null;

  // Lightweight approved menu guard for add_item (works with the server catalog)
  if (name === "add_item" || name === "add_to_order") {
    const query = (args.itemQuery || args.query || "").toLowerCase();
    // If it looks like a completely unknown item and we have no guide, let backend refuse with nice message
    if (query && !state.currentBuildGuide && query.length > 3) {
      // The backend will return a clear refusal if not in Menu Items Online
    }
  }

  let text = getResolverToolText(name, args);
  if (name === "add_item" && isPendingComboSelectionState()) {
    const selectedCombo = comboSelectionPhraseFromText(`${state.lastUserText || ""} ${text || ""}`);
    if (selectedCombo) {
      text = selectedCombo;
      args = {
        ...args,
        itemQuery: selectedCombo,
        itemId: undefined,
        modifiers: undefined,
        quantity: 1
      };
    } else {
      return { output: comboSelectionReminderOutput() };
    }
  }
  const response = await fetch(`/api/${state.tenantSlug}/menu/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      language: getEffectiveLanguage(),
      actionHint: name,
      toolArgs: args,
      cart: buildResolverCartSnapshot(),
      comboState: state.pendingComboState || undefined,
      orderSessionId: state.orderSessionId
    })
  });

  const result = await response.json().catch(() => ({ ok: false, reason: "resolver_error" }));
  if (!response.ok) {
    return { output: { ok: false, reason: "resolver_error", message: result?.message || "Menu resolver failed." } };
  }

  const actionList = Array.isArray(result.actions) ? [...result.actions] : [];
  const selectedItem = result.selectedItem && typeof result.selectedItem === "object" ? result.selectedItem : null;
  if (selectedItem?.itemId) {
    for (const action of actionList) {
      if (action.type === "add_item" && action.itemId === selectedItem.itemId) {
        action.selectedItem = selectedItem;
      }
    }
  }
  // Only use legacy comboStep data if no guide is provided (guide is the single source of truth)
  let comboAction = null;
  if (!result.guide) {
    comboAction = comboBuildingActionFromResolver(result);
    if (comboAction) {
      actionList.unshift(comboAction);
    }
  }

  // Server-side order context (fix7): a dish is still open ("4 tacos 2 bistec" → which tortilla / the other 2?).
  if ("orderContext" in result) state.orderContextPending = Boolean(result.orderContext);
  if (result.comboState && result.comboStep) {
    state.pendingComboState = result.comboState;
  } else if (result.reason === "build_cancelled") {
    state.pendingComboState = null;
    state.pendingComboPreview = null;
    state.lastComboAnimationKey = "";
    state.currentBuildGuide = null;
    state.currentGuideStep = 0;
    state.currentBuildItem = null;
    state.currentBuildSelections = [];
    clearComboTracker();
    renderSelectedItemsPanel();
    renderSelectedPreview(state.lastSelectedItem);
  } else if (actionList.some((action) => action.type === "add_item")) {
    state.pendingComboState = null;
    state.pendingComboPreview = null;

    // Do NOT clear the guide on add_item if we are on a multi-select step.
    // Multi-select steps intentionally allow multiple adds before the user
    // signals completion (with "siguiente", "ya", etc.). Clearing here was
    // destroying the guide state and causing the options loop.
    const currentStep = state.currentBuildGuide?.steps?.[(state.currentGuideStep || 1) - 1];
    const isMultiSelectStep = currentStep && currentStep.selection_type === "multiple";

    if (state.currentBuildGuide && !isMultiSelectStep) {
      // Only clear for single-select steps (or when no guide is active)
      state.currentBuildGuide = null;
    }
  }

  if (result.guide) {
    const buildItem = resolveBuildItemFromSelection(selectedItem);
    state.currentBuildGuide = result.guide;
    state.currentGuideStep = 1;  // Start at first step of the guide
    state.currentBuildItem = buildItem || selectedItem;
    state.currentBuildSelections = [];
    state.pendingComboState = null; // Prefer guide-driven flow over old resolver state
    // fix11: the server may have replayed the sentence (chicharrón answer, "8 tacos" → 8 pack).
    prefillGuideSelectionsFromText(result.resolvedText || text);
    advanceGuideToNextRequiredStep();
    const doneItem = !getCurrentGuideStep() && resolveCurrentBuildItem();
    if (doneItem) {
      // fix10 least friction: everything was said in one sentence → add it now with the short read-back.
      const modifiers = buildGuideModifiers();
      addCartItem(doneItem, 1, modifiers);
      result.message = shortAddReadback([{ item: doneItem, quantity: 1, modifiers }]) || doneItem.name;
      clearCurrentGuideBuild();
      state.lastSelectedItem = doneItem;
      renderCart();
      renderSelectedItemsPanel();
    } else {
      result.message = guideCurrentPrompt();
      updatePendingGuidePreview();
      updateBuildVisuals({});
    }
  }

  if (!comboAction && !actionList.length && !state.pendingComboState && ["unknown_menu_item", "unknown_cart_item"].includes(result.reason)) {
    // Keep the server's "not on the menu, closest drinks are…" reply for whoever answers next.
    if (result.reason === "unknown_menu_item" && result.message) state.lastUnavailableMessage = String(result.message);
    return null;
  }

  return {
    actions: actionList,
    output: {
      ...result,
      actions: undefined
    }
  };
}

async function resolvePendingComboTurnLocally(text) {
  // If user said "that is all" on a multi-select guide step, advance immediately
  if (handleMultiSelectCompletion(text)) {
    return true;
  }

  state.turnInFlight = true; setAvatarState("thinking");
  state.lastUserText = text;
  ui.status.textContent = "Processing…";
  let completed = false;
  try {
    const result = await resolveOrderToolWithMenuBrain("add_item", { itemQuery: text });
    const actions = result?.actions || [];
    const cartBefore = state.cart.length;
    if (actions.length) {
      applyActions(actions);
    }
    let addedLines = actions.some((action) => action.type === "add_item") ? state.cart.slice(cartBefore) : [];
    // ui2: an add that merged into an existing cart line still gets the short read-back with price.
    if (!addedLines.length) {
      addedLines = actions.filter((a) => a.type === "add_item").map((a) => ({
        item: state.menu.find((m) => m.id === a.itemId) || a.selectedItem,
        quantity: Math.max(1, Number(a.quantity) || 1),
        modifiers: Array.isArray(a.modifiers) ? a.modifiers : []
      })).filter((line) => line.item && line.item.name);
    }

    // When the backend returned a guide (new single-source-of-truth path),
    // make sure the visual tracker + current step options appear immediately.
    // updateBuildVisuals detects state.currentBuildGuide and renders the first step.
    updateBuildVisuals(result?.output || result || {});

    const output = result?.output || {};
    // No result means the item wasn't found: never say "Done" for that.
    const notFound = state.lastUnavailableMessage || (getEffectiveLanguage() === "es" ? "Perdón, eso no está en el menú. ¿Qué más se te antoja?" : "Sorry, that isn't on our menu. What else sounds good?");
    const fallback = !result || (!actions.length && output.ok === false && !output.message)
      ? notFound
      : (getEffectiveLanguage() === "es" ? "Listo." : "Done.");
    if (!result) state.lastUnavailableMessage = "";
    const reply = (addedLines.length && output.ok !== false && withDefaultNote(shortAddReadback(addedLines), addedLines, text)) || output.message || output.orderSummary || fallback;
    ui.reply.textContent = formatCentsForSpeech(reply);
    completed = true;
    markLocalTurnReady();
    await speakLocalText(reply, getEffectiveLanguage());
    pulseAvatarState(actions.some((action) => action.type === "add_item") ? "happy" : "questioning", 1200, "idle");
    return true;
  } catch (error) {
    console.error("[ORDER] Local resolver failed:", error);
    ui.status.textContent = error instanceof Error ? error.message : "Resolver error";
    ui.reply.textContent = getEffectiveLanguage() === "es" ? "No pude agregar eso. Intenta otra vez." : "I could not add that. Please try again.";
    setAvatarState("frustrated");
    return false;
  } finally {
    if (!completed) state.turnInFlight = false;
    if (completed) ui.status.textContent = "Connected";
  }
}

async function handleToolCall(name, argsJson) {
  const args = safeJsonParse(argsJson || "{}");
  if (name === "check_delivery_zone") {
    if (!isDeliveryEnabled()) {
      return {
        output: {
          ok: false,
          in_zone: false,
          delivery_enabled: false,
          message: deliveryDisabledMessage()
        }
      };
    }
    const response = await fetch(`/api/${state.tenantSlug}/tools/check_delivery_zone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args)
    });
    const output = await response.json().catch(() => ({ ok: false }));
    return { output };
  }

  if (name === "submit_order") {
    const response = await fetch(`/api/${state.tenantSlug}/tools/submit_order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args)
    });
    const output = await response.json().catch(() => ({ ok: false }));
    return { output };
  }

  // Compatibility layer for new resilient tool names -> existing resolver logic
  let normalizedName = name;
  let normalizedArgs = { ...args };

  if (name === "add_to_order") {
    normalizedName = "add_item";
    normalizedArgs = {
      itemQuery: args.query,
      quantity: args.quantity,
      modifiers: args.modifiers
    };
  } else if (name === "update_order_item") {
    normalizedName = "update_item";
    normalizedArgs = {
      itemQuery: args.reference,
      quantity: args.quantity,
      modifiers: args.change_modifiers
    };
  } else if (name === "remove_from_order") {
    normalizedName = "remove_item";
    normalizedArgs = {
      itemQuery: args.reference,
      quantity: args.quantity
    };
  } else if (name === "set_delivery_address") {
    if (!isDeliveryEnabled()) {
      return {
        action: { type: "set_fulfillment", fulfillment: "PICKUP", message: deliveryDisabledMessage() },
        output: { ok: false, delivery_enabled: false, message: deliveryDisabledMessage() }
      };
    }
    normalizedName = "set_address";
    normalizedArgs = { address: args.address };
  } else if (name === "set_customer_info") {
    normalizedName = "set_customer";
    normalizedArgs = args;
  } else if (name === "request_checkout") {
    normalizedName = "checkout";
    normalizedArgs = {};
  } else if (name === "resolve_menu_item") {
    // Lightweight helper — for now delegate to the menu brain as a query
    normalizedName = "add_item";
    normalizedArgs = { itemQuery: args.query };
  }

  const oldToolNames = ["add_item", "remove_item", "update_item", "set_fulfillment", "set_address", "set_customer", "checkout"];
  if (oldToolNames.includes(normalizedName)) {
    const menuBrain = await resolveOrderToolWithMenuBrain(normalizedName, normalizedArgs);
    if (menuBrain) {
      return menuBrain;
    }

    let addItemMode = null;
    if (name === "add_item") {
      const multiResolved = resolveMultipleAddItemToolArgs(args);
      if (multiResolved.ok) {
        return {
          actions: multiResolved.actions,
          output: {
            ok: true,
            splitItems: multiResolved.actions.length,
            missingItems: multiResolved.missingBaseItems || [],
            message: multiResolved.missingBaseItems?.length
              ? "Added resolved item lines. Ask for the missing required choices on the remaining item."
              : "Added multiple item lines from one phrase."
          }
        };
      }

      const resolved = resolveAddItemToolArgs(args);
      if (!resolved.ok) {
        return {
          output: {
            ok: false,
            reason: "unknown_menu_item",
            message: resolved.message
          }
        };
      }
      Object.assign(args, resolved.args);

      const guard = validateAddItemToolArgs(args);
      if (!guard.ok) {
        return {
          output: {
            ok: false,
            reason: "missing_required_modifiers",
            message: guard.message,
            requiredGroups: guard.requiredGroups,
            provided: guard.provided
          }
        };
      }
      addItemMode = guard.mode || null;
      if (Array.isArray(guard.canonicalModifiers)) {
        args.modifiers = guard.canonicalModifiers;
      }
    } else if (name === "remove_item" || name === "update_item") {
      const resolved = resolveCartMutationToolArgs(name, args);
      if (!resolved.ok) {
        return {
          output: {
            ok: false,
            reason: "unknown_cart_item",
            message: resolved.message
          }
        };
      }
      Object.assign(args, resolved.args);
    }

    const action = mapToolToAction(name, args);
    if (action && name === "add_item" && addItemMode) {
      action.mode = addItemMode;
    }
    return { action, output: { ok: true } };
  }

  return { output: { ok: false, error: `Unknown tool: ${name}` } };
}

function mapToolToAction(name, args) {
  switch (name) {
    case "add_item":
      return {
        type: "add_item",
        itemId: String(args.itemId || ""),
        quantity: Number(args.quantity) || 1,
        modifiers: normalizeToolModifiers(args.modifiers)
      };
    case "remove_item":
      return {
        type: "remove_item",
        itemId: String(args.itemId || ""),
        cartIndex: Number.isInteger(args.cartIndex) ? args.cartIndex : undefined,
        quantity: Number(args.quantity) || 1
      };
    case "update_item":
      return {
        type: "update_item",
        itemId: String(args.itemId || ""),
        cartIndex: Number.isInteger(args.cartIndex) ? args.cartIndex : undefined,
        quantity: Number(args.quantity) || 1,
        modifiers: normalizeToolModifiers(args.modifiers)
      };
    case "set_fulfillment":
      if (args.fulfillment === "DELIVERY" && !isDeliveryEnabled()) {
        return { type: "set_fulfillment", fulfillment: "PICKUP", message: deliveryDisabledMessage() };
      }
      return { type: "set_fulfillment", fulfillment: args.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP" };
    case "set_address":
      return { type: "set_address", address: String(args.address || "") };
    case "set_customer":
      return {
        type: "set_customer",
        ...(args.name ? { name: String(args.name) } : {}),
        ...(args.phone ? { phone: String(args.phone) } : {}),
        ...(args.email ? { email: String(args.email) } : {})
      };
    case "checkout":
      return { type: "checkout" };
    default:
      return null;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

function normalizeToolModifiers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      groupId: String(entry.groupId || "").trim(),
      groupName: String(entry.groupName || "").trim(),
      option: String(entry.option || "").trim(),
      optionId: String(entry.optionId || "").trim(),
      priceDeltaCents: Number.isFinite(Number(entry.priceDeltaCents)) ? Number(entry.priceDeltaCents) : undefined,
      quantity: Math.max(1, Number(entry.quantity) || 1)
    }))
    .filter((entry) => entry.option);
}

function normalizeOptionKey(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bal\s+pastor\b/g, "alpastor")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeLooseOptionKey(text) {
  return normalizeOptionKey(text)
    .split(" ")
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .join(" ");
}

function extractOptionCostCents(optionLabel) {
  const text = String(optionLabel || "");
  const match = text.match(/([+-]?)\s*\$\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const value = Math.round(Number(match[2]) * 100);
  return Number.isFinite(value) ? sign * value : 0;
}

function findCanonicalOption(options, candidate) {
  if (!Array.isArray(options) || !options.length) return null;
  const raw = String(candidate || "").trim();
  if (!raw) return null;

  const exact = options.find((opt) => optionDisplayName(opt) === raw);
  if (exact) return optionDisplayName(exact);

  const lower = raw.toLowerCase();
  const ci = options.find((opt) => optionDisplayName(opt).toLowerCase() === lower);
  if (ci) return optionDisplayName(ci);

  const key = normalizeOptionKey(raw);
  if (!key) return null;
  const normalized = options.find((opt) => normalizeOptionKey(optionDisplayName(opt)) === key);
  if (normalized) return optionDisplayName(normalized);

  const looseKey = normalizeLooseOptionKey(raw);
  const loose = options.find((opt) => normalizeLooseOptionKey(optionDisplayName(opt)) === looseKey);
  if (loose) return optionDisplayName(loose);

  const scored = options
    .map((opt) => ({ option: optionDisplayName(opt), score: scoreModifierOptionMatch(optionDisplayName(opt), raw) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.option || null;
}

function findCanonicalModifierOption(options, candidate) {
  const canonical = findCanonicalOption(options, candidate);
  if (!canonical) return null;
  const key = normalizeOptionKey(canonical);
  return (options || []).find((option) => normalizeOptionKey(optionDisplayName(option)) === key) || null;
}

function normalizeQueryText(text) {
  return normalizeOptionKey(text)
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|a|an|add|get|give|me|please|quiero|dame|orden|order|of)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MODIFIER_STOP_WORDS = new Set([
  "x", "with", "con", "sin", "and", "or", "the", "only", "solo", "side", "extra",
  "double", "add", "de", "del", "la", "el", "los", "las", "oz", "online", "option",
  "options", "choice", "choices", "taco", "tacos", "quesadilla", "gordita", "burrito",
  "torta", "combo", "meal", "plate", "platillo"
]);

function stripModifierPriceText(text) {
  return String(text || "")
    .replace(/\(\s*[+-]?\s*\$\s*\d+(?:\.\d{1,2})?\s*\)/g, " ")
    .replace(/^\s*\*+\s*/, "")
    .replace(/^\s*\d+\s*x\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function significantModifierTokens(text) {
  return normalizeLooseOptionKey(stripModifierPriceText(text))
    .split(" ")
    .filter((token) => token.length > 2 && !MODIFIER_STOP_WORDS.has(token) && !/^\d+$/.test(token));
}

function buildModifierOptionAliases(option) {
  const cleaned = stripModifierPriceText(option);
  const cleanedKey = normalizeLooseOptionKey(cleaned);
  const isMeltedCheeseOption = /\b(queso derretido|melted cheese)\b/.test(cleanedKey);
  const aliases = new Set([
    cleanedKey,
    normalizeLooseOptionKey(cleaned.replace(/\([^)]*\)/g, " "))
  ]);

  for (const part of cleaned.split(/\s*\/\s*|\s+-\s+|\s+or\s+|\s+y\s+|\s+and\s+/i)) {
    const key = normalizeLooseOptionKey(part.replace(/\([^)]*\)/g, " "));
    if (key) aliases.add(key);
  }

  const tokens = significantModifierTokens(cleaned);
  for (const token of tokens) {
    if (isMeltedCheeseOption && /^(queso|cheese)$/.test(token)) continue;
    aliases.add(token);
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    aliases.add(`${tokens[i]} ${tokens[i + 1]}`);
  }

  return [...aliases].filter((alias) => alias.length > 2);
}

function scoreModifierOptionMatch(option, query) {
  const queryKey = normalizeLooseOptionKey(query);
  if (!queryKey) return 0;
  const queryTokens = new Set(significantModifierTokens(query));
  const aliases = buildModifierOptionAliases(option);
  let best = 0;

  for (const alias of aliases) {
    if (!alias || MODIFIER_STOP_WORDS.has(alias)) continue;
    if (queryKey === alias) best = Math.max(best, 140 + alias.length);
    if (queryKey.includes(alias)) best = Math.max(best, 100 + alias.length);
    if (alias.includes(queryKey) && queryKey.length > 3) best = Math.max(best, 80 + queryKey.length);
  }

  const optionTokens = significantModifierTokens(option);
  const matchedTokens = optionTokens.filter((token) => queryTokens.has(token));
  if (matchedTokens.length) {
    best = Math.max(best, matchedTokens.length * 35 + Math.max(...matchedTokens.map((token) => token.length)));
  }

  return best;
}

function isSingleTacoCandidate(item) {
  const haystack = normalizeQueryText(`${item?.id || ""} ${item?.name || ""} ${item?.nameEs || ""}`);
  if (!haystack.includes("taco")) return false;
  return !/(combo|fiesta|love box|hard shell|pack|meal|tacos|[0-9]+\s*x|trio|sampler)/.test(haystack);
}

function isBaseQuesadillaCandidate(item) {
  const haystack = normalizeQueryText(`${item?.id || ""} ${item?.name || ""} ${item?.nameEs || ""}`);
  if (!haystack.includes("quesadilla")) return false;
  return !/(combo|fiesta|love box|pack|meal|dorada|fried|quesadillas|[0-9]+\s*x|trio|sampler)/.test(haystack);
}

function itemHasText(item, pattern) {
  const values = [
    item?.id,
    item?.name,
    item?.nameEs,
    ...(Array.isArray(item?.aliases) ? item.aliases : [])
  ];
  const haystack = normalizeQueryText(values.join(" "));
  return pattern.test(haystack);
}

function scoreMenuItemForQuery(item, query) {
  const normalized = normalizeQueryText(query);
  const values = [
    item?.id,
    item?.name,
    item?.nameEs,
    ...(Array.isArray(item?.aliases) ? item.aliases : [])
  ];
  const haystack = normalizeQueryText(values.join(" "));
  if (!normalized || !haystack) return 0;
  if (haystack === normalized) return 100;
  if (haystack.includes(normalized)) return 80;
  const words = normalized.split(" ").filter((word) => word.length > 2);
  return words.reduce((score, word) => score + (haystack.includes(word) ? 8 : 0), 0);
}

function findPreferredSingleTacoItem(query) {
  const normalized = normalizeQueryText(query);
  const tacos = state.menu.filter(isSingleTacoCandidate);
  if (!tacos.length) return null;

  const tortillaKind = getTacoTortillaKindFromText(normalized);
  if (tortillaKind) {
    return findSingleTacoVariant(tortillaKind) || tacos[0];
  }

  return tacos.find((item) => itemHasText(item, /\b(st|taquero|street)\b/))
    || tacos.find((item) => normalizeQueryText(item.name) === "taco")
    || tacos[0];
}

function findPreferredQuesadillaItem() {
  return state.menu.find((item) => normalizeQueryText(item.name) === "quesadilla")
    || state.menu.find(isBaseQuesadillaCandidate)
    || null;
}

function resolveMenuItemFromQuery(queryOrId) {
  const raw = String(queryOrId || "").trim();
  if (!raw) return null;

  const exactId = state.menu.find((item) => item.id === raw);
  if (exactId) return exactId;

  const normalized = normalizeQueryText(raw);
  if (/\btacos?\b/.test(normalized)) {
    const singleTaco = findPreferredSingleTacoItem(normalized);
    if (singleTaco) return singleTaco;
  }
  if (/\bquesadillas?\b/.test(normalized) && !/\b(dorada|fried|frita|frito|combo|pack|platter)\b/.test(normalized)) {
    const quesadilla = findPreferredQuesadillaItem();
    if (quesadilla) return quesadilla;
  }

  const scored = state.menu
    .map((item) => ({ item, score: scoreMenuItemForQuery(item, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.item || null;
}

function findModifierGroup(item, matcher) {
  const groups = Array.isArray(item?.modifierGroups) ? item.modifierGroups : [];
  return groups.find((group) => matcher(normalizeQueryText(group.name || ""), group));
}

function inferOptionFromMap(group, query, entries) {
  if (!group || !Array.isArray(group.options)) return null;
  const normalized = normalizeQueryText(query);
  for (const [pattern, optionHint] of entries) {
    if (pattern.test(normalized)) {
      const option = findCanonicalOption(group.options, optionHint);
      if (option) {
        return { groupId: group.id, groupName: group.name, option, quantity: 1 };
      }
    }
  }
  return null;
}

function inferModifiersFromQuery(item, query) {
  const modifiers = [];
  const meatGroup = findModifierGroup(item, (name) => /\b(meat|meats|carne|carnes)\b/.test(name));
  const tortillaGroup = findModifierGroup(item, (name) => /\b(tortilla|shell)\b/.test(name));
  const withGroup = findModifierGroup(item, (name) => /\b(con|with)\b/.test(name));
  const deluxeGroup = findModifierGroup(item, (name) => /\bdeluxe\b/.test(name));

  const tortilla = inferOptionFromMap(tortillaGroup, query, [
    // Street first: "street corn" / "de maíz" / "chiquito" = Street; Comal (upsell) only when asked by name.
    [/\b(street|taquer[oa]s?|de ma[ií]z|chiquit[oa]s?|street corn)\b/, getTortillaOptionHint(item, "st")],
    [/\b(homemade|home made|handmade|hand made|comal|hech[oa]s? a mano|tortillas? grandes?)\b/, getTortillaOptionHint(item, "co")],
    [/\b(flour|harina)\b/, getTortillaOptionHint(item, "hr")]
  ]);
  if (tortilla) {
    modifiers.push(tortilla);
  } else {
    const defaultTortilla = getDefaultTortillaModifier(item, tortillaGroup, query);
    if (defaultTortilla) modifiers.push(defaultTortilla);
  }

  const meat = inferOptionFromMap(meatGroup, query, [
    [/\b(steak|bistec|beef|carne asada)\b/, "Bistec / Steak"],
    [/\b(chicken|pollo)\b/, "Pollo / Chicken"],
    [/\b(pork|pernil)\b/, "Pernil / Roasted Pork"],
    [/\b(chorizo|sausage)\b/, "Chorizo / Mexican Sausage"],
    [/\b(tripa|tripas|tripe)\b/, "Tripa / Beef Tripe"],
    [/\b(duro|duros|pork rinds?|chicharron|chicharrones)\b/, "Duro / Pork Rinds"],
    [/\b(prensado|spicy pork)\b/, "Prensado / Spicy Pork"],
    [/\b(cheese quesadilla|quesadilla cheese|quesadilla de queso|solo queso|only cheese|plain cheese|cheese only)\b/, "Solo Queso / Only Cheese"],
    [/\b(ground beef|picadillo|molida)\b/, "Picadillo / Ground Beef"],
    [/\b(al pastor|pastor)\b/, "Al Pastor"],
    [/\b(veggie|vegetarian|vegetales|vegetal)\b/, "Vegetales / Veggie"]
  ]);
  if (meat) modifiers.push(meat);

  const withModifier = inferOptionFromMap(withGroup, query, [
    [/\b(with beans|con frijol(?:es)?|frijol(?:es)?|beans)\b/, "Con Frijoles / With Beans"],
    [/\b(with rice|con arroz|arroz|rice)\b/, "Con Arroz / With Rice"],
    [/\b(with cheese|con queso|queso fresco|fresh cheese)\b/, "Con Queso Fresco / With Cheese"],
    [/\b(extra queso|extra cheese)\b/, "EXTRA QUESO / Cheese"]
  ]);
  if (withModifier) modifiers.push(withModifier);

  const deluxe = inferOptionFromMap(deluxeGroup, query, [
    [/\b(deluxe|preparad[ao]|de lujo)\b/, "DELUXE"]
  ]);
  if (deluxe && !customerDeclinesDeluxe(query)) modifiers.push(deluxe);

  return mergeModifiersByGroup(modifiers, inferMenuModifierSelectionsFromQuery(item, query, modifiers));
}

function isTacoOrQuesadillaItem(item) {
  return /\b(taco|quesadilla)\b/.test(normalizeQueryText(`${item?.name || ""} ${item?.nameEs || ""}`));
}

function customerDeclinesDeluxe(query) {
  return /\b(no|not|without|sin)\s+(deluxe|de\s+lujo)\b|\b(deluxe|de\s+lujo)\s+(no|not)\b/.test(normalizeQueryText(query));
}

function getDefaultTortillaModifier(item, tortillaGroup, query) {
  if (!tortillaGroup || !isTacoOrQuesadillaItem(item)) {
    return null;
  }

  const normalized = normalizeQueryText(query);
  if (!/\b(taco|tacos|quesadilla|quesadillas)\b/.test(normalized)) {
    return null;
  }

  const option = findCanonicalOption(tortillaGroup.options || [], getTortillaOptionHint(item, "co"));
  if (!option) {
    return null;
  }

  return {
    groupId: tortillaGroup.id,
    groupName: tortillaGroup.name,
    option,
    quantity: 1
  };
}

function isModifierGroupRequired(group) {
  return Math.max(0, Number(group?.minSelections || 0)) > 0;
}

function inferMenuModifierSelectionsFromQuery(item, query, existingModifiers = []) {
  const groups = Array.isArray(item?.modifierGroups) ? item.modifierGroups : [];
  const selectedGroupIds = new Set((existingModifiers || []).map((modifier) => modifier.groupId));
  const selections = [];

  for (const group of groups) {
    if (selectedGroupIds.has(group.id)) continue;
    if (!isModifierGroupRequired(group)) continue;

    const options = Array.isArray(group.options) ? group.options : [];
    if (!options.length) continue;

    const scored = options
      .map((option) => ({ option: String(option), score: scoreModifierOptionMatch(option, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) continue;

    const secondScore = scored[1]?.score || 0;
    const confident = best.score >= 100 || (best.score >= 45 && best.score >= secondScore + 12);
    if (!confident) continue;

    selections.push({
      groupId: group.id,
      groupName: group.name,
      option: best.option,
      quantity: 1
    });
  }

  return selections;
}

function mergeResolvedModifiers(existing, inferred) {
  return mergeModifiersByGroup(normalizeToolModifiers(existing), inferred || []);
}

const QUANTITY_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10
};

const COUNTED_MEAT_OPTIONS = [
  { option: "Bistec / Steak", aliases: ["bistec", "steak", "carne asada"] },
  { option: "Pollo / Chicken", aliases: ["pollo", "chicken"] },
  { option: "Chorizo / Mexican Sausage", aliases: ["chorizo", "sausage"] },
  { option: "Tripa / Beef Tripe", aliases: ["tripa", "tripas", "tripe"] },
  { option: "Duro / Pork Rinds", aliases: ["duro", "duros", "pork rinds", "chicharron", "chicharrones"] },
  { option: "Prensado / Spicy Pork", aliases: ["prensado", "spicy pork"] },
  { option: "Pernil / Roasted Pork", aliases: ["pernil", "roasted pork"] },
  { option: "Picadillo / Ground Beef", aliases: ["picadillo", "ground beef", "molida"] },
  { option: "Al Pastor", aliases: ["al pastor", "pastor"] },
  { option: "Vegetales / Veggie", aliases: ["vegetales", "veggie", "vegetarian"] },
  { option: "Solo Queso / Only Cheese", aliases: ["solo queso", "only cheese", "cheese only", "queso"] }
];

function parseQuantityToken(token) {
  const normalized = normalizeOptionKey(token);
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric > 0 && numeric <= 20) {
    return numeric;
  }
  return QUANTITY_WORDS[normalized] || 0;
}

function quantityPattern() {
  return `(?:[1-9]|1[0-9]|20|${Object.keys(QUANTITY_WORDS).join("|")})`;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findCountedMeatRequests(query) {
  const normalized = normalizeOptionKey(query);
  const requests = [];
  const seen = new Set();

  for (const meat of COUNTED_MEAT_OPTIONS) {
    for (const alias of meat.aliases) {
      const aliasPattern = escapeRegExp(normalizeOptionKey(alias)).replace(/\s+/g, "\\s+");
      const regex = new RegExp(`\\b(${quantityPattern()})\\s+(?:x\\s+)?(?:de\\s+)?${aliasPattern}\\b`, "gi");
      let match;
      while ((match = regex.exec(normalized))) {
        const quantity = parseQuantityToken(match[1]);
        if (!quantity) continue;
        const key = `${meat.option}|${match.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        requests.push({
          quantity,
          option: meat.option,
          alias,
          index: match.index
        });
      }
    }
  }

  return requests.sort((a, b) => a.index - b.index);
}

function getSharedModifierPhrase(query) {
  const normalized = normalizeOptionKey(query);
  const parts = [];
  if (/\b(homemade|home made|handmade|hand made|comal|corn)\b/.test(normalized)) parts.push("comal");
  if (/\b(flour|harina)\b/.test(normalized)) parts.push("flour");
  if (/\b(street|taquero|taquera)\b/.test(normalized)) parts.push("street");
  if (/\b(with beans|con frijol(?:es)?|frijol(?:es)?|beans)\b/.test(normalized)) parts.push("with beans");
  if (/\b(with rice|con arroz|arroz|rice)\b/.test(normalized)) parts.push("with rice");
  if (/\b(with cheese|con queso|queso fresco|fresh cheese)\b/.test(normalized)) parts.push("with cheese");
  if (/\b(deluxe|preparad[ao]|de lujo)\b/.test(normalized) && !customerDeclinesDeluxe(normalized)) parts.push("deluxe");
  return parts.join(" ");
}

function shouldPreferFullAddPhrase(args) {
  const full = String(state.lastUserText || "").trim();
  if (!full) return false;
  const normalized = normalizeOptionKey(full);
  const quantityMatches = normalized.match(new RegExp(`\\b${quantityPattern()}\\b`, "gi")) || [];
  const namesOrderItem = /\b(taco|tacos|quesadilla|quesadillas)\b/.test(normalized);
  const modelPhrase = String(args.itemQuery || args.itemId || "").trim();
  return namesOrderItem && quantityMatches.length >= 2 && normalizeOptionKey(modelPhrase) !== normalized;
}

function getAddItemQuery(args) {
  if (shouldPreferFullAddPhrase(args)) {
    return state.lastUserText.trim();
  }
  return String(args.itemQuery || state.lastUserText || args.itemId || "").trim();
}

function findCountedBaseItemRequests(query) {
  const normalized = normalizeOptionKey(query);
  const requests = [];
  const regex = new RegExp(`\\b(${quantityPattern()})\\s+(?:x\\s+)?(?:(?:comal|homemade|corn|flour|harina|street|taquero|taquera)\\s+)?(tacos?|quesadillas?)\\b`, "gi");
  let match;
  while ((match = regex.exec(normalized))) {
    const quantity = parseQuantityToken(match[1]);
    if (!quantity) continue;
    requests.push({
      quantity,
      type: /^quesadilla/.test(match[2]) ? "quesadilla" : "taco",
      index: match.index
    });
  }
  return requests;
}

function resolveMultipleAddItemToolArgs(args) {
  const customerPhrase = getAddItemQuery(args);
  const query = customerPhrase || String(args.itemId || "").trim();
  const normalized = normalizeQueryText(query);
  const isTacoRequest = /\btacos?\b/.test(normalized);
  const isQuesadillaRequest = /\bquesadillas?\b/.test(normalized) && !/\b(dorada|fried|frita|frito|combo|pack|platter)\b/.test(normalized);
  if (!isTacoRequest && !isQuesadillaRequest) {
    return { ok: false };
  }

  const countedMeats = findCountedMeatRequests(query);
  const countedBaseItems = findCountedBaseItemRequests(query);
  if (!shouldPreferFullAddPhrase(args) && countedMeats.length < 2) {
    return { ok: false };
  }

  if (!countedMeats.length) {
    return { ok: false };
  }

  const missingBaseItems = countedBaseItems.filter((base) => (
    !countedMeats.some((meat) => Math.abs(meat.index - base.index) <= 24)
  ));
  const shared = getSharedModifierPhrase(query);
  const actions = [];

  for (const request of countedMeats) {
    const nearestBase = countedBaseItems
      .filter((base) => base.index >= request.index)
      .sort((a, b) => a.index - b.index)[0];
    const baseWord = nearestBase?.type || (isQuesadillaRequest && !isTacoRequest ? "quesadilla" : "taco");
    const item = baseWord === "quesadilla" ? findPreferredQuesadillaItem() : findPreferredSingleTacoItem(normalized);
    if (!item) {
      return { ok: false };
    }

    const lineQuery = `${baseWord} ${request.alias} ${shared}`.trim();
    const modifiers = inferModifiersFromQuery(item, lineQuery);
    const normalizedSelection = normalizeTacoVariantSelection(item, modifiers, lineQuery);
    const guard = validateAddItemToolArgs({
      ...args,
      itemId: normalizedSelection.item.id,
      quantity: request.quantity,
      modifiers: normalizedSelection.modifiers
    });
    if (!guard.ok) {
      return { ok: false };
    }
    actions.push({
      type: "add_item",
      itemId: normalizedSelection.item.id,
      quantity: request.quantity,
      modifiers: Array.isArray(guard.canonicalModifiers) ? guard.canonicalModifiers : normalizedSelection.modifiers,
      ...(guard.mode ? { mode: guard.mode } : {})
    });
  }

  return actions.length
    ? {
      ok: true,
      actions,
      missingBaseItems
    }
    : { ok: false };
}

function getTortillaOptionHint(item, kind) {
  const normalizedName = normalizeQueryText(`${item?.name || ""} ${item?.nameEs || ""}`);
  const isQuesadilla = normalizedName.includes("quesadilla");
  if (kind === "co") return isQuesadilla ? "Quesadilla Comal / Homemade" : "Taco Comal / Homemade";
  if (kind === "hr") return isQuesadilla ? "Quesadilla Harina / Flour" : "Taco Harina / Flour";
  if (kind === "st") return isQuesadilla ? "Quesadilla Taquera / Street Quesadilla" : "Taco Taquero / Street Taco";
  return "";
}

function getTacoTortillaKindFromText(text) {
  const normalized = normalizeQueryText(text);
  if (/\b(homemade|home made|handmade|hand made|comal|corn|\(co\)|\bco\b)\b/.test(normalized)) return "co";
  if (/\b(flour|harina|\(hr\)|\bhr\b)\b/.test(normalized)) return "hr";
  if (/\b(street|taquero|taquera|\(st\)|\bst\b)\b/.test(normalized)) return "st";
  return "";
}

function getTacoTortillaKindFromItem(item) {
  return getTacoTortillaKindFromText(`${item?.id || ""} ${item?.name || ""} ${item?.nameEs || ""}`);
}

function getTacoTortillaKindFromModifiers(modifiers) {
  for (const modifier of modifiers || []) {
    const kind = getTacoTortillaKindFromText(`${modifier.groupName || ""} ${modifier.option || ""}`);
    if (kind) return kind;
  }
  return "";
}

function findSingleTacoVariant(kind) {
  if (!kind) return null;
  return state.menu
    .filter(isSingleTacoCandidate)
    .find((item) => getTacoTortillaKindFromItem(item) === kind) || null;
}

function stripTortillaVariantModifiers(modifiers) {
  return (modifiers || []).filter((modifier) => !getTacoTortillaKindFromText(`${modifier.groupName || ""} ${modifier.option || ""}`));
}

function normalizeTacoVariantSelection(item, modifiers, query) {
  if (!isSingleTacoCandidate(item)) {
    return { item, modifiers };
  }

  const requestedKind = getTacoTortillaKindFromText(query)
    || getTacoTortillaKindFromModifiers(modifiers)
    || getTacoTortillaKindFromItem(item);
  const variant = findSingleTacoVariant(requestedKind);
  if (!variant) {
    return { item, modifiers };
  }

  return {
    item: variant,
    modifiers: stripTortillaVariantModifiers(modifiers)
  };
}

function resolveAddItemToolArgs(args) {
  const customerPhrase = getAddItemQuery(args);
  const query = customerPhrase || String(args.itemId || "").trim();
  const phraseItem = resolveMenuItemFromQuery(customerPhrase);
  const exactItem = resolveMenuItemFromQuery(args.itemId);
  const phraseNamesBaseItem = /\b(tacos?|quesadillas?)\b/.test(normalizeQueryText(customerPhrase));
  const resolvedItem = phraseNamesBaseItem
    ? (phraseItem || exactItem)
    : (exactItem || phraseItem || resolveMenuItemFromQuery(query));
  if (!resolvedItem) {
    return {
      ok: false,
      message: `Item not recognized: ${query || "unknown item"}.`
    };
  }

  const inferred = inferModifiersFromQuery(resolvedItem, query);
  const normalized = normalizeTacoVariantSelection(
    resolvedItem,
    mergeResolvedModifiers(args.modifiers, inferred),
    query
  );
  return {
    ok: true,
    args: {
      ...args,
      itemId: normalized.item.id,
      quantity: Number(args.quantity) || inferQuantityFromText(query) || 1,
      modifiers: normalized.modifiers
    }
  };
}

function cartLineSearchText(line, index) {
  const modifiers = Array.isArray(line?.modifiers)
    ? line.modifiers.map((modifier) => `${modifier.groupName || ""} ${modifier.option || ""}`).join(" ")
    : "";
  return normalizeQueryText(`#${index + 1} ${line?.item?.id || ""} ${line?.item?.name || ""} ${line?.item?.nameEs || ""} ${modifiers}`);
}

function resolveCartLineIndex(queryOrId) {
  if (!state.cart.length) return -1;
  const raw = String(queryOrId || "").trim();
  const normalized = normalizeQueryText(raw);

  if (!raw || /\b(last|latest|previous|that|current|it|this|ultimo|ultima|ese|esa)\b/.test(normalized)) {
    return state.cart.length - 1;
  }

  const numberRef = raw.match(/#\s*(\d+)|\bitem\s+(\d+)\b|\bnumber\s+(\d+)\b/i);
  if (numberRef) {
    const index = Number(numberRef[1] || numberRef[2] || numberRef[3]) - 1;
    if (index >= 0 && index < state.cart.length) return index;
  }

  const exactId = state.cart.findIndex((line) => line.item.id === raw);
  if (exactId >= 0) return exactId;

  const item = resolveMenuItemFromQuery(raw);
  if (item) {
    for (let index = state.cart.length - 1; index >= 0; index -= 1) {
      if (state.cart[index].item.id === item.id) return index;
    }
  }

  const scored = state.cart
    .map((line, index) => {
      const haystack = cartLineSearchText(line, index);
      if (!normalized || !haystack) return { index, score: 0 };
      if (haystack.includes(normalized)) return { index, score: 100 };
      const words = normalized.split(" ").filter((word) => word.length > 2);
      const score = words.reduce((sum, word) => sum + (haystack.includes(word) ? 10 : 0), 0);
      return { index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index);

  return scored[0]?.index ?? -1;
}

function resolveCartMutationToolArgs(name, args) {
  const query = String(args.itemQuery || args.itemId || "").trim();
  const cartIndex = resolveCartLineIndex(query);
  if (cartIndex < 0 || !state.cart[cartIndex]) {
    return {
      ok: false,
      message: state.cart.length
        ? `Could not match cart item: ${query || "unspecified item"}.`
        : "The cart is empty."
    };
  }

  const line = state.cart[cartIndex];
  const nextArgs = {
    ...args,
    itemId: line.item.id,
    cartIndex
  };

  if (name === "update_item") {
    const inferred = inferModifiersFromQuery(line.item, query);
    const incoming = Array.isArray(args.modifiers) && args.modifiers.length
      ? normalizeToolModifiers(args.modifiers)
      : inferred;
    if (incoming.length) {
      nextArgs.modifiers = mergeModifiersByGroup(line.modifiers || [], incoming);
    }
  }

  return { ok: true, args: nextArgs };
}

function inferQuantityFromText(text) {
  const normalized = normalizeQueryText(text);
  const digit = normalized.match(/\b([1-9]|1[0-9]|20)\b/);
  if (digit) return Number(digit[1]);
  const wordMap = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const match = String(text || "").toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  return match ? wordMap[match[1]] : 0;
}

function isComboTacosItem(menuItem) {
  return /combo\s*tacos/i.test(`${menuItem?.name || ""} ${menuItem?.nameEs || ""} ${menuItem?.id || ""}`);
}

function isComboTacosRequiredGroup(groupName) {
  const normalized = String(groupName || "").toUpperCase();
  return normalized.startsWith("(A)")
    || normalized.startsWith("(B)")
    || normalized.startsWith("(CD)")
    || normalized.startsWith("(D)");
}

function mergeModifiersByGroup(existing, incoming) {
  const kept = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const patchGroups = new Set(next.map((entry) => entry.groupId));
  return [
    ...kept.filter((entry) => !patchGroups.has(entry.groupId)),
    ...next
  ];
}

function applyComboLateModifierUpdate(itemId, modifiers) {
  if (!Array.isArray(modifiers) || !modifiers.length) return false;
  const line = state.cart.find((entry) => entry.item.id === itemId);
  if (!line) return false;
  line.modifiers = mergeModifiersByGroup(line.modifiers || [], modifiers);
  return true;
}

function validateAddItemToolArgs(args) {
  const itemId = String(args.itemId || "").trim();
  const menuItem = state.menu.find((item) => item.id === itemId);
  if (!menuItem) {
    return { ok: false, message: "Unknown menu item id. Use exact item id from menu." };
  }

  const groups = Array.isArray(menuItem.modifierGroups) ? menuItem.modifierGroups : [];
  if (!groups.length) {
    return { ok: true };
  }

  const providedRaw = normalizeToolModifiers(args.modifiers);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const provided = providedRaw
    .map((selection) => {
      const group = groupsById.get(selection.groupId);
      if (group) {
        const canonical = findCanonicalOption(group.options || [], selection.option);
        if (canonical) return { ...selection, groupId: group.id, groupName: group.name, option: canonical };
      }

      for (const fallbackGroup of groups) {
        const canonical = findCanonicalOption(fallbackGroup.options || [], selection.option);
        if (canonical) {
          return {
            ...selection,
            groupId: fallbackGroup.id,
            groupName: fallbackGroup.name,
            option: canonical
          };
        }
      }
      return null;
    })
    .filter(Boolean);

  const byGroup = new Map();
  for (const selection of provided) {
    if (!byGroup.has(selection.groupId)) byGroup.set(selection.groupId, []);
    byGroup.get(selection.groupId).push(selection);
  }

  const isComboTacos = isComboTacosItem(menuItem);
  const requiredGroupIds = new Set(
    groups
      .filter((group) => (isComboTacos ? isComboTacosRequiredGroup(group.name) : Math.max(0, Number(group.minSelections || 0)) > 0))
      .map((group) => group.id)
  );
  const providedGroupIds = new Set(provided.map((selection) => selection.groupId));
  const hasRequiredGroupsInProvided = Array.from(providedGroupIds).some((groupId) => requiredGroupIds.has(groupId));
  const hasExistingItem = state.cart.some((line) => line.item.id === itemId);

  if (isComboTacos && provided.length > 0 && hasExistingItem && !hasRequiredGroupsInProvided) {
    return {
      ok: true,
      mode: "combo_late_modifier_update",
      canonicalModifiers: provided
    };
  }

  const missingGroups = [];
  for (const group of groups) {
    const min = Math.max(0, Number(group.minSelections || 0));
    const max = Math.max(min, Number(group.maxSelections || group.options?.length || 1));
    const requiredMin = isComboTacos
      ? (isComboTacosRequiredGroup(group.name) ? 1 : 0)
      : min;
    const picks = byGroup.get(group.id) || [];
    const validOptionSet = new Set((group.options || []).map((o) => optionDisplayName(o)) /* add1: options can be {id,name} objects — String(o) was "[object Object]" and refused every manual add */);
    const validPicks = picks.filter((pick) => validOptionSet.has(pick.option));
    const distinct = new Set(validPicks.map((pick) => pick.option)).size;

    if (requiredMin > 0 && distinct < requiredMin) {
      missingGroups.push({
        groupId: group.id,
        groupName: group.name,
        minSelections: requiredMin,
        maxSelections: max,
        options: group.options || []
      });
    }
  }

  if (missingGroups.length) {
    const groupNames = missingGroups.map((group) => group.groupName).join(", ");
    return {
      ok: false,
      message: `Missing required modifiers for: ${groupNames}. Ask follow-up questions and call add_item again with modifiers.`,
      requiredGroups: missingGroups,
      provided,
      canonicalModifiers: provided
    };
  }

  return { ok: true, canonicalModifiers: provided };
}

function attachUiHandlers() {
  // Mic button: first tap activates adaptive (hands-free) mode; tap again to stop.
  ui.listenButton.addEventListener("click", () => {
    if (!hasSelectedLanguage()) {
      ui.reply.textContent = LANGUAGE_PROMPT_BILINGUAL;
      startLanguagePromptLoop();
      return;
    }
    // ux1 barge-in: while Elvi is speaking, yield to listening (cancel TTS)
    if (state.elviSpeaking || document.getElementById("elvi-halo")?.dataset?.state === "speaking") {
      try { stopCurrentAudio(); } catch {}
      if (!state.vadRunning) {
        startAdaptiveListen().catch((error) => {
          ui.status.textContent = describeMicError(error);
          setAvatarState("idle");
        });
      } else {
        setAvatarState("listening");
      }
      try { window.dispatchEvent(new CustomEvent("elvi:barge", { detail: { why: "mic-tap" } })); } catch {}
      return;
    }
    if (state.vadRunning) {
      stopAdaptiveListen();
    } else {
      startAdaptiveListen().catch((error) => {
        ui.status.textContent = describeMicError(error);
        setAvatarState("idle");
      });
    }
  });
  // ux1: long-press mic (~480ms) while speaking → barge-in
  {
    let holdT = null;
    const clearHold = () => { if (holdT && holdT !== "held") clearTimeout(holdT); holdT = null; };
    ui.listenButton.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      holdT = setTimeout(() => {
        holdT = "held";
        if (state.elviSpeaking || document.getElementById("elvi-halo")?.dataset?.state === "speaking") {
          try { stopCurrentAudio(); } catch {}
          if (!state.vadRunning) {
            startAdaptiveListen().catch(() => {});
          } else setAvatarState("listening");
          try { window.dispatchEvent(new CustomEvent("elvi:barge", { detail: { why: "hold" } })); } catch {}
        }
      }, 480);
    });
    ui.listenButton.addEventListener("pointerup", clearHold);
    ui.listenButton.addEventListener("pointerleave", clearHold);
    ui.listenButton.addEventListener("pointercancel", clearHold);
  }

  // Cart drawer
  ui.cartToggle.addEventListener("click", openCart);
  document.getElementById("cart-bar")?.addEventListener("click", openCart);
  ui.cartClose.addEventListener("click", closeCart);
  ui.drawerBackdrop.addEventListener("click", closeCart);
  ui.modifierClose?.addEventListener("click", closeModifierModal);
  ui.modifierModal?.addEventListener("click", (event) => {
    if (event.target === ui.modifierModal) closeModifierModal();
  });
  ui.modifierAdd?.addEventListener("click", () => {
    handleModifierStepAdvance();
  });
  ui.comboBack?.addEventListener("click", () => {
    sendComboNav("back");
  });
  ui.comboNext?.addEventListener("click", () => {
    sendComboNav("next");
  });

  ui.promptForm.addEventListener("submit", (event) => {
    event.preventDefault();
    autoSelectLanguageFromText(ui.promptInput.value.trim());
    if (!hasSelectedLanguage()) {
      ui.reply.textContent = LANGUAGE_PROMPT_BILINGUAL;
      startLanguagePromptLoop();
      return;
    }
    const text = ui.promptInput.value.trim();
    if (!text) {
      return;
    }

    if (!sendUserTurn(text)) {
      ui.status.textContent = "Please wait for Elvi to finish this turn.";
      return;
    }
    pulseAvatarState("talking_neutral", 900, "idle");
    ui.promptInput.value = "";
  });

  ui.langPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      setLanguageMode(pill.dataset.lang);
    });
  });

  window.addEventListener("pointerdown", () => {
    if (!hasSelectedLanguage() && !isV3MenuUi()) {
      restartLanguagePromptLoop();
    }
  });

  window.addEventListener("keydown", () => {
    if (!hasSelectedLanguage() && !isV3MenuUi()) {
      restartLanguagePromptLoop();
    }
  });

  ui.fulfillment.addEventListener("change", () => {
    if (ui.fulfillment.value === "DELIVERY" && !isDeliveryEnabled()) {
      state.fulfillment = "PICKUP";
      ui.fulfillment.value = "PICKUP";
      ui.reply.textContent = deliveryDisabledMessage();
      syncRealtimeOrderContext();
      return;
    }
    state.fulfillment = ui.fulfillment.value === "DELIVERY" ? "DELIVERY" : "PICKUP";
    syncRealtimeOrderContext();
  });

  ui.phone?.addEventListener("change", () => void checkFavorites(ui.phone.value));

  ui.checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.customer.name = ui.name.value.trim();
    state.customer.phone = ui.phone.value.trim();
    state.customer.email = ui.email.value.trim();
    state.customer.address = ui.address.value.trim();
    if (state.fulfillment === "DELIVERY" && !isDeliveryEnabled()) {
      state.fulfillment = "PICKUP";
      ui.fulfillment.value = "PICKUP";
      ui.reply.textContent = deliveryDisabledMessage();
    }

    const r = await doCheckout();
    if (!r.ok) ui.status.textContent = r.error;
  });
}

// time1: one checkout path for the drawer form and the v3 timing step (elviBridge.checkout). Server validates timing.
async function doCheckout(opts = {}) {
    try {
      const payMode = opts?.payMode === "cash" ? "cash" : "card";
      // ux1: cash = pay-at-pickup — no Square charge (no kitchen ticket API yet)
      if (payMode === "cash") {
        console.warn("[ux1] cash pay-at-pickup stub — no Square charge", {
          cart: state.cart.map(describeCartLine),
          customer: state.customer,
          fulfillment: state.fulfillment,
          timing: state.timing || { mode: "asap" }
        });
        return { ok: true, cash: true, payAtPickup: true };
      }
      const response = await fetch(`/api/${state.tenantSlug}/orders/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderSessionId: state.orderSessionId,
          cart: state.cart.map((line) => ({
            id: line.item.id,
            quantity: line.quantity,
            unitPriceCents: getCartLineUnitPriceCents(line),
            modifiers: Array.isArray(line.modifiers)
              ? line.modifiers.map((modifier) => ({
                  groupId: modifier.groupId,
                  groupName: modifier.groupName,
                  option: modifier.option,
                  quantity: Math.max(1, Number(modifier.quantity) || 1)
                }))
              : []
          })),
          fulfillment: state.fulfillment,
          customer: state.customer,
          timing: state.timing || { mode: "asap" },
          metadata: {
            language: getEffectiveLanguage(),
            source: state.runtimeConfig.voiceOrderSource,
            transcriptSummary: state.lastUserText,
            cartSummary: state.cart.map(describeCartLine).join("; ").slice(0, 480), // add1: describeCurrentOrderForSpeech never existed -> every checkout threw
            payMode
          }
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Checkout failed");
      }

      const result = await response.json();
      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
      return { ok: true, checkoutUrl: result.checkoutUrl };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Checkout failed" };
    }
}

async function startListening() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket is not connected");
  }

  state.localTranscript = "";
  startBrowserRecognition();

  state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(state.stream, {
    mimeType: pickRecorderMimeType()
  });

  recorder.addEventListener("dataavailable", async (event) => {
    if (!event.data || event.data.size === 0) {
      return;
    }

    const data = await blobToBase64(event.data);
    sendWs({ type: "audio_chunk", data, mimeType: recorder.mimeType });
  });

  recorder.start(220);
  state.mediaRecorder   = recorder;
  ui.status.textContent = "Listening…";
  setAvatarState("listening");
}

function stopListening() {
  if (!state.mediaRecorder) {
    return;
  }

  state.mediaRecorder.stop();
  state.mediaRecorder = null;

  // In adaptive mode the stream is owned by the VAD — don't stop its tracks.
  if (!state.autoListen && state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }

  // Dispatch whichever transcript we have — but recognition.stop() fires its
  // final onresult *asynchronously*, so we must wait for onend before reading.
  const dispatch = () => {
    const local = state.localTranscript.trim();
    sendWs(local
      ? { type: "user_text", text: local, language: getEffectiveLanguage() }
      : { type: "audio_end", language: getEffectiveLanguage() });
  };

  if (state.recognition) {
    const rec = state.recognition;
    // Hard fallback: if onend never fires within 600ms, dispatch anyway.
    const timer = setTimeout(() => { state.recognition = null; dispatch(); }, 600);
    rec.onend = () => { clearTimeout(timer); state.recognition = null; dispatch(); };
    try { rec.stop(); } catch { clearTimeout(timer); dispatch(); }
  } else {
    dispatch();
  }
}

function pickRecorderMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "audio/webm";
}

function describeMicError(error) {
  const text = String(error?.message || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();

  if (name.includes("notallowed") || text.includes("permission") || text.includes("denied")) {
    return "Mic blocked. Allow microphone for this site, then refresh.";
  }

  if (name.includes("notfound") || text.includes("device not found")) {
    return "No microphone found. Connect a mic and try again.";
  }

  if (name.includes("notreadable") || text.includes("in use")) {
    return "Microphone is busy in another app. Close that app and try again.";
  }

  if (name.includes("notsupported") || text.includes("mime") || text.includes("mediarecorder")) {
    return "This browser cannot start recording here. Try Chrome or Edge.";
  }

  return `Mic error: ${error?.message || "Unknown error"}`;
}

function startBrowserRecognition() {
  const SpeechCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechCtor || state.recognitionPaused || state.recognition) {
    return;
  }

  try {
    const recognition = new SpeechCtor();
    recognition.lang = getEffectiveLanguage() === "es" ? "es-US" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      if (state.elviSpeaking || state.recognitionPaused || performance.now() < state.voiceInputCooldownUntil) {
        return;
      }
      let combined = "";
      let finalText = "";
      for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript || "";
        combined += `${transcript} `;
        if (event.results[i].isFinal) {
          finalText += `${transcript} `;
        }
      }
      const text = combined.trim();
      if (text) state.localTranscript = text;
      const finalPhrase = finalText.trim();
      if (finalPhrase && !state.speechActive && canStartVoiceTurn(finalPhrase)) {
        clearTimeout(state.recognitionFinalTimer);
        state.recognitionFinalTimer = setTimeout(() => {
          if (state.speechActive || !claimVoiceTurn(finalPhrase)) return;
          state.localTranscript = finalPhrase;
          state.turnAudioChunks = [];
          ui.status.textContent = "Processing…";
          setAvatarState("talking_neutral");
          handleLocalVoiceTurnAfterRecognition(0);
        }, 450);
      }
    };

    recognition.onerror = () => {
      // Keep silent fallback to audio_end if local recognition fails.
    };

    recognition.onend = () => {
      state.recognition = null;
      if (state.autoListen && state.vadRunning && !state.recognitionPaused) {
        setTimeout(() => {
          if (state.autoListen && state.vadRunning && !state.recognition && !state.recognitionPaused) {
            startBrowserRecognition();
          }
        }, 250);
      }
    };

    recognition.start();
    state.recognition = recognition;
  } catch {
    state.recognition = null;
  }
}

function stopBrowserRecognition() {
  if (!state.recognition) {
    return;
  }

  try {
    state.recognition.stop();
  } catch {
    // no-op
  }
}

function pauseBrowserRecognition() {
  state.recognitionPaused = true;
  clearTimeout(state.recognitionFinalTimer);
  state.recognitionFinalTimer = null;
  state.localTranscript = "";
  stopBrowserRecognition();
}

function resumeBrowserRecognition() {
  state.recognitionPaused = false;
  if (state.autoListen && state.vadRunning && !state.recognition && !state.elviSpeaking) {
    startBrowserRecognition();
  }
}

function canStartVoiceTurn(text = "") {
  if (!state.vadRunning || state.turnInFlight || state.elviSpeaking || state.recognitionPaused) return false;
  if (performance.now() < state.voiceInputCooldownUntil) return false;
  return !text || isLikelyVoiceOrderCommand(text);
}

function claimVoiceTurn(text = "") {
  if (!canStartVoiceTurn(text)) return false;
  state.turnInFlight = true; setAvatarState("thinking");
  state.voiceInputCooldownUntil = performance.now() + 900;
  clearTimeout(state.recognitionFinalTimer);
  state.recognitionFinalTimer = null;
  return true;
}

function shouldUseLocalVoiceOrderingFlow() {
  return Boolean(state.currentBuildGuide || state.pendingComboState);
}

async function transcribeTurnAudio() {
  const audioChunks = Array.isArray(state.turnAudioChunks) ? state.turnAudioChunks.filter(Boolean).slice(-180) : [];
  if (!audioChunks.length) return "";
  try {
    ui.status.textContent = "Transcribing…";
    const response = await fetch(`/api/${state.tenantSlug}/xai/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: getEffectiveLanguage(), audioChunks })
    });
    const result = await response.json().catch(() => ({}));
    const transcript = response.ok ? String(result.transcript || "").trim() : "";
    if (transcript && ui.engine) ui.engine.textContent = `Heard: ${transcript}`;
    if (!response.ok) console.warn("[VOICE] transcription response failed:", result);
    return transcript;
  } catch (error) {
    console.warn("[VOICE] transcription fallback failed:", error);
    return "";
  }
}

function isLikelyVoiceOrderCommand(text) {
  const normalized = normalizeOptionKey(text);
  if (!normalized) return false;
  if (shouldUseLocalVoiceOrderingFlow()) return true;
  if (isCurrentOrderQuestion(text) || shouldResolveStructuredBuildLocally(text)) return true;
  // Menu questions ("what's on the menu", "¿qué tienen?") are real turns, not noise.
  if (MENU_QUESTION_HINT.test(String(text || ""))) return true;
  return /\b(order|orden|ordenar|quiero|quisiera|dame|deme|pon|poner|add|get|give me|checkout|pagar|recoger|pickup|para llevar|togo|to go|taco|tacos|burrito|quesadilla|gordita|gorditas|torta|tortas|combo|combos|pack|packs|paquete|paquetes|agua|drink|bebida|salsa|extra)\b/.test(normalized);
}

function handleLocalVoiceTurnAfterRecognition(delayMs = 900) {
  setTimeout(async () => {
    let text = String(state.localTranscript || "").trim();
    if (!text) {
      text = await transcribeTurnAudio();
    }
    state.turnAudioChunks = [];
    state.turnInFlight = false;
    if (!text) {
      const reply = getEffectiveLanguage() === "es"
        ? "No alcancé a escuchar. Repítelo, por favor."
        : "I did not catch that. Please say it again.";
      ui.reply.textContent = reply;
      ui.status.textContent = "Connected";
      if (ui.engine) ui.engine.textContent = "No transcript";
      void speakLocalText(reply, getEffectiveLanguage());
      setAvatarState("idle");
      return;
    }
    state.localTranscript = "";
    if (ui.engine) ui.engine.textContent = `Heard: ${text}`;
    if (!isLikelyVoiceOrderCommand(text)) {
      ui.status.textContent = "Ready…";
      if (ui.engine) ui.engine.textContent = `Ignored: ${text}`;
      setAvatarState("idle");
      return;
    }
    if (!sendUserTurn(text)) {
      ui.status.textContent = "Please wait for Elvi to finish this turn.";
    }
  }, delayMs);
}

function sendOptionChip(btn) {
  const text = btn.textContent.trim();
  if (!text) return;
  if (!state.currentBuildGuide && !state.pendingComboState && (!state.ws || state.ws.readyState !== WebSocket.OPEN)) return;
  if (!sendUserTurn(text)) {
    return;
  }
  const allChips = btn.closest("ul")?.querySelectorAll(".combo-option-chip");
  allChips?.forEach((c) => c.classList.remove("selected"));
  btn.classList.add("selected");
  pulseAvatarState("talking_neutral", 900, "idle");
}

/** Chat-endpoint modifiers are {step, option}; the cart wants {groupId, groupName, option}. */
function chatModifiersForCart(item, modifiers) {
  const groups = Array.isArray(item?.modifierGroups) ? item.modifierGroups : [];
  return (Array.isArray(modifiers) ? modifiers : []).map((mod) => {
    for (const group of groups) {
      const option = findCanonicalModifierOption(group.options || [], mod.option);
      if (option) {
        return { groupId: group.id, groupName: group.name, option: optionDisplayName(option), optionId: option.id, quantity: 1, priceDeltaCents: Number(option.priceDeltaCents) || undefined };
      }
    }
    return null;
  }).filter(Boolean);
}

async function handleChatFallbackTurn(text) {
  state.turnInFlight = true;
  setAvatarState("thinking");
  ui.status.textContent = "Processing…";
  try {
    state.chatFallbackHistory = Array.isArray(state.chatFallbackHistory) ? state.chatFallbackHistory : [];
    const response = await fetch(`/api/${state.tenantSlug}/elvi/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: text, language: getEffectiveLanguage(), history: state.chatFallbackHistory.slice(-24), orderSessionId: state.orderSessionId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `chat ${response.status}`);
    // Never let a fallback turn check out; the customer confirms checkout in the cart.
    const actions = (data.actions || []).filter((action) => action.type !== "checkout").map((action) => {
      if (action.type !== "add_item" || !Array.isArray(action.modifiers)) return action;
      const item = state.menu.find((candidate) => candidate.id === action.itemId);
      return { ...action, modifiers: chatModifiersForCart(item, action.modifiers) };
    });
    if (actions.length) applyActions(actions);
    state.chatFallbackHistory.push({ role: "customer", text }, { role: "assistant", text: String(data.reply || "") });
    const reply = String(data.reply || "");
    ui.reply.textContent = reply;
    if (ui.engine) ui.engine.textContent = "Engine: chat (realtime not connected)";
    renderCart();
    markLocalTurnReady();
    if (reply) await speakLocalText(reply, getEffectiveLanguage());
  } catch (error) {
    console.warn("[CHAT] fallback failed", error);
    ui.reply.textContent = fallbackReplyText();
    void speakLocalText(ui.reply.textContent, getEffectiveLanguage()).catch(() => {}); // reply1: say it, not just show it
  } finally {
    state.turnInFlight = false;
    ui.status.textContent = "Connected";
  }
}

// Loose check so only likely menu questions make the extra /menu/info call.
const MENU_QUESTION_HINT = /\b(menu|men[uú]|carta|recommend|suggest|popular|what do you (have|got|sell)|what'?s good|what (combos|specials|drinks|meals|platters|sides|dips|seafood)|qu[eé] (tienen|tienes|hay|venden|me recomienda|recomiendas|combos|especiales|bebidas|paquetes|mariscos|platillos)|cu[aá]les|lo m[aá]s (pedido|popular|vendido)|recomienda)(?![a-z])/i;

/** Answer menu questions without touching the order or the build in progress. */
async function handleMenuQuestionTurn(text) {
  state.turnInFlight = true;
  let answered = false;
  try {
    const response = await fetch(`/api/${state.tenantSlug}/menu/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language: getEffectiveLanguage() })
    });
    const data = response.ok ? await response.json() : {};
    if (data?.reply) {
      answered = true;
      // Mid-build: answer, then pick the order back up where it was.
      const resume = state.currentBuildGuide
        ? ` ${getEffectiveLanguage() === "es" ? "Seguimos con tu" : "Back to your"} ${state.currentBuildGuide.display_name}: ${guideCurrentPrompt()}`
        : "";
      // Don't ask "what would you like?" when we're about to resume the build question.
      const answer = resume ? String(data.reply).replace(/\s*¿?[^.?¿]*\?\s*$/, "") : data.reply;
      const reply = `${answer}${resume}`;
      ui.reply.textContent = reply;
      markLocalTurnReady();
      await speakLocalText(reply, getEffectiveLanguage());
    }
  } catch (error) {
    console.warn("[MENU] menu info failed", error);
  } finally {
    state.turnInFlight = false;
  }
  if (!answered) sendUserTurn(text, { skipMenuQuestion: true });
}

/** A real question or order before EN/ES was tapped picks the language from the words used. */
function autoSelectLanguageFromText(text) {
  if (hasSelectedLanguage() || !text) return false;
  if (!MENU_QUESTION_HINT.test(text) && !isLikelyVoiceOrderCommand(text)) return false;
  const spanish = /[¿¡ñáéíóú]|\b(que|tienen|tienes|quiero|hay|dame|menu|carta|para|por favor|recomienda|cuales|combo de|de pastor|con)\b/i.test(text)
    && !/\b(what|the|do you|i want|please|have)\b/i.test(text);
  setLanguageMode(spanish ? "es" : "en");
  return true;
}

function sendUserTurn(text, options = {}) {
  if (!text) {
    return false;
  }
  autoSelectLanguageFromText(text);

  if (!options.skipMenuQuestion && MENU_QUESTION_HINT.test(text) && hasSelectedLanguage() && !state.turnInFlight) {
    if (state.elviSpeaking) {
      stopCurrentAudio();
      state.elviSpeaking = false;
    }
    void handleMenuQuestionTurn(text);
    return true;
  }

  // Universal handling for completion phrases on multi-select guide steps
  // This makes voice, direct typing, and local resolve all behave the same
  if (handleMultiSelectCompletion(text)) {
    return true;
  }

  if (!hasSelectedLanguage()) {
    ui.reply.textContent = LANGUAGE_PROMPT_BILINGUAL;
    startLanguagePromptLoop();
    return false;
  }

  // ui4: "actually / mejor / cambia / solo arroz / sin frijoles" edits the most recent matching cart line.
  if (!state.currentBuildGuide && !state.turnInFlight && tryCartCorrection(text)) return true;

  if (state.currentBuildGuide) {
    if (state.elviSpeaking && !state.turnInFlight) {
      stopCurrentAudio();
      state.elviSpeaking = false;
    }
    if (state.turnInFlight) {
      return false;
    }
    void handleGuideTurnLocally(text);
    return true;
  }

  // Structured builds (combos, pack meals, guided items from combo-guide.json)
  // are handled locally via /menu/resolve + local speech. They must work with
  // typing even if the realtime voice WS is still connecting or closed.
  // fix13: vague orders ("una orden", "un paquete", "8 meal pack", "un combo") get the server's one clarifying question.
  const vagueOrder = /^\s*(quiero |dame |i want |i'd like )?(una?|an?|one)?\s*(orden|order|paquete|pack|combo|meal pack|\d+ meal( pack)?|chopac?k)\s*(please|por favor)?\s*[.!?]*$/i.test(String(text || "")) || /\b(flautas?|taquitos?)\b/i.test(String(text || ""));
  const useLocalResolver = state.pendingComboState || state.orderContextPending || vagueOrder || shouldResolveStructuredBuildLocally(text) || mentionsMenuDrink(text);

  if (useLocalResolver) {
    // For new structured orders (combo/pack), allow the user to start via text
    // even if the avatar is currently speaking (e.g. right after language selection).
    if (state.elviSpeaking && !state.turnInFlight) {
      stopCurrentAudio();
      state.elviSpeaking = false;
    }
    if (state.turnInFlight) {
      return false;
    }
    void resolvePendingComboTurnLocally(text);
    return true;
  }

  // Realtime session still connecting (or closed): use the HTTP chat endpoint instead of dropping the turn.
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    if (state.turnInFlight) return false;
    // Orders go through the same menu resolver the realtime tool uses; other talk goes to /elvi/chat.
    if (state.cart.length && MODIFY_CUE.test(text)) void handleLocalModifyTurn(text); // reply1: "change X to Y" on cart items
    else if (isLikelyVoiceOrderCommand(text) && !isCurrentOrderQuestion(text)) void resolvePendingComboTurnLocally(text);
    else void handleChatFallbackTurn(text);
    return true;
  }

  // Single-lane turn taking: only one active request/response at a time.
  if (state.turnInFlight || state.elviSpeaking) {
    return false;
  }

  if (isCurrentOrderQuestion(text)) {
    const reply = summarizeCurrentOrderForCustomer();
    stopCurrentAudio();
    ui.reply.textContent = formatCentsForSpeech(reply);
    void speakLocalText(reply, getEffectiveLanguage());
    pulseAvatarState("talking_neutral", 1200, "idle");
    return true;
  }

  state.turnInFlight = true; setAvatarState("thinking");
  state.lastUserText = text;
  armReplyWatchdog();
  beginRealtimeTurnCartCheck();
  sendWs({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  });
  sendWs({ type: "response.create" });
  return true;
}

function shouldResolveStructuredBuildLocally(text) {
  const normalized = normalizeOptionKey(text);
  if (!normalized) return false;

  // Pack meals
  if (isPackMealIntentText(normalized)) return true;

  // Any guided combo (COMBO Burrito, COMBO Mix, etc.) or the word "combo"
  if (/\b(combo|combos|combinacion|combinaciones)\b/.test(normalized)) return true;

  // Explicit support for the main guided items even without the word "combo"
  // (e.g. user types "burrito" after seeing the menu). These will be corrected
  // to the full guided "COMBO Burrito" version by the backend resolver.
  if (/\b(burrito|mix|gordita|gorditas|torta|tortas|taco|tacos|quesadilla|quesadillas)\b/.test(normalized)) return true;
  // Especiales and other guided food (website-rules guides): resolve locally too.
  if (/\b(pambazo|pambazos|birria|birrias|dorada|doradas|esquite|esquites|elote|street corn|menudo|menudito|chiles? rellenos?|fiesta pan|fiesta platter|platter|charola|ceviche|coctel|cocktail|enchiladas?|al vapor|steamed|nachos|chilaquiles|mole|pozole|guisado|huarache|fajitas?|sopesaso|chimichanga|bowl|dips?|sides?|arroz|frijoles|rice|beans)\b/.test(normalized)) return true;

  const quantity = quantityPattern();
  return new RegExp(`\\b${quantity}\\s+(?:pack\\s+)?meals?\\b|\\b${quantity}\\s+meals?\\s+pack\\b|\\b${quantity}\\s+pack\\b`, "i").test(normalized);
}

function isPackMealIntentText(normalized) {
  if (/\b(pack\s+meals?|meals?\s+pack|packs?|paquetes?)\b/.test(normalized)) return true;
  if (/\bpaquetes?\s+(?:de\s+)?(?:comida|meal|meals)\b/.test(normalized)) return true;
  if (/\bpack\s+(?:de\s+)?comida\b/.test(normalized)) return true;
  return false;
}

function getCurrentGuideStep() {
  if (!state.currentBuildGuide || !state.currentGuideStep) return null;
  return state.currentBuildGuide.steps[state.currentGuideStep - 1] || null;
}

function getGuideSelectionLabels() {
  return (state.currentBuildSelections || []).map((selection) => {
    const prefix = selection.stepTitle ? `${selection.stepTitle}: ` : "";
    return `${prefix}${selection.option}`;
  });
}

function guideStepMinSelections(step) {
  return Math.max(0, Number(step?.min_selections ?? step?.minSelections ?? (step?.required ? 1 : 0)) || 0);
}

function guideStepMaxSelections(step) {
  const raw = step?.max_selections ?? step?.maxSelections;
  if (raw === null || raw === undefined) return Infinity;
  return Math.max(guideStepMinSelections(step), Number(raw) || 1);
}

function isGuideMultiStep(step) {
  return step?.selection_type === "multiple" || guideStepMaxSelections(step) > 1;
}

function guideStepNumber(step, fallbackIndex) {
  return Math.max(1, Number(step?.step) || fallbackIndex + 1);
}

function guideOptionAliases(option) {
  if (!option || typeof option !== "object") return [];
  return Array.isArray(option.aliases) ? option.aliases.map(String).filter(Boolean) : [];
}

function guideOptionValue(option) {
  return option && typeof option === "object" ? String(option.value || "") : "";
}

function guideOptionFamily(option) {
  return option && typeof option === "object" ? String(option.family || "") : "";
}

function hasOnlyIntent(text) {
  return /\b(only|solo|solamente|nom[aá]s|nada m[aá]s|just those|plain|simple)\b/i.test(String(text || ""));
}

function hasSkipIntent(text) {
  return /\b(next|continue|done|skip|none|no thanks|no salsa|without salsa|that(?:'|’)?s\s+(?:all|it)|that\s+is\s+(?:all|it)|all set|listo|siguiente|continuar|saltar|sin salsa|no gracias|asi esta|as[ií] esta|ya|eso es todo|es todo|eso ser[ií]a todo|ya es todo)\b/i.test(String(text || ""));
}

function guideExtrasAddedReply(optionName) {
  return interpolateReplyText(
    getEffectiveLanguage() === "es"
      ? "Agregado {{optionName}}. ¿Eso es todo para extras? Di listo para completar."
      : "Got {{optionName}}. Is that all for extras? Say done to complete.",
    { optionName }
  );
}

function hasGuideRemovalIntent(text) {
  return /\b(remove|delete|take\s+off|take\s+out|cancel|undo|quita|quitar|quitale|qu[ií]tale|borra|borrar|elimina|eliminar|no\s+quiero|ya\s+no\s+quiero|sin)\b/i.test(String(text || ""));
}

function phraseAppears(text, phrase) {
  const query = normalizeLooseOptionKey(text);
  const key = normalizeLooseOptionKey(phrase);
  if (!query || !key) return false;
  const pattern = new RegExp(`(^|\\s)${escapeRegex(key).replace(/\s+/g, "\\s+")}(\\s|$)`, "i");
  return pattern.test(query);
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasExplicitExtrasIntent(text) {
  return /\b(extra|extras|side|2oz|5oz|cup|vasito|separate|separad[ao]s?|aparte|add extra|agrega extra|no extras?|sin extras?|no gracias|none|skip)\b/i.test(String(text || "")) ||
    hasLimonIntent(text);
}

function hasGenericExtrasIntent(text) {
  const query = normalizeLooseOptionKey(text);
  if (!/\b(extra|extras|un extra|an extra|add extra|agrega extra|quiero extra)\b/i.test(query)) return false;
  return !/\b(crema|sour cream|queso|cheese|limon|lime|guacamole|asada|tomato|tomate|verde|roja|hot|mild|medium|cebolla|onion|chiles?|5oz|2oz|cup|vasito|no extras?|sin extras?|no gracias|none)\b/i.test(query);
}

function hasGenericExtraSalsaIntent(text) {
  const query = normalizeLooseOptionKey(text);
  if (!/\b(extra|extras|add extra|agrega extra|quiero extra|dame extra)\b/i.test(query) || !/\bsalsa\b/i.test(query)) return false;
  return !/\b(guacamole|asada|tomato|tomate|verde|roja|red|hot|mild|medium)\b/i.test(query);
}

function hasLimonIntent(text) {
  return /\b(limon|lime|lemon)\b/i.test(normalizeLooseOptionKey(text));
}

function hasHalfLimonIntent(text) {
  const query = normalizeLooseOptionKey(text);
  return hasLimonIntent(text) && /\b(half|medio|media|mitad)\b/i.test(query);
}

function hasFullLimonIntent(text) {
  const query = normalizeLooseOptionKey(text);
  return hasLimonIntent(text) && /\b(full|whole|entero|entera|completo|completa)\b/i.test(query);
}

function guideOptionIsLimon(option) {
  return /\b(limon|lime|lemon)\b/i.test(normalizeLooseOptionKey(guideOptionName(option)));
}

function guideOptionIsHalfLimon(option) {
  const key = normalizeLooseOptionKey(guideOptionName(option));
  return /\bhalf\b/i.test(key) && /\b(limon|lime|lemon)\b/i.test(key);
}

function guideOptionIsFullLimon(option) {
  const key = normalizeLooseOptionKey(guideOptionName(option));
  return /\bfull\b/i.test(key) && /\b(limon|lime|lemon)\b/i.test(key);
}

function guideStepHasHalfAndFullLimon(step) {
  const options = Array.isArray(step?.options) ? step.options : [];
  return options.some(guideOptionIsHalfLimon) && options.some(guideOptionIsFullLimon);
}

function shouldAskLimonSize(step, text) {
  return step?.kind === "extras" &&
    guideStepHasHalfAndFullLimon(step) &&
    hasLimonIntent(text) &&
    !hasHalfLimonIntent(text) &&
    !hasFullLimonIntent(text);
}

function guideOptionMentionNegated(query, index) {
  const before = query.slice(Math.max(0, index - 40), index).trim();
  return /(?:^|\s)(?:no|sin|without|not)(?:\s+(?:quiero|deseo|want|extra|salsa|agua))*\s*$/.test(before);
}

function guideQueryHasPositiveTerm(query, terms) {
  return terms.some((term) => {
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
    let match = null;
    while ((match = regex.exec(query))) {
      if (!guideOptionMentionNegated(query, match.index)) return true;
    }
    return false;
  });
}

function guideOptionOnlyNegated(text, option) {
  const query = normalizeLooseOptionKey(text);
  if (!query) return false;
  const aliases = new Set([
    ...guideOptionAliases(option),
    ...buildModifierOptionAliases(guideOptionName(option))
  ]);
  let hasNegated = false;
  let hasPositive = false;
  for (const alias of [...aliases].map(normalizeLooseOptionKey).sort((a, b) => b.length - a.length)) {
    if (!alias || /^(extra|side|salsa|oz|2oz|4oz|5oz)$/.test(alias)) continue;
    const regex = new RegExp(`\\b${escapeRegex(alias).replace(/\s+/g, "\\s+")}\\b`, "gi");
    let match = null;
    while ((match = regex.exec(query))) {
      if (guideOptionMentionNegated(query, match.index)) {
        hasNegated = true;
      } else {
        hasPositive = true;
      }
    }
  }
  return hasNegated && !hasPositive;
}

function guideOptionAllowedForText(step, option, text) {
  const query = normalizeLooseOptionKey(text);
  const nameKey = normalizeLooseOptionKey(guideOptionName(option));
  const aliases = guideOptionAliases(option).map(normalizeLooseOptionKey).join(" ");
  const haystack = `${nameKey} ${aliases}`;

  if (step?.kind === "meat") {
    const asksRajas = /\b(rajas|raja|papas\s+con\s+ra(?:j(?:a(?:s)?)?)?|rajas\s+con\s+papas|raja\s+con\s+papas|poblano)\b/i.test(query);
    const asksNopales = /\b(nopal|nopales|cactus|cacti)\b/i.test(query);
    if (asksRajas && !asksNopales) return /\brajas\b|\bpoblano\b/.test(haystack);
    if (asksNopales && !asksRajas) return /\bnopales?\b|\bcactus\b|\bcacti\b/.test(haystack);
  }

  if (step?.kind === "extras") {
    if (guideOptionValue(option) !== "none" && guideOptionOnlyNegated(query, option)) return false;

    const asksQuesoFresco = /\b(queso\s+fresco|fresco\s+cheese|fresh\s+cheese)\b/i.test(query);
    const asksQuesoDip = /\b(queso\s+dip|dip\s+de\s+queso|cheese\s+dip)\b/i.test(query);
    if (asksQuesoFresco && !asksQuesoDip && /\bqueso\s+dip\b/i.test(nameKey)) return false;
    if (asksQuesoDip && !asksQuesoFresco && /\bqueso\s+fresco\b|\bfresco\s+cheese\b/i.test(nameKey)) return false;

    if (hasLimonIntent(query) && guideOptionIsLimon(option)) {
      const wantsHalf = hasHalfLimonIntent(query);
      const wantsFull = hasFullLimonIntent(query);
      if (wantsHalf && !wantsFull) return guideOptionIsHalfLimon(option);
      if (wantsFull && !wantsHalf) return guideOptionIsFullLimon(option);
      if (guideStepHasHalfAndFullLimon(step)) return false;
    }

    const asksGuacamoleSalsa = guideQueryHasPositiveTerm(query, ["guacamole"]);
    const asksAsadaSalsa = guideQueryHasPositiveTerm(query, ["asada", "mild"]);
    const asksTomatoSalsa = guideQueryHasPositiveTerm(query, ["tomato", "tomate"]);
    const asksVerdeSalsa = guideQueryHasPositiveTerm(query, ["verde", "medium"]);
    const asksRojaSalsa = guideQueryHasPositiveTerm(query, ["roja", "red", "hot"]);
    const salsaIntentCount = [asksGuacamoleSalsa, asksAsadaSalsa, asksTomatoSalsa, asksVerdeSalsa, asksRojaSalsa].filter(Boolean).length;
    if (salsaIntentCount === 0 && /\bsalsa\b/i.test(query) && /\bsalsa\b/i.test(nameKey)) {
      return false;
    }
    if (salsaIntentCount === 1) {
      if (asksGuacamoleSalsa) return /\bguacamole\s+salsa\b/i.test(nameKey);
      if (asksAsadaSalsa) return /\basada\b/i.test(nameKey) && /\bsalsa\b/i.test(nameKey);
      if (asksTomatoSalsa) return /\btomato\b/i.test(nameKey) && /\bsalsa\b/i.test(nameKey);
      if (asksVerdeSalsa) return /\bverde\b/i.test(nameKey) && /\bsalsa\b/i.test(nameKey);
      if (asksRojaSalsa) return /\broja\b/i.test(nameKey) && /\bsalsa\b/i.test(nameKey);
    }
  }

  if (step?.kind === "salsa" && guideOptionValue(option) !== "none" && guideOptionOnlyNegated(query, option)) {
    return false;
  }

  return true;
}

function guideOptionScore(step, option, text, { initial = false } = {}) {
  const raw = String(text || "");
  const query = normalizeLooseOptionKey(raw);
  if (!query) return 0;

  if (!guideOptionAllowedForText(step, option, raw)) {
    return 0;
  }

  const name = guideOptionName(option);
  const nameKey = normalizeLooseOptionKey(name);
  const aliases = guideOptionAliases(option);
  const family = guideOptionFamily(option);
  const value = guideOptionValue(option);
  const haystacks = [name, ...aliases].filter(Boolean);

  if (value === "none" && !haystacks.some((alias) => phraseAppears(raw, alias))) {
    return 0;
  }

  if (value === "double" && !/\b(double|doble)\b/i.test(query) && !haystacks.some((alias) => phraseAppears(raw, alias))) {
    return 0;
  }

	  if ((step?.key === "taco-shell" || step?.key === "quesadilla-shell") && !/\b(street|taquer[ao]|flour|harina|comal|homemade|corn|maiz|ma[ií]z)\b/i.test(query)) {
	    return 0;
	  }

	  if (step?.key === "burrito-size" && /\b(grande|large|12|twelve)\b/i.test(query) && !/\b(grande|12)\b/i.test(nameKey)) {
	    return 0;
	  }

	  if (step?.key === "burrito-options") {
	    if (family === "queso-dip" && !/\b(queso\s+dip|dip\s+de\s+queso|cheese\s+dip|extra\s+queso\s+dip|double\s+queso\s+dip|doble\s+queso\s+dip)\b/i.test(query)) {
	      return 0;
	    }
	    if ((family === "queso-dip" || family === "guacamole-dip") && !/\b(inside|inside\s+the\s+burrito|in\s+the\s+burrito|dentro|adentro)\b/i.test(query)) {
	      return 0;
	    }
	    if (family === "cheese" && /\b(queso\s+dip|dip\s+de\s+queso)\b/i.test(query) && !/\b(cheese|queso\s+fresco)\b/i.test(query)) {
	      return 0;
	    }
	    if ((family === "queso-dip" || family === "guacamole-dip") && /\b(chips?|side)\b/i.test(query)) {
	      return 0;
	    }
	  }

	  if (initial && /^2\s*x\s*(gorditas|tortas)$/i.test(name) && /\bcombo\b/i.test(query) && !/\b(regular|plain|no queso|without queso|sin queso)\b/i.test(query)) {
	    return 0;
	  }

  if (step?.kind === "salsa" && value !== "none" && /\b(no salsa|without salsa|sin salsa)\b/i.test(query)) {
    return 0;
  }

  let score = 0;
  for (const alias of haystacks) {
    if (phraseAppears(raw, alias)) {
      score = Math.max(score, 140 + normalizeLooseOptionKey(alias).length);
    }
  }

  if (family && value === "normal" && phraseAppears(raw, family.replace(/-/g, " "))) {
    score = Math.max(score, 120);
  }

  if (nameKey && (query === nameKey || query.includes(nameKey) || nameKey.includes(query))) {
    score = Math.max(score, query === nameKey ? 130 : 85);
  }

	  score = Math.max(score, scoreModifierOptionMatch(name, raw));

	  if (step?.kind === "side") {
	    if (/\b(queso\s+dip|dip\s+de\s+queso)\b/i.test(query) && /\bqueso\s+dip\b/i.test(nameKey)) score += 220;
	    if (/\b((guacamole|guac)\s+dip|dip\s+de\s+guacamole)\b/i.test(query) && /\bguacamole\s+dip\b/i.test(nameKey)) score += 220;
	    if (/\bpico\b/i.test(query) && /\bpico\b/i.test(nameKey)) score += 220;
	    if (/\b(solo\s+frijol(?:e|es)?|frijol(?:e|es)?\s+solo|only\s+beans|beans\s+only)\b/i.test(query) && /\bsolo\s+frijol(?:e|es)?\b/i.test(nameKey)) score += 280;
	    if (/\bsolo\s+arroz|arroz\s+solo|only\s+rice|rice\s+only\b/i.test(query) && /\bsolo\s+arroz\b/i.test(nameKey)) score += 280;
	    if (/\b(arroz|rice)\b/i.test(query) && /\b(frijol|frijoles|beans?)\b/i.test(query) && /\barroz\b/i.test(nameKey) && /\bfrijoles\b/i.test(nameKey)) score += 280;
	  }

	  if (step?.kind === "meat") {
	    if (/\b(rajas|raja|papas\s+con\s+ra(?:j(?:a(?:s)?)?)?|rajas\s+con\s+papas|raja\s+con\s+papas)\b/i.test(query) && /\brajas\b/i.test(nameKey)) score += 420;
	    if (/\b(rajas|raja|papas\s+con\s+ra(?:j(?:a(?:s)?)?)?|rajas\s+con\s+papas|raja\s+con\s+papas)\b/i.test(query) && /\bnopales\b/i.test(nameKey) && !/\bnopales\b/i.test(query)) return 0;
	    if (/\bnopales?\b/i.test(query) && /\bnopales\b/i.test(nameKey)) score += 300;
	    if (/\b(papas\s+con\s+ra(?:j(?:a(?:s)?)?)?|rajas\s+con\s+papas|raja\s+con\s+papas)\b/i.test(query) && /\bpapas\s+con\s+rajas\b/i.test(nameKey)) score += 480;
	  }

	  if (step?.kind === "salsa") {
	    if (guideQueryHasPositiveTerm(query, ["tomato", "tomate"]) && /\btomato\b/i.test(nameKey)) score += 280;
	    if (guideQueryHasPositiveTerm(query, ["asada"]) && /\basada\b/i.test(nameKey)) score += 260;
	    if (guideQueryHasPositiveTerm(query, ["verde"]) && /\bverde\b/i.test(nameKey)) score += 260;
	    if (guideQueryHasPositiveTerm(query, ["roja", "red"]) && /\broja\b/i.test(nameKey)) score += 260;
	    if (guideQueryHasPositiveTerm(query, ["hot"]) && /\bhot\b/i.test(nameKey)) score += 140;
	    if (guideQueryHasPositiveTerm(query, ["medium"]) && /\bmedium\b/i.test(nameKey)) score += 140;
	    if (guideQueryHasPositiveTerm(query, ["mild"]) && /\bmild\b/i.test(nameKey)) score += 90;
	  }

	  if (step?.key === "burrito-options" && family === "beans" && /\b(frijol|frijoles|beans?)\b/i.test(query)) {
	    score += value === "double" && /\b(double|extra|doble)\b/i.test(query) ? 240 : 180;
	  }

	  if (step?.key === "regular-deluxe" && value === "normal" && /\b(deluxe|de\s+lujo|preparad[ao])\b/i.test(query)) {
	    score += 260;
	  }

	  if (step?.kind === "extras") {
	    if (hasLimonIntent(query) && guideOptionIsLimon(option)) {
	      const wantsHalf = hasHalfLimonIntent(query);
	      const wantsFull = hasFullLimonIntent(query);
	      if (wantsHalf && guideOptionIsHalfLimon(option)) score += 420;
	      if (wantsFull && guideOptionIsFullLimon(option)) score += 420;
	      if (!wantsHalf && !wantsFull && !guideStepHasHalfAndFullLimon(step)) score += 260;
	    }
	    if (guideQueryHasPositiveTerm(query, ["guacamole"]) && /\bguacamole\s+salsa\b/i.test(nameKey)) score += 360;
	    if (guideQueryHasPositiveTerm(query, ["asada"]) && /\basada\b/i.test(nameKey)) score += 320;
	    if (guideQueryHasPositiveTerm(query, ["tomato", "tomate"]) && /\btomato\b/i.test(nameKey)) score += 320;
	    if (guideQueryHasPositiveTerm(query, ["verde"]) && /\bverde\b/i.test(nameKey)) score += 320;
	    if (guideQueryHasPositiveTerm(query, ["roja"]) && /\broja\b/i.test(nameKey)) score += 320;
	  }

	  if (step?.kind === "extras" && !hasExplicitExtrasIntent(raw)) {
	    return 0;
	  }

  return score;
}

function findGuideOptions(step, text, matchOptions = {}) {
  const stepOptions = Array.isArray(step?.options) ? step.options : [];
  if (!stepOptions.length) return [];
  if (step?.kind === "extras" && /\b(no\s+extras?|sin\s+extras?|without\s+extras?|no\s+thanks|no\s+gracias|none|skip|saltar)\b/i.test(String(text || ""))) {
    const noneOption = stepOptions.find((option) => guideOptionValue(option) === "none" || /\bno\s+extras?\b/i.test(guideOptionName(option)));
    return noneOption ? [noneOption] : [];
  }
  const max = isGuideMultiStep(step) ? guideStepMaxSelections(step) : 1;
  const scored = stepOptions
    .filter((option) => guideOptionAllowedForText(step, option, text))
    .map((option) => ({
      option,
      family: guideOptionFamily(option),
      score: guideOptionScore(step, option, text, matchOptions)
    }))
    .filter((entry) => entry.score >= 70)
    .sort((a, b) => b.score - a.score);

  const chosen = [];
  const families = new Set();
  for (const entry of scored) {
    if (entry.family && families.has(entry.family)) continue;
    chosen.push(entry.option);
    if (entry.family) families.add(entry.family);
    if (chosen.length >= max) break;
  }

  if (step?.supportsOnly && hasOnlyIntent(text)) {
    const presentFamilies = new Set(chosen.map(guideOptionFamily).filter(Boolean));
    const allFamilies = new Set(stepOptions.map(guideOptionFamily).filter(Boolean));
    for (const family of allFamilies) {
      if (presentFamilies.has(family)) continue;
      const noneOption = stepOptions.find((option) => guideOptionFamily(option) === family && guideOptionValue(option) === "none");
      if (noneOption) chosen.push(noneOption);
    }
  }

  return chosen.slice(0, max === Infinity ? chosen.length : max);
}

function findGuideOption(step, text) {
  return findGuideOptions(step, text)[0] || null;
}

function guideOptionName(option) {
  return typeof option === "object" && option !== null ? String(option.name || "") : String(option || "");
}

function guideOptionPriceDeltaCents(option) {
  if (!option || typeof option !== "object") return 0;
  return extractOptionCostCents(option.price_note || option.name || "");
}

function guideOptionCode(option) {
  return typeof option === "object" && option !== null ? String(option.code || "").trim() : "";
}

function guideSelectionMatches(selection, stepNumber, option) {
  return selection.step === stepNumber &&
    normalizeOptionKey(selection.option) === normalizeOptionKey(guideOptionName(option));
}

function addGuideSelection(stepIndex, step, option) {
  const stepNumber = guideStepNumber(step, stepIndex);
  const optionName = guideOptionName(option);
  if (!optionName) return false;

  const family = guideOptionFamily(option);
  const isMulti = isGuideMultiStep(step);
  const max = guideStepMaxSelections(step);
  const existing = state.currentBuildSelections || [];
  if (existing.some((selection) => guideSelectionMatches(selection, stepNumber, option))) {
    // Re-tapping / re-saying an option that is already picked is fine: keep it, don't reject.
    return true;
  }

  let nextSelections = existing;
  if (!isMulti) {
    nextSelections = existing.filter((selection) => selection.step !== stepNumber);
  } else if (family) {
    nextSelections = existing.filter((selection) => !(selection.step === stepNumber && selection.family === family));
  }

  const currentCount = nextSelections.filter((selection) => selection.step === stepNumber).length;
  if (isMulti && max !== Infinity && currentCount >= max) return false;

  state.currentBuildSelections = [
    ...nextSelections,
    {
      step: stepNumber,
      stepKey: String(step.key || ""),
      stepKind: String(step.kind || ""),
      stepTitle: step.title || `Step ${stepNumber}`,
      option: optionName,
      code: guideOptionCode(option),
      family,
      value: guideOptionValue(option),
      priceDeltaCents: guideOptionPriceDeltaCents(option)
    }
  ];
  return true;
}

function guideRemovalFamilyFromText(text) {
  const query = normalizeLooseOptionKey(text);
  if (/\b(queso\s+dip|dip\s+de\s+queso|cheese\s+dip)\b/i.test(query)) return "queso-dip";
  if (/\b(guacamole\s+dip|dip\s+de\s+guacamole|guac\s+dip)\b/i.test(query)) return "guacamole-dip";
  if (/\b(frijol|frijoles|beans?)\b/i.test(query)) return "beans";
  if (/\b(arroz|rice)\b/i.test(query)) return "rice";
  if (/\b(queso\s+fresco|cheese|queso)\b/i.test(query)) return "cheese";
  if (/\b(crema|sour\s+cream)\b/i.test(query)) return "crema";
  if (/\b(cebolla|onion)\b/i.test(query)) return "onion";
  if (/\b(cilantro)\b/i.test(query)) return "cilantro";
  if (/\b(salsa)\b/i.test(query)) return "salsa";
  if (/\b(deluxe|de\s+lujo)\b/i.test(query)) return "deluxe";
  return "";
}

function guideSelectionRemovalScore(selection, text) {
  const query = normalizeLooseOptionKey(text);
  const option = normalizeLooseOptionKey(selection?.option || "");
  const family = String(selection?.family || "");
  const wantedFamily = guideRemovalFamilyFromText(text);
  if (wantedFamily && family === wantedFamily) return 200;
  if (option && (query.includes(option) || option.includes(query))) return 120;
  if (family && query.includes(family.replace(/-/g, " "))) return 100;
  return 0;
}

function removeGuideSelectionsFromText(text) {
  if (!state.currentBuildGuide || !hasGuideRemovalIntent(text)) return [];
  const selections = Array.isArray(state.currentBuildSelections) ? state.currentBuildSelections : [];
  if (!selections.length) return [];
  const currentStep = getCurrentGuideStep();
  const currentStepNumber = currentStep ? guideStepNumber(currentStep, Math.max(0, state.currentGuideStep - 1)) : 0;
  const scored = selections
    .map((selection, index) => ({
      selection,
      index,
      score: guideSelectionRemovalScore(selection, text)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      const currentBias = Number(b.selection.step === currentStepNumber) - Number(a.selection.step === currentStepNumber);
      return currentBias || b.score - a.score;
    });
  if (!scored.length) return [];

  const best = scored[0];
  const removed = selections.filter((selection) => (
    guideSelectionRemovalScore(selection, text) === best.score &&
    (!best.selection.family || selection.family === best.selection.family)
  ));
  const removedSet = new Set(removed);
  state.currentBuildSelections = selections.filter((selection) => !removedSet.has(selection));
  return removed;
}

/** Which salsa options the caller named (by alias). Used so "verde hot" or "con salsa" asks instead of guessing. */
function guideSalsasNamed(step, raw) {
  const said = ` ${normalizeOptionKey(raw)} `;
  return (step?.options || []).filter((option) =>
    [...guideOptionAliases(option), option.label || ""].map(normalizeOptionKey).filter((a) => a.length >= 3)
      .some((alias) => said.includes(` ${alias} `))
  ).map(guideOptionName);
}

function applyGuideSelectionsForStep(stepIndex, text, matchOptions = {}) {
  const step = state.currentBuildGuide?.steps?.[stepIndex];
  if (!step) return [];
  if (step.kind === "salsa" && !/\b(sin salsa|no salsa)\b/i.test(String(text || "")) && guideSalsasNamed(step, text).length !== 1) return [];
  if (!step.required && hasSkipIntent(text)) return [];
  const options = findGuideOptions(step, text, matchOptions);
  const added = [];
  for (const option of options) {
    if (addGuideSelection(stepIndex, step, option)) {
      added.push(option);
    }
  }
  return added;
}

function isGuideMeatStep(step) {
  return step?.kind === "meat" ||
    /\bmeat\b/i.test(String(step?.key || "")) ||
    /\bmeat\b/i.test(String(step?.title || ""));
}

function guideConsecutiveOpenMeatStepIndexesFrom(startIndex) {
  const guide = state.currentBuildGuide;
  if (!guide?.steps?.length) return [];
  const indexes = [];
  for (let index = startIndex; index < guide.steps.length; index += 1) {
    const step = guide.steps[index];
    if (!isGuideMeatStep(step)) break;
    if (!guideStepIsComplete(step, index)) indexes.push(index);
  }
  return indexes;
}

function guideMeatOptionAliases(option) {
  const name = guideOptionName(option);
  const aliases = new Set([
    name,
    ...guideOptionAliases(option),
    ...buildModifierOptionAliases(name)
  ]);
  const key = normalizeLooseOptionKey(name);
  if (/\bcarnitas\b/.test(key)) aliases.add("carnita");
  if (/\bbistec\b/.test(key)) aliases.add("bisteces");
  if (/\balpastor\b/.test(key)) {
    aliases.add("alpastor");
    aliases.add("al pastor");
    aliases.add("pastor");
  }
  return [...aliases]
    .map(normalizeLooseOptionKey)
    .filter((alias, index, all) => alias.length > 2 && all.indexOf(alias) === index)
    .sort((a, b) => b.length - a.length);
}

function guideAliasPattern(alias) {
  const pattern = escapeRegExp(alias).replace(/\s+/g, "\\s+");
  if (/^[a-z0-9]+$/.test(alias) && alias.length > 3 && !alias.endsWith("s")) {
    return `${pattern}(?:s|es)?`;
  }
  return pattern;
}

function findCountedGuideMeatMentions(step, text) {
  const query = normalizeLooseOptionKey(text);
  const quantity = quantityPattern();
  const mentions = [];
  const seen = new Map();
  for (const option of step?.options || []) {
    for (const alias of guideMeatOptionAliases(option)) {
      const regex = new RegExp(`\\b(${quantity})\\s+(?:x\\s+)?(?:de\\s+)?${guideAliasPattern(alias)}\\b`, "gi");
      let match;
      while ((match = regex.exec(query))) {
        const parsed = parseQuantityToken(match[1]);
        if (!parsed) continue;
        const entry = { option, quantity: parsed, index: match.index, score: alias.length };
        const key = `${match.index}:${parsed}`;
        const current = seen.get(key);
        if (!current || entry.score > current.score) seen.set(key, entry);
      }
    }
  }
  mentions.push(...seen.values());
  return mentions.sort((a, b) => a.index - b.index || b.score - a.score);
}

function findAllGuideMeatMention(step, text) {
  const query = normalizeLooseOptionKey(text);
  const allPattern = "\\b(?:all|both|every|todo|todos|todas|puro|pura|los\\s+dos|las\\s+dos)\\b";
  return findGuideMeatMention(step, query, (aliasPattern) => (
    new RegExp(`${allPattern}\\s+(?:de\\s+)?${aliasPattern}\\b|\\b${aliasPattern}\\s+${allPattern}`, "i")
  ));
}

function findRemainingGuideMeatMention(step, text) {
  const query = normalizeLooseOptionKey(text);
  const restPattern = "(?:el\\s+)?resto|(?:los\\s+)?demas|lo\\s+demas|sobrantes?|remaining|remainder|(?:the\\s+)?rest";
  return findGuideMeatMention(step, query, (aliasPattern) => (
    new RegExp(`\\b(?:${restPattern})(?:\\s+(?:de|of))?\\s+${aliasPattern}\\b|\\b${aliasPattern}\\s+(?:para\\s+)?(?:${restPattern})\\b`, "i")
  ));
}

function findGuideMeatMention(step, query, buildRegex) {
  const matches = (step?.options || [])
    .map((option) => {
      let best = -1;
      let score = 0;
      for (const alias of guideMeatOptionAliases(option)) {
        const match = query.match(buildRegex(guideAliasPattern(alias)));
        if (match?.index !== undefined && (best < 0 || match.index < best || (match.index === best && alias.length > score))) {
          best = match.index;
          score = alias.length;
        }
      }
      return best >= 0 ? { option, index: best, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index || b.score - a.score);
  return matches[0] || null;
}

function guideSearchAliases(option) {
  const name = guideOptionName(option);
  const aliases = new Set([
    name,
    ...guideOptionAliases(option),
    ...buildModifierOptionAliases(name)
  ]);
  return [...aliases]
    .map(normalizeLooseOptionKey)
    .filter((alias, index, all) => alias.length > 2 && all.indexOf(alias) === index)
    .sort((a, b) => b.length - a.length);
}

function findGuideOptionMentionAfter(step, text, startIndex = 0, matchOptions = {}) {
  const query = normalizeLooseOptionKey(text);
  const matches = (step?.options || [])
    .filter((option) => guideOptionAllowedForText(step, option, text))
    .map((option) => {
      let bestIndex = -1;
      let bestScore = 0;
      let bestLength = 0;
      for (const alias of guideSearchAliases(option)) {
        const regex = new RegExp(`(^|\\s)${guideAliasPattern(alias)}(\\s|$)`, "gi");
        let match;
        while ((match = regex.exec(query))) {
          const index = match.index + (match[1] ? match[1].length : 0);
          if (index < startIndex) continue;
          const score = guideOptionScore(step, option, text, matchOptions) + alias.length;
          if (bestIndex < 0 || index < bestIndex || (index === bestIndex && score > bestScore)) {
            bestIndex = index;
            bestScore = score;
            bestLength = alias.length;
          }
        }
      }
      return bestIndex >= 0 ? { option, index: bestIndex, endIndex: bestIndex + bestLength, score: bestScore } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index || b.score - a.score);
  return matches[0] || null;
}

function applyGuideMeatDistributionFromText(stepIndex, text) {
  const step = state.currentBuildGuide?.steps?.[stepIndex];
  if (!isGuideMeatStep(step)) return [];
  const targetIndexes = guideConsecutiveOpenMeatStepIndexesFrom(stepIndex);
  if (!targetIndexes.length) return [];

  const added = [];
  const applyToNextMeatSteps = (option, quantity) => {
    let remaining = Math.max(1, Number(quantity) || 1);
    for (const targetIndex of targetIndexes) {
      if (remaining <= 0) break;
      const targetStep = state.currentBuildGuide?.steps?.[targetIndex];
      if (!targetStep || guideStepIsComplete(targetStep, targetIndex)) continue;
      if (addGuideSelection(targetIndex, targetStep, option)) {
        added.push(option);
        remaining -= 1;
      }
    }
  };

  const allMatch = findAllGuideMeatMention(step, text);
  if (allMatch) {
    applyToNextMeatSteps(allMatch.option, targetIndexes.length);
    return added;
  }

  const counted = findCountedGuideMeatMentions(step, text);
  if (counted.length) {
    for (const mention of counted) {
      applyToNextMeatSteps(mention.option, mention.quantity);
    }
    const remaining = findRemainingGuideMeatMention(step, text);
    if (remaining) applyToNextMeatSteps(remaining.option, targetIndexes.length);
    return added;
  }

  // fix10: "pastor y asada" → one each, in order; one meat word fills one item unless "los dos / both".
  const mentions = [];
  let cursor = 0;
  for (let guard = 0; guard < 8; guard += 1) {
    const m = findGuideOptionMentionAfter(step, text, cursor, { initial: true });
    if (!m) break;
    cursor = m.endIndex;
    if (!mentions.some((x) => x.option === m.option)) mentions.push(m);
  }
  if (mentions.length >= 2) {
    for (const m of mentions) applyToNextMeatSteps(m.option, 1);
    return added;
  }
  const remaining = findRemainingGuideMeatMention(step, text);
  if (remaining) {
    const both = /\b(both|los dos|las dos|ambos|ambas|todos|todas|all)\b/i.test(text);
    applyToNextMeatSteps(remaining.option, both ? targetIndexes.length : 1);
  }
  return added;
}

function prefillComboMixSelectionsFromText(text) {
  const guide = state.currentBuildGuide;
  if (!guide || !/^COMBO Mix$/i.test(String(guide.display_name || ""))) {
    return { added: [], nextIndex: 0 };
  }
  const added = [];
  // fix10: "a steak taco and a chicken street taco" / "un taco de asada y una gordita de chicharron":
  // each part names one item and its meat, in any order.
  const loose = normalizeLooseOptionKey(text).replace(/\b(combo mix|mix combo|combo de mix)\b/, " ");
  const segments = loose.split(/\s(?:and|y|plus|mas)\s/).filter((seg) => guide.steps[0] && findGuideOptionMentionAfter(guide.steps[0], seg, 0, { initial: true }));
  if (segments.length && guide.steps.length >= 4) {
    segments.slice(0, 2).forEach((seg, n) => {
      const optIndex = n * 2;
      const optStep = guide.steps[optIndex];
      const meatStep = guide.steps[optIndex + 1];
      const item = findGuideOptionMentionAfter(optStep, seg, 0, { initial: true });
      if (item && !guideStepIsComplete(optStep, optIndex) && addGuideSelection(optIndex, optStep, item.option)) added.push(item.option);
      const meat = meatStep && findGuideOptionMentionAfter(meatStep, seg, 0, { initial: true });
      if (meat && !guideStepIsComplete(meatStep, optIndex + 1) && addGuideSelection(optIndex + 1, meatStep, meat.option)) added.push(meat.option);
    });
    const next = guide.steps.findIndex((step, index) => !guideStepIsComplete(step, index));
    return { added, nextIndex: next >= 0 ? Math.min(next, 4) : guide.steps.length };
  }
  let cursor = Math.max(0, normalizeLooseOptionKey(text).indexOf("combo mix"));
  for (const index of [0, 1, 2, 3]) {
    const step = guide.steps[index];
    if (!step || guideStepIsComplete(step, index)) continue;
    const match = findGuideOptionMentionAfter(step, text, cursor, { initial: true });
    if (!match) break;
    if (addGuideSelection(index, step, match.option)) {
      added.push(match.option);
      cursor = match.endIndex;
    }
  }
  const nextIncomplete = guide.steps.findIndex((step, index) => !guideStepIsComplete(step, index));
  return {
    added,
    nextIndex: nextIncomplete >= 0 ? nextIncomplete : guide.steps.length
  };
}

function applyMentionedOptionalGuideSelections(text, matchOptions = {}) {
  const guide = state.currentBuildGuide;
  if (!guide?.steps?.length || hasSkipIntent(text)) return [];
  const raw = String(text || "");
  const added = [];
  guide.steps.forEach((step, index) => {
    if (step.required !== false) return;
    // "asada" alone means carne asada, so a salsa needs a salsa word ("salsa asada", "verde", "roja", "mild"...).
    if (step.kind === "salsa" && !/\b(salsa|verde|roja|mild|medium|hot|picante|no salsa|sin salsa)\b/i.test(raw)) return;
    if (step.kind === "salsa") {
      // Salsa is optional like the website: add it only when one salsa is named.
      // "con salsa" or two different salsas -> make the step a question for this build.
      if (/\b(sin salsa|no salsa)\b/i.test(raw)) return;
      const distinct = guideSalsasNamed(step, raw);
      if (distinct.length !== 1) {
        if (/\bsalsas?\b/i.test(raw)) { step.required = true; step.min_selections = 1; }
        return;
      }
    }
    if (step.kind === "extras" && !hasExplicitExtrasIntent(raw)) return;
    // "pico" / "con todo" are not Deluxe; Deluxe needs its own word.
    if (step.kind === "regularDeluxe" && !/\b(deluxe|de lujo|preparad[oa]s?)\b/i.test(raw)) return;
    added.push(...applyGuideSelectionsForStep(index, text, matchOptions));
  });
  return added;
}

function guideStepIsComplete(step, index) {
  // ui4: suggested (preselect) and offered (optional) steps are asked too, in website order;
  // done once the customer picked something or answered ("sí", "no", "así está bien").
  if (step && (step.mode === "suggest" || step.mode === "offer")) {
    const n = guideStepNumber(step, index);
    return (state.currentBuildSelections || []).some((sel) => sel.step === n) || Boolean(state.currentBuildGuide?._resolved?.has(n));
  }
  if (!step || step.required === false) return true;
  const stepNumber = guideStepNumber(step, index);
  const required = guideStepMinSelections(step);
  if (required <= 0) return true;
  const count = (state.currentBuildSelections || []).filter((selection) => selection.step === stepNumber).length;
  return count >= required;
}

function advanceGuideToNextRequiredStep() {
  const guide = state.currentBuildGuide;
  if (!guide?.steps?.length) return false;
  const index = guide.steps.findIndex((step, i) => !guideStepIsComplete(step, i));
  if (index >= 0) {
    state.currentGuideStep = index + 1;
    return true;
  }
  state.currentGuideStep = guide.steps.length + 1;
  return false;
}

function guideCurrentPrompt() {
  const step = getCurrentGuideStep();
  if (!step) {
    return getEffectiveLanguage() === "es"
      ? `${guideReadbackText()}. ¿Lo agrego, o cambias algo?`
      : `${guideReadbackText()}. Add it, or change something?`;
  }
  return guideCustomerPrompt(step);
}

function guideCustomerPrompt(step) {
  const lang = getEffectiveLanguage();
  { const ask = step && step[lang === "es" ? "ask_es" : "ask_en"]; if (ask) return ask; }
  const title = String(step?.title || step?.label || "").trim();
  const key = String(step?.key || "").trim();
  const lowerTitle = title.toLowerCase();

  if (lang === "es") {
    if (key === "item-1-option") return "¿Qué es el primero: taco, quesadilla, torta o gordita?";
    if (key === "item-2-option") return "¿Y el segundo: taco, quesadilla, torta o gordita?";
    if (/first .*meat|first .*carne/i.test(title) || /^item-1-meat$/.test(key)) return "¿Qué carne para el primero?";
    if (/second .*meat|second .*carne/i.test(title) || /^item-2-meat$/.test(key)) return "¿Qué carne para el segundo?";
    if (key === "burrito-meat") return "¿Qué carne o relleno para el burrito?";
    if (key === "burrito-size") return "¿Regular de 10 pulgadas o grande de 12?";
    if (key === "burrito-options") return "¿Qué lleva adentro? Puedes decir con todo: frijoles, arroz, queso, crema, cebolla y cilantro.";
    if (key === "burrito-side") return "¿Qué dip con los chips: pico de gallo, guacamole o queso (+$1)?";
    if (key === "regular-deluxe") return "¿Regular o deluxe?";
    if (key === "salsa") return "¿Qué salsa prefieres, o sin salsa?";
    if (key === "extras") return "¿Algún extra, o sin extras?";
    if (/side/.test(lowerTitle)) return "¿Qué acompañamiento quieres?";
    if (/tortilla/.test(lowerTitle)) return "¿Qué tortilla prefieres?";
    if (/option|item/.test(lowerTitle)) return "¿Cuál opción quieres?";
    return title ? `Elige ${title}.` : "Elige una opción.";
  }

  if (key === "item-1-option") return "What's the first item: taco, quesadilla, torta or gordita?";
  if (key === "item-2-option") return "And the second: taco, quesadilla, torta or gordita?";
  if (/first .*meat/i.test(title) || /^item-1-meat$/.test(key)) return "What meat for the first one?";
  if (/second .*meat/i.test(title) || /^item-2-meat$/.test(key)) return "What meat for the second one?";
  if (key === "burrito-meat") return "What meat or filling for the burrito?";
  if (key === "burrito-size") return "Regular 10 inch or grande 12 inch?";
  if (key === "burrito-options") return "What goes inside? You can say everything: beans, rice, cheese, sour cream, onion and cilantro.";
  if (key === "burrito-side") return "Which dip with chips?";
  if (key === "regular-deluxe") return "Regular or deluxe?";
  if (key === "salsa") return "Which salsa, or no salsa?";
  if (key === "extras") return "Any extras, or no extras?";
  if (/side/.test(lowerTitle)) return "Which side would you like?";
  if (/tortilla/.test(lowerTitle)) return "Which tortilla style?";
  if (/option|item/.test(lowerTitle)) return "Which option would you like?";
  return title ? `Choose ${title}.` : "Choose an option.";
}

function prefillGuideSelectionsFromText(text, opts = {}) {
  if (isMixGuide()) text = normalizeMixItemsText(text);
  const guide = state.currentBuildGuide;
  if (!guide?.steps?.length) return [];
  const added = [];
  const mixPrefill = prefillComboMixSelectionsFromText(text);
  added.push(...mixPrefill.added);
  for (let index = mixPrefill.nextIndex; index < guide.steps.length; index += 1) {
    const step = guide.steps[index];
    if (step.required === false) continue; // default/optional steps are filled by mention below
    if (isGuideMeatStep(step)) {
      added.push(...applyGuideMeatDistributionFromText(index, text));
      // After an answer, the same words don't fill the next meat too ("pastor" = one taco), fix9.
      if (!guideStepIsComplete(step, index) && !opts.afterAnswer) {
        added.push(...applyGuideSelectionsForStep(index, text, { initial: true }));
      }
      if (!guideStepIsComplete(step, index)) break;
      continue;
    }
    added.push(...applyGuideSelectionsForStep(index, text, { initial: true }));
    if (!guideStepIsComplete(step, index)) break;
  }
  added.push(...applyMentionedOptionalGuideSelections(text, { initial: true }));
  advanceGuideToNextRequiredStep();
  return added;
}

function resolveBuildItemFromSelection(selected) {
  if (!selected || typeof selected !== "object") return null;
  const id = String(selected.itemId || selected.id || "").trim();
  if (id) {
    const item = state.menu.find((candidate) => candidate.id === id);
    if (item) return item;
  }

  const guideName = state.currentBuildGuide?.display_name || selected.name || "";
  const guideKey = normalizeOptionKey(guideName);
  return state.menu.find((item) => normalizeOptionKey(item.name) === guideKey)
    || state.menu.find((item) => normalizeOptionKey(item.name).includes(guideKey) || guideKey.includes(normalizeOptionKey(item.name)))
    || menuItemFromResolverSelection(selected, id);
}

function resolveCurrentBuildItem() {
  return resolveBuildItemFromSelection(state.currentBuildItem || {});
}

function findGuideModifierGroup(item, selection) {
  const groups = Array.isArray(item?.modifierGroups) ? item.modifierGroups : [];
  const stepKey = String(selection?.stepKey || "").toLowerCase();
  const stepKind = String(selection?.stepKind || "").toLowerCase();
  const title = normalizeOptionKey(selection?.stepTitle || "");
  const hasName = (group, pattern) => pattern.test(normalizeOptionKey(group.name || ""));

  const byKey = groups.find((group) => {
    if (stepKey === "taco-shell" || stepKey === "quesadilla-shell") return hasName(group, /\b(tortilla|shell)\b/);
    if (stepKey === "item-1-option") return hasName(group, /\bitem\s*1\b.*\b(option|mix)\b/);
    if (stepKey === "item-2-option") return hasName(group, /\bitem\s*2\b.*\b(option|mix)\b/);
    if (stepKey.includes("gordita-option")) return hasName(group, /\bgorditas?\b.*\boption\b/);
    if (stepKey.includes("torta-option")) return hasName(group, /\btortas?\b.*\boption\b/);
    if (stepKey.includes("size")) return hasName(group, /\b(burrito.*size|size)\b/);
    if (stepKey === "item-1-meat") return hasName(group, /\bitem\s*1\b.*\b(carne|meat)\b/);
    if (stepKey === "item-2-meat") return hasName(group, /\b(item\s*2|cd)\b.*\b(carne|meat)\b/);
    if (stepKey.includes("meat")) return hasName(group, /\b(burrito.*(carne|meat)|(carne|meat))\b/);
    if (stepKey.includes("burrito-options")) return hasName(group, /\bburrito\s+options\b/);
    if (stepKey.includes("deluxe")) return hasName(group, /\bdeluxe\b/);
    if (stepKey.includes("side")) return hasName(group, /\b(burrito.*combo.*side|combo.*side|side)\b/);
    if (stepKey.includes("salsa")) return hasName(group, /\bsalsa\b/);
    if (stepKey.includes("extras")) return hasName(group, /\b(cb\s+extras|extras)\b/);
    return false;
  });
  if (byKey) return byKey;

  const byKind = groups.find((group) => {
    if (stepKind === "meat") return hasName(group, /\b(carne|meat)\b/);
    if (stepKind === "side") return hasName(group, /\b(side|combo\s+side)\b/);
    if (stepKind === "salsa") return hasName(group, /\bsalsa\b/);
    if (stepKind === "extras") return hasName(group, /\b(cb\s+extras|extras)\b/);
    return false;
  });
  if (byKind) return byKind;

  return groups.find((group) => {
    const groupName = normalizeOptionKey(group.name || "");
    return groupName && (groupName.includes(title) || title.includes(groupName));
  }) || null;
}

function findGuideCanonicalOption(group, selection) {
  const options = group?.options || [];
  const code = String(selection?.code || "").trim().toLowerCase();
  if (code) {
    const byCode = options.find((option) => new RegExp(`(^|[^a-z0-9])${escapeRegex(code)}([^a-z0-9]|$)`, "i").test(optionDisplayName(option)));
    if (byCode) return byCode;
  }
  return findCanonicalModifierOption(options, selection?.option);
}

function shouldSkipGuideSelection(selection) {
  const option = String(selection?.option || "");
  if (selection?.value === "none") return true;
  return /\b(no salsa|no extras|regular\s*-)\b/i.test(option);
}

function guideDefaultSelections() {
  const guide = state.currentBuildGuide;
  if (!guide?.steps?.length) return [];
  const picked = new Set((state.currentBuildSelections || []).map((selection) => selection.step));
  const out = [];
  guide.steps.forEach((step, index) => {
    if (!step?.default || (step.mode !== "default" && step.mode !== "suggest")) return;
    const stepNumber = guideStepNumber(step, index);
    if (picked.has(stepNumber)) return;
    const option = (step.options || []).find((candidate) => guideOptionName(candidate) === step.default) || { name: step.default };
    out.push({
      step: stepNumber,
      stepKey: String(step.key || ""),
      stepKind: String(step.kind || ""),
      stepTitle: step.title || `Step ${stepNumber}`,
      option: guideOptionName(option),
      label: step.defaultLabel || option.label || guideOptionName(option),
      code: guideOptionCode(option),
      family: guideOptionFamily(option),
      value: step.defaultSendsModifier === false ? "none" : guideOptionValue(option),
      priceDeltaCents: guideOptionPriceDeltaCents(option),
      isDefault: true
    });
  });
  return out;
}

function guideSelectionLabel(selection) {
  const guide = state.currentBuildGuide;
  const step = guide?.steps?.find((candidate, index) => guideStepNumber(candidate, index) === selection.step);
  const option = (step?.options || []).find((candidate) => guideOptionName(candidate) === selection.option);
  const label = String(selection.label || option?.label || selection.option || "").replace(/\s*\(\+?\$[\d.]+\)\s*/g, " ").trim();
  const parts = label.split(" / ");
  return (getEffectiveLanguage() === "es" ? parts[0] : (parts[1] || parts[0])).trim();
}

/** Short spoken/visible read-back of everything picked plus the defaults that will be used. */
function guideReadbackText() {
  const guide = state.currentBuildGuide;
  if (!guide) return "";
  const all = [...(state.currentBuildSelections || []), ...guideDefaultSelections()]
    .sort((a, b) => a.step - b.step);
  const parts = all.map(guideSelectionLabel).filter(Boolean);
  const item = resolveCurrentBuildItem();
  const extraCents = buildGuideModifiers().reduce((sum, mod) => sum + (Number(mod.priceDeltaCents) || 0), 0);
  const total = item ? ` — $${((Number(item.priceCents || 0) + extraCents) / 100).toFixed(2)}` : "";
  if (item) {
    // fix10: same short labels as the add read-back, without "¿Algo más?".
    const mods = buildGuideModifiers();
    const short = rbFormat([{ name: item.name, alt: item.readbackName, quantity: 1, mods: mods.map((m) => ({ option: m.option, group: m.groupName, quantity: m.quantity })), cents: Number(item.priceCents || 0) + extraCents }], getEffectiveLanguage() === "es" ? "es" : "en");
    return short.replace(/\.\s*(¿Algo más\?|Anything else\?)$/, "");
  }
  return `${guide.display_name}: ${parts.join(", ")}${total}`;
}

/**
 * fix16 (Carlos): included-salsa groups ("Salsa Preferencia / Preference", "Salsa Options") default to the
 * free mild Salsa Asada — same rule as services/api/src/site-catalog.ts includedSalsaDefaults().
 */
function includedSalsaDefaultsWeb(item) {
  const out = [];
  for (const group of item?.modifierGroups || []) {
    const name = String(group?.name || "");
    if (/^\W*(\(\w+\)\s*)?(extra|add)\b|\b\d\s*oz\b/i.test(name)) continue;
    if (!/\bsalsa\b.*\b(preferencia|preference|options)\b/i.test(name)) continue;
    const option = (group.options || []).find((o) => optionDisplayName(o).replace(/\s*\(\+?\$[\d.]+\)\s*$/, "").trim().toLowerCase() === "mild salsa asada" && !Number(o?.priceDeltaCents || 0));
    if (option) out.push({ group, option });
  }
  return out;
}

function withGuideSalsaDefault(item, mods) {
  const raw = state.currentBuildSelections || [];
  if (raw.some((sel) => /\b(no|sin)\s+salsa\b/i.test(String(sel?.option || sel?.label || "")))) return mods;
  const out = [...mods];
  for (const { group, option } of includedSalsaDefaultsWeb(item)) {
    if (out.some((m) => m.groupId === group.id || m.groupName === group.name)) continue;
    out.push({ groupId: group.id, groupName: group.name, option: optionDisplayName(option), optionId: option?.id, isDefault: true, quantity: 1, priceDeltaCents: 0 });
  }
  return out;
}

function buildGuideModifiers() {
  const item = resolveCurrentBuildItem();
  return withGuideSalsaDefault(item, buildGuideModifiersRaw(item));
}

function buildGuideModifiersRaw(item) {
  return [...(state.currentBuildSelections || []), ...guideDefaultSelections()]
    .filter((selection) => !shouldSkipGuideSelection(selection))
    .map((selection) => {
      const group = findGuideModifierGroup(item, selection);
      const optionMeta = group ? findGuideCanonicalOption(group, selection) : null;
      const canonicalOption = optionMeta ? optionDisplayName(optionMeta) : findCanonicalOption(group?.options || [], selection.option);
      if (group && canonicalOption) {
        return {
          groupId: group.id,
          groupName: group.name,
          option: canonicalOption,
          optionId: optionMeta?.id,
          ...(selection.isDefault ? { isDefault: true } : {}),
          quantity: 1,
          priceDeltaCents: Number.isFinite(Number(optionMeta?.priceDeltaCents))
            ? Number(optionMeta.priceDeltaCents)
            : (selection.priceDeltaCents || undefined)
        };
      }
      return {
        groupId: `guide-step-${selection.step}`,
        groupName: selection.stepTitle,
        option: selection.option,
        quantity: 1,
        priceDeltaCents: selection.priceDeltaCents || undefined
      };
    });
}

function updatePendingGuidePreview() {
  const item = resolveCurrentBuildItem();
  if (!item || !state.currentBuildGuide) return;
  const step = getCurrentGuideStep();
  state.pendingComboPreview = {
    item,
    quantity: 1,
    modifiers: buildGuideModifiers(),
    step: state.currentGuideStep || 1,
    totalSteps: state.currentBuildGuide.steps?.length || 1,
    stepName: step?.title || "Combo"
  };
  renderSelectedPreview(item);
  renderSelectedItemsPanel();
}

function clearCurrentGuideBuild() {
  state.currentBuildGuide = null;
  state.currentGuideStep = 0;
  state.currentBuildItem = null;
  state.currentBuildSelections = [];
  state.pendingComboPreview = null;
  state.lastComboAnimationKey = "";
  state.stepCompletionNote = "";
  clearComboTracker();
}

async function finishGuideBuildLocally() {
  const item = resolveCurrentBuildItem();
  if (!item) {
    const reply = getEffectiveLanguage() === "es" ? "No pude encontrar ese combo en el menú." : "I could not find that combo on the menu.";
    ui.reply.textContent = reply;
    markLocalTurnReady();
    await speakLocalText(reply, getEffectiveLanguage());
    return false;
  }

  const modifiers = buildGuideModifiers();
  addCartItem(item, 1, modifiers);
  const reply = withDefaultNote(shortAddReadback([{ item, quantity: 1, modifiers }]), [{ item, quantity: 1, modifiers }]) || item.name;
  clearCurrentGuideBuild();
  state.lastSelectedItem = item;
  renderCart();
  renderSelectedPreview(item);
  renderSelectedItemsPanel();
  ui.reply.textContent = formatCentsForSpeech(reply);
  markLocalTurnReady();
  await speakLocalText(reply, getEffectiveLanguage());
  pulseAvatarState("happy", 1200, "idle");
  return true;
}

// COMBO Mix (fix10): a bare "taco"/"quesadilla" is Comal (usual default); "de maíz"/street → Street; harina → Flour.
function normalizeMixItemsText(text) {
  const words = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const SHELL = /^(comal|homemade|harina|flour|taquer[oa]s?|street|maiz|corn)$/;
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^(tacos?|quesadillas?)$/.test(w) && !SHELL.test(words[i - 1] || "") && !SHELL.test(words[i + 1] || "")) {
      const stop = words.slice(i + 1, i + 5).findIndex((x) => /^(y|and|e|un|una|uno|a|an|one|plus|mas)$/.test(x));
      const near = words.slice(i + 1, stop < 0 ? i + 5 : i + 1 + stop).join(" ");
      const kind = /\b(de maiz|street|taquer)/.test(near) ? (w.startsWith("q") ? "taquera" : "taquero") : /\b(harina|flour)\b/.test(near) ? "harina" : "comal";
      out.push(w, kind);
      continue;
    }
    out.push(w);
  }
  return out.join(" ");
}

function isMixGuide() {
  return /\bmix\b/i.test(String(state.currentBuildGuide?.display_name || ""));
}

// fix11: chicharrón is Duro (chile verde, "pork rinds") or Prensado (chile rojo, "spicy pork").
function normalizeChicharronText(text) {
  return String(text || "")
    .replace(/\bchicharr[oó]n(es)?\s+(del\s+|de\s+)?duros?\b/gi, "pork rinds")
    .replace(/\bchicharr[oó]n(es)?\s+(en\s+)?(chile\s+)?verdes?\b/gi, "pork rinds")
    .replace(/\bchicharr[oó]n(es)?\s+prensados?\b/gi, "prensado")
    .replace(/\bchicharr[oó]n(es)?\s+(en\s+)?(chile\s+)?roj[oa]s?\b/gi, "prensado")
    .replace(/\bdel\s+duro\b/gi, "de pork rinds");
}

function chicharronAnswer(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(duros?|verdes?|pork rinds?|rinds|green)\b/.test(t)) return "pork rinds";
  if (/\b(prensados?|roj[oa]s?|spicy|red)\b/.test(t)) return "prensado";
  return "";
}

/** Returns the text to use, or null after asking the chicharrón question. */
function guideChicharronText(text) {
  if (state.chicharronPendingText) {
    const pick = chicharronAnswer(text);
    const original = state.chicharronPendingText;
    state.chicharronPendingText = "";
    if (pick) return original.replace(/\bchicharr[oó]n(es)?\b/gi, pick);
  }
  const t = normalizeChicharronText(text);
  if (!/\bchicharr[oó]n(es)?\b/i.test(t)) return t;
  const names = (state.currentBuildGuide?.steps || []).flatMap((st) => (st.options || []).map((o) => String(o.name || "")));
  const duro = names.some((n) => /duro/i.test(n));
  const prensado = names.some((n) => /prensado/i.test(n));
  if (duro && !prensado) return t.replace(/\bchicharr[oó]n(es)?\b/gi, "pork rinds");
  if (prensado && !duro) return t.replace(/\bchicharr[oó]n(es)?\b/gi, "prensado");
  state.chicharronPendingText = t;
  return null;
}

async function handleGuideTurnLocally(text) {
  const chText = guideChicharronText(text);
  if (chText === null) {
    const reply = getEffectiveLanguage() === "es" ? "¿Chicharrón del duro en chile verde o prensado en chile rojo?" : "Chicharrón: duro (pork rinds in green chile) or prensado (spicy pork in red chile)?";
    ui.reply.textContent = reply;
    markLocalTurnReady();
    await speakLocalText(reply, getEffectiveLanguage());
    return true;
  }
  text = chText;
  if (isMixGuide()) text = normalizeMixItemsText(text);
  state.turnInFlight = true; setAvatarState("thinking");
  state.lastUserText = text;
  ui.status.textContent = "Processing…";
  let completed = false;
  try {
    const step = getCurrentGuideStep();
    if (!step) {
      const result = await finishGuideBuildLocally();
      completed = true;
      return result;
    }

    // ui4: "sí / está bien / no / sin extras" answers a suggested/offered step; "así está bien" keeps the
    // suggestions for every remaining step. Naming options still works (handled below).
    {
      const plainAns = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
      const skipRest = /\b(asi esta bien|asi nomas|asi como viene|lo demas (normal|asi|como siempre)|todo lo demas (normal|igual)|eso es todo|that'?s it|that is it|that'?s all|everything else (normal|as usual|regular)|rest as usual|nothing else)\b/.test(plainAns);
      const accept = /^(si|ok|okay|okey|yes|yeah|yep|sure|claro|esta bien|perfecto|correcto|normal|como siempre|as usual|asi|no|no gracias|nada|ninguno|nope|no thanks|sin extras|sin nada|ya|listo|nada mas|no mas|nomas|ya esta|done|next|siguiente)( (gracias|thanks|please|por favor))?$/.test(plainAns);
      const isAsk = (st) => st && (st.mode === "suggest" || st.mode === "offer");
      const guide = state.currentBuildGuide;
      if ((skipRest || (accept && isAsk(step))) && guide) {
        guide._resolved = guide._resolved || new Set();
        if (step.mode === "suggest" && step.kind !== "regularDeluxe" && /^(no|nope)$/.test(plainAns) && !skipRest) {
          // "no" to a suggestion = not that one: offer the other choices.
          const others = (step.options || []).filter((o) => guideOptionName(o) !== step.default).map((o) => rbOptionLabel(guideOptionName(o), String(step.key || ""), getEffectiveLanguage() === "es" ? "es" : "en") || guideOptionName(o));
          const reply = getEffectiveLanguage() === "es" ? `¿Entonces ${others.join(" o ")}?` : `Then ${others.join(" or ")}?`;
          ui.reply.textContent = formatCentsForSpeech(reply);
          completed = true; markLocalTurnReady(); await speakLocalText(reply, getEffectiveLanguage());
          return true;
        }
        const steps = guide.steps || [];
        const from = Math.max(0, state.currentGuideStep - 1);
        steps.forEach((st, i) => { if (isAsk(st) && (i === from || (skipRest && i >= from))) guide._resolved.add(guideStepNumber(st, i)); });
        if (!advanceGuideToNextRequiredStep()) {
          const result = await finishGuideBuildLocally();
          completed = true;
          return result;
        }
        updatePendingGuidePreview();
        updateBuildVisuals({});
        const reply = `${getEffectiveLanguage() === "es" ? "Listo." : "Got it."} ${guideCustomerPrompt(getCurrentGuideStep())}`;
        ui.reply.textContent = formatCentsForSpeech(reply);
        completed = true; markLocalTurnReady(); await speakLocalText(reply, getEffectiveLanguage());
        pulseAvatarState("questioning", 1000, "idle");
        return true;
      }
    }

    const removedOptions = removeGuideSelectionsFromText(text);
    if (removedOptions.length) {
      updatePendingGuidePreview();
      updateBuildVisuals({});
      const removedNames = removedOptions.map((selection) => selection.option).join(", ");
      const reply = `${interpolateReplyText(
        getEffectiveLanguage() === "es"
          ? "Quité {{optionName}}."
          : "Removed {{optionName}}.",
        { optionName: removedNames }
      )} ${guideCurrentPrompt()}`;
      ui.reply.textContent = formatCentsForSpeech(reply);
      completed = true;
      markLocalTurnReady();
      await speakLocalText(reply, getEffectiveLanguage());
      pulseAvatarState("questioning", 1000, "idle");
      return true;
    }

    const optionalAdded = applyMentionedOptionalGuideSelections(text);
    const stepIndex = Math.max(0, state.currentGuideStep - 1);
    let addedOptions = isGuideMeatStep(step)
      ? applyGuideMeatDistributionFromText(stepIndex, text)
      : [];
    if (!addedOptions.length) {
      addedOptions = applyGuideSelectionsForStep(stepIndex, text);
    }
	    if (!addedOptions.length) {
	      if (shouldAskLimonSize(step, text)) {
	        updatePendingGuidePreview();
	        updateBuildVisuals({});
	        const reply = getEffectiveLanguage() === "es"
	          ? "¿Quieres medio limón o limón entero?"
	          : "Would you like half lime or full lime?";
	        ui.reply.textContent = formatCentsForSpeech(reply);
	        completed = true;
	        markLocalTurnReady();
	        await speakLocalText(reply, getEffectiveLanguage());
	        pulseAvatarState("questioning", 1000, "idle");
	        return true;
	      }

	      if (step.kind === "extras" && (hasGenericExtraSalsaIntent(text) || hasGenericExtrasIntent(text))) {
	        updatePendingGuidePreview();
	        updateBuildVisuals({});
	        const reply = hasGenericExtraSalsaIntent(text)
	          ? getEffectiveLanguage() === "es"
	            ? "Claro, ¿cuál salsa extra quieres?"
	            : "Sure, which extra salsa would you like?"
	          : getEffectiveLanguage() === "es"
	            ? "Claro, ¿cuál extra quieres?"
	            : "Sure, which extra would you like?";
	        ui.reply.textContent = formatCentsForSpeech(reply);
	        completed = true;
	        markLocalTurnReady();
	        await speakLocalText(reply, getEffectiveLanguage());
	        pulseAvatarState("questioning", 1000, "idle");
	        return true;
	      }

	      if (hasGuideRemovalIntent(text)) {
	        updatePendingGuidePreview();
	        updateBuildVisuals({});
	        const reply = getEffectiveLanguage() === "es"
	          ? `Está bien, no lo incluyo. ${guideCurrentPrompt()}`
	          : `Okay, I will leave it off. ${guideCurrentPrompt()}`;
	        ui.reply.textContent = formatCentsForSpeech(reply);
	        completed = true;
	        markLocalTurnReady();
	        await speakLocalText(reply, getEffectiveLanguage());
	        pulseAvatarState("questioning", 1000, "idle");
	        return true;
	      }

	      if (hasSkipIntent(text) && /\b(salsa|extras?|extra|side|2oz|5oz|cup|vasito|lim[eó]n|limon|no thanks|no gracias|skip|saltar)\b/i.test(text)) {
	        updatePendingGuidePreview();
	        updateBuildVisuals({});
	        const reply = guideCurrentPrompt();
	        ui.reply.textContent = formatCentsForSpeech(reply);
	        completed = true;
	        markLocalTurnReady();
	        await speakLocalText(reply, getEffectiveLanguage());
	        pulseAvatarState("questioning", 1000, "idle");
	        return true;
	      }

	      if (optionalAdded.length) {
	        updatePendingGuidePreview();
	        updateBuildVisuals({});
        const addedNames = optionalAdded.map(guideOptionName).join(", ");
        // fix10: a change to a defaulted step ("de comal") → "Listo: comal. <current question>".
        const shortNames = optionalAdded.map((o) => rbOptionLabel(guideOptionName(o), "", getEffectiveLanguage() === "es" ? "es" : "en")).filter(Boolean).join(", ") || addedNames;
        const reply = step?.kind === "extras"
          ? guideExtrasAddedReply(addedNames)
          : `${getEffectiveLanguage() === "es" ? "Listo" : "Got it"}: ${shortNames}. ${guideCurrentPrompt()}`;
        ui.reply.textContent = formatCentsForSpeech(reply);
        completed = true;
        markLocalTurnReady();
        await speakLocalText(reply, getEffectiveLanguage());
        pulseAvatarState("happy", 1000, "idle");
        return true;
      }

      const reply = getEffectiveLanguage() === "es" ? "No vi esa opción aquí. Elige una de las opciones mostradas." : "I do not see that option here. Please choose one of the options shown.";
      ui.reply.textContent = reply;
      updateBuildVisuals({});
      completed = true;
      markLocalTurnReady();
      await speakLocalText(reply, getEffectiveLanguage());
      pulseAvatarState("questioning", 1200, "idle");
      return false;
    }

    if (!isGuideMultiStep(step)) {
      // Callers answer several steps at once ("de harina, uno de asada y uno de pollo"):
      // fill every later required step the same sentence already answers.
      const more = prefillGuideSelectionsFromText(text, { afterAnswer: true });
      addedOptions = [...addedOptions, ...more.filter((option) => !addedOptions.includes(option))];
    }
    // fix10: short spoken label ("comal", "asada"), not "Taco Comal / Homemade".
    const optionNames = addedOptions.map((option) => rbOptionLabel(guideOptionName(option) || option?.label, String(step?.key || step?.title || ""), getEffectiveLanguage() === "es" ? "es" : "en") || (option && option.label) || guideOptionName(option)).join(", ");
    const isMulti = isGuideMultiStep(step);
    const pickedNone = addedOptions.some((option) => guideOptionValue(option) === "none");
    const saidEverything = /\b(con todo|todo|everything|with everything|eso es todo|nada mas|that'?s it)\b/i.test(text);
    const shouldAdvance = !isMulti || pickedNone || saidEverything || hasOnlyIntent(text) || hasSkipIntent(text);
    if (isMulti && !shouldAdvance) {
      updatePendingGuidePreview();
      updateBuildVisuals({});
      const reply = step?.kind === "extras"
        ? guideExtrasAddedReply(optionNames)
        : interpolateReplyText(
            getEffectiveLanguage() === "es"
              ? "Agregado {{optionName}}. ¿Algo más para este paso? Di siguiente cuando termines."
              : "Got {{optionName}}. Anything else for this step, or say next.",
            { optionName: optionNames }
          );
      ui.reply.textContent = formatCentsForSpeech(reply);
      completed = true;
      markLocalTurnReady();
      await speakLocalText(reply, getEffectiveLanguage());
      pulseAvatarState("happy", 1000, "idle");
      return true;
    }

    if (!advanceGuideToNextRequiredStep()) {
      const result = await finishGuideBuildLocally();
      completed = true;
      return result;
    }

    updatePendingGuidePreview();
    updateBuildVisuals({});
    const next = getCurrentGuideStep();
    const nextPrompt = guideCustomerPrompt(next);
    const reply = interpolateReplyText(
      getEffectiveLanguage() === "es" ? "Listo: {{optionName}}. {{nextPrompt}}" : "Got it: {{optionName}}. {{nextPrompt}}",
      { optionName: optionNames, nextPrompt }
    );
    ui.reply.textContent = formatCentsForSpeech(reply);
    completed = true;
    markLocalTurnReady();
    await speakLocalText(reply, getEffectiveLanguage());
    pulseAvatarState("questioning", 1000, "idle");
    syncRealtimeOrderContext();
    return true;
  } catch (error) {
    console.error("[ORDER] Guide turn failed:", error);
    ui.status.textContent = error instanceof Error ? error.message : "Build error";
    ui.reply.textContent = getEffectiveLanguage() === "es" ? "No pude actualizar esa selección. Intenta otra vez." : "I could not update that choice. Please try again.";
    setAvatarState("frustrated");
    return false;
  } finally {
    if (!completed) state.turnInFlight = false;
    if (completed) ui.status.textContent = "Connected";
  }
}

function sendWs(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  state.ws.send(JSON.stringify(payload));
}

function findComboActionItem(action) {
  const itemId = action.itemId || action.selectedItem?.itemId;
  if (itemId) {
    const item = state.menu.find((candidate) => candidate.id === itemId);
    if (item) return item;
  }
  const name = normalizeOptionKey(action.itemName || action.selectedItem?.name || "");
  if (!name) return null;
  return state.menu.find((candidate) => normalizeOptionKey(candidate.name) === name)
    || state.menu.find((candidate) => normalizeOptionKey(candidate.name).includes(name) || name.includes(normalizeOptionKey(candidate.name)))
    || menuItemFromResolverSelection(action.selectedItem, itemId)
    || null;
}

function menuItemFromResolverSelection(selectedItem, fallbackId = "") {
  if (!selectedItem || typeof selectedItem !== "object") return null;
  const id = String(selectedItem.itemId || fallbackId || "").trim();
  const name = String(selectedItem.name || id).trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    nameEs: String(selectedItem.nameEs || selectedItem.name || name),
    aliases: [],
    priceCents: Math.max(0, Number(selectedItem.priceCents) || 0),
    description: String(selectedItem.description || "").trim() || undefined,
    imageUrl: String(selectedItem.imageUrl || "").trim() || undefined,
    modifierGroups: Array.isArray(selectedItem.modifierGroups) ? selectedItem.modifierGroups : undefined
  };
}

function mergeResolverSelectedItem(catalogItem, selectedItem, fallbackId = "") {
  const resolverItem = menuItemFromResolverSelection(selectedItem, fallbackId);
  if (!resolverItem) return catalogItem || null;
  return {
    ...(catalogItem || {}),
    ...resolverItem,
    aliases: catalogItem?.aliases || resolverItem.aliases || [],
    description: resolverItem.description || catalogItem?.description,
    imageUrl: resolverItem.imageUrl || catalogItem?.imageUrl,
    modifierGroups: catalogItem?.modifierGroups || resolverItem.modifierGroups
  };
}

function applyActions(actions) {
  let addedItem = false;
  for (const action of actions) {
    if (action.type === "combo_building") {
      const comboItem = findComboActionItem(action);
      if (comboItem) {
        const selections = Array.isArray(action.selections) ? action.selections : [];
        const stepOptions = Array.isArray(action.stepOptions) ? action.stepOptions : [];
        const isChoiceMenu = stepOptions.length > 0 && selections.length === 0 && Number(action.totalSteps || 1) === 1;
        state.lastSelectedItem = comboItem;
        state.pendingComboPreview = {
          item: comboItem,
          quantity: 1,
          modifiers: isChoiceMenu
            ? stepOptions.map((label) => ({ option: String(label), quantity: 1 }))
            : selections.map((label) => ({ option: String(label), quantity: 1 })),
          step: action.step || 1,
          totalSteps: action.totalSteps || 1,
          stepName: action.stepName || ""
        };
      }
      const buildKey = `${action.itemName || ""}|${action.step || 0}|${(action.selections || []).join("|")}`;
      if (buildKey !== state.lastComboAnimationKey) {
        state.lastComboAnimationKey = buildKey;
        const step = action.step || 1;
        const currentOption = (action.selections || [])[step - 1] || "";
        if (elvi && typeof elvi.performBuildStep === "function") {
          void elvi.performBuildStep({
            step,
            totalSteps: action.totalSteps || 1,
            stepName: action.stepName || "",
            option: currentOption,
            selections: action.selections || []
          });
        }
      }
      renderComboTracker(action.itemName, action.step, action.totalSteps, action.selections || [], action.stepName || "", action.stepOptions || []);
      renderSelectedPreview(comboItem || state.lastSelectedItem);
      renderSelectedItemsPanel();
      continue;
    }

    if (action.type === "add_item") {
      const catalogItem = state.menu.find((item) => item.id === action.itemId);
      const menuItem = mergeResolverSelectedItem(catalogItem, action.selectedItem, action.itemId);
      if (!menuItem) {
        continue;
      }

      if (action.mode === "combo_late_modifier_update") {
        const updated = applyComboLateModifierUpdate(
          menuItem.id,
          Array.isArray(action.modifiers) ? action.modifiers : []
        );
        if (updated) {
          addedItem = true;
          clearComboTracker();
          continue;
        }
      }

      addCartItem(menuItem, Number(action.quantity) || 1, Array.isArray(action.modifiers) ? action.modifiers : []);
      addedItem = true;
      state.pendingComboState = null;
      state.pendingComboPreview = null;
      state.lastComboAnimationKey = "";
      clearComboTracker();
      continue;
    }

    if (action.type === "remove_item") {
      removeCartItem(action.itemId, Number(action.quantity) || 1, action.cartIndex);
      continue;
    }

    if (action.type === "update_item") {
      // ui4: a correction edits the MOST RECENT line of that item.
      // tortilla2: "match" = the line's current options (e.g. its meat + old tortilla) → edit exactly that split line.
      const matchIndex = Array.isArray(action.match) ? state.cart.findIndex((l) => l.item.id === action.itemId && action.match.every((o) => (l.modifiers || []).some((m) => m.option === o))) : -1;
      const lastIndex = matchIndex >= 0 ? matchIndex : action.correction ? state.cart.map((l) => l.item.id).lastIndexOf(action.itemId) : -1;
      // tortilla2: a matched split-line switch only replaces the groups it names (keeps salsa etc.).
      const mods = matchIndex >= 0 && Array.isArray(action.modifiers)
        ? [...(state.cart[matchIndex].modifiers || []).filter((m) => !action.modifiers.some((n) => n.groupId && n.groupId === m.groupId)), ...action.modifiers.filter((n) => !(state.cart[matchIndex].modifiers || []).some((m) => m.groupId === n.groupId && m.option === n.option) || true)].filter((m, i, a) => a.findIndex((x) => x.groupId === m.groupId && x.option === m.option) === i)
        : action.modifiers;
      updateCartItem(action.itemId, Number(action.quantity) || (lastIndex >= 0 ? state.cart[lastIndex].quantity : 1), lastIndex >= 0 ? lastIndex : action.cartIndex, mods);
      continue;
    }

    if (action.type === "set_fulfillment") {
      if (action.fulfillment === "DELIVERY" && !isDeliveryEnabled()) {
        state.fulfillment = "PICKUP";
        ui.reply.textContent = deliveryDisabledMessage();
      } else {
        state.fulfillment = action.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP";
        if (action.message) ui.reply.textContent = action.message;
      }
      ui.fulfillment.value = state.fulfillment;
      continue;
    }

    if (action.type === "set_address" && action.address) {
      if (!isDeliveryEnabled()) {
        ui.reply.textContent = deliveryDisabledMessage();
        continue;
      }
      state.customer.address = action.address;
      ui.address.value = action.address;
      continue;
    }

    if (action.type === "set_customer") {
      if (action.name) {
        state.customer.name = action.name;
        ui.name.value = action.name;
      }
      if (action.phone) {
        state.customer.phone = action.phone;
        ui.phone.value = action.phone;
        void checkFavorites(action.phone);
      }
      if (action.email) {
        state.customer.email = action.email;
        ui.email.value = action.email;
      }
      continue;
    }
  }

  if (addedItem) {
    pulseAvatarState("happy", 1200, "talking_neutral");
  }

  renderCart();
}

function modifierSignature(modifiers = []) {
  return modifiers
    .map((m) => `${m.groupId}:${m.option}:${m.quantity}`)
    .sort()
    .join("|");
}

function addCartItem(item, quantity, modifiers = []) {
  const sig = modifierSignature(modifiers);
  const existing = state.cart.find((line) => line.item.id === item.id && modifierSignature(line.modifiers || []) === sig);
  state.lastSelectedItem = item;

  if (!existing) {
    state.cart.push({ item, quantity, modifiers });
    return;
  }

  existing.quantity += quantity;
}

function removeCartItem(itemId, quantity, cartIndex) {
  const index = Number.isInteger(cartIndex) && state.cart[cartIndex]?.item?.id === itemId
    ? cartIndex
    : state.cart.findIndex((line) => line.item.id === itemId);
  const existing = index >= 0 ? state.cart[index] : null;
  if (!existing) {
    return;
  }

  existing.quantity -= Math.max(1, quantity);
  if (existing.quantity <= 0) {
    state.cart.splice(index, 1);
  }

  if (state.lastSelectedItem?.id === itemId && !state.cart.some((line) => line.item.id === itemId)) {
    state.lastSelectedItem = state.cart[state.cart.length - 1]?.item || null;
  }
}

function updateCartItem(itemId, quantity, cartIndex, modifiers) {
  const q = Math.max(1, quantity);
  const index = Number.isInteger(cartIndex) && state.cart[cartIndex]?.item?.id === itemId
    ? cartIndex
    : state.cart.findIndex((line) => line.item.id === itemId);
  const existing = index >= 0 ? state.cart[index] : null;
  if (existing) {
    existing.quantity = q;
    if (Array.isArray(modifiers) && modifiers.length) {
      existing.modifiers = modifiers;
    }
    state.lastSelectedItem = existing.item;
    return;
  }

  const item = state.menu.find((menuItem) => menuItem.id === itemId);
  if (item) {
    state.cart.push({ item, quantity: q });
    state.lastSelectedItem = item;
  }
}

  function openCart() {
    ui.cartDrawer.classList.add("open");
    ui.cartDrawer.setAttribute("aria-hidden", "false");
    ui.drawerBackdrop.classList.add("open");
  }

  function closeCart() {
    ui.cartDrawer.classList.remove("open");
    ui.cartDrawer.setAttribute("aria-hidden", "true");
    ui.drawerBackdrop.classList.remove("open");
  }

function renderComboTracker(itemName, step, totalSteps, selections, stepName, stepOptions) {
  // Inject subtle blink animation for the Next button (only once)
  if (!document.getElementById("combo-blink-style")) {
    const style = document.createElement("style");
    style.id = "combo-blink-style";
    style.textContent = `
      .combo-nav-primary.blink {
        animation: comboNextBlink 1.2s ease-in-out infinite;
      }
      @keyframes comboNextBlink {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255, 200, 50, 0.4); }
        50% { box-shadow: 0 0 0 8px rgba(255, 200, 50, 0); }
      }
    `;
    document.head.appendChild(style);
  }

  const tracker = document.getElementById("combo-tracker");
  const nameEl = document.getElementById("combo-tracker-name");
  const progressEl = document.getElementById("combo-tracker-progress");
  const listEl = document.getElementById("combo-tracker-selections");
  const askEl = document.getElementById("combo-tracker-ask");
  const stepLabelEl = document.getElementById("combo-tracker-step-label");
  const optionsEl = document.getElementById("combo-tracker-options");
  const backEl = document.getElementById("combo-tracker-back");
  const nextEl = document.getElementById("combo-tracker-next");
  if (!tracker || !nameEl || !progressEl || !listEl) return;

  const selectionList = Array.isArray(selections) ? selections : [];
  const optionList = Array.isArray(stepOptions) ? stepOptions : [];
  const isChoiceMenu = optionList.length > 0 && selectionList.length === 0 && Number(totalSteps || 1) === 1;

  nameEl.textContent = itemName;
  progressEl.textContent = `${step}/${totalSteps}`;
  tracker.classList.toggle("is-selection-menu", isChoiceMenu);
  tracker.closest(".speech-wrap")?.classList.add("is-building");

  // Confirmed selections — shown as small checkmarked pills
  listEl.textContent = "";
  for (const selection of selectionList) {
    const item = document.createElement("li");
    item.className = "selection-done";
    item.textContent = `✓ ${selection}`;
    listEl.appendChild(item);
  }

  // Current step options — shown as tappable chips
  if (askEl && stepLabelEl && optionsEl && optionList.length > 0) {
    stepLabelEl.textContent = stepName || "";
    optionsEl.textContent = "";
    for (const option of optionList) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "combo-option-chip";
      button.textContent = option;
      button.addEventListener("click", () => sendOptionChip(button));
      li.appendChild(button);
      optionsEl.appendChild(li);
    }
    askEl.classList.remove("is-hidden");
  } else if (askEl) {
    if (optionsEl) optionsEl.textContent = "";
    askEl.classList.add("is-hidden");
  }

  if (backEl) backEl.textContent = getEffectiveLanguage() === "es" ? "Atrás" : "Back";
  if (nextEl) {
    nextEl.textContent = getEffectiveLanguage() === "es" ? "Siguiente" : "Next";

    // Subtle blink on Next button for multi-select guide steps
    // (helps user notice they can finish and advance)
    let shouldBlink = false;
    if (state.currentBuildGuide && state.currentGuideStep) {
      const guideStep = state.currentBuildGuide.steps[state.currentGuideStep - 1];
      if (guideStep && guideStep.selection_type === "multiple") {
        // Blink as soon as we're on a multi-select step in a guide (even before first selection)
        // This makes the affordance obvious
        shouldBlink = true;
      }
    }
    if (shouldBlink) {
      nextEl.classList.add("blink");
    } else {
      nextEl.classList.remove("blink");
    }
  }

  tracker.classList.remove("is-hidden");
}

// ── Consistent Build Progress Shape (used by new model-driven flow) ────────
function normalizeBuildProgress(input) {
  if (!input) return null;

  // Support both old comboStep shape and new cleaner buildProgress shape
  const raw = input.buildProgress || input.comboStep || input;

  if (!raw || (!raw.step && !raw.active)) return null;

  return {
    active: raw.active !== false,
    itemId: raw.itemId || raw.selectedItem?.itemId,
    itemName: raw.itemName || raw.name || "",
    step: Number(raw.step || 1),
    totalSteps: Number(raw.totalSteps || raw.total || 1),
    stepName: raw.stepName || raw.phase || "",
    completedSelections: Array.isArray(raw.completedSelections) ? raw.completedSelections :
                         Array.isArray(raw.selections) ? raw.selections :
                         Array.isArray(raw.completed) ? raw.completed : [],
    currentOptions: Array.isArray(raw.currentOptions) ? raw.currentOptions :
                    Array.isArray(raw.stepOptions) ? raw.stepOptions :
                    Array.isArray(raw.options) ? raw.options : [],
    phase: raw.phase || raw.stepName || ""
  };
}

function updateBuildVisuals(progressInput) {
  // When a guide is active, use the guide as the source of truth for the current step
  if (state.currentBuildGuide && state.currentBuildGuide.steps && state.currentGuideStep) {
    const guide = state.currentBuildGuide;
    const stepIndex = Math.max(0, Math.min(state.currentGuideStep - 1, guide.steps.length - 1));
    const guideStep = guide.steps[stepIndex];

    if (guideStep) {
      const tracker = document.getElementById("combo-tracker");
      if (tracker) tracker.classList.remove("is-hidden");

      const itemName = guide.display_name || "Combo";

      renderComboTracker(
        itemName,
        state.currentGuideStep,
        guide.steps.length,
        getGuideSelectionLabels(),
        guideStep.title,
        guideStep.options ? guideStep.options.map(o => o.name || o) : []
      );

      if (elvi && typeof elvi.performBuildStep === "function") {
        void elvi.performBuildStep({
          step: state.currentGuideStep,
          totalSteps: guide.steps.length,
          stepName: guideStep.title,
          option: "",
          selections: getGuideSelectionLabels()
        });
      }
      return;
    }
  }

  // Fallback to old behavior when no guide is active
  const p = normalizeBuildProgress(progressInput);
  if (!p || !p.active) {
    const tracker = document.getElementById("combo-tracker");
    if (tracker) {
      tracker.classList.add("is-hidden");
      tracker.classList.remove("is-selection-menu");
      tracker.closest(".speech-wrap")?.classList.remove("is-building");
    }
    return;
  }

  let stepTitle = p.stepName;
  let options = p.currentOptions || [];

  if (state.currentBuildGuide && state.currentBuildGuide.steps) {
    const guideStep = state.currentBuildGuide.steps.find((s) => s.step === p.step) || state.currentBuildGuide.steps[p.step - 1];
    if (guideStep) {
      stepTitle = guideStep.title || stepTitle;
      if (guideStep.options && guideStep.options.length > 0) {
        options = guideStep.options.map((o) => o.name || o);
      }
    }
  }

  renderComboTracker(
    p.itemName,
    p.step,
    p.totalSteps,
    p.completedSelections || [],
    stepTitle,
    options
  );

  if (elvi && typeof elvi.performBuildStep === "function") {
    void elvi.performBuildStep({
      step: p.step,
      totalSteps: p.totalSteps,
      stepName: stepTitle,
      option: (p.completedSelections && p.completedSelections[0]) || "",
      selections: p.completedSelections || []
    });
  }
}

// Legacy wrapper - will be removed once all call sites are migrated
function clearComboTracker() {
  const tracker = document.getElementById("combo-tracker");
  tracker?.classList.add("is-hidden");
  tracker?.classList.remove("is-selection-menu");
  tracker?.closest(".speech-wrap")?.classList.remove("is-building");
}

function sendComboNav(direction) {
  // If a guide is active, prefer advancing the guide step for consistency across all combos
  if (state.currentBuildGuide && state.currentGuideStep) {
    if (direction === "next") {
      if (!advanceGuideToNextRequiredStep()) {
        void finishGuideBuildLocally();
        return;
      }
      updatePendingGuidePreview();
      updateBuildVisuals({});
      syncRealtimeOrderContext();
      return;
    } else if (direction === "back" && state.currentGuideStep > 1) {
      state.currentGuideStep--;
      updatePendingGuidePreview();
      updateBuildVisuals({});
      syncRealtimeOrderContext();
      return;
    }
  }

  // Fallback to old behavior
  const text = direction === "back"
    ? (getEffectiveLanguage() === "es" ? "atrás" : "back")
    : (getEffectiveLanguage() === "es" ? "siguiente" : "next");
  sendUserTurn(text);
}

function getPreviewDescription(item) {
  const language = getEffectiveLanguage();
  const raw = String(item?.description || "").trim();
  if (raw) {
    return raw;
  }
  return language === "es"
    ? "Seleccionado en Cocina Elvis. Personalizalo y agregalo al carrito."
    : "Selected at Cocina Elvis. Customize it and add it to your cart.";
}

  function renderSelectedPreview(item) {
    if (!ui.selectionPreview || !ui.selectionPreviewImage || !ui.selectionPreviewName || !ui.selectionPreviewDescription) {
      return;
    }

    if (!item) {
      ui.selectionPreview.classList.add("is-hidden");
      return;
    }

    const label = getEffectiveLanguage() === "es" ? item.nameEs : item.name;
    ui.selectionPreviewName.textContent = label;
    const selectedLine = state.cart.find((line) => line.item.id === item.id);
    const price = selectedLine ? getCartLineUnitPriceCents(selectedLine) : Number(item.priceCents || 0);
    const delta = Math.max(0, price - Number(item.priceCents || 0));
    if (state.currentBuildGuide && typeof guideReadbackText === "function") {
      // During a guided build show what will be ordered, including defaults, not Square's long description.
      ui.selectionPreviewDescription.textContent = guideReadbackText();
      if (item.imageUrl) { ui.selectionPreviewImage.src = item.imageUrl; ui.selectionPreviewImage.style.display = "block"; }
      ui.selectionPreview.classList.remove("is-hidden");
      return;
    }
    ui.selectionPreviewDescription.textContent = `${getPreviewDescription(item)} Price: ${centsToUsd(price)}${delta ? ` (${centsToUsd(Number(item.priceCents || 0))} + ${centsToUsd(delta)} modifiers)` : ""}.`;

    if (item.imageUrl) {
      ui.selectionPreviewImage.src = item.imageUrl;
      ui.selectionPreviewImage.style.display = "block";
    } else {
      ui.selectionPreviewImage.removeAttribute("src");
      ui.selectionPreviewImage.style.display = "none";
    }

    ui.selectionPreview.classList.remove("is-hidden");
  }

function renderCart() {
  const itemCount = state.cart.reduce((s, l) => s + l.quantity, 0);
  if (ui.cartBadge) ui.cartBadge.textContent = String(itemCount);

  ui.cartList.innerHTML = "";
  let total = 0;

  for (const line of state.cart) {
    const lineTotalCents = getCartLineTotalCents(line);
    total += lineTotalCents;

    const li = document.createElement("li");
    const name = getEffectiveLanguage() === "es" ? line.item.nameEs : line.item.name;
    const main = document.createElement("div");
    main.className = "cart-item-main";

    const thumb = document.createElement("img");
    thumb.className = "cart-item-thumb";
    thumb.alt = name;
    if (line.item.imageUrl) {
      thumb.src = line.item.imageUrl;
    }
    main.appendChild(thumb);

    const itemName = document.createElement("span");
    itemName.className = "cart-item-name";
    itemName.textContent = `${line.quantity} x ${name}`;
    main.appendChild(itemName);

    const breakdown = document.createElement("div");
    breakdown.className = "cart-price-breakdown";
    const baseCents = Number(line.item.priceCents || 0);
    const modifierDelta = getModifierDeltaPerUnitCents(line);
    const unitCents = baseCents + modifierDelta;
    breakdown.textContent = modifierDelta
      ? `Base ${centsToUsd(baseCents)} + modifiers ${centsToUsd(modifierDelta)} = ${centsToUsd(unitCents)}${line.quantity > 1 ? ` each x ${line.quantity}` : ""}`
      : `Base ${centsToUsd(baseCents)}${line.quantity > 1 ? ` each x ${line.quantity}` : ""}`;
    main.appendChild(breakdown);

    const value = document.createElement("span");
    value.className = "cart-item-price";
    value.textContent = centsToUsd(lineTotalCents);

    if (Array.isArray(line.modifiers) && line.modifiers.length > 0) {
      const mods = document.createElement("div");
      mods.className = "cart-item-mods";
      for (const modifier of line.modifiers) {
        const chip = document.createElement("span");
        chip.className = "cart-item-mod-chip";
        const qty = Number(modifier.quantity || 0);
        chip.textContent = `${qty > 1 ? `${qty}x ` : ""}${stripModifierPriceText(modifier.option)}${getModifierUpchargeLabel(modifier)}`;
        mods.appendChild(chip);
      }
      main.appendChild(mods);
    }

    li.appendChild(main);
    li.appendChild(value);
    ui.cartList.appendChild(li);
  }

  ui.cartTotal.textContent = centsToUsd(total);
  updateCartBar(itemCount, total);
  renderSelectedPreview(state.lastSelectedItem);
  renderSelectedItemsPanel();
  syncRealtimeOrderContext();
}

function updateCartBar(count, totalCents) {
  const bar = document.getElementById("cart-bar");
  if (!bar) return;
  const es = getEffectiveLanguage() === "es";
  document.getElementById("cart-bar-count").textContent = String(count);
  document.getElementById("cart-bar-total").textContent = centsToUsd(totalCents);
  document.getElementById("cart-bar-label").textContent = es ? "Ver orden y pagar" : "Review order & checkout";
  bar.classList.toggle("is-empty", count === 0);
  const previewLabel = document.querySelector(".selection-preview-label");
  if (previewLabel) previewLabel.textContent = es ? "Preparando" : "Now building";
}

function renderSelectedItemsPanel() {
  if (!ui.selectedItemsList) return;
  ui.selectedItemsList.innerHTML = "";

  if (state.pendingComboPreview?.item) {
    ui.selectedItemsList.appendChild(createSelectedItemCard(state.pendingComboPreview, { pending: true }));
  }

  for (const line of state.cart.slice(-6).reverse()) {
    ui.selectedItemsList.appendChild(createSelectedItemCard(line));
  }
}

function createSelectedItemCard(line, options = {}) {
  const card = document.createElement("article");
  card.className = `selected-item-card${options.pending ? " is-pending" : ""}`;

  const thumb = document.createElement("img");
  thumb.className = "selected-item-thumb";
  thumb.alt = line.item.name;
  thumb.src = line.item.imageUrl || "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=240&q=70";

  const body = document.createElement("div");
  const name = document.createElement("div");
  name.className = "selected-item-name";
  const label = getEffectiveLanguage() === "es" ? line.item.nameEs : line.item.name;
  name.textContent = `${options.pending ? "Building: " : ""}${line.quantity} x ${label}`;
  body.appendChild(name);

  if (options.pending) {
    const step = document.createElement("div");
    step.className = "selected-item-pending-step";
    step.textContent = `${line.stepName || "Combo"} ${line.step || 1}/${line.totalSteps || 1}`;
    body.appendChild(step);
  }

  if (Array.isArray(line.modifiers) && line.modifiers.length > 0) {
    const mods = document.createElement("div");
    mods.className = "selected-item-mods";
    for (const m of line.modifiers) {
      const chip = document.createElement("span");
      chip.className = "selected-item-mod-chip";
      const qty = Number(m.quantity || 0);
      const group = m.groupName && !options.pending ? `${m.groupName}: ` : "";
      chip.textContent = `${group}${qty > 1 ? `${qty}x ` : ""}${m.option}${options.pending ? "" : getModifierUpchargeLabel(m)}`;
      mods.appendChild(chip);
    }
    body.appendChild(mods);
  }

  const price = document.createElement("div");
  price.className = "selected-item-price";
  price.textContent = options.pending ? "…" : centsToUsd(getCartLineTotalCents(line));

  card.appendChild(thumb);
  card.appendChild(body);
  card.appendChild(price);
  return card;
}

function centsToUsd(value) {
  return `$${(value / 100).toFixed(2)}`;
}

function getModifierDeltaPerUnitCents(line) {
  const modifiers = Array.isArray(line?.modifiers) ? line.modifiers : [];
  return modifiers.reduce((sum, modifier) => {
    const qty = Math.max(1, Number(modifier?.quantity) || 1);
    return sum + extractOptionCostCents(modifier?.option) * qty;
  }, 0);
}

function getCartLineUnitPriceCents(line) {
  return Math.max(0, Number(line?.item?.priceCents || 0) + getModifierDeltaPerUnitCents(line));
}

function getCartLineTotalCents(line) {
  const qty = Math.max(1, Number(line?.quantity) || 1);
  return getCartLineUnitPriceCents(line) * qty;
}

function getModifierUpchargeLabel(modifier) {
  if (/\$\s*\d/.test(String(modifier?.option || ""))) return "";
  const cents = extractOptionCostCents(modifier?.option);
  if (!cents) return "";
  return cents > 0 ? ` (+${centsToUsd(cents)})` : ` (${centsToUsd(cents)})`;
}

// (audio variables hoisted earlier to prevent TDZ during boot)
function getAudioContext() {
  if (!_sharedAudioCtx || _sharedAudioCtx.state === "closed") {
    _sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _sharedAudioCtx;
}

// Unlock AudioContext on first user gesture so autoplay policy doesn't block us
function ensureAudioContextUnlocked() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    console.log("[AUDIO] Resuming suspended AudioContext");
    ctx.resume().catch((err) => { console.error("[AUDIO] Failed to resume context:", err); });
  }
}
document.addEventListener("click",   ensureAudioContextUnlocked, { once: false, passive: true });
document.addEventListener("touchend", ensureAudioContextUnlocked, { once: false, passive: true });

function playBase64Audio(base64, mimeType) {
  return new Promise((resolve, reject) => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const raw = atob(base64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);

    ctx.decodeAudioData(
      buf.buffer,
      (decoded) => {
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(ctx.destination);
        source.onended = () => { _currentAudioSource = null; resolve(true); };
        _currentAudioSource = source;
        source.start(0);
      },
      (err) => reject(err)
    );
  });
}

async function queuePcmDeltaForPlayback(base64) {
  const ctx = getAudioContext();
  console.log("[AUDIO] AudioContext state:", ctx.state, "sample rate:", ctx.sampleRate);
  if (ctx.state === "suspended") {
    console.log("[AUDIO] Context suspended, awaiting resume");
    try { await ctx.resume(); } catch (err) { console.error("[AUDIO] Resume failed:", err); }
  }
  if (ctx.state !== "running") {
    console.warn("[AUDIO] Context still not running, state:", ctx.state, "— skipping chunk");
    return;
  }

  try {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      bytes[i] = raw.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i += 1) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, _nextPlayTime);
    console.log("[AUDIO] Queuing audio buffer, duration:", buffer.duration, "start time:", startAt, "queue length:", _queuedSources.length + 1);
    source.start(startAt);
    _nextPlayTime = startAt + buffer.duration;
    _queuedSources.push(source);
    state.elviSpeaking = true;

    source.onended = () => {
      const index = _queuedSources.indexOf(source);
      if (index !== -1) _queuedSources.splice(index, 1);
      if (_queuedSources.length === 0) {
        state.elviSpeaking = false;
        if (!state.turnInFlight) {
          setAvatarState("idle");
        }
      }
    };
  } catch (err) {
    console.error("[AUDIO] Error processing PCM delta:", err);
  }
}

// ─── Adaptive / hands-free listening ─────────────────────────────────────

function stopCurrentAudio() {
  stopLocalTtsAudio();
  for (const src of _queuedSources) {
    try { src.stop(); } catch {}
  }
  _queuedSources = [];
  _nextPlayTime = 0;
  if (_currentAudioSource) {
    try { _currentAudioSource.stop(); } catch {}
    _currentAudioSource = null;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  state.elviSpeaking = false;
}

// ─── Adaptive / hands-free listening (direct PCM streaming) ──

function startAdaptiveListen() {
  if (state.vadRunning) return;
  state.vadRunning = true;
  state.autoListen = true;
  state.speechActive = false;
  state.prespeechChunks = [];
  state.lastSpeechAt = 0;
  state.noiseFloor = 0.008;
  state.speechFrameCount = 0;
  state.silenceFrameCount = 0;
  state.turnSpeechFrameCount = 0;
  state.turnPeakRms = 0;
  state.speechStartedAt = 0;
  state.listenCooldownUntil = 0;
  state.voiceInputCooldownUntil = 0;
  state.recognitionPaused = false;
  state.localTranscript = "";
  startBrowserRecognition();
  ui.listenButton.classList.add("adaptive-active");
  ui.status.textContent = "Ready…";

  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
  }).then((stream) => {
    state.stream = stream;
    const captureContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    state.audioContext = captureContext;

    const sourceNode = captureContext.createMediaStreamSource(stream);
    const processor = captureContext.createScriptProcessor(2048, 1, 1);
    const silentNode = captureContext.createGain();
    silentNode.gain.value = 0;

    sourceNode.connect(processor);
    processor.connect(silentNode);
    silentNode.connect(captureContext.destination);

    state.audioSourceNode = sourceNode;
    state.audioProcessor = processor;
    state.audioSilentNode = silentNode;

    processor.onaudioprocess = (event) => {
      if (!state.vadRunning) return;
      if (state.turnInFlight) return;
      if (state.elviSpeaking || state.recognitionPaused || performance.now() < state.voiceInputCooldownUntil) {
        state.speechActive = false;
        state.speechFrameCount = 0;
        state.silenceFrameCount = 0;
        state.turnSpeechFrameCount = 0;
        state.turnPeakRms = 0;
        state.prespeechChunks = [];
        state.turnAudioChunks = [];
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = convertFloat32ToPcm16(input, captureContext.sampleRate, 24000);
      if (!pcm16.length) return;

      const rms = calculateRms(input);
      const chunkBase64 = pcm16ToBase64(pcm16);
      const now = performance.now();
      const startThreshold = Math.max(0.016, state.noiseFloor * 2.15);
      const sustainThreshold = Math.max(0.010, state.noiseFloor * 1.55);

      if (!state.speechActive) {
        // Update ambient baseline only while not in speech.
        state.noiseFloor = Math.min(0.024, state.noiseFloor * 0.96 + rms * 0.04);
      }

      if (now < state.listenCooldownUntil) {
        return;
      }

      if (!state.speechActive) {
        state.prespeechChunks.push(chunkBase64);
        if (state.prespeechChunks.length > 5) {
          state.prespeechChunks.shift();
        }
      }

      if (!state.speechActive && rms >= startThreshold) {
        state.speechFrameCount += 1;
      } else if (!state.speechActive) {
        state.speechFrameCount = Math.max(0, state.speechFrameCount - 1);
      }

      const hasSpeechEnergy = rms >= sustainThreshold;

      if (state.speechActive && !hasSpeechEnergy) {
        state.silenceFrameCount += 1;
      } else if (state.speechActive) {
        state.silenceFrameCount = 0;
      }

      if (state.speechActive || state.speechFrameCount >= 3) {
        if (!state.speechActive) {
          if (state.elviSpeaking) {
            stopCurrentAudio();
          }
          state.speechActive = true;
          state.speechStartedAt = now;
          state.lastSpeechAt = now;
          state.silenceFrameCount = 0;
          state.turnSpeechFrameCount = 0;
          state.turnPeakRms = rms;
          state.localTranscript = "";
          state.turnAudioChunks = [...state.prespeechChunks];
          ui.status.textContent = "Listening…";
          setAvatarState("listening");
          state.prespeechChunks = [];
        }
        if (hasSpeechEnergy) {
          state.lastSpeechAt = now;
          state.turnSpeechFrameCount += 1;
        }
        state.turnPeakRms = Math.max(state.turnPeakRms || 0, rms);
        state.turnAudioChunks.push(chunkBase64);
        if (state.turnAudioChunks.length > 220) {
          state.turnAudioChunks = state.turnAudioChunks.slice(-220);
        }

        const isSilentTail = state.speechActive && state.silenceFrameCount >= 6 && now - state.lastSpeechAt > 520;
        const maxTurnReached = state.speechActive && now - state.speechStartedAt > 6500;
        if (isSilentTail || maxTurnReached) {
          const durationMs = now - state.speechStartedAt;
          const enoughSpeech = durationMs >= 360 && state.turnSpeechFrameCount >= 3 && state.turnPeakRms >= startThreshold * 0.82;
          state.speechActive = false;
          state.speechFrameCount = 0;
          state.silenceFrameCount = 0;
          state.turnSpeechFrameCount = 0;
          state.turnPeakRms = 0;
          state.prespeechChunks = [];
          state.listenCooldownUntil = now + (enoughSpeech ? 850 : 350);
          if (!enoughSpeech) {
            ui.status.textContent = "Ready…";
            setAvatarState("idle");
            return;
          }
          if (!claimVoiceTurn()) {
            return;
          }
          ui.status.textContent = "Processing…";
          setAvatarState("talking_neutral");
          sendWs({ type: "response.cancel" });
          sendWs({ type: "input_audio_buffer.clear" });
          state.micChunkBuffer = [];
          handleLocalVoiceTurnAfterRecognition();
        }
        return;
      }
    };
  }).catch((error) => {
    ui.status.textContent = describeMicError(error);
    stopAdaptiveListen();
    throw error;
  });
}

function stopAdaptiveListen() {
  state.vadRunning = false;
  state.autoListen = false;
  stopBrowserRecognition();
  clearTimeout(state.recognitionFinalTimer);
  state.recognitionFinalTimer = null;
  state.speechActive = false;
  state.prespeechChunks = [];
  state.turnAudioChunks = [];
  state.speechFrameCount = 0;
  state.silenceFrameCount = 0;
  state.turnSpeechFrameCount = 0;
  state.turnPeakRms = 0;
  state.speechStartedAt = 0;
  state.listenCooldownUntil = 0;

  if (state.audioProcessor) {
    try { state.audioProcessor.disconnect(); } catch {}
    state.audioProcessor.onaudioprocess = null;
    state.audioProcessor = null;
  }
  if (state.audioSourceNode) {
    try { state.audioSourceNode.disconnect(); } catch {}
    state.audioSourceNode = null;
  }
  if (state.audioSilentNode) {
    try { state.audioSilentNode.disconnect(); } catch {}
    state.audioSilentNode = null;
  }
  if (state.audioContext) {
    try { state.audioContext.close(); } catch {}
    state.audioContext = null;
  }
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }
  ui.listenButton.classList.remove("adaptive-active");
  ui.status.textContent = "Connected";
  setAvatarState("idle");
}

function calculateRms(input) {
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) {
    sum += input[i] * input[i];
  }
  return Math.sqrt(sum / Math.max(1, input.length));
}

function convertFloat32ToPcm16(input, inputRate, outputRate) {
  const source = inputRate === outputRate ? input : downsampleBuffer(input, inputRate, outputRate);
  const pcm = new Int16Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, source[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

function downsampleBuffer(buffer, inputRate, outputRate) {
  if (outputRate >= inputRate) {
    return buffer;
  }
  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function pcm16ToBase64(pcm) {
  const bytes = new Uint8Array(pcm.buffer);
  const chunkSize = 0x2000;
  const parts = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(""));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = reader.result;
      if (typeof value !== "string") {
        reject(new Error("Unable to read audio chunk"));
        return;
      }

      const content = value.split(",")[1] || "";
      resolve(content);
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read blob"));
    reader.readAsDataURL(blob);
  });
}

window.sendOptionChip = sendOptionChip;
window.sendComboNav = sendComboNav;


// ui1 (2026-10-16): bridge for the photo menu (apps/web/ui1.js). Taps, chat and voice share this cart;
// every cart render and every applied action is announced so the photo screens update live.
window.elviBridge = {
  state,
  addCartItem,
  removeCartItem,
  renderCart: () => renderCart(),
  lineTotal: (line) => getCartLineTotalCents(line),
  readback: (lines) => shortAddReadback(lines),
  lang: () => getEffectiveLanguage(),
  // v3menu: a menu-card add goes through Elvi's own add step (same validation + applyActions as her add_item tool),
  // and Elvi is told about it (typed history + live voice session) so her follow-ups and "otro igual" keep working.
  addFromMenu: (item, quantity = 1, modifiers = []) => menuCardAdd(item, quantity, modifiers),
  // cust1: verified login → prefill checkout + tell Elvi the name; own favorites offers
  setCustomer: (c) => { for (const k of ["name", "phone", "email"]) if (c?.[k]) { state.customer[k] = c[k]; const el = document.getElementById(`customer-${k}`); if (el && !el.value) el.value = c[k]; }
    if (c?.name) { sendWs({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: `The customer is signed in (verified phone). Their first name is ${c.name}. Greet them by name once.` }] } }); } },
  clearCustomer: () => { for (const k of ["name", "phone", "email"]) { state.customer[k] = ""; const el = document.getElementById(`customer-${k}`); if (el) el.value = ""; } },
  showFavorites: (fav) => showFavorites(fav),
  checkout: (opts) => doCheckout(opts),
  greet: (text) => { if (ui.reply) ui.reply.textContent = text; try { (state.chatFallbackHistory = state.chatFallbackHistory || []).push({ role: "assistant", text }); } catch {} },
  // ux1: Hablar / barge-in — cancel TTS and yield to listening
  stopAudio: () => { try { stopCurrentAudio(); } catch {} },
  // warm1: sheet step asks must be HEARD (xAI TTS / speakLocalText), bubble mirrors
  speak: (text, opts) => { try { return speakLocalText(String(text || ""), getEffectiveLanguage(), opts || {}); } catch (e) { return Promise.resolve(); } },
  isSpeaking: () => !!state.elviSpeaking,
  haloState: () => (document.getElementById("elvi-halo")?.dataset?.state || "idle"),
  hasSelectedLanguage,
  setLanguage: (mode) => setLanguageMode(mode),
  startVoice: () => {
    if (!hasSelectedLanguage()) {
      if (!isV3MenuUi()) {
        if (ui.reply) ui.reply.textContent = LANGUAGE_PROMPT_BILINGUAL;
        try { startLanguagePromptLoop(); } catch {}
      }
      return Promise.reject(new Error("language"));
    }
    if (state.vadRunning) return Promise.resolve();
    return startAdaptiveListen();
  },
  toggleVoice: () => {
    if (!hasSelectedLanguage()) {
      if (!isV3MenuUi()) {
        if (ui.reply) ui.reply.textContent = LANGUAGE_PROMPT_BILINGUAL;
        try { startLanguagePromptLoop(); } catch {}
      }
      return;
    }
    if (state.vadRunning) stopAdaptiveListen();
    else startAdaptiveListen().catch((error) => {
      if (ui.status) ui.status.textContent = describeMicError(error);
      setAvatarState("idle");
    });
  },
};
function menuCardAdd(item, quantity, modifiers) {
  const check = validateAddItemToolArgs({ itemId: item?.id, quantity, modifiers });
  if (!check.ok) return { ok: false, missing: (check.requiredGroups || []).map((g) => g.groupName), message: check.message };
  applyActions([{ type: "add_item", itemId: item.id, quantity, modifiers }]);
  const line = state.cart[state.cart.length - 1];
  const es = getEffectiveLanguage() !== "en";
  const rb = shortAddReadback([{ item, quantity, modifiers }]); // already ends with "Anything else?"
  const said = `${es ? "Agregué" : "Added"} ${withDefaultNote(rb, [{ item, quantity, modifiers }]) || `${item.name}. ${es ? "¿Algo más?" : "Anything else?"}`}`;
  try { (state.chatFallbackHistory = state.chatFallbackHistory || []).push({ role: "assistant", text: said }); } catch {}
  sendWs({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: `The customer added from the menu: ${describeCartLine(line)}. Cart now has ${getCartItemCount()} item(s). Do not add it again.` }] } });
  if (ui.reply) ui.reply.textContent = said;
  try { window.dispatchEvent(new CustomEvent("elvi:menu-add", { detail: { itemId: item.id, said } })); } catch {}
  return { ok: true, said };
}
{
  const baseRenderCart = renderCart;
  renderCart = function (...args) {
    const out = baseRenderCart.apply(this, args);
    window.dispatchEvent(new CustomEvent("elvi:cart"));
    return out;
  };
  const baseApplyActions = applyActions;
  applyActions = function (actions, ...rest) {
    const out = baseApplyActions.call(this, actions, ...rest);
    try { window.dispatchEvent(new CustomEvent("elvi:actions", { detail: { actions: Array.isArray(actions) ? actions : [] } })); } catch {}
    return out;
  };
}


/* ui4: corrections ("actually make it only rice", "mejor de harina", "sin frijoles") edit the most recent
   cart line that has a matching choice, instead of starting a new item. */
const UI4_STRONG = /\b(actually|instead|make it|change|switch|mejor|cambia(lo|la|r|le)?|en vez|en lugar|que sea)\b/;
const UI4_SOFT = /\b(solo|only|just|sin|without)\b/;
function ui4Plain(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
function ui4CorrectionText(text) {
  return ui4Plain(text)
    .replace(/\b(sin|no|without)\s+(los\s+)?(frijoles|beans)\b/g, "solo arroz")
    .replace(/\b(sin|no|without)\s+(el\s+)?(arroz|rice)\b/g, "solo frijoles")
    .replace(/\b(only|just)\s+rice\b/g, "solo arroz").replace(/\b(only|just)\s+beans\b/g, "solo frijoles")
    // change1: "verde not asada" / "en vez de asada": drop the old choice so it can't win the match.
    .replace(/\b(not|instead of|rather than|en vez de|en lugar de|y no)\s+(the\s+|la\s+|el\s+|los\s+|las\s+)?[a-z]+\b/g, " ")
    .replace(/\s+/g, " ").trim();
}
// change1: fuzzy fallback: a single word that names exactly one option of the group ("verde" -> "Medium Salsa Verde").
const UI4_GENERIC = new Set(["salsa", "mild", "medium", "spicy", "picante", "with", "side", "extra", "online", "options", "orden", "order", "carne", "meat"]);
function ui4TokenPick(g, t) {
  const words = new Set(t.split(" ").filter((w) => w.length >= 4 && !UI4_GENERIC.has(w)));
  const hits = (g.options || []).filter((o) => ui4Plain(o.name || o).split(" ").some((w) => words.has(w)));
  return hits.length === 1 ? hits[0] : null;
}
function ui4OptionPhrases(name) {
  const raw = String(name || "").replace(/\s*\(\+?\$[\d.]+\)\s*/g, " ").replace(/^\(\w+\)\s*/, "").replace(/^\d+\s*x\s+/i, "").replace(/\*+/g, "").trim();
  const out = new Set([ui4Plain(raw)]);
  raw.split(" / ").forEach((p) => out.add(ui4Plain(p)));
  out.add(ui4Plain(raw.replace(/\s+-\s+[^/]*$/, "")));
  out.add(ui4Plain(raw.split(" / ")[0].replace(/\s+-\s+\S+$/, "")));
  return [...out].filter((p) => p.length >= 4);
}
function tryCartCorrection(text) {
  if (!state.cart.length) return false;
  const t = ui4CorrectionText(text);
  if (!UI4_STRONG.test(t) && !(UI4_SOFT.test(t) && t.split(" ").length <= 4)) return false;
  for (let li = state.cart.length - 1; li >= 0; li -= 1) {
    const line = state.cart[li];
    const groups = (line.item?.modifierGroups || []);
    const mods = Array.isArray(line.modifiers) ? line.modifiers : [];
    const modOf = (g) => mods.findIndex((m) => m.groupId === g.id || m.groupName === g.name || m.step === g.name || (g.options || []).some((o) => (o.name || o) === m.option));
    const changes = [];
    for (const g of groups) {
      if ((g.maxSelections ?? 1) !== 1) continue;
      // Two identical meat groups ("Item #1 / #2 meat"): which one is ambiguous, leave it to the conversation.
      if (groups.filter((x) => (x.options || []).length === (g.options || []).length && x.name !== g.name && /carne|meat/i.test(x.name)).length && /carne|meat/i.test(g.name)) continue;
      let best = null; let bestLen = 0;
      for (const o of g.options || []) {
        for (const ph of ui4OptionPhrases(o.name || o)) {
          if (new RegExp(`(^|\\s)${ph.replace(/\s+/g, "\\s+")}(\\s|$)`).test(t) && ph.length > bestLen) { best = o; bestLen = ph.length; }
        }
      }
      if (!best && modOf(g) >= 0) best = ui4TokenPick(g, t); // only re-pick a choice the line already has
      if (!best) continue;
      const at = modOf(g);
      const cur = at >= 0 ? mods[at] : null;
      if (cur && cur.option === (best.name || best)) continue;
      changes.push({ g, o: best, at });
    }
    if (!changes.length) continue;
    const next = [...mods];
    for (const { g, o, at } of changes) {
      const name = o.name || o;
      const priceDeltaCents = Number(o.priceDeltaCents || 0);
      const repl = at >= 0
        ? { ...next[at], option: name, ...("optionId" in next[at] ? { optionId: o.id } : {}), ...("priceDeltaCents" in next[at] ? { priceDeltaCents } : {}) }
        : { groupId: g.id, groupName: g.name, option: name, optionId: o.id, priceDeltaCents, quantity: 1 };
      if (at >= 0) next[at] = repl; else next.push(repl);
    }
    line.modifiers = next;
    state.lastSelectedItem = line.item;
    renderCart();
    const es = getEffectiveLanguage() === "es";
    const reply = `${es ? "Cambiado." : "Changed."} ${shortAddReadback([line])}`;
    ui.reply.textContent = formatCentsForSpeech(reply);
    try { (state.chatFallbackHistory = state.chatFallbackHistory || []).push({ role: "customer", text }, { role: "assistant", text: reply }); } catch {}
    markLocalTurnReady();
    void speakLocalText(reply, getEffectiveLanguage());
    return true;
  }
  return false;
}

// fav1: repeat customers (≥3 past orders): "your usual" or top 3 picks, today's prices; a tap (or "sí" in chat) adds exactly that.
// No name / address / delivery nudge in the app (phone isn't verified).
const favChecked = new Set();
async function checkFavorites(phoneRaw) {
  const phone = String(phoneRaw || "").replace(/\D/g, "").slice(-10);
  if (phone.length !== 10 || favChecked.has(phone)) return;
  favChecked.add(phone);
  try {
    const r = await fetch(`/api/${state.tenantSlug}/favorites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, language: getEffectiveLanguage(), orderSessionId: state.orderSessionId }) });
    const fav = await r.json().catch(() => ({}));
    showFavorites(fav);
  } catch {}
}
// cust1: same offers UI for a verified session's own favorites (greeting may use the customer's first name)
function showFavorites(fav) {
  try {
    if (!fav?.kind || !fav.greeting) return;
    ui.reply.textContent = fav.greeting;
    state.chatFallbackHistory = Array.isArray(state.chatFallbackHistory) ? state.chatFallbackHistory : [];
    state.chatFallbackHistory.push({ role: "assistant", text: fav.greeting });
    let box = document.getElementById("fav-offers");
    if (!box) { box = document.createElement("div"); box.id = "fav-offers"; box.className = "fav-offers"; ui.reply.insertAdjacentElement("afterend", box); }
    box.replaceChildren(...fav.offers.map((o) => { const b = document.createElement("button"); b.type = "button"; b.className = "fav-offer";
      b.textContent = `${o.label} · $${(o.cents / 100).toFixed(2)}`;
      b.onclick = () => { applyActions(o.actions.map((a) => { const item = state.menu.find((m) => m.id === a.itemId); return { ...a, modifiers: typeof chatModifiersForCart === "function" ? chatModifiersForCart(item, a.modifiers) : a.modifiers }; })); renderCart(); box.remove(); };
      return b; }));
    void speakLocalText(fav.greeting, getEffectiveLanguage());
  } catch {}
}

// reply1 (Carlos): Elvi ALWAYS answers. If a live-voice turn gets no reply (tool error, server restart, dropped
// response) within 12 s, she says a short fallback and the turn is released.
let replyWatchdog = null;
function fallbackReplyText() {
  return getEffectiveLanguage() === "es" ? "Perdón, se me fue la señal un segundo. ¿Me lo repite, por favor?" : "Sorry, I lost you for a second. Could you say that again?";
}
function clearReplyWatchdog() { if (replyWatchdog) { clearTimeout(replyWatchdog); replyWatchdog = null; } }
function armReplyWatchdog(ms = 12000) {
  clearReplyWatchdog();
  replyWatchdog = setTimeout(() => { replyWatchdog = null; void speakFallbackReply(); }, ms);
}
async function speakFallbackReply() {
  clearReplyWatchdog();
  if (state.elviSpeaking) return;
  const text = fallbackReplyText();
  try { sendWs({ type: "response.cancel" }); } catch {}
  state.turnInFlight = false;
  ui.reply.textContent = text;
  ui.status.textContent = "Connected";
  try { await speakLocalText(text, getEffectiveLanguage()); } catch {}
}

// reply1: typed / fallback "change X to Y" on cart items → same resolver update the live voice tool uses, then confirm.
const MODIFY_CUE = /\b(?:make (?:it|them|those|that)|change|switch|instead|actually|can you (?:make|change)|cambia(?:r|lo|los|las)?|c[aá]mbia(?:lo|los|las|me)|mejor|que sean|hazlo|hazlos|en vez de|en lugar de)\b/i;
async function handleLocalModifyTurn(text) {
  state.turnInFlight = true; setAvatarState("thinking");
  const es = getEffectiveLanguage() === "es";
  let say = "";
  try {
    const r = await handleToolCall("update_order_item", { reference: text, change_modifiers: [text] });
    const actions = r?.actions || (r?.action ? [r.action] : []);
    if (actions.length) {
      applyActions(actions); renderCart();
      const idx = actions[0].cartIndex ?? state.cart.length - 1;
      const line = describeCartLine(state.cart[idx] || state.cart[state.cart.length - 1]);
      say = (es ? `Listo, quedó así: ${line}. ¿Algo más?` : `Done, it's now: ${line}. Anything else?`);
    } else say = r?.output?.message || "";
  } catch (e) { console.warn("[MODIFY] failed", e); }
  if (!say) { state.turnInFlight = false; return handleChatFallbackTurn(text); }
  state.turnInFlight = false;
  ui.reply.textContent = formatCentsForSpeech(say);
  state.chatFallbackHistory = Array.isArray(state.chatFallbackHistory) ? state.chatFallbackHistory : [];
  state.chatFallbackHistory.push({ role: "customer", text }, { role: "assistant", text: say });
  try { await speakLocalText(say, getEffectiveLanguage()); } catch {}
}
