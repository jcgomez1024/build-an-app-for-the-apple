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
  const clause = callerTurns.map((turn) => fold(turn.text || "")).find((text) => fajita ? /\bfajitas?\b/.test(text) : /\bplatillos?\b/.test(text)) || "";
  const item = findItem(menu, idRe);
  if (!item) return false;
  let lines = (cart || []).filter((line) => idRe.test(String(line?.itemId || "")));
  let changed = false;
  if (!lines.length) {
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
    cart.push(line);
    lines = [line];
    changed = true;
  }
  const meatInfo = plateMeat(clause);
  if (!meatInfo.mapped) {
    for (const line of lines) {
      const hasMeat = (line.modifiers || []).some((mod: any) => /carne|meat/i.test(String(mod.step || "")));
      if (hasMeat && !meatInfo.key) continue;
      line.validation = "unresolved";
      if (!(line.elviNotes || []).includes("confirmar carne")) line.elviNotes = [...(line.elviNotes || []), "confirmar carne"];
      changed = true;
    }
    return changed;
  }
  const meat = meatInfo.key;
  for (const line of lines) {
    if ((line.modifiers || []).some((mod: any) => fold(mod.option || "").includes(meat))) {
      const notes = (line.elviNotes || []).filter((note: string) => fold(note) !== meat);
      if (notes.length) line.elviNotes = notes;
      else delete line.elviNotes;
      continue;
    }
    const mod = meatOption(item, meat);
    if (mod) {
      putOption(line, mod);
      const notes = (line.elviNotes || []).filter((note: string) => fold(note) !== meat);
      if (notes.length) line.elviNotes = notes;
      else delete line.elviNotes;
      changed = true;
      continue;
    }
    line.validation = "unresolved";
    if (!(line.elviNotes || []).includes("confirmar carne")) line.elviNotes = [...(line.elviNotes || []), "confirmar carne"];
    changed = true;
  }
  return changed;
}

