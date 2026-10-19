import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { MenuItem } from "./menu.js";
import { getLaunchConfig } from "./launch-config.js";
import { rbFormat } from "./readback.js";
import { enforceSiteAvailability, completeWithSiteDefaults, dropUnaskedExtras, unavailableNowReply, pinnedMenu, rescoreSingleChoices, withDefaultSalsa, fixBurritoFillings, fixNamedMeats, fixToppingNegations, followUpContext, pickVariation, variationQuestion, readbackName, followUpStep, withoutSkuWords } from "./site-catalog.js";
import { answerMenuQuestion, unavailableItemReply, requiredChoiceQuestion } from "./menu-info.js";
import { normalizeSpokenCatalogAliases } from "./text-intents.js";
import { orderContextTurn, logTurn, pendingSummary } from "./order-context.js";
import { preTurn, answerPick as chicharronAnswerPick } from "./pre-turn.js";
import { resolveMenuRequest } from "./menu-intelligence.js";
import { resolveEspecialRequest } from "./especial-resolver.js";
import { resolvePackMealRequest } from "./pack-meal-resolver.js";
import { getComboGuide, evaluateGuideText, guideQuestion, SKIP_REST, type GuideFill, bothMeatQuestion, otherMeatQuestion, BOTH_MEAT_Q, OTHER_MEAT_Q, YES_ANSWER, NO_ANSWER } from "./guides.js";

type Language = "en" | "es";

type ElviAction =
  | { type: "add_item"; itemId: string; quantity: number; modifiers?: Array<{ step: string; option: string; isDefault?: boolean }>; readback?: string }
  | { type: "remove_item"; itemId: string; quantity: number }
  | { type: "update_item"; itemId: string; quantity: number }
  | { type: "set_fulfillment"; fulfillment: "PICKUP" | "DELIVERY" }
  | { type: "set_address"; address: string }
  | { type: "set_customer"; name?: string; phone?: string; email?: string }
  | { type: "checkout" };

export type ConversationTurn = {
  role: "customer" | "assistant";
  text: string;
  rawJson?: string;
};

type ElviRequest = {
  transcript: string;
  language: Language;
  menu: MenuItem[];
  /** Full catalog for the menu resolver (same one /menu/resolve uses). */
  resolverMenu?: MenuItem[];
  history?: ConversationTurn[];
  /** Order session (persistent order context until submit/cancel). */
  sessionKey?: string;
};

export type ElviAudioRequest = {
  audioChunks: string[];
  language: Language;
  menu: MenuItem[];
  history?: ConversationTurn[];
  resolverMenu?: MenuItem[];
  sessionKey?: string;
};

export type ElviResponse = {
  language: Language;
  reply: string;
  actions: ElviAction[];
  engine: "xai-realtime" | "xai";
  rawJson?: string;
  audioBase64?: string;
  audioMimeType?: string;
  /** Guided combos that still need answers before they can be added (chat endpoint only). */
  /** What the customer said (server-transcribed audio turns). */
  customerTranscript?: string;
  pendingGuides?: Array<{ itemId: string; itemName: string; missing: string[]; filled: GuideFill[] }>;
};

export type XaiRuntimeConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  fastModel: string;
};

function getRuntimeConfig(config?: Partial<XaiRuntimeConfig>): XaiRuntimeConfig {
  return {
    apiKey: config?.apiKey || process.env.XAI_API_KEY,
    baseUrl: config?.baseUrl || "https://api.x.ai/v1",
    model: config?.model || process.env.XAI_MODEL || "grok-voice-think-fast-1.0",
    fastModel: config?.fastModel || config?.model || process.env.XAI_FAST_MODEL || process.env.XAI_MODEL || "grok-voice-think-fast-1.0",
  };
}

async function chatWithElviCore(
  input: ElviRequest,
  runtimeConfig?: Partial<XaiRuntimeConfig>
): Promise<ElviResponse> {
  const runtime = getRuntimeConfig(runtimeConfig);
  let transcript = normalizeSpokenCatalogAliases((input.transcript || "").trim());
  if (!transcript) {
    throw new Error("Transcript is required");
  }
  input = { ...input, transcript };

  if (!runtime.apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }

  // fix11: packs and the chicharrón question first (same as web resolve).
  const pre = preTurn(input.sessionKey, transcript, input.resolverMenu || input.menu, input.language);
  if (pre.reply) return { language: input.language, engine: "xai", reply: pre.reply, actions: splitActions(pre.adds) } as ElviResponse;
  if (pre.text !== transcript) {
    transcript = pre.text;
    // A replayed sentence (chicharrón answer) replaces the turns that asked about it.
    let history = input.history;
    if (pre.replayed && history?.length) {
      const i = history.map((h) => h.role === "customer" && /chicharr/i.test(h.text)).lastIndexOf(true);
      // fix15: a completed clarifying question ("3 flautas" → "pollo") also drops the turn that asked it,
      // so the model doesn't reuse its count.
      const j = i >= 0 ? i : history.map((h) => h.role === "customer" && /flauta|taquit|paquete|pack|meal|combo|orden|order|tacos?|quesadillas?|gorditas?|tortas?/i.test(h.text)).lastIndexOf(true);
      if (j >= 0) history = history.slice(0, j);
    }
    input = { ...input, transcript, history };
  }

  // fix13: pack orders on chat/voice are resolved deterministically (same resolver as web), not by the model.
  if (/\b\d+\s*pack\b/i.test(transcript)) {
    try {
      const menu = input.resolverMenu || input.menu;
      const req: any = { text: transcript, language: input.language, actionHint: "add_item", toolArgs: { itemQuery: transcript }, cart: [] };
      const r: any = resolvePackMealRequest(menu as any, req);
      const adds = (r?.actions || []).filter((a: any) => a?.type === "add_item");
      if (r?.ok && adds.length) {
        const actions = adds.map((a: any) => ({ type: "add_item" as const, itemId: a.itemId, quantity: a.quantity || 1, modifiers: (a.modifiers || []).map((m: any) => ({ step: m.groupName || m.step, option: m.option })) }));
        return { language: input.language, engine: "xai", reply: addReadback(actions, menu, input.language), actions } as ElviResponse;
      }
      if (r && r.ok === false && r.message && r.reason !== "unknown_menu_item") return { language: input.language, engine: "xai", reply: String(r.message), actions: [] } as ElviResponse;
    } catch { /* fall back to the normal turn */ }
  }

  // The dish being built stays open until it's complete ("4 tacos 2 bistec" → "2 chorizo").
  const fromContext = contextResponse(input.sessionKey, transcript, input.resolverMenu || input.menu, input.language);
  if (fromContext) return fromContext;

  // Menu questions get a direct answer (the model tends to reply with nothing / "Listo").
  const menuAnswer = await answerMenuQuestion(transcript, input.language);
  if (menuAnswer) {
    const base: ElviResponse = { language: input.language, reply: menuAnswer, actions: [], engine: "xai" };
    // Asked mid-build? Answer, then pick the pending combo back up (nothing is added here).
    const pending = applyGuideGate(base, input);
    const held = pending.pendingGuides?.[0];
    if (held) {
      const answer = menuAnswer.replace(/\s*¿?[^.?¿]*\?\s*$/, "");
      const lead = input.language === "es" ? "Seguimos con tu" : "Back to your";
      return { ...base, reply: `${answer} ${lead} ${held.itemName}: ${pending.reply}`, pendingGuides: pending.pendingGuides };
    }
    return base;
  }
  // ui4: corrections edit the last combo; answers to an open combo question are handled by the guide
  // (step by step, website order), never by the model (it started new items for "harina" / "solo arroz").
  {
    const base: ElviResponse = { language: input.language, engine: "xai", reply: "", actions: [] } as any;
    const fixed = comboCorrection(base, input);
    if (fixed) return fixed;
    if (openComboQuestion(input)) {
      const gated = applyGuideGate(base, input);
      if (gated.reply) return gated;
    }
  }
  const follow = resolveFollowUp(transcript, input.history, input.resolverMenu || input.menu, input.language);
  if (follow) return finalizeTurn({ language: input.language, engine: "xai", ...follow } as ElviResponse, follow.said || transcript, input.resolverMenu || input.menu, input.language, true);
  const result = await chatWithRealtimeAgent(input, runtime);
  const checked = await guardClaimedAdds(dropOffDishAdds(applyGuideGate(result, input), transcript, input.resolverMenu || input.menu), transcript, input.language, input.resolverMenu || input.menu, input.history);
  return finalizeTurn(checked, transcript, input.resolverMenu || input.menu, input.language);
}

/** " Total: $12.50." for what was just added (item price + option charges), fix9. */
function totalText(actions: ElviAction[], menu: MenuItem[]) {
  let cents = 0;
  for (const a of actions) {
    if (a.type !== "add_item") continue;
    const item = menu.find((m) => m.id === a.itemId);
    const extra = (a.modifiers || []).reduce((s2, m: any) => s2 + Math.round(Number(String(m.option || "").match(/\(\+\$([\d.]+)\)/)?.[1] || 0) * 100) * Math.max(1, Number(m.quantity) || 1), 0);
    cents += ((item?.priceCents || 0) + extra) * Math.max(1, Number(a.quantity) || 1);
  }
  return cents ? ` Total: $${(cents / 100).toFixed(2)}.` : "";
}

/** Short read-back: "Added: 1 Pepsi and 2 Taco (Alpastor, Street). Anything else?" */
const normalizeWord = (w: string) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function addReadback(actions: ElviAction[], menu: MenuItem[], language: Language) {
  // fix10: one short read-back everywhere (src/readback.ts).
  const lines = actions.flatMap((action) => {
    if (action.type !== "add_item") return [];
    const item = menu.find((m) => m.id === action.itemId);
    const one = totalText([action], menu).match(/\$(\d+(?:\.\d+)?)/)?.[1];
    return [{ name: item?.name || "", alt: (item as any)?.readbackName, quantity: action.quantity, mods: (action.modifiers || []).map((m: any) => ({ option: m.option, group: m.step || m.groupName, quantity: m.quantity })), cents: one ? Math.round(Number(one) * 100) : 0 }];
  });
  return rbFormat(lines, language);
}

