// One replay path for every case: shadowOrderFromTurns on the site phone menu.
// The model stub returns no actions, so the cart is whatever the post-call repairs build.
// No Square, Twilio, caller-memory, or network calls.
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";
import { orderValidation, ticketFromShadow, type Confirmed } from "../../src/offline-evidence.ts";
import { CASES, type OfflineCase } from "./cases.ts";

export type Verdict = "pass" | "fail" | "unresolved-only";

export type CaseResult = {
  id: string;
  title: string;
  role: "candidate" | "control";
  pageNamedGateSatisfied: false;
  verdict: Verdict;
  failures: string[];
  observedLines: Array<{ itemId: string; name: string; qty: number; modifiers: string[]; notes: string[]; validation?: string }>;
  steps: string[];
  ticket: ReturnType<typeof ticketFromShadow>;
  heardName: string | null;
  unresolved: OfflineCase["unresolved"];
  inferredNotAsserted: string[];
};

let menuCache: any[] | null = null;

export function phoneMenu(): any[] {
  if (menuCache) return menuCache;
  menuCache = frozenPhoneMenu();
  if (!menuCache.length) throw new Error("site catalog missing");
  return menuCache;
}

function emptyModel(menu: any[]) {
  const run: any = async () => ({ actions: [], reply: "" });
  run.menu = () => menu;
  return run;
}

function lineBlob(line: any, menu: any[]): string {
  const item = menu.find((m) => m.id === line.itemId);
  const mods = (line.modifiers || []).map((m: any) => `${m.step || ""} ${m.option || ""}`).join(" ");
  const notes = (line.elviNotes || []).join(" ");
  return `${line.itemId || ""} ${item?.name || ""} ${mods} ${notes}`;
}

function matching(lines: any[], menu: any[], match: RegExp[], also?: RegExp) {
  return lines.filter((l) => {
    const blob = lineBlob(l, menu);
    return match.every((re) => re.test(blob)) && (!also || also.test(blob));
  });
}

function qtyOf(lines: any[]): number {
  return lines.reduce((s, l) => s + (Number(l.quantity) || 1), 0);
}

function checkConfirmed(failures: string[], label: string, field: Confirmed<unknown>, ok: boolean, detail: string) {
  if (!ok) failures.push(`${label}: ${detail} [${field.provenance}]`);
}

export async function evaluateCase(c: OfflineCase, menu = phoneMenu()): Promise<CaseResult> {
  const order: any = await shadowOrderFromTurns(c.turns as any, emptyModel(menu));
  const cart: any[] = Array.isArray(order?.cart) ? order.cart : [];
  const failures: string[] = [];
  for (const line of c.lines) {
    const hit = matching(cart, menu, line.match);
    checkConfirmed(failures, line.label, line.qty, qtyOf(hit) === line.qty.value, `qty ${qtyOf(hit)} expected ${line.qty.value}`);
    if (line.lineCount) checkConfirmed(failures, `${line.label} lines`, line.lineCount, hit.length === line.lineCount.value, `lines ${hit.length} expected ${line.lineCount.value}`);
    for (const mod of line.modifiers || []) {
      const blob = hit.map((l) => lineBlob(l, menu)).join(" ");
      checkConfirmed(failures, `${line.label} modifier`, mod, mod.value.test(blob), `missing ${mod.value}`);
    }
  }
  for (const gone of c.absent) {
    const hit = matching(cart, menu, [gone.match], gone.also);
    if (hit.length) failures.push(`${gone.label} still present [${gone.provenance}]`);
  }
  if (c.fulfillment && order?.fulfillment !== c.fulfillment.value) failures.push(`fulfillment ${order?.fulfillment || "none"} expected ${c.fulfillment.value} [${c.fulfillment.provenance}]`);
  const ticket = ticketFromShadow({ ...order, validation: order?.validation || orderValidation(cart) });
  if (c.forbidNoOrder && ticket.noOrder) failures.push(`classified noOrder [${c.forbidNoOrder.provenance}]`);
  if (c.requireNoOrder && !ticket.noOrder) failures.push(`expected noOrder [${c.requireNoOrder.provenance}]`);
  if (c.forbidExistingOrder && ticket.existingOrderCall) failures.push(`classified existing-order [${c.forbidExistingOrder.provenance}]`);
  const heard = nameFromTranscriptInfo(c.turns as any);
  if (c.nameMustNot && heard?.name && c.nameMustNot.value.test(heard.name)) failures.push(`name ${heard.name} matches a forbidden phrase [${c.nameMustNot.provenance}]`);
  const observedLines = cart.map((l) => {
    const item = menu.find((m) => m.id === l.itemId);
    return {
      itemId: String(l.itemId || ""),
      name: String(item?.name || ""),
      qty: Number(l.quantity) || 1,
      modifiers: (l.modifiers || []).map((m: any) => String(m.option || "")),
      notes: (l.elviNotes || []).map((n: string) => String(n)),
      ...(l.validation ? { validation: String(l.validation) } : {}),
    };
  });
  return {
    id: c.id,
    title: c.title,
    role: c.role,
    pageNamedGateSatisfied: false,
    verdict: failures.length ? "fail" : "pass",
    failures,
    observedLines,
    steps: (order?.steps || []).map((s: any) => String(s?.source || "")).filter(Boolean),
    ticket,
    heardName: heard?.name || null,
    unresolved: c.unresolved,
    inferredNotAsserted: c.unresolved.map((u) => u.field),
  };
}

export async function evaluateAll(): Promise<CaseResult[]> {
  const menu = phoneMenu();
  const out: CaseResult[] = [];
  for (const c of CASES) out.push(await evaluateCase(c, menu));
  return out;
}

export function catalogAudit(menu = phoneMenu()) {
  let items = 0;
  let requiredGroups = 0;
  const examples: string[] = [];
  for (const item of menu) {
    const req = (item.modifierGroups || []).filter((g: any) => Number(g.minSelections) > 0);
    if (!req.length) continue;
    items++;
    requiredGroups += req.length;
    if (examples.length < 8) examples.push(`${item.id}: ${req.map((g: any) => g.name).join(", ")}`);
  }
  return { menuItems: menu.length, itemsWithRequiredGroups: items, requiredGroups, examples };
}

export function matrixText(results: CaseResult[], sha: string): string {
  const lines = [
    `offline evidence  code ${sha}`,
    "page named gate: not claimed",
    "path: shadowOrderFromTurns, empty model stub, site phone menu, no network",
    "",
    "id   role       verdict  ticket                         failures",
  ];
  for (const r of results) {
    const ticket = `${r.ticket.phase}/${r.ticket.validation}/complete=${r.ticket.complete}/lines=${r.ticket.lineCount}`;
    lines.push(`${r.id.padEnd(4)} ${r.role.padEnd(10)} ${r.verdict.padEnd(8)} ${ticket.padEnd(42)} ${r.failures.join("; ") || "—"}`);
    if (r.unresolved.length) lines.push(`     unresolved: ${r.unresolved.map((u) => `${u.field} [${u.provenance}]`).join("; ")}`);
  }
  const controls = results.filter((r) => r.role === "control");
  const candidates = results.filter((r) => r.role === "candidate");
  lines.push("");
  lines.push(`controls ${controls.filter((r) => r.verdict === "pass").length}/${controls.length} pass`);
  lines.push(`candidates ${candidates.filter((r) => r.verdict === "pass").length}/${candidates.length} pass, ${candidates.filter((r) => r.verdict === "fail").length} fail`);
  lines.push("candidate failures are findings. They are not counted as a 12/12 gate.");
  return lines.join("\n");
}
