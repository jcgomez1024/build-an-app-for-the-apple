// Shadow-only decisions from Nov 28. The live phone path does not import this module.
type Turn = { speaker?: string; text?: string };
const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const CON_TODO = /\b(?:con todo|con de todo|with everything|everything on it|the works)\b/;
const OTHER_DISH = /\b(?:burritos?|quesadillas?|gorditas?|sopes?|huaraches?|guaraches?|tortas?)\b/;
const TACO_NOTE = "cebolla, cilantro y limón";

/** Q4: "con todo" on tacos is the normal toppings, not deluxe and not a paid side. */
export function applyTacoConTodo(cart: any[], turns: Turn[]): boolean {
  let active = "";
  let hit = false;
  for (const turn of turns || []) {
    if (turn.speaker && turn.speaker !== "caller") continue;
    const p = fold(turn.text || "");
    if (OTHER_DISH.test(p)) active = "other";
    else if (/\btacos?\b/.test(p)) active = "taco";
    if (!CON_TODO.test(p)) continue;
    if (/\btacos?\b/.test(p) && !OTHER_DISH.test(p)) hit = true;
    else if (active === "taco" && !OTHER_DISH.test(p)) hit = true;
  }
  if (!hit) return false;
  let changed = false;
  for (const line of cart || []) {
    if (!/^sq-taco-/.test(String(line?.itemId || ""))) continue;
    const before = (line.modifiers || []).length;
    line.modifiers = (line.modifiers || []).filter((mod: any) => !/\bdeluxe\b/i.test(String(mod.option || "")));
    if ((line.modifiers || []).length !== before) changed = true;
    if (!(line.elviNotes || []).includes(TACO_NOTE)) {
      line.elviNotes = [...(line.elviNotes || []), TACO_NOTE];
      changed = true;
    }
  }
  return changed;
}

/** Q6: "taquitos" are plain tacos. Ask the tortilla. Do not assume street. */
export function applyPlainTaquitos(cart: any[], turns: Turn[], menu: any[] = []): boolean {
  const caller = (turns || []).filter((turn) => !turn.speaker || turn.speaker === "caller").map((turn) => turn.text || "").join(" ");
  if (!/\btaquitos?\b/i.test(caller)) return false;
  const besides = caller.replace(/\btaquitos?\b/gi, " ");
  if (/\b(?:taqueros?|street)\b/i.test(besides)) return false;
  let changed = false;
  for (const line of cart || []) {
    if (!/^sq-taco-/.test(String(line?.itemId || ""))) continue;
    if ((line.modifiers || []).some((mod: any) => /comal|harina|flour/i.test(String(mod.option || "")))) continue;
    const before = (line.modifiers || []).length;
    line.modifiers = (line.modifiers || []).filter((mod: any) => !/taquer|street/i.test(String(mod.option || "")));
    if ((line.modifiers || []).length !== before) changed = true;
    const item = (menu || []).find((row) => row.id === line.itemId);
    const group = (item?.modifierGroups || []).find((entry: any) => /tortilla options/i.test(String(entry?.name || "")));
    const marker = `confirmar ${group?.name || "(A) T Tortilla Options"}`;
    if (!(line.elviNotes || []).includes(marker)) {
      line.elviNotes = [...(line.elviNotes || []), marker];
      line.validation = "unresolved";
      changed = true;
    }
  }
  return changed;
}

/** Runs at the end of a shadow order. Live elvi never calls it. */
export function applyShadowDecisions(cart: any[], turns: Turn[], menu: any[] = []): { review?: string } {
  applyTacoConTodo(cart, turns);
  applyPlainTaquitos(cart, turns, menu);
  return {};
}
