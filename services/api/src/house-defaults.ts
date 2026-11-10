/** Required groups Carlos approved.
 *  Nov 10 2026: Menudo tortillas are the comal corn option.
 *  Nov 10 2026, 11:52 AM ET: Platillo de Guisado, Mole Tradicional, Chiles Rellenos,
 *  and Fajitas Elvis use regular corn. The $4 comal extra is not a default.
 *  Ids are the catalog product, group, and option. Names are not matched. */
export type HouseDefault = { itemId: string; groupId: string; optionId: string };

export const HOUSE_DEFAULTS: HouseDefault[] = [
  { itemId: "NA2WYA64JRUYNKQ5ZEIKTMGZ", groupId: "SI44I4DI4A6A7433CNXCBGOI", optionId: "MGK4QQJ2C4BCC54IEAYSK3ZJ" },
  { itemId: "KRTHJS7AVUXA63WWMIOS5MQB", groupId: "EIJVOH6PSIJZR7DSLVAIHH5R", optionId: "PJTWPD3VXPJHFG67CTVFKM3Y" },
  { itemId: "LWEUFFHK2VNPIU7YUE3A5IYH", groupId: "EIJVOH6PSIJZR7DSLVAIHH5R", optionId: "PJTWPD3VXPJHFG67CTVFKM3Y" },
  { itemId: "JFC5DFLCFYEVJ6AU5GEQGMS3", groupId: "EIJVOH6PSIJZR7DSLVAIHH5R", optionId: "PJTWPD3VXPJHFG67CTVFKM3Y" },
  { itemId: "3NZJHENKW54E4WL5FXKQE2G7", groupId: "EIJVOH6PSIJZR7DSLVAIHH5R", optionId: "PJTWPD3VXPJHFG67CTVFKM3Y" },
];

/** Optional (CC) extras for the four platters. Not a house default. */
export const EXTRA_TORTILLAS = {
  itemIds: ["KRTHJS7AVUXA63WWMIOS5MQB", "LWEUFFHK2VNPIU7YUE3A5IYH", "JFC5DFLCFYEVJ6AU5GEQGMS3", "3NZJHENKW54E4WL5FXKQE2G7"],
  groupId: "UMBJ2J4XF3XJSA3SF3UZXGLS",
  comalOptionId: "BB7YTMBAGOWSXUMHFNCGAGW5",
  flourOptionId: "ZKZFEDRPNHJ2JNWK5YENXP5R",
};

type MenuItem = { id?: string; squareCatalogObjectId?: string; name?: string };
type MenuGroup = { id?: string; name?: string; options?: Array<string | { id?: string; name?: string }> };

function optionName(option: string | { id?: string; name?: string } | undefined): string {
  if (!option) return "";
  return typeof option === "string" ? option : option.name || "";
}

export function houseDefaultAllows(item: MenuItem, group: MenuGroup): boolean {
  return houseDefaultOption(item, group) !== null;
}

export function houseDefaultOption(item: MenuItem, group: MenuGroup): string | null {
  const itemIds = `${item?.squareCatalogObjectId || ""} ${item?.id || ""}`;
  const groupId = String(group?.id || "");
  const row = HOUSE_DEFAULTS.find((entry) => itemIds.includes(entry.itemId) && groupId === entry.groupId);
  if (!row) return null;
  const option = (group?.options || []).find((choice) => typeof choice !== "string" && choice?.id === row.optionId);
  return optionName(option) || null;
}
