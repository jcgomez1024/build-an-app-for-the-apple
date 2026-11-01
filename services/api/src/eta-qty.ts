// cristian-qd1 (CA7c22da): address capture / ETA turns are never quantities or dishes; implausible counts are capped.
const FOOD = /\b(?:tacos?|burritos?|burros?|quesadillas?|qd|doradas?|gorditas?|tortas?|enchiladas?|tamales?|menudos?|po[sz]oles?|moles?|platillos?|plates?|birrias?|tortillas?|horchata|jamaica|jarritos?|agua|soda|nachos|elote|esquite|sopes?|huaraches?|tostadas?|chilaquiles|mariscos|c[oó]ctel|cocktail|ceviche|coca|refrescos?)\b/iu;
const MEAT = /\b(?:bistec|asada|pastor|carnitas|chorizo|prensado|pollo|lengua|cabeza|tripa|buche|suadero|barbacoa|birria|chicharr[oó]n|steak|chicken|pork)\b/iu;
const listedMeats = (t: string) => (MEAT.test(t) ? [1] : []);
const ADDR_ASK = /\b(?:direcci[oó]n|domicilio|para\s+d[oó]nde|a\s+d[oó]nde|n[uú]mero\s+de\s+(?:casa|la\s+casa|apartamento)|qu[eé]\s+(?:calle|n[uú]mero)|address|what\s+street|house\s+number|street|calle)\b/iu;
export function addressNumberTurn(text: string, recentStaff: string[]): boolean {
  const f = String(text || "").replace(/[¿¡?.!,]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!/\b\d{2,5}\b/.test(f) || FOOD.test(f) || listedMeats(f).length) return false;
  const rest = f.replace(/\b\d+\b/g, " ").replace(/\b(?:perd[oó]n|disculp[ae]|s[ií]|no|es|el|la|en|aqu[ií]|ok(?:ay)?|aj[aá]|eh|este|digo|n[uú]mero|sorry|it'?s|yes|yeah)(?![\p{L}])/giu, " ").trim();
  return !rest && recentStaff.slice(-2).some((x) => ADDR_ASK.test(x));
}
export function etaOnlyTurn(text: string): boolean {
  const f = String(text || "");
  return /\b(?:\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|media|one|two|three|four|five|ten|fifteen|twenty|thirty)\s+(?:minutos?|minutes?|mins?|horas?|hours?)\b/iu.test(f)
    && !FOOD.test(f.replace(/\b(?:minutos?|minutes?)\b/giu, " ")) && !listedMeats(f).length && !/\b(?:dame|deme|quiero|quisiera|pon(?:me|ga|es)|me\s+pone)\b/iu.test(f);
}
// cristian-qd1: a single line with an implausible count (> 30) is never rung unless the caller said that number next to a dish.
export const QTY_CAP = 30;
export function capQty(acts: any[], text: string, prior: string[] = []): number {
  let n = 0; const known = addressNumbers([...prior, String(text || "")]);
  for (let i = acts.length - 1; i >= 0; i--) { const a = acts[i]; if ((a?.type !== "add_item" && a?.type !== "update_item") || !(Number(a.quantity) > QTY_CAP)) continue;
    const q = Number(a.quantity);
    if (new RegExp(String.raw`\b${q}\s+(?:orden(?:es)?\s+de\s+)?\p{L}`, "u").test(String(text || "")) && FOOD.test(String(text || ""))) continue;
    // rodolfo2: "Sí, 97" (house 197) — a house number (or its tail) is never a line at all
    if (known.some((k) => k === String(q) || k.endsWith(String(q)))) { acts.splice(i, 1); n++; continue; }
    a.quantity = 1; n++; }
  return n;
}
/** rodolfo2: once a count was capped/dropped, Elvi's own readback ("104 quesadillas … 97 bistec … $482.00") is stale — say what is rung. */
export function readbackFromActs(acts: any[], input: any): string {
  const menu: any[] = input?.resolverMenu || input?.menu || []; const en = input?.language === "en";
  const parts: string[] = []; let cents = 0;
  for (const a of acts) { if (a?.type !== "add_item" && a?.type !== "update_item") continue;
    const it = menu.find((m: any) => m?.id === a.itemId); const q = Number(a.quantity) || 1;
    const name = String(it?.name || a.itemId || "").replace(/^sq-/, "");
    const mods = (a.modifiers || []).filter((m: any) => !m?.isDefault).map((m: any) => String(m.option || "").replace(/\s*\(\+\$[\d.]+\)/, "").split(" / ")[0]);
    if (it?.priceCents) cents += it.priceCents * q;
    parts.push(`${q > 1 ? `${q} × ` : ""}${name}${mods.length ? `: ${mods.join(", ")}` : ""}`); }
  if (!parts.length) return en ? "Got it. Anything else?" : "Muy bien. ¿Algo más?";
  return `${parts.join("; ")}.${cents ? ` $${(cents / 100).toFixed(2)}.` : ""} ${en ? "Anything else?" : "¿Algo más?"}`;
}

export function capCartQty(cart: any[], turns: Array<{ speaker: string; text: string }>): boolean { let ch = false;
  const said = turns.filter((t) => t.speaker === "caller").map((t) => String(t.text || "")).join(" . ")
    .replace(/\b\d+\s+(?:[\p{L}.'-]+\s+){0,2}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b/giu, " ");
  for (const l of cart) { const q = Number(l.quantity) || 1; if (q <= QTY_CAP) continue;
    if (FOOD.test(said) && new RegExp(String.raw`\b${q}\s+(?:orden(?:es)?\s+de\s+)?\p{L}`, "u").test(said)) continue;
    l.quantity = 1; ch = true; }
  return ch;
}

// live (chatWithElvi): an ETA or a house number answering an address ask never rings food; counts > QTY_CAP fall back to 1.
export function liveEtaAddressQty(r: any, input: any): any {
  if (!r || !Array.isArray(r.actions)) return r;
  const tx = String(input?.transcript || ""); const h = input?.history || [];
  const lastA = [...h].reverse().filter((x: any) => x.role === "assistant").slice(0, 1).map((x: any) => String(x.text || ""));
  const prior = h.map((x: any) => String(x.text || ""));
  if (etaOnlyTurn(tx) || addressNumberTurn(tx, lastA) || repeatsAddressNumber(tx, prior.slice(-20))) {
    const acts = r.actions.filter((a: any) => a?.type !== "add_item" && a?.type !== "update_item");
    if (acts.length !== r.actions.length) return { ...r, actions: acts, reply: input?.language === "en" ? "Got it. What would you like to order?" : "Muy bien. ¿Qué le preparamos?" };
    return r;
  }
  const acts = r.actions.map((a: any) => ({ ...a })); if (capQty(acts, tx, prior.slice(-20))) return { ...r, actions: acts, reply: readbackFromActs(acts, input) };
  return r;
}

// pablo-tacos1 (CAa21249): "tacos de costilla del taquero, me puedes poner, ah, cinco" — count said after the dish with filler.
const NUMW: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const fold = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
export function trailingQty(acts: any[], text: string): number {
  const adds = (acts || []).filter((a: any) => a?.type === "add_item"); if (adds.length !== 1 || (adds[0].quantity ?? 1) !== 1) return 0;
  const f = fold(text).replace(/\b\d+\s*(?:minutos?|minutes?|horas?|dolares|dollars)\b/g, " ");
  const m = f.match(/\b([a-z]+s)\b/g) || []; if (!m.some((w) => FOOD.test(w))) return 0; // plural dish said
  if (/\b(?:un|una|uno|one|a)\s+(?:\w+\s+)?(?:taco|burrito|quesadilla|torta|gordita|orden)\b/.test(f)) return 0;
  const vals = new Set<number>(); for (const w of f.match(/\b[a-z]+\b|\b\d{1,2}\b/g) || []) { const v = /^\d+$/.test(w) ? +w : NUMW[w]; if (v && v >= 2 && v <= QTY_CAP) vals.add(v); }
  if (vals.size !== 1) return 0; const n = [...vals][0]; adds[0].quantity = n; return n;
}
// pablo-tacos1: "Sí, está, eso es todo. Sí." after the order is closed → no add/update (Elvi merged costilla+tripa into one $3.50 taco).
export function closingOnlyTurn(text: string): boolean {
  const f = fold(text); if (FOOD.test(f) || listedMeats(f).length) return false;
  if (!/\b(?:eso es todo|es todo|seria todo|seria todo|nada mas|that'?s it|that'?s all|that is all|eso seria|ya es todo|ya seria)\b/.test(f)) return false;
  return !/\b(?:pero|but|cambia|change|quita|remove|sin|without|agrega|add|otr[oa]|another|mas de)\b/.test(f.replace(/\bnada mas\b/, ""));
}
export function liveTrailingClosing(r: any, input: any): any {
  if (!r || !Array.isArray(r.actions)) return r; const tx = String(input?.transcript || "");
  if (closingOnlyTurn(tx)) { const acts = r.actions.filter((a: any) => a?.type !== "add_item" && a?.type !== "update_item");
    if (acts.length !== r.actions.length) return { ...r, actions: acts, reply: input?.language === "en" ? "Perfect, thank you." : "Perfecto, muchas gracias." }; return r; }
  const acts = r.actions.map((a: any) => ({ ...a })); const n = trailingQty(acts, tx);
  if (n) return { ...r, actions: acts, reply: String(r.reply || "").replace(/^(?!\d+ ×)/, `${n} × `) };
  return r;
}

// rodolfo2 (CA6dd8e7): "¿sí tiene agua de horchata?" (availability Q, dropped) → "Me pone dos, por favor." is two horchatas,
// never "dos orden de quesadillas" from the last dish.
const ASKED = /\b(aguas?\s+de\s+\p{L}+|horchatas?|jamaicas?|tamarindos?|jarritos?|refrescos?|cocas?|sodas?|tacos?|quesadillas?|gorditas?|tortas?|burritos?|sopes?|huaraches?|tostadas?|enchiladas?|tamales|esquites?|elotes?|menudos?|po[sz]oles?|nachos)\b/iu;
const BARE_COUNT = /^\s*[¿¡]?\s*(?:y\s+)?(?:(?:me\s+(?:pone|pones|da|das|trae|traes)|dame|deme|ponme|tr[aá]eme)\s+)(un[oa]?|dos|tres|cuatro|cinco|seis|\d{1,2})\b/iu;
export function stampAskedCount(turns: Array<{ speaker: string; text: string }>, i: number): boolean {
  const m = String(turns[i]?.text || "").match(ASKED); if (!m) return false;
  let noun = m[1].toLowerCase(); const ag = noun.match(/^aguas?\s+de\s+(.+)$/u); if (ag) noun = `aguas de ${ag[1]}`;
  for (let j = i + 1, k = 0; j < turns.length && k < 2; j++) { const u = turns[j]; if (u.speaker !== "caller") continue; k++;
    const b = String(u.text || "").match(BARE_COUNT); if (!b) continue;
    const rest = fold(String(u.text).slice((b.index || 0) + b[0].length));
    if (FOOD.test(rest) || listedMeats(rest).length || /\b(?:de|of)\s+\p{L}{3,}/u.test(rest.replace(/\bpor favor\b/g, ""))) return false;
    u.text = String(u.text).slice(0, (b.index || 0) + b[0].length) + ` ${noun}` + String(u.text).slice((b.index || 0) + b[0].length); return true; }
  return false;
}
// rodolfo2: "Sí, 97, 197." after the caller already gave "a la 197 Jackson" is the house number again, never a count (97 bistec).
const ADDR_NUM = /\b(?:a\s+la|en\s+la|al|address\s+is|vivo\s+en)\s+(\d{2,5})\b|\b(\d{2,5})\s+(?:y\s+\d+\s+)?(?:[\p{L}.'-]+\s+){0,2}?(?:street|st|calle|avenue|ave|avenida|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct)\b|\b(\d{2,5})\s+\p{Lu}\p{Ll}{2,}/gu;
export function addressNumbers(texts: string[]): string[] { const out: string[] = [];
  for (const t of texts) for (const m of String(t || "").matchAll(ADDR_NUM)) out.push(m[1] || m[2] || m[3]); return out; }
export function repeatsAddressNumber(text: string, prior: string[]): boolean {
  const f = String(text || "").replace(/[¿¡?.!,]+/gu, " ").replace(/\s+/g, " ").trim();
  const nums = f.match(/\b\d{2,5}\b/g); if (!nums || FOOD.test(f) || listedMeats(f).length) return false;
  const rest = f.replace(/\b\d+\b/g, " ").replace(/\b(?:perd[oó]n|disculp[ae]|s[ií]|no|es|el|la|a|en|aqu[ií]|ok(?:ay)?|aj[aá]|eh|este|digo|n[uú]mero|y|sorry|it'?s|yes|yeah)(?![\p{L}])/giu, " ").trim();
  if (rest) return false; const known = addressNumbers(prior); if (!known.length) return false;
  return nums.every((n) => known.some((k) => k === n || k.endsWith(n)));
}
export function dropAddressNumberTurns<T extends { speaker: string; text: string }>(turns: T[]): T[] {
  return turns.filter((t, i) => !(t.speaker === "caller" && repeatsAddressNumber(t.text, turns.slice(Math.max(0, i - 20), i).map((u) => u.text))));
}
