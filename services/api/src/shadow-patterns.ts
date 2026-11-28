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

/** "¿Cuántas?" "Cuatro." must not leave the dish at quantity 1. */
export function applyBareCount(cart: any[], turns: Turn[], menu: any[]): boolean {
  let changed = false;
  for (let i = 0; i < (turns || []).length; i++) {
    if (turns[i].speaker !== "staff" || !/\b(?:cu[aá]nt[oa]s?|how many)\b/i.test(turns[i].text || "")) continue;
    const next = turns.slice(i + 1).find((turn) => !turn.speaker || turn.speaker === "caller");
    if (!next) continue;
    const said = fold(next.text || "").replace(/[.?!,]/g, "").trim();
    const qty = numOf((said.match(new RegExp(`^(${NUMW})$`)) || [])[1] || "");
    if (!qty || qty <= 1) continue;
    const dish = (fold(turns[i].text || "").match(new RegExp(`\\b(${DISH})\\b`)) || [])[1] || "";
    if (!dish) {
      const food = (cart || []).filter((line) => !/combo|drink-|extras|tortilla|delivery/i.test(String(line?.itemId || "")));
      if (food.length === 1 && (Number(food[0].quantity) || 1) === 1) {
        food[0].quantity = qty;
        changed = true;
      }
      continue;
    }
    let lines = (cart || []).filter((line) => dishId(String(line?.itemId || ""), dish) && !/combo/i.test(String(line?.itemId || "")));
    if (!lines.length) {
      const item = (menu || []).find((row) => dishId(String(row?.id || ""), dish));
      if (!item) continue;
      const meat = (fold(turns.map((turn) => turn.text).join(" ")).match(/\b(pollo|bistec|pastor|lengua|tripa|costilla|chorizo)\b/) || [])[1] || "";
      const option = meat ? meatOption(item, meat) : null;
      const line = { itemId: item.id, quantity: qty, modifiers: option ? [option] : [] };
      cart.push(line);
      lines = [line];
      changed = true;
      continue;
    }
    const have = lines.reduce((sum, line) => sum + (Number(line.quantity) || 1), 0);
    if (have === 1 && lines.length === 1) {
      lines[0].quantity = qty;
      changed = true;
    }
  }
  return changed;
}

function findItem(menu: any[], re: RegExp): any | null {
  return (menu || []).find((row) => re.test(String(row?.id || ""))) || null;
}
function putOption(line: any, mod: { step: string; option: string } | null): void {
  if (!mod) return;
  const mods = (line.modifiers || []).filter((row: any) => row.step !== mod.step);
  if (!mods.some((row: any) => row.option === mod.option)) mods.push(mod);
  line.modifiers = mods;
}
function clearHold(line: any, pattern: RegExp): void {
  const notes = (line.elviNotes || []).filter((note: string) => !pattern.test(note));
  if (notes.length) line.elviNotes = notes;
  else delete line.elviNotes;
  if (!(line.elviNotes || []).some((note: string) => /^confirmar\b/i.test(note))) delete line.validation;
}

/** A short fajitas or platillo order, once the tortilla and side are answered, is not an empty cart. */
export function applyAnsweredPlate(cart: any[], turns: Turn[], menu: any[]): boolean {
  const callerTurns = (turns || []).filter((turn) => !turn.speaker || turn.speaker === "caller");
  const caller = callerTurns.map((turn) => fold(turn.text || "")).join(" ");
  const asking = (turn: Turn) => /[?¿]/.test(String(turn.text || "")) && /\b(?:tienen|tiene|hay|venden)\b/i.test(turn.text || "");
  const fajita = callerTurns.some((turn) => !asking(turn) && /\b(?:unas?|unos)\s+fajitas?\b|\bpreparar\s+unas?\s+fajitas?\b/.test(fold(turn.text || "")));
  const plate = callerTurns.some((turn) => !asking(turn) && /\bplatillos?\b/.test(fold(turn.text || "")) && /\b(?:un|una|unas|quiero|dame|preparar)\b/.test(fold(turn.text || "")))
    && !/\bmoles?\b|\brellenos?\b|\bfajitas?\b/.test(caller);
  const yesToPlate = (turns || []).some((turn, index) => {
    if (turn.speaker !== "staff" || !/\b(?:tortilla|comal|harina|arroz|frijol|lado)\b/i.test(turn.text || "")) return false;
    const next = turns.slice(index + 1).find((row) => !row.speaker || row.speaker === "caller");
    return !!next && /^(?:si|sip|claro|yes)\b/.test(fold(next.text || ""));
  });
  if (!fajita && !plate) return false;
  if (!fajita && !yesToPlate && !/\bcomal\b|\bharina\b|\bflour\b|\barroz\b|\bfrijol/.test(caller)) return false;
  const idRe = fajita ? /fajitas-elvis/i : /platillo-de-guisado/i;
  if ((cart || []).some((line) => idRe.test(String(line?.itemId || "")))) return false;
  const item = findItem(menu, idRe);
  if (!item) return false;
  const tortillaName = /\bharina\b|\bflour\b/.test(caller) ? /flour|harina/i : /corn/i;
  const sideName = /\bsolo\s+arroz\b|\bonly rice\b/.test(caller) ? /solo arroz|only rice/i : /\bsolo\s+frijol/.test(caller) ? /solo frijol|only beans/i : /arroz-rice and frijoles|rice and frijoles/i;
  const line: any = { itemId: item.id, quantity: 1, modifiers: [] };
  for (const group of item.modifierGroups || []) {
    if (/tortilla/i.test(group.name) && !/extra/i.test(group.name)) {
      const name = (group.options || []).map(oname).find((option: string) => tortillaName.test(option) && !/extra/i.test(option));
      if (name) line.modifiers.push({ step: group.name, option: name });
    }
    if (/lado|side/i.test(group.name)) {
      const name = (group.options || []).map(oname).find((option: string) => sideName.test(option));
      if (name) line.modifiers.push({ step: group.name, option: name });
    }
  }
  if (/\bmilanesa\b/.test(caller)) line.elviNotes = ["milanesa"];
  cart.push(line);
  return true;
}

