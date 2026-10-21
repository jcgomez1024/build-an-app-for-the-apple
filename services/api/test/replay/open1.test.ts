// open1: the customer ordering page is open on the order host; staff / PII / learning routes are not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_PUBLIC, ORDER_DENY, checkoutLive, gatedCheckoutConfig } from "../../src/customer-guard.js";
const open = ["/", "/index.html", "/app.js", "/ui1.js", "/ui1.css", "/styles.css", "/halo.js", "/img/logo-cocina-elvis.png", "/img/taco-3.jpg", "/api/config", "/api/tenants",
  "/api/cocina-elvis/menu", "/api/cocina-elvis/ui/catalog", "/api/cocina-elvis/menu/resolve", "/api/cocina-elvis/elvi/chat", "/api/cocina-elvis/orders/checkout",
  "/api/cocina-elvis/xai/client-secret", "/api/cocina-elvis/xai/speech", "/api/cocina-elvis/xai/transcribe", "/api/cocina-elvis/tools/check_delivery_zone", "/api/cocina-elvis/tools/submit_order"];
const closed = ["/calls.html", "/phone.html", "/api/calls/accuracy", "/api/calls/CA00/audio", "/api/learning", "/api/learning/x/decide", "/api/cocina-elvis/favorites", "/api/favorites",
  "/api/twilio/voice", "/api/phone/token", "/api/square/webhooks", "/web.backup/index.html", "/data/logs/calls/2026-10-21.jsonl", "/img/../.env", "/.env", "/api/calls/names"];
test("open1: ordering page + its APIs are public", () => { for (const p of open) assert.ok(ORDER_PUBLIC.test(p) && !ORDER_DENY.test(p), p); });
test("open1: staff, PII and learning routes are not", () => { for (const p of closed) assert.ok(!ORDER_PUBLIC.test(p) || ORDER_DENY.test(p), p); });
test("open1: checkout stays sandbox unless CUSTOMER_CHECKOUT_LIVE=1", () => {
  const prev = process.env.CUSTOMER_CHECKOUT_LIVE; process.env.CUSTOMER_CHECKOUT_LIVE = "0";
  process.env.SQUARE_SANDBOX_ACCESS_TOKEN ||= "x"; process.env.SQUARE_SANDBOX_LOCATION_ID ||= "y";
  assert.equal(checkoutLive(), false); assert.equal(gatedCheckoutConfig({ env: "production", accessToken: "p", locationId: "l" })?.env, "sandbox");
  process.env.CUSTOMER_CHECKOUT_LIVE = prev;
});
