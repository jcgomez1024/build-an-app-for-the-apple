// ordername1: the name on each phone order. Placeholder names/numbers only (no personal data).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ordername-"));
process.env.ELVI_CALLERS_FILE = path.join(dir, "callers.json");
const mem = await import("../../src/caller-memory.ts");
const on = await import("../../src/order-name.ts");
const { phoneOrderNameTurn } = await import("../../src/elvi.ts");
const { orderDisplayName, buildFulfillment } = await import("../../src/square.ts");
const DONE = /^\s*(?:no[\s,.!]*)?(?:es\s+todo|that'?s\s+all|nada\s+m[aá]s)[\s.!]*$/iu;
const turn = (transcript: string, lastReply: string, phoneOrder: any, language: "es" | "en" = "es") =>
  phoneOrderNameTurn({ transcript, language, menu: [], phoneOrder } as any, lastReply, DONE);
const NEW = "2165550101", SAVED = "2165550102", STAFF = "2165550103";

test("ordername1: new caller → Elvi asks the name before wrapping up, answer becomes set_customer", () => {
  assert.equal(turn("no, es todo", "Torta: asada. $10.00. ¿Algo más?", { savedName: null })?.reply, "¿A nombre de quién?");
  assert.equal(turn("that's all", "Taco. $3.00. Anything else?", { savedName: null }, "en")?.reply, "What name for the order?");
  const r = turn("a nombre de Alfa Bravo", "¿A nombre de quién?", { savedName: null })!;
  assert.deepEqual(r.actions, [{ type: "set_customer", name: "Alfa Bravo" }]);
  assert.match(r.reply, /^Gracias, Alfa\./);
  assert.equal(turn("ehh", "¿A nombre de quién?", { savedName: null })?.reply, "¿A nombre de quién?"); // no name heard → ask again
  assert.equal(turn("no, es todo", "Taco. ¿Algo más?", { savedName: null, orderName: "Alfa" }), null); // already have it
  assert.equal(turn("no, es todo", "Taco. ¿Algo más?", undefined), null); // web chat: unchanged
  assert.equal(on.rememberOrderName(NEW, "Alfa Bravo").saved, true);
  assert.deepEqual(mem.savedCallerName(NEW), { name: "Alfa Bravo", source: "elvi" });
});

test("ordername1: saved caller → light confirmation, yes keeps the saved name", () => {
  mem.saveCallerName(SAVED, "Charlie Delta", "readback");
  const ask = turn("nada más", "Taco. $3.00. ¿Algo más?", { savedName: "Charlie Delta" })!;
  assert.equal(ask.reply, "¿Sigue a nombre de Charlie?");
  const yes = turn("sí, gracias", ask.reply, { savedName: "Charlie Delta" })!;
  assert.deepEqual(yes.actions, [{ type: "set_customer", name: "Charlie Delta" }]);
  assert.equal(turn("no, es todo", "Taco. Anything else?", { savedName: "Charlie Delta" }, "en")?.reply, "Still under Charlie?");
});

test("ordername1: corrections are accepted (on the confirm and right after the thank-you)", () => {
  const fix = turn("no, a nombre de Echo", "¿Sigue a nombre de Charlie?", { savedName: "Charlie Delta" })!;
  assert.deepEqual(fix.actions, [{ type: "set_customer", name: "Echo" }]);
  assert.equal(turn("no", "¿Sigue a nombre de Charlie?", { savedName: "Charlie Delta" })?.reply, "¿A nombre de quién?");
  const late = turn("no perdón, es a nombre de Foxtrot", "Gracias, Echo. Revisa tu orden y cuando estés listo, pasa a pagar.", { savedName: "Charlie Delta", orderName: "Echo" })!;
  assert.deepEqual(late.actions, [{ type: "set_customer", name: "Foxtrot" }]);
  assert.equal(on.rememberOrderName(SAVED, "Foxtrot").saved, true); // Elvi-heard beats a readback name
  assert.equal(mem.savedCallerName(SAVED)?.name, "Foxtrot");
});

test("ordername1: staff-entered name is never overwritten", () => {
  mem.saveCallerName(STAFF, "Golf Hotel", "manual");
  assert.deepEqual(on.rememberOrderName(STAFF, "India"), { saved: false, reason: "manual-kept" });
  assert.equal(on.rememberHeardNameIfNone(STAFF, "India"), false);
  assert.deepEqual(mem.savedCallerName(STAFF), { name: "Golf Hotel", source: "manual" });
});

test("ordername1: listen-only — name from the staff's '¿a nombre de quién?', saved only if none exists", () => {
  const turns = [
    { speaker: "caller" as const, text: "quiero dos tacos de asada" },
    { speaker: "staff" as const, text: "muy bien, ¿a nombre de quién?" },
    { speaker: "caller" as const, text: "de Juliet" },
  ];
  assert.equal(on.nameFromStaffAsk(turns), "Juliet");
  assert.equal(on.nameFromStaffAsk([{ speaker: "staff", text: "what's the name for the order?" }, { speaker: "caller", text: "it's Kilo" }]), "Kilo");
  assert.equal(on.nameFromStaffAsk([{ speaker: "caller", text: "Lima" }]), null);
  const fresh = "2165550104";
  assert.equal(on.rememberHeardNameIfNone(fresh, "Juliet"), true);
  assert.equal(on.rememberHeardNameIfNone(fresh, "Mike"), false); // one exists already
  assert.equal(mem.savedCallerName(fresh)?.name, "Juliet");
});

test("ordername1: Square order carries the name (ticket_name + recipient display name)", () => {
  assert.equal(orderDisplayName({ customer: { name: "alfa bravo" } }), "Alfa Bravo");
  assert.equal(orderDisplayName({ customer: { name: "Cliente" } }), null);
  const f: any = buildFulfillment({ cart: [], fulfillment: "PICKUP", customer: { name: "alfa bravo" } } as any);
  assert.equal(f.pickup_details.recipient.display_name, "Alfa Bravo");
});

test("alex1/victor1 names: Nombre. Wally→Alex; Listo→staff Víctor echo", () => {
  const alex = [
    { speaker: "staff" as const, text: "Nombre." },
    { speaker: "caller" as const, text: "Wally." },
    { speaker: "staff" as const, text: "¿Cómo?" },
    { speaker: "caller" as const, text: "Alex." },
    { speaker: "staff" as const, text: "Alex. Si necesito por lo menos unos veinte minutos." },
  ];
  assert.equal(on.nameFromTranscript(alex), "Alex");
  const victor = [
    { speaker: "staff" as const, text: "Okey, ¿el nombre de quién sería?" },
    { speaker: "caller" as const, text: "Listo." },
    { speaker: "staff" as const, text: "Víctor, okey, Víctor, te tengo una orden de birria." },
  ];
  assert.equal(on.nameFromTranscript(victor), "Víctor");
});
