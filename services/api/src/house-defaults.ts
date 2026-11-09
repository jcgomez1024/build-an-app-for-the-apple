/** Required groups whose catalog default may apply without a confirmar hold.
 *  Carlos, Nov 9: menudo uses the catalog corn tortilla when nobody names one.
 *  Every other group stays unapproved. */
export type HouseDefault = { item: string; group: string };

export const HOUSE_DEFAULTS: HouseDefault[] = [
  { item: "Menudo", group: "(A) Menudo Tortillas" },
];

export function houseDefaultAllows(itemName: string, itemId: string, groupName: string): boolean {
  const item = `${itemName} ${itemId}`.toLowerCase();
  const group = groupName.toLowerCase();
  return HOUSE_DEFAULTS.some((row) => item.includes(row.item.toLowerCase()) && group.includes(row.group.toLowerCase()));
}
