// General mechanism checks for a restated add versus a new identical add.
// Not a fixture oracle and not a case-id branch.
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyIntentCart, resolveConversationIntent } from "../../src/conversation-intent.ts";

const menu = JSON.parse(readFileSync("/tmp/menu-freeze-preflight/catalog/menu.json", "utf8"));

function cartSig(lines: any[]) {
  return (lines || []).map((line) => `${line.quantity}x ${line.itemId} [${(line.modifiers || []).map((m: any) => `${m.step}=${m.option}`).join("; ")}]`).join(" || ") || "EMPTY";
}

async function shadow(turns: string[]) {
  const run: any = async () => ({ actions: [], reply: "" });
  run.menu = () => menu;
  const order: any = await shadowOrderFromTurns(turns.map((text, n) => ({ speaker: "caller", text, language: "en", start: n, end: n + 1 })), run);
  const steps = (order.steps || []).filter((step: any) => step.source === "conversation-intent");
  return { cart: cartSig(order.cart || []), reply: steps[steps.length - 1]?.reply || "", lines: order.cart || [] };
}

function reducer(turns: string[]) {
  let cart: any[] = [];
  const history: Array<{ role: "customer" | "assistant"; text: string }> = [];
  let reply = "";
  for (const text of turns) {
    const decision = resolveConversationIntent({ transcript: text, language: "en", menu, history, cart, staffTexts: [], pending: null });
    if (decision?.actions?.length) cart = applyIntentCart(cart, decision.actions);
    history.push({ role: "customer", text });
    if (decision?.reply) history.push({ role: "assistant", text: decision.reply });
    reply = decision?.reply || "";
  }
  return { cart: cartSig(cart), reply, lines: cart };
}

function countSteak(lines: any[]) {
  return (lines || []).filter((line) => /Bistec/.test((line.modifiers || []).map((m: any) => m.option).join(" ")))
    .reduce((sum: number, line: any) => sum + (Number(line.quantity) || 1), 0);
}

