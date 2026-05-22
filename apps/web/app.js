import { mountElviAvatar } from "./avatar-elvi-glb.js";

// ── App state ─────────────────────────────────────────────────────────────
const state = {
  tenant: null,
  tenantSlug: resolveTenantSlug(),
  sessionId: "",
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
  lastSpeechAt: 0,
  noiseFloor: 0.008,
  speechFrameCount: 0,
  silenceFrameCount: 0,
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
};

// Hoisted early to avoid TDZ errors during boot() / language prompt loop
let _sharedAudioCtx      = null;
let _currentAudioSource  = null;
let _queuedSources       = [];
let _nextPlayTime        = 0;

// ── Mount 3-D Elvi avatar ──────────────────────────────────────────────────
const avatarCanvas = document.getElementById("avatar-canvas");
console.log("[AVATAR] Canvas element found:", !!avatarCanvas);
const elvi = mountElviAvatar(avatarCanvas);
console.log("[AVATAR] Avatar mounted:", !!elvi);

function setAvatarState(s) {
  if (!elvi) {
    console.error("[AVATAR] Avatar not initialized, cannot set state");
    return;
  }
  elvi.setState(s);
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
  const cleanText = formatCentsForSpeech(text, language).trim();
  if (!cleanText) {
    return;
  }

  if (typeof options.shouldContinue === "function" && !options.shouldContinue()) {
    return;
  }
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

function updateLanguageGate() {
  const selected = hasSelectedLanguage();
  if (ui.promptInput) {
    ui.promptInput.disabled = !selected;
    ui.promptInput.placeholder = selected
      ? (getEffectiveLanguage() === "es" ? "Escribe tu orden..." : "Type your order...")
      : "Select language first...";
  }
  if (ui.listenButton) {
    ui.listenButton.disabled = !selected;
    ui.listenButton.setAttribute("aria-disabled", selected ? "false" : "true");
  }
  if (!selected && ui.reply) {
    ui.reply.textContent = LANGUAGE_PROMPT_BILINGUAL;
    startLanguagePromptLoop();
  }
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
    attachUiHandlers();
    renderSelectedPreview(null);
    updateLanguageGate();
    console.log("[BOOT] Loading tenant branding");
    await loadTenantBranding();
    console.log("[BOOT] Loading menu");
    await loadMenu();
    console.log("[BOOT] Building menu sections");
    buildMenuSections();
    renderMenuExplorer();
    console.log("[BOOT] Opening realtime session early (for language prompt)");
    // Start session early so we can use proper xAI voice for the language selection prompt
    openRealtimeSession().catch(() => {});
    ui.status.textContent = "Select language to begin";
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
      ui.engine.textContent = "";
      syncRealtimeOrderContext();
      return;
    }

    if (payload.type === "response.created") {
      state.turnInFlight = true;
      state.activeResponseId = payload.response?.id || "";
      state.activeReplyText = "";
      state.pendingActions = [];
      ui.status.textContent = "Processing…";
      return;
    }

    if (payload.type === "input_audio_buffer.speech_started") {
      stopCurrentAudio();
      sendWs({ type: "response.cancel" });
      return;
    }

    if (payload.type === "input_audio_buffer.speech_stopped") {
      sendWs({ type: "response.create" });
      return;
    }

    if (payload.type === "response.output_audio.delta" && payload.delta) {
      console.log("[AUDIO] Received output_audio.delta, type:", typeof payload.delta, "length:", String(payload.delta).length);
      queuePcmDeltaForPlayback(payload.delta);
      return;
    }

    if ((payload.type === "response.output_audio_transcript.delta" || payload.type === "response.output_text.delta") && payload.delta) {
      state.activeReplyText += String(payload.delta || "");
      ui.reply.textContent = formatCentsForSpeech(state.activeReplyText);
      setAvatarState(detectMood(state.activeReplyText));
      return;
    }

    if (payload.type === "response.function_call_arguments.done") {
      const result = await handleToolCall(payload.name, payload.arguments || "{}");
      const actions = result.actions || (result.action ? [result.action] : []);
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
      state.turnInFlight = false;
      ui.status.textContent = "Connected";
      ui.engine.textContent = "";
      if (!state.elviSpeaking) {
        setAvatarState("idle");
      }

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
    ? "OUTPUT_LANGUAGE_LOCK=Spanish. Responde solo en español. Frases cortas y naturales: 'Agregado.', 'Quitado.', '¿Algo más?', '¿Para recoger o entrega?'. Nunca mezcles idiomas en una misma respuesta salvo nombres exactos del menú."
    : "OUTPUT_LANGUAGE_LOCK=English. Reply only in English. Keep replies short and natural: 'Added.', 'Removed.', 'Anything else?', 'Pickup or delivery?'. Never mix languages in one reply except exact menu item names.";

  return (
    "You are Elvi, the fast, confident, direct order taker at Cocina Elvis.\n\n" +
    "Your only job is to take accurate orders. Speak like experienced restaurant staff — short, clear, warm but efficient. Never make small talk, never upsell, never explain the app or how to use it.\n\n" +
    "Core principles:\n" +
    "- The 'Current Order State' provided below is the single source of truth. Always trust it over your memory.\n" +
    "- When the customer says something unclear, changes their mind, or goes off-script, acknowledge naturally in one short sentence and steer back to the current order or the next logical choice. Recovery must feel human.\n" +
    "- Builds and combos (pack meals, etc.) are handled conversationally. You decide what question to ask next based on what has already been decided. You do NOT follow a rigid external script.\n" +
    "- After any successful change, give a tiny confirmation ('Added.', 'Got the two asada.', 'Removed it.') then ask 'Anything else?' or move on.\n" +
    "- Only ask for name, phone, address, or fulfillment when the customer is finishing or the order is otherwise complete.\n\n" +
    "Tool usage:\n" +
    "- Use the tools (add_to_order, update_order_item, remove_from_order, etc.) for every real change to the order.\n" +
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
      turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 300, prefix_padding_ms: 250 },
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

function getCartItemCount() {
  return state.cart.reduce((sum, line) => sum + line.quantity, 0);
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
    const isSelectionStep = step && (
      step.selection_type === "multiple" ||
      step.title.toLowerCase().includes("option") ||
      step.title.toLowerCase().includes("choice") ||
      step.title.toLowerCase().includes("opcion")
    );

    // Special case: "siguiente" or "next" always advances the current guide step when a guide is active
    const isNextWord = normalized.includes("siguiente") || normalized.includes("next");

    if (isSelectionStep || isNextWord) {
      const oldStepNum = state.currentGuideStep;
      const stepObj = step || { title: "current step" };
      state.currentGuideStep++;
      state.stepCompletionNote = `User just completed step ${oldStepNum} by saying "${text}". Do not re-ask about the previous step. Now on step ${state.currentGuideStep}: "${state.currentBuildGuide.steps[state.currentGuideStep-1]?.title}".`;
      updateBuildVisuals({});
      syncRealtimeOrderContext();

      // Force the model to generate a response for the new step right away.
      // This makes typing "siguiente" advance the conversation the same way the button does.
      if (state.ws && state.ws.readyState === WebSocket.OPEN && state.xaiSessionReady) {
        sendWs({ type: "response.create" });
      }

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
      description: "Set the order to pickup or delivery.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["PICKUP", "DELIVERY"] }
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

  const text = getResolverToolText(name, args);
  const response = await fetch(`/api/${state.tenantSlug}/menu/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      language: getEffectiveLanguage(),
      actionHint: name,
      toolArgs: args,
      cart: buildResolverCartSnapshot(),
      comboState: state.pendingComboState || undefined
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
  if (!result.guide) {
    const comboAction = comboBuildingActionFromResolver(result);
    if (comboAction) {
      actionList.unshift(comboAction);
    }
  }

  if (result.comboState && result.comboStep) {
    state.pendingComboState = result.comboState;
  } else if (result.reason === "build_cancelled") {
    state.pendingComboState = null;
    state.pendingComboPreview = null;
    state.lastComboAnimationKey = "";
    state.currentBuildGuide = null;
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
    state.currentBuildGuide = result.guide;
    state.currentGuideStep = 1;  // Start at first step of the guide
    state.pendingComboState = null; // Prefer guide-driven flow over old resolver state
  }

  if (!comboAction && !actionList.length && !state.pendingComboState && ["unknown_menu_item", "unknown_cart_item"].includes(result.reason)) {
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

  state.turnInFlight = true;
  state.lastUserText = text;
  ui.status.textContent = "Processing…";
  try {
    const result = await resolveOrderToolWithMenuBrain("add_item", { itemQuery: text });
    const actions = result?.actions || [];
    if (actions.length) {
      applyActions(actions);
    }
    const output = result?.output || {};
    const fallback = getEffectiveLanguage() === "es" ? "Listo." : "Done.";
    const reply = output.message || output.orderSummary || fallback;
    ui.reply.textContent = formatCentsForSpeech(reply);
    await speakLocalText(reply, getEffectiveLanguage());
    pulseAvatarState(actions.some((action) => action.type === "add_item") ? "happy" : "questioning", 1200, "idle");
    return true;
  } catch (error) {
    ui.status.textContent = error instanceof Error ? error.message : "Resolver error";
    setAvatarState("frustrated");
    return false;
  } finally {
    state.turnInFlight = false;
    ui.status.textContent = "Connected";
  }
}

async function handleToolCall(name, argsJson) {
  const args = safeJsonParse(argsJson || "{}");
  if (name === "check_delivery_zone") {
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

  const exact = options.find((opt) => String(opt) === raw);
  if (exact) return String(exact);

  const lower = raw.toLowerCase();
  const ci = options.find((opt) => String(opt).toLowerCase() === lower);
  if (ci) return String(ci);

  const key = normalizeOptionKey(raw);
  if (!key) return null;
  const normalized = options.find((opt) => normalizeOptionKey(opt) === key);
  if (normalized) return String(normalized);

  const looseKey = normalizeLooseOptionKey(raw);
  const loose = options.find((opt) => normalizeLooseOptionKey(opt) === looseKey);
  if (loose) return String(loose);

  const scored = options
    .map((opt) => ({ option: String(opt), score: scoreModifierOptionMatch(opt, raw) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.option || null;
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
  const aliases = new Set([
    normalizeLooseOptionKey(cleaned),
    normalizeLooseOptionKey(cleaned.replace(/\([^)]*\)/g, " "))
  ]);

  for (const part of cleaned.split(/\s*\/\s*|\s+-\s+|\s+or\s+|\s+y\s+|\s+and\s+/i)) {
    const key = normalizeLooseOptionKey(part.replace(/\([^)]*\)/g, " "));
    if (key) aliases.add(key);
  }

  const tokens = significantModifierTokens(cleaned);
  for (const token of tokens) {
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
    [/\b(homemade|home made|handmade|hand made|comal|corn)\b/, getTortillaOptionHint(item, "co")],
    [/\b(flour|harina)\b/, getTortillaOptionHint(item, "hr")],
    [/\b(street|taquero|taquera)\b/, getTortillaOptionHint(item, "st")]
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
    [/\b(with beans|con frijoles|frijoles|beans)\b/, "Con Frijoles / With Beans"],
    [/\b(with rice|con arroz|arroz|rice)\b/, "Con Arroz / With Rice"],
    [/\b(with cheese|con queso|queso fresco|fresh cheese)\b/, "Con Queso Fresco / With Cheese"],
    [/\b(extra queso|extra cheese)\b/, "EXTRA QUESO / Cheese"]
  ]);
  if (withModifier) modifiers.push(withModifier);

  const deluxe = inferOptionFromMap(deluxeGroup, query, [
    [/\bdeluxe\b/, "DELUXE"]
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
  if (/\b(with beans|con frijoles|frijoles|beans)\b/.test(normalized)) parts.push("with beans");
  if (/\b(with rice|con arroz|arroz|rice)\b/.test(normalized)) parts.push("with rice");
  if (/\b(with cheese|con queso|queso fresco|fresh cheese)\b/.test(normalized)) parts.push("with cheese");
  if (/\bdeluxe\b/.test(normalized) && !customerDeclinesDeluxe(normalized)) parts.push("deluxe");
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
    const validOptionSet = new Set((group.options || []).map((o) => String(o)));
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
    if (state.vadRunning) {
      stopAdaptiveListen();
    } else {
      startAdaptiveListen().catch((error) => {
        ui.status.textContent = describeMicError(error);
        setAvatarState("idle");
      });
    }
  });

  // Cart drawer
  ui.cartToggle.addEventListener("click", openCart);
  ui.cartClose.addEventListener("click", closeCart);
  ui.drawerBackdrop.addEventListener("click", closeCart);
  ui.modifierClose?.addEventListener("click", closeModifierModal);
  ui.modifierModal?.addEventListener("click", (event) => {
    if (event.target === ui.modifierModal) closeModifierModal();
  });
  ui.modifierAdd?.addEventListener("click", () => {
    handleModifierStepAdvance();
  });

  ui.promptForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!hasSelectedLanguage()) {
      ui.reply.textContent = LANGUAGE_PROMPT_BILINGUAL;
      startLanguagePromptLoop();
      return;
    }
    const text = ui.promptInput.value.trim();
    if (!text) {
      return;
    }

    // Check if user just finished a multi-select guided step (advances state + syncs model)
    // We no longer suppress the turn here. We let the message go through so the model
    // can see the exact phrase ("siguiente", "ya", etc.) in the conversation history.
    // The strong prompt will tell the model what to do when it sees the phrase.
    handleMultiSelectCompletion(text);

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
    if (!hasSelectedLanguage()) {
      restartLanguagePromptLoop();
    }
  });

  window.addEventListener("keydown", () => {
    if (!hasSelectedLanguage()) {
      restartLanguagePromptLoop();
    }
  });

  ui.fulfillment.addEventListener("change", () => {
    state.fulfillment = ui.fulfillment.value === "DELIVERY" ? "DELIVERY" : "PICKUP";
    syncRealtimeOrderContext();
  });

  ui.checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.customer.name = ui.name.value.trim();
    state.customer.phone = ui.phone.value.trim();
    state.customer.email = ui.email.value.trim();
    state.customer.address = ui.address.value.trim();

    try {
      const response = await fetch(`/api/${state.tenantSlug}/orders/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          customer: state.customer
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Checkout failed");
      }

      const result = await response.json();
      window.location.href = result.checkoutUrl;
    } catch (error) {
      ui.status.textContent = error instanceof Error ? error.message : "Checkout failed";
    }
  });
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
  if (!SpeechCtor) {
    return;
  }

  try {
    const recognition = new SpeechCtor();
    recognition.lang = getEffectiveLanguage() === "es" ? "es-US" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let combined = "";
      for (let i = 0; i < event.results.length; i += 1) {
        combined += `${event.results[i][0]?.transcript || ""} `;
      }
      state.localTranscript = combined.trim();
    };

    recognition.onerror = () => {
      // Keep silent fallback to audio_end if local recognition fails.
    };

    recognition.onend = () => {
      state.recognition = null;
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

function sendOptionChip(btn) {
  const text = btn.textContent.trim();
  if (!text) return;
  if (!state.pendingComboState && (!state.ws || state.ws.readyState !== WebSocket.OPEN)) return;
  if (!sendUserTurn(text)) {
    return;
  }
  const allChips = btn.closest("ul")?.querySelectorAll(".combo-option-chip");
  allChips?.forEach((c) => c.classList.remove("selected"));
  btn.classList.add("selected");
  pulseAvatarState("talking_neutral", 900, "idle");
}

function sendUserTurn(text) {
  if (!text) {
    return false;
  }

  // Universal handling for completion phrases on multi-select guide steps
  // This makes voice, direct typing, and local resolve all behave the same
  if (handleMultiSelectCompletion(text)) {
    return true;
  }
  if (!state.pendingComboState && (!state.ws || state.ws.readyState !== WebSocket.OPEN)) {
    return false;
  }
  if (!hasSelectedLanguage()) {
    ui.reply.textContent = LANGUAGE_PROMPT_BILINGUAL;
    startLanguagePromptLoop();
    return false;
  }
  const useLocalResolver = state.pendingComboState || shouldResolveStructuredBuildLocally(text);
  if (useLocalResolver && state.elviSpeaking && !state.turnInFlight) {
    stopCurrentAudio();
    state.elviSpeaking = false;
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
  if (useLocalResolver) {
    void resolvePendingComboTurnLocally(text);
    return true;
  }
  state.turnInFlight = true;
  state.lastUserText = text;
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
  if (/\b(pack meal|pack meals|meal pack|meal packs|meals pack|paquete|paquetes)\b/.test(normalized)) return true;
  if (/\b(combo|combos|combinacion|combinaciones)\b/.test(normalized)) return true;
  const quantity = quantityPattern();
  return new RegExp(`\\b${quantity}\\s+(?:pack\\s+)?meals?\\b|\\b${quantity}\\s+meals?\\s+pack\\b|\\b${quantity}\\s+pack\\b`, "i").test(normalized);
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

function applyActions(actions) {
  let addedItem = false;
  for (const action of actions) {
    if (action.type === "combo_building") {
      const comboItem = findComboActionItem(action);
      if (comboItem) {
        state.lastSelectedItem = comboItem;
        state.pendingComboPreview = {
          item: comboItem,
          quantity: 1,
          modifiers: (action.selections || []).map((label) => ({ option: String(label), quantity: 1 })),
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
      const menuItem = state.menu.find((item) => item.id === action.itemId)
        || menuItemFromResolverSelection(action.selectedItem, action.itemId);
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
      updateCartItem(action.itemId, Number(action.quantity) || 1, action.cartIndex, action.modifiers);
      continue;
    }

    if (action.type === "set_fulfillment") {
      state.fulfillment = action.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP";
      ui.fulfillment.value = state.fulfillment;
      continue;
    }

    if (action.type === "set_address" && action.address) {
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

  nameEl.textContent = itemName;
  progressEl.textContent = `${step}/${totalSteps}`;

  // Confirmed selections — shown as small checkmarked pills
  listEl.textContent = "";
  for (const selection of selections) {
    const item = document.createElement("li");
    item.className = "selection-done";
    item.textContent = `✓ ${selection}`;
    listEl.appendChild(item);
  }

  // Current step options — shown as tappable chips
  if (askEl && stepLabelEl && optionsEl && stepOptions && stepOptions.length > 0) {
    stepLabelEl.textContent = stepName || "";
    optionsEl.textContent = "";
    for (const option of stepOptions) {
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
    completedSelections: Array.isArray(raw.selections) ? raw.selections : 
                         Array.isArray(raw.completed) ? raw.completed : [],
    currentOptions: Array.isArray(raw.stepOptions) ? raw.stepOptions :
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
        [], // selections can be enhanced later
        guideStep.title,
        guideStep.options ? guideStep.options.map(o => o.name || o) : []
      );

      if (elvi && typeof elvi.performBuildStep === "function") {
        void elvi.performBuildStep({
          step: state.currentGuideStep,
          totalSteps: guide.steps.length,
          stepName: guideStep.title,
          option: "",
          selections: []
        });
      }
      return;
    }
  }

  // Fallback to old behavior when no guide is active
  const p = normalizeBuildProgress(progressInput);
  if (!p || !p.active) {
    const tracker = document.getElementById("combo-tracker");
    if (tracker) tracker.classList.add("is-hidden");
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
  document.getElementById("combo-tracker")?.classList.add("is-hidden");
}

function sendComboNav(direction) {
  // If a guide is active, prefer advancing the guide step for consistency across all combos
  if (state.currentBuildGuide && state.currentGuideStep) {
    if (direction === "next") {
      state.currentGuideStep++;
      updateBuildVisuals({});
      syncRealtimeOrderContext();
      return;
    } else if (direction === "back" && state.currentGuideStep > 1) {
      state.currentGuideStep--;
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
  renderSelectedPreview(state.lastSelectedItem);
  renderSelectedItemsPanel();
  syncRealtimeOrderContext();
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
  state.speechStartedAt = 0;
  state.listenCooldownUntil = 0;
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
      if (!state.vadRunning || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      if (state.turnInFlight) return;

      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = convertFloat32ToPcm16(input, captureContext.sampleRate, 24000);
      if (!pcm16.length) return;

      const rms = calculateRms(input);
      const chunkBase64 = pcm16ToBase64(pcm16);
      const now = performance.now();
      const startThreshold = Math.max(0.02, state.noiseFloor * 2.6);
      const sustainThreshold = Math.max(0.014, state.noiseFloor * 1.9);

      if (!state.speechActive) {
        // Update ambient baseline only while not in speech.
        state.noiseFloor = Math.min(0.03, state.noiseFloor * 0.92 + rms * 0.08);
      }

      if (now < state.listenCooldownUntil) {
        return;
      }

      if (!state.speechActive) {
        state.prespeechChunks.push(chunkBase64);
        if (state.prespeechChunks.length > 3) {
          state.prespeechChunks.shift();
        }
      }

      if (!state.speechActive && rms >= startThreshold) {
        state.speechFrameCount += 1;
      } else if (!state.speechActive) {
        state.speechFrameCount = Math.max(0, state.speechFrameCount - 1);
      }

      if (state.speechActive && rms < sustainThreshold) {
        state.silenceFrameCount += 1;
      } else if (state.speechActive) {
        state.silenceFrameCount = 0;
      }

      if (state.speechActive || state.speechFrameCount >= 3) {
        state.lastSpeechAt = now;
        if (!state.speechActive) {
          if (state.elviSpeaking) {
            stopCurrentAudio();
          }
          state.speechActive = true;
          state.speechStartedAt = now;
          state.silenceFrameCount = 0;
          ui.status.textContent = "Listening…";
          setAvatarState("listening");
          for (const buffered of state.prespeechChunks) {
            if (state.xaiSessionReady) {
              sendWs({ type: "input_audio_buffer.append", audio: buffered });
            } else {
              state.micChunkBuffer.push(buffered);
            }
          }
          state.prespeechChunks = [];
        }
        if (state.xaiSessionReady) {
          sendWs({ type: "input_audio_buffer.append", audio: chunkBase64 });
        } else {
          state.micChunkBuffer.push(chunkBase64);
        }
        if (state.micChunkBuffer.length > 240) {
          state.micChunkBuffer = state.micChunkBuffer.slice(-240);
        }
        return;
      }

      const isSilentTail = state.speechActive && state.silenceFrameCount >= 3 && now - state.lastSpeechAt > 260;
      const maxTurnReached = state.speechActive && now - state.speechStartedAt > 7000;
      if (isSilentTail || maxTurnReached) {
        state.speechActive = false;
        state.speechFrameCount = 0;
        state.silenceFrameCount = 0;
        state.turnInFlight = true;
        state.prespeechChunks = [];
        state.listenCooldownUntil = now + 500;
        sendWs({ type: "response.create" });
        ui.status.textContent = "Processing…";
        setAvatarState("talking_neutral");
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
  state.speechActive = false;
  state.prespeechChunks = [];
  state.speechFrameCount = 0;
  state.silenceFrameCount = 0;
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
