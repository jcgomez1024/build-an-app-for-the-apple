// names2: post-call caller-name extraction from the call transcript (xAI text model, strict JSON) → caller memory
// as source "readback". Square is read-only (Orders Search) and only used to confirm/deny with a POS ticket name.
import { cleanFirstName, cleanFullName, planCallerName, saveCallerName, noteReadbackName, savePickupName } from "./caller-memory.js";
import type { CallTurn } from "./call-scoring.js";

export type NameRole = "self" | "pickup_other" | "unclear";
export type Extracted = { name: string | null; role?: NameRole; confidence: number; evidence: string; speaker: "caller" | "staff_confirmed" | "staff" | "none" };
export type ReadbackDecision = {
  action: "save" | "skip" | "pickup"; reason: string; role?: NameRole; name?: string; confidence?: number; evidence?: string; speaker?: string;
  ticketName?: string; boosted?: boolean; mismatch?: boolean; plan?: string; usage?: { in: number; out: number };
};
const fold = (s: string) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();
const firstFold = (s: string) => fold(s).split(" ")[0] || "";
/** First names match ignoring accents/case (and tolerate one typo for names ≥5 letters). */
export function sameFirstName(a: string, b: string): boolean {
  const x = firstFold(a), y = firstFold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 4 || Math.abs(x.length - y.length) > 1) return false;
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  if (x.length === y.length && x[i] === y[i + 1] && x[i + 1] === y[i] && x.slice(i + 2) === y.slice(i + 2)) return true; // swapped letters (Jaun)
  if (Math.min(x.length, y.length) < 5) return false;
  const r1 = x.slice(i + 1), r2 = y.slice(i + 1);
  return r1 === r2 || x.slice(i + 1) === y.slice(i) || x.slice(i) === y.slice(i + 1);
}
export const nameExtractEnabled = () => process.env.ELVI_NAME_EXTRACT === "1";
const MODEL = () => process.env.ELVI_NAME_MODEL || "grok-4.20-0309-non-reasoning";

/** One LLM call. Returns null on any error (never throws). */
export async function extractNameLLM(turns: CallTurn[]): Promise<(Extracted & { usage?: { in: number; out: number } }) | null> {
  const key = process.env.XAI_API_KEY;
  if (!key || !turns.length) return null;
  const transcript = turns.map((t) => `${t.speaker === "caller" ? "CALLER" : "STAFF"}: ${t.text}`).join("\n").slice(0, 8000);
  const sys = "You read phone-order transcripts from a Mexican restaurant (Spanish/English). Find the name for the ORDER (ticket/pickup name). " +
    "Cues: staff asks '¿a nombre de quién?' / 'name for the order?' and the CALLER answers; or the CALLER says 'soy Juan', 'habla María', 'a nombre de Pedro', 'it's for Mike', 'para Shannon', 'for Shannon'. " +
    "Never return the staff member's name, the restaurant's name (Cocina Elvis, Elvi), a food item, or a name the caller only mentions about someone else unless it is the order name. " +
    "role = 'self' when the caller gives THEIR order/customer name: answering 'name for the order' / '¿a nombre de quién?' / '¿el nombre de quién…?' with a bare name or 'De Luis' / 'De Ana', OR self-ID cues ('soy', 'habla', 'me llamo', 'this is', 'my name is'); " +
    "'pickup_other' ONLY for third-person pickup phrasing: 'para X', 'for X', 'la va a recoger', 'lo/la recoge', 'is picking up', 'picking up for', 'para mi esposa/esposo/hijo/mamá', 'for my wife/husband/son/mom', third person 'ella'/'él'/'se llama' about someone else; " +
    "'unclear' if you cannot tell. " +
    "speaker = 'caller' if the caller said the name, 'staff_confirmed' if staff repeated a name the caller had just given, 'staff' if only staff said it, 'none' if no name. " +
    "name = the most common standard spelling of that name in a Spanish/English context (speech-to-text may misspell it, e.g. 'Llesenia' → 'Yesenia', 'Hose' → 'José'). " +
    "evidence = the exact short quote (max 80 chars) from the transcript. confidence 0-1. Reply ONLY with JSON: {\"name\":string|null,\"role\":\"self\"|\"pickup_other\"|\"unclear\",\"confidence\":number,\"evidence\":string,\"speaker\":string}.";
  try {
    const ctl = new AbortController(); const kill = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL(), temperature: 0, max_tokens: 120, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: transcript }] }),
    });
    clearTimeout(kill);
    if (!r.ok) return null;
    const j = await r.json() as any;
    const o = JSON.parse(String(j?.choices?.[0]?.message?.content || "{}"));
    return {
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : null,
      role: (["self", "pickup_other", "unclear"].includes(o.role) ? o.role : "unclear") as NameRole,
      confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
      evidence: String(o.evidence || "").slice(0, 80),
      speaker: ["caller", "staff_confirmed", "staff", "none"].includes(o.speaker) ? o.speaker : "none",
      usage: { in: Number(j?.usage?.prompt_tokens) || 0, out: Number(j?.usage?.completion_tokens) || 0 },
    };
  } catch { return null; }
}

