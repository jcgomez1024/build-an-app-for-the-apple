// Shadow reducer steps for synthetic fixtures. Not called from call-scoring or live webhooks.
// addonDifference was set aside: wiring it into applyAddOnCallback changed a correct H02-ES order.

export type ShadowLine = { itemId: string; quantity: number; modifiers?: Array<{ step?: string; option?: string }> };

/** A quantity update names one line. Other lines stay. */
export function quantityScoped(cart: ShadowLine[], lineIndex: number, quantity: number): ShadowLine[] {
  return cart.map((line, index) => index === lineIndex ? { ...line, quantity } : { ...line, modifiers: [...(line.modifiers || [])] });
}

/** A modifier lands on the named line only. */
export function bindModifier(cart: ShadowLine[], lineIndex: number, modifier: { step: string; option: string }): ShadowLine[] {
  return cart.map((line, index) => ({
    ...line,
    modifiers: index === lineIndex ? [...(line.modifiers || []), modifier] : [...(line.modifiers || [])],
  }));
}

/** When the caller switches, drop the unavailable item and keep the new one. */
export function dropUnavailableOnSwitch(cart: ShadowLine[], unavailableIds: string[], nextId: string): ShadowLine[] {
  if (!nextId || unavailableIds.includes(nextId)) return cart.map((line) => ({ ...line }));
  return cart.filter((line) => !unavailableIds.includes(line.itemId));
}
