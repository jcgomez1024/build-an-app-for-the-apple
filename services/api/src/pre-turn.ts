/**
 * fix11 (Carlos): runs first on every channel (web resolve, chat, voice).
 *  - Packs: "8 tacos" / "ocho tacos" / "chopack" → the 8 Pack MEAL when a pack of that size exists
 *    (singles only for sueltos / individual / singles, or a count with no pack).
 *  - Chicharrón: Duro (chile verde) vs Prensado (chile rojo). Bare "chicharrón" asks, unless the
 *    dish offers only one of them. The answer replays the caller's sentence with the choice.
 */
import type { MenuItem } from "./menu.js";
import { pinnedMenu } from "./site-catalog.js";
import { rbFormat } from "./readback.js";

const NUM: Record<string, number> = {
  uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10
};
const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUM[w.toLowerCase()] || 0);
const NUM_RE = "(\\d+|uno|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)";
export const PACK_WORD = /\b(packs?|paks?|pacs?|meals?|paquetes?|chopac?k?|ocho\s*pac?k)\b/i;
const SHELL_WORDS = /^(de|del|con|of|with|in|en|comal|homemade|harina|flour|maiz|maíz|corn|taquer[oa]s?|street|y|and)$/i;

export function packSizes(menu: MenuItem[]) {
  const sizes = new Set<number>();
  for (const m of menu) { const k = String(m.name).match(/^(\d+)\s*pack\s+meal\b/i); if (k) sizes.add(Number(k[1])); }
  return sizes;
}

export function packRewrite(text: string, menu: MenuItem[]): string {
  const original = String(text || "");
  // fix12 (Carlos): a pack only when the caller says a pack word; "8 tacos" alone is 8 singles.
  if (!PACK_WORD.test(original)) return original;
  if (/\b(sueltos?|sueltas?|individual(es)?|singles?|separad[oa]s?|by itself)\b/i.test(original)) return original;
  if (/\bcombos?\b/i.test(original)) return original;
  // Pack words as callers / speech-to-text say them → "N tacos …", then rebuilt as "N pack de tacos …" below.
  const NOUNS = "(tacos?|quesadillas?|tortas?|gorditas?)";
  let t = original
    .replace(/\b(?:un\s+|uno\s+)?chopac?k?\b/gi, "8 pack")
    .replace(/\bocho\s*pac?k\b/gi, "8 pack")
    .replace(/\bmeals?\s+packs?\b/gi, "pack").replace(/\bpacks?\s+meals?\b/gi, "pack")
    .replace(/\b(?:un\s+|una\s+|a\s+)?(paquetes?|packs?|meals?)\s+(de\s+|of\s+)?(?=\d|tres|cuatro|cinco|seis|siete|ocho|three|four|five|six|seven|eight)/gi, "")
    .replace(new RegExp(`\\b${NUM_RE}\\s+(paquetes?|packs?|meals?)\\b`, "gi"), (_m, n) => `${num(n)} pack`);
  const packed = t;
  t = t
    .replace(new RegExp(`\\b(\\d+)\\s+pack\\s+(?:de\\s+|of\\s+)?${NOUNS}\\b`, "gi"), (_m, n, noun) => `${n} ${noun}`)
    .replace(/\b(\d+)\s+pack\s+(?:de\s+|of\s+)?/gi, (_m, n) => `${n} tacos de `)
    .replace(/\s+de\s*$/i, "");
  if (/\bpack\b/i.test(t)) return packed;
  // English puts the meat / tortilla first: "eight steak tacos", "8 street tacos".
  const sizes = packSizes(menu);
  t = t.replace(new RegExp(`\\b${NUM_RE}\\s+([a-z]+(?:\\s+[a-z]+)?)\\s+(tacos|quesadillas|tortas|gorditas)\\b`, "i"), (all, c, mid, noun) =>
    !sizes.has(num(c)) || /^(de|of|the|more|extra|small|big)$/i.test(mid) ? all : `${c} ${noun} ${/^(comal|homemade|harina|flour|corn|street)$/i.test(mid) ? mid : `de ${mid}`}`);
  const re = new RegExp(`\\b${NUM_RE}\\s+(tacos?|quesadillas?|tortas?|gorditas?)(\\s+meals?)?\\b`, "i");
  const m = re.exec(t);
  if (!m) return packed;
  const n = num(m[1]);
  if (!sizes.has(n)) return packed;
  const after = t.slice(m.index + m[0].length);
  // "8 tacos, 4 pastor 4 asada" is one pack; "4 tacos de pastor y 4 de asada" is two orders.
  const countRe = new RegExp(`\\b${NUM_RE}\\b`, "gi");
  const counts = [...after.matchAll(countRe)];
  if (counts.length) {
    const sum = counts.reduce((s, c) => s + num(c[1]), 0);
    const between = after.slice(0, counts[0].index).replace(/[^a-záéíóúñ ]/gi, " ").split(/\s+/).filter(Boolean);
    // Partial counts ("8 tacos 4 pastor") stay with the order context, which turns them into the pack at the end.
    if (sum !== n || between.some((w) => !SHELL_WORDS.test(w))) return packed;
  }
  const noun = m[2].toLowerCase().replace(/s?$/, "s");
  // Same silent tortilla default as single tacos (Comal) unless the caller names another one.
  const shell = /\b(comal|homemade|harina|flour|ma[ií]z|corn|taquer[oa]s?|street)\b/i.test(t) || !/^(tacos|quesadillas)$/.test(noun) ? "" : " de comal";
  // One meat for the whole pack ("8 tacos de pastor") → "todos de pastor".
  let rest = after;
  if (!counts.length && !/\b(y|and|con|with)\b|,/i.test(after) && !/\b(todos|todas|all)\b/i.test(after)) {
    rest = after.replace(/\b(de|of)\s+(?!(comal|homemade|harina|flour|ma[ií]z|corn|taquer[oa]s?|street)\b)(?=[a-záéíóúñ])/i, "todos de ");
    if (rest === after && /^\s+[a-záéíóúñ]/i.test(after) && !/^\s+(de|of|para|for|por|please|porfa|comal|homemade|harina|flour|corn|street|taquer[oa]s?)\b/i.test(after)) rest = ` todos de${after}`;
  }
  return `${t.slice(0, m.index)}${n} pack de ${noun}${shell}${rest}`;
}