const CLAIMS_ADDED = /\b(added|i added|got it|agregu[eé]|agregad[oa]s?|listo|done|ready)\b/i;
const LOOKS_LIKE_ORDER = /\b(want|get|give|order|add|i'?ll have|can i|one|two|three|quiero|dame|me da|agrega|un|una|uno|dos|tres)\b/i;

/**
 * Never claim "added" unless an add_item really went through. When the customer asked for
 * something and nothing valid was added (e.g. "one horchata"), say it isn't on the menu and
 * offer the closest things the site sells.
 */
/**
 * Answer to Elvi's last question about a dish ("asada" after "Gordita: Bistec, Cabeza…?"):
 * resolve it against that dish only, with everything the customer said for it. Same on every channel.
 */
export function resolveFollowUp(heard: string, history: ConversationTurn[] | undefined, menu: MenuItem[], language: Language): Pick<ElviResponse, "reply" | "actions"> & { said?: string } | null {
  const ctx = followUpContext(history as any, menu);
  if (!ctx || !heard) return null;
  // A new dish by name ("mejor un burrito") starts over instead.
  const alone = pinnedMenu(heard, menu);
  if (alone.length && alone.length < menu.length && !alone.some((m) => ctx.items.includes(m))) return null;
  try {
    const run = (t: string) => {
      const req: any = { text: t, language, actionHint: "add_item", toolArgs: { itemQuery: t }, cart: [] };
      const items = ctx.items.length > 1 ? pickVariation(t, ctx.items) : ctx.items;
      if (ctx.items.length > 1) { const q = withoutSkuWords(t, items, ctx.items); req.text = q; req.toolArgs = { itemQuery: q }; }
      return completeWithSiteDefaults(resolveEspecialRequest(items as any, req) || resolveMenuRequest(items as any, req), menu, t);
    };
    // Replay the answers: each short answer fills the group that was asked at that point.
    let said = ctx.saidTurns[0] || "";
    let chosen: any[] = [];
    let r: any = null;
    for (const raw of [...ctx.saidTurns.slice(1), heard]) {
      // Same spelling the live turn got ("pastor" → "alpastor"), so replays pick the same option.
      const answer = normalizeSpokenCatalogAliases(String(raw).replace(/[.!?¡¿]+/g, " ").replace(/\s+/g, " ").trim());
      const step = followUpStep(run, said, chosen, answer, menu, language);
      said = step.said; chosen = step.chosen; r = step.result;
    }
    const text = said;
    r = variationQuestion(r, menu, text, language);
    if (r?.ok === false && r.reason === "choose_variation") return { reply: r.message, actions: [] };
    if (r?.ok === false && r.reason === "missing_required_modifiers") return { reply: requiredChoiceQuestion(r, language, menu), actions: [] };
    const adds = (r?.actions || []).filter((a: any) => a?.type === "add_item").map((a: any) => ({
      type: "add_item" as const,
      itemId: String(a.itemId),
      quantity: Math.max(1, Number(a.quantity) || 1),
      modifiers: (a.modifiers || []).map((m: any) => ({ step: String(m.groupName || m.groupId || ""), option: String(m.option || "") }))
    }));
    if (!adds.length) return null;
    // Everything the caller said for this dish, so later checks see "only rice" and "half pollo" alike.
    return { reply: addReadback(adds, menu, language), actions: adds, said: [...ctx.saidTurns, heard].join(" ") };
  } catch {
    return null;
  }
}

/**
 * Last step for every channel (chat, voice text, voice audio): the website's rules win.
 * EXTRA add-ons only when asked for, and nothing outside the website's hours (e.g. Menudo on a Thursday),
 * including when the model just answered without adding.
 */
export function finalizeTurn(result: ElviResponse, heard: string, menu: MenuItem[], language: Language, variationChosen = false): ElviResponse {
  let actions = rescoreSingleChoices(dropUnaskedExtras(result.actions, heard), menu, heard);
  // Multi-option dish the caller didn't specify (the model added "ceviche" as fish): ask, like the website.
  for (const a of actions) {
    if (a.type !== "add_item") continue;
    // Size/kind already chosen in the follow-up questions.
    if (variationChosen) continue;
    const q: any = variationQuestion({ ok: true, actions: [a] }, menu, heard, language);
    if (q?.reason === "choose_variation") {
      actions = actions.filter((x) => x !== a);
      return { ...result, actions, reply: q.message, audioBase64: undefined, audioMimeType: undefined };
    }
  }
  let out: ElviResponse = { ...result, actions };
  // Choices changed by the website rules: the read-back must say what's really in the cart.
  if (JSON.stringify(actions) !== JSON.stringify(result.actions) && /^(added|agregado)\b/i.test(String(result.reply || ""))) {
    out = { ...out, reply: addReadback(actions, menu, language), audioBase64: undefined, audioMimeType: undefined };
  }
  out = enforceSiteAvailability(out, menu, language);
  if (out !== result && out.reply !== result.reply) return out;
  if (!out.actions.some((a) => a.type === "add_item") && !out.pendingGuides?.length && heard) {
    try {
      const req: any = { text: heard, language, actionHint: "add_item", toolArgs: { itemQuery: heard }, cart: [] };
      const r: any = resolvePackMealRequest(pinnedMenu(req.text, menu) as any, req) || resolveEspecialRequest(pinnedMenu(req.text, menu) as any, req) || resolveMenuRequest(pinnedMenu(req.text, menu) as any, req);
      const id = r?.selectedItem?.itemId || r?.actions?.find((a: any) => a?.type === "add_item")?.itemId;
      const item = id && menu.find((m) => m.id === id);
      const hours = item ? unavailableNowReply(item, item.squareCatalogObjectId, language) : null;
      if (hours) return { ...out, reply: hours, audioBase64: undefined, audioMimeType: undefined };
    } catch { /* keep the reply */ }
  }
  return out;
}

/** fix12: singles with different tortillas per line, as add_item actions. */
function splitActions(adds?: Array<{ itemId: string; quantity: number; modifiers: Array<{ groupName: string; option: string }>; unknownMeat?: string }>): ElviAction[] {
  return (adds || []).map((a) => {
    const modifiers = a.modifiers.map((m) => ({ step: m.groupName, option: m.option }));
    // fix21: keep unknown STT meats on the line so the shadow log / live ask can see them.
    if (a.unknownMeat) modifiers.push({ step: "meat_needs_ask", option: a.unknownMeat });
    return { type: "add_item" as const, itemId: a.itemId, quantity: a.quantity, modifiers };
  });
}

/** Pending-dish turn (order context) as a chat/voice response. */
function contextResponse(sessionKey: string | undefined, heard: string, menu: MenuItem[], language: Language): ElviResponse | null {
  const ct = orderContextTurn(sessionKey, heard, menu, language);
  if (!ct) return null;
  const actions = ct.adds.map((a) => ({ type: "add_item" as const, itemId: a.itemId, quantity: a.quantity, modifiers: a.modifiers.map((m) => ({ step: m.groupName, option: m.option })) }));
  logTurn(sessionKey, { channel: "elvi", heard, interpretation: ct.interpretation, pending: pendingSummary(sessionKey), actions: actions.map((a) => `${a.quantity}x ${a.itemId} [${a.modifiers.map((m) => m.option).join(", ")}]`), reply: ct.reply });
  return { language, engine: "xai", reply: ct.reply, actions } as ElviResponse;
}

/** The model added a dish the caller never named ("pambazo" → Fiesta Pan): drop it so the resolver decides. */
function dropOffDishAdds(result: ElviResponse, heard: string, menu: MenuItem[]): ElviResponse {
  const pinned = pinnedMenu(heard, menu);
  if (!pinned.length || pinned.length >= menu.length) return result;
  const adds = result.actions.filter((a) => a.type === "add_item");
  if (!adds.length || adds.some((a: any) => pinned.some((m) => m.id === a.itemId))) return result;
  return { ...result, actions: result.actions.filter((a) => a.type !== "add_item"), reply: "", audioBase64: undefined, audioMimeType: undefined };
}

export async function guardClaimedAdds(result: ElviResponse, transcript: string, language: Language, menu: MenuItem[] = [], history?: ConversationTurn[]): Promise<ElviResponse> {
  if (result.pendingGuides?.length) return result;
  // Answering a build question ("Carne 1: elige una" → "2 pastor y 2 asada"): read it with the dish it answers.
  const turns: any[] = history || [];
  const lastBot = [...turns].reverse().find((t) => t.role === "assistant");
  const lastCustomer = [...turns].reverse().find((t) => t.role === "customer");
  if (lastBot && lastCustomer && !/^(added|agregado)\b/i.test(String(lastBot.text || "")) && /[?:]/.test(String(lastBot.text || ""))) {
    const own = pinnedMenu(transcript, menu);
    const prev = pinnedMenu(String(lastCustomer.text || ""), menu);
    {
      const words = transcript.toLowerCase();
      const namesDish = own.length < menu.length && own.some((m) => [m.name, m.readbackName].some((n) => n && n.length > 3 && words.includes(String(n).toLowerCase())));
      if (!namesDish) {
        // Every customer turn since the last "Added" (pack: "8 pack de tacos" + "de comal" + "todos de asada").
        const since: string[] = [];
        for (let k = turns.length - 1; k >= 0; k--) {
          if (turns[k].role === "assistant" && /^(added|agregado)\b/i.test(String(turns[k].text || ""))) break;
          if (turns[k].role === "customer") since.unshift(String(turns[k].text || ""));
          if (since.length >= 4) break;
        }
        transcript = `${since.join(" ")} ${transcript}`;
      }
    }
  }
  const reply = String(result.reply || "").trim();
  // The model sometimes adds a taco/quesadilla with no choices (no meat, no tortilla). Re-resolve those.
  const bareAdds = result.actions.filter((action) => {
    if (action.type !== "add_item" || (action.modifiers && action.modifiers.length)) return false;
    const item = menu.find((m) => m.id === action.itemId);
    return Boolean(item?.modifierGroups?.some((g) => (g.minSelections ?? 0) > 0));
  });
  if (result.actions.some((action) => action.type === "add_item") && !bareAdds.length) {
    // "Listo." / "Ready." after an add: say what went in the cart instead.
    if (reply.split(/\s+/).length <= 3 || /^(listo|ready|done|ok|okay|got it|added)[.!]?$/i.test(reply)) {
      return { ...result, audioBase64: undefined, audioMimeType: undefined, reply: addReadback(result.actions, menu, language) };
    }
    return result;
  }
  if (bareAdds.length) result = { ...result, actions: result.actions.filter((a) => !bareAdds.includes(a)) };
  // "Not on the menu" for something the menu has: check with the resolver too.
  const saysMissing = /\b(not on (our|the) menu|don'?t have|not available|no (lo |la )?tenemos|no est[aá] (en el men[uú]|disponible))\b/i.test(reply);
  const emptyOrClaim = bareAdds.length > 0 || !reply || saysMissing || reply.split(/\s+/).length <= 6;
  if (!emptyOrClaim) return result;
  // Ask the same menu resolver the web uses whether the item exists before calling it unavailable.
  let resolved: any = null;
  try {
    const req: any = { text: transcript, language, actionHint: "add_item", toolArgs: { itemQuery: transcript }, cart: [] };
    resolved = resolvePackMealRequest(pinnedMenu(req.text, menu) as any, req) || resolveEspecialRequest(pinnedMenu(req.text, menu) as any, req) || resolveMenuRequest(pinnedMenu(req.text, menu) as any, req);
    resolved = completeWithSiteDefaults(resolved, menu, transcript);
    resolved = variationQuestion(resolved, menu, transcript, language);
  } catch {
    resolved = null;
  }
  const strip = { audioBase64: undefined, audioMimeType: undefined };
  if (resolved && resolved.reason !== "unknown_menu_item") {
    const message = String(resolved.message || "").trim();
    if (resolved.ok === false && message) {
      let reply = resolved.reason === "missing_required_modifiers" ? requiredChoiceQuestion(resolved, language, menu) : message;
      // Name the dish in the question ("Pambazo: which meat?") so the short answer continues it.
      const asked: any = menu.find((m) => m.id === resolved.selectedItem?.itemId);
      if (asked && !reply.includes(":") && !/pack/i.test(String(asked.name))) reply = `${asked.readbackName || asked.name}: ${reply}`;
      return { ...result, ...strip, reply };
    }
    // The resolver found it but the model didn't add it: add what the resolver found
    // (still through the guide gate, so combos ask their required questions).
    const adds = (Array.isArray(resolved.actions) ? resolved.actions : [])
      .filter((a: any) => a?.type === "add_item" && menu.some((m) => m.id === a.itemId))
      .map((a: any) => ({
        type: "add_item" as const,
        itemId: String(a.itemId),
        quantity: Math.max(1, Number(a.quantity) || 1),
        modifiers: (Array.isArray(a.modifiers) ? a.modifiers : []).map((m: any) => ({ step: String(m.groupName || m.groupId || ""), option: String(m.option || "") }))
      }));
    if (adds.length) {
      const names = adds.map((a: any) => `${a.quantity > 1 ? `${a.quantity} ` : ""}${menu.find((m) => m.id === a.itemId)?.name || ""}`).join(", ");
      const gated = applyGuideGate(
        { ...result, ...strip, actions: [...result.actions, ...adds], reply: addReadback([...result.actions, ...adds], menu, language) },
        { transcript, language, menu }
      );
      return gated;
    }
    if (!CLAIMS_ADDED.test(reply)) return result;
    return { ...result, ...strip, reply: language === "es" ? "Todavía no lo agregué. ¿Me lo repites con los detalles?" : "I haven't added it yet. Can you say it again with the details?" };
  }
  if (!LOOKS_LIKE_ORDER.test(transcript)) return result;
  return { ...result, ...strip, reply: await unavailableItemReply(transcript, language, menu as any) };
}

/**
 * Same rule as the web guided build: a combo is only added once its required ("ask")
 * steps are filled from what the customer said. Defaults are applied and read back.
 * If something required is missing, the add is held and Elvi asks for it instead of "Listo".
 */
/** fix11: "chicharrón" + "¿…duro…o prensado…?" + "verde" in history → one turn with the choice ("verde" is not salsa verde). */
function resolveChicharronHistory(history: ConversationTurn[]): ConversationTurn[] {
  const out: ConversationTurn[] = [];
  for (let i = 0; i < history.length; i += 1) {
    const turn = history[i];
    if (turn.role === "assistant" && /chicharr[oó]n del duro/i.test(turn.text) && history[i + 1]?.role === "customer") {
      const pick = chicharronAnswerPick(history[i + 1].text);
      const lastCustomer = [...out].reverse().find((t) => t.role === "customer");
      if (pick && lastCustomer) { lastCustomer.text = lastCustomer.text.replace(/\bchicharr[oó]n(es)?\b/gi, pick); i += 1; continue; }
    }
    out.push({ ...turn });
  }
  return out;
}

/**
 * fix24: the model sometimes books "6 quesadillas de harina de bistec" as COMBO Quesadillas, which then asks
 * "¿Y el segundo, de qué carne?". A combo (2 items, 2 meats, sides) is only right when the caller asked for one.
 */
const COMBO_WORDS = /\b(combos?|combito|paquete|meal)\b|\b(?:con|with)\s+(?:arroz|rice)\s+(?:y|and|&)\s+(?:frijoles|beans)\b/i;
export function plainDishForCombo(comboName: string, menu: Array<{ id: string; name: string }>) {
  const norm = (n: string) => String(n || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  const base = norm(String(comboName).replace(/^\s*combo\s+/i, ""));
  if (!base || /\bmix\b/.test(base)) return null;
  const singular = base.replace(/(es|s)$/, "");
  const candidates = [base, base.replace(/s$/, ""), singular];
  return menu.find((m) => !/\bcombo\b/i.test(m.name) && candidates.includes(norm(m.name))) || null;
}

export function applyGuideGate(result: ElviResponse, input: ElviRequest): ElviResponse {
  const corrected = comboCorrection(result, input);
  if (corrected) return corrected;
  const es = input.language === "es";
  const menuById = new Map(input.menu.map((item) => [item.id, item]));
  const customerText = [
    ...resolveChicharronHistory(input.history || []).filter((turn) => turn.role === "customer").slice(-10).map((turn) => turn.text),
    input.transcript
  ].join(" . ");
  const guideFor = (name: string) => (/\bcombo\b/i.test(name) ? getComboGuide(name) : null);

  const actions: ElviAction[] = [];
  const questions: string[] = [];
  const readbacks: string[] = [];
  const pendingGuides: NonNullable<ElviResponse["pendingGuides"]> = [];
  const handled = new Set<string>();

  // ui4: which suggested/offered steps the customer already answered (the turn right after Elvi asked it).
  const plainT = (t: string) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  const answeredSteps = (guide: any) => {
    const turns = [...(input.history || []).slice(-20), { role: "customer", text: input.transcript } as ConversationTurn];
    const resolved = new Set<string>();
    let skipRest = false;
    turns.forEach((turn, i) => {
      const next = turns[i + 1];
      if (turn.role === "customer" && SKIP_REST.test(plainT(turn.text))) skipRest = true;
      if (turn.role !== "assistant" || next?.role !== "customer") return;
      for (const step of guide.steps as any[]) {
        if (step.mode !== "suggest" && step.mode !== "offer") continue;
        if (!String(turn.text).includes(guideQuestion(step, input.language))) continue;
        // A bare "no" to a suggestion means "not that one": ask again with the other choices.
        if (step.mode === "suggest" && step.kind !== "regularDeluxe" && /^(no|nope|nah)$/.test(plainT(next.text))) continue;
        resolved.add(String(step.key || step.title));
      }
    });
    return { resolved, skipRest };
  };

  const gate = (itemId: string, itemName: string, quantity: number) => {
    const guide = guideFor(itemName);
    if (!guide) return false;
    // One combo per sentence: a second add of the same combo (model split the two Mix items) is a duplicate.
    if (handled.has(guide.display_name)) return true;
    handled.add(guide.display_name);
    const evaluation = evaluateGuideText(guide, customerText, answeredSteps(guide));
    // fix25: one meat named for a 2-meat combo → "¿Las dos de bistec?"; yes fills item 2 with the same meat.
    let meatQuestion: string | null = null;
    {
      const m1 = evaluation.filled.find((f) => f.stepKey === "item-1-meat");
      const step2 = evaluation.missing.find((st) => String(st.key || "") === "item-2-meat");
      if (m1 && step2) {
        const turns = [...(input.history || []).slice(-20), { role: "customer", text: input.transcript } as ConversationTurn];
        const bothQ = bothMeatQuestion(guide.display_name, m1.option, input.language);
        let answer: "yes" | "no" | null = null;
        let otherAsked = false;
        turns.forEach((turn, i) => {
          const next = turns[i + 1];
          if (turn.role !== "assistant") return;
          if (OTHER_MEAT_Q.test(turn.text)) otherAsked = true;
          if (next?.role !== "customer" || !BOTH_MEAT_Q.test(turn.text) || !turn.text.includes(bothQ.replace(/^¿/, ""))) return;
          if (NO_ANSWER.test(next.text)) answer = "no";
          else if (YES_ANSWER.test(next.text)) answer = "yes";
          else answer = "no"; // something else (not a different meat — that would have filled item 2): ask for the other meat
        });
        if (answer === "yes") {
          const same = (step2.options || []).find((o: any) => o.name === m1.option)
            || (step2.options || []).find((o: any) => String(o.label || o.name).split(" / ")[0].replace(/^\s*\d+\s*x\s+/i, "") === m1.label.split(" / ")[0].replace(/^\s*\d+\s*x\s+/i, ""));
          if (same) {
            const at = evaluation.filled.indexOf(m1) + 1;
            evaluation.filled.splice(at, 0, { stepKey: "item-2-meat", title: step2.title, option: same.name, label: (same as any).label || same.name, isDefault: false, sendsModifier: true });
            evaluation.missing = evaluation.missing.filter((st) => st !== step2);
            evaluation.complete = evaluation.missing.length === 0;
          }
        } else if (evaluation.missing[0] === step2) {
          meatQuestion = answer === "no" || otherAsked ? otherMeatQuestion(guide.display_name, input.language) : bothQ;
        }
      }
    }
    if (!evaluation.complete) {
      pendingGuides.push({ itemId, itemName, missing: evaluation.missing.map((s) => String(s.key || s.title)), filled: evaluation.filled });
      questions.push(meatQuestion || guideQuestion(evaluation.missing[0], input.language));
      return true;
    }
    const parts = evaluation.filled.map((f) => f.label.split(" / ")[es ? 0 : 1] || f.label.split(" / ")[0]);
    const readback = `${guide.display_name}: ${parts.join(", ")}`;
    readbacks.push(readback);
    actions.push({
      type: "add_item",
      itemId,
      quantity,
      readback,
      modifiers: evaluation.filled.filter((f) => f.sendsModifier).map((f) => ({ step: f.stepKey, option: f.option, ...(f.isDefault ? { isDefault: true } : {}) }))
    });
    return true;
  };

  // The model sometimes replies "Listo" without adding anything (or adds the wrong item)
  // when a combo is named. Use the guide directly in that case.
  // Follow-up answers ("con todo y pico") don't repeat the combo name: use the most recent
  // customer turn that named a combo, unless Elvi already confirmed adding it after that.
  const recent = [...(input.history || [])].slice(-16);
  let fromHistory: ReturnType<typeof guideFor> = null;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const turn = recent[i];
    if (turn.role === "assistant" && /^(agregado|added)\b/i.test(turn.text.trim())) break;
    if (turn.role === "customer" && guideFor(turn.text)) { fromHistory = guideFor(turn.text); break; }
  }
  const named = guideFor(input.transcript) || fromHistory;
  const askedForCombo = !!named || COMBO_WORDS.test(customerText);
  let rewroteCombo = false;
  for (const original of result.actions) {
    let action = original;
    if (action.type === "add_item") {
      let item = menuById.get(action.itemId);
      // fix24: plain dish booked as a combo the caller never asked for → the plain dish (single meat, no 2nd-meat question).
      if (item && guideFor(item.name) && !askedForCombo) {
        const plain = plainDishForCombo(item.name, input.menu);
        if (plain) { action = { ...action, itemId: plain.id, readback: undefined }; item = menuById.get(plain.id); rewroteCombo = true; }
      }
      // fix10: the customer named a different combo ("combo mix" but the model picked COMBO Tacos) → use theirs.
      if (item && named && guideFor(item.name) && guideFor(item.name)!.display_name !== named.display_name) continue;
      // Answering an open combo question ("gordita" for the Mix's 2nd item) is not a separate dish.
      if (item && fromHistory && !guideFor(input.transcript) && !guideFor(item.name)) {
        const word = normalizeWord(item.name.split(/[ /(]/).filter(Boolean)[0] || "");
        if (word.length > 2 && fromHistory.steps.some((st: any) => (st.options || []).some((o: any) => normalizeWord(String(o.name || "")).includes(word)))) continue;
      }
      if (item && gate(action.itemId, item.name, action.quantity)) continue;
    }
    actions.push(action);
  }

  if (named && !handled.has(named.display_name)) {
    const item = input.menu.find((m) => m.name.toLowerCase().trim() === named.display_name.toLowerCase().trim());
    if (item) {
      // Drop a plain non-combo add the model guessed for the same words (e.g. "Burrito" for "combo de burrito").
      const base = named.display_name.replace(/^combo\s+/i, "").toLowerCase();
      for (let i = actions.length - 1; i >= 0; i -= 1) {
        const a = actions[i];
        if (a.type !== "add_item") continue;
        const n = (menuById.get(a.itemId)?.name || "").toLowerCase();
        if (!/combo/.test(n) && n.includes(base.replace(/s$/, ""))) actions.splice(i, 1);
      }
      gate(item.id, item.name, 1);
    }
  }

  if (!questions.length && !readbacks.length) return rewroteCombo ? { ...result, actions } : result;
  const anythingElse = es ? "¿Algo más?" : "Anything else?";
  const reply = questions.length
    ? [readbacks.length ? addReadback(actions, input.resolverMenu || input.menu, input.language).replace(/\s*(¿Algo más\?|Anything else\?)$/, "") : "", questions[0]].filter(Boolean).join(" ")
    : addReadback(actions, input.resolverMenu || input.menu, input.language);
  return {
    ...result,
    reply,
    actions,
    ...(pendingGuides.length ? { pendingGuides } : {}),
    // The model's audio said something else ("Listo"); let the client speak the new reply.
    audioBase64: undefined,
    audioMimeType: undefined
  };
}

/** ui4: Elvi's last turn was a step question of a combo that is still being built. */
function openComboQuestion(input: ElviRequest) {
  const hist = input.history || [];
  const last = [...hist].reverse().find((t) => t.role === "assistant");
  if (!last || /(¿Algo más\?|Anything else\?)\s*$/.test(last.text)) return false;
  for (let i = hist.length - 1; i >= Math.max(0, hist.length - 20); i -= 1) {
    const t = hist[i];
    if (t.role !== "customer" || !/\bcombo\b/i.test(t.text)) continue;
    const g = getComboGuide(t.text);
    if (!g) continue;
    return BOTH_MEAT_Q.test(last.text) || OTHER_MEAT_Q.test(last.text) || g.steps.some((st: any) => last.text.includes(guideQuestion(st, input.language)));
  }
  return false;
}

/** ui4: correction cues ("actually", "mejor", "cambia", "solo arroz", "sin frijoles"). */
export const CORRECTION = /\b(actually|instead|make it|change it|change that|switch|mejor|cambia(lo|la|r)?|cambiale|en vez|en lugar|mejor que sea|que sea|solo|only|just|sin|without|no (beans|rice|frijoles|arroz))\b/;
export function correctionText(text: string) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(sin|no|without)\s+(los\s+)?(frijoles|beans)\b/g, "solo arroz")
    .replace(/\b(sin|no|without)\s+(el\s+)?(arroz|rice)\b/g, "solo frijoles")
    .replace(/\b(only|just)\s+rice\b/g, "solo arroz").replace(/\b(only|just)\s+beans\b/g, "solo frijoles");
}
/**
 * ui4: "actually make it only rice" after a combo was added edits THAT combo (update_item on the most
 * recent line), it never starts a new one. Re-reads the combo's own words with the correction last.
 */
function comboCorrection(result: ElviResponse, input: ElviRequest): ElviResponse | null {
  const said = String(input.transcript || "");
  const ct = correctionText(said);
  const strong = /\b(actually|instead|make it|change|switch|mejor|cambia(lo|la|r|le)?|en vez|en lugar|que sea)\b/.test(ct);
  if (!strong && !(CORRECTION.test(ct) && ct.split(" ").length <= 4)) return null;
  const hist = input.history || [];
  const named = (t: string) => (/\bcombo\b/i.test(t) ? getComboGuide(t) : null);
  // The most recent combo Elvi confirmed (its read-back starts with the combo name) and the words that built it.
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const turn = hist[i];
    if (turn.role !== "assistant") continue;
    const g = named(turn.text.split(":")[0] || "");
    if (!g || !/(¿Algo más\?|Anything else\?)\s*$/.test(turn.text)) continue;
    // A new dish named in the correction ("mejor un burrito") is not a correction of this combo.
    if (named(said) && named(said)!.display_name !== g.display_name) return null;
    let start = i - 1;
    for (let j = i - 1; j >= 0; j -= 1) if (hist[j].role === "customer" && named(hist[j].text)?.display_name === g.display_name) { start = j; break; }
    const words = hist.slice(start, i).filter((t) => t.role === "customer").map((t) => t.text);
    const ev = evaluateGuideText(g, [...words, ct].join(" . "), { skipRest: true });
    const before = evaluateGuideText(g, words.join(" . "), { skipRest: true });
    const sig = (e: typeof ev) => e.filled.map((f) => `${f.stepKey}=${f.option}`).join("|");
    if (sig(ev) === sig(before)) return null;
    const item = (input.menu || []).find((m) => m.name.toLowerCase().trim() === g.display_name.toLowerCase().trim());
    if (!ev.complete || !item) return null;
    const es = input.language === "es";
    const modifiers = ev.filled.filter((f) => f.sendsModifier).map((f) => ({ step: f.stepKey, option: f.option, ...(f.isDefault ? { isDefault: true } : {}) }));
    const action: any = { type: "update_item", itemId: item.id, quantity: 1, modifiers, correction: true };
    const rb = addReadback([{ type: "add_item", itemId: item.id, quantity: 1, modifiers } as any], input.resolverMenu || input.menu, input.language);
    return { ...result, actions: [action, ...result.actions.filter((a) => a.type !== "add_item" && a.type !== "update_item")], reply: `${es ? "Cambiado." : "Changed."} ${rb}`, audioBase64: undefined, audioMimeType: undefined };
  }
  return null;
}

