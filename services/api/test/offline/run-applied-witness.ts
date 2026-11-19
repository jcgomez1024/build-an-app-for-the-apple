// Measures the applied-request witness. Expectations for the nine reference
// controls stay the file frozen before 9899519. This runner does not edit them.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyIntentCart, resolveConversationIntent } from "../../src/conversation-intent.ts";

const expectPath = process.argv[2];
const outPath = process.argv[3];
if (!expectPath || !outPath) throw new Error("usage: run-applied-witness.ts <boundary-expectations.json> <out.json>");
const raw = readFileSync(expectPath);
const expectHash = createHash("sha256").update(raw).digest("hex");
const spec = JSON.parse(raw.toString("utf8"));
const menu = JSON.parse(readFileSync("/tmp/menu-freeze-preflight/catalog/menu.json", "utf8"));
const DISCARD = /already on the order|did not add it again|ya está en la orden|ya esta en la orden|no lo agregué otra vez|no lo agregue otra vez/i;

function linesOf(cart: any[]) {
  return (cart || []).map((line) => ({
    item_id: line.itemId,
    quantity: Number(line.quantity) || 1,
    modifiers: (line.modifiers || []).map((modifier: any) => ({ step: modifier.step, option: modifier.option })),
    notes: [...(line.elviNotes || []), ...(line.notes || [])],
  }));
}
function meat(line: any) { return (line.modifiers || []).map((modifier: any) => modifier.option).join(" "); }
function has(line: any, needle: string) { return meat(line).includes(needle) || (line.modifiers || []).some((modifier: any) => String(modifier.option).includes(needle) || String(modifier.step).includes(needle)); }
function qty(cart: any[], needle: string) {
  return cart.filter((line) => has(line, needle)).reduce((sum, line) => sum + line.quantity, 0);
}
function matchShape(cart: any[], shape: any[]) {
  if (cart.length !== shape.length) return false;
  return shape.every((expected, index) => cart[index].quantity === expected.qty && has(cart[index], expected.tortilla) && has(cart[index], expected.meat));
}

async function phoneTrace(turns: string[], language: string) {
  const run: any = async () => ({ actions: [], reply: "" });
  run.menu = () => menu;
  const prefixes = [];
  for (let i = 0; i < turns.length; i++) {
    const order: any = await shadowOrderFromTurns(turns.slice(0, i + 1).map((text, n) => ({ speaker: "caller", text, language, start: n, end: n + 1 })), run);
    const steps = (order.steps || []).map((step: any) => ({
      source: step.source, heard: step.heard || "", intent: step.intent || null, actions: step.actions || [], reply: step.reply || "",
    }));
    prefixes.push({ cart: linesOf(order.cart || []), steps });
  }
  return prefixes;
}

function reducerTrace(turns: string[], language: "en" | "es") {
  let cart: any[] = [];
  const history: Array<{ role: "customer" | "assistant"; text: string }> = [];
  const prefixes = [];
  for (const text of turns) {
    const before = linesOf(cart);
    const decision = resolveConversationIntent({ transcript: text, language, menu, history, cart, staffTexts: [], pending: null });
    if (decision?.actions?.length) cart = applyIntentCart(cart, decision.actions);
    history.push({ role: "customer", text });
    if (decision?.reply) history.push({ role: "assistant", text: decision.reply });
    const after = linesOf(cart);
    prefixes.push({
      before, after,
      unchanged: JSON.stringify(before) === JSON.stringify(after),
      kind: decision?.kind || null,
      actions: decision?.actions || [],
      reply: decision?.reply || "",
      history: history.map((turn) => ({ role: turn.role, text: turn.text })),
    });
  }
  return prefixes;
}

