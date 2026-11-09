// Declared synthetic boundaries plus the isolated ticket store.
// Not an independent holdout. Does not import twilio until the scratch dir is set.
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const outPath = process.argv[2];
if (!outPath) throw new Error("usage: run-scoped-boundaries.ts <out.json>");

const prodRoots = [
  "/agent/repos/build-an-app-for-the-apple/services/api/data/logs",
  "/agent/repos/build-an-app-for-the-apple/services/api/data/logs/calls",
  "/agent/repos/build-an-app-for-the-apple/services/api/data/calls",
];
function snap(root: string) {
  try {
    const st = statSync(root);
    return { exists: true, mtimeMs: st.mtimeMs, files: readdirSync(root).slice(0, 40) };
  } catch {
    return { exists: false, mtimeMs: null, files: [] as string[] };
  }
}

const scratch = mkdtempSync(path.join(tmpdir(), "elvi-ticket-"));
process.env.ELVI_CALL_LOG_DIR = scratch;
process.env.ELVI_CALLERS_FILE = path.join(scratch, "callers.json");
process.env.NODE_ENV = "test";

const before = Object.fromEntries(prodRoots.map((root) => [root, snap(root)]));
const twilio = await import("../../src/twilio.ts");
const scoring = await import("../../src/call-scoring.ts");
const repair = await import("../../src/list-repair.ts");
const evidence = await import("../../src/offline-evidence.ts");
const { phoneMenu } = await import("./evaluate.ts");
const { CASES } = await import("./cases.ts");

const phone = phoneMenu();
const freeze = JSON.parse(readFileSync("/tmp/menu-freeze-preflight/catalog/menu.json", "utf8"));
const holdTurns = [
  "Please add two comal steak tacos.",
  "Add two comal steak tacos without onions.",
  "Only add those two comal steak tacos.",
  "Yes, two comal steak tacos without onions.",
];
async function shadow(turns: string[], menu: any[]) {
  const run: any = async () => ({ actions: [], reply: "" });
  run.menu = () => menu;
  return scoring.shadowOrderFromTurns(turns.map((text, n) => ({ speaker: "caller", text, language: "en", start: n, end: n + 1 })), run);
}
function describeFrom(menuItems: any[]) {
  return async (cart: any[]) => cart.map((line) => {
  const item = menuItems.find((entry) => entry.id === line.itemId);
  const quantity = Number(line.quantity) || 1;
  return { name: item?.name || "", quantity, choices: (line.modifiers || []).map((modifier: any) => modifier.option), totalCents: Number(item?.priceCents || 0) * quantity };
  });
}

const order: any = await shadow(holdTurns, freeze);
const callSid = "CA-synthetic-hold-0001";
await twilio.upsertTicket({ callSid, caller: "", name: null, phase: "final", transcript: holdTurns.join("\n") }, describeFrom(freeze), order.cart, order);
const saved = JSON.parse(readFileSync(path.join(scratch, "elvi-tickets.json"), "utf8")).find((row: any) => row.callSid === callSid);
const recovered = evidence.recoveryAcceptance(saved);
const continued: any = await shadow([...holdTurns, "Okay, thank you."], freeze);
const ticket2 = await twilio.upsertTicket({ callSid, caller: "", name: null, phase: "final", transcript: [...holdTurns, "Okay, thank you."].join("\n") }, describeFrom(freeze), continued.cart, continued);
const savedBytes = readFileSync(path.join(scratch, "elvi-tickets.json"));
const savedHash = createHash("sha256").update(savedBytes).digest("hex");
const reread = JSON.parse(execFileSync("node", ["-e", `const fs=require("fs"); const p=${JSON.stringify(path.join(scratch, "elvi-tickets.json"))}; const b=fs.readFileSync(p); const row=JSON.parse(b.toString()).find((item)=>item.callSid==="CA-synthetic-hold-0001"); console.log(JSON.stringify({hash:require("crypto").createHash("sha256").update(b).digest("hex"), phase:row.phase, acceptance:row.acceptance, reviewReason:row.reviewReason}));`], { encoding: "utf8" }));
const after = Object.fromEntries(prodRoots.map((root) => [root, snap(root)]));
const productionUntouched = prodRoots.every((root) => JSON.stringify(before[root]) === JSON.stringify(after[root]));
const holdPersists = saved?.phase === "review"
  && saved?.reviewReason === "unresolved accommodation: without onions"
  && recovered.phase === "review"
  && ticket2.phase === "review"
  && ticket2.reviewReason === saved.reviewReason
  && productionUntouched
  && reread.hash === savedHash
  && reread.phase === "review"
  && reread.reviewReason === saved.reviewReason;

