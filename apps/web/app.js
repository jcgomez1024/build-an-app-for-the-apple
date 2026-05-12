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
  language: "en",
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
  lastComboAnimationKey: "",
  autoListen: false,
  elviSpeaking: false,
  vadRunning: false,
  turnInFlight: false,
  audioContext: null,
  audioProcessor: null,
  audioSourceNode: null,
  audioSilentNode: null,
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

function setLanguageMode(mode) {
  state.language = mode === "es" ? "es" : "en";

  ui.langPills.forEach((pill) => {
    pill.classList.toggle("pill-active", pill.dataset.lang === state.language);
  });

  renderMenuExplorer();
  renderCart();
  syncRealtimeOrderContext();
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
    console.log("[BOOT] Loading tenant branding");
    await loadTenantBranding();
    console.log("[BOOT] Loading menu");
    await loadMenu();
    console.log("[BOOT] Building menu sections");
    buildMenuSections();
    renderMenuExplorer();
    console.log("[BOOT] Opening realtime session");
    await openRealtimeSession();
    console.log("[BOOT] Boot complete");
    ui.status.textContent = "Connected";
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
        lines.push({ groupId: group.id, groupName: group.name, option, quantity: qty });
      }
    }
  }
  return lines;
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
    Array.isArray(group.options) ? group.options : []
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
    const row = document.createElement("div");
    row.className = "modifier-option-row";

    const label = document.createElement("span");
    label.className = "modifier-option-name";
    label.textContent = option;

    const controls = document.createElement("div");
    controls.className = "modifier-stepper";

    const dec = document.createElement("button");
    dec.type = "button";
    dec.textContent = "-";

    const count = document.createElement("span");
    const currentQty = Number(selected[option] || 0);
    count.textContent = String(currentQty);

    const inc = document.createElement("button");
    inc.type = "button";
    inc.textContent = "+";

    dec.addEventListener("click", () => {
      const next = Math.max(0, Number((state.modifierDraft.selections[group.id] || {})[option] || 0) - 1);
      if (!state.modifierDraft.selections[group.id]) state.modifierDraft.selections[group.id] = {};
      if (next <= 0) {
        delete state.modifierDraft.selections[group.id][option];
      } else {
        state.modifierDraft.selections[group.id][option] = next;
      }
      renderModifierGroups();
    });

    inc.addEventListener("click", () => {
      const groupSelections = state.modifierDraft.selections[group.id] || {};
      const distinctCount = Object.values(groupSelections).filter((v) => Number(v) > 0).length;
      const current = Number(groupSelections[option] || 0);
      const addingNewDistinct = current <= 0;
      if (addingNewDistinct && distinctCount >= max) {
        return;
      }

      if (!state.modifierDraft.selections[group.id]) state.modifierDraft.selections[group.id] = {};
      if (!allowQuantities) {
        state.modifierDraft.selections[group.id] = { [option]: 1 };
      } else {
        state.modifierDraft.selections[group.id][option] = Math.min(9, current + 1);
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
      ui.reply.textContent = state.activeReplyText;
      setAvatarState(detectMood(state.activeReplyText));
      return;
    }

    if (payload.type === "response.function_call_arguments.done") {
      const result = await handleToolCall(payload.name, payload.arguments || "{}");
      if (result.action) {
        state.pendingActions.push(result.action);
        applyActions([result.action]);
      }
      sendWs({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: payload.call_id,
          output: JSON.stringify(result.output)
        }
      });
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

function buildSessionUpdatePayload() {
  const orderSnapshot = buildOrderStateSnapshot();
  const menuKnowledge = state.menu
    .map((item) => {
      const price = `BASE $${((item.priceCents || 0) / 100).toFixed(2)}`;
      const modifiers = (item.modifierGroups || [])
        .map((group) => {
          const min = Math.max(0, Number(group.minSelections || 0));
          const max = Math.max(min, Number(group.maxSelections || group.options?.length || 1));
          const options = (group.options || []).join("/");
          return `${group.name}[groupId="${group.id}",min=${min},max=${max}]:${options}`;
        })
        .join(" | ");
      return `${item.id}: ${item.name} / ${item.nameEs} (${price})${modifiers ? ` modifiers=[${modifiers}]` : ""}`;
    })
    .join("; ");

  return {
    type: "session.update",
    session: {
      voice: getEffectiveLanguage() === "es" ? (window.XAI_VOICE_ID_ES || "Eve") : (window.XAI_VOICE_ID || "Eve"),
      instructions:
        "You are Elvi, a fast, direct Cocina Elvis order taker. " +
        "Your assistant name is Elvi. If asked your name, always say 'My name is Elvi.' Never say your name is Cocina Elvis. " +
        "The customer speaks to you as restaurant staff. Use tools for real actions and do not invent tool results. " +
        "Default mode is order taking, not conversation. Do not greet, make small talk, upsell, explain the app, or ask personal/chatty questions. " +
        "Keep replies to 1 short sentence, usually under 10 words. After a successful order change, say only a brief confirmation like 'Added.' or 'Removed.' " +
        "Ask a question only when it is required to complete the order, such as missing required modifiers, pickup/delivery at checkout, delivery address, name, or phone. " +
        "If the customer asks a menu, price, allergy, or other question, answer directly and briefly, then return to order taking. " +
        "Collect pickup or delivery only when the customer starts checkout, says they are done, or mentions pickup/delivery. For delivery, collect the address before closing the order. " +
        "Avoid off-menu items. If unavailable, say it is unavailable and offer one closest menu item only if obvious. " +
        "Only discuss allergens or dietary restrictions when the customer asks or reports an allergy. Do not proactively ask about allergens. " +
        "For COMBO Tacos, require these build steps before add_item: (A) tortilla shell, (B) item #1 meat, (CD) item #2 meat, and (D) COMBO side. Treat other COMBO Tacos groups as optional. " +
        "If a customer later asks to add an optional COMBO Tacos modifier (for example DELUXE), update the existing COMBO Tacos line instead of saying it is unavailable. " +
        "For items with modifier groups, ask one concise combined question for missing required groups, then call add_item once they are fully selected. " +
        "Modifier option labels may include Square price deltas like (+$1.00); include those deltas when quoting modified item prices. " +
        "Common phrases: steak taco means Taco with Bistec / Steak; homemade taco means Taco Comal / Homemade; street taco means Taco Taquero / Street Taco; flour taco means Taco Harina / Flour. " +
        "If the exact item id is uncertain, call add_item with itemQuery using the customer's phrase; the app will resolve the item and modifiers. " +
        "When closing or saying goodbye, say 'thanks for ordering at Cocina Elvis' — never say 'thanks for calling'. " +
        "Use only the selected UI language for replies. Do not auto-detect or switch languages from customer wording. " +
        `Selected language=${getEffectiveLanguage()}. ` +
        `Current order state (authoritative): ${orderSnapshot}. Always treat this as the latest known order memory, especially after reconnect. ` +
        `ONLINE menu knowledge: ${menuKnowledge}`,
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
  const lines = state.cart.map((line) => {
    const base = `${line.quantity} x ${line.item.name}`;
    if (!Array.isArray(line.modifiers) || !line.modifiers.length) {
      return base;
    }
    const mods = line.modifiers
      .map((mod) => `${mod.quantity > 1 ? `${mod.quantity} x ` : ""}${mod.option}`)
      .join(", ");
    return `${base} [${mods}]`;
  });

  const cartText = lines.length ? lines.join(" | ") : "cart empty";
  const knownCustomer = [];
  if (state.customer.name) knownCustomer.push(`name=${state.customer.name}`);
  if (state.customer.phone) knownCustomer.push(`phone=${state.customer.phone}`);
  if (state.customer.email) knownCustomer.push(`email=${state.customer.email}`);
  if (state.customer.address) knownCustomer.push(`address=${state.customer.address}`);

  const customerText = knownCustomer.length ? knownCustomer.join(", ") : "none";
  return `fulfillment=${state.fulfillment}; cart=${cartText}; customer=${customerText}`;
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
  return [
    {
      type: "function",
      name: "add_item",
      description: "Add a menu item to the order.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "Exact menu item ID when known." },
          itemQuery: { type: "string", description: "Customer phrase when exact item ID is uncertain, such as 'one steak taco'." },
          quantity: { type: "number", description: "Quantity to add." },
          modifiers: {
            type: "array",
            description: "Selected modifier options by group. Required when item has required modifier groups.",
            items: {
              type: "object",
              properties: {
                groupId: { type: "string", description: "Modifier group id." },
                option: { type: "string", description: "Selected option label exactly as listed." },
                quantity: { type: "number", description: "Quantity for this modifier option." }
              },
              required: ["groupId", "option"]
            }
          }
        }
      }
    },
    {
      type: "function",
      name: "remove_item",
      description: "Remove a menu item from the order.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "Exact menu item ID." },
          quantity: { type: "number", description: "Quantity to remove." }
        },
        required: ["itemId"]
      }
    },
    {
      type: "function",
      name: "update_item",
      description: "Update quantity for a menu item.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "Exact menu item ID." },
          quantity: { type: "number", description: "Quantity." }
        },
        required: ["itemId", "quantity"]
      }
    },
    {
      type: "function",
      name: "set_fulfillment",
      description: "Set fulfillment mode.",
      parameters: {
        type: "object",
        properties: {
          fulfillment: { type: "string", enum: ["PICKUP", "DELIVERY"] }
        },
        required: ["fulfillment"]
      }
    },
    {
      type: "function",
      name: "set_address",
      description: "Store delivery address.",
      parameters: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"]
      }
    },
    {
      type: "function",
      name: "set_customer",
      description: "Store customer details.",
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
      name: "checkout",
      description: "Mark order ready for checkout.",
      parameters: { type: "object", properties: {} }
    },
    {
      type: "function",
      name: "check_delivery_zone",
      description: "Check if a given address is within the Cocina Elvis delivery zone.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Full street address including city, state, ZIP for delivery check." }
        },
        required: ["address"]
      }
    },
    {
      type: "function",
      name: "submit_order",
      description: "Submit the confirmed order for processing. Returns final total, estimated prep time, and order ID.",
      parameters: {
        type: "object",
        properties: {
          order_type: { type: "string", enum: ["pickup", "delivery"] },
          delivery_address: { type: "string" },
          customer_name: { type: "string" },
          phone: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                quantity: { type: "number" },
                customizations: { type: "array", items: { type: "string" } },
                price: { type: "number" }
              }
            }
          },
          subtotal: { type: "number" },
          allergies: { type: "string" }
        },
        required: ["order_type", "customer_name", "phone", "items", "subtotal"]
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

  if (["add_item", "remove_item", "update_item", "set_fulfillment", "set_address", "set_customer", "checkout"].includes(name)) {
    let addItemMode = null;
    if (name === "add_item") {
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
      return { type: "remove_item", itemId: String(args.itemId || ""), quantity: Number(args.quantity) || 1 };
    case "update_item":
      return { type: "update_item", itemId: String(args.itemId || ""), quantity: Number(args.quantity) || 1 };
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
      option: String(entry.option || "").trim(),
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

  const contains = options.find((opt) => normalizeOptionKey(opt).includes(key) || key.includes(normalizeOptionKey(opt)));
  return contains ? String(contains) : null;
}

function normalizeQueryText(text) {
  return normalizeOptionKey(text)
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|a|an|add|get|give|me|please|quiero|dame|orden|order|of)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSingleTacoCandidate(item) {
  const haystack = normalizeQueryText(`${item?.id || ""} ${item?.name || ""} ${item?.nameEs || ""}`);
  if (!haystack.includes("taco")) return false;
  return !/(combo|fiesta|love box|hard shell|pack|meal|tacos|[0-9]+\s*x|trio|sampler)/.test(haystack);
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

  const tortilla = inferOptionFromMap(tortillaGroup, query, [
    [/\b(homemade|home made|handmade|hand made|comal|corn)\b/, "Taco Comal / Homemade"],
    [/\b(flour|harina)\b/, "Taco Harina / Flour"],
    [/\b(street|taquero|taquera)\b/, "Taco Taquero / Street Taco"]
  ]);
  if (tortilla) modifiers.push(tortilla);

  const meat = inferOptionFromMap(meatGroup, query, [
    [/\b(steak|bistec|beef|carne asada)\b/, "Bistec / Steak"],
    [/\b(chicken|pollo)\b/, "Pollo / Chicken"],
    [/\b(pork|pernil)\b/, "Pernil / Roasted Pork"],
    [/\b(chorizo|sausage)\b/, "Chorizo / Mexican Sausage"],
    [/\b(ground beef|picadillo|molida)\b/, "Picadillo / Ground Beef"],
    [/\b(al pastor|pastor)\b/, "Al Pastor"],
    [/\b(veggie|vegetarian|vegetales|vegetal)\b/, "Vegetales / Veggie"]
  ]);
  if (meat) modifiers.push(meat);

  return modifiers;
}

function mergeResolvedModifiers(existing, inferred) {
  return mergeModifiersByGroup(normalizeToolModifiers(existing), inferred || []);
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
  const query = String(args.itemQuery || args.itemId || "").trim();
  const resolvedItem = args.itemQuery
    ? (resolveMenuItemFromQuery(query) || resolveMenuItemFromQuery(args.itemId))
    : (resolveMenuItemFromQuery(args.itemId) || resolveMenuItemFromQuery(query));
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
  if (!text || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  // Visually mark as selected
  const allChips = btn.closest("ul")?.querySelectorAll(".combo-option-chip");
  allChips?.forEach((c) => c.classList.remove("selected"));
  btn.classList.add("selected");
  btn.disabled = true;
  // Submit as a user text turn
  if (!sendUserTurn(text)) {
    return;
  }
  pulseAvatarState("talking_neutral", 900, "idle");
}

function sendUserTurn(text) {
  if (!text || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  // Single-lane turn taking: only one active request/response at a time.
  if (state.turnInFlight || state.elviSpeaking) {
    return false;
  }
  state.turnInFlight = true;
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

function sendWs(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  state.ws.send(JSON.stringify(payload));
}

function applyActions(actions) {
  let addedItem = false;
  for (const action of actions) {
    if (action.type === "combo_building") {
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
      continue;
    }

    if (action.type === "add_item") {
      const menuItem = state.menu.find((item) => item.id === action.itemId);
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
      state.lastComboAnimationKey = "";
      clearComboTracker();
      continue;
    }

    if (action.type === "remove_item") {
      removeCartItem(action.itemId, Number(action.quantity) || 1);
      continue;
    }

    if (action.type === "update_item") {
      updateCartItem(action.itemId, Number(action.quantity) || 1);
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

function removeCartItem(itemId, quantity) {
  const existing = state.cart.find((line) => line.item.id === itemId);
  if (!existing) {
    return;
  }

  existing.quantity -= Math.max(1, quantity);
  if (existing.quantity <= 0) {
    state.cart = state.cart.filter((line) => line.item.id !== itemId);
  }

  if (state.lastSelectedItem?.id === itemId && !state.cart.some((line) => line.item.id === itemId)) {
    state.lastSelectedItem = state.cart[0]?.item || null;
  }
}

function updateCartItem(itemId, quantity) {
  const q = Math.max(1, quantity);
  const existing = state.cart.find((line) => line.item.id === itemId);
  if (existing) {
    existing.quantity = q;
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
  const tracker = document.getElementById("combo-tracker");
  const nameEl = document.getElementById("combo-tracker-name");
  const progressEl = document.getElementById("combo-tracker-progress");
  const listEl = document.getElementById("combo-tracker-selections");
  const askEl = document.getElementById("combo-tracker-ask");
  const stepLabelEl = document.getElementById("combo-tracker-step-label");
  const optionsEl = document.getElementById("combo-tracker-options");
  if (!tracker || !nameEl || !progressEl || !listEl) return;

  nameEl.textContent = itemName;
  progressEl.textContent = `${step}/${totalSteps}`;

  // Confirmed selections — shown as small checkmarked pills
  listEl.innerHTML = selections
    .map((s) => `<li class="selection-done">\u2713 ${s}</li>`)
    .join("");

  // Current step options — shown as tappable chips
  if (askEl && stepLabelEl && optionsEl && stepOptions && stepOptions.length > 0) {
    stepLabelEl.textContent = stepName || "";
    optionsEl.innerHTML = stepOptions
      .slice(0, 10)
      .map((o) => `<li><button class="combo-option-chip" onclick="sendOptionChip(this)">${o}</button></li>`)
      .join("");
    askEl.classList.remove("is-hidden");
  } else if (askEl) {
    askEl.classList.add("is-hidden");
  }

  tracker.classList.remove("is-hidden");
}

function clearComboTracker() {
  document.getElementById("combo-tracker")?.classList.add("is-hidden");
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

    const value = document.createElement("span");
    value.className = "cart-item-price";
    value.textContent = centsToUsd(lineTotalCents);

    if (Array.isArray(line.modifiers) && line.modifiers.length > 0) {
      const mods = document.createElement("div");
      mods.className = "cart-item-mods";
      const modifierDelta = getModifierDeltaPerUnitCents(line);
      const modifierText = line.modifiers
        .map((m) => (m.quantity > 1 ? `${m.quantity}x ${m.option}` : m.option))
        .join(", ");
      mods.textContent = modifierDelta
        ? `${modifierText} (${centsToUsd(line.item.priceCents || 0)} + ${centsToUsd(modifierDelta)})`
        : modifierText;
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

  for (const line of state.cart.slice(-6).reverse()) {
    const card = document.createElement("article");
    card.className = "selected-item-card";

    const thumb = document.createElement("img");
    thumb.className = "selected-item-thumb";
    thumb.alt = line.item.name;
    thumb.src = line.item.imageUrl || "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=240&q=70";

    const body = document.createElement("div");
    const name = document.createElement("div");
    name.className = "selected-item-name";
    const label = getEffectiveLanguage() === "es" ? line.item.nameEs : line.item.name;
    name.textContent = `${line.quantity} x ${label}`;
    body.appendChild(name);

    if (Array.isArray(line.modifiers) && line.modifiers.length > 0) {
      const mods = document.createElement("div");
      mods.className = "selected-item-mods";
      for (const m of line.modifiers) {
        const chip = document.createElement("span");
        chip.className = "selected-item-mod-chip";
        const qty = Number(m.quantity || 0);
        const group = m.groupName ? `${m.groupName}: ` : "";
        chip.textContent = `${group}${qty > 1 ? `${qty}x ` : ""}${m.option}${getModifierUpchargeLabel(m)}`;
        mods.appendChild(chip);
      }
      body.appendChild(mods);
    }

    const price = document.createElement("div");
    price.className = "selected-item-price";
    price.textContent = centsToUsd(getCartLineTotalCents(line));

    card.appendChild(thumb);
    card.appendChild(body);
    card.appendChild(price);
    ui.selectedItemsList.appendChild(card);
  }
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

let _sharedAudioCtx      = null;
let _currentAudioSource  = null;  // playing BufferSourceNode — stored for interruption
let _queuedSources       = [];
let _nextPlayTime        = 0;
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