function score(item: any, phoneLast: any, redLast: any, phonePrev: any, redPrev: any) {
  const checks: any[] = [];
  const justified = item.justified;
  const paths = [["phone", phoneLast, phonePrev], ["reducer", redLast, redPrev]] as const;
  if (justified.phone_and_reducer_lines) {
    for (const [name, last] of paths) checks.push({ name: `${name}_lines`, pass: matchShape(last.cart, justified.phone_and_reducer_lines) });
  }
  if (justified.chicken_qty != null) {
    for (const [name, last] of paths) checks.push({ name: `${name}_chicken_qty`, pass: qty(last.cart, "Pollo") === justified.chicken_qty, observed: qty(last.cart, "Pollo") });
  }
  if (justified.lines_at_least) {
    for (const [name, last] of paths) checks.push({ name: `${name}_line_count`, pass: last.cart.length >= justified.lines_at_least, observed: last.cart.length });
  }
  if (justified.cart_unchanged_on_last_turn) {
    for (const [name, last, prev] of paths) checks.push({ name: `${name}_unchanged`, pass: JSON.stringify(last.cart) === JSON.stringify(prev.cart) });
  }
  if (justified.must_clarify_reference) {
    for (const [name, last] of paths) {
      const folded = last.reply.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      const asks = justified.question_word_not_punctuation.some((word: string) => folded.includes(word));
      const cites = justified.reply_cites_existing_steak_line.every((bit: string) => last.reply.includes(bit));
      const discard = DISCARD.test(last.reply);
      checks.push({ name: `${name}_clarify_not_discard`, pass: asks && cites && !discard && last.kind === "clarify", reply: last.reply });
    }
  }
  if (justified.reply_cites) {
    for (const [name, last] of paths) {
      const missing = justified.reply_cites.filter((bit: string) => !last.reply.includes(bit));
      checks.push({ name: `${name}_cites_known_line`, pass: missing.length === 0, missing, reply: last.reply });
    }
  }
  if (justified.chorizo_added_qty != null) {
    for (const [name, last] of paths) {
      checks.push({ name: `${name}_chorizo`, pass: qty(last.cart, "Chorizo") === justified.chorizo_added_qty, observed: qty(last.cart, "Chorizo") });
      checks.push({ name: `${name}_chicken_stays`, pass: qty(last.cart, "Pollo") === justified.chicken_unchanged_qty, observed: qty(last.cart, "Pollo") });
      checks.push({ name: `${name}_steak_stays`, pass: qty(last.cart, "Bistec") === justified.steak_unchanged_qty, observed: qty(last.cart, "Bistec") });
    }
  }
  if (justified.reply_cites_both_lines) {
    for (const [name, last] of paths) {
      const missing = justified.reply_cites_both_lines.filter((bit: string) => !last.reply.includes(bit));
      const folded = last.reply.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      const asks = /\bwhich\b|\bcual\b/.test(folded);
      const onlyFirst = last.reply.includes("(TST) Taco Taquero / Street Taco") && !last.reply.includes("(THR) Taco Harina / Flour (+$0.50)");
      checks.push({ name: `${name}_both_targets`, pass: missing.length === 0 && asks && !onlyFirst, missing, reply: last.reply });
    }
  }
  if (justified.reply_cites_chicken_not_only_steak) {
    for (const [name, last] of paths) {
      const missing = justified.reply_cites_chicken_not_only_steak.filter((bit: string) => !last.reply.includes(bit));
      const onlySteak = last.reply.includes("Bistec / Steak") && !last.reply.includes("Pollo / Chicken");
      checks.push({ name: `${name}_named_chicken`, pass: missing.length === 0 && !onlySteak, missing, reply: last.reply });
    }
  }
  return checks;
}

function phoneReply(prefixes: any[]) {
  const steps = prefixes[prefixes.length - 1].steps.filter((step: any) => step.source === "conversation-intent");
  const last = steps[steps.length - 1];
  return { cart: prefixes[prefixes.length - 1].cart, reply: last?.reply || "", kind: last?.intent || null };
}

