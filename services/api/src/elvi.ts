import { staffUnavailable } from "./spoken-ledger.js";
import { readFileSync } from "node:fs";
import { storeState } from "./menu-v3.js";
import WebSocket from "ws";
import { withConTodo, withConAddons, EXPLICIT_EXTRA_MELTED } from "./standard-toppings.js";
import { withLearnedSuggestion, offerAnswer } from "./online-learning.js";
import { favoriteAnswer } from "./favorites.js";
import { recall as recallMemory, rewriteSlang } from "./elvi-knowledge.js";
import { ASK_NAME, nameAckText, nameFromAnswer, nameQuestionIn, resolveNameAnswer, wrapUpNameQuestion, thirdPersonName, markOrderOnlyName } from "./order-name.js";
import { cleanFirstName } from "./caller-memory.js";
import { randomUUID } from "node:crypto";
import type { MenuItem } from "./menu.js";
import { getLaunchConfig } from "./launch-config.js";
import { rbFormat } from "./readback.js";
import { meatOptSaid, enforceSiteAvailability, completeWithSiteDefaults, dropUnaskedExtras, unavailableNowReply, pinnedMenu, rescoreSingleChoices, withDefaultSalsa, fixBurritoFillings, fixNamedMeats, fixToppingNegations, followUpContext, pickVariation, variationQuestion, readbackName, followUpStep, withoutSkuWords } from "./site-catalog.js";
import { answerMenuQuestion, unavailableItemReply, requiredChoiceQuestion } from "./menu-info.js";
import { normalizeSpokenCatalogAliases } from "./text-intents.js";
import { applySharedAliases } from "./aliases.js";
import { deliveryDialogRules } from "./delivery.js";
import { cachedAppQuote as cachedQuote, quoteAppAddress as quoteDeliveryAddress } from "./delivery-zone.js"; // appdelivery1: app tools quote website fees
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
  channel?: "app" | "phone"; // appdelivery1/appsopes1
  transcript: string;
  language: Language;
  menu: MenuItem[];
  /** Full catalog for the menu resolver (same one /menu/resolve uses). */
  resolverMenu?: MenuItem[];
  history?: ConversationTurn[];
  /** Order session (persistent order context until submit/cancel). */
  sessionKey?: string;
  /** ordername1: Elvi taking a phone order (server-side only, never from the web body). savedName = caller memory. */
  phoneOrder?: { savedName?: string | null; orderName?: string | null };
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
  if (pre.reply) return { language: input.language, engine: "xai", reply: pre.reply, actions: [...splitActions(pre.adds), ...((pre.updates || []) as any[])] } as ElviResponse;
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
const FUQ: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const fuFold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** "dos tortas" → 2 when the number sits right before this dish's own noun; else null. */
export function spokenQtyFor(text: string, items: any[]): number | null {
  const t = fuFold(text);
  for (const it of items) {
    const noun = fuFold(String(it.name || "")).replace(/\(.*?\)/g, " ").trim().split(/\s+/).find((w) => w.length >= 4);
    if (!noun) continue;
    const m = new RegExp(`\\b(\\d+|${Object.keys(FUQ).join("|")})\\s+(?:otr[ao]s?\\s+)?${noun.slice(0, -1)}`).exec(t);
    if (m) { const n = /\d/.test(m[1]) ? Number(m[1]) : FUQ[m[1]]; if (n > 1 && n < 30) return n; }
  }
  return null;
}
/** fix_uriel: "¿puedo hacer una orden?" / "quiero ordenar" names no dish → invite the order; never guess a dish. */
const ORDER_INTENT = /^\s*(?:(?:ya|hola|bueno|s[ií]|oiga|ok|hi|hello|yes)[\s,.!]*)*(?:¿)?(?:puedo|podr[ií]a|quisiera|quiero|me\s+gustar[ií]a|can\s+i|could\s+i|i'?d\s+like\s+to|i\s+want\s+to)\s+(?:hacer|poner|ordenar|pedir|place|make|order)(?:\s+(?:una|un|an?)\s+(?:orden|pedido|order))?(?:\s+(?:para\s+llevar|to\s+go|for\s+pickup))?[\s?.!]*$/iu;
export function orderIntentOnly(input: ElviRequest): ElviResponse | null {
  if (!ORDER_INTENT.test(String(input.transcript || ""))) return null;
  const es = input.language === "es";
  return { language: input.language, engine: "xai", reply: es ? "¡Claro! ¿Qué le preparo?" : "Sure! What can I get you?", actions: [] } as any;
}

const DISH_RE = /\b(tacos?|tortas?|quesadillas?|gorditas?|burritos?|sopesa[sz]os?|sopes?|huaraches?|doradas?|pambazos?|enchiladas?|tostadas?|flautas?|nachos)\b/;
const fuPlain = (s: string) => fuFold(s).replace(/[¿¡]/g, "");
/** fix_uriel: "Ajá, aparte" / "Ajá" / "ujú" after "¿Algo más?" with no dish and no number adds nothing (the model re-added a torta). */
export function shortAckAfterReadback(input: ElviRequest, lastReply: string): ElviResponse | null {
  if (!/(¿Algo más\?|Anything else\?)\s*$/.test(lastReply)) return null;
  const t = fuPlain(String(input.transcript || ""));
  // alex1: a sentence cut off mid-way ("Y en otro no me le puede poner este,") — wait for the rest, ring nothing
  if (/\b(este|pero|con|de|le|me|el|la|un|una|unos?)\s*[,.]?\s*$/.test(t + " ") && /[,]\s*$/.test(String(input.transcript || "").trim()) && !/\b(bistec|pastor|chorizo|pollo|asada|carnitas|cabeza|frijol|queso|arroz|crema)\b/.test(t))
    return { language: input.language, engine: "xai", reply: input.language === "es" ? "¿Sí? Dígame." : "Sure, go ahead.", actions: [] } as any;
  if (!t.trim() || DISH_RE.test(t) || /\b(bebida|agua|refresco|soda|horchata|drink|coca|jarrito)\b/.test(t)) return null;
  // counting with no dish ("y me pone dos, tres") — the dish comes next; ask instead of re-adding the last one
  const nums = t.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (nums.some((x) => /^(\d+|dos|tres|cuatro|cinco|seis|two|three|four|five|six)$/.test(x)) && nums.every((x) => /^(\d+|una?|uno|dos|tres|cuatro|cinco|seis|two|three|four|five|six|y|and|me|pone|ponga|da|dame|de|esos|otr[ao]s?|mas|more|give|pero|si|ah|eh|solo|digo|no|aja|bueno|este)$/.test(x)))
    return { language: input.language, engine: "xai", reply: input.language === "es" ? "¿De qué serían?" : "Of what?", actions: [] } as any;
  if (/\b(\d+|una?|uno|otr[ao]s?|one|another)\b/.test(t)) return null;
  const w = t.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const FILL = /^(aja|uju|ujum|mhm|si|ok|okay|aparte|separados?|sigue|todo|eso|bueno|de|con|y|este|asi|bien|yeah|yes|uh|huh|right|separate|bistec|prensado|asada|pastor|alpastor|chorizo|pollo|carnitas|cabeza|buche|tripa|duro|chicharron|lengua|suadero|steak)$/;
  if (!w.length || w.length > 6 || !w.every((x) => FILL.test(x))) return null;
  const es = input.language === "es";
  return { language: input.language, engine: "xai", reply: es ? "Muy bien. ¿Algo más?" : "Okay. Anything else?", actions: [] } as any;
}
/** fix_uriel: a turn naming 2+ dishes is split into one clause per dish; each clause is resolved on its own (its meats,
 * its count). A clause taken back ("…de bistec, no, perdón, y otra quesadilla de prensado") is dropped. All-or-nothing. */
export function splitDishClauses(text: string): string[] {
  const t = fuPlain(text);
  const segs = t.split(/\s*(?:[,.;!?]|\by\b|\band\b)\s*/).filter(Boolean);
  const chunks: Array<{ noun: string; segs: string[]; retracted: boolean }> = [];
  for (const seg of segs) {
    const n = seg.match(DISH_RE)?.[1]?.replace(/e?s$/, "");
    if (n) chunks.push({ noun: n, segs: [seg], retracted: false });
    else if (chunks.length) { if (/^(no|perdon|mejor no|digo|sorry|i mean)$/.test(seg.trim())) chunks[chunks.length - 1].retracted = true; else chunks[chunks.length - 1].segs.push(seg); }
  }
  // a retraction only counts when the same dish is said again right after
  // the tortilla said in the taken-back clause still holds ("de bistec de comal, no, perdón, de prensado" → comal prensado)
  chunks.forEach((c, i) => { const nx = chunks[i + 1]; if (c.retracted && nx?.noun === c.noun) { const sh = c.segs.join(" ").match(/\b(?:de |en )?(comal|harina|maiz|taquer[oa]s?|dorad[oa]s?)\b/); if (sh && !new RegExp(sh[1]).test(nx.segs.join(" "))) nx.segs.push(`de ${sh[1]}`); } });
  const keep = chunks.filter((c, i) => !(c.retracted && chunks[i + 1]?.noun === c.noun));
  if (new Set(keep.map((c) => c.noun)).size < 2) return [];
  return keep.map((c) => c.segs.filter((s) => !/^(aja|uju|si|separados|aparte|ok|okay)( (aja|uju|si|separados))*$/.test(s.trim())).join(" "));
}
/** learn2: approved correction memory — same function the app's /menu/resolve uses. */
export function memoryTurn(input: ElviRequest): ElviResponse | null {
  const menu = (((input as any).resolverMenu || input.menu || []) as MenuItem[]);
  const t = String(input.transcript || "");
  const hit = recallMemory(t, menu, splitDishClauses(t));
  if (!hit) return null;
  const actions = hit.map((h) => ({ type: "add_item" as const, itemId: h.itemId, quantity: h.quantity, modifiers: h.modifiers.map((m) => ({ step: m.step, option: m.option })) }));
  return { language: input.language, engine: "xai", reply: addReadback(actions as any, menu, input.language as Language), actions, memory: hit.map((h) => h.memoryId) } as any;
}
/** cheyenne1: "dos de chorizo" / "y dos de bistec y dos de chorizo" with no dish named = more of the LAST dish (same tortilla),
 * with the named meat. The same dish + meat + count as the last add is a repeat, not a new line. ("dos de" never means dorados.) */
const MORE_SEG = /^(?:y\s+)?(?:tambi[eé]n\s+)?(?:me\s+(?:da|pone|das|pones)\s+)?(\d{1,2}|una?|uno|dos|tres|cuatro|cinco|seis|otr[ao]s?)\s+(?:m[aá]s\s+)?de\s+([\p{L}\s]+?)$/iu;
export function sameDishMore(input: ElviRequest): ElviResponse | null {
  const key = (input as any).sessionKey; const last = key ? lastAddBySession.get(key) : undefined;
  if (!last || Date.now() - last.at > 3 * 3600_000) return null;
  const t = fuPlain(String(input.transcript || "")).replace(/\b(por favor|please|porfa)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!t || DISH_RE.test(t)) return null;
  const menu = (((input as any).resolverMenu || input.menu || []) as MenuItem[]);
  const item: any = menu.find((m) => m.id === last.itemId); if (!item) return null;
  const meatG: any = (item.modifierGroups || []).find((g: any) => /carne|meat/i.test(g.name) && !/extra/i.test(g.name)); if (!meatG) return null;
  const segs = t.split(/\s*(?:,|\.|;|\by\b(?=\s+(?:\d|una?|uno|dos|tres|cuatro|cinco|seis|otr)))\s*/).map((x) => x.trim()).filter(Boolean);
  const N: Record<string, number> = { un: 1, una: 1, uno: 1, otra: 1, otro: 1, otras: 2, otros: 2, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
  const adds: any[] = [];
  for (const seg of segs) {
    if (/^(?:(?:no|digo|solo|ah|eh|este|bueno|si|aja|pero|o sea|perdon|cuatro|tres|cinco|seis|dos y dos|\d+)\s*)+$/.test(seg)) continue; // "No, digo, solo, ah, cuatro"
    const m = MORE_SEG.exec(seg); if (!m) return null;
    const opt = (meatG.options || []).map((o: any) => (typeof o === "string" ? { name: o } : o)).find((o: any) => meatOptSaid(o.name, m[2]));
    if (!opt) return null;
    const q = /\d/.test(m[1]) ? Number(m[1]) : N[m[1]] || 1;
    const others = (last.modifiers || []).filter((x: any) => !(meatG.options || []).some((o: any) => (typeof o === "string" ? o : o.name) === x.option));
    adds.push({ type: "add_item", itemId: item.id, quantity: q, modifiers: [...others.map((x: any) => ({ step: x.step, option: x.option })), { step: meatG.name, option: opt.name }] });
  }
  if (!adds.length) return null;
  const lastMeat = (last.modifiers || []).find((x: any) => (meatG.options || []).some((o: any) => (typeof o === "string" ? o : o.name) === x.option))?.option;
  const fresh = adds.filter((a, i) => !(i === 0 && a.quantity === last.quantity && a.modifiers[a.modifiers.length - 1].option === lastMeat)); // repeat of the last line
  const language = input.language as Language;
  if (!fresh.length) return { language, engine: "xai", reply: language === "es" ? "Sí, ya los tengo. ¿Algo más?" : "Yes, I have those. Anything else?", actions: [] } as any;
  return { language, engine: "xai", reply: addReadback(fresh, menu, language), actions: fresh } as any;
}
/** again1: "y otras dos" / "otros tres iguales" with no dish or meat named = that many more of the LAST line, same options. */
export function sameAgain(input: ElviRequest): ElviResponse | null {
  const key = (input as any).sessionKey; const last = key ? lastAddBySession.get(key) : undefined;
  if (!last || Date.now() - last.at > 3 * 3600_000) return null;
  const t = fuPlain(String(input.transcript || "")).replace(/\b(por favor|please|porfa)\b/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const m = t.match(/^(?:(?:y|ah|eh|si|aja|este|tambien)\s+)*(?:otr[oa]s?\s+(\d{1,2}|dos|tres|cuatro|cinco|seis)|(\d{1,2}|dos|tres|cuatro|cinco|seis)\s+m[aá]s|otr[oa])(?:\s+(?:igual(?:es)?|asi|mas))*$/);
  if (!m) return null;
  const N: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
  const w = m[1] || m[2];
  const q = !w ? 1 : /\d/.test(w) ? Number(w) : N[w] || 1;
  const menu = (((input as any).resolverMenu || input.menu || []) as MenuItem[]);
  if (!menu.some((i) => i.id === last.itemId)) return null;
  const acts: any[] = [{ type: "add_item", itemId: last.itemId, quantity: q, modifiers: (last.modifiers || []).map((x: any) => ({ step: x.step, option: x.option })) }];
  return { language: input.language, engine: "xai", reply: addReadback(acts, menu, input.language as Language), actions: acts } as any;
}

/** prep1: "preparada" / "deluxe" / "normal" right after a dish was rung = switch that line to the sibling variation
 * (same Square item, other variation) whose name carries the word — options kept. */
export function variationSwitch(input: ElviRequest): ElviResponse | null {
  const key = (input as any).sessionKey; const last = key ? lastAddBySession.get(key) : undefined;
  if (!last || Date.now() - last.at > 3 * 3600_000) return null;
  const t = fuPlain(String(input.transcript || "")).replace(/\b(por favor|please|porfa|gracias)\b/g, " ").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const m = t.match(/^(?:(?:no|si|ah|eh|aja|este|mejor|la|el)\s+)*(preparad[ao]s?|deluxe|regular(?:es)?|normal(?:es)?|sencill[ao]s?)$/);
  if (!m) return null;
  const menu = (((input as any).resolverMenu || input.menu || []) as MenuItem[]);
  const cur: any = menu.find((i) => i.id === last.itemId);
  if (!cur?.squareCatalogObjectId) return null;
  const want = /^(preparad|deluxe)/.test(m[1]) ? /deluxe|preparad/i : /regular|normal|sencill/i;
  const sibs = menu.filter((i: any) => i.squareCatalogObjectId === cur.squareCatalogObjectId && i.id !== cur.id && want.test(String(i.name)));
  if (want.test(String(cur.name))) return { language: input.language, engine: "xai", reply: input.language === "en" ? "Yes, I have it that way. Anything else?" : "Sí, así la tengo. ¿Algo más?", actions: [] } as any;
  if (sibs.length !== 1) return null;
  const add: any = { type: "add_item", itemId: sibs[0].id, quantity: last.quantity, modifiers: (last.modifiers || []).map((x: any) => ({ step: x.step, option: x.option })) };
  return { language: input.language, engine: "xai", reply: addReadback([add], menu, input.language as Language), actions: [{ type: "remove_item", itemId: cur.id, quantity: last.quantity }, add] } as any;
}
/** alex1: "¿tiene chilaquiles?" asks if we sell it — answer, don't ring one.
 *  ca0d0e12: "Ah, me pone un, si tiene torta de milanesa" is availability (staff out of bolillo) — never add torta. */
const AVAIL_Q = /^(?:[\s,.¿¡]*(?:disculp[ae]|oiga|perd[oó]n|hola|bueno|buenas|s[ií]|ah|eh|este|(?:el\s+d[ií]a\s+de\s+)?hoy|ahorita|today|right\s+now|(?:me\s+)?(?:pone|pones|pongo|ponme|p[oó]ngame)\s+(?:un[oa]?)?)\b)*[\s,.¿¡]*(?:s[ií]\s+)?(?:tienes?|tienen|hay|venden|manejan|do\s+you\s+(?:have|sell|guys\s+have)|you\s+guys\s+have)\s+([^?]+?)\??\s*$/iu;
// alex1: "Y en otro … este," + "en vez de huevos bistec" = another of the last dish with that meat (no extra egg).
// alex1: "¿tiene chilaquiles?" … "deme uno con," — the dish was just asked about; ring one plain and let them finish.
export function oneOfAskedDish(input: ElviRequest): ElviResponse | null {
  const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const t = norm(String(input.transcript || ""));
  const m = t.match(/\b(?:deme|dame|me da|quiero|give me|i'?ll take)\s+(un[oa]?|one)\b(.*)$/);
  if (!m || /[a-z]{3,}/.test(m[2].replace(/\b(con|with|de|of|por favor|please|este|esta|ah|eh)\b/g, ""))) return null;
  const said = (input.history || []).filter((h: any) => h.role === "customer").slice(-3).map((h: any) => norm(String(h.text || ""))).join(" ");
  const menu: any[] = (input as any).resolverMenu || input.menu || [];
  const hits = menu.filter((i: any) => { const w = norm(String(i.name || "")).split(/\s+/)[0]; return w.length >= 6 && new RegExp(`\\b${w}`).test(said); });
  const ids = [...new Set(hits.map((h) => h.id))];
  if (ids.length !== 1) return null;
  const item = hits[0];
  return { language: input.language, reply: input.language === "en" ? `${item.name}. With what?` : `${item.name}. ¿Con qué?`, actions: [{ type: "add_item", itemId: item.id, quantity: 1, modifiers: [] }] } as any;
}

export function insteadOfEggs(input: ElviRequest): ElviResponse | null {
  const t = String(input.transcript || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const m = t.match(/\b(?:en vez de|en lugar de|instead of)\s+(?:los\s+|the\s+)?(?:huevos?|eggs?)\s*(?:,\s*)?(?:con\s+|with\s+)?(.+)$/);
  const key = (input as any).sessionKey; const last = key ? lastAddBySession.get(key) : undefined;
  if (!m || !last) return null;
  const item: any = ((input as any).resolverMenu || input.menu || []).find((i: any) => i.id === last.itemId);
  const opts = (item?.modifierGroups || []).flatMap((g: any) => (g.options || []).map((o: any) => ({ g, o })));
  const hits = opts.filter(({ o }: any) => !/extra/i.test(o.name) && meatOptSaid(o.name, m[1]));
  if (!item || hits.length !== 1) return null;
  const prev: any[] = (input.history || []).filter((h: any) => h.role === "customer").slice(-1);
  const another = /\b(otr[oa]s?|another|one more)\b/i.test(String(prev[0]?.text || "")) || /\b(otr[oa]|another)\b/i.test(t);
  const mods = [{ step: hits[0].g.name, option: hits[0].o.name }];
  const es = input.language !== "en";
  return { language: input.language, reply: es ? `${item.name} con ${hits[0].o.name.replace(/\s*\(.*\)$/, "")}. ¿Algo más?` : `${item.name} with ${hits[0].o.name.replace(/\s*\(.*\)$/, "")}. Anything else?`,
    actions: [another ? { type: "add_item", itemId: item.id, quantity: 1, modifiers: mods } : { type: "update_item", itemId: item.id, quantity: last.quantity, modifiers: mods, correction: true }] } as any;
}

export function availabilityQuestion(input: ElviRequest): ElviResponse | null {
  const t = String(input.transcript || "").trim();
  // avail2 (Oct 22 10:33): "¿tienen X?" … "¿Y agua de Jamaica?" — a bare "y/and + dish" right after an availability
  // question is the same question (no quantity, no order verb), not an order. The order comes later ("un agua … grande").
  const prevCust = (input.history || []).filter((h: any) => h.role === "customer").slice(-1)[0]?.text || "";
  if (AVAIL_Q.test(String(prevCust).trim()) && /^[\s¿¡,.]*(?:y|and)\s+(?!(?:me|nos|le)\b)[^?]{2,40}\??\s*$/iu.test(t) && t.split(/\s+/).length <= 6
    && !/\b(\d+|un[oa]?|dos|tres|cuatro|cinco|one|two|three|four|quiero|dame|deme|ponme|p[oó]ngame|agr[eé]g|want|give|add)\b/i.test(t)) {
    const es = input.language !== "en";
    return { language: input.language, engine: "xai", reply: es ? "Sí, también tenemos. ¿Le preparo algo?" : "Yes, we have that too. What can I get you?", actions: [] } as any;
  }
  const m = AVAIL_Q.exec(t); if (!m) return null;
  if (/\b(\d+|dos|tres|cuatro|cinco|two|three|four)\b/i.test(m[1])) return null;
  const es = input.language === "es";
  return { language: input.language, engine: "xai", reply: es ? "Sí, sí tenemos. ¿Cuántos le preparo?" : "Yes, we do. How many would you like?", actions: [] } as any;
}
/** alex1: a turn that names neither the dish nor "another/otro" can't start a NEW line of the dish just rung — it changes that
 * line ("dos huevos", "en vez de huevos bistec"). "dos huevos" on a dish that already comes with two eggs is not an extra. */
/** case1 (Oct 21 1:55 PM): the customer's own words override choices the model invented.
 *  - "sin frijoles" → no bean options on that line
 *  - a cheese-gordita (QGD) "con queso" already IS the cheese → no extra Queso Derretido unless "derretido/melted/extra queso"
 *  - "con frijoles" on a gordita = the "Con Frijoles" option, not a second Frijoles Refritos filling (unless "refritos")
 *  - tortilla: the LAST tortilla word the caller said wins ("¿de harina o de maíz?" … "De maíz" → Comal, not Harina) */
export function caseFix(result: ElviResponse, input: ElviRequest): ElviResponse {
  if (!result?.actions?.length) return result;
  const norm = (x: string) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const t = norm(String(input.transcript || ""));
  const recent = [...(input.history || []).filter((h: any) => h.role === "customer").slice(-3).map((h: any) => norm(h.text)), t].join(" ");
  const menu: any[] = (input as any).resolverMenu || input.menu || [];
  // case1e: a dish-type word can be several turns back (Elvi's own questions and autos in between)
  const custTurns = (input.history || []).filter((h: any) => h.role === "customer").map((h: any) => norm(h.text));
  const sinceDish = custTurns.slice(Math.max(0, custTurns.length - 6));
  const recentWide = [...sinceDish, t].join(" ");
  const actions = result.actions.map((a: any) => {
    if (!(a?.type === "add_item" || a?.type === "update_item") || !Array.isArray(a.modifiers)) return a;
    let mods = [...a.modifiers]; const on = (re: RegExp) => mods.some((m) => re.test(String(m.option)));
    if (/\bsin frijol/.test(t)) mods = mods.filter((m) => !/frijol|beans/i.test(String(m.option)));
    if (on(/\(QGD\)|queso gordita/i) && !/derretid|melted|extra (de )?queso|mas queso/.test(t)) mods = mods.filter((m) => !/queso derretido|melted cheese/i.test(String(m.option)));
    // quesitorta1: spoken "queso torta(s)" forces (QTO); not (TO)+Queso Derretido
    {
      const itemT = menu.find((i: any) => i.id === a.itemId);
      if (itemT && /^torta$/i.test(String(itemT.name).trim()) && (/\bqueso\s+tortas?\b/.test(recentWide) || (/\bcon\s+queso\b/.test(t) && !/\b(?:fresco|derretid|melted|extra|mas)\b/.test(t)))) {
        const hit = (itemT.modifierGroups || []).flatMap((g: any) => (g.options || []).map((o: any) => ({ g, o }))).find(({ o }: any) => /\(QTO\)/i.test(String(o.name)));
        if (hit) {
          mods = mods.filter((m) => !/^\s*\((?:TO|QTO)\)/i.test(String(m.option)));
          mods.unshift({ step: hit.g.name, option: hit.o.name });
          if (!/derretid|melted|extra (de )?queso|mas queso/.test(t)) mods = mods.filter((m) => !/queso derretido|melted cheese/i.test(String(m.option)));
        }
      }
    }
    // jesus2: a Queso Torta already IS the cheese → no Queso Derretido unless they asked extra/más/melted
    if (on(/\(QTO\)/i) && !EXPLICIT_EXTRA_MELTED.test(t)) mods = mods.filter((m) => !/queso derretido|melted cheese/i.test(String(m.option)));
    // jesus2: two meats on one line ("de chorizo y bistec combinado", "con chorizo y bistec") → both (meat group up to 2)
    {
      const itemM = menu.find((i: any) => i.id === a.itemId);
      const pair = /\b(?:de|con|of|with)\s+([a-z]+(?:\s+[a-z]+)?)\s+(?:y|con|and|e|&)\s+([a-z]+(?:\s+[a-z]+)?)\b/.exec(t);
      const sameItem = result.actions.filter((x: any) => x?.type === "add_item" && x.itemId === a.itemId).length;
      if (itemM && pair && a.type === "add_item" && sameItem === 1 && !/\b(?:una?|dos|tres|otr[ao]s?|one|two|another)\s+(?:de|con|of|with)\b/.test(t)) {
        const mg = (itemM.modifierGroups || []).find((g: any) => /carne|meat/i.test(String(g.name)) && !/extra|double/i.test(String(g.name)) && (Number(g.maxSelections) || 2) >= 2);
        const mopts = (mg?.options || []).map((o: any) => String(typeof o === "string" ? o : o.name)).filter((n: string) => !/extra|double/i.test(n));
        const pick = (w: string) => mopts.find((n: string) => meatOptSaid(n, w));
        const want = [pick(pair[1]), pick(pair[2])].filter(Boolean) as string[];
        if (want.length === 2 && want[0] !== want[1]) {
          const have = mods.filter((m) => mopts.includes(String(m.option))).map((m) => String(m.option));
          if (have.length < 2 && have.every((h) => want.includes(h))) for (const w of want) if (!have.includes(w)) mods.push({ step: mg.name, option: w } as any);
        }
      }
    }
    // rich1→live: "double meat" / "doble carne" on this line → the DOUBLE Carne option when the item has one
    if (/\b(?:double|doble)\s+(?:the\s+)?(?:meat|carne)\b/.test(t) && !on(/double carne/i)) {
      const itemD = menu.find((i: any) => i.id === a.itemId);
      for (const g of itemD?.modifierGroups || []) for (const o of g.options || []) { const n = String(typeof o === "string" ? o : o.name);
        if (/double carne/i.test(n) && !on(/double carne/i)) mods.push({ step: g.name, option: n } as any); }
    }
    if (on(/con frijoles|with beans/i) && !/refrit/.test(t)) mods = mods.filter((m) => !/frijoles refritos|refried beans/i.test(String(m.option)) || /con frijoles|with beans/i.test(String(m.option)));
    // case1e: "de chicharrón dorada … de maíz" — dorada/frita is the Quesadilla Dorada (corn, fried), not a comal tortilla
    const item0 = menu.find((i: any) => i.id === a.itemId);
    if (a.type === "add_item" && item0 && /^quesadilla$/i.test(String(item0.name).trim()) && /\b(dorad[ao]s?|frit[ao]s?|fried)\b/.test(recentWide) && !/\b(harina|flour)\W*$/.test(t)) {
      const qd = menu.find((i: any) => /quesadilla dorada/i.test(i.name) && !/deluxe|online|preparad/i.test(i.name));
      if (qd) {
        const qdOpts = (qd.modifierGroups || []).flatMap((g: any) => (g.options || []).map((o: any) => ({ g, o })));
        const kept = mods.filter((m) => !/^\s*\([A-Z]{1,4}\)/.test(String(m.option))).map((m) => { const hit = qdOpts.find(({ o }: any) => o.name === m.option) || qdOpts.find(({ o }: any) => !/extra/i.test(o.name) && meatOptSaid(o.name, String(m.option).toLowerCase().split(" /")[0])); return hit ? { step: hit.g.name, option: hit.o.name } : null; }).filter(Boolean) as any[];
        const reg = qdOpts.find(({ o }: any) => /REGULAR/i.test(o.name));
        if (reg && !kept.some((m) => m.option === reg.o.name)) kept.unshift({ step: reg.g.name, option: reg.o.name });
        return { ...a, itemId: qd.id, modifiers: kept };
      }
    }
    const words = [...recent.matchAll(/\b(harina|flour|maiz|comal|hecha a mano|handmade|taquer[oa]s?|street|chiquitos?)\b/g)].map((m) => m[1]); // qty1: "del chiquito, taquero" is the street taco
    const lastW = words[words.length - 1];
    const want = !lastW ? null : /harina|flour/.test(lastW) ? /harina|flour|\(QHR\)/i : /taquer|street|chiquit/.test(lastW) ? /taquer|street|\(TST\)/i : /comal|homemade|\(QCO\)/i;
    const item = menu.find((i: any) => i.id === a.itemId);
    if (want && item) for (const g of item.modifierGroups || []) {
      const opts = (g.options || []).map((o: any) => String(o.name));
      if (!opts.some((o: string) => /harina|flour/i.test(o)) || !opts.some((o: string) => /comal|homemade/i.test(o))) continue;
      if (EXTRA_TORT.test(String(g.name)) || opts.every((o: string) => /^\s*\*{2,}|\bextra\b/i.test(o))) continue; // tortilla2: Extras are add-ons
      const i = mods.findIndex((m) => opts.includes(String(m.option)));
      const pick = opts.find((o: string) => want.test(o));
      if (i >= 0 && pick && !want.test(String(mods[i].option))) mods[i] = { ...mods[i], option: pick };
    }
    // tortilla2 (Carlos): one tortilla TYPE per item; extra tortillas are the paid Extras add-on, only when asked
    // ("más tortillas", "extra tortillas") — never a second type.
    if (item) {
      const isExtra = (o: string) => /^\s*\*{2,}|\bextra\b/i.test(o) && /tortilla/i.test(o);
      const typeGroups = (item.modifierGroups || []).filter((g: any) => /tortilla|shell/i.test(g.name) && !EXTRA_TORT.test(g.name) && (g.options || []).length > 1 && !(g.options || []).every((o: any) => isExtra(String(o.name))));
      for (const g of typeGroups) { const opts = (g.options || []).map((o: any) => String(o.name)); const idx = mods.map((m, i) => opts.includes(String(m.option)) ? i : -1).filter((i) => i >= 0);
        if (idx.length > 1) mods = mods.filter((_, i) => !idx.slice(0, -1).includes(i)); }
      const askedExtra = EXTRA_TORT_SAID.test(recentWide);
      if (!askedExtra) mods = mods.filter((m) => !isExtra(String(m.option)));
      else if (!mods.some((m) => isExtra(String(m.option)))) {
        const xg = (item.modifierGroups || []).find((g: any) => (g.options || []).some((o: any) => isExtra(String(o.name))));
        if (xg) { const flourish = /\b(harina|flour)\b/.test(recentWide.slice(recentWide.search(EXTRA_TORT_SAID))) || mods.some((m) => /harina|flour/i.test(String(m.option)) && !isExtra(String(m.option)));
          const pick = (xg.options || []).map((o: any) => String(o.name)).filter(isExtra).find((o: string) => flourish ? /harina|flour/i.test(o) : /comal|corn|homemade/i.test(o));
          if (pick) mods.push({ step: xg.name, option: pick } as any); }
      }
    }
    return { ...a, modifiers: mods };
  });
  // tortilla3 (Carlos): an item with a tortilla type choice is never silently defaulted — when the caller hasn't said a
  // type anywhere on the call, hold the add and ask "¿comal o harina?" / "corn or flour?".
  const custAll = [...custTurns, t].join(" ");
  if (!TORT_TYPE_SAID.test(custAll)) {
    for (const a of actions as any[]) {
      if (a?.type !== "add_item") continue; const item = menu.find((i: any) => i.id === a.itemId); if (!item) continue;
      const g = (item.modifierGroups || []).find((g: any) => /tortilla|shell/i.test(g.name) && !EXTRA_TORT.test(g.name) && (g.minSelections ?? 0) > 0
        && (g.options || []).some((o: any) => /harina|flour/i.test(o.name)) && (g.options || []).some((o: any) => /comal|corn|homemade/i.test(o.name)));
      if (!g) continue;
      const name = String(item.readbackName || item.name).split(" / ")[0];
      const q = input.language === "es" ? `${name}: ¿comal o harina?` : `${name}: corn or flour?`;
      return { ...result, audioBase64: undefined, audioMimeType: undefined, actions: (actions as any[]).filter((x) => x !== a), reply: q } as any;
    }
  }
  // jesus2: "coca de vidrio" / glass / Mexican Coke → same Coca Cola SKU, read back as the glass bottle (never "taparrosca")
  if (/\b(?:vidrio|glass|mexican\s+coke|botella\s+de\s+vidrio)\b/.test(recentWide) && !/\btaparrosca\b/.test(t)) {
    let hit = false;
    for (const a of actions as any[]) { const it = menu.find((i: any) => i.id === a?.itemId);
      if (a?.type === "add_item" && /coca/i.test(`${it?.name || ""} ${a.itemId}`)) { a.readback = input.language === "en" ? "Coca Cola (glass bottle)" : "Coca Cola de vidrio"; hit = true; } }
    if (hit && /taparrosca/i.test(String(result.reply || ""))) return { ...result, actions, reply: String(result.reply).replace(/\btaparrosca\b/gi, "de vidrio"), audioBase64: undefined, audioMimeType: undefined } as any;
  }
  return { ...result, actions };
}
const EXTRA_TORT = /\bextra\b/i;
const EXTRA_TORT_SAID = /\b(extra|m[aá]s|more|additional)\s+(de\s+|of\s+)?tortill|\btortill\w*\s+(extra|adicional)/;
export const TORT_TYPE_SAID = /\b(comal|ma[ií]z|corn|harina|flour|hech[oa]s?\s+a\s+mano|handmade|homemade|street|taquer[oa]s?|chiquit[oa]s?|dorad[ao]s?)\b/;

export function sameLineGuard(result: ElviResponse, input: ElviRequest): ElviResponse {
  const key = (input as any).sessionKey; const last = key ? lastAddBySession.get(key) : undefined;
  const acts = (result?.actions || []) as any[]; if (!last || acts.length !== 1 || acts[0]?.type !== "add_item" || acts[0].itemId !== last.itemId) return result;
  const menu = (((input as any).resolverMenu || input.menu || []) as MenuItem[]); const item: any = menu.find((m) => m.id === last.itemId); if (!item) return result;
  const t = fuPlain(String(input.transcript || "")), prev = fuPlain([...(input.history || [])].reverse().find((h) => h.role === "customer")?.text || "");
  const noun = dishNounOf(item);
  const fresh = (x: string) => (noun && new RegExp(`\\b${noun}`).test(x)) || /\b(otr[oa]s?|another|uno mas|una mas|one more)\b/.test(x);
  let a = { ...acts[0], modifiers: [...(acts[0].modifiers || [])] };
  if (/huevo/i.test(item.name) && /\bdos huevos\b/.test(t) && !/\b(extra|mas huevo|tres huevos)\b/.test(t)) a.modifiers = a.modifiers.filter((m: any) => !/extra\s*huevo/i.test(String(m.option)));
  if (/\ben vez de\s+(?:los\s+)?huevos?\b/.test(t)) a.modifiers = a.modifiers.filter((m: any) => !/extra\s*huevo/i.test(String(m.option)));
  if (fresh(t) || fresh(prev)) return { ...result, actions: [a] }; // a new line ("deme uno", "y en otro …," + "en vez de huevos bistec")
  const same = JSON.stringify((a.modifiers || []).map((m: any) => m.option).sort()) === JSON.stringify((last.modifiers || []).filter((m: any) => !m.isDefault).map((m: any) => m.option).sort());
  if (same) return { ...result, actions: [], reply: input.language === "es" ? "Muy bien. ¿Algo más?" : "Okay. Anything else?" };
  return { ...result, actions: [{ type: "update_item", itemId: a.itemId, quantity: last.quantity, modifiers: a.modifiers, correction: true } as any] };
}
const dishNounOf = (item: any) => fuPlain(String(item?.name || "")).replace(/\(.*?\)/g, " ").split(/\s+/).find((w: string) => w.length >= 4)?.replace(/e?s$/, "") || "";
export function multiDishTurn(input: ElviRequest): ElviResponse | null {
  const menu = (((input as any).resolverMenu || input.menu || []) as MenuItem[]);
  const clauses = splitDishClauses(String(input.transcript || ""));
  if (!clauses.length) return null;
  const language = input.language as Language;
  const adds: any[] = [];
  try {
    for (const c of clauses) {
      const items = pinnedMenu(c, menu);
      if (!items.length || items.length >= menu.length) return null;
      const req: any = { text: c, language, actionHint: "add_item", toolArgs: { itemQuery: c }, cart: [] };
      const r: any = completeWithSiteDefaults(resolveEspecialRequest(items as any, req) || resolveMenuRequest(items as any, req), menu, c);
      if (!r?.ok) return null;
      let mine: any[] = fixNamedMeats((r.actions || []).filter((a: any) => a?.type === "add_item"), menu, c) as any[];
      const own = spokenQtyFor(c, items);
      if (own && mine.length === 1) mine = [{ ...mine[0], quantity: own }];
      for (const a of mine) adds.push({ type: "add_item", itemId: String(a.itemId), quantity: Math.max(1, Number(a.quantity) || 1), modifiers: (a.modifiers || []).map((m: any) => ({ step: String(m.groupName || m.groupId || m.step || ""), option: String(m.option || "") })) });
    }
  } catch { return null; }
  if (!adds.length) return null;
  const out = withSalsaDefault({ language, engine: "xai", reply: addReadback(adds, menu, language), actions: adds } as any, String(input.transcript || ""), menu, language);
  return { ...out, reply: addReadback(out.actions as any, menu, language) } as any;
}

export function resolveFollowUp(heard: string, history: ConversationTurn[] | undefined, menu: MenuItem[], language: Language): Pick<ElviResponse, "reply" | "actions"> & { said?: string } | null {
  const ctx = followUpContext(history as any, menu);
  if (!ctx || !heard) return null;
  // A new dish by name ("mejor un burrito") starts over instead.
  const alone = pinnedMenu(heard, menu);
  if (alone.length && alone.length < menu.length && !alone.some((m) => ctx.items.includes(m))) return null;
  // horchata1: a different menu item named by its own distinctive word ("un agua de horchata") also starts over —
  // pinnedMenu doesn't pin drinks, so a stale dish question (Menudo) swallowed every later turn.
  { const h = fuPlain(heard); const words = (m: any) => fuPlain(String(m.name || "")).replace(/\(.*?\)|\d+\s*oz/g, " ").split(/[^a-z]+/).filter((w) => w.length >= 5 && !/^(fresca|frescas|grande|extra|order|orden|tortillas?|regular|especial)$/.test(w));
    // comal1: the asked dish's own option words ("de comal" for Quesadilla: ¿Comal, Harina…?) answer the question —
    // another item that merely shares the word (Tortillas Comal) is not a new dish.
    // opt2: add-on options ("*** HORCHATA 32oz (+$5.00)", "EXTRA …" on Menudo) don't count — a drink named then is its own item
    const optWords = (m: any) => (m.modifierGroups || []).flatMap((g: any) => (g.options || []).map((o: any) => String(typeof o === "string" ? o : o.name)))
      .filter((n: string) => !/^\s*\*{2,}|^\s*extra\b/i.test(n)).flatMap((n: string) => fuPlain(n).split(/[^a-z]+/).filter((w) => w.length >= 5));
    const own = new Set([...ctx.items.flatMap(words), ...ctx.items.flatMap(optWords)]);
    if (menu.some((m) => !ctx.items.includes(m) && words(m).some((w) => !own.has(w) && new RegExp(`\\b${w}s?\\b`).test(h)))) return null; }
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
    // fix_uriel: an answer that carries its own count for this dish ("me pone dos tortas de bistec") keeps it.
    const own = spokenQtyFor(heard, ctx.items) || spokenQtyFor(ctx.saidTurns.join(" "), ctx.items); // cheyenne1: "Dos tacos de bistec" → "¿qué tortilla?" → "hecha a mano" keeps 2
    if (own && adds.length === 1) adds[0].quantity = own;
    // Everything the caller said for this dish, so later checks see "only rice" and "half pollo" alike.
    return { reply: addReadback(adds, menu, language), actions: adds, said: [...ctx.saidTurns, heard].join(" ") };
  } catch {
    return null;
  }
}

/**
 * Last step for phone/Elvi (chat, voice text, voice audio). EXTRA add-ons only when asked for.
 * phone1: online pickup+prep windows stay on the website; voice uses phone category/day rules
 * (Menudo from category open on Sat/Sun). Doradas keep the displayed Especial window (hours1).
 */
export function finalizeTurn(result: ElviResponse, heard: string, menu: MenuItem[], language: Language, variationChosen = false): ElviResponse {
  const phoneOpts = { channel: "phone" as const };
  let actions = rescoreSingleChoices(dropUnaskedExtras(result.actions, heard), menu, heard);
  // Multi-option dish the caller didn't specify (the model added "ceviche" as fish): ask, like the website.
  for (const a of actions) {
    if (a.type !== "add_item") continue;
    // Size/kind already chosen in the follow-up questions.
    if (variationChosen) continue;
    // hours1 (8:03 PM call): a dish outside its website hours is refused once below — never ask its Regular/Deluxe first
    { const st0 = storeState()?.state; const it0 = menu.find((m) => m.id === a.itemId); if (it0 && (st0 === "open" || st0 === "last_order" || !st0) && unavailableNowReply(it0, it0.squareCatalogObjectId, language, undefined, phoneOpts)) continue; }
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
  // time1: while the store is closed / before opening, orders are for later — time-window items are checked at checkout instead
  const st = storeState()?.state; if (st === "open" || st === "last_order" || !st) out = enforceSiteAvailability(out, menu, language, undefined, phoneOpts);
  if (out !== result && out.reply !== result.reply) return out;
  if (!out.actions.some((a) => a.type === "add_item") && !out.pendingGuides?.length && heard) {
    try {
      const req: any = { text: heard, language, actionHint: "add_item", toolArgs: { itemQuery: heard }, cart: [] };
      const r: any = resolvePackMealRequest(pinnedMenu(req.text, menu) as any, req) || resolveEspecialRequest(pinnedMenu(req.text, menu) as any, req) || resolveMenuRequest(pinnedMenu(req.text, menu) as any, req);
      const id = r?.selectedItem?.itemId || r?.actions?.find((a: any) => a?.type === "add_item")?.itemId;
      const item = id && menu.find((m) => m.id === id);
      // avail2: before opening / after close the order is for later (time1) — don't refuse time-window dishes here either
      const hours = item && (st === "open" || st === "last_order" || !st) ? unavailableNowReply(item, item.squareCatalogObjectId, language, undefined, phoneOpts) : null;
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
  if (pre.reply) return { ...result, reply: pre.reply, actions: [...splitActions(pre.adds), ...((pre.updates || []) as any[])], audioBase64: undefined, audioMimeType: undefined, customerTranscript: heard } as any;
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
  if (!/api\.x\.ai/.test(runtime.baseUrl)) return await chatWithTextAgent(input, runtime, instructions);
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

  // donts1: audited "what not to do" list (data/elvi-donts.json), read once.
  const donts = (() => { try { return (JSON.parse(readFileSync(new URL("../data/elvi-donts.json", import.meta.url), "utf8")).donts || []) as string[]; } catch { return [] as string[]; } })();
  return [
    "You are Elvi, the fastest and most accurate order taker at Cocina Elvis. Act like an experienced human cashier who gets it right the first time.",
    ...(donts.length ? ["NEVER DO THESE (from real missed orders):", ...donts.map((d) => "- " + d)] : []),
    "Never greet, make small talk, or explain yourself. Only speak to confirm actions or ask the absolute minimum needed to complete the order.",
    "Keep every reply to ONE short sentence (under 8 words when possible). Confirmations: 'Added.', 'Got it.', 'Removed.', 'Anything else?'.",
    "Always prefer action over questions. When the transcript is even slightly understandable, immediately call the correct tool instead of asking for clarification.",
    "Handle noisy, partial, or accented speech gracefully. Infer the most likely intent from context + current cart and act on it. Only ask when truly ambiguous.",
    "If the customer corrects you or changes their mind, adapt instantly and call update_item or remove_item without hesitation.",
    "Use tools for every change: add_item, remove_item, update_item, set_fulfillment, set_address, set_customer, checkout. Never describe changes — execute them.",
    "After any tool call, trust the returned cart state completely. Never say the cart is empty if it has items.",
    "When the customer says 'done', 'checkout', 'pagar', or similar, immediately set pickup if missing, then call checkout.",
    launchConfig.deliveryEnabled
      ? deliveryDialogRules({ verifiedSavedStreet: null }) // delivery1: the app has no phone verification yet → always ask
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
      {
        // delivery1: geocoded zone/fee/ETA (cached); not looked up yet → start the lookup and ask to re-check / confirm.
        const address = String(args.address || "").trim();
        const q = cachedQuote(address);
        if (!q) void quoteDeliveryAddress(address).catch(() => null);
        return {
          output: q
            ? { ok: true, available: true, in_zone: q.ok, needs_confirm: q.needsConfirm, reason: q.reason || null, fee_cents: q.feeCents ?? null, eta_minutes: q.etaMinutes ?? null, city: q.city ?? null, fee_confirmed: q.feeConfirmed !== false, delivery_cents: q.deliveryCents ?? null, service_cents: q.serviceCents ?? null, breakdown: q.breakdown ?? null, minimum_subtotal_cents: q.minimumCents ?? 1000, message_es: q.message.es, message_en: q.message.en }
            : { ok: true, available: true, in_zone: null, needs_confirm: true, reason: "pending", message: "Looking up the address — call check_delivery_zone again in a moment; if it still can't be found, staff will confirm the zone and fee." }
        };
      }
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
  result = withoutNameTurnAdds(result, heard, language);
  if (!result?.actions?.length) return result;
  const actions = withConAddons(withConTodo(withDefaultSalsa(fixToppingNegations(fixNamedMeats(fixBurritoFillings(result.actions as any[], menu, heard, "elvi"), menu, heard, "elvi"), menu, heard, "elvi"), menu, heard, "elvi"), menu, heard), menu, heard) as ElviAction[]; // sopesaso1: con todo; rice1/addons1: Con/With paid add-ons
  if (JSON.stringify(actions) === JSON.stringify(result.actions)) return result;
  const reply = String(result.reply || "");
  const isReadback = /(¿Algo más\?|Anything else\?)\s*$/.test(reply);
  return isReadback
    ? { ...result, actions, reply: addReadback(actions, menu, language), audioBase64: undefined, audioMimeType: undefined }
    : { ...result, actions };
}

/** nameturn1: on the name turn ("Uriel. Sí, está bien") the model sometimes re-adds an earlier item merged with
 *  another item's meat (2 × Torta bistec + prensado). A set_customer turn that names no food can't add/change items. */
const FOOD_WORD = /\b(?:tacos?|tortas?|quesadillas?|gorditas?|burritos?|sopes?|sopesasos?|huaraches?|doradas?|nachos|birrias?|pambazos?|enchiladas?|tamales?|aguas?|horchata|jamaica|refrescos?|sodas?|bistec|steak|asada|pastor|chorizo|pollo|chicken|prensado|chicharron|carnitas|suadero|lengua|cabeza|tripa|barbacoa|arroz|rice|frijol(?:es)?|beans|queso|cheese|crema|salsa|combos?|meal|platillos?|extra|mas|more|otr[oa]s?|another|add|agrega)\b/;
export function withoutNameTurnAdds(result: ElviResponse, heard: string, language: Language): ElviResponse {
  const acts = (result?.actions || []) as any[];
  if (!acts.some((a) => a?.type === "set_customer") || !acts.some((a) => a?.type === "add_item" || a?.type === "update_item")) return result;
  const said = String(heard || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (FOOD_WORD.test(said)) return result;
  const actions = acts.filter((a) => a?.type !== "add_item" && a?.type !== "update_item") as ElviAction[];
  const c: any = acts.find((a) => a?.type === "set_customer");
  const name = cleanFirstName(c?.name || c?.customer?.name || "") || "";
  return { ...result, actions, reply: name ? nameAckText(language as any, name) : String(result.reply || ""), audioBase64: undefined, audioMimeType: undefined };
}

/** fix18: the last line Elvi added per order session, for quantity corrections ("no, mejor tres"). */
const lastAddBySession = new Map<string, { itemId: string; quantity: number; modifiers?: any[]; at: number }>();
const QTY_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, one: 1, a: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10 };
const QTY_FIX = new RegExp(String.raw`^(?:no[\s,.!]*)?(?:(?:mejor|better|actually|instead|en realidad|perd[oó]n)[\s,]*)?(?:(?:que\s+sean|son|make\s+(?:it|that|them)|change\s+(?:it|that)\s+to|ponle|ponme|dame|deme|(?:me\s+)?(?:pones|pone|das|da|haces|hace))\s+)?(\d{1,2}|${Object.keys(QTY_WORDS).join("|")})\b\s*(.*)$`, "iu");

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

/** suggest1: "sí" to Elvi's one offer → add exactly the offered options to that item; "no" → nothing. */
export function offerReply(input: ElviRequest): ElviResponse | null {
  const lastReply = [...(input.history || [])].reverse().find((h) => h.role === "assistant")?.text || "";
  const ans = offerAnswer(input.sessionKey, String(input.transcript || ""), lastReply);
  if (!ans) return null;
  const es = input.language !== "en";
  const last = input.sessionKey ? lastAddBySession.get(input.sessionKey) : undefined;
  if (!ans.yes || !last || last.itemId !== ans.itemId) return { language: input.language, engine: "xai", reply: es ? "Perfecto. ¿Algo más?" : "Sounds good. Anything else?", actions: [] } as ElviResponse;
  const menu = ((input as any).resolverMenu || input.menu || []) as MenuItem[];
  const mods = [...(last.modifiers || []), ...ans.offer.options.filter((o) => !(last.modifiers || []).some((m: any) => m.option === o.option)).map((o) => ({ step: o.group, option: o.option }))];
  const action: any = { type: "update_item", itemId: last.itemId, quantity: last.quantity, modifiers: mods, correction: true };
  return { language: input.language, engine: "xai", reply: addReadback([{ type: "add_item", itemId: last.itemId, quantity: last.quantity, modifiers: mods } as any], menu, input.language), actions: [action] } as ElviResponse;
}

export function quantityCorrection(input: Pick<ElviRequest, "sessionKey" | "transcript" | "language" | "menu"> & { resolverMenu?: MenuItem[] }): ElviResponse | null {
  const key = input.sessionKey;
  const last = key ? lastAddBySession.get(key) : undefined;
  if (!last || Date.now() - last.at > 3 * 60 * 60 * 1000) return null;
  const said = String(input.transcript || "").trim().replace(/^[\s¿¡,.]+/, "").replace(/[.!?¡¿]+$/g, "");
  // Needs a correction cue; a bare "tres tacos" is a new item.
  // santiago1 (CA7fc26b): "¿Me pones cuatro, por favor?" right after "tres quesadillas…" = change that line to 4
  // (only a bare count — a dish word that isn't the last dish, or otro/más/also, is a new line).
  const bareAsk = /^(?:y\s+)?(?:me\s+(?:pones|pone|das|da|haces|hace)|ponme|ponle|dame|deme)\s+(\d{1,2}|[a-z]+)(?:\s*,?\s*(?:por\s+favor|please))?\s*$/iu.exec(said);
  const bareOk = !!bareAsk && /^\d+$|^(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/i.test(bareAsk[1]) && !/^y\b/i.test(said);
  if (!bareOk && !/^(no\b|mejor\b|better\b|actually\b|instead\b|en realidad\b|perd[oó]n\b|make (it|that|them)\b|change (it|that) to\b|que sean\b)/iu.test(said)) return null;
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

/** ordername1: on a phone order, ask/confirm the name before wrapping up; the answer becomes set_customer {name}. */
export function phoneOrderNameTurn(input: ElviRequest, lastReply: string, DONE: RegExp): ElviResponse | null {
  const po = input.phoneOrder;
  if (!po) return null;
  const lang = input.language, said = String(input.transcript || "");
  const out = (reply: string, name?: string): ElviResponse => ({ language: lang, engine: "xai", reply, actions: name ? [{ type: "set_customer", name } as ElviAction] : [] } as ElviResponse);
  const q = nameQuestionIn(lastReply);
  if (q) {
    const r = resolveNameAnswer(said, q, po.savedName);
    if (!r) return out(ASK_NAME[lang]);
    if (thirdPersonName(said)) markOrderOnlyName(r.name); // name3p2: para/for/recoger only; De Luis / bare name = customer
    return out(nameAckText(lang, cleanFirstName(r.name) || r.name), r.name);
  }
  // Correction right after the thank-you ("no, es a nombre de …").
  if (/^(Gracias|Thanks), [^.]+\. /.test(lastReply) && /^\s*(no|nop|perd[oó]n|sorry|actually|mejor)(?![\p{L}])/iu.test(said)) {
    const n = nameFromAnswer(said);
    if (n) return out(nameAckText(lang, cleanFirstName(n) || n), n);
  }
  if (/(¿Algo más\?|Anything else\?)\s*$/.test(lastReply) && DONE.test(said) && !po.orderName) return out(wrapUpNameQuestion(lang, po.savedName));
  return null;
}

/** appsopes1 (Carlos): the customer app sells only the 10" Sopesaso Elvis. "Sopes chicos/chiquitos/small" → ask, don't ring 2 × 10". Phone unchanged. */
const SMALL_SOPE_ASK = /\b(?:sopes?|sopecitos?|sopesasos?)\s+(?:chic[oa]s?|chiquit[oa]s?|peque[nñ][oa]s?|small|mini)\b|\b(?:chic[oa]s?|chiquit[oa]s?|peque[nñ][oa]s?|small|mini)\s+(?:sopes?|sopesasos?)\b|\bsopecitos?\b/iu;
export function appSmallSopeReply(input: { transcript?: string; language?: string; channel?: string } & Record<string, any>): ElviResponse | null {
  if (input?.channel !== "app" || !SMALL_SOPE_ASK.test(String(input.transcript || ""))) return null;
  const es = input.language !== "en";
  return { language: (es ? "es" : "en") as any, engine: "xai", actions: [], reply: es
    ? "En línea solo tenemos el Sopesaso Elvis de 10 pulgadas. ¿Lo quieres de 10 pulgadas, o prefieres llamarnos para los sopes chicos?"
    : "Online we only have the 10-inch Sopesaso Elvis. Would you like the 10-inch, or would you rather call us for the small sopes?" } as ElviResponse;
}
export async function chatWithElvi(input: ElviRequest, runtimeConfig?: Partial<XaiRuntimeConfig>): Promise<ElviResponse> {
  // jesus2: the shared spoken aliases (data/aliases, "app" scope) reach the LIVE turn too — guisquel→bistec,
  // queso burias→Queso Birrias, street corn→esquite, cuca de vino→coca de vidrio — not only shadow scoring.
  if (input?.transcript) { const t = applySharedAliases(String(input.transcript), "app"); if (t !== input.transcript) input = { ...input, transcript: t }; }
  // paco1: "una quesadilla de A, otra de B, otra de C" → each una/otra is its own named line for every path
  if (input?.transcript) { const t = expandOtraList(String(input.transcript)); if (t !== input.transcript) input = { ...input, transcript: t }; }
  // case1: every path (deterministic turns and the model) gets the caller's-words cleanup
  const r = await chatWithElviPaths(input, runtimeConfig);
  let out = r; try { out = caseFix(r, input); } catch { /* keep r */ }
  try { out = noFalseFillingDenial(out, input); } catch { /* keep */ }
  try { return noOfferUnavailable(out, input); } catch { return out; }
}
/** Once the restaurant side said a dish isn't available ("hasta mañana", "no hay"), Elvi's reply never offers/confirms it again this call. */
export function noOfferUnavailable(r: ElviResponse, input: ElviRequest): ElviResponse {
  const turns = (input.history || []).map((h) => ({ speaker: (h.role === "assistant" ? "staff" : "caller") as "staff" | "caller", text: String(h.text || "") }));
  const off = staffUnavailable(turns);
  if (!off.length || !r?.reply) return r;
  const nfx = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const reply = nfx(r.reply);
  const hit = off.filter((d) => new RegExp(`\\b${d.replace(/\s+/g, "\\s+")}s?\\b`).test(reply));
  const dropAct = (a: any) => a?.type === "add_item" && off.some((d) => String(a.itemId || "").includes(d.replace(/\s+/g, "-")));
  const actions = (r.actions || []).filter((a: any) => !dropAct(a));
  if (!hit.length) return actions.length === (r.actions || []).length ? r : { ...r, actions };
  // a reply that itself says it isn't available is fine
  if (/\bno\s+(?:hay|tenemos)\b|\bhasta\s+manana\b|\bnot\s+(?:available|today)\b|\btomorrow\b|\bse\s+acab/.test(reply)) return { ...r, actions };
  const en = input.language === "en";
  const names = hit.join(en ? " and " : " ni ");
  return { ...r, actions, reply: en ? `Sorry, ${names} isn't available today. What else can I get you?` : `Perdón, hoy no tenemos ${names}. ¿Qué más le pongo?` };
}
export function expandOtraList(text: string): string {
  const m = text.match(/\b(un|una|uno)\s+(quesadillas?|gorditas?|tacos?|tortas?|sopes?|burritos?|huaraches?)\b/iu);
  if (!m || !/\botr[ao]s?\s+de\b/iu.test(text.slice((m.index || 0) + m[0].length))) return text;
  const head = text.slice(0, (m.index || 0) + m[0].length), dish = m[2].replace(/s$/i, "");
  const art = /a$/i.test(dish) ? "una" : "un";
  return head + text.slice(head.length).replace(/,?\s*\b(?:y\s+)?otr[ao]\s+de\b/giu, `, ${art} ${dish.toLowerCase()} de`).replace(/^\s*,?\s*(?:ah|eh|este)\s*,?\s*(?=de\b)/iu, " ");
}
// paco1 (CAcadbe8d, Oct 30): "¿tienen quesadillas de guisado o de huevo con chile?" got "No, eso no está en el menú".
// Huevo con chile and every guisado are real (B) Q Carnes / Meats choices on quesadilla/gordita/taco (site-catalog) —
// never deny a real filling; answer with the guisados and keep the cart unchanged.
const GUISADOS_ES = ["prensado", "duro", "deshebrada", "picadillo", "nopales con papas", "papas con rajas", "huevo con chile"];
const FILLING_ASK = /\b(?:guisados?|huevo\s+con\s+chile|papas\s+con\s+rajas|nopales\s+con\s+papas|picadillo|deshebrada|prensado|chicharr[oó]n|duro|spicy\s+egg|stews?)\b/iu;
const DENIAL = /\bno\s+(?:est[aá]|lo\s+tenemos|la\s+tenemos|tenemos|manejamos)(?!\p{L})[^.?!]*|\bnot\s+on\s+(?:the|our)\s+menu\b|\bwe\s+don'?t\s+(?:have|carry)\b/iu;
export function noFalseFillingDenial(r: ElviResponse, input: ElviRequest): ElviResponse {
  const heard = String(input?.transcript || ""); const reply = String((r as any)?.reply || "");
  if (!FILLING_ASK.test(heard) || !DENIAL.test(reply)) return r;
  // a filling the caller did not ask about (e.g. "no tenemos mole") may still be denied
  if (!/men[uú]|eso|esa|ese|have|carry/iu.test(reply)) return r;
  const en = (r as any).language === "en" || input.language === "en";
  const dish = (heard.match(/\b(quesadillas?|gorditas?|tacos?|sopes?|burritos?|tortas?)\b/iu) || [])[1];
  const reply2 = en
    ? `Yes, we have ${dish ? `${dish.toLowerCase()} with ` : ""}spicy egg (huevo con chile) and guisados: prensado, duro, deshebrada, picadillo, nopales con papas and papas con rajas. Which would you like?`
    : `Sí, tenemos ${dish ? `${dish.toLowerCase()} de ` : ""}huevo con chile y de guisado: ${GUISADOS_ES.slice(0, -1).join(", ")}. ¿De cuál le pongo?`;
  return { ...r, reply: reply2, actions: (r as any).actions || [] } as ElviResponse;
}
async function chatWithElviPaths(input: ElviRequest, runtimeConfig?: Partial<XaiRuntimeConfig>): Promise<ElviResponse> {
  if (input?.transcript) { const t = rewriteSlang(String(input.transcript)); if (t !== input.transcript) input = { ...input, transcript: t }; } // a1: approved slang
  // fix18: "así está bien" / "es todo" / "that's all" after "¿Algo más?" closes the order. The model re-added the
  // last dish for these ("está" also matched Platillo de Guisado), so answer here with no cart change (never checkout).
  const lastReply = [...(input.history || [])].reverse().find((h) => h.role === "assistant")?.text || "";
  const DONE = /^\s*(?:no[\s,.!]*)?(?:(?:as[ií]\s+)?est[aá]\s+bien|(?:eso\s+)?es\s+todo|ser[ií]a\s+todo|nada\s+m[aá]s|that'?s\s+(?:fine|it|all|good|everything)|it'?s\s+fine|nothing\s+else|no\s+thanks?|that\s+will\s+be\s+all)(?:[\s,.!]*(?:gracias|thanks?|thank\s+you|por\s+favor|please))?[\s.!]*$/iu;
  const named = phoneOrderNameTurn(input, lastReply, DONE);
  if (named) return named;
  if (/(¿Algo más\?|Anything else\?|¿De qué serían\?|Of what\?)\s*$/.test(lastReply) && DONE.test(String(input.transcript || ""))) {
    const es = input.language === "es";
    return { language: input.language, engine: "xai", reply: es ? "¡Perfecto! Revisa tu orden y cuando estés listo, pasa a pagar." : "Perfect! Review your order and check out when you're ready.", actions: [] } as ElviResponse;
  }
  const intent = orderIntentOnly(input);
  if (intent) return intent;
  const avail = availabilityQuestion(input);
  if (avail) return avail;
  // alex1: "…nada más a uno agrégamele, agrégamele" trails off before saying what — wait, change nothing
  if (/\b(agr[eé]g(a|ue)(me)?(le|se)|p[oó]n(ga)?(me)?le|ech(e|a)(me)?le|add|put)\W*$/i.test(String(input.transcript || "").trim()))
    return { language: input.language, reply: input.language === "en" ? "Sure, what should I add?" : "¿Sí? ¿Qué le agrego?", actions: [] } as any;
  const one = oneOfAskedDish(input);
  if (one) return one;
  const swap = insteadOfEggs(input);
  if (swap) return swap;
  const ack = shortAckAfterReadback(input, lastReply);
  if (ack) return ack;
  const mem = memoryTurn(input);
  if (mem) { recordLastAdd((input as any).sessionKey, mem.actions); return mem; }
  const again = sameAgain(input);
  if (again) { recordLastAdd((input as any).sessionKey, again.actions); return again; }
  const vsw = variationSwitch(input);
  if (vsw) { recordLastAdd((input as any).sessionKey, vsw.actions.filter((a: any) => a.type === "add_item")); return vsw; }
  const more = sameDishMore(input);
  if (more) { recordLastAdd((input as any).sessionKey, more.actions); return more; }
  const multi = multiDishTurn(input);
  if (multi) { recordLastAdd((input as any).sessionKey, multi.actions); return multi; }
  const small = appSmallSopeReply(input);
  if (small) return small;
  const favLines = favoriteAnswer(input.sessionKey, String(input.transcript || ""));
  if (favLines) { // fav1: "sí" to the usual / "el segundo" → exactly those lines (today's catalog); customer can still change anything
    const acts = favLines.map((l) => ({ ...l.action })) as any[];
    const rb = addReadback(acts, ((input as any).resolverMenu || input.menu || []) as MenuItem[], input.language);
    const r = { language: input.language, engine: "xai", reply: rb, actions: acts } as ElviResponse;
    recordLastAdd(input.sessionKey, acts); return r;
  }
  const offered = offerReply(input);
  if (offered) { recordLastAdd(input.sessionKey, offered.actions); return offered; }
  const fixed = quantityCorrection(input);
  if (fixed) { recordLastAdd(input.sessionKey, fixed.actions); return fixed; }
  const topping = toppingCorrection(input);
  if (topping) { recordLastAdd(input.sessionKey, topping.actions); return topping; }
  const result0 = await chatWithElviCore(input, runtimeConfig);
  const result = sameLineGuard(result0, input);
  const salsa = withSalsaDefault(result, input.transcript || "", ((input as any).resolverMenu || input.menu || []) as MenuItem[], (result.language || input.language) as Language);
  // suggest1: one learned, free-option question per item (reply only; actions/rules untouched).
  const final = withLearnedSuggestion(salsa, { sessionKey: input.sessionKey, heard: input.transcript || "", lang: ((result.language || input.language) === "en" ? "en" : "es"), menu: ((input as any).resolverMenu || input.menu || []) as any[] });
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

/** Test-only: same instructions + tools over plain chat completions (local Ollama / NVIDIA replays). Live calls never use this. */
async function chatWithTextAgent(input: ElviRequest, runtime: XaiRuntimeConfig, instructions: string): Promise<ElviResponse> {
  const tools = (buildRealtimeTools() as any[]).map((t: any) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const messages: any[] = [{ role: "system", content: instructions }, { role: "user", content: input.transcript }];
  const actionCalls: unknown[] = []; let text = "";
  for (let round = 0; round < 5; round++) {
    let r: Response | undefined; let j: any;
    for (let a = 0; a < 8; a++) {
      r = await fetch(`${runtime.baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${runtime.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: runtime.model, temperature: 0, messages, tools, max_tokens: 2000 }) });
      j = await r.json().catch(() => ({}));
      if (r.ok || (r.status < 500 && r.status !== 429)) break;
      await new Promise((res) => setTimeout(res, (r!.status === 429 ? 10000 : 2000) * (a + 1)));
    }
    if (!r!.ok && /nvidia/.test(runtime.baseUrl) && process.env.REPLAY_FALLBACK !== "0") {
      // NVIDIA down / rate-limited: fall back to the local Qwen on this Mac (test replays only).
      console.error(`[replay] NVIDIA ${r!.status}; falling back to local Qwen`);
      return await chatWithTextAgent(input, { ...runtime, apiKey: "ollama", baseUrl: "http://localhost:11434/v1", model: process.env.REPLAY_FALLBACK_MODEL || "qwen3:8b" }, instructions);
    }
    if (!r!.ok) throw new Error(JSON.stringify(j).slice(0, 300));
    const m = j.choices[0].message; messages.push(m);
    if (m.content) text += String(m.content).replace(/<think>[\s\S]*?<\/think>/g, "");
    if (!m.tool_calls?.length) break;
    for (const c of m.tool_calls) {
      const res: any = handleRealtimeToolCall(c.function.name, typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments));
      if (res.action) actionCalls.push(res.action);
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(res.output) });
    }
  }
  const reply = enforceOrderTakerReply(text.trim(), input.language) || defaultReply(input.language);
  return { language: input.language, reply, actions: sanitizeActions(actionCalls, input.menu), engine: "xai", rawJson: JSON.stringify({ language: input.language, reply, actions: actionCalls }) } as ElviResponse;
}
