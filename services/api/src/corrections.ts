// A correction leaves only the corrected item.
// The replaced line must not stay beside the new one, and it must not come back later.
// A correction stays inside its own dish and meat. Another group stays.
// The caller's count beats a staff readback. "otra" is one more. Silence is not a yes.
// "con queso" after a gordita changes that gordita. It must not add a second one.
// A name, a drink, or an ETA must not change an earlier food count.

type Turn = { speaker?: string; text?: string };
type Kind = "taco" | "quesadilla" | "qd" | "gordita" | "torta" | "burrito" | "sope";
type Style = "" | "comal" | "harina" | "taquero";
type Slot = {
  kind: Kind; meats: string[]; style: Style; qd: "" | "regular" | "preparada";
  queso: boolean; n: number; frij: boolean; bare: boolean; todo: boolean; grande: boolean;
  exclusive?: boolean;
  reduce?: boolean;
  cap?: boolean;
  updateOnly?: boolean;
  restyle?: boolean;
};
type Drop = { kind: Kind; meats: string[] };
type Plan = { ensure: Slot[]; drop: Drop[]; spoken: Slot[] };

const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const numOf = (w: string) => Number(w) || NUM[w] || 0;
const NUMW = "\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten|twelve";
const MEATS: Array<[RegExp, string]> = [
  [/\bbistec?k?\b|\bsteak\b|\basada\b/, "bistec"], [/\b(?:al )?pastor\b/, "alpastor"], [/\bcostillas?\b/, "costilla"],
  [/\btripas?\b/, "tripa"], [/\bcabezas?\b/, "cabeza"], [/\bprensados?\b/, "prensado"], [/\blenguas?\b/, "lengua"],
  [/\bchorizo\b/, "chorizo"], [/\bpollo\b|\bchicken\b/, "pollo"], [/\bcarnitas\b/, "carnitas"],
  [/\bbuches?\b/, "buche"], [/\bbirrias?\b/, "birria"], [/\bdeshebradas?\b/, "deshebrada"], [/\bpicadillo\b/, "picadillo"],
  [/\bduros?\b/, "duro"], [/\bnopales\b/, "nopales"], [/\bhuevos?\b/, "huevo"],
];
const DISH: Array<[RegExp, Kind]> = [
  [/\bqueso\s+gorditas?\b|\bgorditas?\b/, "gordita"],
  [/\bquesadillas?\b|\bdoradas?\b/, "quesadilla"],
  [/\btacos?\b/, "taco"],
  [/\btortas?\b/, "torta"],
  [/\bburritos?\b/, "burrito"],
  [/\bsopesazos?\b|\bsopesas?\b|\bsopes?\b/, "sope"],
];

