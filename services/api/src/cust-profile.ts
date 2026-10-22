// prof1 (Carlos 10/22): create a Square customer profile for a NEW verified-phone customer after a SUCCESSFUL paid order,
// like Square Online does. Gates:
//  - only for a verified session (signed cookie) with no profile (cid null) — never an unverified phone
//  - only after Square itself says the payment is COMPLETED (webhook is just a trigger; we re-read the payment)
//  - production writes ONLY when CUSTOMER_CHECKOUT_LIVE=1; otherwise the Square SANDBOX directory only
//  - SearchCustomers by phone first (no duplicates); idempotent per payment id (local ledger + Square idempotency_key)
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { squareCall } from "./square.js";
import { checkoutLive } from "./customer-guard.js";

type Cfg = { env: "sandbox" | "production"; accessToken?: string; locationId?: string };
export type Pending = { orderId: string; env: Cfg["env"]; phone: string; givenName: string | null; familyName: string | null; email: string | null; at: number };
export type Done = { paymentId: string; orderId: string; env: Cfg["env"]; customerId: string | null; created: boolean; attached: boolean; reason?: string; at: number };
type Ledger = { pending: Record<string, Pending>; done: Record<string, Done>; byPhone: Record<string, { cid: string; fn: string | null; env: Cfg["env"] }> };

const FILE = () => process.env.CUST_PROFILE_LEDGER || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/logs/cust-profiles.json");
export function loadLedger(): Ledger { try { const j = JSON.parse(fs.readFileSync(FILE(), "utf8")); return { pending: j.pending || {}, done: j.done || {}, byPhone: j.byPhone || {} }; } catch { return { pending: {}, done: {}, byPhone: {} }; } }
function saveLedger(l: Ledger) { fs.mkdirSync(path.dirname(FILE()), { recursive: true }); const tmp = FILE() + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(l, null, 1)); fs.renameSync(tmp, FILE()); }

/** Which Square directory a profile may be written to. Production only when live; null = don't write. */
export function profileWriteEnv(checkoutEnv: Cfg["env"]): Cfg["env"] | null {
  if (checkoutEnv === "production") return checkoutLive() ? "production" : null;
  return "sandbox";
}
const sandboxCfg = (): Cfg | null => (process.env.SQUARE_SANDBOX_ACCESS_TOKEN ? { env: "sandbox", accessToken: process.env.SQUARE_SANDBOX_ACCESS_TOKEN, locationId: process.env.SQUARE_SANDBOX_LOCATION_ID } : null);

const splitName = (n: string) => { const w = String(n || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean); return { given: w[0] || null, family: w.slice(1).join(" ") || null }; };

/** At checkout: remember a verified, profile-less session's order (called only with a readSession() result). */
export function notePendingProfile(session: { p: string; cid: string | null } | null, orderId: string | undefined, checkoutEnv: Cfg["env"], customer: { name?: string; email?: string }) {
  if (!session?.p || session.cid || !orderId) return false;
  const n = splitName(customer?.name || ""); if (!n.given) return false;
  const l = loadLedger();
  l.pending[orderId] = { orderId, env: checkoutEnv, phone: session.p, givenName: n.given, familyName: n.family, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer?.email || "") ? customer!.email! : null, at: Date.now() };
  saveLedger(l); return true;
}

/** After payment: verify with Square, then search → create → attach. Safe to call many times (webhook retries, success page). */
export async function completeProfile(ref: { orderId?: string; paymentId?: string }, prodCfg: Cfg, call: typeof squareCall = squareCall): Promise<Done | null> {
  const l = loadLedger();
  // resolve the pending order; payment id may come from the webhook, order id from the success redirect
  let pend: Pending | undefined = ref.orderId ? l.pending[ref.orderId] : undefined;
  const envs: Cfg["env"][] = pend ? [pend.env] : ["sandbox", "production"];
  for (const env of envs) {
    const w = profileWriteEnv(env); if (!w) continue;
    const cfg = w === "production" ? prodCfg : sandboxCfg(); if (!cfg?.accessToken) continue;
    try {
      let paymentId = ref.paymentId, orderId = ref.orderId, status = "";
      if (paymentId) { const p = await call<any>(`/v2/payments/${encodeURIComponent(paymentId)}`, { method: "GET" }, cfg); status = p.payment?.status; orderId = p.payment?.order_id || orderId; }
      pend = orderId ? l.pending[orderId] : undefined; if (!pend || pend.env !== env) continue;
      if (!paymentId) { const o = await call<any>(`/v2/orders/${encodeURIComponent(orderId!)}`, { method: "GET" }, cfg); paymentId = o.order?.tenders?.find((t: any) => t.payment_id)?.payment_id; if (o.order?.state === "CANCELED") paymentId = undefined;
        if (paymentId) { const p = await call<any>(`/v2/payments/${encodeURIComponent(paymentId)}`, { method: "GET" }, cfg); status = p.payment?.status; } }
      if (!paymentId || status !== "COMPLETED") return null; // not paid (yet), failed or canceled → nothing
      if (l.done[paymentId]) return l.done[paymentId];
      // no duplicates: someone may have made a profile since (Square Online, POS)
      const s = await call<any>("/v2/customers/search", { method: "POST", body: JSON.stringify({ limit: 1, query: { filter: { phone_number: { exact: pend.phone } } } }) }, cfg);
      let cid: string | null = s.customers?.[0]?.id || null, created = false;
      if (!cid) {
        const c = await call<any>("/v2/customers", { method: "POST", body: JSON.stringify({ idempotency_key: `prof1-${paymentId}`.slice(0, 45), given_name: pend.givenName, ...(pend.familyName ? { family_name: pend.familyName } : {}), phone_number: pend.phone, ...(pend.email ? { email_address: pend.email } : {}), reference_id: "order.cocinaelvis.app", note: "order.cocinaelvis.app (verified phone)" }) }, cfg);
        cid = c.customer?.id || null; created = !!cid;
      }
      let attached = false;
      if (cid) try { // best effort: an OPEN order can take customer_id; completed ones can't be changed
        const o = await call<any>(`/v2/orders/${encodeURIComponent(pend.orderId)}`, { method: "GET" }, cfg);
        if (o.order?.customer_id === cid) attached = true;
        else if (o.order?.state === "OPEN") { await call<any>(`/v2/orders/${encodeURIComponent(pend.orderId)}`, { method: "PUT", body: JSON.stringify({ idempotency_key: `prof1a-${paymentId}`.slice(0, 45), order: { location_id: o.order.location_id, version: o.order.version, customer_id: cid } }) }, cfg); attached = true; }
      } catch { attached = false; }
      const d: Done = { paymentId, orderId: pend.orderId, env, customerId: cid, created, attached, at: Date.now() };
      l.done[paymentId] = d; delete l.pending[pend.orderId];
      if (cid) l.byPhone[pend.phone] = { cid, fn: pend.givenName, env };
      saveLedger(l); return d;
    } catch (e) { console.error("prof1", env, e instanceof Error ? e.message.slice(0, 200) : e); }
  }
  return null;
}

/** For /api/cust/me: a profile created after the session was signed. */
export function profileForPhone(phone: string) { const h = loadLedger().byPhone[phone]; return h && h.env === (checkoutLive() ? "production" : "sandbox") ? h : null; }