/** POS/online ticket names of orders created in the call window (2 min before → 45 min after the call ended). */
export function ticketNamesInWindow(orders: any[], atIso: string, durSec = 0): string[] {
  const start = Date.parse(atIso) - 2 * 60000, end = Date.parse(atIso) + (durSec + 30) * 1000 + 45 * 60000;
  const out: string[] = [];
  for (const o of orders) {
    const t = Date.parse(o.created_at);
    if (!(t >= start && t <= end)) continue;
    if (o.ticket_name) out.push(String(o.ticket_name).trim());
    for (const f of o.fulfillments || []) for (const d of [f.pickup_details, f.delivery_details]) if (d?.recipient?.display_name) out.push(String(d.recipient.display_name).trim());
  }
  return out.filter((n) => cleanFullName(n));
}

/** Pure decision (no writes). `bestTicketName` = name on the ticket matched to this call (phone/items/time), if any. */
export function decideReadback(caller: string, ex: Extracted | null, windowNames: string[], bestTicketName?: string | null): ReadbackDecision {
  if (!ex || !ex.name) return { action: "skip", reason: "no-name-found" };
  const base = { name: ex.name, role: ex.role, confidence: ex.confidence, evidence: ex.evidence, speaker: ex.speaker };
  if (ex.speaker !== "caller" && ex.speaker !== "staff_confirmed") return { action: "skip", reason: `speaker-${ex.speaker}`, ...base };
  const clean = cleanFullName(ex.name);
  if (!clean || !cleanFirstName(clean)) return { action: "skip", reason: "junk-name", ...base };
  // names3: someone else's name is never a greeting name.
  if (ex.role === "pickup_other") return { action: "pickup", reason: "pickup-other", ...base, name: clean };
  if (ex.role !== "self") return { action: "skip", reason: "role-unclear", ...base };
  // names3: a matching window ticket only CONFIRMS (raises confidence); the call's spelling is stored.
  const hit = windowNames.find((n) => sameFirstName(n, clean));
  if (hit) {
    const plan = planCallerName(caller, clean, "readback");
    return { action: plan.save ? "save" : "skip", reason: plan.save ? "ticket-confirmed" : plan.reason, ...base, name: plan.name || clean, ticketName: hit, boosted: true, confidence: Math.max(ex.confidence, 0.95), plan: plan.reason };
  }
  // names3: phone-matched ticket disagrees → trust the call when confident (staff mistype in rush hour).
  let mismatch = false;
  if (bestTicketName && cleanFullName(bestTicketName) && !sameFirstName(bestTicketName, clean)) {
    if (ex.confidence < 0.85) return { action: "skip", reason: "conflicts-with-ticket", ...base, ticketName: bestTicketName };
    mismatch = true;
  }
  if (ex.confidence < 0.8) return { action: "skip", reason: "low-confidence", ...base };
  if (mismatch) {
    const plan = planCallerName(caller, clean, "readback");
    return { action: plan.save ? "save" : "skip", reason: plan.save ? "ticket-mismatch-call-wins" : plan.reason, ...base, name: plan.name || clean, ticketName: bestTicketName!, mismatch: true, plan: plan.reason };
  }
  const plan = planCallerName(caller, clean, "readback");
  return { action: plan.save ? "save" : "skip", reason: plan.save ? "llm" : plan.reason, ...base, name: plan.name || clean, plan: plan.reason };
}

/** Anti-hallucination: the name's first word must appear in what was actually said (caller turns, or staff for confirmed). */
export function nameInTranscript(turns: CallTurn[], name: string, speaker: string): boolean {
  const f = firstFold(name);
  if (!f) return false;
  const said = turns.filter((t) => t.speaker === "caller" || speaker === "staff_confirmed").map((t) => ` ${fold(t.text)} `).join(" ");
  if (said.includes(` ${f} `)) return true;
  return false;
}
/** names3: the name was standardized (ASR "Llesenia" → "Yesenia"): accept when the evidence quote really is in what the
 *  caller said and a word in it sounds like the name (first letters folded y/ll, h dropped, z/s/c, v/b, edit distance ≤ 2). */
