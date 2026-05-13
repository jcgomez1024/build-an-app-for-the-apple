import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { MenuItem } from "./menu.js";

type Language = "en" | "es";

type ElviAction =
  | { type: "add_item"; itemId: string; quantity: number }
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
  history?: ConversationTurn[];
};

export type ElviAudioRequest = {
  audioChunks: string[];
  language: Language;
  menu: MenuItem[];
  history?: ConversationTurn[];
};

export type ElviResponse = {
  language: Language;
  reply: string;
  actions: ElviAction[];
  engine: "xai-realtime" | "xai";
  rawJson?: string;
  audioBase64?: string;
  audioMimeType?: string;
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

export async function chatWithElvi(
  input: ElviRequest,
  runtimeConfig?: Partial<XaiRuntimeConfig>
): Promise<ElviResponse> {
  const runtime = getRuntimeConfig(runtimeConfig);
  const transcript = (input.transcript || "").trim();
  if (!transcript) {
    throw new Error("Transcript is required");
  }

  if (!runtime.apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }

  return await chatWithRealtimeAgent(input, runtime);
}

export async function chatWithElviAudio(
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
  return await chatWithRealtimeAudioAgent(input, runtime);
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
      cleaned.push({ type: "set_fulfillment", fulfillment: value.fulfillment });
      continue;
    }
    if (value.type === "set_address" && typeof value.address === "string" && value.address.trim()) {
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
  const menuSummary = buildRealtimeMenuKnowledge(menu);
  const historySummary = history
    .slice(-4)
    .map((turn) => `${turn.role === "customer" ? "Customer" : "Elvi"}: ${turn.text}`)
    .join("\n");

  return [
    "You are Elvi, the live order taker for Cocina Elvis.",
    "If asked your name, answer exactly that your name is Elvi. Never say your name is Cocina Elvis.",
    "The customer is speaking to restaurant staff. Never speak as the customer or narrate internal reasoning.",
    "Default mode is quick order taking, not conversation. Do not greet, make small talk, upsell, explain the app, or ask personal/chatty questions.",
    "Keep replies to 1 short sentence, usually under 10 words. After a successful order change, say only a brief confirmation like 'Added.' or 'Removed.'",
    "Understand customer input in either English or Spanish, but every assistant reply must be only in the selected UI language. Do not mix languages in the same reply.",
    "After any tool call, trust the tool output orderState as the latest cart. Never say the cart is empty when cartItemCount is greater than 0.",
    "For questions like 'what is my current order' or 'what is in my cart', answer from the current order state only. If itemCount is greater than 0, list the cart briefly and never say empty.",
    "If a tool output includes missingItems after adding split items, confirm what was added and ask only for the missing required choice on the remaining item.",
    "Use tools for every real order change: add_item, remove_item, update_item, set_fulfillment, set_address, set_customer, checkout.",
    "Sell only items from the ONLINE menu below. If something is not listed, say it is unavailable and offer the closest listed alternative.",
    "Know the menu thoroughly: use English names, Spanish names, aliases, prices, and modifier groups below to map what the customer says.",
    "Ask a question only when it is required to complete the order: missing required modifiers, pickup/delivery at checkout, delivery address, name, or phone.",
    "If the cart is not empty, remember it. Never ask 'what would you like to order' as if starting over; refer to the current cart, ask 'Anything else?' only if needed, or proceed to checkout.",
    "For remove or change requests, resolve phrases like 'last item', 'that', 'the current item', item numbers, or item names against the current cart and use remove_item or update_item.",
    "When the customer says change/switch/make an existing item's tortilla, meat, quantity, or modifiers, call update_item on that cart item immediately. Never ask to add one now, and never claim it changed unless update_item succeeded.",
    "For mixed quantities in one sentence, call add_item once with itemQuery as the full phrase, for example 'three tacos, two tripas, one chorizo'; the app will split them into separate cart lines.",
    "Collect pickup or delivery only when the customer starts checkout, says they are done, or mentions pickup/delivery. For delivery, collect the address before closing the order.",
    "If the customer asks a menu, price, allergy, or other question, answer directly and briefly, then return to order taking.",
    "For COMBO Tacos, require these build steps before add_item: (A) tortilla shell, (B) item #1 meat, (CD) item #2 meat, and (D) COMBO side. Treat other COMBO Tacos groups as optional.",
    "If the customer later asks to add an optional COMBO Tacos option such as DELUXE, keep it available and apply it to the existing COMBO Tacos item instead of saying it is unavailable.",
    "For items with required modifier groups, ask one concise combined question for missing required groups, then call add_item once selections are complete.",
    "Modifier option labels may include Square price deltas like (+$1.00); include those deltas when quoting modified item prices.",
    "For sub-dollar amounts in assistant replies, never write decimals like $0.75 or .75 dollars. Say 75 cents in English or 75 centavos in Spanish.",
    "For vague Taco or Quesadilla orders, the app defaults tortilla to Comal / Homemade corn unless the customer asks for flour, street/taquero, or no tortilla default.",
    "After adding a Taco or Quesadilla without deluxe and the customer did not say no deluxe, ask one short upgrade question: English 'Deluxe for 75 cents?' or Spanish '¿Deluxe por 75 centavos?'. If yes, update the last item with DELUXE; if no, continue without deluxe.",
    "Common phrases: steak taco means Taco with Bistec / Steak; tripas taco means Taco with Tripa / Beef Tripe; duro taco means Taco with Duro / Pork Rinds; prensado taco means Taco with Prensado / Spicy Pork; with beans means Con Frijoles / With Beans; homemade taco means Taco Comal / Homemade; street taco means Taco Taquero / Street Taco; flour taco means Taco Harina / Flour.",
    "Quesadilla phrases work the same way: steak quesadilla means Quesadilla with Bistec / Steak; cheese quesadilla means Quesadilla with Solo Queso / Only Cheese; homemade quesadilla means Quesadilla Comal / Homemade; flour quesadilla means Quesadilla Harina / Flour; street quesadilla means Quesadilla Taquera / Street Quesadilla.",
    "If the exact item id is uncertain, call add_item with itemQuery using the customer's phrase; the app will resolve the item and modifiers.",
    "Only discuss allergens when the customer asks or reports an allergy. Do not proactively bring up allergens.",
    "When closing or saying goodbye, say 'thanks for ordering at Cocina Elvis' — never say 'thanks for calling'.",
    "Use exact item ids in tool calls. Quote exact prices from the menu. Never invent items, prices, or modifiers.",
    language === "es"
      ? "OUTPUT_LANGUAGE_LOCK=Spanish. Responde solo en español. Frases cortas: 'Agregado.', 'Quitado.', '¿Algo más?', '¿Para recoger o entrega?'. Never output English words except exact menu item names when unavoidable."
      : "OUTPUT_LANGUAGE_LOCK=English. Reply only in English. Short phrases: 'Added.', 'Removed.', 'Anything else?', 'Pickup or delivery?'. Never output Spanish unless quoting an exact menu item name when unavoidable.",
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
      description: "Set whether the order is pickup or delivery.",
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
      return {
        action: { type: "set_fulfillment", fulfillment: args.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP" },
        output: { ok: true }
      };
    case "set_address":
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