// ---- Chicharrón ----------------------------------------------------------
const BARE = /\bchicharr[oó]n(es)?\b/i;
const BARE_G = /\bchicharr[oó]n(es)?\b/gi;
const pending = new Map<string, { text: string; at: number }>();

/** Qualified chicharrón → the Square option words ("pork rinds" = Duro, "spicy pork" = Prensado). */
export function normalizeChicharron(text: string) {
  return String(text || "")
    .replace(/\bchicharr[oó]n(es)?\s+(del\s+|de\s+)?duros?\b/gi, "pork rinds")
    .replace(/\bchicharr[oó]n(es)?\s+(en\s+)?(chile\s+)?verdes?\b/gi, "pork rinds")
    .replace(/\bchicharr[oó]n(es)?\s+prensados?\b/gi, "prensado")
    .replace(/\bchicharr[oó]n(es)?\s+(en\s+)?(chile\s+)?roj[oa]s?\b/gi, "prensado")
    .replace(/\bdel\s+duro\b/gi, "de pork rinds")
    .replace(/\bprensados\b/gi, "prensado");
}

const optionNames = (m: MenuItem) => (m.modifierGroups || []).flatMap((g: any) => (g.options || []).map((o: any) => String(typeof o === "string" ? o : o.name)));

export function answerPick(text: string): "pork rinds" | "prensado" | null {
  const t = text.toLowerCase();
  if (/\b(duros?|verdes?|pork rinds?|rinds)\b/.test(t)) return "pork rinds";
  if (/\b(prensados?|roj[oa]s?|spicy|red)\b/.test(t)) return "prensado";
  if (/\bgreen\b/.test(t)) return "pork rinds";
  return null;
}

export function chicharronTurn(key: string | undefined, text: string, menu: MenuItem[], language: string): { reply?: string; text?: string; replayed?: boolean } | null {
  const k = key || "_anon";
  const es = language === "es";
  const p = pending.get(k);
  if (p && Date.now() - p.at < 15 * 60 * 1000) {
    pending.delete(k);
    const pick = answerPick(text);
    if (pick) return { text: p.text.replace(BARE_G, pick), replayed: true };
  }
  const t = normalizeChicharron(text);
  if (!BARE.test(t)) return t !== text ? { text: t } : null;
  // A dish that offers only one of them gets it without asking.
  const pinned = pinnedMenu(t, menu).filter((m) => optionNames(m).some((o) => /duro|prensado/i.test(o)));
  if (pinned.length && pinned.length < menu.length / 2) {
    const offers = pinned.map((m) => ({ d: optionNames(m).some((o) => /duro/i.test(o)), p: optionNames(m).some((o) => /prensado/i.test(o)) }));
    if (offers.every((o) => o.p && !o.d)) return { text: t.replace(BARE_G, "prensado") };
    if (offers.every((o) => o.d && !o.p)) return { text: t.replace(BARE_G, "pork rinds") };
  }
  pending.set(k, { text: t, at: Date.now() });
  return { reply: es ? "¿Chicharrón del duro en chile verde o prensado en chile rojo?" : "Chicharrón: duro (pork rinds in green chile) or prensado (spicy pork in red chile)?" };
}

/** Both rules for one turn. reply → say it and stop; text → use this text for the turn. */
const pendingTaquero = new Map<string, { n: number; at: number }>();
const pendingPack = new Map<string, { text: string; at: number }>();

const pendingEnchiladas = new Map<string, { rest: string; at: number }>();