export function evidenceSupports(turns: CallTurn[], name: string, evidence: string, speaker: string): boolean {
  const ev = fold(String(evidence || "").replace(/^\s*(caller|staff)\s*:\s*/i, ""));
  if (ev.length < 2) return false;
  const said = turns.filter((t) => t.speaker === "caller" || speaker === "staff_confirmed").map((t) => ` ${fold(t.text)} `).join(" ");
  if (!said.includes(ev)) return false;
  const ph = (w: string) => w.replace(/^h/, "").replace(/ll|y/g, "y").replace(/[zc](?=[ei])|z/g, "s").replace(/v/g, "b").replace(/h/g, "");
  const target = ph(firstFold(name));
  return ev.split(" ").some((w) => w.length > 1 && lev(ph(w), target) <= 2);
}
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}


/** Name appears only as the answer to a name-for-order ask, with no self-ID cue. (Carlos 10/24: that is still the customer — not auto pickup_other.) */
export function orderNameAskOnly(turns: CallTurn[], name: string): boolean {
  const f = firstFold(name);
  if (!f) return false;
  const ASK = /(a\s+nombre\s+de\s+qui[eé]n|name\s+for\s+the\s+order|what(?:'s| is)\s+(?:the|your)\s+name|under\s+what\s+name|tu\s+nombre|su\s+nombre|qu[eé]\s+nombre)/iu;
  const SELF = /(?<![\p{L}])(?:me\s+llamo|mi\s+nombre\s+es|soy\s+|habla\s+|this\s+is\s+|my\s+name\s+is|i'?m\s+)\p{L}/iu;
  let sawAsk = false, answeredAsk = false;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.speaker === "staff" && ASK.test(t.text)) {
      sawAsk = true;
      for (const n of turns.slice(i + 1, i + 3)) {
        if (n.speaker === "caller" && (` ${fold(n.text)} `.includes(` ${f} `))) answeredAsk = true;
      }
    }
    if (t.speaker === "caller" && SELF.test(t.text) && (` ${fold(t.text)} `.includes(` ${f} `))) return false;
  }
  return sawAsk && answeredAsk;
}

export async function learnReadbackName(opts: {
  caller: string; turns: CallTurn[]; at: string; durSec?: number; training?: boolean; dry?: boolean;
  orders?: () => Promise<any[]>; bestTicketName?: (orders: any[]) => string | null;
  onSaved?: (phone: string, name: string, d: ReadbackDecision) => void;
  onPickup?: (phone: string, name: string, d: ReadbackDecision) => void;
}): Promise<ReadbackDecision> {
  if (opts.training) return { action: "skip", reason: "training-caller" };
  if (!opts.turns.some((t) => t.speaker === "caller" && t.text.trim())) return { action: "skip", reason: "no-caller-speech" };
  const ex = await extractNameLLM(opts.turns);
  if (!ex) return { action: "skip", reason: "llm-error" };
  if (ex.name && !nameInTranscript(opts.turns, ex.name, ex.speaker) && !evidenceSupports(opts.turns, ex.name, ex.evidence, ex.speaker)) return { action: "skip", reason: "name-not-in-transcript", name: ex.name, evidence: ex.evidence, speaker: ex.speaker, confidence: ex.confidence, usage: ex.usage };
  // Pickup-other only when third-person pickup cues are present (para/for/recoger). Bare / "De X" after name-ask = self (customer).
  if (ex.name && ex.role === "self") {
    const cue = opts.turns.some((t) => t.speaker === "caller" && /(?<![\p{L}])(?:(?:es\s+)?para\s+|(?:it'?s\s+)?for\s+|la\s+va\s+a\s+recoger|lo\s+recoge|la\s+recoge|picking\s+up|pickup\s+for|se\s+llama)\b/iu.test(t.text));
    if (cue) ex.role = "pickup_other";
  }
  let orders: any[] = [];
  try { orders = opts.orders ? await opts.orders() : []; } catch { /* no boost without Square */ }
  const d = decideReadback(opts.caller, ex, ticketNamesInWindow(orders, opts.at, opts.durSec), opts.bestTicketName?.(orders) ?? null);
  d.usage = ex.usage;
  if (!opts.dry && d.name && d.action === "pickup") { if (savePickupName(opts.caller, d.name)) opts.onPickup?.(opts.caller, d.name, d); }
  if (!opts.dry && d.name && ex.role === "self" && (d.action === "save" || d.reason === "flipflop-pending")) { try { noteReadbackName(opts.caller, d.name); } catch { /* best effort */ } }
  if (d.action === "save" && !opts.dry && d.name) {
    const saved = saveCallerName(opts.caller, d.name, "readback");
    if (saved) opts.onSaved?.(opts.caller, saved, d); else { d.action = "skip"; d.reason = "save-refused"; }
  }
  return d;
}
