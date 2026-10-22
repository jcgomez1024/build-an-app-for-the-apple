// success1 (Carlos 10/22): v3-style confirmation page. Only the order this browser checked out: the redirect carries
// our own random token (ck) that maps to exactly one order id; Square's own query params are never trusted alone.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { squareCall } from "./square.js";
import { optionLabel } from "./opt-i18n.js";
const FILE = () => process.env.ORDER_TIMING_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/logs/order-timing.json");
export type OrderRec = { orderId: string; f: "PICKUP" | "DELIVERY"; env: "sandbox" | "production"; scheduleType: "ASAP" | "SCHEDULED"; at: string; readyAt?: string;
  label: { es: string; en: string }; window: { from: string; to: string; es: string; en: string } | null; firstName: string | null; address: string | null; lang?: "es" | "en"; saved: number };
const load = (): Record<string, OrderRec> => { try { return JSON.parse(fs.readFileSync(FILE(), "utf8")); } catch { return {}; } };
export function saveOrderRec(token: string, r: Omit<OrderRec, "saved">) {
  const j = load(); j[token] = { ...r, saved: Date.now() };
  for (const k of Object.keys(j)) if (Date.now() - (j[k].saved || 0) > 14 * 86400e3) delete j[k];
  fs.mkdirSync(path.dirname(FILE()), { recursive: true }); const tmp = FILE() + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(j)); fs.renameSync(tmp, FILE());
}
export const recByToken = (ck: string) => (/^[A-Za-z0-9_-]{16,64}$/.test(ck) ? load()[ck] || null : null);
export const recByOrder = (orderId: string) => Object.values(load()).find((r) => r.orderId === orderId) || null;

export type View = { state: "paid" | "processing" | "failed"; receipt: string | null; lines: Array<{ name: string; qty: string; mods: string[]; cents: number }>; totalCents: number; rec: OrderRec };
export async function fetchView(rec: OrderRec, cfg: any, call: typeof squareCall = squareCall): Promise<View> {
  const o = (await call<any>(`/v2/orders/${encodeURIComponent(rec.orderId)}`, { method: "GET" }, cfg)).order || {};
  const pid = (o.tenders || []).find((t: any) => t.payment_id)?.payment_id || (o.tenders || [])[0]?.id;
  let state: View["state"] = "processing", receipt: string | null = null;
  if (pid) { try { const p = (await call<any>(`/v2/payments/${encodeURIComponent(pid)}`, { method: "GET" }, cfg)).payment || {};
    receipt = p.receipt_number || String(pid).slice(0, 4).toUpperCase();
    state = p.status === "COMPLETED" ? "paid" : p.status === "FAILED" || p.status === "CANCELED" ? "failed" : "processing"; } catch { state = "processing"; } }
  if (o.state === "CANCELED") state = "failed";
  const lines = (o.line_items || []).filter((l: any) => !/^no bebida/i.test(l.name || "")).map((l: any) => ({ name: String(l.name || "").replace(/^\[TEST\]\s*/, "").replace(/\s*\(online\)/i, ""), qty: String(l.quantity || "1"), mods: (l.modifiers || []).length ? l.modifiers.map((m: any) => String(m.name || "")).filter(Boolean) : (String(l.note || "").match(/modifiers:\s*(.+)$/i)?.[1] || "").split(/\s*[,;]\s*/).filter(Boolean), /* e2e1: sandbox lines carry choices in the note */ cents: Number(l.total_money?.amount || 0) }));
  return { state, receipt, lines, totalCents: Number(o.total_money?.amount || 0), rec };
}

