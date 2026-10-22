// time1 + success1 + whsig1: timing rules, server validation, Square fulfillment fields, success page, webhook signature. Synthetic only.
import test from "node:test"; import assert from "node:assert/strict";
import crypto from "node:crypto"; import os from "node:os"; import fs from "node:fs"; import path from "node:path";
process.env.ORDER_TIMING_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "time1-")), "t.json");
delete process.env.ELVI_PREP_MINUTES; delete process.env.ELVI_DRIVE_MINUTES;
const T = await import("../../src/timing.ts");
const { buildFulfillment } = await import("../../src/square.ts");
const S = await import("../../src/success-page.ts");
const W = await import("../../src/square-webhook.ts");
const wk = { open: "11:00", close: "20:00" };
const cat: any = { store: { timezone: "America/New_York", prepMinutes: 20, pickupHours: { TUE: [wk], WED: [wk], THU: [wk], FRI: [wk], SAT: [wk], SUN: [wk] } } }; // MON closed
// Oct 2026 is EDT (UTC-4). Tue 2026-10-27, Mon 2026-10-26, Sat 2026-10-24.
const et = (d: string, hm: string) => new Date(`${d}T${hm}:00-04:00`);
const hm = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", weekday: "short" }).format(new Date(iso));

test("before opening (Tue 9:00): ASAP pickup = 11:20 scheduled; delivery 11:35–11:45", () => {
  const p = T.timingOptions("PICKUP", et("2026-10-27", "09:00"), cat)!; assert.equal(p.open, false); assert.equal(p.asap.scheduled, true); assert.equal(p.asap.label.es, "11:20am");
  const d = T.timingOptions("DELIVERY", et("2026-10-27", "09:00"), cat)!; assert.equal(d.asap.label.es, "11:35am–11:45am"); assert.equal(hm(d.asap.window!.from), "Tue 11:35 AM");
  assert.equal(p.days[0].slots[0].label.es, "11:30am"); assert.equal(p.days[0].slots.at(-1)!.label.es, "8:00pm"); // 15-min steps, ready ≤ close
  assert.equal(d.days[0].slots[0].label.es, "11:40am–11:50am"); // first center 11:45
});
test("open (Tue 13:07): ASAP ~20 / ~40 ±5, not scheduled; first slot rounds up", () => {
  const p = T.timingOptions("PICKUP", et("2026-10-27", "13:07"), cat)!; assert.equal(p.open, true); assert.equal(p.asap.scheduled, false); assert.equal(p.asap.label.es, "1:27pm");
  assert.equal(p.days[0].slots[0].label.es, "1:30pm");
  const d = T.timingOptions("DELIVERY", et("2026-10-27", "13:07"), cat)!; assert.equal(d.asap.label.es, "1:42pm–1:52pm"); assert.equal(d.days[0].slots[0].label.es, "1:55pm–2:05pm");
});
test("after last order (Tue 19:50) → next day; Sunday night skips Monday to Tuesday", () => {
  const p = T.timingOptions("PICKUP", et("2026-10-27", "19:50"), cat)!; assert.equal(p.open, false); assert.match(hm(p.asap.at), /^Wed 11:20/);
  const s = T.timingOptions("PICKUP", et("2026-10-25", "21:00"), cat)!; assert.match(hm(s.asap.at), /^Tue 11:20/); assert.equal(s.days[0].es, "mar");
  const m = T.timingOptions("PICKUP", et("2026-10-26", "12:00"), cat)!; assert.match(hm(m.asap.at), /^Tue 11:20/, "Monday closed");
});
test("weekend opens 10am (web hours override)", () => {
  const p = T.timingOptions("PICKUP", et("2026-10-24", "08:00"), cat)!; assert.equal(p.asap.label.es, "10:20am");
  const d = T.timingOptions("DELIVERY", et("2026-10-24", "08:00"), cat)!; assert.equal(d.asap.label.es, "10:35am–10:45am");
});
test("prep/drive are config", () => { process.env.ELVI_PREP_MINUTES = "30"; process.env.ELVI_DRIVE_MINUTES = "10";
  assert.equal(T.timingOptions("DELIVERY", et("2026-10-27", "09:00"), cat)!.asap.label.es, "11:35am–11:45am"); assert.equal(T.timingOptions("PICKUP", et("2026-10-27", "09:00"), cat)!.asap.label.es, "11:30am");
  delete process.env.ELVI_PREP_MINUTES; delete process.env.ELVI_DRIVE_MINUTES; });
