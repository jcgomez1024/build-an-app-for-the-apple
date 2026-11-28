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
  if (/\b(?:taquer[ao]s?|street|comal|harina|flour|chicos)\b/i.test(besides)) return false;
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

const STYLE_REGULAR = /\b(?:regular(?:es)?|normal(?:es)?|sencill[ao]s?)\b/;
const STYLE_PREPARADA = /\b(?:preparad[ao]s?|deluxe)\b/;
const CLEAR_YES = /^(?:si|sip|yes|yeah|yep|yup|ok|okay|claro|correcto)\b/;
function callerText(turns: Turn[]): string {
  return (turns || []).filter((turn) => !turn.speaker || turn.speaker === "caller").map((turn) => fold(turn.text || "")).join(" ");
}
/** A style word, or a clear yes to a question that named only one style. */
function doradaStyleChosen(turns: Turn[]): boolean {
  const said = callerText(turns);
  if (STYLE_REGULAR.test(said) || STYLE_PREPARADA.test(said)) return true;
  for (let i = 0; i < (turns || []).length; i++) {
    const turn = turns[i];
    if (turn.speaker !== "staff" || !/[?¿]/.test(turn.text || "")) continue;
    const asked = fold(turn.text || "");
    const regular = STYLE_REGULAR.test(asked);
    const preparada = STYLE_PREPARADA.test(asked);
    if (regular === preparada) continue;
    const next = turns.slice(i + 1).find((row) => !row.speaker || row.speaker === "caller");
    if (next && CLEAR_YES.test(fold(next.text || ""))) return true;
  }
  return false;
}
/** Q7: a dorada with no regular or preparada said is not rung as Regular. Elvi asks. */
export function holdUnstyledDorada(cart: any[], turns: Turn[]): string | null {
  const said = callerText(turns);
  const aceite = /\b(?:de|en)\s+aceite\b/.test(said);
  if (!/\bdoradas?\b/.test(said) && !aceite) return null;
  if (doradaStyleChosen(turns)) return null;
  const note = "confirmar regular o preparada";
  let held = false;
  for (const line of cart || []) {
    const id = String(line?.itemId || "");
    if (!/dorada|t5stuh|zzav3l/i.test(id)) continue;
    if (/deluxe|preparada/i.test(id)) continue;
    const regular = /regular/i.test(id) || (line.modifiers || []).some((mod: any) => /REGULAR Dorada/i.test(String(mod.option || "")));
    if (!regular) continue;
    line.modifiers = (line.modifiers || []).filter((mod: any) => !/REGULAR Dorada/i.test(String(mod.option || "")));
    if (!(line.elviNotes || []).includes(note)) line.elviNotes = [...(line.elviNotes || []), note];
    line.validation = "unresolved";
    held = true;
  }
  return held ? note : null;
}

/** Runs at the end of a shadow order. Live elvi never calls it. */
export function applyShadowDecisions(cart: any[], turns: Turn[], menu: any[] = []): { review?: string } {
  applyTacoConTodo(cart, turns);
  applyPlainTaquitos(cart, turns, menu);
  const review = holdUnstyledDorada(cart, turns);
  return review ? { review } : {};
}
