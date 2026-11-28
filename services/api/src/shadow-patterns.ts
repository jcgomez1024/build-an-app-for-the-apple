// Shadow-only repairs. Live elvi does not import this module.
import { carryoverWants } from "./carryover.js";
import { applyMenudoSinPata } from "./list-repair.js";

type Turn = { speaker?: string; text?: string };
const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const numOf = (w: string) => Number(w) || NUM[w] || 0;
const NUMW = "\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez";
const YES = /^(?:si|sip|yes|yeah|claro|ok|okay)\b/;
const DISH = "gorditas?|sopes?(?:asos?)?|tacos?|quesadillas?|tortas?|burritos?|menudos?";

function oname(o: any): string {
  return typeof o === "string" ? o : String(o?.name || "");
}
function dishId(id: string, dish: string): boolean {
  if (/gordita/.test(dish)) return /gordita/.test(id);
  if (/sope/.test(dish)) return /sope/.test(id);
  if (/taco/.test(dish)) return /^sq-taco-/.test(id);
  if (/quesadilla/.test(dish)) return /quesadilla/.test(id);
  if (/torta/.test(dish)) return /^sq-torta-/.test(id);
  if (/burrito/.test(dish)) return /burrito/.test(id);
  if (/menudo/.test(dish)) return /menudo/.test(id);
  return false;
}
function meatOption(item: any, meat: string): { step: string; option: string } | null {
  const key = meat === "alpastor" ? "pastor" : meat;
  for (const group of item?.modifierGroups || []) {
    if (!/carne|meat/i.test(String(group?.name || ""))) continue;
    const name = (group.options || []).map(oname).find((option: string) => fold(option).includes(key));
    if (name) return { step: String(group.name), option: name };
  }
  return null;
}
function lineMeat(line: any): string {
  const blob = (line?.modifiers || []).map((mod: any) => fold(mod.option || "")).join(" ");
  if (/pastor/.test(blob)) return "pastor";
  if (/bistec|steak/.test(blob)) return "bistec";
  if (/chorizo/.test(blob)) return "chorizo";
  if (/pollo|chicken/.test(blob)) return "pollo";
  if (/lengua/.test(blob)) return "lengua";
  if (/tripa/.test(blob)) return "tripa";
  if (/costilla/.test(blob)) return "costilla";
  return "";
}

/** A count the caller and staff both said, and the caller agreed to, is the line's count. It does not add a second line. */
export function applyAgreedCount(cart: any[], turns: Turn[], menu: any[]): boolean {
  let changed = false;
  for (let i = 0; i < (turns || []).length; i++) {
    if (turns[i].speaker !== "staff") continue;
    const next = turns.slice(i + 1).find((turn) => !turn.speaker || turn.speaker === "caller");
    if (!next || !YES.test(fold(next.text || ""))) continue;
    const staff = fold(turns[i].text || "");
    for (const match of staff.matchAll(new RegExp(`\\b(${NUMW})\\s+(${DISH})(?:\\s+de\\s+([a-z]+))?`, "g"))) {
      const qty = numOf(match[1]);
      const dish = match[2];
      const meat = match[3] || "";
      if (!qty) continue;
      const callerSaid = (turns || []).some((turn) => (!turn.speaker || turn.speaker === "caller") && new RegExp(`\\b${match[1]}\\s+${dish}\\b`).test(fold(turn.text || "")));
      if (!callerSaid) continue;
      const lines = (cart || []).filter((line) => dishId(String(line?.itemId || ""), dish) && !/combo/i.test(String(line?.itemId || "")));
      const have = lines.reduce((sum, line) => sum + (Number(line.quantity) || 1), 0);
      if (!lines.length || have >= qty) continue;
      lines[0].quantity = qty - (have - (Number(lines[0].quantity) || 1));
      if (meat && !lineMeat(lines[0])) {
        const item = (menu || []).find((row) => row.id === lines[0].itemId);
        const option = item && meatOption(item, meat);
        if (option) lines[0].modifiers = [...(lines[0].modifiers || []), option];
      }
      changed = true;
    }
  }
  return changed;
}

/** "Dos tacos y una quesadilla" must not give the quesadilla the taco's count. */
export function fixCarriedCount(cart: any[], turns: Turn[]): boolean {
  let changed = false;
  const re = new RegExp(`\\b(${NUMW})\\s+(${DISH})\\b[\\s\\S]{0,80}?\\by\\s+(${NUMW})\\s+(${DISH})\\b`, "g");
  for (const turn of turns || []) {
    if (turn.speaker && turn.speaker !== "caller") continue;
    const text = fold(turn.text || "");
    for (const match of text.matchAll(re)) {
      const first = numOf(match[1]);
      const secondDish = match[4];
      const second = numOf(match[3]);
      if (!first || !second || first === second || match[2] === secondDish) continue;
      const line = (cart || []).find((row) => dishId(String(row?.itemId || ""), secondDish) && (Number(row.quantity) || 1) === first);
      if (!line) continue;
      line.quantity = second;
      changed = true;
    }
  }
  return changed;
}

/** An opening total, or "tres quesadillas" then one of each meat, is not the first meat's quantity. */
export function splitOpeningTotal(cart: any[], turns: Turn[], menu: any[]): boolean {
  const wants = carryoverWants(turns as any);
  const groups = new Map<string, typeof wants>();
  for (const want of wants) {
    const key = `${want.kind}|${want.style}|${want.qd}`;
    const list = groups.get(key) || [];
    list.push(want);
    groups.set(key, list);
  }
  let changed = false;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sum = list.reduce((total, want) => total + want.n, 0);
    const kind = list[0].kind;
    const lines = (cart || []).filter((line) => {
      const id = String(line?.itemId || "");
      if (kind === "qd") return /^sq-qd-/.test(id);
      if (kind === "quesadilla") return /^sq-quesadilla-/.test(id);
      if (kind === "taco") return /^sq-taco-/.test(id);
      if (kind === "gordita") return /gordita/.test(id);
      if (kind === "torta") return /^sq-torta-/.test(id);
      if (kind === "burrito") return /burrito/.test(id);
      return false;
    });
    const have = lines.reduce((total, line) => total + (Number(line.quantity) || 1), 0);
    if (lines.length !== 1 || have !== sum) continue;
    const shell = (lines[0].modifiers || []).filter((mod: any) => !/carne|meat/i.test(String(mod.step || "")));
    const item = (menu || []).find((row) => row.id === lines[0].itemId);
    if (!item) continue;
    const built = list.map((want) => {
      const option = meatOption(item, want.meats[0]);
      if (!option) return null;
      return { ...lines[0], quantity: want.n, modifiers: [...shell, option], elviNotes: lines[0].elviNotes };
    });
    if (built.some((line) => !line)) continue;
    const at = cart.indexOf(lines[0]);
    cart.splice(at, 1, ...(built as any[]));
    changed = true;
  }
  return changed;
}

/** Runs after the other shadow repairs. */
export function applyShadowPatterns(cart: any[], turns: Turn[], menu: any[] = []): boolean {
  let changed = false;
  if (applyMenudoSinPata(cart, turns as any, menu)) changed = true;
  if (splitOpeningTotal(cart, turns, menu)) changed = true;
  if (fixCarriedCount(cart, turns)) changed = true;
  if (applyAgreedCount(cart, turns, menu)) changed = true;
  return changed;
}
