export type Language = "en" | "es";
export type Fulfillment = "PICKUP" | "DELIVERY";

export type MenuItem = {
  id: string;
  name: string;
  nameEs: string;
  aliases: string[];
  priceCents: number;
};

export type CartLine = {
  item: MenuItem;
  quantity: number;
};

export type Customer = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
};

export type ElviAction =
  | { type: "add_item"; itemId: string; quantity: number }
  | { type: "set_fulfillment"; fulfillment: Fulfillment }
  | { type: "set_address"; address: string }
  | { type: "set_customer"; name?: string; phone?: string; email?: string }
  | { type: "checkout" };

export type ElviResponse = {
  language: Language;
  reply: string;
  actions: ElviAction[];
  engine: "nvidia" | "fallback";
};
