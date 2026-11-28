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

/** Runs at the end of a shadow order. Live elvi never calls it. */
export function applyShadowDecisions(cart: any[], turns: Turn[]): { review?: string } {
  applyTacoConTodo(cart, turns);
  return {};
}
