import type { IncomingMessage, Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { chatWithElvi, chatWithElviAudio, type ConversationTurn } from "./elvi.js";
import { getMenu } from "./square.js";
import type { MenuItem } from "./menu.js";
import type { TenantConfig } from "./tenant.js";
import { extractReplacementBuildText } from "./text-intents.js";

type Language = "en" | "es";

type ComboGroup = {
  id: string;
  name: string;
  options: string[];
  minSelections: number;
  maxSelections: number;
  allowQuantities: boolean;
};

type ComboSelection = {
  option: string;
  quantity: number;
};

type ComboAnswer = {
  groupId: string;
  question: string;
  selections: ComboSelection[];
};

type ComboBuildState = {
  itemId: string;
  itemName: string;
  groups: ComboGroup[];
  step: number;
  answers: ComboAnswer[];
};

type RealtimeSession = {
  sessionId: string;
  tenant: TenantConfig;
  createdAt: number;
  chunks: Array<{ mimeType: string; data: string }>;
  menuCache?: { items: MenuItem[]; fetchedAt: number };
  pendingCombo?: ComboBuildState;
  turns: ConversationTurn[];
  processing: boolean;
};

type RealtimeClientMessage =
  | { type: "audio_chunk"; mimeType?: string; data?: string }
  | { type: "audio_end"; language?: Language }
  | { type: "user_text"; text?: string; language?: Language }
  | { type: "ping" };

type RealtimeViseme = {
  atMs: number;
  viseme: string;
  value: number;
};

const sessions = new Map<string, RealtimeSession>();
const SESSION_TTL_MS = 10 * 60 * 1000;
const MENU_CACHE_TTL_MS = Number(process.env.MENU_CACHE_TTL_MS || 5 * 60 * 1000);

function base64ToUint8Array(input: string): Uint8Array {
  const asBuffer = Buffer.from(input, "base64");
  return new Uint8Array(asBuffer.buffer, asBuffer.byteOffset, asBuffer.byteLength);
}

function uint8ArrayToBase64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64");
}

function sendJson(socket: WebSocket, payload: unknown) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}

async function getSessionMenu(session: RealtimeSession): Promise<MenuItem[]> {
  const now = Date.now();
  if (session.menuCache && now - session.menuCache.fetchedAt < MENU_CACHE_TTL_MS) {
    return session.menuCache.items;
  }

  const items = await getMenu({
    env: session.tenant.square.env,
    accessToken: session.tenant.square.accessToken,
    locationId: session.tenant.square.locationId,
    apiVersion: session.tenant.square.apiVersion,
    appPublicUrl: process.env.APP_PUBLIC_URL || "http://localhost:4000",
    businessName: session.tenant.branding.displayName
  });
  session.menuCache = { items, fetchedAt: now };
  return items;
}

