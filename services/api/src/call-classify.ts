// unusual1: non-order calls for the Elvi Auditor → UNUSUAL_CALL {category, urgent, question, summary es/en}.
// Rules only (transcript). No phone numbers/addresses in the output.
export type UnusualCategory = "question_dietary" | "complaint" | "catering_large" | "wrong_number_spam" | "reservation_other";
export type Unusual = { category: UnusualCategory; urgent: boolean; question: string | null; summary_es: string; summary_en: string; answers?: FaqAnswer[] };
// faq1: Carlos's answers (data/faq.json) — recorded on question calls and quoted in the UNUSUAL_CALL summary.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
export type FaqAnswer = { id: string; es: string; en: string };
const FAQ_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/faq.json");
let faqCache: Array<FaqAnswer & { re: RegExp }> | null = null;
function faq() { if (!faqCache) { try { faqCache = JSON.parse(fs.readFileSync(FAQ_FILE, "utf8")).entries.map((e: any) => ({ id: e.id, es: e.es, en: e.en, re: new RegExp(e.match, "i") })); } catch { faqCache = []; } } return faqCache!; }
/** FAQ answers for a question text (accent-insensitive). */
export const faqAnswers = (text: string): FaqAnswer[] => faq().filter((e) => e.re.test(norm(text))).map(({ id, es, en }) => ({ id, es, en }));
type T = { speaker: string; text: string };
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** Strip phone numbers and street addresses from quoted caller text. */
export function scrub(s: string): string {
  return String(s || "").replace(/\+?\d[\d\s().-]{6,}\d/g, "[número]")
    .replace(/\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-zÁÉÍÓÚáéíóúñ.]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñ.]+){0,3}\s+(?:st|street|ave|avenue|rd|road|dr|drive|blvd|ln|lane|ct|court|way|pl|place|calle|avenida)\b\.?/gi, "[dirección]")
    .replace(/\s+/g, " ").trim().slice(0, 160);
}
const COMPLAINT = /\b(wrong order|got the wrong|gave me the wrong|missing|forgot|left out|never (?:came|arrived|got)|didn'?t (?:get|come|arrive)|still waiting|late|took (?:so|too) long|cold|raw|undercooked|hair in|refund|money back|complain\w*|queja|me (?:dieron|mandaron|trajeron) (?:mal|otra|lo que no)|equivocad[oa] (?:la|el) (?:orden|pedido)|falt[oó]|faltaba|no (?:lleg[oó]|vino|me lleg[oó])|tard[oó]|tardaron|fr[ií]a|reembolso|devolver|devuelvan)\b/;
const URGENT = /\b(wrong order|got the wrong|gave me the wrong|missing|forgot|left out|never (?:came|arrived|got)|didn'?t (?:get|come|arrive)|still waiting|late|refund|money back|angry|upset|furious|ridiculous|terrible|worst|unacceptable|me (?:dieron|mandaron|trajeron) (?:mal|otra)|equivocad[oa] (?:la|el) (?:orden|pedido)|falt[oó]|faltaba|no (?:lleg[oó]|vino|me lleg[oó])|tard[oó]|tardaron|reembolso|enojad[oa]|molest[oa]|p[eé]simo|una verg[uü]enza)\b/;
const CATERING = /\b(catering|cater|party|fiesta|evento?|event|charolas?|trays?|half pan|full pan|medio pan|pan entero|banquete|graduaci[oó]n|graduation|quincea[nñ]era|boda|wedding|(?:para|for)\s+(?:\d{2,}|veinte|treinta|cuarenta|cincuenta|cien|twenty|thirty|forty|fifty|hundred)\s+(?:personas|people|guests|invitados))\b/;
const SPAM = /\b(wrong number|n[uú]mero equivocado|me equivoqu[eé] de n[uú]mero|equivocado de n[uú]mero|extended warranty|car warranty|google (?:listing|business|my business)|seo|merchant services|credit card processing|insurance|press (?:one|1|two|2)|this is (?:a|an) (?:automated|recorded)|robocall|survey|encuesta|ganador|you(?:'ve| have) won)\b/;
const RESERVATION = /\b(reserv\w*|mesa para|table for|job|trabajo|empleo|hiring|aplicaci[oó]n|application|apply|contratando|delivery driver position|lost and found|olvid[eé] (?:mi|un)|left my)\b/;
const DIETARY_Q = /\b(vegetarian\w*|vegan\w*|meat|carne|pork|puerco|manteca|lard|fat|gluten|dairy|lacteos?|allerg\w*|alergi\w*|ingredients?|ingredientes?|lleva[ns]?|contains?|spicy|picante|hours?|horario|open|abiertos?|cierran|close|price|precio|cuanto cuesta|how much|menu|do you (?:have|sell|make)|tienen|venden|hacen)\b/;
const firstQuestion = (caller: T[]) => {
  const q = caller.find((t) => /\?/.test(t.text) && DIETARY_Q.test(norm(t.text))) || caller.find((t) => /\?/.test(t.text)) || caller.find((t) => DIETARY_Q.test(norm(t.text)));
  return q ? scrub(q.text) : null;
};
/** Classify a call that is NOT a normal order (hasOrder = Elvi heard items). Null for normal calls. */
export function classifyCall(turns: T[], hasOrder: boolean): Unusual | null {
  const caller = turns.filter((t) => t.speaker === "caller");
  if (!caller.length) return null;
  const all = norm(caller.map((t) => t.text).join(" ")), both = norm(turns.map((t) => t.text).join(" "));
  const q = firstQuestion(caller);
  const quote = (s: string | null) => (s ? ` «${s}»` : "");
  if (COMPLAINT.test(all)) {
    const urgent = URGENT.test(all);
    const said = scrub((caller.find((t) => COMPLAINT.test(norm(t.text))) || caller[0]).text);
    return { category: "complaint", urgent, question: q,
      summary_es: `${urgent ? "URGENTE: queja" : "Queja"} del cliente.${quote(said)}`, summary_en: `${urgent ? "URGENT: customer complaint" : "Customer complaint"}.${quote(said)}` };
  }
  if (SPAM.test(both)) return { category: "wrong_number_spam", urgent: false, question: null, summary_es: "Número equivocado o llamada de spam/ventas.", summary_en: "Wrong number or spam/sales call." };
  if (CATERING.test(all)) return { category: "catering_large", urgent: false, question: q, summary_es: `Pedido grande / catering.${quote(q)}`, summary_en: `Large order / catering inquiry.${quote(q)}` };
  if (hasOrder) return null;
  if (RESERVATION.test(all)) return { category: "reservation_other", urgent: false, question: q, summary_es: `Otra consulta (reservación/trabajo/otro).${quote(q)}`, summary_en: `Other inquiry (reservation/job/other).${quote(q)}` };
  if (q && DIETARY_Q.test(all)) {
    const answers = faqAnswers(caller.filter((t) => DIETARY_Q.test(norm(t.text)) || /\?/.test(t.text)).map((t) => t.text).join(" "));
    const a = (l: "es" | "en") => (answers.length ? ` ${l === "es" ? "Respuesta" : "Answer"}: ${answers.map((x) => x[l]).join(" ")}` : "");
    return { category: "question_dietary", urgent: false, question: q, answers, summary_es: `Pregunta del cliente, sin pedido.${quote(q)}${a("es")}`, summary_en: `Customer question, no order.${quote(q)}${a("en")}` };
  }
  return null;
}
