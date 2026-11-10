/** Required groups Carlos approved, Nov 10 2026.
 *  Menudo's required tortillas are the comal corn option, not plain corn and not flour.
 *  Platillo de Guisado, Mole, Chiles Rellenos, and Fajitas Elvis have no comal choice
 *  on their required tortilla group, so they are not listed.
 *  Birria's consomé-and-tortillas row is a separate SKU default, not a tortilla-group default.
 *  Every other group stays unapproved. */
export type HouseDefault = { item: string; group: string; option: string };

export const HOUSE_DEFAULTS: HouseDefault[] = [
  { item: "Menudo", group: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" },
];

export function houseDefaultAllows(itemName: string, itemId: string, groupName: string): boolean {
  return houseDefaultOption(itemName, itemId, groupName) !== null;
}

export function houseDefaultOption(itemName: string, itemId: string, groupName: string): string | null {
  const item = `${itemName} ${itemId}`.toLowerCase();
  if (/\bsolo\b/.test(item) && /\bcaldo\b/.test(item)) return null;
  const group = groupName.toLowerCase();
  const row = HOUSE_DEFAULTS.find((entry) => item.includes(entry.item.toLowerCase()) && group.includes(entry.group.toLowerCase()));
  return row?.option || null;
}