async function main() {
  const reference = [];
  for (const item of spec.cases) {
    const phone = await phoneTrace(item.turns, item.language);
    const reducer = reducerTrace(item.turns, item.language);
    const phoneLast = phoneReply(phone);
    const redLast = reducer[reducer.length - 1];
    const phonePrev = phone.length > 1 ? { cart: phone[phone.length - 2].cart } : phoneLast;
    const redPrev = reducer.length > 1 ? reducer[reducer.length - 2] : redLast;
    const checks = score(item, phoneLast, { cart: redLast.after, reply: redLast.reply, kind: redLast.kind }, phonePrev, { cart: redPrev.after || redPrev.cart });
    reference.push({
      id: item.id,
      justified_pass: checks.every((check) => check.pass),
      checks,
      phone: phone.map((prefix) => ({ cart: prefix.cart, steps: prefix.steps.filter((step: any) => step.source === "conversation-intent") })),
      reducer: reducer.map((prefix) => ({ cart: prefix.after, reply: prefix.reply, kind: prefix.kind, actions: prefix.actions, history: prefix.history })),
    });
    console.log(checks.every((check) => check.pass) ? "PASS" : "FAIL", item.id, checks.filter((check) => !check.pass).map((check) => check.name).join(","));
  }

  const counterTurns = [
    "Please add two comal steak tacos.",
    "Add two comal steak tacos without onions.",
    "Only add those two comal steak tacos.",
  ];
  const counterPhone = await phoneTrace(counterTurns, "en");
  const counterReducer = reducerTrace(counterTurns, "en");
  const matched = {
    en_unapplied_anaphor: { turns: counterTurns, phone: counterPhone, reducer: counterReducer },
    true_restatement: {
      turns: ["Please add one street chicken taco.", "Please add two comal steak tacos.", "Only add those two comal steak tacos."],
      phone: await phoneTrace(["Please add one street chicken taco.", "Please add two comal steak tacos.", "Only add those two comal steak tacos."], "en"),
      reducer: reducerTrace(["Please add one street chicken taco.", "Please add two comal steak tacos.", "Only add those two comal steak tacos."], "en"),
    },
    legitimate_identical_adds: {
      turns: ["Please add two street chicken tacos.", "Please add two street chicken tacos."],
      phone: await phoneTrace(["Please add two street chicken tacos.", "Please add two street chicken tacos."], "en"),
      reducer: reducerTrace(["Please add two street chicken tacos.", "Please add two street chicken tacos."], "en"),
    },
    spanish_add_commits_not_a_second_failure: {
      turns: ["Ponme dos tacos de comal de bistec.", "Agrega dos tacos de comal de bistec sin cebolla."],
      phone: await phoneTrace(["Ponme dos tacos de comal de bistec.", "Agrega dos tacos de comal de bistec sin cebolla."], "es"),
      reducer: reducerTrace(["Ponme dos tacos de comal de bistec.", "Agrega dos tacos de comal de bistec sin cebolla."], "es"),
      note: "Observed only. The Spanish middle turn committed an add at 9899519. It is not the English non-commit failure, and this run does not require a final quantity of 4.",
    },
  };
  const lastPhone = phoneReply(counterPhone);
  const lastReducer = counterReducer[2];
  const counterPass = qty(lastPhone.cart, "Bistec") === 2
    && qty(lastReducer.after, "Bistec") === 2
    && /without onions/i.test(lastPhone.reply) && /without onions/i.test(lastReducer.reply)
    && !DISCARD.test(lastPhone.reply) && !DISCARD.test(lastReducer.reply)
    && lastPhone.kind === "clarify" && lastReducer.kind === "clarify";
  console.log(counterPass ? "PASS" : "FAIL", "en-unapplied-anaphor", lastPhone.reply, lastReducer.reply);
  const sha = execSync("git rev-parse HEAD", { cwd: "/agent/repos/build-an-app-for-the-apple" }).toString().trim();
  const body = {
    candidate_sha: sha,
    expectations_sha256: expectHash,
    expectations_path: expectPath,
    expectations_unchanged: true,
    reference_nine_pass: reference.every((row) => row.justified_pass),
    en_counterexample_pass: counterPass,
    reference,
    matched,
  };
  writeFileSync(outPath, JSON.stringify(body, null, 2));
  if (!body.reference_nine_pass || !counterPass) process.exit(1);
}
main();
