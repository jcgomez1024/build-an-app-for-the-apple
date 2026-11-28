// Shadow-only decisions from Nov 28. The live phone path does not import this module.
type Turn = { speaker?: string; text?: string };
const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const CON_TODO = /\bcon todo\b/;
const OTHER_DISH = /\b(?:burritos?|quesadillas?|gorditas?|sopes?(?:as[oa]s?)?|huaraches?|guaraches?|tortas?)\b/;
const TACO_NOTE = "cebolla, cilantro y limón";

/** Q4: "con todo" on tacos is the normal toppings, not deluxe and not a paid side. */
export function applyTacoConTodo(cart: any[], turns: Turn[]): boolean {
  let hit = false;
  for (const turn of turns || []) {
    if (turn.speaker && turn.speaker !== "caller") continue;
    const p = fold(turn.text || "");
    if (!CON_TODO.test(p) || !/\btacos?\b/.test(p) || OTHER_DISH.test(p)) continue;
    hit = true;
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

const TAQUITO_NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const TAQUITO_MEATS = ["bistec", "chorizo", "pastor", "pollo", "lengua", "tripa", "cabeza", "costilla", "carnitas", "buche", "prensado", "duro", "picadillo", "deshebrada"];
type TaquitoStyle = "" | "comal" | "harina" | "taquero";
function taquitoCount(word: string): number {
  return Number(word) || TAQUITO_NUM[word] || 0;
}
function taquitoStyle(text: string): TaquitoStyle {
  const p = fold(text).replace(/\btaquitos?\b/g, " ");
  if (/\bharina\b|\bflour\b/.test(p)) return "harina";
  if (/\bcomal\b|\bhomemade\b/.test(p)) return "comal";
  if (/\btaquer|\bstreet\b|\bchicos\b/.test(p)) return "taquero";
  return "";
}
function yesToTaquitoStyle(turns: Turn[], at: number): TaquitoStyle {
  for (let j = at + 1; j < (turns || []).length; j++) {
    const turn = turns[j];
    if (turn.speaker && turn.speaker !== "caller") continue;
    const p = fold(turn.text || "");
    if (/\b(?:quesadillas?|gorditas?|tortas?|burritos?|tacos?|taquitos?|sopes?)\b/.test(p)) return "";
    if (!/^(?:si|sip|yes|yeah|claro|ok|okay)\b/.test(p)) continue;
    const staff = [...turns.slice(at + 1, j)].reverse().find((row) => row.speaker === "staff");
    if (!staff || !/[?¿]/.test(staff.text || "")) continue;
    const q = fold(staff.text || "");
    const styles: TaquitoStyle[] = [];
    if (/\btaquer/.test(q)) styles.push("taquero");
    if (/\bcomal\b/.test(q)) styles.push("comal");
    if (/\bharina\b|\bflour\b/.test(q)) styles.push("harina");
    if (styles.length === 1) return styles[0];
  }
  return "";
}
function laterTaquitoStyle(turns: Turn[], at: number): TaquitoStyle {
  for (const turn of (turns || []).slice(at + 1)) {
    if (turn.speaker && turn.speaker !== "caller") continue;
    const p = fold(turn.text || "");
    if (/\b(?:quesadillas?|gorditas?|tortas?|burritos?|tacos?)\b/.test(p)) return "";
    const style = taquitoStyle(p);
    if (style) return style;
  }
  return "";
}
function optionNamed(item: any, groupRe: RegExp, pick: (name: string) => boolean): { step: string; option: string } | null {
  for (const group of item?.modifierGroups || []) {
    if (!groupRe.test(String(group?.name || ""))) continue;
    const name = (group.options || []).map((option: any) => typeof option === "string" ? option : String(option?.name || "")).find(pick);
    if (name) return { step: String(group.name), option: name };
  }
  return null;
}
type TaquitoOrder = { qty: number; meat: string; style: TaquitoStyle };
function taquitoOrders(turns: Turn[]): TaquitoOrder[] {
  const out: TaquitoOrder[] = [];
  for (let i = 0; i < (turns || []).length; i++) {
    const turn = turns[i];
    if (turn.speaker && turn.speaker !== "caller") continue;
    const raw = fold(turn.text || "");
    if (!/\btaquitos?\b/.test(raw)) continue;
    const otherDish = raw.search(/\b(?:quesadillas?|gorditas?|tortas?|burritos?|sopes?(?:asos?)?|menudos?|huaraches?)\b/);
    const scope = otherDish >= 0 ? raw.slice(0, otherDish) : raw;
    const style = taquitoStyle(scope) || laterTaquitoStyle(turns, i) || yesToTaquitoStyle(turns, i);
    const re = /\b(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+taquitos?\b/g;
    let found = false;
    for (const match of scope.matchAll(re)) {
      found = true;
      const tail = scope.slice((match.index || 0) + match[0].length).split(/\b(?:y|and)\b/)[0];
      const meat = TAQUITO_MEATS.find((key) => new RegExp(`\\b${key}`).test(tail));
      const qty = taquitoCount(match[1]);
      if (meat && qty) out.push({ qty, meat, style });
    }
    for (const extra of scope.matchAll(/\by\s+(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+de\s+([a-z]+)/g)) {
      const meat = TAQUITO_MEATS.find((key) => key === extra[2] || extra[2].startsWith(key));
      const qty = taquitoCount(extra[1]);
      if (meat && qty) out.push({ qty, meat, style });
    }
    if (!found) {
      const meat = TAQUITO_MEATS.find((key) => new RegExp(`\\b${key}`).test(scope));
      if (meat) out.push({ qty: 1, meat, style });
    }
  }
  return out;
}
function lineHasMeat(line: any, meat: string): boolean {
  return (line?.modifiers || []).some((mod: any) => fold(mod.option || "").includes(meat));
}
function clearAsked(line: any, pattern: RegExp): boolean {
  const notes = (line.elviNotes || []).filter((note: string) => !pattern.test(note));
  if (notes.length === (line.elviNotes || []).length) return false;
  if (notes.length) line.elviNotes = notes;
  else delete line.elviNotes;
  if (!(line.elviNotes || []).some((note: string) => /^confirmar\b/i.test(note))) delete line.validation;
  return true;
}
/** Q6: "taquitos" are plain tacos. Ask the tortilla only when none was said. */
export function applyPlainTaquitos(cart: any[], turns: Turn[], menu: any[] = []): boolean {
  const orders = taquitoOrders(turns || []);
  if (!orders.length) return false;
  const taco = (menu || []).find((row) => /^sq-taco-/.test(String(row?.id || "")));
  let changed = false;
  for (const order of orders) {
    let line = (cart || []).find((row) => /^sq-taco-/.test(String(row?.itemId || "")) && lineHasMeat(row, order.meat));
    if (!line && taco) {
      const mods = [optionNamed(taco, /carne|meat/i, (name) => fold(name).includes(order.meat))].filter(Boolean);
      if (order.style) {
        const code = order.style === "harina" ? "THR" : order.style === "taquero" ? "TST" : "TCO";
        const tortilla = optionNamed(taco, /tortilla options/i, (name) => name.includes(`(${code})`));
        if (tortilla) mods.push(tortilla);
      }
      line = { itemId: taco.id, quantity: order.qty, modifiers: mods };
      cart.push(line);
      changed = true;
    }
    if (!line) continue;
    if (lineHasMeat(line, order.meat) && clearAsked(line, /^confirmar\b.*(?:carne|meat)/i)) changed = true;
    if (order.style && taco) {
      const code = order.style === "harina" ? "THR" : order.style === "taquero" ? "TST" : "TCO";
      const tortilla = optionNamed(taco, /tortilla options/i, (name) => name.includes(`(${code})`));
      const already = tortilla && (line.modifiers || []).some((mod: any) => mod.option === tortilla.option);
      if (tortilla && !already) {
        const kept = (line.modifiers || []).filter((mod: any) => !/tortilla|comal|harina|flour|taquer|street|\(tc[oh]\)|\(thr\)|\(tst\)/i.test(`${mod.step} ${mod.option}`));
        kept.push(tortilla);
        line.modifiers = kept;
        changed = true;
      }
      if (clearAsked(line, /^confirmar\b.*tortilla/i)) changed = true;
      continue;
    }
    const before = (line.modifiers || []).length;
    line.modifiers = (line.modifiers || []).filter((mod: any) => !/tortilla|comal|harina|flour|taquer|street|\(tc[oh]\)|\(thr\)|\(tst\)/i.test(`${mod.step} ${mod.option}`));
    if ((line.modifiers || []).length !== before) changed = true;
    const item = (menu || []).find((row) => row.id === line.itemId) || taco;
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
const FRIED_QUESADILLA = /\bquesadillas?\s+fritas?\b|\bfritas?\s+quesadillas?\b|\bfried(?:\s+\w+){0,3}\s+quesadillas?\b|\bquesadillas?\s+fried\b/;
/** Q7: a dorada, aceite, or fried quesadilla with no regular or preparada said is not rung as Regular. Elvi asks. */
export function holdUnstyledDorada(cart: any[], turns: Turn[]): string | null {
  const said = callerText(turns);
  const aceite = /\b(?:de|en)\s+aceite\b/.test(said);
  if (!/\bdoradas?\b/.test(said) && !aceite && !FRIED_QUESADILLA.test(said)) return null;
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
