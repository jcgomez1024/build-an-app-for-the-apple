// cust1: customer login with MOCKED Verify + Square lookup. Synthetic 555-01xx numbers only; nothing leaves the process.
import test from "node:test"; import assert from "node:assert/strict";
process.env.CUST_SESSION_SECRET = "t".repeat(48); process.env.CUST_EMAIL_FALLBACK = "0";
const express = (await import("express")).default;
const A = await import("../../src/cust-auth.ts");
const { registerCustRoutes } = await import("../../src/cust-routes.ts");

const sent: string[] = [];
const mockSender = { name: "mock", async send(p: string) { sent.push(p); return { ok: true }; }, async check(_p: string, c: string) { return c === "424242"; } };
const known = "+14405550101";
function server() {
  const app = express(); app.set("trust proxy", true);
  registerCustRoutes(app, { sender: () => mockSender as any, lookup: async (p) => (p === known ? { id: "CUST_SYNTH_1", givenName: "Ana", email: "ana@example.test" } : null),
    history: () => ({ "4405550101": [1, 2, 3].map((i) => ({ at: `2026-10-0${i}T17:00:00Z`, fulfillment: "pickup", lines: [{ name: "Taco de Asada", qty: 3, mods: [] }] })) }) as any,
    menu: async () => [{ id: "I1", name: "Taco de Asada", price: 350, categoryName: "Tacos", variations: [{ id: "V1", price: 350 }] }], secure: false });
  return new Promise<{ url: string; close: () => void }>((r) => { const s = app.listen(0, () => r({ url: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() })); });
}
const post = (u: string, b: any, h: any = {}) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(b) });

test("session sign/read, tamper, expiry", () => {
  const v = A.signSession({ p: known, cid: "C", fn: "Ana", em: null });
  assert.equal(A.readSession(`${A.COOKIE}=${encodeURIComponent(v)}`)?.fn, "Ana");
  assert.equal(A.readSession(`${A.COOKIE}=${encodeURIComponent(v.replace(/^./, (c) => (c === "e" ? "f" : "e")))}`), null);
  assert.equal(A.readSession(`${A.COOKIE}=${encodeURIComponent(v)}`, Date.now() + 31 * 86400e3), null);
  assert.match(A.cookieHeader(v), /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
});

test("start never reveals profile; same body known vs unknown; limits 429", async () => {
  const s = await server();
  const a = await (await post(`${s.url}/api/cust/start`, { phone: "440-555-0101" }, { "X-Forwarded-For": "10.0.0.1" })).json();
  const b = await (await post(`${s.url}/api/cust/start`, { phone: "440-555-0177" }, { "X-Forwarded-For": "10.0.0.2" })).json();
  assert.deepEqual(a, b);
  for (let i = 0; i < 2; i++) assert.equal((await post(`${s.url}/api/cust/start`, { phone: "4405550177" }, { "X-Forwarded-For": `10.0.1.${i}` })).status, 200);
  assert.equal((await post(`${s.url}/api/cust/start`, { phone: "4405550177" }, { "X-Forwarded-For": "10.0.2.9" })).status, 429); // 4th in 10 min
  assert.equal((await post(`${s.url}/api/cust/start`, { phone: "12" })).status, 400);
  s.close();
});

test("verify: wrong code 401, check rate-limited, right code sets cookie; me/favorites only for own session; logout", async () => {
  const s = await server(); const H = { "X-Forwarded-For": "10.9.0.1" };
  assert.equal((await post(`${s.url}/api/cust/verify`, { phone: known, code: "000000" }, H)).status, 401);
  const r = await post(`${s.url}/api/cust/verify`, { phone: known, code: "424242" }, H);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, firstName: "Ana", guest: false });
  const ck = String(r.headers.get("set-cookie")).split(";")[0]; assert.match(ck, /^elvi_cust=/);
  const me = await (await fetch(`${s.url}/api/cust/me`, { headers: { cookie: ck } })).json();
  assert.equal(me.firstName, "Ana"); assert.equal(me.pastOrders.length, 3); assert.ok(me.favorites?.greeting?.includes("Ana"));
  assert.deepEqual(await (await fetch(`${s.url}/api/cust/me`)).json(), { loggedIn: false });
  const lo = await post(`${s.url}/api/cust/logout`, {}); assert.match(String(lo.headers.get("set-cookie")), /Max-Age=0/);
  const g = await (await post(`${s.url}/api/cust/verify`, { phone: "4405550188", code: "424242" }, { "X-Forwarded-For": "10.9.0.2" })).json();
  assert.deepEqual(g, { ok: true, firstName: null, guest: true });
  let last = 0; for (let i = 0; i < 6; i++) last = (await post(`${s.url}/api/cust/verify`, { phone: "4405550199", code: "111111" }, { "X-Forwarded-For": `10.9.1.${i}` })).status;
  assert.equal(last, 429);
  s.close();
});

test("twilio sender uses Verify API shape; approved only", async () => {
  const calls: any[] = [];
  const f = (async (u: string, o: any) => { calls.push({ u, b: String(o.body) }); return new Response(JSON.stringify({ status: u.endsWith("VerificationCheck") ? "pending" : "pending" }), { status: 201 }); }) as any;
  const snd = A.twilioVerifySender({ TWILIO_ACCOUNT_SID: "ACxx", TWILIO_AUTH_TOKEN: "x", TWILIO_VERIFY_SERVICE_SID: "VAtest" } as any, f);
  assert.equal((await snd.send(known, { locale: "es", channel: "sms" })).ok, true);
  assert.equal(await snd.check(known, "123456"), false);
  assert.match(calls[0].u, /Services\/VAtest\/Verifications$/); assert.match(calls[0].b, /Channel=sms/); assert.match(calls[0].b, /Locale=es/);
});