const synthetic = [
  { id: "plain", turns: [{ speaker: "caller", text: "Una coca." }], expect: "regular" },
  { id: "negated-no", turns: [{ speaker: "caller", text: "No una coca." }], expect: "none" },
  { id: "declined", turns: [{ speaker: "caller", text: "Una coca." }, { speaker: "caller", text: "No, no quiero la coca." }], expect: "none" },
  { id: "removed", turns: [{ speaker: "caller", text: "Una coca." }, { speaker: "caller", text: "Quita la coca." }], expect: "none" },
  { id: "staff-out", turns: [{ speaker: "caller", text: "Una coca." }, { speaker: "staff", text: "No hay coca hoy." }], expect: "none" },
  { id: "replaced", turns: [{ speaker: "caller", text: "Una coca." }, { speaker: "caller", text: "Mejor una pepsi." }], expect: "none" },
  { id: "diet", turns: [{ speaker: "caller", text: "Una coca diet." }], expect: "diet" },
  { id: "zero", turns: [{ speaker: "caller", text: "Una coca zero." }], expect: "none" },
  { id: "beside-diet", cart: [{ itemId: phone.find((item) => /diet/i.test(item.id) && /coca/i.test(item.id)).id, quantity: 1, modifiers: [] }], turns: [{ speaker: "caller", text: "Una coca." }], expect: "diet-only" },
].map((item) => {
  const cart = JSON.parse(JSON.stringify(item.cart || []));
  const added = repair.addSpokenCountedCoca(cart, item.turns, phone);
  const ids = cart.map((line: any) => line.itemId);
  const regular = ids.filter((id: string) => /coca/i.test(id) && !/diet|zero/i.test(id));
  const diet = ids.filter((id: string) => /diet/i.test(id) && /coca/i.test(id));
  const ok = item.expect === "regular" ? added && regular.length === 1 && diet.length === 0
    : item.expect === "diet" ? added && diet.length === 1 && regular.length === 0
    : item.expect === "diet-only" ? !added && regular.length === 0 && diet.length === 1
    : !added && regular.length === 0;
  return { id: item.id, declared_synthetic: true, ok, added, ids };
});

const c01 = CASES.find((item) => item.id === "C01")!;
const c01Run: any = async () => ({ actions: [], reply: "" });
c01Run.menu = () => phone;
const c01Shadow: any = await scoring.shadowOrderFromTurns(c01.turns as any, c01Run);
const c01Lines = (c01Shadow.cart || []).map((line: any) => {
  const item = phone.find((entry) => entry.id === line.itemId);
  return { item_id: line.itemId, name: item?.name || "", quantity: Number(line.quantity) || 1, notes: [...(line.elviNotes || [])], priceCents: item?.priceCents ?? null };
});
const described = await describeFrom(phone)(c01Shadow.cart || []);
const ticketLines = twilio.buildTicketLines(described, c01Shadow.cart || [], []);
const coke = c01Lines.find((line: any) => /coca/i.test(line.item_id));
const cokeTicket = ticketLines.find((line: any) => /coca/i.test(line.name));
const projectionOk = !!coke && coke.name.length > 0 && coke.quantity === 1 && coke.priceCents === 350
  && cokeTicket && cokeTicket.name.length > 0 && cokeTicket.quantity === 1 && cokeTicket.totalCents === 350
  && !(cokeTicket.notes || []).some((note: string) => /botella|bottle/i.test(note));