async function chatWithElviAudioCore(
  input: ElviAudioRequest,
  runtimeConfig?: Partial<XaiRuntimeConfig>
): Promise<ElviResponse> {
  const runtime = getRuntimeConfig(runtimeConfig);
  if (!runtime.apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }
  if (!input.audioChunks.length) {
    throw new Error("Audio input is required");
  }
  const result = await chatWithRealtimeAudioAgent(input, runtime);
  // Same menu-question / guide / "added" checks as typed turns, using what the customer said.
  const heard = normalizeSpokenCatalogAliases(String(result.customerTranscript || "").replace(/[.!?¡¿]+/g, " ").replace(/\s+/g, " ").trim());
  if (!heard) return result;
  const menuAnswer = await answerMenuQuestion(heard, input.language);
  if (menuAnswer) {
    return { ...result, reply: menuAnswer, actions: [], audioBase64: undefined, audioMimeType: undefined };
  }
  // fix11: chicharrón question / pack rewrite on what was heard; a rewrite reruns the turn as text.
  const pre = preTurn(input.sessionKey, heard, input.resolverMenu || input.menu, input.language);
  if (pre.reply) return { ...result, reply: pre.reply, actions: splitActions(pre.adds), audioBase64: undefined, audioMimeType: undefined, customerTranscript: heard } as any;
  // fix12: "Ocho tacos de alpastor" heard but the audio model added 1 → redo the turn as text.
  const countWord = heard.toLowerCase().match(/\b(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|seven|eight|nine|ten)\s+(tacos|quesadillas|gorditas|tortas|burritos|sopes|tamales)\b/);
  const COUNT: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const said = countWord ? Number(countWord[1]) || COUNT[countWord[1]] : 0;
  const addedQty = (result.actions || []).filter((a) => a.type === "add_item").reduce((n, a: any) => n + (Number(a.quantity) || 1), 0);
  if (pre.text !== heard || (said > 1 && addedQty > 0 && addedQty !== said)) {
    const again = await chatWithElvi({ ...(input as any), transcript: pre.text, preTurnDone: true } as any, runtimeConfig);
    return { ...again, audioBase64: undefined, audioMimeType: undefined, customerTranscript: heard } as any;
  }
  const fromContext = contextResponse(input.sessionKey, heard, input.resolverMenu || input.menu, input.language);
  if (fromContext) return { ...result, ...fromContext, audioBase64: undefined, audioMimeType: undefined, customerTranscript: heard } as any;
  const follow = resolveFollowUp(heard, input.history, input.resolverMenu || input.menu, input.language);
  if (follow) return finalizeTurn({ ...result, ...follow, audioBase64: undefined, audioMimeType: undefined, customerTranscript: heard } as any, follow.said || heard, input.resolverMenu || input.menu, input.language, true);
  const gated = applyGuideGate(result, { transcript: heard, language: input.language, menu: input.menu, history: input.history });
  const guarded = await guardClaimedAdds(dropOffDishAdds(gated, heard, input.resolverMenu || input.menu), heard, input.language, input.resolverMenu || input.menu, input.history);
  const checked = finalizeTurn({ ...guarded, customerTranscript: heard } as any, heard, input.resolverMenu || input.menu, input.language);
  return checked.reply !== result.reply ? { ...checked, audioBase64: undefined, audioMimeType: undefined } : checked;
}