async function main() {
  const checks: Array<{ id: string; ok: boolean; detail: string }> = [];
  const repeated = await shadow([
    "Please add two street chicken tacos.",
    "Please add two street chicken tacos.",
  ]);
  const repeatedQty = (repeated.lines || []).filter((line: any) => /Pollo/.test((line.modifiers || []).map((m: any) => m.option).join(" ")))
    .reduce((sum: number, line: any) => sum + (Number(line.quantity) || 1), 0);
  checks.push({ id: "legitimate-identical-add", ok: repeatedQty === 4, detail: `${repeated.cart} qty ${repeatedQty}` });

  const more = await shadow([
    "Please add two street chicken tacos.",
    "Also add two street chicken tacos.",
  ]);
  const moreQty = (more.lines || []).filter((line: any) => /Pollo/.test((line.modifiers || []).map((m: any) => m.option).join(" ")))
    .reduce((sum: number, line: any) => sum + (Number(line.quantity) || 1), 0);
  checks.push({ id: "intentional-additional-quantity", ok: moreQty === 4, detail: `${more.cart} qty ${moreQty}` });

  const restated = await shadow([
    "Please add one street chicken taco.",
    "Please add two comal steak tacos.",
    "Only add those two comal steak tacos.",
  ]);
  const steak = (restated.lines || []).filter((line: any) => /Bistec/.test((line.modifiers || []).map((m: any) => m.option).join(" ")));
  const chicken = (restated.lines || []).filter((line: any) => /Pollo/.test((line.modifiers || []).map((m: any) => m.option).join(" ")));
  const steakQty = steak.reduce((sum: number, line: any) => sum + (Number(line.quantity) || 1), 0);
  const steakComal = steak.length === 1 && (steak[0].modifiers || []).some((m: any) => m.step === "(A) T Tortilla Options" && /Comal/.test(m.option));
  const chickenKept = chicken.length === 1 && Number(chicken[0].quantity) === 1
    && (chicken[0].modifiers || []).some((m: any) => m.step === "(A) T Tortilla Options" && /Street/.test(m.option));
  checks.push({ id: "restatement-does-not-duplicate", ok: steak.length === 1 && steakQty === 2 && steakComal && chickenKept, detail: restated.cart });

  const compound = await shadow([
    "Please add one street chicken taco.",
    "Add two comal steak tacos and change the earlier taco.",
  ]);
  const compoundSteak = (compound.lines || []).filter((line: any) => /Bistec/.test((line.modifiers || []).map((m: any) => m.option).join(" ")));
  const compoundChicken = (compound.lines || []).filter((line: any) => /Pollo/.test((line.modifiers || []).map((m: any) => m.option).join(" ")));
  const cites = compound.reply.includes("(TST) Taco Taquero / Street Taco")
    && compound.reply.includes("Pollo / Chicken")
    && compound.reply.includes("(A) T Tortilla Options")
    && compound.reply.includes("(B) T Carnes / Meats Opciones");
  const chickenUntouched = compoundChicken.length === 1 && Number(compoundChicken[0].quantity) === 1;
  const steakOnce = compoundSteak.length === 1
    && compoundSteak.reduce((sum: number, line: any) => sum + (Number(line.quantity) || 1), 0) === 2
    && (compoundSteak[0].modifiers || []).some((m: any) => m.step === "(A) T Tortilla Options" && /Comal/.test(m.option));
  checks.push({ id: "unresolved-change-acknowledged-add-kept", ok: cites && chickenUntouched && steakOnce, detail: `${compound.cart} :: ${compound.reply}` });

  const unrelated = await shadow([
    "Please add two comal steak tacos.",
    "Please add one street chicken taco.",
    "Only add those two comal steak tacos.",
  ]);
  const unrelatedSteak = (unrelated.lines || []).filter((line: any) => /Bistec/.test((line.modifiers || []).map((m: any) => m.option).join(" ")))
    .reduce((sum: number, line: any) => sum + (Number(line.quantity) || 1), 0);
  const asksWhich = /\bwhich\b/i.test(unrelated.reply) && !/already on the order/i.test(unrelated.reply);
  const citesSteak = unrelated.reply.includes("(TCO) Taco Comal / Homemade (+$1.00)") && unrelated.reply.includes("(A) T Tortilla Options");
  checks.push({ id: "new-anaphor-does-not-discard", ok: unrelatedSteak === 2 && asksWhich && citesSteak, detail: `${unrelated.cart} :: ${unrelated.reply}` });

  const ambiguous = await shadow([
    "Please add one street chicken taco.",
    "Please add one flour steak taco.",
    "Add two comal chorizo tacos and change the earlier taco.",
  ]);
  const both = ambiguous.reply.includes("(TST) Taco Taquero / Street Taco") && ambiguous.reply.includes("(THR) Taco Harina / Flour (+$0.50)") && /\bwhich\b/i.test(ambiguous.reply);
  const chorizo = (ambiguous.lines || []).some((line: any) => /Chorizo/.test((line.modifiers || []).map((m: any) => m.option).join(" ")) && Number(line.quantity) === 2);
  checks.push({ id: "ambiguous-earlier-cites-both", ok: both && chorizo, detail: `${ambiguous.cart} :: ${ambiguous.reply}` });

  const named = await shadow([
    "Please add one flour steak taco.",
    "Please add one street chicken taco.",
    "Add two comal chorizo tacos and change the earlier street chicken taco.",
  ]);
  const citesChicken = named.reply.includes("Pollo / Chicken") && named.reply.includes("(TST) Taco Taquero / Street Taco");
  const notOnlySteak = !(named.reply.includes("Bistec / Steak") && !named.reply.includes("Pollo / Chicken"));
  const namedChorizo = (named.lines || []).some((line: any) => /Chorizo/.test((line.modifiers || []).map((m: any) => m.option).join(" ")));
  checks.push({ id: "named-earlier-line-not-position-zero", ok: citesChicken && notOnlySteak && namedChorizo, detail: `${named.cart} :: ${named.reply}` });

  const unappliedTurns = [
    "Please add two comal steak tacos.",
    "Add two comal steak tacos without onions.",
    "Only add those two comal steak tacos.",
  ];
  const unappliedPhone = await shadow(unappliedTurns);
  const unappliedReducer = reducer(unappliedTurns);
  const unappliedReplyOk = (reply: string) => /without onions/i.test(reply)
    && !/already on the order|did not add it again/i.test(reply)
    && /did not apply the previous request/i.test(reply)
    && /did not add it/i.test(reply);
  checks.push({
    id: "unapplied-anaphor-clarifies-phone",
    ok: countSteak(unappliedPhone.lines) === 2 && unappliedReplyOk(unappliedPhone.reply),
    detail: `${unappliedPhone.cart} :: ${unappliedPhone.reply}`,
  });
  checks.push({
    id: "unapplied-anaphor-clarifies-reducer",
    ok: countSteak(unappliedReducer.lines) === 2 && unappliedReplyOk(unappliedReducer.reply),
    detail: `${unappliedReducer.cart} :: ${unappliedReducer.reply}`,
  });

  const trueTurns = [
    "Please add one street chicken taco.",
    "Please add two comal steak tacos.",
    "Only add those two comal steak tacos.",
  ];
  const truePhone = await shadow(trueTurns);
  const trueReducer = reducer(trueTurns);
  const trueOk = (lines: any[], reply: string) => countSteak(lines) === 2 && /already on the order/i.test(reply);
  checks.push({ id: "true-restatement-still-suppresses-phone", ok: trueOk(truePhone.lines, truePhone.reply), detail: `${truePhone.cart} :: ${truePhone.reply}` });
  checks.push({ id: "true-restatement-still-suppresses-reducer", ok: trueOk(trueReducer.lines, trueReducer.reply), detail: `${trueReducer.cart} :: ${trueReducer.reply}` });

  const legitReducer = reducer([
    "Please add two street chicken tacos.",
    "Please add two street chicken tacos.",
  ]);
  const legitQty = (legitReducer.lines || []).filter((line: any) => /Pollo/.test((line.modifiers || []).map((m: any) => m.option).join(" ")))
    .reduce((sum: number, line: any) => sum + (Number(line.quantity) || 1), 0);
  checks.push({ id: "legitimate-identical-add-reducer", ok: legitQty === 4 && legitReducer.lines.length >= 2, detail: `${legitReducer.cart} qty ${legitQty}` });

  for (const check of checks) console.log(check.ok ? "PASS" : "FAIL", check.id, check.detail);
  if (checks.some((check) => !check.ok)) process.exit(1);
}
main();