const esc = (x: unknown) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
export function renderSuccess(v: View | null, lang: "es" | "en", selfUrl: string, prepMin = 20): string {
  const t = (es: string, en: string) => (lang === "es" ? es : en);
  const other = selfUrl.replace(/([?&])lang=(es|en)/, "").replace(/\?$/, ""); const sep = other.includes("?") ? "&" : "?";
  const head = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cocina Elvis</title>${v?.state === "processing" ? '<meta http-equiv="refresh" content="5">' : ""}
<style>:root{--accent:#1471d6;--ink:#111420;--grad:linear-gradient(135deg,#1471d6,#4aa3ff)}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:var(--ink);background:#f4f7fc}
header{background:var(--grad);color:#fff;display:flex;align-items:center;gap:10px;padding:10px 14px;height:64px;box-shadow:0 4px 18px rgba(20,113,214,.35)}header img{height:40px;border-radius:8px}header b{font-size:18px}header a{margin-left:auto;color:#fff;font-size:13px;opacity:.9}
main{max-width:520px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:16px;padding:16px;margin:12px 0;box-shadow:0 2px 10px rgba(17,20,32,.06)}h1{font-size:24px;margin:6px 0}
.elvi{display:flex;gap:10px;align-items:center}.dot{width:34px;height:34px;border-radius:50%;flex:none;background:radial-gradient(circle at 40% 40%,#9fd0ff,#1471d6 60%,#0b2d5c);box-shadow:0 0 0 2px #fff8,0 0 12px #4aa3ff}
.num{font-size:13px;opacity:.7}.num b{font-size:20px;opacity:1;letter-spacing:1px;color:var(--accent)}.when{font-size:18px;font-weight:700;color:var(--accent)}
.l{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #eef1f6}.l small{display:block;opacity:.65}.tot{font-weight:800;border:0}
.btn{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:14px;border-radius:12px;margin:14px 0}.mut{font-size:13px;opacity:.7}.warn{color:#b45309}</style>
<header><img src="/img/logo-cocina-elvis.png" alt=""><b>Cocina Elvis</b><a href="${esc(other + sep)}lang=${lang === "es" ? "en" : "es"}">${lang === "es" ? "English" : "Español"}</a></header><main>`;
  const foot = `<div class="card mut">Cocina Elvis · 101 W Walnut Ave, Unit B, Painesville, OH 44077<br>${t("Tel", "Phone")}: <a href="tel:+14405519122">(440) 551-9122</a></div><a class="btn" href="/">${t("Volver al menú", "Back to menu")}</a></main></html>`;
  if (!v) return `${head}<div class="card elvi"><span class="dot"></span><div><h1>${t("¡Gracias!", "Thank you!")}</h1><p>${t("Recibimos tu pedido. Si tienes dudas, llámanos.", "We received your order. If you have questions, call us.")}</p></div></div>${foot}`;
  const r = v.rec, fn = r.firstName ? `, ${esc(r.firstName)}` : "";
  if (v.state === "failed") return `${head}<div class="card elvi"><span class="dot"></span><div><h1>${t("No se completó el pago", "Payment didn't go through")}</h1><p>${t("Tu pedido no se cobró. Puedes intentar otra vez o llamarnos.", "Your order wasn't charged. Try again or call us.")}</p></div></div>${foot}`;
  const when = r.f === "DELIVERY"
    ? `<p class="mut">${t("Entrega", "Delivery")} · ${r.scheduleType === "SCHEDULED" ? t("programada", "scheduled") : t("lo antes posible", "ASAP")}</p><p class="when">${t("Llega entre", "Arrives")} ${esc(r.window ? t(r.window.es, r.window.en) : t(r.label.es, r.label.en))}</p>${r.address ? `<p>${esc(r.address)}</p>` : ""}`
    : `<p class="mut">${t("Para recoger", "Pickup")} · ${r.scheduleType === "SCHEDULED" ? t("programado", "scheduled") : t("lo antes posible", "ASAP")}</p><p class="when">${r.scheduleType === "SCHEDULED" ? `${t("Listo a las", "Ready at")} ${esc(t(r.label.es, r.label.en))}` : t(`Listo en aprox. ${prepMin} min`, `Ready in about ${prepMin} min`)}</p>`;
  const proc = v.state === "processing" ? `<p class="warn">⏳ ${t("Procesando tu pago… esta página se actualiza sola.", "Processing your payment… this page updates itself.")}</p>` : "";
  const items = v.lines.map((l) => `<div class="l"><span>${esc(l.qty)} × ${esc(l.name)}${l.mods.length ? `<small>${esc(l.mods.map((m) => optionLabel(m, lang)).join(", "))}</small>` : ""}</span><b>${money(l.cents)}</b></div>`).join("");
  return `${head}<div class="card elvi"><span class="dot"></span><div><h1>${t(`¡Gracias${fn}!`, `Thank you${fn}!`)}</h1><p>${v.state === "paid" ? t("Tu pedido está confirmado.", "Your order is confirmed.") : t("Recibimos tu pedido.", "We got your order.")}</p></div></div>
<div class="card">${v.receipt ? `<p class="num">${t("Confirmación", "Confirmation")} <b>#${esc(v.receipt)}</b></p>` : ""}${proc}${when}</div>
<div class="card">${items}<div class="l tot"><span>Total</span><span>${money(v.totalCents)}</span></div></div>${foot}`;
}
