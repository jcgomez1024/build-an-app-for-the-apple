// Shadow reducer steps for synthetic fixtures. Not called from call-scoring or live webhooks.
import type { CartAction } from "./menu-slice.js";

export type ShadowLine = { itemId: string; quantity: number; modifiers?: Array<{ step?: string; option?: string }> };

function key(line: { itemId: string; modifiers?: Array<{ option?: string }> }): string {
  const mods = (line.modifiers || []).map((mod) => String(mod.option || "")).sort().join("|");
  return `${line.itemId}:${mods}`;
}

/** A staff turn does not add lines. */
export function staffReadbackAddsNothing(cart: ShadowLine[], speaker: string): ShadowLine[] {
  return speaker === "staff" ? cart.map((line) => ({ ...line, modifiers: [...(line.modifiers || [])] })) : cart.map((line) => ({ ...line }));
}

/** An add-on request contributes only lines or extra quantity the cart does not already have. */
export function addonDifference(cart: ShadowLine[], requested: ShadowLine[]): CartAction[] {
  const have = new Map(cart.map((line) => [key(line), Number(line.quantity) || 0]));
  const actions: CartAction[] = [];
  for (const line of requested) {
    const owned = have.get(key(line)) || 0;
    const wanted = Number(line.quantity) || 0;
    if (wanted <= owned) continue;
    actions.push({ type: owned ? "update_item" : "add_item", item_id: line.itemId, quantity: wanted - owned });
  }
  return actions;
}

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