/** "De queso" answers the enchilada option. The line does not stay on hold. */
export function applyEnchiladaCheese(cart: any[], turns: Turn[], menu: any[]): boolean {
  const callerTurns = (turns || []).filter((turn) => !turn.speaker || turn.speaker === "caller").map((turn) => fold(turn.text || ""));
  if (!callerTurns.some((text) => /\benchiladas?\b/.test(text)) || !callerTurns.some((text) => /\bde\s+queso\b/.test(text))) return false;
  const item = findItem(menu, /enchiladas-orden/i);
  const lines = (cart || []).filter((line) => /enchilada/i.test(String(line?.itemId || "")));
  if (!lines.length) return false;
  const host = item || (menu || []).find((row) => row.id === lines[0].itemId);
  const mod = meatOption(host, "queso") || { step: "(A) Enchiladas Carne Options (ONLINE)", option: "Queso / Cheese" };
  let changed = false;
  for (const line of lines) {
    putOption(line, mod);
    clearHold(line, /^confirmar\b.*(?:enchilada|carne)/i);
    changed = true;
  }
  return changed;
}

const BURRITO_FILLINGS = ["Frijoles Refritos / Refried Beans", "Arroz / Rice", "Queso Fresco / Cheese", "Crema / Sour Cream", "Cebolla / Onion", "Cilantro"];
/** "Con todo" on a burrito is the fillings, not the paid deluxe add-on. */
export function applyBurritoConTodo(cart: any[], turns: Turn[], menu: any[]): boolean {
  const callerTurns = (turns || []).filter((turn) => !turn.speaker || turn.speaker === "caller").map((turn) => fold(turn.text || ""));
  const caller = callerTurns.join(" ");
  const sameTurn = callerTurns.some((text) => /\bburritos?\b/.test(text) && /\bcon todo\b/.test(text));
  if (!sameTurn || /\b(?:deluxe|preparad)/.test(caller)) return false;
  const item = findItem(menu, /^sq-burrito-/i);
  if (!item) return false;
  let changed = false;
  let lines = (cart || []).filter((line) => /burrito/i.test(String(line?.itemId || "")));
  if (!lines.length) {
    const meat = (caller.match(/\b(bistec|asada|pastor|pollo|lengua|chorizo|carnitas)\b/) || [])[1];
    const key = meat === "asada" ? "bistec" : meat || "";
    const mods = [];
    if (key) {
      const option = meatOption(item, key);
      if (option) mods.push(option);
    }
    cart.push({ itemId: item.id, quantity: 1, modifiers: mods });
    lines = [cart[cart.length - 1]];
    changed = true;
  }
  const fillingGroup = (item.modifierGroups || []).find((group: any) => /burrito options/i.test(String(group?.name || "")));
  for (const line of lines) {
    const before = JSON.stringify(line.modifiers || []);
    if ((line.modifiers || []).some((mod: any) => /deluxe/i.test(String(mod.option || "")))) continue;
    for (const filling of BURRITO_FILLINGS) {
      const name = (fillingGroup?.options || []).map(oname).find((option: string) => fold(option) === fold(filling));
      if (!name) continue;
      if ((line.modifiers || []).some((mod: any) => mod.option === name)) continue;
      line.modifiers = [...(line.modifiers || []), { step: fillingGroup.name, option: name }];
    }
    if (JSON.stringify(line.modifiers || []) !== before) changed = true;
  }
  return changed;
}

