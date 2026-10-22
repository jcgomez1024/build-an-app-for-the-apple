// prof1: Square profile creation after paid orders — MOCKED Square, synthetic data, temp ledger.
import test from "node:test"; import assert from "node:assert/strict";
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prof1-"));
process.env.CUST_PROFILE_LEDGER = path.join(dir, "l.json"); process.env.SQUARE_SANDBOX_ACCESS_TOKEN = "sbx"; process.env.SQUARE_SANDBOX_LOCATION_ID = "L1";
const P = await import("../../src/cust-profile.ts");
const prod = { env: "production" as const, accessToken: "prod", locationId: "LP" };
const ph = "+14405550142";
function mock(o: { status?: string; state?: string; existing?: string } = {}) {
  const calls: any[] = [];
  const call = (async (p: string, init: any, cfg: any) => { calls.push({ p, m: init.method, env: cfg.env, b: init.body ? JSON.parse(init.body) : null });
    if (p.startsWith("/v2/payments/")) return { payment: { id: "PAY1", status: o.status || "COMPLETED", order_id: "ORD1" } };
    if (p === "/v2/orders/ORD1" && init.method === "GET") return { order: { id: "ORD1", state: o.state || "OPEN", version: 3, location_id: "L1", tenders: [{ payment_id: "PAY1" }] } };
    if (p === "/v2/customers/search") return o.existing ? { customers: [{ id: o.existing }] } : {};
    if (p === "/v2/customers") return { customer: { id: "CUST_NEW" } };
    return {}; }) as any;
  return { calls, call };
}
const reset = () => { try { fs.unlinkSync(process.env.CUST_PROFILE_LEDGER!); } catch {} delete process.env.CUSTOMER_CHECKOUT_LIVE; };
const sess = { p: ph, cid: null };

test("unverified / already-profiled sessions are never queued", () => { reset();
  assert.equal(P.notePendingProfile(null, "ORD1", "sandbox", { name: "Test Uno" }), false);
  assert.equal(P.notePendingProfile({ p: ph, cid: "C" }, "ORD1", "sandbox", { name: "Test Uno" }), false);
  assert.deepEqual(P.loadLedger().pending, {}); });

test("sandbox: paid → search, create (sandbox only), attach, idempotent per payment", async () => { reset();
  P.notePendingProfile(sess, "ORD1", "sandbox", { name: "Test Uno Prueba", email: "t1@example.test" });
  const m = mock(); const d = await P.completeProfile({ paymentId: "PAY1" }, prod, m.call);
  assert.equal(d?.customerId, "CUST_NEW"); assert.equal(d?.created, true); assert.equal(d?.attached, true);
  assert.ok(m.calls.every((c) => c.env === "sandbox"), "never production");
  const cr = m.calls.find((c) => c.p === "/v2/customers")!.b;
  assert.equal(cr.given_name, "Test"); assert.equal(cr.family_name, "Uno Prueba"); assert.equal(cr.phone_number, ph); assert.equal(cr.email_address, "t1@example.test");
  assert.equal(cr.reference_id, "order.cocinaelvis.app"); assert.equal(cr.idempotency_key, "prof1-PAY1");
  assert.ok(m.calls.findIndex((c) => c.p === "/v2/customers/search") < m.calls.findIndex((c) => c.p === "/v2/customers"));
  assert.equal(m.calls.find((c) => c.m === "PUT")!.b.order.customer_id, "CUST_NEW");
  const m2 = mock(); await P.completeProfile({ paymentId: "PAY1" }, prod, m2.call); await P.completeProfile({ orderId: "ORD1" }, prod, m2.call);
  assert.equal(m2.calls.filter((c) => c.p === "/v2/customers").length, 0, "no second create");
  assert.equal(P.profileForPhone(ph)?.cid, "CUST_NEW"); });

test("existing profile found by search → no create", async () => { reset();
  P.notePendingProfile(sess, "ORD1", "sandbox", { name: "Test Dos" });
  const m = mock({ existing: "CUST_OLD" }); const d = await P.completeProfile({ orderId: "ORD1" }, prod, m.call);
  assert.equal(d?.customerId, "CUST_OLD"); assert.equal(d?.created, false); assert.equal(m.calls.filter((c) => c.p === "/v2/customers").length, 0); });

test("failed / canceled / pending payments create nothing", async () => {
  for (const o of [{ status: "FAILED" }, { status: "CANCELED" }, { status: "APPROVED" }, { state: "CANCELED" }]) { reset();
    P.notePendingProfile(sess, "ORD1", "sandbox", { name: "Test Tres" });
    const m = mock(o); assert.equal(await P.completeProfile(o.state ? { orderId: "ORD1" } : { paymentId: "PAY1" }, prod, m.call), null);
    assert.equal(m.calls.filter((c) => c.p.startsWith("/v2/customers")).length, 0, JSON.stringify(o)); } });

test("production order: nothing unless CUSTOMER_CHECKOUT_LIVE=1", async () => { reset();
  P.notePendingProfile(sess, "ORD1", "production", { name: "Test Cuatro" });
  const m = mock(); assert.equal(await P.completeProfile({ orderId: "ORD1" }, prod, m.call), null); assert.equal(m.calls.length, 0);
  process.env.CUSTOMER_CHECKOUT_LIVE = "1"; const m2 = mock();
  assert.equal((await P.completeProfile({ orderId: "ORD1" }, prod, m2.call))?.env, "production"); assert.ok(m2.calls.every((c) => c.env === "production")); reset(); });
