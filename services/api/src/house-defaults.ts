/** Required groups whose catalog default may apply without a confirmar hold.
 *  Empty until Carlos names the groups. An empty list holds every unspoken required choice. */
export type HouseDefault = { item: string; group: string };

export const HOUSE_DEFAULTS: HouseDefault[] = [];

export function houseDefaultAllows(itemName: string, itemId: string, groupName: string): boolean {
  const item = `${itemName} ${itemId}`.toLowerCase();
  const group = groupName.toLowerCase();
  return HOUSE_DEFAULTS.some((row) => item.includes(row.item.toLowerCase()) && group.includes(row.group.toLowerCase()));
}
