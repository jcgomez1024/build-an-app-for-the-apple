import type { CartLine, Customer, ElviResponse, Fulfillment, Language, MenuItem } from "./types";

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:4000";

export async function fetchMenu(): Promise<MenuItem[]> {
  const response = await fetch(`${apiBaseUrl}/api/menu`);
  if (!response.ok) {
    throw new Error("Unable to load menu");
  }
  const body = (await response.json()) as { items: MenuItem[] };
  return body.items;
}

export async function createCheckout(input: {
  cart: CartLine[];
  fulfillment: Fulfillment;
  customer: Customer;
}): Promise<{ checkoutUrl: string; orderId?: string; paymentLinkId: string }> {
  const response = await fetch(`${apiBaseUrl}/api/orders/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cart: input.cart.map((line) => ({ id: line.item.id, quantity: line.quantity })),
      fulfillment: input.fulfillment,
      customer: input.customer
    })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Unable to create checkout");
  }

  return response.json();
}

export async function chatWithElvi(input: {
  transcript: string;
  language: Language;
}): Promise<ElviResponse> {
  const response = await fetch(`${apiBaseUrl}/api/elvi/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Unable to chat with Elvi");
  }

  return response.json();
}