const forward = repair.reconcileCountedCoca([], [{ speaker: "caller", text: "Una coca." }], phone);
const reversed = repair.reconcileCountedCoca([], [{ speaker: "caller", text: "Una coca." }], [...phone].reverse());
const sameSku = forward.action === "add" && reversed.action === "add" && forward.item.id === reversed.item.id && !/pepsi-pepsi|pepsi-[a-z0-9]{6}$/i.test(forward.item.id);
const zeroRun: any = async () => ({ actions: [], reply: "" });
zeroRun.menu = () => phone;
const zeroOrder: any = await scoring.shadowOrderFromTurns([{ speaker: "caller", text: "Una coca zero.", language: "es", start: 0, end: 1 }], zeroRun);
const zeroReply = (zeroOrder.steps || []).map((step: any) => step.reply || "").filter(Boolean);
const zeroOk = (zeroOrder.cart || []).length === 0 && typeof zeroOrder.reviewReason === "string" && /unresolved counted request/.test(zeroOrder.reviewReason) && zeroReply.length > 0;
const asked = repair.reconcileCountedCoca([], [{ speaker: "caller", text: "¿Tienes dos cocas?" }], phone);
const askOk = asked.action === "none";
const clearRecovered = evidence.gateTicketAcceptance({ validation: "clear", reviewReason: null, cart: [{ itemId: "x", quantity: 1 }], autoAccepted: false });
const clearOk = clearRecovered.phase === "final" && clearRecovered.acceptance === "validation-complete";
const freezeCoca = freeze.find((item: any) => item.id === "sq-drink-coca-cola-JJE4KC");
const body = {
  candidate_sha: execSync("git rev-parse HEAD", { cwd: "/agent/repos/build-an-app-for-the-apple" }).toString().trim(),
  persistence: { scratch, production_untouched: prodRoots.every((root) => JSON.stringify(before[root]) === JSON.stringify(after[root])), saved_phase: saved?.phase, saved_review: saved?.reviewReason, recovered, continuation_return: { phase: ticket2.phase, reviewReason: ticket2.reviewReason }, file_reread: reread, file_hash: savedHash, hold_persists: holdPersists, note: "file_reread is a second process reading the saved file after the continuation write. continuation_return is only the in-process object." },
  synthetic,
  c01: { fulfillment: c01Shadow.fulfillment, lines: c01Lines, ticket_lines: ticketLines.map((line: any) => ({ name: line.name, quantity: line.quantity, notes: line.notes, choices: line.choices, totalCents: line.totalCents })), projection_ok: projectionOk },
  counted: { same_sku: sameSku, forward: forward.action === "add" ? forward.item.id : forward.action, reversed: reversed.action === "add" ? reversed.item.id : reversed.action, zero_review: zeroOrder.reviewReason ?? null, zero_reply: zeroReply, availability_not_a_line: askOk, clear_recovered_unchanged: clearOk },
  bottle_mapping: {
    freeze_description: freezeCoca?.description || null,
    freeze_modifier_groups: (freezeCoca?.modifierGroups || []).map((group: any) => group.name),
    phone_groups: (phone.find((item) => item.id === coke?.item_id)?.modifierGroups || []).map((group: any) => group.name),
    spoken_note_on_cart: coke?.notes || [],
    spoken_note_on_staff_ticket: cokeTicket?.notes || [],
    mapping: "The freeze Coca-Cola SKU description is 1 x Bottle. The phone menu item has no modifier group. Spoken botella is not a selected catalog option and is not printed by buildTicketLines.",
  },
};
writeFileSync(outPath, JSON.stringify(body, null, 2));
const syntheticOk = synthetic.every((row) => row.ok);
console.log(holdPersists ? "PASS" : "FAIL", "persistence-hold");
for (const row of synthetic) console.log(row.ok ? "PASS" : "FAIL", row.id, row.ids.join(","));
console.log(projectionOk ? "PASS" : "FAIL", "c01-projection", JSON.stringify(c01Lines));
console.log(sameSku ? "PASS" : "FAIL", "reversed-menu", forward.action === "add" ? forward.item.id : forward.action, reversed.action === "add" ? reversed.item.id : reversed.action);
console.log(zeroOk ? "PASS" : "FAIL", "zero-review", zeroOrder.reviewReason, zeroReply.join(" | "));
console.log(askOk ? "PASS" : "FAIL", "availability-not-a-line");
console.log(clearOk ? "PASS" : "FAIL", "clear-recovered-unchanged", clearRecovered.acceptance);
if (!holdPersists || !syntheticOk || !projectionOk || !sameSku || !zeroOk || !askOk || !clearOk) process.exit(1);