/** Horchata the caller picked is not replaced by a bottle of water. Fried is not rewritten as comal. */
export function keepSpokenStyle(cart: any[], turns: Turn[], menu: any[]): boolean {
  const caller = (turns || []).filter((turn) => !turn.speaker || turn.speaker === "caller").map((turn) => fold(turn.text || "")).join(" ");
  let changed = false;
  if (/\bbotella de agua\b|\bagua embotellada\b|\bwater bottle\b/.test(caller) && !/\bhorchata\b/.test(caller)) {
    const bottle = findItem(menu, /agua-water-bottle/i);
    for (const line of cart || []) {
      if (!/horchata/i.test(String(line?.itemId || "")) || !bottle) continue;
      line.itemId = bottle.id;
      line.modifiers = [];
      changed = true;
    }
  } else if (/\bhorchata\b/.test(caller) && !/\bbotella\b|\bwater\b|\bagua embotellada\b/.test(caller)) {
    const water = (cart || []).find((line) => /water|embotellada|bottle/i.test(String(line?.itemId || "")));
    const horchata = (cart || []).find((line) => /horchata/i.test(String(line?.itemId || "")));
    if (water && !horchata) {
      const item = findItem(menu, /horchata/i);
      if (item) {
        water.itemId = item.id;
        water.modifiers = [];
        changed = true;
      }
    }
  }
  if (/\b(?:fritas?|fried)\b/.test(caller) && /\bquesadillas?\b/.test(caller) && !/\bcomal\b/.test(caller)) {
    const comal = (cart || []).filter((line) => /^sq-quesadilla-/.test(String(line?.itemId || "")) && !/dorada/.test(String(line?.itemId || "")));
    const dorada = findItem(menu, /quesadilla-dorada-qd-regular/i);
    if (comal.length && dorada) {
      for (const line of comal) {
        const meat = (line.modifiers || []).filter((mod: any) => /carne|meat/i.test(String(mod.step || "")));
        line.itemId = dorada.id;
        line.modifiers = meat;
        if (!(line.elviNotes || []).includes("confirmar regular o preparada")) line.elviNotes = [...(line.elviNotes || []), "confirmar regular o preparada"];
        line.validation = "unresolved";
      }
      changed = true;
    }
  }
  return changed;
}