export function preTurn(key: string | undefined, text: string, menu: MenuItem[], language: string, opts: { hasComboState?: boolean } = {}): { reply?: string; text: string; replayed?: boolean; adds?: SplitAdd[] } {
  // fix23: kitchen shorthand + STT — campechana = bistec+chorizo; "o mal"/"omal" = comal.
  text = String(text || "").replace(/\bcampechanas?\b/giu, "bistec y chorizo").replace(/\b(?:o\s*mal|omal)\b/giu, "comal");
  // fix23: milanesas not on the Square/site menu — don't invent another platillo.
  if (/\bmilanesas?\b/iu.test(text) && !(menu || []).some((m) => /milanesa/i.test(String(m.name || "") + String(m.id || "")))) {
    const es = language !== "en";
    return { reply: es ? "No tenemos milanesas. ¿Le ofrezco otra cosa: tacos, tortas, quesadillas…?" : "We don't have milanesas. Anything else — tacos, tortas, quesadillas…?", text };
  }
  // fix12: the answer to a pack's meat question on chat/voice ("todos de asada") goes back to that pack.
  const pk = key || "_anon";
  const pp = pendingPack.get(pk);
  pendingPack.delete(pk);
  if (pp && !opts.hasComboState && Date.now() - pp.at < 10 * 60 * 1000 && !PACK_WORD.test(text) && !/\b(tacos?|quesadillas?|tortas?|gorditas?|combos?)\b/i.test(text)) {
    const pinned = pinnedMenu(text, menu);
    const countsOrAll = /\b(todos|todas|all|\d+|dos|tres|cuatro|cinco|seis|siete|ocho)\b/i.test(text);
    if (countsOrAll || (pinned.length > menu.length / 2 && /\b(de|of)\b/i.test(text))) {
      return { text: `${pp.text} ${/^\s*(todos|todas|all)\b/i.test(text) ? "" : "con "}${text}`.replace(/\s+/g, " ").trim(), replayed: true };
    }
  }
  // fix15: "taquitos" = small street tacos (Taco Taquero); counts are pieces.
  text = text.replace(/\btaquitos?\b/gi, (w) => (/s$/i.test(w) ? "tacos taqueros" : "taco taquero"));
  // fix15: "3 taquitos" with no meat → ask the meat for those street tacos; the answer completes them.
  {
    const k = key || "_anon";
    const tq = plainText(text).replace(/[.!?¡¿]/g, " ").replace(/\s+/g, " ").trim().match(new RegExp(`^(quiero |dame |me da |i want |i'd like )?${NUM_RE} tacos taqueros( please| por favor)?$`));
    const ptq = pendingTaquero.get(k);
    pendingTaquero.delete(k);
    if (tq) {
      const n = num(tq[2]);
      pendingTaquero.set(k, { n, at: Date.now() });
      const a = Math.ceil(n / 2), b = n - a;
      const mix = n > 1 ? (language === "es" ? ` Puedes mezclar, por ejemplo ${a} pastor y ${b} asada.` : ` You can mix, for example ${a} al pastor and ${b} steak.`) : "";
      return { text, reply: language === "es" ? `¿De qué carne ${n > 1 ? `los ${n} tacos taqueros` : "el taco taquero"}?${mix}` : `What meat for the ${n > 1 ? `${n} street tacos` : "street taco"}?${mix}` };
    }
    if (ptq && Date.now() - ptq.at < 10 * 60 * 1000 && !/\b(tacos?|quesadillas?|burritos?|tortas?|gorditas?|combos?|packs?|paquetes?)\b/i.test(text)) {
      const t2 = plainText(text).replace(/[.!?¡¿]/g, " ").replace(/\s+/g, " ").trim();
      const counts = [...t2.matchAll(new RegExp(`\\b${NUM_RE}\\s+(?:de\\s+)?([a-z]+(?: [a-z]+)?)`, "g"))];
      if (counts.length > 1) text = counts.map((m) => `${num(m[1])} ${num(m[1]) > 1 ? "tacos taqueros" : "taco taquero"} de ${m[2].replace(/\s+(y|and)$/, "")}`).join(" y ");
      else text = `${ptq.n} ${ptq.n > 1 ? "tacos taqueros" : "taco taquero"} de ${t2.replace(/^(todos |todas |all |de |of )+/, "")}`;
    }
  }
  // fix19: the website sells Enchiladas only as an order of 6 ($14.99). A count of enchiladas is pieces:
  // 6 → 1 order, 12 → 2 orders; any other count asks how many orders. "2 órdenes de enchiladas" stays as is.
  {
    const k = key || "_anon";
    const pe = pendingEnchiladas.get(k);
    pendingEnchiladas.delete(k);
    const t2 = plainText(text).replace(/[.!?¡¿,]/g, " ").replace(/\s+/g, " ").trim();
    if (pe && Date.now() - pe.at < 10 * 60 * 1000 && !/\benchiladas?\b/.test(t2)) {
      const m = t2.match(/^(?:(?:si|yes|ok|okay)\s+)?(?:(\d+|una?|uno|one|a|dos|two|tres|three|cuatro|four|cinco|five)\s*(?:orden(?:es)?|orders?)?|(?:si|yes|ok|okay|esta bien|that'?s fine))(?:\s+(?:por favor|please))?$/);
      if (m) {
        const n = m[1] ? (/^(una?|uno|one|a)$/.test(m[1]) ? 1 : num(m[1])) : 1;
        if (n >= 1) { text = `${n} ${n > 1 ? "ordenes" : "orden"} de enchiladas ${pe.rest}`.replace(/\s+/g, " ").trim(); return { text, replayed: true }; }
      }
    }
    const em = t2.match(new RegExp(`(?<!\\borden(?:es)?\\s+de\\s+)(?<!\\borders?\\s+of\\s+)\\b(${NUM_RE.slice(1, -1)}|doce|twelve)\\s+enchiladas?\\b(.*)$`));
    if (em) {
      const n = /^(doce|twelve)$/.test(em[1]) ? 12 : num(em[1]);
      const rest = em[2].trim();
      if (n > 0 && n % 6 === 0) {
        const orders = n / 6;
        text = `${orders} ${orders > 1 ? "ordenes" : "orden"} de enchiladas ${rest}`.replace(/\s+/g, " ").trim();
      } else if (n > 0) {
        pendingEnchiladas.set(k, { rest, at: Date.now() });
        const it: any = menu.find((m: any) => /enchiladas/i.test(String(m.name || "")) && /\(6\)|-6-/i.test(String(m.id || "") + String(m.readbackName || "")));
        const price = it?.priceCents ? ` ($${(it.priceCents / 100).toFixed(2)})` : "";
        return { text, reply: language === "es"
          ? `Las enchiladas vienen en orden de 6${price}. ¿Una orden, o cuántas órdenes?`
          : `Enchiladas come as an order of 6${price}. One order, or how many orders?` };
      }
    }
  }
  // fix13: vague orders get one question; the answer completes the pending item.
  const vg = vagueTurn(key, stripSomethingElse(text), menu, language);
  if (vg?.reply) return { reply: vg.reply, text };
  if (vg?.text) text = vg.text;
  else text = stripSomethingElse(text);
  const ch = chicharronTurn(key, text, menu, language);
  if (ch?.reply) return { reply: ch.reply, text };
  // fix12: "Ocho tacos" → "8 tacos" so every resolver keeps the count.
  const base = (ch?.text ?? text).replace(/\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|seven|eight|nine|ten)\s+(?=(tacos|quesadillas|gorditas|tortas|burritos|sopes|tamales|tostadas|enchiladas|elotes|esquites)\b)/gi, (w) => `${num(w.trim())} `);
  const split = splitSinglesTurn(base, menu, language);
  if (split) return { reply: split.reply, text: base, adds: split.adds };
  const out = packRewrite(base, menu);
  if (/\b\d+\s*pack\b/i.test(out) && !/\b(todos|todas|all)\b/i.test(out) && !new RegExp(`\\b${NUM_RE}\\b[^]*\\b${NUM_RE}\\b[^]*\\b${NUM_RE}\\b`, "i").test(out)) pendingPack.set(pk, { text: out, at: Date.now() });
  return { text: out, replayed: ch?.replayed || Boolean(vg?.text) };
}

// ---- Singles with different tortillas per line (fix12) --------------------
// "8 tacos, 4 de pastor de harina y 4 de asada street" / "4 tacos, 2 de comal y 2 street, todos de pastor".
const plainText = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const SHELL_KIND: Array<[RegExp, RegExp]> = [
  [/\b(comal|homemade|hechas? a mano)\b/, /comal/i],
  [/\b(harina|flour)\b/, /harina/i],
  [/\b(street|taquer[oa]s?|de maiz|corn)\b/, /taquer/i]
];
const MEAT_EXTRA: Record<string, RegExp> = { alpastor: /\b(al ?pastor|pastor)\b/, bistec: /\b(asada|carne asada|steak|campechana)\b/, chorizo: /\b(chorizo|campechana)\b/, tripa: /\b(tripas?|tepa|tipa|trepa|tripe|beef tripe)\b/, tripas: /\b(tripas?|tepa|tipa|trepa|tripe|beef tripe)\b/, duro: /\bpork rinds?\b/, prensado: /\bspicy pork\b/ };

export type SplitAdd = { itemId: string; quantity: number; modifiers: Array<{ groupId: string; groupName: string; option: string; optionId?: string; priceDeltaCents: number }> };

export function splitSinglesTurn(text: string, menu: MenuItem[], language: string): { reply: string; adds: SplitAdd[] } | null {
  const t = plainText(text);
  if (PACK_WORD.test(t) || /\bcombos?\b/.test(t)) return null;
  const nounM = t.match(/\b(tacos?|quesadillas?)\b/);
  if (!nounM) return null;
  const item = menu.find((m) => plainText(m.name) === nounM[1].replace(/s$/, ""));
  if (!item) return null;
  const groups: any[] = item.modifierGroups || [];
  const shellG = groups.find((g) => /tortilla/i.test(g.name));
  const meatG = groups.find((g) => /carne|meat/i.test(g.name) && !/extra/i.test(g.name));
  if (!shellG || !meatG) return null;
  const opts = (g: any) => (g.options || []).map((o: any) => (typeof o === "string" ? { name: o } : o));
  const findShell = (seg: string) => { for (const [w, o] of SHELL_KIND) if (w.test(seg)) return opts(shellG).find((x: any) => o.test(x.name)); return null; };
  const findMeat = (seg: string) => {
    let best: any = null; let len = 0;
    for (const o of opts(meatG)) {
      const base = plainText(String(o.name).replace(/\s*\(\+?\$[\d.]+\)/, ""));
      const names = base.split(" / ").map((x) => x.trim()).filter((x) => x.length > 2);
      for (const n of names) if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(seg) && n.length > len) { best = o; len = n.length; }
      const key = names[0]?.split(" ")[0];
      if (key && MEAT_EXTRA[key]?.test(seg) && Math.max(len, 1) >= len) { if (!best || len <= 1) { best = o; len = Math.max(len, 4); } }
    }
    // Also try every MEAT_EXTRA key (tripa STT aliases) even when the option's first token differs.
    if (!best) {
      for (const o of opts(meatG)) {
        const key = plainText(String(o.name).split(" / ")[0]).split(" ")[0]?.replace(/s$/, "");
        const re = MEAT_EXTRA[key] || MEAT_EXTRA[key + "s"];
        if (re?.test(seg)) { best = o; break; }
      }
    }
    return best;
  };
  // fix21: "otra/otro/another" counts as 1 in "una de chorizo, una de tepa y otra de buche".
  const oneEach = (s: string) => /\b(una?|uno|otra?|otro|another|one)\s+de\b/.test(s) ? 1 : 0;
  const unknownMeatWord = (seg: string) => {
    const m = seg.match(/\b(?:una?|uno|otra?|otro|another|one|\d+)\s+de\s+([\p{L}'’-]+)/u);
    return m && !findMeat(seg) ? m[1] : null;
  };
  const numRe = new RegExp(`\\b${NUM_RE}\\b`);
  const segs = t.split(/,|;|:|\s(?:y|and|plus|mas)\s/).map((s) => s.trim()).filter(Boolean);
  let lines = segs.map((s) => ({ s, n: num(s.match(numRe)?.[1] || "") || oneEach(s), shell: findShell(s), meat: findMeat(s), unknown: unknownMeatWord(s) as string | null }));
  let global = lines.filter((l) => !l.n);
  let counted = lines.filter((l) => l.n);
  // "8 tacos, 4 … y 4 …": the first count is the total.
  if (counted.length >= 3 && counted[0].n === counted.slice(1).reduce((x, l) => x + l.n, 0) && !counted.slice(1).every((l) => oneEach(l.s))) { global = [...global, counted[0]]; counted = counted.slice(1); }
  // fix21: "tres quesadillas de comal, una de A, una de B y otra de C" — total on first line, one-each after.
  if (counted.length >= 2 && counted[0].n >= 2 && counted.slice(1).every((l) => oneEach(l.s)) && counted[0].n === counted.slice(1).reduce((x, l) => x + l.n, 0)) {
    global = [...global, counted[0]];
    counted = counted.slice(1);
  }
  if (counted.length < 2) return null;
  const gShell = global.map((l) => l.shell).find(Boolean);
  const gMeat = global.map((l) => l.meat).find(Boolean);
  const shells = new Set(counted.map((l) => (l.shell || gShell)?.name || "default"));
  // fix15: same tortilla but a meat on every count ("2 de pastor y 2 de asada") is also split here (keeps the counts).
  // fix21: allow unknown meats (still keep the line) when every counted slot has a meat word or a recognized meat.
  const everySlot = counted.every((l) => l.meat || l.unknown || gMeat);
  if (shells.size < 2 && !counted.every((l) => l.meat) && !everySlot) return null;
  if (shells.size < 2 && !counted.every((l) => l.meat || l.unknown)) return null;
  const def = opts(shellG).find((o: any) => (shellG.defaultOptions || []).includes(o.name)) || opts(shellG).find((o: any) => /comal/i.test(o.name));
  const adds: SplitAdd[] = [];
  const asks: string[] = [];
  const es = language === "es";
  for (const l of counted) {
    const meat = l.meat || gMeat;
    const shell = l.shell || gShell || def;
    if (!shell) return null;
    const mod = (g: any, o: any) => ({ groupId: g.id, groupName: g.name, option: o.name, optionId: o.id, priceDeltaCents: o.priceDeltaCents || 0 });
    if (!meat && l.unknown) {
      // Keep the item; flag the unknown meat so live Elvi asks and the shadow log shows it.
      asks.push(l.unknown);
      adds.push({ itemId: item.id, quantity: l.n, modifiers: [mod(shellG, shell)], unknownMeat: l.unknown } as any);
      continue;
    }
    if (!meat) return null;
    adds.push({ itemId: item.id, quantity: l.n, modifiers: [mod(shellG, shell), mod(meatG, meat)] });
  }
  // Stated total (global count) must equal sum of lines — pad was already enforced by the slice rule above.
  const stated = global.map((l) => l.n).find((n) => n >= 2);
  const sum = adds.reduce((x, a) => x + a.quantity, 0);
  if (stated && stated !== sum) {
    // Do not silently drop: if we have fewer lines than stated, leave remaining as ask-only slots.
    for (let i = sum; i < stated; i++) {
      asks.push("?");
      const shell = gShell || def;
      if (!shell) break;
      const mod = (g: any, o: any) => ({ groupId: g.id, groupName: g.name, option: o.name, optionId: o.id, priceDeltaCents: o.priceDeltaCents || 0 });
      adds.push({ itemId: item.id, quantity: 1, modifiers: [mod(shellG, shell)], unknownMeat: "?" } as any);
    }
  }
  let reply = rbFormat(adds.filter((a) => !(a as any).unknownMeat).map((a) => ({ name: item.name, quantity: a.quantity, mods: a.modifiers.map((m) => ({ option: m.option, group: m.groupName })), cents: ((item.priceCents || 0) + a.modifiers.reduce((x, m) => x + m.priceDeltaCents, 0)) * a.quantity })), language);
  if (asks.length) {
    const uniq = [...new Set(asks.filter((a) => a && a !== "?"))];
    const ask = uniq.length
      ? (es ? `No alcanzaré a oír bien «${uniq.join("» / «")}». ¿Qué carne era?` : `I didn't catch “${uniq.join("” / “")}”. Which meat was that?`)
      : (es ? "¿Qué carne lleva la que falta?" : "Which meat for the remaining one?");
    reply = reply ? `${reply} ${ask}` : ask;
  }
  return { reply, adds, asks } as any;
}

// ---- Vague orders: one clear question, the answer completes it (fix13) -----
type Vague = { kind: "pack" | "combo" | "dish" | "orden" | "dorados"; n?: number; noun?: string; rest?: string; at: number; tries?: number };
const pendingVague = new Map<string, Vague>();
const PACK_KINDS = ["tacos", "quesadillas", "tortas", "gorditas"];
const NOUN_RE = /\b(tacos?|quesadillas?|tortas?|gorditas?)\b/i;
const plural = (w: string) => w.toLowerCase().replace(/s?$/, "s");

function packKinds(menu: MenuItem[], n?: number) {
  const have = new Set<string>();
  for (const m of menu) {
    const k = String(m.name).match(/^(\d+)\s*pack\s+meal\b/i);
    if (!k || (n && Number(k[1]) !== n)) continue;
    const kind = String(m.readbackName || m.id).replace(/^\s*\d+\s*x\s+/i, "").toLowerCase().match(/^(tacos|quesadillas|tortas|gorditas)\b/)?.[1]
      || String(m.id).toLowerCase().match(/-(tacos|quesadillas|tortas|gorditas)-/)?.[1];
    if (kind) have.add(kind);
  }
  const list = PACK_KINDS.filter((k) => have.has(k));
  return list.length ? list : PACK_KINDS;
}
const orList = (l: string[], or: string) => (l.length > 1 ? `${l.slice(0, -1).join(", ")}${or}${l[l.length - 1]}` : l[0]);
const EN_KIND: Record<string, string> = { tacos: "tacos", quesadillas: "quesadillas", tortas: "tortas", gorditas: "gorditas" };

function askPack(v: Vague, menu: MenuItem[], es: boolean) {
  if (!v.noun) {
    const kinds = packKinds(menu, v.n);
    return es ? `¿De ${orList(kinds, " o ")}?` : `${orList(kinds.map((k) => EN_KIND[k]), " or ").replace(/^./, (c) => c.toUpperCase())}?`;
  }
  const sizes = [...packSizes(menu)].sort((a, b) => a - b);
  return es ? `¿De cuánt${/quesadillas|tortas|gorditas/.test(v.noun) ? "as" : "os"} ${v.noun}? Hay de ${sizes[0]} a ${sizes[sizes.length - 1]}.` : `How many ${v.noun}? We have ${sizes[0]} to ${sizes[sizes.length - 1]}.`;
}

/** Returns a question to ask, or the completed text to run, or null (not vague / not an answer). */
function doradosMeats(menu: MenuItem[]) {
  const item = menu.find((m) => /^tacos dorados\b/i.test(String(m.name)));
  const groups: any[] = (item?.modifierGroups as any[]) || [];
  const g = groups.find((x) => /carne|meat|prote/i.test(String(x.name))) || groups[0];
  return ((g?.options || []) as any[]).map((o) => String(typeof o === "string" ? o : o.name).split(" / ")[0].replace(/\s*\(.*?\)\s*/g, " ").trim()).filter(Boolean);
}

export function vagueTurn(key: string | undefined, text: string, menu: MenuItem[], language: string): { reply?: string; text?: string } | null {
  const k = key || "_anon";
  const es = language === "es";
  const t = plainText(text).replace(/[.!?¡¿]/g, " ").replace(/\s+/g, " ").trim();
  // fix14/15: no flautas on the menu: say so, offer tacos dorados (meat on top, like nachos).
  // With the meat already said ("flautas de pollo") offer it; otherwise ask the meat. Counts are not orders.
  const fl = t.match(/\bflautas?\b/);
  if (fl) {
    pendingVague.delete(k);
    const nM = t.match(new RegExp(`\\b${NUM_RE}\\s+(ordenes|orders?|orden)\\b`));
    const meat = t.replace(nM ? nM[0] : "\u0000", "").replace(new RegExp(`\\b(${NUM_RE}|flautas?|quiero|dame|me da|i want|i'd like|una?|an?|some|unas?|orden(es)?|orders?( of)?|de|of|con|with|please|por favor|y|and)\\b`, "g"), " ").replace(/\s+/g, " ").trim();
    const hasMeat = meat && meat.split(" ").length <= 3;
    pendingVague.set(k, { kind: "dorados", n: nM ? num(nM[1]) : undefined, rest: hasMeat ? meat : undefined, at: Date.now() });
    const intro = es ? "No tenemos flautas, pero sí tenemos tacos dorados: la carne va encima de la tortilla dorada, como nachos." : "We don't have flautas, but we do have tacos dorados: the meat goes on top of a crispy shell, like nachos.";
    if (hasMeat) return { reply: es ? `${intro} ¿Te agrego tacos dorados de ${meat}?` : `${intro} Should I add tacos dorados with ${meat}?` };
    const ex = es ? ["pastor", "asada", "carnitas", "pollo"] : ["al pastor", "steak", "carnitas", "chicken"];
    const list = doradosMeats(menu).length ? ` ${es ? "Por ejemplo" : "For example"} ${orList(ex, es ? " o " : " or ")}.` : "";
    return { reply: `${intro} ${es ? "¿De qué carne?" : "What meat?"}${list}` };
  }
  const p = pendingVague.get(k);
  if (p && Date.now() - p.at < 10 * 60 * 1000) {
    if (p.kind === "dorados") {
      pendingVague.delete(k);
      const pm = pinnedMenu(text, menu);
      const other = pm.length && pm.length < menu.length / 2 && !pm.some((m) => /dorad/i.test(m.name));
      if (/^(no|nah|no gracias|no thanks)\b/.test(t)) return { reply: es ? "Está bien. ¿Algo más?" : "OK. Anything else?" };
      if (p.rest && /^(si|yes|ok|okay|claro|dale|sure|yeah|yep|esta bien|por favor|please|agregalos?|add (it|them))\b/.test(t)) return { text: `${p.n || 1} ${(p.n || 1) > 1 ? "tacos dorados" : "taco dorado"} de ${p.rest}` };
      if (!other && t) {
        const nM = t.match(new RegExp(`\\b${NUM_RE}\\s+(ordenes|orders?|orden)\\b`));
        const n = nM ? num(nM[1]) : p.n || 1;
        const meat = t.replace(nM ? nM[0] : "\u0000", "").replace(new RegExp(`^\\s*${NUM_RE}\\b`), "").replace(/\b(tacos? dorados?|de|of|con|with|el|la|los|please|por favor)\b/g, " ").replace(/\s+/g, " ").trim();
        return { text: `${n} ${n > 1 ? "tacos dorados" : "taco dorado"}${meat ? ` de ${meat}` : ""}` };
      }
    }
    pendingVague.delete(k);
    const pinnedOther = (() => { const pm = pinnedMenu(text, menu); return pm.length && pm.length < menu.length / 2 && !NOUN_RE.test(t); })();
    if (p.kind === "pack" && !pinnedOther) {
      const noun = p.noun || (t.match(NOUN_RE)?.[1] ? plural(t.match(NOUN_RE)![1]) : undefined);
      const allN = [...t.matchAll(new RegExp(`\\b${NUM_RE}\\b`, "g"))];
      const nM = allN.length === 1 ? allN[0] : null;
      // "tres de pastor y tres de asada" with no size yet → a pack of 6.
      const sumN = allN.length > 1 ? allN.reduce((x, m) => x + num(m[1]), 0) : 0;
      const n = p.n || (sumN && packSizes(menu).has(sumN) ? sumN : nM ? num(nM[1]) : undefined);
      const rest = `${p.rest || ""} ${t.replace(NOUN_RE, "").replace(/^\s*(de|of)\b/, "").replace(n && !p.n && nM ? nM[0] : "\u0000", "")}`.replace(/\s+/g, " ").trim();
      if ((noun && !p.noun) || (n && !p.n)) {
        const v: Vague = { kind: "pack", n, noun, rest, at: Date.now() };
        if (n && noun) return { text: `${n} pack de ${noun}${rest ? ` ${rest}` : ""}` };
        pendingVague.set(k, v);
        return { reply: askPack(v, menu, es) };
      }
      // Nothing usable ("the says"): ask the same question again, keeping what we have.
      if ((p.tries || 0) < 2) { pendingVague.set(k, { ...p, tries: (p.tries || 0) + 1, at: Date.now() }); return { reply: askPack(p, menu, es) }; }
    }
    if (p.kind === "combo" && !/\bcombo/.test(t)) {
      const m = t.match(/\b(tacos?|quesadillas?|burritos?|mix|mixto|gorditas?|tortas?)\b/);
      if (m) return { text: `combo de ${m[1].startsWith("mix") ? "mix" : plural(m[1])} ${t.replace(m[0], "").replace(/^\s*(de|el|la|un|una)\s+/, "")}`.trim() };
    }
    if (p.kind === "dish" && !pinnedOther) {
      const nM = t.match(new RegExp(`\\b${NUM_RE}\\b`));
      if (nM || /\b(de|of|con)\b/.test(t) || t.split(" ").length <= 3) {
        const n = nM ? num(nM[1]) : 1;
        const rest = t.replace(nM ? nM[0] : "\u0000", "").replace(NOUN_RE, "").replace(/^\s*(de|of)\s+/, "").trim();
        return { text: `${n} ${n > 1 ? p.noun : String(p.noun).replace(/s$/, "")}${rest ? ` de ${rest}` : ""}` };
      }
    }
    if (p.kind === "orden" && t && !/\borden\b/.test(t)) return { text: `una orden de ${t.replace(/^\s*(de|of)\s+/, "")}` };
  }
  // Bare pack: "8 meal pack", "un paquete", "a pack" (no tacos/quesadillas/tortas/gorditas).
  const residual = t.replace(new RegExp(`\\b(${NUM_RE}|un|una|uno|a|an|one|the|de|of|el|quiero|dame|me da|i want|i'd like|please|por favor|packs?|paks?|pacs?|meals?|paquetes?|chopac?k?|ocho)\\b`, "g"), "").trim();
  if (PACK_WORD.test(t) && !NOUN_RE.test(t) && !/\bcombo/.test(t) && !residual) {
    const nM = t.replace(/\bchopac?k?\b/, "8 pack").replace(/\bocho\s*pac?k\b/, "8 pack").match(new RegExp(`\\b${NUM_RE}\\b`));
    const n = nM ? num(nM[1]) : (/chopac|ocho/.test(t) ? 8 : undefined);
    const v: Vague = { kind: "pack", n: n && packSizes(menu).has(n) ? n : undefined, at: Date.now() };
    pendingVague.set(k, v);
    return { reply: askPack(v, menu, es) };
  }
  // Bare combo.
  if (/^(un |a |one |quiero un |dame un |i want a )?combos?( please| por favor)?$/.test(t)) {
    pendingVague.set(k, { kind: "combo", at: Date.now() });
    return { reply: es ? "¿Qué combo: tacos, quesadillas, burrito, mix, gorditas o tortas?" : "Which combo: tacos, quesadillas, burrito, mix, gorditas or tortas?" };
  }
  // Plural dish with no count and nothing else: "tacos", "quiero tacos".
  const dm = t.match(/^(quiero |dame |me da |i want |i'd like |some |unos |unas )?(tacos|quesadillas|gorditas|tortas|burritos)( please| por favor)?$/);
  if (dm) {
    pendingVague.set(k, { kind: "dish", noun: dm[2], at: Date.now() });
    const ex = es ? `por ejemplo 3 de pastor` : `for example 3 al pastor`;
    return { reply: es ? `¿Cuánt${/quesadillas|gorditas|tortas/.test(dm[2]) ? "as" : "os"} ${dm[2]} y de qué carne? Puedes decir ${ex}.` : `How many ${dm[2]}, and what meat? You can say ${ex}.` };
  }
  // "una orden" / "an order".
  if (/^(quiero |dame )?(una|an|one) (orden|order)( please| por favor)?$/.test(t)) {
    pendingVague.set(k, { kind: "orden", at: Date.now() });
    return { reply: es ? "¿Una orden de qué? Por ejemplo enchiladas, tacos dorados o tacos al vapor." : "An order of what? For example enchiladas, tacos dorados or steamed tacos." };
  }
  return null;
}

/** "un burrito y algo" → the burrito now; "¿algo más?" comes after it anyway. */
export function stripSomethingElse(text: string) {
  return String(text || "").replace(/\s*(,|\by\b|\band\b)\s*(algo( mas| más)?|otra cosa|something( else)?|algo de tomar)\s*$/i, "").trim();
}