const PLATE_MEAT = "bistec|asada|steak|pastor|alpastor|pollo|chicken|lengua|chorizo|carnitas|cabeza|costilla|tripas?|buche|prensado|suadero|milanesa|deshebrada|picadillo|nopales|duro";
function plateMeat(text: string): { key: string; mapped: boolean } {
  if (/\b(?:camar[oó]n(?:es)?|shrimp|gambas?)\b/.test(text)) return { key: "shrimp", mapped: false };
  if (/\bmilanesa\b/.test(text) && /\b(?:res|puerco|cerdo|ternera|carne)\b/.test(text) && !/\b(?:pollo|chicken)\b/.test(text)) return { key: "milanesa other", mapped: false };
  const found = text.match(new RegExp(`\\b(${PLATE_MEAT})\\b`));
  if (!found) return { key: "", mapped: false };
  let word = found[1];
  if (word === "asada" || word === "steak") word = "bistec";
  else if (word === "alpastor") word = "pastor";
  else if (word === "chicken") word = "pollo";
  else if (word === "tripas") word = "tripa";
  return { key: word, mapped: true };
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

const NAME_PARTICLE = /^(?:de|del|la|las|los|y|e|san|santa|da|do|das|van|von|di)$/i;
const NAME_SKIP = /^(?:yo|que|es|el|un|una|ah|eh|este|pues|a|it|is|the|nombre)$/i;
/** Words that are not a person's name: grammar, food, numbers, greetings, and the common verbs. A name is whatever is left. */
const ORDINARY = new Set(`disculpa disculpe perdon perdone buenos buenas hola mande oye oiga mira hello hi hey please porfa gracias muchisimas muchas bye adios ok okay okey si sip claro no nop yo um uh eh ah este pues bueno entonces ahora ahorita horita manana hoy ayer tarde noche pronto luego despues antes aqui alla aqu alla cuanto cuanta cuantos cuantas donde cuando como cual quien que nuevo nueva orden pedido comida menu nombre tienen tengo tienes tiene tenemos necesitamos necesito necesita necesitan podria podrias podriamos podemos pueden puedo puedes puede vamos voy vas va estoy estas esta estamos estan ser soy eres es somos son quiero quieres quiere queremos quieren quisiera quisieras dame deme ponga ponme llevar recoger comer comemos comen como comes delivery pickup domicilio togo nosotros nos ustedes ellos ellas usted tu te me se le les lo los las con sin por para de del al un una unos unas otro otra otros otras vez tambien porque correcto listo perfecto bien mal muy mas menos todo nada algo esto eso esa ese era eran aquel aquella those this that the and for with can could would should want need have get lets let go yes yeah thank thanks sorry name food order new today tomorrow we us eat ordenar hablar llamar preparar mirar tomar comprar vender buscar esperar dejar pagar mandar enviar usar pasar quedar llegar entrar preguntar trabajar caminar hungry ready here calling calling uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte treinta cuarenta cincuenta sesenta setenta ochenta noventa cien media one two three four five six seven eight nine ten eleven twelve fifteen twenty thirty tacos taco quesadilla quesadillas gordita gorditas burrito burritos burro burros torta tortas aceite aceites fajita fajitas platillo platillos menudo comal harina flour bistec pollo pastor carne meat asada steak chicken tortilla tortillas extra mas otras recoger llevar hello please orden nuevo hoy delivery pickup nosotros comer nope yeah well will pick picking gonna just sir maam thank you tardes dias noches senor senora don dona bebe mama papa preparada preparadas andele andale orale orales sale vamonos verdad correcto`.split(/\s+/));
function plainName(token: string): string {
  return fold(String(token || "")).replace(/[^\p{L}]/gu, "");
}
const VERB = new Set<string>();
function addVerb(word: string): void {
  VERB.add(fold(word).replace(/[^a-z]/g, ""));
}
function conjugate(infinitive: string): void {
  addVerb(infinitive);
  const kind = infinitive.slice(-2);
  const stem = infinitive.slice(0, -2);
  const theme = kind === "ar" ? "a" : kind === "er" ? "e" : "i";
  const sub = kind === "ar" ? "e" : "a";
  const we = kind === "ar" ? "amos" : kind === "er" ? "emos" : "imos";
  for (const end of ["o", theme, theme + "s", theme + "n", we, sub, sub + "s", sub + "n", sub + "mos"]) addVerb(stem + end);
  if (kind === "ar") {
    for (const end of ["aste", "aron", "aba", "abas", "aban", "ando"]) addVerb(stem + end);
  } else {
    for (const end of ["iste", "ieron", "ia", "ias", "ian", "iendo"]) addVerb(stem + end);
  }
  for (const end of ["me", "le", "nos", "se"]) {
    addVerb(stem + theme + end);
    addVerb(stem + sub + end);
  }
}
for (const infinitive of ["deber", "encargar", "esperar", "llevar", "recoger", "comer", "ordenar", "hablar", "llamar", "preparar", "mirar", "tomar", "comprar", "vender", "buscar", "dejar", "pagar", "mandar", "enviar", "usar", "pasar", "quedar", "llegar", "entrar", "preguntar", "trabajar", "caminar", "necesitar", "gustar", "molestar", "pensar", "contar", "volver", "entender", "perder", "parecer", "creer", "vivir", "escribir", "subir", "bajar", "seguir", "pedir", "servir", "dormir", "sentir", "preferir", "salir", "andar", "almorzar", "cenar", "probar", "abrir", "cerrar"]) conjugate(infinitive);
for (const form of ["soy", "eres", "somos", "son", "era", "eras", "fui", "fue", "sera", "seran", "estoy", "estas", "esta", "estamos", "estan", "estaba", "voy", "vas", "va", "vamos", "van", "iba", "tengo", "tienes", "tiene", "tenemos", "tienen", "tuve", "tenia", "debiste", "debi", "vengo", "vienes", "viene", "venga", "vengan", "anda", "ande", "digo", "dice", "diga", "digame", "digas", "dime", "dile", "puedo", "puede", "pueda", "podria", "quiero", "quiere", "quisiera", "saber", "sabes", "sabe", "saben", "sepa", "hago", "haces", "hace", "hacemos", "hacen", "haga", "hacer", "pongo", "pone", "ponga", "poner", "traigo", "trae", "traiga", "veo", "ves", "ve", "doy", "das", "da", "dan", "danos", "salgo", "sale", "salga", "sal", "comi", "comio", "pidio", "pido", "entiendo", "abierto", "abierta", "cerrado", "cerrada"]) addVerb(form);
VERB.delete("tomas");
const NOT_NAME = new Set(`${[...ORDINARY].join(" ")} give same what which where when who how this that these those take make let say tell come look know see want need here there inside outside very much many some any also just only again still already yet too really maybe sure fine great good bad big small more less other another back next now then well give gave given go went come came put set mean means right left call wait hold adentro afuera arriba abajo dentro fuera enfrente cerca lejos avenue street road drive lane court boulevard way place calle avenida camino numero tel telefono hijole hijoles molestia gusto favor permiso buen dia mucha mucho momento hasta sal letter pero misfiado aja ajá all nunca called calls looking going coming ordering wondering wanna totally cool porfavor hello okay its each every both few either neither siempre todavia jamás jamas yep yup alright anyway fine nice correct large listen takeout casa hambre sed sueno`.split(/\s+/));
/** Homographs of a real verb or function word. An ending by itself is not enough to reject a name. */
const NAME_OK = new Set("tomas sal dan will ed al".split(" "));
function grammatical(word: string): boolean {
  if (!word) return true;
  if (NAME_OK.has(word)) return false;
  if (NOT_NAME.has(word) || VERB.has(word) || ORDINARY.has(word)) return true;
  if (/^(?:gon|got|wan|lem)(?:na|ta|me)$/.test(word)) return true;
  return false;
}
function isOrdinary(token: string): boolean {
  return grammatical(plainName(token));
}
function courtesyPhrase(text: string): boolean {
  const said = fold(text);
  return /^(?:mucho|mucha)\s+(?:gusto|molestia)\b/.test(said)
    || /^(?:buen|buena|buenos|buenas)\s+d[ií]as?\b/.test(said)
    || /^(?:venga|anda)\b/.test(said)
    || /\bhijol/.test(said);
}
/** A name token is a word that is not grammar, food, a number, a verb, or a courtesy word. It does not have to be on a list. */
function nameToken(token: string): boolean {
  const word = plainName(token);
  if (NAME_OK.has(word)) return word.length >= 2 && /[aeiou]/.test(word);
  if (word.length < 3 || !/[aeiou]/.test(word)) return false;
  return !grammatical(word) && !NAME_PARTICLE.test(token) && !NAME_SKIP.test(token);
}
function showToken(token: string): string {
  const clean = String(token || "").replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, "");
  if (NAME_PARTICLE.test(clean)) return plainName(clean) === "del" ? "del" : clean.toLowerCase();
  if (/\p{Lu}/u.test(clean)) return clean;
  return clean.charAt(0).toLocaleUpperCase() + clean.slice(1);
}
/** Leading given name plus surnames or particles. Ordinary words stop the span. */
function nameSpan(raw: string): string | null {
  const cleaned = String(raw || "").replace(/\b(?:much[ií]simas\s+gracias|muchas\s+gracias|gracias|bye|adi[oó]s)\b.*$/iu, "");
  const parts = cleaned.replace(/[.?!,¡¿;:]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < parts.length && (NAME_SKIP.test(parts[index]) || NAME_PARTICLE.test(parts[index]))) index += 1;
  if (courtesyPhrase(cleaned) || index >= parts.length || !nameToken(parts[index])) return null;
  const kept = [parts[index]];
  index += 1;
  while (index < parts.length) {
    if (plainName(parts[index]) === plainName(kept[kept.length - 1])) {
      index += 1;
      continue;
    }
    if (NAME_PARTICLE.test(parts[index])) {
      const hold: string[] = [];
      while (index < parts.length && NAME_PARTICLE.test(parts[index])) hold.push(parts[index++]);
      if (index < parts.length && nameToken(parts[index])) {
        kept.push(...hold, parts[index]);
        index += 1;
        continue;
      }
      break;
    }
    if (nameToken(parts[index])) {
      kept.push(parts[index]);
      index += 1;
      continue;
    }
    break;
  }
  return kept.map(showToken).join(" ");
}
function phraseOk(name: string): boolean {
  if (/^all[aá]\s+en\b/i.test(name)) return false;
  return !!namePhrase(name);
}
function restAfter(raw: string, span: string): string {
  const parts = raw.replace(/[.?!,¡¿]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < parts.length && (NAME_SKIP.test(parts[index]) || NAME_PARTICLE.test(parts[index]))) index += 1;
  for (const token of span.split(/\s+/)) {
    if (plainName(parts[index] || "") !== plainName(token)) return parts.slice(index).join(" ");
    index += 1;
  }
  return parts.slice(index).join(" ");
}
function orderTail(rest: string): boolean {
  const said = fold(rest).replace(/^[, ]+/, "");
  return /^(?:y|and|for|para|quiero|quisiera|voy|vamos|me|un|una|unos|unas|dos|tres|cuatro|cinco|six|three|two|one|\d)/.test(said);
}
/** A leading name. Order words may follow a real cue. A cue word or a phrase fragment is not kept. */
function namePhrase(raw: string, allowOrder = false): string | null {
  let text = String(raw || "").replace(/[?¿!¡.]+$/g, "").trim();
  text = text.replace(/,?\s+y\s+es\b.*$/iu, "");
  text = text.replace(/\b(?:por\s+favor|please|gracias|thanks)\b.*$/iu, "").trim();
  if (!text || courtesyPhrase(text)) return null;
  const span = nameSpan(text);
  if (!span) return null;
  const rest = restAfter(text, span);
  if (!rest) return span;
  if (allowOrder && orderTail(rest)) return span;
  return null;
}
function callerTurns(turns: Turn[]): Turn[] {
  return (turns || []).filter((turn) => !turn.speaker || turn.speaker === "caller");
}
function askedForName(turns: Turn[], index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const turn = turns[cursor];
    if (!turn.speaker || turn.speaker === "caller") break;
    if (turn.speaker === "staff" && /[?¿]/.test(turn.text || "") && /\b(?:nombre|apellido|name)\b/i.test(turn.text || "")) return true;
  }
  return false;
}
function leftover(raw: string, span: string): boolean {
  const parts = raw.replace(/[.?!,¡¿]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < parts.length && (NAME_SKIP.test(parts[index]) || NAME_PARTICLE.test(parts[index]))) index += 1;
  for (const token of span.split(/\s+/)) {
    if (plainName(parts[index] || "") !== plainName(token)) return true;
    index += 1;
  }
  return index < parts.length;
}
function nameFromSentence(sentence: string, asked: boolean, later: boolean): string | null {
  if (courtesyPhrase(sentence)) return null;
  const ticket = sentence.match(/\ba nombre de\s+(.+)$/iu);
  if (ticket) return namePhrase(ticket[1], true);
  const self = sentence.match(/\b(?:me llamo|mi nombre es|my name is|this is|it'?s|i am|soy|mi apellido es)\s+(.+)$/iu);
  if (self) return namePhrase(self[1], true);
  const put = sentence.match(/^(?:ponga|ponme|dame)\s+(.+)$/iu);
  if (put) return namePhrase(put[1], false);
  const hello = sentence.match(/^(?:hi|hey|hello|hola|mande|buenas)\s*,?\s+(.+)$/iu);
  if (hello && !/\b(?:this is|it'?s|me llamo|soy)\b/i.test(hello[1])) return namePhrase(hello[1], false);
  const dest = sentence.match(/\b(?:para|for)\s+(.+)$/iu);
  if (dest) {
    const span = namePhrase(dest[1]);
    if (span) return span;
  }
  const questioning = /^[¿¡]/.test(sentence) || /\?\s*$/.test(sentence);
  if (asked || (later && questioning) || /,\s*y\s+es\b/i.test(sentence)) return namePhrase(sentence);
  return null;
}
function spokenName(turns: Turn[]): string | null {
  const all = turns || [];
  let callerSeen = false;
  for (let index = 0; index < all.length; index += 1) {
    const turn = all[index];
    if (turn.speaker && turn.speaker !== "caller") continue;
    const said = String(turn.text || "").trim();
    if (!said) continue;
    const asked = askedForName(all, index);
    const later = callerSeen;
    callerSeen = true;
    for (const sentence of said.split(/(?<=[.!?])\s+/)) {
      const name = nameFromSentence(sentence.trim(), asked, later);
      if (name) return name;
    }
  }
  return null;
}
function spokeFoodOrder(turns: Turn[]): boolean {
  const texts = callerTurns(turns).map((turn) => String(turn.text || ""));
  const food = /\b(?:tacos?|quesadillas?|gorditas?|burritos?|tortas?|quesitortas?|sopes?|fajitas?|platillos?|menudos?|moles?|enchiladas?|horchatas?|coctel|c[oó]ctel|camar[oó]n(?:es)?|ceviche|birrias?|nachos?|huaraches?|tamales?|tostadas?|pozoles?|rellenos?|costillas?|bistec|asada|pastor|chorizo|tripas?|buche|pollo|cabeza|lengua|carnitas|barbacoa)\b/iu;
  const order = /\b(?:me\s+pone|ponme|ponga|quiero|quer[ií]a|dame|deme|ordenar|pedido|encarg|apartar|can i get|i'?ll (?:get|take)|get (?:a|an|the|one|two|three|four)|me puede|poner|una orden)\b/iu;
  const availability = (text: string) => /[?¿]/.test(text) && /\b(?:tienen|tiene|tienes|hay|venden|do you have)\b/iu.test(text) && !order.test(text);
  const ordered = texts.filter((text) => food.test(text) && !availability(text));
  if (texts.some((text) => food.test(text)) && texts.some((text) => order.test(text))) return true;
  if (!ordered.length) return false;
  return ordered.some((text) => /\b(?:un|una|unos|unas|dos|tres|cuatro|cinco|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/iu.test(text));
}
/** Shadow name only. The live name function is not changed. No food ordered means no customer name. */
export function shadowCustomerName(live: { name?: string; group?: string[] } | null, turns: Turn[], ordered = true): string | null {
  if (!ordered && !spokeFoodOrder(turns)) return null;
  const spoken = spokenName(turns);
  const liveText = String(live?.name || "");
  const liveClean = liveText && phraseOk(liveText) ? (nameSpan(liveText) || "") : "";
  const shouted = !!liveClean && (turns || []).some((turn) => turn.speaker === "staff" && new RegExp(`\\boye\\b[,.\\s]+${liveClean.split(/\s+/)[0]}\\b`, "i").test(turn.text || "") && /\b(?:pedido|orden|listo|ya\s+est[aá])/i.test(turn.text || ""))
    && !callerTurns(turns).some((turn) => new RegExp(`\\b${liveClean.split(/\s+/)[0]}\\b`, "i").test(turn.text || ""));
  if (liveClean && !shouted && !onlyAsGreeting(turns, liveClean)) return liveClean;
  if (spoken && !(live?.group && live.group.length >= 2)) return spoken;
  return null;
}

/** True when every time the caller says this word, they are greeting someone. */
function onlyAsGreeting(turns: Turn[], name: string): boolean {
  const head = plainName(name.split(/\s+/)[0] || "");
  if (!head) return false;
  const headRe = new RegExp(`\\b${head}\\b`, "i");
  const all = turns || [];
  let mentions = 0;
  let greetings = 0;
  let firstCaller = true;
  for (let index = 0; index < all.length; index += 1) {
    const turn = all[index];
    if (turn.speaker && turn.speaker !== "caller") continue;
    const said = String(turn.text || "").trim();
    const asked = askedForName(all, index);
    if (!headRe.test(said)) {
      if (said) firstCaller = false;
      continue;
    }
    mentions += 1;
    const sentence = said.split(/(?<=[.!?])\s+/)[0] || said;
    const greetWord = sentence.match(/^(?:hola|hi|hey|hello|mande|buenas)\s*,?\s+(\S+)/i);
    const greeted = !!greetWord && plainName(greetWord[1]) === head;
    const continues = greeted && leftover(sentence.replace(/^(?:hola|hi|hey|hello|mande|buenas)\s*,?\s+/i, ""), name);
    const bareFirst = firstCaller && !asked && !greetWord && said.replace(/[.?!,¡¿]+/g, "").trim().split(/\s+/).length <= 2;
    if ((greeted && continues) || bareFirst) greetings += 1;
    else return false;
    firstCaller = false;
  }
  return mentions > 0 && greetings === mentions;
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
  if (applyIncludedPlatilloTortilla(cart, turns, menu)) changed = true;
  return changed;
}

/** The included 3-tortilla option, not a note alone and not the $4 extra, unless they asked for more. */
function applyIncludedPlatilloTortilla(cart: any[], turns: Turn[], menu: any[]): boolean {
  const wantsExtra = (turns || []).some((turn, index) => {
    const said = fold(turn.text || "");
    const asks = /\btortillas?\b/.test(said) && /\b(?:mas|extra|otras|aparte|additional|more|another)\b/.test(said);
    if (!asks) return false;
    if (!turn.speaker || turn.speaker === "caller") return true;
    const next = (turns || []).slice(index + 1).find((row) => !row.speaker || row.speaker === "caller");
    return !!next && /^(?:si|sip|claro|correcto|yes|yeah|ok|okay)\b/.test(fold(next.text || ""));
  });
  let changed = false;
  for (const line of cart || []) {
    if (!/fajitas-elvis|platillo-de-guisado|mole-tradicional-platillo|chiles-rellenos-platillo/i.test(String(line?.itemId || ""))) continue;
    if (!wantsExtra) {
      const kept = (line.modifiers || []).filter((mod: any) => !/EXTRA\s+3\s+x/i.test(String(mod.option || "")));
      if (kept.length !== (line.modifiers || []).length) {
        line.modifiers = kept;
        changed = true;
      }
    }
    const item = (menu || []).find((row) => row.id === line.itemId);
    const group = (item?.modifierGroups || []).find((entry: any) => /tortilla/i.test(String(entry?.name || "")) && !/extra/i.test(String(entry?.name || "")));
    const noted = (line.elviNotes || []).find((note: string) => /^(?:comal|harina)$/i.test(note));
    if (!group || !noted) continue;
    const want = /harina/i.test(noted) ? /flour|harina/i : /corn/i;
    const has = (line.modifiers || []).some((mod: any) => want.test(String(mod.option || "")) && !/extra/i.test(String(mod.option || "")));
    if (has) continue;
    const name = (group.options || []).map(oname).find((option: string) => want.test(option) && !/extra/i.test(option));
    if (!name) continue;
    putOption(line, { step: group.name, option: name });
    changed = true;
  }
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
