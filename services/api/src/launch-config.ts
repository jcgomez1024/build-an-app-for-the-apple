import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export type FulfillmentMode = "PICKUP" | "DELIVERY";

const DELIVERY_DISABLED_MESSAGE =
  "Delivery by voice ordering is coming soon. Please use the regular online ordering site for delivery.";

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function parseFulfillmentModes(value: string | undefined): FulfillmentMode[] {
  const modes = String(value || "PICKUP")
    .split(",")
    .map((mode) => mode.trim().toUpperCase())
    .filter((mode): mode is FulfillmentMode => mode === "PICKUP" || mode === "DELIVERY");
  return modes.length ? Array.from(new Set(modes)) : ["PICKUP"];
}

// appdelivery1: with DELIVERY_ENABLED / FULFILLMENT_MODES unset, data/delivery.json "app.enabled" turns on app delivery.
function appDeliveryFlag(): boolean {
  try { return !!JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/delivery.json"), "utf8"))?.app?.enabled; } catch { return false; }
}
export function getLaunchConfig() {
  const fileOn = appDeliveryFlag();
  const fulfillmentModes = parseFulfillmentModes(process.env.FULFILLMENT_MODES || (fileOn ? "PICKUP,DELIVERY" : undefined));
  const deliveryEnabled =
    parseBoolean(process.env.DELIVERY_ENABLED, fileOn) && fulfillmentModes.includes("DELIVERY");

  return {
    fulfillmentModes: deliveryEnabled ? fulfillmentModes : fulfillmentModes.filter((mode) => mode !== "DELIVERY"),
    deliveryEnabled,
    deliveryDisabledMessage: process.env.DELIVERY_DISABLED_MESSAGE || DELIVERY_DISABLED_MESSAGE,
    voiceOrderSource: process.env.VOICE_ORDER_SOURCE || "cocinaelvis.com"
  };
}

export function assertFulfillmentAllowed(fulfillment: FulfillmentMode) {
  const config = getLaunchConfig();
  if (fulfillment === "DELIVERY" && !config.deliveryEnabled) {
    throw new Error(config.deliveryDisabledMessage);
  }
  if (!config.fulfillmentModes.includes(fulfillment)) {
    throw new Error(`${fulfillment} is not available for voice ordering.`);
  }
}

export function publicLaunchConfig() {
  const config = getLaunchConfig();
  return {
    fulfillmentModes: config.fulfillmentModes,
    deliveryEnabled: config.deliveryEnabled,
    deliveryDisabledMessage: config.deliveryDisabledMessage,
    voiceOrderSource: config.voiceOrderSource
  };
}