export async function transcribeElviAudio(
  input: Pick<ElviAudioRequest, "audioChunks" | "language">,
  runtimeConfig?: Partial<XaiRuntimeConfig>
): Promise<{ transcript: string; engine: "xai-realtime" }> {
  const runtime = getRuntimeConfig(runtimeConfig);
  if (!runtime.apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }
  if (!input.audioChunks.length) {
    throw new Error("Audio input is required");
  }
  const sampleRate = Number(process.env.XAI_TTS_SAMPLE_RATE || 24000);

  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${encodeURIComponent(runtime.fastModel)}`, {
      headers: { Authorization: `Bearer ${runtime.apiKey}` }
    });
    let transcript = "";
    let done = false;

    const settle = (error?: Error) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      if (error) {
        reject(error);
        return;
      }
      resolve({ transcript: transcript.trim(), engine: "xai-realtime" });
    };

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: "Transcribe the customer's speech exactly. Do not answer, do not add menu items, do not infer.",
          input_audio_transcription: { model: process.env.XAI_STT_MODEL || "grok-2-audio" },
          audio: {
            input: { format: { type: "audio/pcm", rate: sampleRate } },
            output: { format: { type: "audio/pcm", rate: sampleRate } }
          }
        }
      }));

      for (const chunk of input.audioChunks) {
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk }));
      }
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text"],
          instructions: input.language === "es"
            ? "Devuelve solo la transcripción exacta en español."
            : "Return only the exact transcript."
        }
      }));
    });

    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (/input_audio.*transcription.*(completed|done|final)/i.test(String(event.type || "")) && event.transcript) {
        transcript = String(event.transcript || "");
        settle();
        return;
      }
      if ((event.type === "response.output_text.delta" || event.type === "response.output_audio_transcript.delta") && event.delta) {
        transcript += String(event.delta || "");
        return;
      }
      if (event.type === "response.done") {
        settle();
        return;
      }
      if (event.type === "error") {
        settle(new Error(event.message || "xAI transcription error"));
      }
    });

    ws.on("error", (error) => settle(error instanceof Error ? error : new Error(String(error))));
    ws.on("close", () => {
      if (!done) settle(new Error("xAI transcription closed before completion"));
    });
  });
}

async function chatWithRealtimeAgent(
  input: ElviRequest,
  runtime: XaiRuntimeConfig
): Promise<ElviResponse> {
  const instructions = buildRealtimeInstructions(input.language, input.menu, input.history || []);
  const voice = ((input.language === "es" ? process.env.XAI_VOICE_ID_ES : process.env.XAI_VOICE_ID) || "Eve").toLowerCase();
  const sampleRate = Number(process.env.XAI_TTS_SAMPLE_RATE || 24000);

  return await new Promise<ElviResponse>((resolve, reject) => {
    const ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${encodeURIComponent(runtime.fastModel)}`, {
      headers: { Authorization: `Bearer ${runtime.apiKey}` }
    });

    const audioChunks: Buffer[] = [];
    const actionCalls: unknown[] = [];
    let transcript = "";
    let done = false;

    const settle = (error?: Error) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}

      if (error) {
        reject(error);
        return;
      }

      const reply = enforceOrderTakerReply(transcript.trim(), input.language) || defaultReply(input.language);
      resolve({
        language: input.language,
        reply,
        actions: sanitizeActions(actionCalls, input.menu),
        engine: "xai-realtime",
        rawJson: JSON.stringify({ language: input.language, reply, actions: actionCalls }),
        audioBase64: audioChunks.length ? pcmBuffersToWavBase64(audioChunks, sampleRate) : undefined,
        audioMimeType: audioChunks.length ? "audio/wav" : undefined
      });
    };

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          voice,
          instructions,
          turn_detection: { type: "server_vad", threshold: 0.85, silence_duration_ms: 0 },
          tools: buildRealtimeTools(),
          input_audio_transcription: { model: process.env.XAI_STT_MODEL || "grok-2-audio" },
          audio: {
            input: { format: { type: "audio/pcm", rate: sampleRate } },
            output: { format: { type: "audio/pcm", rate: sampleRate } }
          }
        }
      }));

      ws.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: input.transcript }]
        }
      }));
      ws.send(JSON.stringify({ type: "response.create" }));
    });

    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString());

      if (event.type === "response.output_audio.delta" && event.delta) {
        audioChunks.push(Buffer.from(event.delta, "base64"));
        return;
      }

      if ((event.type === "response.output_audio_transcript.delta" || event.type === "response.output_text.delta") && event.delta) {
        transcript += String(event.delta);
        return;
      }

      if (event.type === "response.function_call_arguments.done") {
        const result = handleRealtimeToolCall(event.name, event.arguments);
        if (result.action) {
          actionCalls.push(result.action);
        }
        ws.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: event.call_id,
            output: JSON.stringify(result.output)
          }
        }));
        ws.send(JSON.stringify({ type: "response.create" }));
        return;
      }

      if (event.type === "response.done") {
        settle();
        return;
      }

      if (event.type === "error") {
        settle(new Error(event.message || "xAI realtime agent error"));
      }
    });

    ws.on("error", (error) => settle(error instanceof Error ? error : new Error(String(error))));
    ws.on("close", () => {
      if (!done) {
        settle(new Error("xAI realtime agent closed before response completed"));
      }
    });
  });
}

