// blocklist1 (Carlos, Oct 30 2026): no-pickup/delivery contact list. Chalino (+12622941427) hears "Lo siento, tienes que ir al
// restaurante a ordenar." (or English), then Hangup — no Enqueue/ring, no order, no ticket, no staff SMS.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bl1-"));
process.env.NODE_ENV = "test"; process.env.TWILIO_SKIP_SIGNATURE = "1"; process.env.ELVI_CALL_LOG_DIR = tmp;
process.env.ELVI_CALLERS_FILE = path.join(tmp, "callers.json");
process.env.ELVI_BLOCKLIST_FILE = new URL("../fixtures/blocklist1.json", import.meta.url).pathname;
const { toE164, blockedCaller, loadBlocklist, blockedLanguages, BLOCKED_TEXT } = await import("../../src/phone-blocklist.ts");
const { chatWithElvi } = await import("../../src/elvi.ts");
test("blocklist1: E.164 normalization + lookup", () => {
  assert.equal(toE164("(262) 294-1427"), "+12622941427"); assert.equal(toE164("12622941427"), "+12622941427"); assert.equal(toE164("+1 262-294-1427"), "+12622941427");
  assert.equal(loadBlocklist().length, 2);
  for (const p of ["+12622941427", "2622941427", "1 (262) 294-1427"]) assert.equal(blockedCaller(p)?.name, "Chalino", p);
  assert.equal(blockedCaller("+12625550000"), null); assert.equal(blockedCaller(""), null); assert.equal(blockedCaller("anonymous"), null);
});
test("blocklist1: Chalino is on the real data file", () => {
  const real = loadBlocklist(new URL("../../data/phone-blocklist.json", import.meta.url).pathname);
  assert.ok(real.some((x) => x.phone === "+12622941427"));
});
test("blocklist1: language from memory, else first utterance, else both", () => {
  assert.deepEqual(blockedLanguages("en"), ["en"]); assert.deepEqual(blockedLanguages(null, "Hola, quiero una orden"), ["es"]);
  assert.deepEqual(blockedLanguages(null, "Hi, can I order"), ["en"]); assert.deepEqual(blockedLanguages(null, ""), ["es", "en"]);
  assert.equal(BLOCKED_TEXT.es, "Lo siento, tienes que ir al restaurante a ordenar.");
});
test("blocklist1: Elvi never opens an order for a blocked caller", async () => {
  const r: any = await chatWithElvi({ transcript: "Quiero dos tacos de bistec", language: "es", menu: [], phoneOrder: { callerPhone: "+12622941427" } } as any);
  assert.equal(r.reply, BLOCKED_TEXT.es); assert.deepEqual(r.actions, []);
});
test("blocklist1: /api/twilio/voice says the line and hangs up (no Enqueue); logs blocked_no_order", async () => {
  const express = (await import("express")).default; const { registerTwilioRoutes } = await import("../../src/twilio.ts");
  const app = express(); registerTwilioRoutes(app, (async () => ({ cart: [] })) as any);
  const srv = app.listen(0); const port = (srv.address() as any).port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/twilio/voice`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "CAblock0000000000000000000000001", From: "+12622941427", To: "+15555550100" }).toString() });
    const x = await r.text();
    assert.match(x, /tienes que ir al restaurante a ordenar/); assert.match(x, /come to the restaurant to order/); assert.match(x, /<Hangup\/>/);
    assert.ok(!/<Enqueue|<Dial|<Record/.test(x), x);
    const log = fs.readdirSync(tmp).filter((f) => f.endsWith(".jsonl")).map((f) => fs.readFileSync(path.join(tmp, f), "utf8")).join("");
    assert.match(log, /"blocked_no_order"/);
  } finally { srv.close(); }
});
