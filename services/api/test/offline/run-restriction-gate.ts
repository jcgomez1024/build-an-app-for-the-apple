// Isolated ticket-gate check. In-memory only. Does not call upsertTicket or saveTickets.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyIntentCart, resolveConversationIntent } from "../../src/conversation-intent.ts";
import { gateTicketAcceptance, orderValidation, recoveryAcceptance, ticketFromShadow } from "../../src/offline-evidence.ts";

const outPath = process.argv[2];
if (!outPath) throw new Error("usage: run-restriction-gate.ts <out.json>");
const menu = JSON.parse(readFileSync("/tmp/menu-freeze-preflight/catalog/menu.json", "utf8"));
const turns = [
  "Please add two comal steak tacos.",
  "Add two comal steak tacos without onions.",
  "Only add those two comal steak tacos.",
  "Yes, two comal steak tacos without onions.",
];

function linesOf(cart: any[]) {
  return (cart || []).map((line) => ({
    item_id: line.itemId,
    quantity: Number(line.quantity) || 1,
    modifiers: (line.modifiers || []).map((modifier: any) => ({ step: modifier.step, option: modifier.option })),
    notes: [...(line.elviNotes || []), ...(line.notes || [])],
    validation: line.validation || null,
  }));
}

function reducer() {
  let cart: any[] = [];
  let pending: any = null;
  const history: Array<{ role: "customer" | "assistant"; text: string }> = [];
  const prefixes = [];
  for (const text of turns) {
    const decision = resolveConversationIntent({ transcript: text, language: "en", menu, history, cart, staffTexts: [], pending });
    if (decision?.actions?.length) cart = applyIntentCart(cart, decision.actions);
    if (decision && Object.prototype.hasOwnProperty.call(decision, "pending")) pending = decision.pending ?? null;
    history.push({ role: "customer", text });
    if (decision?.reply) history.push({ role: "assistant", text: decision.reply });
    prefixes.push({ text, kind: decision?.kind || null, actions: decision?.actions || [], reply: decision?.reply || "", pending: decision ? (decision.pending ?? null) : null, cart: linesOf(cart), history: history.map((turn) => ({ ...turn })) });
  }
  return prefixes;
}

async function main() {
  const prefixes = reducer();
  const run: any = async () => ({ actions: [], reply: "" });
  run.menu = () => menu;
  const order: any = await shadowOrderFromTurns(turns.map((text, n) => ({ speaker: "caller", text, language: "en", start: n, end: n + 1 })), run);
  const gateInput = {
    requestedPhase: order.statusCall ? "listening" : "final",
    autoAccepted: order.autoAccepted,
    validation: order.validation,
    reviewReason: order.reviewReason ?? null,
    statusCall: !!order.statusCall,
    cart: order.cart,
    squareRef: order.squareRef ?? null,
    explicitApproval: false,
  };
  const gated = gateTicketAcceptance(gateInput);
  const viewed = ticketFromShadow(order);
  const memory = new Map<string, any>();
  memory.set("synthetic-call", { ...order, cart: order.cart });
  const stored = memory.get("synthetic-call");
  const recovered = recoveryAcceptance(stored);
  const notes = linesOf(order.cart || []).flatMap((line) => line.notes);
  const onionOption = linesOf(order.cart || []).some((line) => line.modifiers.some((modifier) => /onion|cebolla/i.test(modifier.option)));
  const clean = gated.phase === "final" && (gated.acceptance === "validation-complete" || gated.acceptance === "staff-accepted");
  const held = order.pending?.accommodation === "without onions"
    && gated.phase === "review"
    && gated.acceptance === "transcript-final"
    && gated.autoAccepted === false
    && viewed.complete === false
    && recovered.phase === "review"
    && recovered.acceptance === "transcript-final"
    && !clean
    && !onionOption
    && notes.length === 0
    && order.validation === "unresolved";
  const sha = execSync("git rev-parse HEAD", { cwd: "/agent/repos/build-an-app-for-the-apple" }).toString().trim();
  const body = {
    candidate_sha: sha,
    persistence: "Map only. upsertTicket and saveTickets were not called.",
    upsertTicket_called: false,
    reducer: prefixes,
    shadow: {
      validation: order.validation,
      orderValidation: orderValidation(order.cart || []),
      reviewReason: order.reviewReason ?? null,
      autoAccepted: order.autoAccepted,
      pending: order.pending ?? null,
      cart: linesOf(order.cart || []),
      replies: (order.steps || []).filter((step: any) => step.source === "conversation-intent").map((step: any) => ({ heard: step.heard, intent: step.intent, actions: step.actions, reply: step.reply })),
    },
    gate: gated,
    ticketFromShadow: viewed,
    recoveryAcceptance: recovered,
    clean_acceptance_permitted: clean,
    held,
  };
  writeFileSync(outPath, JSON.stringify(body, null, 2));
  console.log(held ? "PASS" : "FAIL", "restriction-reaches-review-gate", JSON.stringify({ phase: gated.phase, acceptance: gated.acceptance, reviewReason: gated.reviewReason, validation: order.validation, pending: order.pending?.accommodation || null }));
  if (!held) process.exit(1);
}
main();
