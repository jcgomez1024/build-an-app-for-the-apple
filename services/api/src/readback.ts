/**
 * Short read-backs (Carlos, fix10) — the same rules on web, chat and voice:
 * short spoken labels in the customer's language, no codes, no "Pack MEAL 8 x", no bilingual pairs;
 * meats (counted) plus the other choices, without the plain "Regular" deluxe default.
 *   "Combo de tacos: comal, pastor y bistec, arroz y frijoles. $11.99. ¿Algo más?"
 *   "8 tacos de comal: 4 pastor, 4 bistec. $31.99. ¿Algo más?"
 * apps/web/app.js carries a copy of this file's functions (search "fix10 read-back").
 */
import { i18n as I18N } from "./opt-i18n.js";
const KIND_EN: any = { comal: "comal", harina: "flour", taquero: "street", taquera: "street", homemade: "comal" };

export function rbCleanOption(option: any) {
  return String(option || "")
    .replace(/\s*\(\+?\$[\d.]+\)/g, "")
    .replace(/\*+/g, "")
    .replace(/^\s*\([A-Za-z]{1,4}\)\s*/, "")
    .replace(/^\s*\d+\s*x\s+/i, "")
    .replace(/^\s*\([A-Za-z]{1,4}\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function rbOptionLabel(option: any, group: any, lang: any) {
  const es = lang === "es";
  const raw = rbCleanOption(option);
  const low = raw.toLowerCase();
  const g = String(group || "").toLowerCase();
  if (/deluxe/.test(g) && /^regular\b/.test(low)) return "";
  // fix16: included salsa — "salsa asada" / "mild asada salsa" (DOUBLE add-ons keep their name).
  { const sm = /salsa/.test(g) ? raw.match(/^(mild|medium|hot)\s+salsa\s+(.+)$/i) : null; if (sm) return es ? `salsa ${sm[2].toLowerCase()}` : `${sm[1].toLowerCase()} ${sm[2].toLowerCase()} salsa`; }
  if (/(arroz|rice).*(frijol|beans)/.test(low) && !/^solo|^only|grande/.test(low)) return es ? "arroz y frijoles" : "rice and beans";
  if (/^solo arroz|only rice/.test(low)) return es ? "solo arroz" : "rice only";
  if (/^solo frijol|only beans/.test(low)) return es ? "solo frijoles" : "beans only";
  if (/grande\s*'?\s*12/.test(low)) return es ? "grande" : "large";
  if (/(regular|elvis)\s*'?\s*10/.test(low)) return es ? "chico" : "small";
  const parts = raw.split(" / ");
  let label = (/^(no|sin)\b/i.test(raw) ? parts[0] : es ? parts[0] : (parts[1] || parts[0])).trim();
  // ui3: "DOUBLE Crema / Sour Cream" → "double sour cream" in English too.
  if (!es && /^\W*(double|doble)\s/i.test(parts[0]) && !/\b(double|doble)\b/i.test(label)) label = `double ${label}`;
  // Item type in COMBO Mix: "Taco Comal" → "taco de comal" / "comal taco".
  if (/item-\d-option|mix/.test(g)) {
    const m = parts[0].match(/^(taco|quesadilla)\s+(comal|harina|taquer[oa])/i);
    if (m) return es ? (/taquer/i.test(m[2]) ? `${m[1].toLowerCase()} ${m[2].toLowerCase()}` : `${m[1].toLowerCase()} de ${m[2].toLowerCase()}`) : `${KIND_EN[m[2].toLowerCase()] || m[2]} ${m[1].toLowerCase()}`;
    return parts[0].toLowerCase();
  }
  // Tortilla / shell: drop the dish word ("Taco Comal" → "comal").
  if (/tortilla|shell/.test(g)) {
    const kind = parts[0].match(/\b(comal|harina|taquer[oa])\b/i)?.[1]?.toLowerCase();
    if (kind) return es ? kind : (KIND_EN[kind] || kind);
  }
  if (/carne|meat/.test(g)) {
    if (/alpastor/i.test(raw)) return es ? "pastor" : "al pastor";
    if (/^bistec/i.test(raw)) return es ? "bistec" : "steak"; // fix24: say the modifier staff ring in (Bistec), not "asada" (sounds like salsa asada)
    if (/^duro\b/i.test(raw)) return es ? "chicharrón duro" : "pork rinds";
    if (/^prensado\b/i.test(raw)) return es ? "chicharrón prensado" : "spicy pork";
  }
  // i18n1: names without a "ES / EN" pair go through the shared translation map (apps/web/opt-i18n.js).
  if (!raw.includes(" / ")) { const q = I18N()?.pair(option); if (q?.known) return (es ? q.es : q.en).toLowerCase(); }
  return label.toLowerCase();
}

export function rbItemName(name: any, lang: any, alt?: any) {
  const es = lang === "es";
  const n = String(/pack/i.test(String(name)) && alt ? `${name} ${alt}` : name || "").replace(/\s*\([A-Z]{1,4}\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const pack = n.match(/(\d+)\s*pack\b.*?\b\d+\s*x\s+(.+)$/i);
  if (pack) {
    const rest = pack[2].split(" / ")[0].trim();
    const m = rest.match(/^(tacos|quesadillas|tortas|gorditas|queso tortas|queso gorditas)\s*(comal|harina|taquer[oa]s?)?/i);
    const noun = (m?.[1] || rest).toLowerCase();
    const kind = m?.[2]?.toLowerCase().replace(/s$/, "");
    if (!kind) return `${pack[1]} ${noun}`;
    return es ? `${pack[1]} ${noun} ${kind.startsWith("taquer") ? kind.replace(/s?$/, "s") : `de ${kind}`}` : `${pack[1]} ${KIND_EN[kind] || kind} ${noun}`;
  }
  const combo = n.match(/^combo\s+(\w+)/i);
  if (combo) {
    const noun = combo[1].toLowerCase();
    if (noun === "mix") return es ? "Combo mix" : "Mix combo";
    return es ? `Combo de ${noun}` : `${combo[1].charAt(0).toUpperCase()}${noun.slice(1)} combo`;
  }
  const parts = n.split(" / ");
  // fix14: "Tacos Dorados Tacos Dorados" (name repeated in Square) → "Tacos Dorados".
  return parts[0].trim().replace(/^(.+?)\s+\1$/i, "$1");
}

/** "8 tacos de comal" / "8 comal tacos" for one dish split by meat. */
export function rbSplitName(name: any, total: any, kind: any, lang: any) {
  const noun = String(name || "").split(/[ /(]/).filter(Boolean)[0] || String(name || "");
  const plural = total > 1 ? `${noun.toLowerCase()}${/[aeiou]$/i.test(noun) ? "s" : "es"}` : noun.toLowerCase();
  return lang === "es" ? `${total} ${plural}${kind ? (/taquer/.test(kind) ? ` ${kind}s` : ` de ${kind}`) : ""}` : `${total} ${kind ? `${kind} ` : ""}${plural}`;
}

const isMeatGroup = (g: any) => /carne|meat/i.test(String(g || "")) && !/extra/i.test(String(g || ""));

/** Same dish added once per meat (4 pastor + 4 asada, same tortilla) → one line. */
function rbMergeSplit(lines: any[], lang: any) {
  const out: any[] = [];
  const groups = new Map();
  for (const line of lines) {
    const meats = (line.mods || []).filter((m: any) => isMeatGroup(m.group));
    const rest = (line.mods || []).filter((m: any) => !isMeatGroup(m.group));
    const key = `${line.name}|${rest.map((m: any) => rbCleanOption(m.option)).sort().join(",")}`;
    if (meats.length !== 1 || /combo|pack/i.test(String(line.name))) { out.push(line); continue; }
    if (!groups.has(key)) { const g = { lines: [] as any[], rest }; groups.set(key, g); out.push(g); }
    groups.get(key).lines.push(line);
  }
  return out.map((x: any) => {
    if (!x.lines) return x;
    if (x.lines.length === 1) return x.lines[0];
    const total = x.lines.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
    const shell = x.rest.find((m: any) => /tortilla|shell/i.test(String(m.group || "")));
    const kind = shell ? rbOptionLabel(shell.option, shell.group, lang) : "";
    const meats = x.lines.map((l: any) => `${Number(l.quantity) || 1} ${rbOptionLabel(l.mods.find((m: any) => isMeatGroup(m.group)).option, "meat", lang)}`);
    const others = x.rest.filter((m: any) => m !== shell).map((m: any) => rbOptionLabel(m.option, m.group, lang)).filter(Boolean);
    return { text: `${rbSplitName(x.lines[0].name, total, kind, lang)}: ${[...meats, ...others].join(", ")}`, cents: x.lines.reduce((c: number, l: any) => c + (Number(l.cents) || 0), 0) };
  });
}

/** lines: [{ name, quantity, mods: [{ option, group }], cents }] → one short read-back with the total. */
export function rbFormat(input: any[], lang: any) {
  const es = lang === "es";
  const lines = rbMergeSplit(input, lang);
  const and = es ? " y " : " and ";
  const texts = lines.map((line: any) => {
    if (line.text) return line.text;
    const entries: any[] = [];
    let meatEntry: any = null;
    // COMBO Mix: pair each item with its meat ("taco comal de asada, gordita de chicharrón").
    const itemNo = (g: any) => String(g || "").match(/item[- #]*(\d)/i)?.[1];
    const mixKinds: any = {};
    for (const m of line.mods || []) if (/mix|item-\d-option/i.test(String(m.group || ""))) mixKinds[itemNo(m.group) || "1"] = m;
    const mixMeats: any = {};
    for (const m of line.mods || []) if (/carne|meat/i.test(String(m.group || "")) && Object.keys(mixKinds).length) mixMeats[itemNo(m.group) || "1"] = m;
    for (const n of Object.keys(mixKinds).sort()) {
      const raw = rbCleanOption(mixKinds[n].option).split(" / ")[0];
      const k = raw.match(/^(taco|quesadilla)\s+(comal|harina|taquer[oa])/i);
      const meat = mixMeats[n] ? rbOptionLabel(mixMeats[n].option, "meat", lang) : "";
      const dish = k ? k[1].toLowerCase() : raw.toLowerCase();
      if (es) entries.push(`${dish}${k ? ` ${k[2].toLowerCase()}` : ""}${meat ? ` de ${meat}` : ""}`);
      else entries.push(`${meat ? `${meat} ` : ""}${k ? `${KIND_EN[k[2].toLowerCase()]} ` : ""}${dish}`);
    }
    const shellFirst = [...(line.mods || [])].sort((a: any, b: any) => Number(!/tortilla|shell/i.test(String(a.group || ""))) - Number(!/tortilla|shell/i.test(String(b.group || ""))));
    for (const m of shellFirst) {
      if (Object.keys(mixKinds).length && (/mix|item-\d-option/i.test(String(m.group || "")) || /carne|meat/i.test(String(m.group || "")))) continue;
      const label = rbOptionLabel(m.option, m.group, lang);
      if (!label || label === rbItemName(line.name, lang).toLowerCase()) continue;
      const isMeat = /carne|meat/i.test(String(m.group || "")) && !/extra/i.test(String(m.group || ""));
      const q = Math.max(1, Number(m.quantity) || 1);
      if (isMeat) {
        if (!meatEntry) { meatEntry = { meats: new Map() }; entries.push(meatEntry); }
        meatEntry.meats.set(label, (meatEntry.meats.get(label) || 0) + q);
      } else if (!entries.includes(label)) entries.push(label);
    }
    const parts = entries.map((e: any) => {
      if (typeof e === "string") return e;
      const list = [...e.meats].map(([l, c]: any) => (c > 1 ? `${c} ${l}` : l));
      const counted = [...e.meats.values()].some((c: any) => c > 1);
      return counted ? list.join(", ") : list.length > 1 ? `${list.slice(0, -1).join(", ")}${and}${list[list.length - 1]}` : list[0];
    });
    const qty = Number(line.quantity) > 1 ? `${line.quantity} × ` : "";
    const name = rbItemName(line.name, lang, line.alt);
    return `${qty}${name}${parts.length ? `: ${parts.join(", ")}` : ""}`;
  });
  const cents = lines.reduce((s: number, l: any) => s + (Number(l.cents) || 0), 0);
  const total = cents ? ` $${(cents / 100).toFixed(2)}.` : "";
  return `${texts.join("; ")}.${total} ${es ? "¿Algo más?" : "Anything else?"}`;
}
