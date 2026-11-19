// Records the English restriction answer. Phone pending is not returned by
// shadowOrderFromTurns, so that field stays UNVERIFIED. Reducer pending is the
// decision object. This does not score the 75 frozen prefixes.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyIntentCart, resolveConversationIntent } from "../../src/conversation-intent.ts";

const outPath = process.argv[2];
if (!outPath) throw new Error("usage: run-restriction-hold.ts <out.json>");
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
  }));
}

async function phone() {
  const run: any = async () => ({ actions: [], reply: "" });
  run.menu = () => menu;
  const prefixes = [];
  for (let i = 0; i < turns.length; i++) {
    const order: any = await shadowOrderFromTurns(turns.slice(0, i + 1).map((text, n) => ({ speaker: "caller", text, language: "en", start: n, end: n + 1 })), run);
    prefixes.push({
      cart: linesOf(order.cart || []),
      pending: "UNVERIFIED",
      pending_reason: "shadowOrderFromTurns does not return the pending object.",
      steps: (order.steps || []).map((step: any) => ({ source: step.source, heard: step.heard || "", intent: step.intent || null, actions: step.actions || [], reply: step.reply || "" })),
    });
  }
  return prefixes;
}

function reducer() {
  let cart: any[] = [];
  let pending: any = null;
  const history: Array<{ role: "customer" | "assistant"; text: string }> = [];
  const prefixes = [];
  for (const text of turns) {
    const before = linesOf(cart);
    const decision = resolveConversationIntent({ transcript: text, language: "en", menu, history, cart, staffTexts: [], pending });
    if (decision?.actions?.length) cart = applyIntentCart(cart, decision.actions);
    if (decision && Object.prototype.hasOwnProperty.call(decision, "pending")) pending = decision.pending ?? null;
    history.push({ role: "customer", text });
    if (decision?.reply) history.push({ role: "assistant", text: decision.reply });
    prefixes.push({
      before,
      after: linesOf(cart),
      kind: decision?.kind || null,
      actions: decision?.actions || [],
      reply: decision?.reply || "",
      pending: decision ? (decision.pending ?? null) : "UNVERIFIED",
      history: history.map((turn) => ({ role: turn.role, text: turn.text })),
    });
  }
  return prefixes;
}

async function main() {
  const phonePrefixes = await phone();
  const reducerPrefixes = reducer();
  const sha = execSync("git rev-parse HEAD", { cwd: "/agent/repos/build-an-app-for-the-apple" }).toString().trim();
  const body = {
    candidate_sha: sha,
    turns,
    phone_pending: "UNVERIFIED",
    phone: phonePrefixes,
    reducer: reducerPrefixes,
  };
  writeFileSync(outPath, JSON.stringify(body, null, 2));
  const last = reducerPrefixes[reducerPrefixes.length - 1];
  const phoneLast = phonePrefixes[phonePrefixes.length - 1];
  const intent = [...phoneLast.steps].reverse().find((step) => step.source === "conversation-intent");
  console.log(last.pending?.accommodation === "without onions" ? "PASS" : "FAIL", "reducer-pending", JSON.stringify(last.pending));
  console.log(intent?.reply || "");
  console.log(last.reply);
  console.log(JSON.stringify(last.after));
  console.log(JSON.stringify(phoneLast.cart));
}
main();
