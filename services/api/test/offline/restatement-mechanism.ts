// General mechanism checks for a restated add versus a new identical add.
// Not a fixture oracle and not a case-id branch.
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";

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

  for (const check of checks) console.log(check.ok ? "PASS" : "FAIL", check.id, check.detail);
  if (checks.some((check) => !check.ok)) process.exit(1);
}
main();
