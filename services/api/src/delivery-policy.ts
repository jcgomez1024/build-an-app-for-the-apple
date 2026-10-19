export type DeliveryQuoteInput = {
  address: string;
  subtotalCents: number;
};

export type DeliveryQuoteResult = {
  ok: boolean;
  enabled: boolean;
  message: string;
};

export function quoteDelivery(_input: DeliveryQuoteInput): DeliveryQuoteResult {
  return {
    ok: false,
    enabled: false,
    message: "Delivery by voice ordering is coming soon. Please use the regular online ordering site for delivery."
  };
}