const NOT_A_PERSON = /^(?:disculpa|disculpe|buenos|buenas|quiero|queremos|dame|deme|ponga|pongame|ponme|yo|um|uh|eh|ok|okay|okey|hola|mande|oye|mira|gracias|muchisimas|muchas|cinco|cuatro|tres|dos|una|uno|un|otra|vez|si|sip|claro|alla|en|para|con|sin|de|la|el|los|las)$/;
/** A token is a person's name only when it is a capitalized proper noun and not a closed-class word. */
function personName(token: string): string | null {
  const clean = String(token || "").replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, "");
  if (!/^\p{Lu}[\p{Ll}'’-]{2,18}$/u.test(clean)) return null;
  if (!/[aeiouáéíóúü]/i.test(clean)) return null;
  if (NOT_A_PERSON.test(fold(clean))) return null;
  return clean;
}
function framedName(turns: Turn[]): string | null {
  for (const turn of turns || []) {
    if (turn.speaker && turn.speaker !== "caller") continue;
    const said = String(turn.text || "").trim();
    const frame = said.match(/^(?:hola|mande|buenas|ponga|ponme|dame)\s*,?\s+(\p{L}[\p{L}'’-]{2,18})\b/iu)
      || said.match(/\b(?:me llamo|soy|mi nombre es|para)\s+(\p{L}[\p{L}'’-]{2,18})\b/iu);
    const name = frame && personName(frame[1]);
    if (name) return name;
  }
  return null;
}
function liveNameOk(name: string): boolean {
  if (/^all[aá]\s+en\b/i.test(name)) return false;
  return name.split(/\s+/).every((part) => !!personName(part) || /^(?:de|del|la|y)$/i.test(part));
}
/** Shadow name only. The live name function is not changed. An empty order gets no name. */
export function shadowCustomerName(live: { name?: string; group?: string[] } | null, turns: Turn[], ordered = true): string | null {
  if (!ordered) return null;
  const spoken = framedName(turns);
  let name = live?.name || "";
  if (spoken && (!name || !liveNameOk(name))) return spoken;
  if (!name || !liveNameOk(name)) {
    if (live?.group && live.group.length >= 2) return null;
    return spoken;
  }
  const shouted = (turns || []).some((turn) => turn.speaker === "staff" && new RegExp(`\\boye\\b[,.\\s]+${name}\\b`, "i").test(turn.text || "") && /\b(?:pedido|orden|listo|ya\s+est[aá])/i.test(turn.text || ""));
  const saidOwn = (turns || []).some((turn) => (!turn.speaker || turn.speaker === "caller") && new RegExp(`\\b${name}\\b`, "i").test(turn.text || ""));
  if (shouted && !saidOwn) return null;
  return name;
}

/** Shadow address only. Live address parsing is not changed. */
export function shadowFillAddress(turns: Turn[], current: string | null): string | null {
  const blob = (turns || []).map((turn) => String(turn.text || "")).join(" ");
  const match = blob.match(/\b(\d{1,6})\s+de\s+la\s+(calle|avenida|av\.?)\s+([a-záéíóúñ][a-záéíóúñ.'-]{2,})(?:\s*,\s*(apartamento|apt\.?|apartment)\s*([a-z0-9-]{1,6}))?/iu);
  const tidy = (addr: string | null) => addr ? addr.replace(/\.+(\s+)/g, "$1").replace(/\s+/g, " ").trim() : addr;
  if (!match) return tidy(current);
  const phone = blob.match(/\b(?:n[uú]mero|tel[eé]fono|phone)\s*(?:es\s*)?([\d\s-]{7,})/iu);
  const phoneDigits = (phone?.[1] || "").replace(/\D/g, "");
  if (phoneDigits.includes(match[1])) return current;
  const kind = /^av/i.test(match[2]) ? "Ave" : "St";
  const streetName = match[3].replace(/\.+$/g, "").replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
  const street = `${match[1]} ${streetName} ${kind}`;
  const unit = match[5] ? `Apartamento ${match[5]}` : "";
  if (current && current.includes(match[1])) {
    if (unit && !/apartamento|apt/i.test(current)) return tidy(`${current} ${unit}`);
    return tidy(current);
  }
  return tidy([street, unit].filter(Boolean).join(" "));
}

/** Runs after the other shadow repairs. */
export function applyShadowPatterns(cart: any[], turns: Turn[], menu: any[] = []): boolean {
  let changed = false;
  if (applyMenudoSinPata(cart, turns as any, menu)) changed = true;
  if (splitOpeningTotal(cart, turns, menu)) changed = true;
  if (fixCarriedCount(cart, turns)) changed = true;
  if (applyAgreedCount(cart, turns, menu)) changed = true;
  if (applyBareCount(cart, turns, menu)) changed = true;
  if (applyAnsweredPlate(cart, turns, menu)) changed = true;
  if (applyEnchiladaCheese(cart, turns, menu)) changed = true;
  if (applyBurritoConTodo(cart, turns, menu)) changed = true;
  if (keepSpokenStyle(cart, turns, menu)) changed = true;
  if (applyOneBurrito(cart, turns, menu)) changed = true;
  return changed;
}

/** A one-turn plain or deluxe burrito is not an empty cart. */
function applyOneBurrito(cart: any[], turns: Turn[], menu: any[]): boolean {
  if ((cart || []).some((line) => String(line?.itemId || "") && !/delivery-fee/i.test(String(line.itemId)))) return false;
  const turn = (turns || []).find((row) => (!row.speaker || row.speaker === "caller") && /\bburritos?\b/i.test(row.text || "") && /\b(?:de\s+\p{L}+|deluxe|preparad|regular|plain|sencill)/iu.test(row.text || ""));
  if (!turn) return false;
  const item = findItem(menu, /^sq-burrito-/i);
  if (!item) return false;
  const text = fold(turn.text || "");
  const meat = (text.match(/\b(bistec|asada|pastor|pollo|lengua|chorizo|carnitas|cabeza)\b/) || [])[1];
  const mods: Array<{ step: string; option: string }> = [];
  const option = meat ? meatOption(item, meat === "asada" ? "bistec" : meat) : null;
  if (option) mods.push(option);
  if (/\bdeluxe\b|\bpreparad/.test(text)) {
    const deluxe = ((item.modifierGroups || []).find((group: any) => /deluxe/i.test(String(group?.name || "")))?.options || []).map(oname)[0];
    const step = (item.modifierGroups || []).find((group: any) => /deluxe/i.test(String(group?.name || "")))?.name;
    if (deluxe && step) mods.push({ step, option: deluxe });
  }
  cart.push({ itemId: item.id, quantity: 1, modifiers: mods });
  return true;
}
