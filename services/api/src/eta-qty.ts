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
export function capQty(acts: any[], text: string): number {
  let n = 0;
  for (const a of acts) { if ((a?.type !== "add_item" && a?.type !== "update_item") || !(Number(a.quantity) > QTY_CAP)) continue;
    const q = Number(a.quantity);
    if (new RegExp(String.raw`\b${q}\s+(?:orden(?:es)?\s+de\s+)?\p{L}`, "u").test(String(text || "")) && FOOD.test(String(text || ""))) continue;
    a.quantity = 1; n++; }
  return n;
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
  if (etaOnlyTurn(tx) || addressNumberTurn(tx, lastA)) {
    const acts = r.actions.filter((a: any) => a?.type !== "add_item" && a?.type !== "update_item");
    if (acts.length !== r.actions.length) return { ...r, actions: acts, reply: input?.language === "en" ? "Got it. What would you like to order?" : "Muy bien. ¿Qué le preparamos?" };
    return r;
  }
  const acts = r.actions.map((a: any) => ({ ...a })); if (capQty(acts, tx)) return { ...r, actions: acts };
  return r;
}