function hear(text: string): string {
  let s = String(text || "");
  s = s.replace(/\bde\s+viste(?!\p{L})/giu, "de bistec");
  s = s.replace(/\bviste(?!\p{L})/giu, "bistec");
  s = s.replace(/\bvit[eé]z?(?!\p{L})/giu, "bistec");
  s = s.replace(/\bbizco\b/giu, "bistec");
  s = s.replace(/\bdedos\s+de\b/giu, "de");
  s = s.replace(/\bde harin\b/giu, "de harina");
  s = s.replace(/\b(?:de|del) comas\b/giu, "de comal");
  s = s.replace(/\bdurad[ao]s?\b/giu, "doradas");
  s = s.replace(/\btortead[ao]s?\b/giu, "comal");
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function meatsIn(text: string): string[] {
  const p = hear(text).replace(/\bcon\s+frijoles\b/g, " ");
  const out: Array<{ at: number; meat: string }> = [];
  for (const [re, key] of MEATS) {
    const r = new RegExp(re.source, "g");
    for (const m of p.matchAll(r)) if (!out.some((x) => x.meat === key)) out.push({ at: m.index || 0, meat: key });
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.meat).slice(0, 2);
}
function kindIn(text: string): Kind | null {
  const p = hear(text);
  if (/\bqueso\s+gorditas?\b|\bgorditas?\b/.test(p) && !/\bquesadillas?\b/.test(p)) return "gordita";
  let best: [number, Kind] | null = null;
  for (const [re, key] of DISH) {
    if (key === "gordita" && /\bquesadillas?\b/.test(p)) continue;
    const m = p.match(re);
    if (m && (!best || (m.index || 0) < best[0])) best = [m.index || 0, key];
  }
  if (/\bgorditas?\b/.test(p) && (!best || best[1] === "quesadilla" && (p.match(/\bgorditas?\b/)?.index || 99) < (best[0]))) return "gordita";
  return best?.[1] || null;
}
function styleIn(text: string): Style {
  const p = hear(text);
  if (/\bharina\b|\bflour\b/.test(p)) return "harina";
  if (/\bcomal\b|\bhomemade\b|\bhecha a mano\b|\bde maiz\b/.test(p)) return "comal";
  if (/\btaquer|\bstreet\b/.test(p)) return "taquero";
  return "";
}
function fried(text: string): boolean {
  return /\b(?:doradas?|en aceite|de aceite|fritas?|fried)\b/.test(hear(text));
}
function bareYes(text: string): boolean {
  return /^(?:si|uju|ujum|aja|ok|okay|claro|yes|yeah|yep|eso|sale|va|correcto|exacto)(?:\s+(?:senor|senora|gracias|por favor|buddy|sir|please))?$/.test(hear(text));
}
function drinkOrNameOrEta(text: string): boolean {
  const p = hear(text);
  if (/\b(?:minutos?|horas?|minutes?)\b/.test(p) && !kindIn(p) && !meatsIn(p).length) return true;
  if (/\b(?:a nombre|me llamo|my name|nombre de)\b/.test(p) && !kindIn(p)) return true;
  if (/\b(?:horchata|jamaica|agua|coca|refresco|soda)\b/.test(p) && !kindIn(p) && !meatsIn(p).length) return true;
  return false;
}
function sameMeats(a: string[], b: string[]): boolean {
  return [...a].sort().join("/") === [...b].sort().join("/");
}
function keyOf(kind: Kind, meats: string[]): string {
  return `${kind}|${[...meats].sort().join("/")}`;
}

const STYLE_WORD = "harina|flour|comal|taquer\\w*|street";
function styleWord(text: string): Style {
  const m = hear(text).match(new RegExp(`\\b(${STYLE_WORD})\\b`));
  if (!m) return "";
  if (/harina|flour/.test(m[1])) return "harina";
  if (/taquer|street/.test(m[1])) return "taquero";
  return "comal";
}
function switchToStyle(text: string): Style {
  const p = hear(text);
  if (/^(?:no|nel)\s+(?:quiero|thanks|thank|seria|eso|es todo|that|nada)\b/.test(p)) return "";
  if (/^(?:no|nel)\s+(?:mejor\s+)?(?:de\s+)?(?:la\s+|las\s+)?(?:tortilla\s+)?(?:de\s+)?(?:harina|flour|comal|taquer\w*|street)\b/.test(p)) return styleWord(p);
  if (/\bmejor\s+(?:de\s+)?(?:la\s+)?(?:tortilla\s+de\s+)?(?:harina|flour|comal|taquer\w*|street)\b/.test(p)) return styleWord(p);
  if (/\b(?:cambialo|cambiarlo|change it)(?:\s+a|\s+to)?\s+(?:de\s+)?(?:harina|flour|comal|taquer\w*|street)\b/.test(p)) return styleWord(p);
  return "";
}

function callerTurns(turns: Turn[]): Array<{ i: number; text: string; raw: string }> {
  const out: Array<{ i: number; text: string; raw: string }> = [];
  (turns || []).forEach((t, i) => {
    if (t.speaker && t.speaker !== "caller") return;
    const text = hear(String(t.text || ""));
    if (text) out.push({ i, text, raw: String(t.text || "") });
  });
  return out;
}

/** What a correction changed, and which dish+meat the late pass must not put back. */
export function correctionPlan(turns: Turn[]): Plan {
  const ensure: Slot[] = [];
  const drop: Drop[] = [];
  const seen: Slot[] = [];
  const open: { kind: Kind | null; meat: string; style: Style; qd: Slot["qd"]; queso: boolean; n: number; provisional: boolean } = {
    kind: null, meat: "", style: "", qd: "", queso: false, n: 0, provisional: false,
  };
  const blank = (over: Partial<Slot> = {}): Slot => ({
    kind: "taco", meats: [], style: "", qd: "", queso: false, n: 1, frij: false, bare: false, todo: false, grande: false, exclusive: false, ...over,
  });
  const put = (slot: Slot) => {
    const hit = ensure.find((s) => s.kind === slot.kind && sameMeats(s.meats, slot.meats) && s.style === slot.style && s.qd === slot.qd && s.queso === slot.queso && s.grande === slot.grande && s.bare === slot.bare);
    if (hit) { hit.n = slot.exclusive ? slot.n : Math.max(hit.n, slot.n); hit.exclusive = hit.exclusive || slot.exclusive; }
    else ensure.push({ ...slot, meats: [...slot.meats] });
  };
  const remember = (kind: Kind | null, meats: string[], n: number, style: Style) => {
    if (kind) open.kind = kind;
    if (meats[0]) open.meat = meats[0];
    if (n) open.n = n;
    if (style) open.style = style;
    open.provisional = false;
  };

  const list = callerTurns(turns);
  for (let c = 0; c < list.length; c++) {
    const { i, text } = list[c];
    if (drinkOrNameOrEta(text) && !/\b(?:no|mejor|en vez|quita|cambial)\b/.test(text)) continue;
    if (/^(?:tendras|tienes|tiene|hay|do you have|a como|cuanto)\b/.test(text) && !/\b(?:me pone|ponme|dame|deme)\b/.test(text)) continue;

    const prevStaff = [...(turns || []).slice(0, i)].reverse().find((t) => t.speaker === "staff");
    const staff = hear(String(prevStaff?.text || ""));

    // Silence is not a yes. A bare yes answers one stated style, or one stated count, and nothing else.
    if (bareYes(text)) {
      const asked = staff.match(new RegExp(`^(?:son|serian)?\\s*(${NUMW})\\b`));
      const choice = [/\bcomal\b/.test(staff), /\bharina\b|\bflour\b/.test(staff), /\btaquer|\bstreet\b/.test(staff)].filter(Boolean).length >= 2;
      if (asked && !choice && open.kind && open.meat && /\?/.test(String(prevStaff?.text || ""))) {
        const n = numOf(asked[1]);
        if (n) put({ kind: open.kind, meats: [open.meat], style: open.style, qd: open.qd, queso: open.queso, n, frij: false, bare: false, todo: false, grande: false });
      }
      continue;
    }

    const toStyle = switchToStyle(text);
    if (toStyle && (open.kind === "taco" || open.kind === "quesadilla" || open.kind === "qd")) {
      const meat = meatsIn(text)[0] || open.meat;
      const kind: Kind = open.kind === "qd" ? "quesadilla" : open.kind;
      if (meat && kind) {
        put({ kind, meats: [meat], style: toStyle, qd: "", queso: false, n: open.n || 1, frij: false, bare: false, todo: false, grande: false, restyle: true });
        if (open.kind === "qd") drop.push({ kind: "qd", meats: [meat] });
        open.kind = kind; open.style = toStyle; open.meat = meat;
      }
      continue;
    }

    // "en vez de quesadillas, tacos" / "no, mejor tres tacos" / "quesadillas de bistec no"
    // "en vez de, y tres tacos" still replaces the open item. The clause before "en vez" is a different line.
    const instead = text.match(new RegExp(`\\ben vez(?:\\s+de)?\\s+(?:las?\\s+|los?\\s+)?(quesadillas?|tacos?|gorditas?|tortas?|sopes?|burritos?)\\b(?:\\s+de\\s+\\w+)?\\s*(?:,|y)?\\s*(?:(${NUMW})\\s+)?(tacos?|quesadillas?|gorditas?|tortas?|sopes?|burritos?)`));
    const insteadOpen = !instead && /\ben vez\b/.test(text) ? text.split(/\ben vez\b/).slice(1).join(" ") : "";
    const mejorDish = text.match(new RegExp(`\\b(?:no\\s+)?mejor\\s+(?:(${NUMW})\\s+)?(tacos?|quesadillas?|gorditas?|tortas?|burritos?|sopes?)\\b`));
    const denyDish = text.match(new RegExp(`\\b(quesadillas?|tacos?|gorditas?|tortas?|sopes?|burritos?)\\s+de\\s+(\\w+)\\s+no\\b`));
    if (instead || insteadOpen || (mejorDish && /\b(?:no|mejor)\b/.test(text) && !/\bmejor no\b/.test(text)) || denyDish) {
      const oldName = instead?.[1] || denyDish?.[1] || (open.kind === "qd" ? "quesadilla" : open.kind || "");
      const newName = instead?.[3] || mejorDish?.[2] || (insteadOpen ? (insteadOpen.match(/\b(tacos?|quesadillas?|gorditas?|tortas?|sopes?|burritos?)\b/)?.[1] || "") : "");
      const oldKind = oldName ? kindIn(oldName) : open.kind;
      const newKind = newName ? kindIn(newName) : null;
      const meat = meatsIn(insteadOpen || (mejorDish ? text.slice(text.indexOf(mejorDish[0])) : text))[0] || (denyDish ? meatsIn(denyDish[2])[0] : "") || open.meat;
      const n = numOf(instead?.[2] || mejorDish?.[1] || (insteadOpen.match(new RegExp(`\\b(${NUMW})\\b`)) || [])[1] || "") || open.n || 1;
      const style = styleIn(text) || (/\bcomal\b/.test(staff) ? "comal" : open.style);
      if (newKind && oldKind && meat && oldKind !== newKind) drop.push({ kind: oldKind === "quesadilla" && open.kind === "qd" ? "qd" : oldKind, meats: [meat] }); // swap
      if (oldKind === "quesadilla") drop.push({ kind: "qd", meats: [meat] });
      if (newKind && meat) {
        const use: Kind = newKind === "quesadilla" && (fried(text) || fried(staff)) ? "qd" : newKind;
        put({ kind: use, meats: [meat], style: use === "qd" ? "" : style, qd: use === "qd" ? (/\bpreparad|\bdeluxe\b|\bcon todo\b|\bde todo\b/.test(text) ? "preparada" : "regular") : "", queso: false, n, frij: false, bare: false, todo: false, grande: false });
        remember(use, [meat], n, style);
      }
      if (insteadOpen) {
        const before = text.split(/\ben vez\b/)[0];
        const keepKind = kindIn(before);
        const keepMeats = meatsIn(before);
        const keepN = numOf((before.match(new RegExp(`\\b(${NUMW})\\b`)) || [])[1] || "");
        if (keepKind && keepMeats.length && keepN) put(blank({ kind: keepKind === "quesadilla" && fried(before) ? "qd" : keepKind, meats: keepMeats.slice(0, 1), n: keepN, style: styleIn(before) || open.style }));
      }
      if (denyDish && !newKind) continue;
      if (instead || insteadOpen || mejorDish) continue;
    }

    // "van a ser tres, pero son dos de pastor y una de bistec" replaces the open count. It does not add a second copy.
    if (/\bpero\s+son\b|\bvan a ser\b/.test(text) && (kindIn(text) || open.kind)) {
      const kind = kindIn(text) || open.kind;
      const parts = [...text.matchAll(new RegExp(`\\b(${NUMW})\\s+de\\s+([a-z]+(?:\\s+con\\s+[a-z]+)?)`, "g"))];
      if (kind && parts.length) {
        const named = parts.map((part) => meatsIn(part[2])[0]).filter(Boolean);
        if (open.meat && !named.includes(open.meat)) drop.push({ kind, meats: [open.meat] }); // pero-son
        for (const part of parts) {
          const meats = meatsIn(part[2]);
          const n = numOf(part[1]);
          if (!meats.length || !n) continue;
          put(blank({ kind, meats, style: open.style || styleIn(text), qd: open.qd, queso: open.queso, n }));
          remember(kind, meats, n, open.style);
        }
        continue;
      }
    }

    // "entonces me pone cuatro" and, on the next turn, "dos de bistec y dos de pollo" replaces the earlier 1 and 1.
    const joined = !/\bentonces\b/.test(text) && list[c - 1] && /\bentonces\b/.test(list[c - 1].text) && /\b(?:me pones?|ponme|dame|deme)\b/.test(list[c - 1].text) ? `${list[c - 1].text} ${text}` : text;
    if (/\bentonces\b/.test(joined) && /\b(?:me pones?|ponme|dame|deme)\b/.test(joined)) {
      const kind = kindIn(joined) || open.kind;
      const parts = [...joined.matchAll(new RegExp(`\\b(${NUMW})\\s+(?:de\\s+)+(?:[a-z]+\\s+de\\s+)?([a-z]+)`, "g"))];
      if (kind && parts.length >= 1) {
        for (const part of parts) {
          const meats = meatsIn(part[2]);
          const n = numOf(part[1]);
          if (!meats.length || !n) continue;
          put(blank({ kind, meats, style: styleIn(joined) || open.style, qd: open.qd, n, exclusive: true }));
        }
        continue;
      }
    }

    // "me pones uno grande, nomás" / "nada más una" sets that dish's count. It does not leave the old count beside it.
    const only = text.match(new RegExp(`\\b(?:nada mas|nomas)\\s+(${NUMW})\\b|\\b(?:me pones?|ponme|dame)\\s+(${NUMW})\\b.{0,40}\\b(?:grande\\s+)?(?:nomas|nada mas)\\b`));
    if (only && open.kind) {
      const n = numOf(only[1] || only[2] || "");
      if (!n) continue;
      const grande = /\bgrande\b/.test(text) || /\bsopesas/.test(text);
      const kind = open.kind === "sope" && grande ? "sope" : open.kind;
      put(blank({ kind, meats: open.meat ? [open.meat] : [], style: open.style, qd: open.qd, queso: open.queso, n, grande, reduce: true }));
      if (grande && open.kind === "sope") drop.push({ kind: "gordita", meats: open.meat ? [open.meat] : [] });
      continue;
    }

    // Gorditas, then "con queso" / "me la haces con queso" / "me les puede poner queso". One item, the queso gordita.
    const quesoAsk = /\bcon queso\b|\b(?:poner|ponle|ponles|hacer|haces|haga)\w*\s+(?:la\s+|las\s+|les\s+)?(?:como\s+)?queso\b|\bme les puede poner queso\b|\bqueso gordita\b/.test(text);
    const sinQueso = /\bsin queso\b/.test(text) && !/\bcon queso\b/.test(text);
    if ((quesoAsk || sinQueso) && (open.kind === "gordita" || kindIn(text) === "gordita" || seen.some((s) => s.kind === "gordita")) && !kindIn(text.replace(/\bgorditas?\b/g, " "))) {
      const staffMeats = meatsIn(staff);
      const staffMeat = staffMeats[staffMeats.length - 1] || "";
      const named = meatsIn(text)[0] || staffMeat || open.meat;
      const all = /\bles\b|\btodas\b|\blas tres\b|\blos tres\b/.test(text);
      const targets = all ? seen.filter((s) => s.kind === "gordita") : seen.filter((s) => s.kind === "gordita" && s.meats[0] === named);
      const on = quesoAsk && !sinQueso;
      if (targets.length) for (const s of targets) {
        if (!on) { const i = ensure.findIndex((e) => e.kind === "gordita" && e.meats[0] === s.meats[0]); if (i >= 0) ensure.splice(i, 1); }
        else put({ ...s, queso: true });
      } else if (named && on) put(blank({ kind: "gordita", meats: [named], queso: true, n: open.n || 1, frij: /\bcon frijoles\b/.test(text) }));
      if (named) { open.meat = named; open.kind = "gordita"; open.queso = on; }
      continue;
    }

    // "no me le pongas ni queso ni crema" changes one burrito. It is not a new burrito.
      if (/\bno me (?:le )?pongas\b|\bni queso ni crema\b|\bsin queso ni crema\b/.test(text) && (open.kind === "burrito" || /\bburrito\b/.test(text))) {
      const meats = open.meat ? [open.meat] : meatsIn(text);
      const total = open.n >= 2 ? open.n : 1;
      put(blank({ kind: "burrito", meats, n: 1, bare: true }));
      if (total > 1) put(blank({ kind: "burrito", meats, n: total - 1, todo: true }));
      continue;
    }

    // Staff said the bread is gone and the caller replaced the torta. The torta must not stay.
    const staffGone = (turns || []).some((t) => t.speaker === "staff" && /\b(?:se acabo|se termin|no hay|sold out|ran out|dont have)\b/.test(hear(String(t.text || ""))) && /\bbolillo|torta|bread\b/.test(hear(String(t.text || ""))));
    if (staffGone && /\bentonces\b/.test(text) && kindIn(text) && kindIn(text) !== "torta") {
      drop.push({ kind: "torta", meats: [] });
    }

    // "dos gorditas, ah, dos sopes" in one breath. The gordita does not stay.
    if (/\bgorditas?\b/.test(text) && /\bsopes?\b/.test(text)) {
      const meats = meatsIn(text);
      const n = numOf((text.match(new RegExp(`\\b(${NUMW})\\b`)) || [])[1] || "") || 1;
      drop.push({ kind: "gordita", meats });
      const grande = /\bgrande\b|\bsopesas/.test(text);
      put({ kind: "sope", meats, style: "", qd: "", queso: false, n, frij: false, bare: false, todo: /\bcon todo\b/.test(text), grande });
      remember("sope", meats, n, "");
      continue;
    }

    // Ordinary order, kept so a later correction knows what it edits. "otra" adds one. It does not become a staff "tres".
    const otra = text.match(new RegExp(`\\botr[ao]s?\\s+(?:(${NUMW})\\s+)?`));
    const nWord = (text.match(new RegExp(`\\b(${NUMW})\\b`)) || [])[1] || "";
    let n = otra && !otra[1] ? 1 : numOf(otra?.[1] || nWord);
    const kindWord = kindIn(text);
    const meats = meatsIn(text);
    const ownStyle = styleIn(text);
    if (kindWord === "gordita" && /\bqueso\b/.test(text)) open.queso = true;
    if (fried(text) && (kindWord === "quesadilla" || open.kind === "quesadilla" || open.kind === "qd")) open.qd = /\b(?:preparad|deluxe|con todo|de todo)\b/.test(text) && !/\bregulares?\b/.test(text) ? "preparada" : (/\bregulares?\b/.test(text) ? "regular" : open.qd);
    if (!n && !kindWord && !meats.length) {
      if (ownStyle && open.kind && open.meat && (open.kind === "taco" || open.kind === "quesadilla" || open.kind === "qd")) {
        const hit = [...seen].reverse().find((s) => (s.kind === open.kind || (open.kind === "qd" && s.kind === "quesadilla") || (open.kind === "quesadilla" && s.kind === "qd")) && s.meats[0] === open.meat);
        if (hit) hit.style = ownStyle;
        open.style = ownStyle;
      }
      continue;
    }
    const kind = (kindWord === "quesadilla" && (fried(text) || (open.qd && !ownStyle)) ? "qd" : kindWord) || (meats.length ? open.kind : null);
    if (!kind || !meats.length) {
      if (ownStyle && open.kind && open.meat && (open.kind === "taco" || open.kind === "quesadilla" || open.kind === "qd")) {
        const hit = [...seen].reverse().find((s) => (s.kind === open.kind || (open.kind === "qd" && s.kind === "quesadilla")) && s.meats[0] === open.meat);
        if (hit) hit.style = ownStyle;
      }
      remember(kindWord, meats, n, ownStyle);
      if (/\bque tiene\b/.test(text)) open.provisional = true;
      continue;
    }
    if (otra && open.kind === kind) n = (otra[1] ? numOf(otra[1]) : 1);
    const style = kind === "qd" ? "" : (ownStyle || (kindWord ? "" : open.style));
    const adding = !!otra;
    const slot: Slot = {
      kind, meats, style, qd: kind === "qd" ? (open.qd || (/\bde todo\b|\bcon todo\b/.test(text) ? "preparada" : "")) : "",
      queso: kind === "gordita" && !/\bsin queso\b/.test(text) && (/\bcon queso\b|\bqueso gordita\b/.test(text) || (open.queso && meats[0] === open.meat)),
      n: n || 1, frij: /\bcon frijoles\b|\bfrijoles con\b/.test(text), bare: false,
      todo: kind === "burrito" && /\bcon todo\b|\bwith everything\b/.test(text),
      grande: kind === "sope" && /\bgrande\b|\bsopesas/.test(text),
    };
    const conJoin = /\bcon\b/.test(text) && !/\bcon frijoles\b|\bcon queso\b|\bcon todo\b/.test(text);
    if (!conJoin && meats.length > 1) {
      const bits = text.split(/\s+y\s+/);
      const rows = bits.map((bit) => ({ meats: meatsIn(bit).slice(0, 1), n: numOf((bit.match(new RegExp(`^(?:.*\\b)?(${NUMW})\\b`)) || [])[1] || "") || slot.n })).filter((row) => row.meats.length);
      if (rows.length >= 2) for (const row of rows) seen.push({ ...slot, meats: row.meats, n: row.n });
      else seen.push({ ...slot, meats: meats.slice(0, 1) });
    } else seen.push({ ...slot, meats: [...slot.meats] });
    // "otra" / "otras N" adds. That number is the addition, not a new total.
    // A trailing "no, esa sí nada" is not a correction. "una de A y una de B" is two lines, never one fused line.
    const leadCorr = /^(?:no|nel)\b|\bmejor\b|\ben vez\b/.test(text) && !/^(?:no|nel)\s+(?:seria|eso|es todo|thanks|thank|nada|that)\b/.test(text);
    if (!adding && leadCorr) {
      const clauses = text.split(/\s+y\s+/);
      const counted = clauses.map((clause) => ({ meats: meatsIn(clause), n: numOf((clause.match(new RegExp(`\\b(${NUMW})\\b`)) || [])[1] || "") })).filter((row) => row.meats.length && row.n);
      if (counted.length >= 2) for (const row of counted) put(blank({ ...slot, meats: row.meats.slice(0, 1), n: row.n }));
      else if (slot.meats.length === 1 || /\bcon\b/.test(text)) put(slot);
    }
    remember(kind, meats, slot.n, ownStyle || open.style);
    if (kind === "gordita" && slot.queso) open.queso = true;
    if (/\bde todo\b/.test(text) && kind === "qd") {
      slot.qd = "preparada";
      put(slot);
    }
  }
  const queued = ensure.filter((s) => s.n > 0 && s.meats.length);
  const linked = (d: Drop) => queued.some((s) => s.kind !== d.kind && (!d.meats.length || sameMeats(s.meats, d.meats)));
  const drops = drop.filter(linked);
  const kept = queued.filter((s) => s.restyle || s.reduce || s.queso || s.bare || s.todo || s.exclusive || drops.some((d) => s.kind !== d.kind && (!d.meats.length || sameMeats(s.meats, d.meats))));
  return { ensure: kept, drop: drops, spoken: seen.filter((s) => s.n > 0 && s.meats.length) };
}

export function correctionHolds(turns: Turn[]): Array<{ kind: string; meats: string[] }> {
  // Only the item a correction removed. The late pass must not add that one back.
  // Lines that stay can still receive frijoles or extra queso from the late pass.
  return correctionPlan(turns).drop.map((d) => ({ kind: d.kind, meats: d.meats }));
}

const oname = (o: any) => typeof o === "string" ? o : String(o?.name || "");
function lineKind(id: string): Kind | "" {
  if (/^sq-qd-/.test(id)) return "qd";
  if (/^sq-quesadilla-/.test(id)) return "quesadilla";
  if (/^sq-taco-/.test(id)) return "taco";
  if (/^sq-gordita-/.test(id)) return "gordita";
  if (/^sq-torta-/.test(id)) return "torta";
  if (/^sq-burrito-/.test(id)) return "burrito";
  if (/^sq-sopesaso-|^sq-sope/.test(id)) return "sope";
  return "";
}
function lineMeats(line: any): string[] {
  const out: string[] = [];
  for (const m of line?.modifiers || []) {
    if (!/carne|meat/i.test(String(m.step || ""))) continue;
    for (const k of meatsIn(String(m.option || ""))) if (!out.includes(k)) out.push(k);
  }
  return out;
}
function optionNamed(item: any, groupRe: RegExp, pick: (name: string) => boolean): { step: string; option: string } | null {
  for (const g of item?.modifierGroups || []) {
    if (!groupRe.test(String(g.name || ""))) continue;
    const name = (g.options || []).map(oname).find(pick);
    if (name) return { step: String(g.name), option: name };
  }
  return null;
}
function hostFor(menu: any[], slot: Slot): any | null {
  if (slot.kind === "qd") {
    const want = slot.qd === "preparada";
    return (menu || []).find((m) => /^sq-qd-/.test(String(m.id)) && (want ? /deluxe|preparada/i : /regular/i).test(`${m.id} ${m.name || ""}`)) || null;
  }
  if (slot.kind === "sope" && slot.grande) return (menu || []).find((m) => /^sq-sopesaso-/.test(String(m.id))) || (menu || []).find((m) => /^sq-sope/.test(String(m.id))) || null;
  if (slot.kind === "sope") return (menu || []).find((m) => /^sq-sopesaso-/.test(String(m.id))) || null;
  return (menu || []).find((m) => lineKind(String(m.id)) === slot.kind) || null;
}
function meatMod(host: any, meat: string): { step: string; option: string } | null {
  return optionNamed(host, /carne|meat/i, (n) => meatsIn(n).includes(meat));
}
function styleMod(host: any, kind: Kind, style: Style): { step: string; option: string } | null {
  if (!style || (kind !== "taco" && kind !== "quesadilla")) return null;
  const code = kind === "taco" ? (style === "harina" ? "THR" : style === "taquero" ? "TST" : "TCO") : (style === "harina" ? "QHR" : style === "taquero" ? "QST" : "QCO");
  return optionNamed(host, /tortilla options/i, (n) => n.includes(`(${code})`));
}
function buildLine(slot: Slot, menu: any[]): any | null {
  const host = hostFor(menu, slot);
  if (!host || !slot.meats.length) return null;
  const mods: Array<{ step: string; option: string }> = [];
  const shell = styleMod(host, slot.kind, slot.style);
  if ((slot.kind === "taco" || slot.kind === "quesadilla") && !shell) return null;
  if (shell) mods.push(shell);
  if (slot.kind === "gordita") {
    const g = optionNamed(host, /gordita options/i, (n) => slot.queso ? /\(QGD\)/.test(n) : /^\(GD\)/.test(n));
    if (g) mods.push(g);
  }
  if (slot.kind === "torta") {
    const g = optionNamed(host, /torta options/i, (n) => /^\(TO\)/.test(n));
    if (g) mods.push(g);
  }
  if (slot.kind === "burrito") {
    const size = optionNamed(host, /size/i, (n) => /regular/i.test(n));
    if (size) mods.push(size);
    if (!slot.bare) {
      for (const re of [/frijol/i, /\barroz\b|\brice\b/i, /queso fresco/i, /crema/i]) {
        const g = optionNamed(host, /burrito options/i, (n) => re.test(n) && !/double/i.test(n));
        if (g) mods.push(g);
      }
    } else {
      for (const re of [/frijol/i, /\barroz\b|\brice\b/i]) {
        const g = optionNamed(host, /burrito options/i, (n) => re.test(n) && !/double/i.test(n));
        if (g) mods.push(g);
      }
    }
  }
  for (const meat of slot.meats) {
    const g = meatMod(host, meat);
    if (!g) return null;
    mods.push(g);
  }
  if (slot.frij) {
    const g = optionNamed(host, /con\s*\/\s*with/i, (n) => /^\*\*Con Frijoles/i.test(n));
    if (g) mods.push(g);
  }
  if (slot.kind === "qd" && slot.qd) {
    const mark = optionNamed(host, /\(QD\)|quesadilla dorada/i, (n) => slot.qd === "preparada" ? /DELUXE Preparada/i.test(n) : /REGULAR Dorada/i.test(n));
    if (mark) mods.unshift(mark);
  }
  return { itemId: host.id, quantity: slot.n, modifiers: mods, readback: `${slot.n} ${slot.kind} ${slot.meats.join(" ")}` };
}

function applySlot(cart: any[], slot: Slot, menu: any[]): boolean {
  const lines = cart.filter((l) => {
    const kind = lineKind(String(l.itemId));
    if (kind !== slot.kind) return false;
    const meats = lineMeats(l);
    if (!slot.meats.length) return true;
    if (!meats.length) return true;
    return sameMeats(meats, slot.meats);
  });
  const filled = (l: any) => {
    const opts = (l.modifiers || []).map((m: any) => String(m.option)).join(" ");
    return /queso/i.test(opts) && /crema/i.test(opts);
  };
  const exact = lines.filter((l) => sameMeats(lineMeats(l), slot.meats) && (slot.kind !== "burrito" || slot.bare === !filled(l) || (!slot.bare && !slot.todo)));
  const target = exact[0] || (slot.kind === "burrito" && (slot.bare || slot.todo) ? undefined : lines[0]);
  if (!target) {
    if (slot.updateOnly) return false;
    const line = buildLine(slot, menu);
    if (!line) return false;
    cart.push(line);
    return true;
  }
  let changed = false;
  const have = (exact.length ? exact : [target]).reduce((s, l) => s + (Number(l.quantity) || 1), 0);
  if (slot.reduce && exact.length === 1 && have > slot.n) {
    exact[0].quantity = slot.n;
    changed = true;
  } else if (have < slot.n && exact.length) {
    exact[exact.length - 1].quantity = (Number(exact[exact.length - 1].quantity) || 1) + (slot.n - have);
    changed = true;
  }
  const host = hostFor(menu, slot) || target;
  if (slot.kind === "qd" && slot.qd && host?.id && target.itemId !== host.id) { target.itemId = host.id; changed = true; }
  if (slot.kind === "torta") {
    const g = optionNamed(host, /torta options/i, (n) => /^\(TO\)/.test(n));
    if (g && !(target.modifiers || []).some((m: any) => /\(TO\)|\(QTO\)/.test(String(m.option)))) {
      target.modifiers = [...(target.modifiers || []), g];
      changed = true;
    }
  }
  if (slot.kind === "gordita" && slot.queso) {
    const g = optionNamed(host, /gordita options/i, (n) => /\(QGD\)/.test(n));
    if (g) {
      const mods = (target.modifiers || []).filter((m: any) => !/gordita options/i.test(String(m.step)));
      target.modifiers = [...mods, g];
      changed = true;
    }
  }
  const shell = styleMod(hostFor(menu, slot.kind === "qd" ? { ...slot, kind: "quesadilla" } : slot) || host, slot.kind, slot.style);
  if (shell) {
    const mods = [...(target.modifiers || [])];
    const at = mods.findIndex((m: any) => /tortilla options/i.test(String(m.step)));
    if (at >= 0) {
      if (slot.restyle && mods[at].option !== shell.option) { mods[at] = shell; target.modifiers = mods; changed = true; }
    } else { target.modifiers = [shell, ...mods]; changed = true; }
    if (slot.kind === "quesadilla" && /^sq-qd-/.test(String(target.itemId))) {
      const q = hostFor(menu, { ...slot, kind: "quesadilla" });
      if (q && target.itemId !== q.id) { target.itemId = q.id; changed = true; }
    }
  }
  if (slot.meats.length && !sameMeats(lineMeats(target), slot.meats)) {
    const mods = (target.modifiers || []).filter((m: any) => !/carne|meat/i.test(String(m.step)));
    const added = slot.meats.map((meat) => meatMod(host, meat)).filter(Boolean) as Array<{ step: string; option: string }>;
    if (added.length === slot.meats.length) { target.modifiers = [...mods, ...added]; changed = true; }
  }
  // A replaced count does not leave the old lines beside the new total.
  if (slot.exclusive && exact.length > 1) {
    for (let i = cart.length - 1; i >= 0; i--) {
      if (cart[i] !== exact[0] && lineKind(String(cart[i].itemId)) === slot.kind && sameMeats(lineMeats(cart[i]), slot.meats)) {
        cart.splice(i, 1); changed = true;
      }
    }
  }
  return changed;
}

function applyDrop(cart: any[], drop: Drop, keep: Slot[]): boolean {
  let changed = false;
  for (let i = cart.length - 1; i >= 0; i--) {
    const kind = lineKind(String(cart[i].itemId));
    if (kind !== drop.kind) continue;
    const meats = lineMeats(cart[i]);
    if (drop.meats.length && !sameMeats(meats, drop.meats) && meats.length) continue;
    if (keep.some((s) => s.kind === kind && sameMeats(s.meats, meats.length ? meats : drop.meats))) continue;
    cart.splice(i, 1);
    changed = true;
  }
  return changed;
}

/** Apply caller corrections. A name, a drink, or an ETA does not change a count. Unrelated lines stay. */
export function applyCorrections(cart: any[], turns: Turn[], menu: any[]): boolean {
  if (!Array.isArray(cart) || !Array.isArray(turns) || !Array.isArray(menu)) return false;
  const plan = correctionPlan(turns);
  if (!plan.ensure.length && !plan.drop.length) return false;
  let changed = false;
  for (const slot of plan.ensure) if (applySlot(cart, slot, menu)) changed = true;
  // After a replacement, one line must not keep a count that belonged to the replaced item.
  if (plan.drop.length) {
    const maxN = new Map<string, number>();
    for (const slot of plan.spoken) {
      const key = `${slot.kind}|${[...slot.meats].sort().join("/")}`;
      maxN.set(key, Math.max(maxN.get(key) || 0, slot.n));
    }
    for (const [key, n] of maxN) {
      const [kind, meat] = key.split("|");
      const lines = cart.filter((l) => lineKind(String(l.itemId)) === kind && [...lineMeats(l)].sort().join("/") === meat);
      if (lines.length === 1 && (Number(lines[0].quantity) || 1) > n) { lines[0].quantity = n; changed = true; }
    }
  }
  for (const drop of plan.drop) if (applyDrop(cart, drop, plan.ensure)) changed = true;
  // A stated style fills a line that has none. A missing dish is not invented from the rest of the call.
  if (plan.ensure.length) {
    for (const slot of plan.spoken) {
      if (!slot.meats.length) continue;
      if (plan.drop.some((d) => d.kind === slot.kind && (!d.meats.length || sameMeats(d.meats, slot.meats)))) continue;
      if (cart.some((l) => /^sq-combo-/.test(String(l.itemId))) && (slot.kind === "quesadilla" || slot.kind === "qd" || slot.kind === "taco" || slot.kind === "gordita")) continue;
      if (!slot.style) continue;
      const line = cart.find((l) => lineKind(String(l.itemId)) === slot.kind && sameMeats(lineMeats(l), slot.meats));
      if (!line) continue;
      const host = hostFor(menu, slot.kind === "qd" ? { ...slot, kind: "quesadilla" } : slot);
      const shell = styleMod(host, slot.kind, slot.style);
      if (shell && !(line.modifiers || []).some((m: any) => /tortilla options/i.test(String(m.step)))) {
        line.modifiers = [...(line.modifiers || []), shell];
        changed = true;
      }
    }
  }
  // "con queso" must not leave the plain gordita next to the queso gordita of the same meat.
  const quesoMeats = plan.ensure.filter((s) => s.kind === "gordita" && s.queso).map((s) => s.meats.join("/"));
  if (quesoMeats.length) {
    for (let i = cart.length - 1; i >= 0; i--) {
      if (lineKind(String(cart[i].itemId)) !== "gordita") continue;
      const plain = (cart[i].modifiers || []).some((m: any) => /^\(GD\)/.test(String(m.option)));
      if (plain && quesoMeats.includes(lineMeats(cart[i]).join("/"))) { cart.splice(i, 1); changed = true; }
    }
  }
  return changed;
}