async function transcribeWithRiva(
  tenant: TenantConfig,
  chunks: Array<{ mimeType: string; data: string }>,
  language: Language
): Promise<{ text: string; engine: "xai" | "fallback" }> {
  if (!chunks.length) {
    return { text: "", engine: "fallback" };
  }

  if (!process.env.XAI_API_KEY) {
    return { text: "", engine: "fallback" };
  }

  try {
    const mimeType = chunks[0]?.mimeType || "audio/webm";
    const audioBuffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data, "base64")));
    if (!audioBuffer.length) {
      return { text: "", engine: "fallback" };
    }

    const form = new FormData();
    const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3" : "webm";
    form.append("file", new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
    form.append("language", language === "es" ? "es" : "en");

    const response = await fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`
      },
      body: form
    });

    const body = (await response.json().catch(() => ({}))) as {
      text?: string;
      transcript?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(`xAI STT failed ${response.status}: ${body.error?.message || JSON.stringify(body)}`);
    }

    return { text: String(body.text || body.transcript || "").trim(), engine: "xai" };
  } catch (error) {
    console.warn(`xAI STT failed: ${error instanceof Error ? error.message : error}`);
    return { text: "", engine: "fallback" };
  }
}

async function synthesizeWithRiva(
  tenant: TenantConfig,
  text: string,
  language: Language
): Promise<{ audioBase64?: string; mimeType?: string; engine: "riva" | "fallback" }> {
  if (!tenant.riva.ttsUrl || !text) {
    return { engine: "fallback" };
  }

  try {
    const response = await fetch(tenant.riva.ttsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tenant.riva.apiKey ? { Authorization: `Bearer ${tenant.riva.apiKey}` } : {})
      },
      body: JSON.stringify({ text, language })
    });

    const body = (await response.json().catch(() => ({}))) as {
      audioBase64?: string;
      mimeType?: string;
      audio?: string;
    };

    if (!response.ok) {
      throw new Error(`Riva TTS failed ${response.status}`);
    }

    const audioBase64 = body.audioBase64 || body.audio;
    if (!audioBase64) {
      return { engine: "fallback" };
    }

    return {
      audioBase64,
      mimeType: body.mimeType || "audio/wav",
      engine: "riva"
    };
  } catch (error) {
    console.warn(`Riva TTS failed: ${error instanceof Error ? error.message : error}`);
    return { engine: "fallback" };
  }
}

// ── ElevenLabs TTS (best quality + character-level lip-sync timestamps) ──────
async function synthesizeWithElevenLabs(
  text: string,
  language: Language
): Promise<{ audioBase64?: string; mimeType?: string; visemes?: RealtimeViseme[]; engine: "elevenlabs" | "fallback" }> {
  const apiKey  = process.env.ELEVENLABS_API_KEY;
  const voiceId = language === "es"
    ? (process.env.ELEVENLABS_VOICE_ID_ES || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM")
    : (process.env.ELEVENLABS_VOICE_ID    || "21m00Tcm4TlvDq8ikWAM"); // Rachel — warm, professional

  if (!apiKey || !text) return { engine: "fallback" };

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: language === "es" ? "eleven_multilingual_v2" : "eleven_turbo_v2_5",
          voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.30, use_speaker_boost: true },
          output_format: "mp3_22050_32",
        }),
      }
    );
    if (!response.ok) throw new Error(`ElevenLabs ${response.status}`);

    const body = await response.json() as {
      audio_base64?: string;
      alignment?: { characters: string[]; character_start_times_seconds: number[] };
    };
    if (!body.audio_base64) return { engine: "fallback" };

    // Convert character timestamps → ARKit visemes for accurate lip sync
    const visemes: RealtimeViseme[] = [];
    if (body.alignment) {
      const { characters, character_start_times_seconds: times } = body.alignment;
      for (let i = 0; i < characters.length; i++) {
        const v = charToViseme(characters[i]);
        if (v !== "viseme_sil") {
          visemes.push({ atMs: Math.round(times[i] * 1000), viseme: v, value: 0.82 });
        }
      }
    }

    return { audioBase64: body.audio_base64, mimeType: "audio/mpeg", visemes, engine: "elevenlabs" };
  } catch (err) {
    console.warn(`ElevenLabs TTS failed: ${err instanceof Error ? err.message : err}`);
    return { engine: "fallback" };
  }
}

// ── Cartesia TTS (ultra-low latency ~80 ms) ───────────────────────────────
async function synthesizeWithCartesia(
  text: string,
  language: Language
): Promise<{ audioBase64?: string; mimeType?: string; engine: "cartesia" | "fallback" }> {
  const apiKey  = process.env.CARTESIA_API_KEY;
  const voiceId = process.env.CARTESIA_VOICE_ID || "a0e99841-438c-4a64-b679-ae501e7d6091"; // Barbra

  if (!apiKey || !text) return { engine: "fallback" };

  try {
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "Cartesia-Version": "2024-06-10",
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcript: text,
        model_id: language === "es" ? "sonic-multilingual" : "sonic-2",
        voice: { mode: "id", id: voiceId },
        output_format: { container: "mp3", encoding: "mp3", sample_rate: 22050 },
        language: language === "es" ? "es" : "en",
      }),
    });
    if (!response.ok) throw new Error(`Cartesia ${response.status}`);

    const buf = await response.arrayBuffer();
    return { audioBase64: Buffer.from(buf).toString("base64"), mimeType: "audio/mpeg", engine: "cartesia" };
  } catch (err) {
    console.warn(`Cartesia TTS failed: ${err instanceof Error ? err.message : err}`);
    return { engine: "fallback" };
  }
}



// ── xAI TTS via Realtime WebSocket ───────────────────────────────────────────
async function synthesizeWithXai(
  text: string,
  language: Language
): Promise<{ audioBase64?: string; mimeType?: string; engine: "xai" | "fallback" }> {
  const apiKey = process.env.XAI_API_KEY;
  const voice  = language === "es"
    ? (process.env.XAI_VOICE_ID_ES || process.env.XAI_VOICE_ID || "Eve")
    : (process.env.XAI_VOICE_ID || "Eve");

  if (!apiKey || !text) return { engine: "fallback" };

  try {
    const response = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: voice.toLowerCase(),
        language: language === "es" ? "es" : "en",
      }),
    });

    if (!response.ok) {
      throw new Error(`xAI TTS ${response.status}: ${await response.text().catch(() => "")}`);
    }

    const buf = Buffer.from(await response.arrayBuffer());
    if (!buf.length) return { engine: "fallback" };
    return { audioBase64: buf.toString("base64"), mimeType: "audio/mpeg", engine: "xai" };
  } catch (err) {
    console.warn(`[xAI TTS] ${err instanceof Error ? err.message : err}`);
    return { engine: "fallback" };
  }
}


// Character → ARKit viseme (covers English + Spanish phonetics)
function charToViseme(char: string): string {
  const c = char.toLowerCase();
  if (/[aeiouáéíóúü]/.test(c)) return "viseme_aa";
  if (/[bmp]/.test(c))          return "viseme_PP";
  if (/[fv]/.test(c))           return "viseme_FF";
  if (/[td]/.test(c))           return "viseme_DD";
  if (/[kgqx]/.test(c))         return "viseme_kk";
  if (/[szñ]/.test(c))          return "viseme_SS";
  if (/[nlrj]/.test(c))         return "viseme_nn";
  return "viseme_sil";
}

// ── Unified TTS picker — tries providers in priority order ────────────────
type TtsResult = {
  audioBase64?: string;
  mimeType?: string;
  engine: string;
  visemes?: RealtimeViseme[];
};

async function pickTts(tenant: TenantConfig, text: string, language: Language): Promise<TtsResult> {
  if (process.env.XAI_API_KEY) {
    const r = await synthesizeWithXai(text, language);
    if (r.audioBase64) return r;
  }
  return { engine: "fallback" };
}

function buildFallbackVisemes(text: string): RealtimeViseme[] {
  const letters = text.toLowerCase().replace(/[^a-z ]/g, "").split("");
  const visemes: RealtimeViseme[] = [];
  let offset = 0;

  for (const letter of letters) {
    if (!letter.trim()) {
      offset += 65;
      continue;
    }

    const viseme = /[bmp]/.test(letter)
      ? "viseme_PP"
      : /[fv]/.test(letter)
        ? "viseme_FF"
        : /[aeiouy]/.test(letter)
          ? "viseme_aa"
          : "viseme_sil";

    visemes.push({ atMs: offset, viseme, value: viseme === "viseme_sil" ? 0.2 : 0.75 });
    offset += 75;
  }

  return visemes;
}

async function generateVisemes(
  tenant: TenantConfig,
  text: string,
  audioBase64?: string
): Promise<{ visemes: RealtimeViseme[]; engine: "audio2face" | "fallback" }> {
  if (!tenant.audio2face.url || !text) {
    return { visemes: buildFallbackVisemes(text), engine: "fallback" };
  }

  try {
    const response = await fetch(tenant.audio2face.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tenant.audio2face.apiKey ? { Authorization: `Bearer ${tenant.audio2face.apiKey}` } : {})
      },
      body: JSON.stringify({ text, audioBase64 })
    });

    const body = (await response.json().catch(() => ({}))) as {
      visemes?: RealtimeViseme[];
      blendshapes?: RealtimeViseme[];
    };

    if (!response.ok) {
      throw new Error(`Audio2Face failed ${response.status}`);
    }

    const visemes = Array.isArray(body.visemes)
      ? body.visemes
      : Array.isArray(body.blendshapes)
        ? body.blendshapes
        : [];

    if (!visemes.length) {
      return { visemes: buildFallbackVisemes(text), engine: "fallback" };
    }

    return { visemes, engine: "audio2face" };
  } catch (error) {
    console.warn(`Audio2Face failed: ${error instanceof Error ? error.message : error}`);
    return { visemes: buildFallbackVisemes(text), engine: "fallback" };
  }
}

// ── Combo build helpers ───────────────────────────────────────────────────

function normalizeForCombo(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanComboLabel(value: string): string {
  return value
    .replace(/^\([A-Za-z]+\)\s*/i, "")
    .replace(/\s*\(ONLINE\)\s*/gi, "")
    .replace(/\d+\s*x\s*/i, "")
    .trim();
}

function comboOptionLabel(value: unknown): string {
  return value && typeof value === "object" && "name" in value
    ? String((value as { name?: unknown }).name || "")
    : String(value || "");
}

function inferComboMaxSelections(name: string, options: string[], explicitMax?: number): number {
  if (typeof explicitMax === "number" && explicitMax > 0) {
    return explicitMax;
  }

  const optionCount = Math.max(1, options.length);
  if (optionCount === 1) {
    return 1;
  }

  const normName = normalizeForCombo(name);
  if (/\b(rice|bean|beans|cheese|meat|protein|topping|toppings|salsa|veggie|veggies|extras|addon|add on)\b/.test(normName)) {
    return optionCount;
  }

  return 1;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function optionMatchParts(option: string): string[] {
  return cleanComboLabel(option)
    .split(/\s*\/\s*/)
    .map((part) => normalizeForCombo(part))
    .filter((part) => part.length > 1);
}

function formatComboSelection(selection: ComboSelection): string {
  const label = cleanComboLabel(selection.option);
  return selection.quantity > 1 ? `${selection.quantity}x ${label}` : label;
}

function flattenComboSelections(answers: ComboAnswer[]): string[] {
  return answers.flatMap((answer) => answer.selections.map(formatComboSelection));
}

function getComboAnswer(combo: ComboBuildState, group: ComboGroup): ComboAnswer {
  let answer = combo.answers.find((entry) => entry.groupId === group.id);
  if (!answer) {
    answer = { groupId: group.id, question: group.name, selections: [] };
    combo.answers.push(answer);
  }
  return answer;
}

function countSelectedOptions(answer: ComboAnswer): number {
  return answer.selections.filter((selection) => selection.quantity > 0).length;
}

function findComboOptionsInTranscript(transcript: string, options: string[]): string[] {
  const norm = normalizeForCombo(transcript);
  const matches: string[] = [];
  for (const option of options) {
    const parts = optionMatchParts(option);
    // Full-phrase match first
    if (parts.some((part) => norm.includes(part))) {
      matches.push(option);
      continue;
    }
    // Word-level fallback: any significant word (>3 chars) from the option label in the transcript
    const cleanedLabel = normalizeForCombo(cleanComboLabel(option));
    const significantWords = cleanedLabel.split(/\s+/).filter((w) => w.length > 3);
    if (
      significantWords.length > 0 &&
      significantWords.some((word) => new RegExp(`(?:^|\\s)${escapeRegex(word)}(?:\\s|$)`).test(norm))
    ) {
      matches.push(option);
    }
  }
  return matches;
}

function resolveSelectionQuantity(
  transcript: string,
  option: string,
  currentQuantity: number,
  allowQuantities: boolean
): number {
  const norm = normalizeForCombo(transcript);
  // Full-phrase match first; fall back to the significant word that appears in transcript
  let matchedPart = optionMatchParts(option).find((part) => norm.includes(part));
  if (!matchedPart) {
    const cleanedLabel = normalizeForCombo(cleanComboLabel(option));
    const significantWords = cleanedLabel.split(/\s+/).filter((w) => w.length > 3);
    matchedPart = significantWords.find((word) =>
      new RegExp(`(?:^|\\s)${escapeRegex(word)}(?:\\s|$)`).test(norm)
    );
  }
  if (!matchedPart) {
    // Matched by word-level but no specific quantity signal — treat as 1 (or keep existing)
    return currentQuantity > 0 ? currentQuantity : 1;
  }

  const partPattern = escapeRegex(matchedPart);
  if (new RegExp(`(?:^|\\b)(?:no|without|sin|remove|quit|hold)\\s+${partPattern}(?:\\b|$)`).test(norm)) {
    return 0;
  }

  const countedMatch = norm.match(new RegExp(`(?:^|\\b)(\\d+)\\s*(?:x|times?)?\\s+${partPattern}(?:\\b|$)`));
  if (countedMatch) {
    return Math.max(0, Number(countedMatch[1]) || 0);
  }

  if (new RegExp(`(?:^|\\b)(?:triple|tres)\\s+${partPattern}(?:\\b|$)`).test(norm)) {
    return allowQuantities ? 3 : 1;
  }
  if (new RegExp(`(?:^|\\b)(?:double|doble|extra)\\s+${partPattern}(?:\\b|$)`).test(norm)) {
    return allowQuantities ? Math.max(2, currentQuantity + 1) : 1;
  }
  if (new RegExp(`(?:^|\\b)(?:single|solo|just)\\s+${partPattern}(?:\\b|$)`).test(norm)) {
    return 1;
  }
  if (new RegExp(`(?:^|\\b)(?:add|with|con)\\s+${partPattern}(?:\\b|$)`).test(norm)) {
    if (!allowQuantities) {
      return 1;
    }
    return currentQuantity > 0 ? currentQuantity + 1 : 1;
  }

  return allowQuantities ? Math.max(1, currentQuantity || 1) : 1;
}

function applySelectionsToAnswer(
  answer: ComboAnswer,
  transcript: string,
  group: ComboGroup
): { nextSelections: ComboSelection[]; changed: boolean; exceedsMax: boolean } {
  const currentByOption = new Map(answer.selections.map((selection) => [selection.option, selection.quantity]));
  const matchedOptions = findComboOptionsInTranscript(transcript, group.options);
  if (!matchedOptions.length) {
    return { nextSelections: answer.selections, changed: false, exceedsMax: false };
  }

  const nextByOption = new Map(currentByOption);
  for (const option of matchedOptions) {
    const nextQuantity = resolveSelectionQuantity(
      transcript,
      option,
      nextByOption.get(option) || 0,
      group.allowQuantities
    );
    if (nextQuantity <= 0) {
      nextByOption.delete(option);
    } else {
      nextByOption.set(option, group.allowQuantities ? nextQuantity : 1);
    }
  }

  const nextSelections = Array.from(nextByOption.entries()).map(([option, quantity]) => ({ option, quantity }));
  return {
    nextSelections,
    changed: true,
    exceedsMax: nextSelections.length > group.maxSelections
  };
}

function buildComboNeedMoreReply(group: ComboGroup, answer: ComboAnswer, language: Language): string {
  const cleanName = cleanComboLabel(group.name);
  const chosen = answer.selections.map(formatComboSelection).join(", ");
  const remaining = Math.max(group.minSelections - countSelectedOptions(answer), 0);
  if (language === "es") {
    return chosen
      ? `${chosen}. Elige ${remaining} más para ${cleanName}.`
      : `${cleanName}: elige ${group.minSelections}.`;
  }
  return chosen
    ? `${chosen}. Choose ${remaining} more for ${cleanName}.`
    : `${cleanName}: choose ${group.minSelections}.`;
}

function buildComboProgressReply(group: ComboGroup, answer: ComboAnswer, language: Language): string {
  const cleanName = cleanComboLabel(group.name);
  const chosen = answer.selections.map(formatComboSelection).join(", ");
  const remaining = Math.max(group.maxSelections - countSelectedOptions(answer), 0);
  if (language === "es") {
    return remaining > 0
      ? `${cleanName}: ${chosen || "sin selección"}. Agrega ${remaining} más o di "listo".`
      : `${cleanName}: ${chosen || "sin selección"}. Di "listo" o cambia algo.`;
  }
  return remaining > 0
    ? `${cleanName}: ${chosen || "none selected"}. Add ${remaining} more or say "done".`
    : `${cleanName}: ${chosen || "none selected"}. Say "done" or change one.`;
}

function matchComboOption(transcript: string, options: string[]): string | null {
  const norm = normalizeForCombo(transcript);
  for (const option of options) {
    // Clean option: strip prefix codes like "(TST) ", "1 x "
    const cleaned = normalizeForCombo(option)
      .replace(/\([a-z]+\) /g, "")
      .replace(/\d+ x /g, "");
    // Try bilingual: split by "/" and check each part
    const parts = cleaned.split(/\s*\/\s*/);
    for (const part of parts) {
      const p = part.trim();
      if (p.length > 2 && norm.includes(p)) return option;
    }
    // Reverse: any significant word from transcript matches a part
    const words = norm.split(" ").filter((w) => w.length > 3);
    for (const word of words) {
      if (cleaned.includes(word)) return option;
    }
  }
  return null;
}

function buildComboQuestion(
  group: ComboGroup,
  language: Language,
  itemName: string,
  _stepNum: number,
  _totalSteps: number,
  currentSelections: ComboSelection[]
): string {
  const cleanName = cleanComboLabel(group.name);
  const currentText = currentSelections.length
    ? (language === "es"
        ? ` Actualmente: ${currentSelections.map(formatComboSelection).join(", ")}.`
        : ` Currently: ${currentSelections.map(formatComboSelection).join(", ")}.`)
    : "";

  if (group.maxSelections > 1) {
    if (language === "es") {
      return `${cleanName}: elige ${group.minSelections}-${group.maxSelections}. Di "listo" al terminar.${currentText}`;
    }
    return `${cleanName}: choose ${group.minSelections}-${group.maxSelections}. Say "done" when finished.${currentText}`;
  }

  const isOptional = group.minSelections === 0 || /extra|deluxe/i.test(cleanName);

  if (language === "es") {
    return isOptional
      ? `${cleanName}: di opción o "sin".${currentText}`
      : `${cleanName}: ¿cuál?${currentText}`;
  }
  return isOptional
    ? `${cleanName}: say option or "skip".${currentText}`
    : `${cleanName}: which one?${currentText}`;
}

async function sendComboTurn(
  socket: WebSocket,
  session: RealtimeSession,
  reply: string,
  language: Language
) {
  const combo = session.pendingCombo!;
  const tts = await pickTts(session.tenant, reply, language);
  const animation = tts.visemes?.length
    ? { visemes: tts.visemes, engine: "provider" }
    : await generateVisemes(session.tenant, reply, tts.audioBase64);
  const currentGroup = combo.groups[combo.step];
  const stepOptions = (currentGroup?.options || [])
    .map((o) => cleanComboLabel(o))
    .filter(Boolean);
  if (currentGroup?.maxSelections > 1) {
    stepOptions.push(language === "es" ? "Listo" : "Done");
  }
  if ((currentGroup?.minSelections || 0) === 0) {
    stepOptions.push(language === "es" ? "Sin esto" : "Skip");
  }
  sendJson(socket, {
    type: "assistant_turn",
    reply,
    language,
    actions: [
      {
        type: "combo_building",
        itemName: combo.itemName,
        step: combo.step + 1,
        totalSteps: combo.groups.length,
        stepName: cleanComboLabel(currentGroup?.name || ""),
        stepOptions,
        selections: flattenComboSelections(combo.answers)
      }
    ],
    audioBase64: tts.audioBase64,
    audioMimeType: tts.mimeType,
    visemes: animation.visemes,
    engines: { asr: "xai", chat: "combo", tts: tts.engine, animation: animation.engine }
  });
}

async function askComboQuestion(
  socket: WebSocket,
  session: RealtimeSession,
  language: Language
) {
  const combo = session.pendingCombo!;
  const currentGroup = combo.groups[combo.step];
  const currentAnswer = getComboAnswer(combo, currentGroup);
  const reply = buildComboQuestion(
    currentGroup,
    language,
    combo.itemName,
    combo.step + 1,
    combo.groups.length,
    currentAnswer.selections
  );
  await sendComboTurn(socket, session, reply, language);
}

async function advanceComboOrFinish(
  socket: WebSocket,
  session: RealtimeSession,
  language: Language
) {
  const combo = session.pendingCombo!;
  combo.step++;

  if (combo.step < combo.groups.length) {
    await askComboQuestion(socket, session, language);
    return;
  }

  const mainSels = flattenComboSelections(combo.answers).slice(0, 5);
  const summary = mainSels.length > 0
    ? mainSels.join(", ")
    : (language === "es" ? "tus selecciones" : "your selections");
  const reply =
    language === "es"
      ? `Agregado: ${combo.itemName} con ${summary}.`
      : `Added: ${combo.itemName} with ${summary}.`;

  const itemId = combo.itemId;
  session.pendingCombo = undefined;

  const tts = await pickTts(session.tenant, reply, language);
  const animation = tts.visemes?.length
    ? { visemes: tts.visemes, engine: "provider" }
    : await generateVisemes(session.tenant, reply, tts.audioBase64);
  sendJson(socket, {
    type: "assistant_turn",
    reply,
    language,
    actions: [{ type: "add_item", itemId, quantity: 1 }],
    audioBase64: tts.audioBase64,
    audioMimeType: tts.mimeType,
    visemes: animation.visemes,
    engines: { asr: "xai", chat: "combo", tts: tts.engine, animation: animation.engine }
  });
}

async function processComboStep(
  socket: WebSocket,
  session: RealtimeSession,
  transcript: string,
  language: Language
) {
  const combo = session.pendingCombo!;
  const currentGroup = combo.groups[combo.step];
  const norm = normalizeForCombo(transcript);
  const isDone = /\b(done|finished|thats all|that s all|all set|continue|next|listo|ya|eso es todo|nada mas|nada mas)\b/.test(norm);
  const isSkipSignal = /\b(skip|none|ninguno|ninguna|sin esto|omit|nothing|nada|omitir)\b/.test(norm);
  // "No" as a standalone answer skips optional groups
  const isNoAnswer = /^(no|nope|nah|nel)\b/.test(norm) && norm.split(" ").length <= 3;
  const isSkip = isSkipSignal || (isNoAnswer && currentGroup.minSelections === 0);
  // "Yes" as a standalone answer selects the first/only option for optional groups
  const isYesAnswer = /^(yes|yeah|yep|sure|okay|ok|please|si|sí|claro|orale|andale)\b/.test(norm) && norm.split(" ").length <= 4;
  const answer = getComboAnswer(combo, currentGroup);
  const applied = applySelectionsToAnswer(answer, norm, currentGroup);

  if (applied.changed) {
    if (applied.exceedsMax) {
      const reply =
        language === "es"
          ? `Puedes elegir hasta ${currentGroup.maxSelections} opciones para ${cleanComboLabel(currentGroup.name)}.`
          : `You can choose up to ${currentGroup.maxSelections} options for ${cleanComboLabel(currentGroup.name)}.`;
      await sendComboTurn(socket, session, reply, language);
      return;
    }

    answer.selections = applied.nextSelections;
  }

  const selectedCount = countSelectedOptions(answer);

  if (currentGroup.maxSelections <= 1 && selectedCount >= currentGroup.minSelections) {
    await advanceComboOrFinish(socket, session, language);
    return;
  }

  if (isSkip || isDone) {
    if (selectedCount >= currentGroup.minSelections || (isSkip && currentGroup.minSelections === 0)) {
      await advanceComboOrFinish(socket, session, language);
      return;
    }

    const reply = buildComboNeedMoreReply(currentGroup, answer, language);
    await sendComboTurn(socket, session, reply, language);
    return;
  }

  if (applied.changed) {
    const reply = buildComboProgressReply(currentGroup, answer, language);
    await sendComboTurn(socket, session, reply, language);
    return;
  }

  // Yes-answer shortcut: treat as selecting the first (or only) option when group is optional/single
  if (isYesAnswer && !applied.changed && answer.selections.length === 0) {
    const targetOption = currentGroup.options[0];
    if (targetOption) {
      answer.selections = [{ option: targetOption, quantity: 1 }];
      if (currentGroup.maxSelections <= 1) {
        await advanceComboOrFinish(socket, session, language);
      } else {
        const reply = buildComboProgressReply(currentGroup, answer, language);
        await sendComboTurn(socket, session, reply, language);
      }
      return;
    }
  }

  const selectedAnswer = matchComboOption(norm, currentGroup.options);
  if (!selectedAnswer) {
    // Natural repair: re-present the options conversationally rather than a dead-end error
    const cleanName = cleanComboLabel(currentGroup.name);
    const displayOptions = currentGroup.options.slice(0, 4).map(cleanComboLabel);
    const optionList = displayOptions.join(", ");
    const hasMore = currentGroup.options.length > 4;
    const reply =
      language === "es"
        ? `${cleanName}: ${optionList}${hasMore ? ", entre otras" : ""}. Elige una.`
        : `${cleanName}: ${optionList}${hasMore ? ", and more" : ""}. Choose one.`;
    await sendComboTurn(socket, session, reply, language);
  } else {
    // Option found by matchComboOption but not yet applied — apply it now
    if (!answer.selections.find((s) => s.option === selectedAnswer)) {
      answer.selections.push({ option: selectedAnswer, quantity: 1 });
    }
    const newCount = countSelectedOptions(answer);
    if (currentGroup.maxSelections <= 1 && newCount >= currentGroup.minSelections) {
      await advanceComboOrFinish(socket, session, language);
    } else {
      const reply = buildComboProgressReply(currentGroup, answer, language);
      await sendComboTurn(socket, session, reply, language);
    }
  }
}

// ── Main turn processor ───────────────────────────────────────────────────

async function processTurn(
  socket: WebSocket,
  session: RealtimeSession,
  transcript: string,
  language: Language,
  asrEngine: "xai" | "text" | "fallback"
) {
  // If mid-combo, check for bail-out intent before routing to the combo step handler
  if (session.pendingCombo) {
    const normBailout = transcript.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").trim();
    const isBailout = /\b(forget it|start over|cancel|never mind|nevermind|something else|different|instead|rather|olvida|cancelar|empieza de nuevo|otra cosa|otro|mejor|en vez)\b/.test(normBailout);
    if (isBailout) {
      const cancelledItem = session.pendingCombo.itemName;
      const replacement = extractReplacementBuildText(normBailout);
      session.pendingCombo = undefined;
      if (replacement) {
        transcript = replacement;
      } else {
        const reply =
          language === "es"
            ? `Cancelé ${cancelledItem}.`
            : `Cancelled ${cancelledItem}.`;
        const tts = await pickTts(session.tenant, reply, language);
        const animation = tts.visemes?.length
          ? { visemes: tts.visemes, engine: "provider" }
          : await generateVisemes(session.tenant, reply, tts.audioBase64);
        sendJson(socket, {
          type: "assistant_turn",
          reply,
          language,
          actions: [],
          audioBase64: tts.audioBase64,
          audioMimeType: tts.mimeType,
          visemes: animation.visemes,
          engines: { asr: asrEngine, chat: "combo", tts: tts.engine, animation: animation.engine }
        });
        return;
      }
    }
    if (session.pendingCombo) {
      await processComboStep(socket, session, transcript, language);
      return;
    }
  }

  const menu = await getSessionMenu(session);

  const elvi = await chatWithElvi(
    {
      transcript,
      language,
      menu,
      history: session.turns
    },
    {
      apiKey: session.tenant.xai.apiKey,
      baseUrl: session.tenant.xai.baseUrl,
      model: session.tenant.xai.model,
    }
  );

  // Check if any add_item targets a combo item (has ≥5 modifier groups = full guided build)
  for (const action of elvi.actions) {
    if (action.type === "add_item") {
      const menuItem = menu.find((m) => m.id === action.itemId);
      if ((menuItem?.modifierGroups?.length ?? 0) >= 5) {
        // Start guided combo build instead of adding immediately
        session.pendingCombo = {
          itemId: menuItem!.id,
          itemName: menuItem!.name,
          groups: menuItem!.modifierGroups!.map((group) => ({
            id: group.id,
            name: group.name,
            options: group.options.map(comboOptionLabel),
            minSelections: Math.max(0, group.minSelections ?? 1),
            maxSelections: Math.max(
              group.minSelections ?? 1,
              inferComboMaxSelections(group.name, group.options.map(comboOptionLabel), group.maxSelections)
            ),
            allowQuantities: group.allowQuantities ?? false
          })),
          step: 0,
          answers: []
        };
        await askComboQuestion(socket, session, language);
        return;
      }
    }
  }

  const tts = elvi.audioBase64
    ? {
        audioBase64: elvi.audioBase64,
        mimeType: elvi.audioMimeType || "audio/wav",
        engine: elvi.engine,
        visemes: undefined,
      }
    : await pickTts(session.tenant, elvi.reply, elvi.language);
  const animation = tts.visemes?.length
    ? { visemes: tts.visemes, engine: "provider" }
    : tts.audioBase64
      ? { visemes: buildFallbackVisemes(elvi.reply), engine: "fallback" }
      : await generateVisemes(session.tenant, elvi.reply, tts.audioBase64);

  // Record this exchange in session history for multi-turn context
  session.turns.push({ role: "customer", text: transcript });
  session.turns.push({ role: "assistant", text: elvi.reply, rawJson: elvi.rawJson });

  sendJson(socket, {
    type: "assistant_turn",
    transcript,
    reply: elvi.reply,
    language: elvi.language,
    actions: elvi.actions,
    audioBase64: tts.audioBase64,
    audioMimeType: tts.mimeType,
    visemes: animation.visemes,
    engines: {
      asr: asrEngine,
      chat: elvi.engine,
      tts: tts.engine,
      animation: animation.engine
    }
  });
}
function parsePayload(raw: string): RealtimeClientMessage | null {
  try {
    const payload = JSON.parse(raw) as RealtimeClientMessage;
    if (!payload || typeof payload !== "object" || !("type" in payload)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function getWsPath(req: IncomingMessage): string {
  const host = req.headers.host || "localhost";
  const protocol = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

export function createRealtimeSession(tenant: TenantConfig) {
  pruneExpiredSessions();

  const sessionId = randomUUID();
  sessions.set(sessionId, {
    sessionId,
    tenant,
    createdAt: Date.now(),
    chunks: [],
    turns: [],
    processing: false
  });

  return {
    sessionId,
    expiresInSeconds: Math.floor(SESSION_TTL_MS / 1000)
  };
}

export function attachRealtimeServer(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const base = getWsPath(req);
    const url = new URL(req.url || "", base);

    if (url.pathname !== "/api/realtime") {
      return;
    }

    const sessionId = url.searchParams.get("sessionId") || "";
    const session = sessions.get(sessionId);
    if (!session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (socket, req) => {
    const base = getWsPath(req);
    const url = new URL(req.url || "", base);
    const sessionId = url.searchParams.get("sessionId") || "";
    const session = sessions.get(sessionId);

    if (!session) {
      sendJson(socket, { type: "error", message: "Session expired" });
      socket.close();
      return;
    }

    sendJson(socket, {
      type: "ready",
      sessionId,
      hasTts: !!process.env.XAI_API_KEY,
      tenant: {
        slug: session.tenant.slug,
        branding: session.tenant.branding
      }
    });

    socket.on("message", async (rawData) => {
      const raw = rawData.toString();
      const payload = parsePayload(raw);

      if (!payload) {
        sendJson(socket, { type: "error", message: "Invalid message payload" });
        return;
      }

      if (payload.type === "ping") {
        sendJson(socket, { type: "pong", at: Date.now() });
        return;
      }

      if (payload.type === "audio_chunk") {
        if (!payload.data) return;
        session.chunks.push({
          data: payload.data,
          mimeType: payload.mimeType || "audio/webm"
        });
        return;
      }

      if (payload.type === "user_text") {
        if (session.processing) {
          sendJson(socket, { type: "error", message: "Please wait for the current response to finish." });
          return;
        }
        const transcript = String(payload.text || "").trim();
        if (!transcript) return;
        sendJson(socket, { type: "processing", mode: "text" });
        session.processing = true;

        try {
          await processTurn(
            socket,
            session,
            transcript,
            payload.language === "es" ? "es" : "en",
            "text"
          );
        } catch (error) {
          sendJson(socket, {
            type: "error",
            message: error instanceof Error ? error.message : "Unable to process turn"
          });
        } finally {
          session.processing = false;
        }
        return;
      }

      if (payload.type === "audio_end") {
        if (session.processing) {
          sendJson(socket, { type: "error", message: "Please wait for the current response to finish." });
          return;
        }
        const language = payload.language === "es" ? "es" : "en";
        sendJson(socket, { type: "processing", mode: "audio" });
        session.processing = true;

        const pcmChunks = session.chunks
          .filter((chunk) => (chunk.mimeType || "").includes("audio/pcm"))
          .map((chunk) => chunk.data);

        if (!session.pendingCombo && pcmChunks.length > 0) {
          try {
            const menu = await getSessionMenu(session);

            const elvi = await chatWithElviAudio(
              {
                audioChunks: pcmChunks,
                language,
                menu,
                history: session.turns
              },
              {
                apiKey: session.tenant.xai.apiKey,
                baseUrl: session.tenant.xai.baseUrl,
                model: session.tenant.xai.model,
                fastModel: process.env.XAI_FAST_MODEL || "grok-voice-think-fast-1.0"
              }
            );
            session.chunks = [];

            for (const action of elvi.actions) {
              if (action.type === "add_item") {
                const menuItem = menu.find((m) => m.id === action.itemId);
                if ((menuItem?.modifierGroups?.length ?? 0) >= 5) {
                  session.pendingCombo = {
                    itemId: menuItem!.id,
                    itemName: menuItem!.name,
                    groups: menuItem!.modifierGroups!.map((group) => ({
                      id: group.id,
                      name: group.name,
                      options: group.options.map(comboOptionLabel),
                      minSelections: Math.max(0, group.minSelections ?? 1),
                      maxSelections: Math.max(
                        group.minSelections ?? 1,
                        inferComboMaxSelections(group.name, group.options.map(comboOptionLabel), group.maxSelections)
                      ),
                      allowQuantities: group.allowQuantities ?? false
                    })),
                    step: 0,
                    answers: []
                  };
                  await askComboQuestion(socket, session, language);
                  session.processing = false;
                  return;
                }
              }
            }

            const animation = { visemes: buildFallbackVisemes(elvi.reply), engine: "fallback" as const };
            session.turns.push({ role: "assistant", text: elvi.reply, rawJson: elvi.rawJson });
            sendJson(socket, {
              type: "assistant_turn",
              transcript: "",
              reply: elvi.reply,
              language: elvi.language,
              actions: elvi.actions,
              audioBase64: elvi.audioBase64,
              audioMimeType: elvi.audioMimeType,
              visemes: animation.visemes,
              engines: {
                asr: "xai",
                chat: elvi.engine,
                tts: elvi.engine,
                animation: animation.engine
              }
            });
            session.processing = false;
            return;
          } catch (error) {
            console.warn(`xAI realtime audio turn failed: ${error instanceof Error ? error.message : error}`);
            session.chunks = [];
            sendJson(socket, {
              type: "error",
              message: language === "es"
                ? "La sesion de voz fallo. Intentalo otra vez."
                : "The voice session failed. Please try again."
            });
            session.processing = false;
            return;
          }
        }

        const asr = await transcribeWithRiva(session.tenant, session.chunks, language);
        session.chunks = [];

        if (!asr.text) {
          const reply =
            language === "es"
              ? "No te escucho claro. Di solo item y cantidad, por ejemplo: agrega 2 tacos."
              : "I could not hear you clearly. Say item and quantity, for example: add 2 tacos.";
          const tts = await pickTts(session.tenant, reply, language);
          const animation = tts.visemes?.length
            ? { visemes: tts.visemes, engine: "provider" }
            : await generateVisemes(session.tenant, reply, tts.audioBase64);
          sendJson(socket, {
            type: "assistant_turn",
            transcript: "",
            reply,
            language,
            actions: [],
            audioBase64: tts.audioBase64,
            audioMimeType: tts.mimeType,
            visemes: animation.visemes,
            engines: {
              asr: asr.engine,
              chat: "xai",
              tts: tts.engine,
              animation: animation.engine
            }
          });
          session.processing = false;
          return;
        }

        try {
          await processTurn(socket, session, asr.text, language, asr.engine);
        } catch (error) {
          sendJson(socket, {
            type: "error",
            message: error instanceof Error ? error.message : "Unable to process audio"
          });
        } finally {
          session.processing = false;
        }
      }
    });

    socket.on("close", () => {
      sessions.delete(sessionId);
    });
  });
}

export function pcmToBase64(input: Uint8Array) {
  return uint8ArrayToBase64(input);
}

export function base64ToPcm(input: string) {
  return base64ToUint8Array(input);
}