test("server validation: off-grid / outside hours refused; items unavailable at that time refused", () => {
  const now = et("2026-10-27", "09:00"), items = [{ id: "a", name: "Desayuno X", squareCatalogObjectId: "SQ_A" }];
  assert.equal(T.validateTiming("PICKUP", { mode: "scheduled", at: et("2026-10-27", "21:00").toISOString() }, [], now, cat).ok, false);
  assert.equal(T.validateTiming("PICKUP", { mode: "scheduled", at: et("2026-10-27", "11:10").toISOString() }, [], now, cat).ok, false);
  const ok = T.validateTiming("PICKUP", { mode: "scheduled", at: et("2026-10-27", "12:00").toISOString() }, items, now, cat, () => ({ available: true }));
  assert.equal(ok.ok, true); assert.equal((ok as any).scheduleType, "SCHEDULED");
  // breakfast only until 11:30 ready-time → noon pickup refused
  const avail = (_: any, kitchenNow: Date) => ({ available: kitchenNow.getTime() + 20 * 60000 <= et("2026-10-27", "11:30").getTime() });
  const bad = T.validateTiming("PICKUP", { mode: "scheduled", at: et("2026-10-27", "12:00").toISOString() }, items, now, cat, avail) as any;
  assert.equal(bad.ok, false); assert.deepEqual(bad.unavailable.map((x: any) => x.id), ["a"]);
  assert.equal(T.validateTiming("PICKUP", { mode: "asap" }, items, now, cat, avail).ok, true, "11:20 ASAP is fine");
  const open = T.validateTiming("PICKUP", undefined, [], et("2026-10-27", "13:00"), cat) as any; assert.equal(open.scheduleType, "ASAP");
});
test("Square fulfillment carries pickup_at / deliver_at", () => {
  const now = et("2026-10-27", "09:00");
  const p: any = buildFulfillment({ fulfillment: "PICKUP", customer: { name: "Test", phone: "4405550100" }, timingResolved: T.validateTiming("PICKUP", { mode: "asap" }, [], now, cat) } as any);
  assert.equal(p.pickup_details.schedule_type, "SCHEDULED"); assert.equal(hm(p.pickup_details.pickup_at), "Tue 11:20 AM");
  const d: any = buildFulfillment({ fulfillment: "DELIVERY", customer: { name: "Test", phone: "4405550100", address: "1 Test St" }, timingResolved: T.validateTiming("DELIVERY", { mode: "asap" }, [], now, cat) } as any);
  assert.equal(d.delivery_details.schedule_type, "SCHEDULED"); assert.equal(hm(d.delivery_details.deliver_at), "Tue 11:35 AM"); assert.equal(d.delivery_details.delivery_window_duration, "PT10M");
  const a: any = buildFulfillment({ fulfillment: "PICKUP", customer: { name: "T" }, timingResolved: T.validateTiming("PICKUP", undefined, [], et("2026-10-27", "13:00"), cat) } as any);
  assert.equal(a.pickup_details.schedule_type, "ASAP"); assert.equal(a.pickup_details.pickup_at, undefined);
});
test("success page: only by token; paid / processing / failed; es+en", async () => {
  const tok = "tok_" + "x".repeat(20);
  S.saveOrderRec(tok, { orderId: "ORD9", f: "DELIVERY", env: "sandbox", scheduleType: "SCHEDULED", at: "", label: { es: "11:35am–11:45am", en: "11:35am–11:45am" }, window: { from: "", to: "", es: "11:35am–11:45am", en: "11:35am–11:45am" }, firstName: "Prueba", address: "1 Test St" });
  assert.equal(S.recByToken("nope"), null); assert.equal(S.recByToken("y".repeat(24)), null); const rec = S.recByToken(tok)!;
  const call = (st: string) => (async (p: string) => p.startsWith("/v2/orders") ? { order: { id: "ORD9", state: "OPEN", tenders: [{ payment_id: "PAYX" }], total_money: { amount: 1850 }, line_items: [{ name: "[TEST] Taco de Asada", quantity: "3", modifiers: [{ name: "Cilantro" }], total_money: { amount: 1050 } }, { name: "NO BEBIDA / NO DRINK", quantity: "1", total_money: { amount: 0 } }] } } : { payment: { status: st, receipt_number: "AB12" } }) as any;
  const v = await S.fetchView(rec, {}, call("COMPLETED")); const h = S.renderSuccess(v, "es", "/checkout/success?ck=" + tok);
  assert.match(h, /¡Gracias, Prueba!/); assert.match(h, /#AB12/); assert.match(h, /3 × Taco de Asada/); assert.match(h, /Cilantro/); assert.match(h, /\$18\.50/); assert.match(h, /Llega entre 11:35am–11:45am/); assert.match(h, /1 Test St/); assert.match(h, /Volver al menú/); assert.doesNotMatch(h, /NO BEBIDA|\[TEST\]/);
  assert.match(S.renderSuccess(v, "en", "/x"), /Thank you, Prueba!.*/s); assert.match(S.renderSuccess(v, "en", "/x"), /Back to menu/);
  const pv = await S.fetchView(rec, {}, call("APPROVED")); assert.equal(pv.state, "processing"); assert.match(S.renderSuccess(pv, "es", "/x"), /Procesando/); assert.match(S.renderSuccess(pv, "es", "/x"), /http-equiv="refresh"/);
  assert.equal((await S.fetchView(rec, {}, call("FAILED"))).state, "failed");
  assert.doesNotMatch(S.renderSuccess(null, "es", "/x"), /Taco/);
});
test("webhook signature: valid / invalid / unconfigured (trusted only while sandbox)", () => {
  const key = "k".repeat(22), url = "https://hooks.example.test/api/square/webhooks", body = '{"type":"payment.updated"}';
  const sig = crypto.createHmac("sha256", key).update(url + body).digest("base64");
  assert.equal(W.verifySquareSignature(body, sig, key, url), "valid"); assert.equal(W.verifySquareSignature(body + " ", sig, key, url), "invalid");
  assert.equal(W.verifySquareSignature(body, undefined, key, url), "invalid"); assert.equal(W.verifySquareSignature(body, sig, "", ""), "unconfigured");
  assert.equal(W.webhookTrusted("unconfigured", false), true); assert.equal(W.webhookTrusted("unconfigured", true), false); assert.equal(W.webhookTrusted("invalid", false), false);
});