async function chatWithRealtimeAudioAgent(
  input: ElviAudioRequest,
  runtime: XaiRuntimeConfig
): Promise<ElviResponse> {
  const instructions = buildRealtimeInstructions(input.language, input.menu, input.history || []);
  const voice = ((input.language === "es" ? process.env.XAI_VOICE_ID_ES : process.env.XAI_VOICE_ID) || "Eve").toLowerCase();
  const sampleRate = Number(process.env.XAI_TTS_SAMPLE_RATE || 24000);

  return await new Promise<ElviResponse>((resolve, reject) => {
    const ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${encodeURIComponent(runtime.fastModel)}`, {
      headers: { Authorization: `Bearer ${runtime.apiKey}` }
    });

    const audioChunks: Buffer[] = [];
    const actionCalls: unknown[] = [];
    let transcript = "";
    let customerText = "";
    let done = false;

    const settle = (error?: Error) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}

      if (error) {
        reject(error);
        return;
      }

      const reply = enforceOrderTakerReply(transcript.trim(), input.language) || defaultReply(input.language);
      resolve({
        language: input.language,
        reply,
        actions: sanitizeActions(actionCalls, input.menu),
        engine: "xai-realtime",
        rawJson: JSON.stringify({ language: input.language, reply, actions: actionCalls }),
        customerTranscript: customerText,
        audioBase64: audioChunks.length ? pcmBuffersToWavBase64(audioChunks, sampleRate) : undefined,
        audioMimeType: audioChunks.length ? "audio/wav" : undefined
      });
    };

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          voice,
          instructions,
          tools: buildRealtimeTools(),
          input_audio_transcription: { model: process.env.XAI_STT_MODEL || "grok-2-audio" },
          audio: {
            input: { format: { type: "audio/pcm", rate: sampleRate } },
            output: { format: { type: "audio/pcm", rate: sampleRate } }
          }
        }
      }));

      for (const chunk of input.audioChunks) {
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk }));
      }
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({ type: "response.create" }));
    });

    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString());

      if (/input_audio.*transcription.*(completed|done|final)/i.test(String(event.type || "")) && event.transcript) {
        customerText = String(event.transcript || "");
        return;
      }

      if (event.type === "response.output_audio.delta" && event.delta) {
        audioChunks.push(Buffer.from(event.delta, "base64"));
        return;
      }

      if ((event.type === "response.output_audio_transcript.delta" || event.type === "response.output_text.delta") && event.delta) {
        transcript += String(event.delta);
        return;
      }

      if (event.type === "response.function_call_arguments.done") {
        const result = handleRealtimeToolCall(event.name, event.arguments);
        if (result.action) {
          actionCalls.push(result.action);
        }
        ws.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: event.call_id,
            output: JSON.stringify(result.output)
          }
        }));
        ws.send(JSON.stringify({ type: "response.create" }));
        return;
      }

      if (event.type === "response.done") {
        settle();
        return;
      }

      if (event.type === "error") {
        settle(new Error(event.message || "xAI realtime audio agent error"));
      }
    });

    ws.on("error", (error) => settle(error instanceof Error ? error : new Error(String(error))));
    ws.on("close", () => {
      if (!done) {
        settle(new Error("xAI realtime audio agent closed before response completed"));
      }
    });
  });
}

function parseModelJson(content: string): { language: string; reply: string; actions: unknown[] } {
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const raw = start >= 0 && end >= start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(raw) as { language?: string; reply?: string; actions?: unknown[] };
  return {
    language: parsed.language || "en",
    reply: parsed.reply || "",
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
  };
}

function sanitizeActions(actions: unknown[], menu: MenuItem[]): ElviAction[] {
  const validIds = new Set(menu.map((item) => item.id));
  const cleaned: ElviAction[] = [];
  const launchConfig = getLaunchConfig();

  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const value = action as Record<string, unknown>;

    if (value.type === "add_item" && typeof value.itemId === "string" && validIds.has(value.itemId)) {
      const qty = Number(value.quantity) || 1;
      cleaned.push({ type: "add_item", itemId: value.itemId, quantity: Math.max(1, Math.min(qty, 20)) });
      continue;
    }
    if (value.type === "remove_item" && typeof value.itemId === "string" && validIds.has(value.itemId)) {
      const qty = Number(value.quantity) || 1;
      cleaned.push({ type: "remove_item", itemId: value.itemId, quantity: Math.max(1, Math.min(qty, 20)) });
      continue;
    }
    if (value.type === "update_item" && typeof value.itemId === "string" && validIds.has(value.itemId)) {
      const qty = Number(value.quantity) || 1;
      cleaned.push({ type: "update_item", itemId: value.itemId, quantity: Math.max(1, Math.min(qty, 20)) });
      continue;
    }
    if (value.type === "set_fulfillment" && (value.fulfillment === "PICKUP" || value.fulfillment === "DELIVERY")) {
      cleaned.push({
        type: "set_fulfillment",
        fulfillment: value.fulfillment === "DELIVERY" && !launchConfig.deliveryEnabled ? "PICKUP" : value.fulfillment
      });
      continue;
    }
    if (value.type === "set_address" && typeof value.address === "string" && value.address.trim()) {
      if (!launchConfig.deliveryEnabled) continue;
      cleaned.push({ type: "set_address", address: value.address.trim() });
      continue;
    }
    if (value.type === "set_customer") {
      const customer: { name?: string; phone?: string; email?: string } = {};
      if (typeof value.name === "string" && value.name.trim()) customer.name = value.name.trim();
      if (typeof value.phone === "string" && value.phone.trim()) customer.phone = value.phone.trim();
      if (typeof value.email === "string" && value.email.trim()) customer.email = value.email.trim();
      cleaned.push({ type: "set_customer", ...customer });
      continue;
    }
    if (value.type === "checkout") {
      cleaned.push({ type: "checkout" });
    }
  }

  return cleaned;
}

function buildRealtimeInstructions(language: Language, menu: MenuItem[], history: ConversationTurn[]) {
  const launchConfig = getLaunchConfig();
  const menuSummary = buildRealtimeMenuKnowledge(menu);
  const historySummary = history
    .slice(-4)
    .map((turn) => `${turn.role === "customer" ? "Customer" : "Elvi"}: ${turn.text}`)
    .join("\n");

  return [
    "You are Elvi, the fastest and most accurate order taker at Cocina Elvis. Act like an experienced human cashier who gets it right the first time.",
    "Never greet, make small talk, or explain yourself. Only speak to confirm actions or ask the absolute minimum needed to complete the order.",
    "Keep every reply to ONE short sentence (under 8 words when possible). Confirmations: 'Added.', 'Got it.', 'Removed.', 'Anything else?'.",
    "Always prefer action over questions. When the transcript is even slightly understandable, immediately call the correct tool instead of asking for clarification.",
    "Handle noisy, partial, or accented speech gracefully. Infer the most likely intent from context + current cart and act on it. Only ask when truly ambiguous.",
    "If the customer corrects you or changes their mind, adapt instantly and call update_item or remove_item without hesitation.",
    "Use tools for every change: add_item, remove_item, update_item, set_fulfillment, set_address, set_customer, checkout. Never describe changes — execute them.",
    "After any tool call, trust the returned cart state completely. Never say the cart is empty if it has items.",
    "When the customer says 'done', 'checkout', 'pagar', or similar, immediately set pickup if missing, then call checkout.",
    launchConfig.deliveryEnabled
      ? "For delivery, collect address only if not already set. For pickup, proceed without asking."
      : `Voice ordering is pickup-only right now. If the customer asks for delivery, say exactly: "${launchConfig.deliveryDisabledMessage}" and keep fulfillment as PICKUP.`,
    "Resolve references like 'the last one', 'that taco', 'make it steak', '#2', or 'the first one' against the current cart and use update_item or remove_item.",
    "For mixed orders in one sentence ('two al pastor, one tripas, and a horchata'), call add_item with the full phrase — the system will split correctly.",
    "Ask every required choice in the website order (e.g. taco: tortilla first, then meat; burrito: size first). Never pick the tortilla or size for the customer.",
    "After adding a taco or quesadilla, if deluxe was not mentioned, silently assume regular unless they later say deluxe.",
    "Sell ONLY items from the menu below. Never auto-select or start building a combo/pack when the customer says a generic word like combo, meal pack, or paquete. Always ask for the specific one first using real menu names.",
    "When the customer says a generic combo or pack without choosing a specific one, ask which one using actual combo or pack names from the current menu. Do not default to the first item.",
    "Reply only in the current language (English or Spanish). Never mix languages in one response except for exact menu item names.",
    "When the customer asks about price, ingredients, or allergies, answer in one short sentence then return to ordering.",
    "Use exact item IDs in every tool call. Quote real prices from the menu. Never invent items or prices.",
    language === "es"
      ? "OUTPUT_LANGUAGE_LOCK=Spanish. Responde solo en español. Frases cortas: 'Agregado.', 'Listo.', '¿Algo más?', '¿Recoger?'. Never use English except menu names."
      : "OUTPUT_LANGUAGE_LOCK=English. Reply only in English. Short phrases: 'Added.', 'Done.', 'Anything else?', 'Pickup?'. Never use Spanish except menu names.",
    `ONLINE menu knowledge:\n${menuSummary}`,
    historySummary ? `Recent conversation:\n${historySummary}` : ""
  ].filter(Boolean).join("\n\n");
}

function buildRealtimeMenuKnowledge(menu: MenuItem[]) {
  return menu
    .map((item) => {
      const price = Number.isFinite(item.priceCents) ? `$${(item.priceCents / 100).toFixed(2)}` : "$0.00";
      const aliases = item.aliases?.length ? ` aliases=${item.aliases.join("/")}` : "";
      const modifiers = item.modifierGroups?.length
        ? ` modifiers=${item.modifierGroups
            .map((group) => {
              const min = Math.max(0, group.minSelections ?? 0);
              const max = Math.max(min, group.maxSelections ?? group.options.length);
              const quantityFlag = group.allowQuantities ? ",qty" : "";
              return `${group.name}[groupId=${group.id},${min}-${max}${quantityFlag}]:${group.options.join("/")}`;
            })
            .join(" ; ")}`
        : "";
      return `${item.id} | ${item.name} / ${item.nameEs} | ${price}${aliases}${modifiers}`;
    })
    .join("\n");
}

function buildRealtimeTools() {
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
            description: "Selected modifier options by group for items that require modifiers.",
            items: {
              type: "object",
              properties: {
                groupId: { type: "string", description: "Modifier group id." },
                option: { type: "string", description: "Selected option label." },
                quantity: { type: "number", description: "Quantity for this option." }
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
          itemQuery: { type: "string", description: "Cart reference or customer phrase, such as 'last item', 'the taco', or '#2'." },
          quantity: { type: "number", description: "Quantity to remove." }
        }
      }
    },
    {
      type: "function",
      name: "update_item",
      description: "Update or swap a menu item.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "Exact menu item ID." },
          itemQuery: { type: "string", description: "Cart reference or customer phrase, such as 'last item', 'the taco', or '#2'." },
          quantity: { type: "number", description: "New quantity." },
          modifiers: {
            type: "array",
            description: "Replacement modifier options when changing the current cart item.",
            items: {
              type: "object",
              properties: {
                groupId: { type: "string", description: "Modifier group id." },
                option: { type: "string", description: "Selected option label." },
                quantity: { type: "number", description: "Quantity for this option." }
              },
              required: ["groupId", "option"]
            }
          }
        }
      }
    },
    {
      type: "function",
      name: "set_fulfillment",
      description: getLaunchConfig().deliveryEnabled
        ? "Set whether the order is pickup or delivery."
        : "Set the order to pickup only. Delivery is disabled for voice ordering.",
      parameters: {
        type: "object",
        properties: {
          fulfillment: { type: "string", enum: getLaunchConfig().deliveryEnabled ? ["PICKUP", "DELIVERY"] : ["PICKUP"] }
        },
        required: ["fulfillment"]
      }
    },
    {
      type: "function",
      name: "set_address",
      description: "Store the delivery address.",
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
      description: "Mark the order as ready for checkout.",
      parameters: { type: "object", properties: {} }
    },
    {
      type: "function",
      name: "check_delivery_zone",
      description: "Check if an address is within the delivery zone.",
      parameters: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"]
      }
    },
    {
      type: "function",
      name: "submit_order",
      description: "Submit the confirmed order.",
      parameters: {
        type: "object",
        properties: {
          order_type: {
            type: "string",
            enum: ["pickup", "delivery"],
            description: "Whether the order is for pickup or delivery."
          },
          delivery_address: {
            type: "string",
            description: "Full delivery address (omit if pickup)."
          },
          customer_name: {
            type: "string",
            description: "Customer's full name."
          },
          phone: {
            type: "string",
            description: "Customer's phone number."
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Item name (e.g., 'large carne asada burrito')."
                },
                quantity: {
                  type: "number",
                  description: "Quantity ordered."
                },
                customizations: {
                  type: "array",
                  items: { type: "string" },
                  description: "List of customizations (e.g., ['no onions', 'extra cheese'])."
                },
                price: {
                  type: "number",
                  description: "Unit price."
                }
              }
            },
            description: "Array of order items with details."
          },
          subtotal: {
            type: "number",
            description: "Order subtotal before tax."
          },
          allergies: {
            type: "string",
            description: "Noted allergies or dietary restrictions."
          }
        },
        required: ["order_type", "customer_name", "phone", "items", "subtotal"]
      }
    }
  ];
}

function handleRealtimeToolCall(name: string, argsJson: string) {
  const args = safeParseJson(argsJson);
  switch (name) {
    case "add_item":
    case "remove_item":
    case "update_item":
      return {
        action: { type: name, itemId: String(args.itemId || ""), quantity: Number(args.quantity) || 1 },
        output: { ok: true }
      };
    case "set_fulfillment":
      if (args.fulfillment === "DELIVERY" && !getLaunchConfig().deliveryEnabled) {
        return {
          action: { type: "set_fulfillment", fulfillment: "PICKUP" },
          output: { ok: false, delivery_enabled: false, message: getLaunchConfig().deliveryDisabledMessage }
        };
      }
      return {
        action: { type: "set_fulfillment", fulfillment: args.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP" },
        output: { ok: true }
      };
    case "set_address":
      if (!getLaunchConfig().deliveryEnabled) {
        return {
          action: null,
          output: { ok: false, delivery_enabled: false, message: getLaunchConfig().deliveryDisabledMessage }
        };
      }
      return {
        action: { type: "set_address", address: String(args.address || "") },
        output: { ok: true }
      };
    case "set_customer":
      return {
        action: {
          type: "set_customer",
          ...(typeof args.name === "string" ? { name: args.name } : {}),
          ...(typeof args.phone === "string" ? { phone: args.phone } : {}),
          ...(typeof args.email === "string" ? { email: args.email } : {})
        },
        output: { ok: true }
      };
    case "checkout":
      return {
        action: { type: "checkout" },
        output: { ok: true }
      };
    case "check_delivery_zone":
      if (!getLaunchConfig().deliveryEnabled) {
        return {
          output: {
            ok: false,
            available: false,
            in_zone: false,
            delivery_enabled: false,
            message: getLaunchConfig().deliveryDisabledMessage
          }
        };
      }
      return {
        output: {
          ok: true,
          ...handleCheckDeliveryZone(args)
        }
      };
    case "submit_order":
      return {
        output: {
          ok: true,
          ...handleSubmitOrder(args)
        }
      };
    default:
      return { output: { ok: false, error: `Unknown tool: ${name}` } };
  }
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {} as Record<string, unknown>;
  }
}

function handleCheckDeliveryZone(args: Record<string, unknown>) {
  const address = String(args.address || "").trim();
  const allowAll = !process.env.DELIVERY_ZONE_ZIPS?.trim();
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

  const zip = (address.match(/\b\d{5}(?:-\d{4})?\b/) || [""])[0].slice(0, 5);
  if (!address) {
    return {
      available: false,
      in_zone: false,
      message: "Missing delivery address. Please provide full address with ZIP code."
    };
  }

  if (!zip) {
    return {
      available: false,
      in_zone: false,
      message: "Could not detect ZIP code. Ask for a full address with ZIP to verify delivery."
    };
  }

  if (blocked.has(zip)) {
    return {
      available: true,
      in_zone: false,
      zip,
      message: `ZIP ${zip} is outside our delivery zone. Offer pickup instead.`
    };
  }

  if (allowAll || allowed.has(zip)) {
    return {
      available: true,
      in_zone: true,
      zip,
      message: `Delivery available to ZIP ${zip}.`
    };
  }

  return {
    available: true,
    in_zone: false,
    zip,
    message: `ZIP ${zip} is outside our delivery zone. Offer pickup instead.`
  };
}

function handleSubmitOrder(args: Record<string, unknown>) {
  const items = Array.isArray(args.items) ? args.items : [];
  const subtotalFromArgs = Number(args.subtotal);
  const subtotalFromItems = items.reduce((sum, item) => {
    const row = item as Record<string, unknown>;
    const qty = Math.max(1, Number(row.quantity) || 1);
    const price = Math.max(0, Number(row.price) || 0);
    return sum + qty * price;
  }, 0);

  const subtotal = Number.isFinite(subtotalFromArgs) && subtotalFromArgs > 0 ? subtotalFromArgs : subtotalFromItems;
  const taxRate = Math.max(0, Number(process.env.SALES_TAX_RATE || 0.0825));
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  const etaMin = Math.max(10, Number(process.env.ORDER_ETA_MIN || 25));
  const etaMax = Math.max(etaMin, Number(process.env.ORDER_ETA_MAX || 35));

  return {
    status: "submitted",
    order_id: `ELV-${randomUUID().slice(0, 8).toUpperCase()}`,
    order_type: String(args.order_type || "pickup").toLowerCase() === "delivery" ? "delivery" : "pickup",
    subtotal,
    tax,
    total,
    currency: "USD",
    estimated_time: `${etaMin}-${etaMax} minutes`,
    message: `Order confirmed. Estimated ${etaMin}-${etaMax} minutes.`
  };
}

function pcmBuffersToWavBase64(chunks: Buffer[], sampleRate: number) {
  const pcm = Buffer.concat(chunks);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString("base64");
}


function enforceOrderTakerReply(reply: string, language: Language): string {
  const text = formatCentsForSpeech((reply || "").trim(), language);
  if (!text) return defaultReply(language);
  const customerLike = /\b(i\s+(want|would like|wanna|am gonna|will)\s+order|can\s+i\s+get|i\s+need\s+a|me\s+gustaria\s+ordenar|quiero\s+ordenar|voy\s+a\s+ordenar|puedo\s+pedir)\b/i;
  if (customerLike.test(text)) return defaultReply(language);
  return text;
}

function formatCentsForSpeech(text: string, language: Language): string {
  const centsWord = language === "es" ? "centavos" : "cents";
  return String(text || "")
    .replace(/\$0\.(\d{1,2})\b/g, (_, cents: string) => {
      const value = Number(cents.padEnd(2, "0"));
      return `${value} ${centsWord}`;
    })
    .replace(/\b0\.(\d{1,2})\s*(?:dollars?|dolares|dólares)\b/gi, (_, cents: string) => {
      const value = Number(cents.padEnd(2, "0"));
      return `${value} ${centsWord}`;
    })
    .replace(/(^|[^\d])\.(\d{1,2})\s*(?:dollars?|dolares|dólares)?\b/gi, (_match: string, prefix: string, cents: string) => {
      const value = Number(cents.padEnd(2, "0"));
      return `${prefix}${value} ${centsWord}`;
    });
}

function defaultReply(language: Language) {
  return language === "es"
    ? "Listo."
    : "Ready.";
}


/**
 * fix16 (Carlos): the included mild Salsa Asada is added to every dish with an included-salsa group
 * unless the customer asked for another salsa (or none), and the add read-back says so. Same for
 * chat, voice text and voice audio (realtime.ts calls these two).
 */
function withSalsaDefault(result: ElviResponse, heard: string, menu: MenuItem[], language: Language): ElviResponse {
  if (!result?.actions?.length) return result;
  const actions = withDefaultSalsa(fixToppingNegations(fixNamedMeats(fixBurritoFillings(result.actions as any[], menu, heard, "elvi"), menu, heard, "elvi"), menu, heard, "elvi"), menu, heard, "elvi") as ElviAction[];
  if (JSON.stringify(actions) === JSON.stringify(result.actions)) return result;
  const reply = String(result.reply || "");
  const isReadback = /(¿Algo más\?|Anything else\?)\s*$/.test(reply);
  return isReadback
    ? { ...result, actions, reply: addReadback(actions, menu, language), audioBase64: undefined, audioMimeType: undefined }
    : { ...result, actions };
}

/** fix18: the last line Elvi added per order session, for quantity corrections ("no, mejor tres"). */
const lastAddBySession = new Map<string, { itemId: string; quantity: number; modifiers?: any[]; at: number }>();
const QTY_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, one: 1, a: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10 };
const QTY_FIX = new RegExp(String.raw`^(?:no[\s,.!]*)?(?:(?:mejor|better|actually|instead|en realidad|perd[oó]n)[\s,]*)?(?:(?:que\s+sean|son|make\s+(?:it|that|them)|change\s+(?:it|that)\s+to|ponle|ponme|dame)\s+)?(\d{1,2}|${Object.keys(QTY_WORDS).join("|")})\b\s*(.*)$`, "iu");

/** fix20: "no crema" / "sin cebolla" edits the last dish's toppings — never starts ceviche or another item. */
const TOPPING_NEG = /^(?:(?:no|sin|without|hold(?:\s+the)?)\s+)(?:(?:el|la|los|las|the|de)\s+)?(crema|sour\s+cream|cebolla|onion|cilantro|lechuga|lettuce|pico(?:\s+de\s+gallo)?|queso\s+fresco|frijoles?|beans|arroz|rice)\b/iu;
export function toppingCorrection(input: Pick<ElviRequest, "sessionKey" | "transcript" | "language" | "menu"> & { resolverMenu?: MenuItem[] }): ElviResponse | null {
  const key = input.sessionKey;
  const last = key ? lastAddBySession.get(key) : undefined;
  if (!last || Date.now() - last.at > 3 * 60 * 60 * 1000) return null;
  const said = String(input.transcript || "").trim().replace(/[.!?¡¿]+$/g, "");
  if (!TOPPING_NEG.test(said)) return null;
  // A new dish in the same breath is not a topping edit ("no crema y dos tacos…").
  if (/\b(tacos?|burritos?|quesadillas?|gorditas?|tortas?|sopesazos?|sopesasos?|sopes?|combo|bowl|nachos|horchata|ceviche)\b/i.test(said) && /\b(y|and|tambie?n|plus)\b/i.test(said)) return null;
  const menu = ((input as any).resolverMenu || input.menu || []) as MenuItem[];
  const item = menu.find((x) => x.id === last.itemId);
  if (!item) return null;
  const fill: any = (item.modifierGroups || []).find((g: any) => /toppings?|burrito\s+(combo\s+)?options/i.test(g.name) && !/salsa|carne|meat/i.test(g.name));
  const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const nSaid = norm(said);
  const keys: Array<{ re: RegExp; key: RegExp }> = [
    { re: /crema|sour\s+cream/, key: /crema|sour\s+cream/i },
    { re: /cebolla|onion/, key: /cebolla|onion/i },
    { re: /cilantro/, key: /cilantro/i },
    { re: /lechuga|lettuce/, key: /lechuga|lettuce/i },
    { re: /pico/, key: /pico/i },
    { re: /queso\s+fresco/, key: /queso\s+fresco|fresco\s+cheese/i },
    { re: /frijoles?|beans/, key: /frijol|bean/i },
    { re: /arroz|rice/, key: /arroz|rice/i },
  ];
  const drop = keys.filter((k) => k.re.test(nSaid));
  if (!drop.length) return null;
  let mods = (last.modifiers || []).filter((m: any) => !drop.some((d) => d.key.test(String(m.option || ""))));
  // Ensure the topping isn't sitting on the line; no add_item.
  const es = input.language === "es";
  const dropped = drop.map((d) => (d.re.source.split("|")[0] || "extra").replace(/\\s\+/g, " "));
  const action: any = { type: "update_item", itemId: last.itemId, quantity: last.quantity, modifiers: mods, correction: true };
  const rb = addReadback([{ type: "add_item", itemId: last.itemId, quantity: last.quantity, modifiers: mods } as any], menu, input.language);
  const note = es ? `Sin ${dropped.join(" ni ")}.` : `No ${dropped.join(" or ")}.`;
  return { language: input.language, engine: "xai", reply: `${note} ${rb}`.trim(), actions: [action] } as ElviResponse;
}

export function quantityCorrection(input: Pick<ElviRequest, "sessionKey" | "transcript" | "language" | "menu"> & { resolverMenu?: MenuItem[] }): ElviResponse | null {
  const key = input.sessionKey;
  const last = key ? lastAddBySession.get(key) : undefined;
  if (!last || Date.now() - last.at > 3 * 60 * 60 * 1000) return null;
  const said = String(input.transcript || "").trim().replace(/[.!?¡¿]+$/g, "");
  // Needs a correction cue; a bare "tres tacos" is a new item.
  if (!/^(no\b|mejor\b|better\b|actually\b|instead\b|en realidad\b|perd[oó]n\b|make (it|that|them)\b|change (it|that) to\b|que sean\b)/iu.test(said)) return null;
  const m = said.match(QTY_FIX);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : QTY_WORDS[m[1].toLowerCase()];
  if (!n || n < 1 || n > 20 || n === last.quantity) return null;
  const menu = ((input as any).resolverMenu || input.menu || []) as MenuItem[];
  const item = menu.find((x) => x.id === last.itemId);
  if (!item) return null;
  // Remaining words must describe the same dish (or nothing): "mejor tres gorditas de chorizo".
  const rest = normalizeSpokenCatalogAliases(m[2] || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const name = String(item.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const noun = rest.split(/\s+/).find((w) => w.length > 2 && !/^(de|con|por|favor|please|of|with|mejor)$/.test(w));
  if (noun && !name.includes(noun.replace(/s$/, "")) && !(last.modifiers || []).some((x: any) => String(x.option || "").toLowerCase().includes(noun))) return null;
  const es = input.language === "es";
  // No modifiers: the cart line keeps its own choices, only the count changes.
  const action: any = { type: "update_item", itemId: last.itemId, quantity: n, correction: true };
  const rb = addReadback([{ type: "add_item", itemId: last.itemId, quantity: n, modifiers: last.modifiers } as any], menu, input.language);
  return { language: input.language, engine: "xai", reply: `${es ? "Cambiado." : "Changed."} ${rb}`, actions: [action] } as ElviResponse;
}

/** fix19: remember the last add for any channel (chat, voice audio, web/voice resolver). Accepts Elvi or resolver modifier shapes. */
export function recordLastAdd(key: string | undefined, actions: any[] | undefined) {
  if (!key || !Array.isArray(actions)) return;
  if (actions.some((a) => a?.type === "checkout")) { lastAddBySession.delete(key); return; }
  const fix = actions.find((a) => a?.type === "update_item" && a.correction && lastAddBySession.get(key)?.itemId === a.itemId);
  if (fix) { const prev = lastAddBySession.get(key)!; lastAddBySession.set(key, { ...prev, quantity: Number(fix.quantity) || prev.quantity, ...(Array.isArray(fix.modifiers) ? { modifiers: fix.modifiers.map((m: any) => ({ step: m.step || m.groupName, option: m.option, ...(m.isDefault ? { isDefault: true } : {}) })) } : {}), at: Date.now() }); }
  const adds = actions.filter((a) => a?.type === "add_item");
  const a = adds[adds.length - 1];
  if (a) lastAddBySession.set(key, { itemId: a.itemId, quantity: Number(a.quantity) || 1, modifiers: (a.modifiers || []).map((m: any) => ({ step: m.step || m.groupName, option: m.option, ...(m.isDefault ? { isDefault: true } : {}) })), at: Date.now() });
}

export async function chatWithElvi(input: ElviRequest, runtimeConfig?: Partial<XaiRuntimeConfig>): Promise<ElviResponse> {
  // fix18: "así está bien" / "es todo" / "that's all" after "¿Algo más?" closes the order. The model re-added the
  // last dish for these ("está" also matched Platillo de Guisado), so answer here with no cart change (never checkout).
  const lastReply = [...(input.history || [])].reverse().find((h) => h.role === "assistant")?.text || "";
  const DONE = /^\s*(?:no[\s,.!]*)?(?:(?:as[ií]\s+)?est[aá]\s+bien|(?:eso\s+)?es\s+todo|ser[ií]a\s+todo|nada\s+m[aá]s|that'?s\s+(?:fine|it|all|good|everything)|it'?s\s+fine|nothing\s+else|no\s+thanks?|that\s+will\s+be\s+all)(?:[\s,.!]*(?:gracias|thanks?|thank\s+you|por\s+favor|please))?[\s.!]*$/iu;
  if (/(¿Algo más\?|Anything else\?)\s*$/.test(lastReply) && DONE.test(String(input.transcript || ""))) {
    const es = input.language === "es";
    return { language: input.language, engine: "xai", reply: es ? "¡Perfecto! Revisa tu orden y cuando estés listo, pasa a pagar." : "Perfect! Review your order and check out when you're ready.", actions: [] } as ElviResponse;
  }
  const fixed = quantityCorrection(input);
  if (fixed) { recordLastAdd(input.sessionKey, fixed.actions); return fixed; }
  const topping = toppingCorrection(input);
  if (topping) { recordLastAdd(input.sessionKey, topping.actions); return topping; }
  const result = await chatWithElviCore(input, runtimeConfig);
  const final = withSalsaDefault(result, input.transcript || "", ((input as any).resolverMenu || input.menu || []) as MenuItem[], (result.language || input.language) as Language);
  recordLastAdd(input.sessionKey, final.actions);
  return final;
}

export async function chatWithElviAudio(input: ElviAudioRequest, runtimeConfig?: Partial<XaiRuntimeConfig>): Promise<ElviResponse> {
  const result = await chatWithElviAudioCore(input, runtimeConfig);
  // fix19: voice quantity corrections ("no, mejor tres") use the same rule as chat.
  const heardFix = quantityCorrection({ sessionKey: (input as any).sessionKey, transcript: String((result as any).customerTranscript || ""), language: (result.language || (input as any).language) as Language, menu: (input as any).menu, resolverMenu: (input as any).resolverMenu });
  if (heardFix) { recordLastAdd((input as any).sessionKey, heardFix.actions); return { ...heardFix, customerTranscript: (result as any).customerTranscript } as ElviResponse; }
  const heardTop = toppingCorrection({ sessionKey: (input as any).sessionKey, transcript: String((result as any).customerTranscript || ""), language: (result.language || (input as any).language) as Language, menu: (input as any).menu, resolverMenu: (input as any).resolverMenu });
  if (heardTop) { recordLastAdd((input as any).sessionKey, heardTop.actions); return { ...heardTop, customerTranscript: (result as any).customerTranscript } as ElviResponse; }
  const finalAudio = withSalsaDefault(result, String((result as any).customerTranscript || ""), (((input as any).resolverMenu || (input as any).menu || []) as MenuItem[]), (result.language || (input as any).language) as Language);
  recordLastAdd((input as any).sessionKey, finalAudio.actions);
  return finalAudio;
}
