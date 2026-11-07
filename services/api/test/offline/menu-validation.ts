// Menu-validator checks. Unit cases call flagUnresolvedRequired. Integration cases call
// shadowOrderFromTurns (the auto-accept boundary) and buildTicketLines (ticket conversion).
// No Square, Twilio send, caller-memory write, or network.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { flagUnresolvedRequired, orderValidation } from "../../src/offline-evidence.ts";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { phoneMenu } from "./evaluate.ts";

process.env.ELVI_CALLERS_FILE ||= path.join(mkdtempSync(path.join(os.tmpdir(), "menu-val-")), "callers.json");
process.env.ELVI_CALL_LOG_DIR ||= path.join(path.dirname(process.env.ELVI_CALLERS_FILE), "logs");

export type Check = { id: string; layer: "unit" | "integration"; ok: boolean; detail: string };

const MEAT = "(B) Carnes";
const meatGroup = (min: number, max: number) => ({
  name: MEAT,
  minSelections: min,
  maxSelections: max,
  options: ["Bistec / Steak", "Pollo / Chicken", "Lengua / Beef Tongue"],
});
const item = (extra: any = {}) => ({ id: "sq-quesadilla-TEST01", name: "Quesadilla", modifierGroups: [meatGroup(1, 1)], ...extra });
const line = (modifiers: any[], extra: any = {}) => ({ itemId: "sq-quesadilla-TEST01", quantity: 1, modifiers, elviNotes: ["verdura aparte"], ...extra });

function stateOf(cart: any[], menu: any): { validation: string; notes: string[] } {
  flagUnresolvedRequired(cart, menu);
  return { validation: orderValidation(cart), notes: [...(cart[0]?.elviNotes || [])] };
}

function unit(id: string, ok: boolean, detail: string): Check {
  return { id, layer: "unit", ok, detail };
}

export function unitChecks(): Check[] {
  const menu = [item()];
  const dup = line([{ step: MEAT, option: "Bistec / Steak" }, { step: MEAT, option: "Bistec / Steak" }]);
  const dupMenu = [item({ modifierGroups: [meatGroup(2, 3)] })];
  const dupState = stateOf([dup], dupMenu);
  const alien = line([{ step: MEAT, option: "Not A Catalog Meat" }]);
  const alienState = stateOf([alien], menu);
  const okLine = line([{ step: MEAT, option: "Bistec / Steak" }]);
  const okState = stateOf([okLine], menu);
  const two = line([{ step: MEAT, option: "Bistec / Steak" }, { step: MEAT, option: "Pollo / Chicken" }]);
  const twoState = stateOf([two], menu);
  const span = line([{ step: MEAT, option: "Bistec / Steak" }, { step: MEAT, option: "Pollo / Chicken" }]);
  const spanState = stateOf([span], [item({ modifierGroups: [meatGroup(2, 3)] })]);
  const unknown = line([]);
  unknown.itemId = "sq-not-in-catalog";
  const unknownState = stateOf([unknown], menu);
  const sold = line([{ step: MEAT, option: "Bistec / Steak" }]);
  const soldState = stateOf([sold], [item({ soldOut: true })]);
  const qty = line([{ step: MEAT, option: "Bistec / Steak" }], { quantity: 0 });
  const qtyState = stateOf([qty], menu);
  const over = line([{ step: MEAT, option: "Bistec / Steak" }], { quantity: 9 });
  const overState = stateOf([over], [item({ maxQuantity: 4 })]);
  const within = line([{ step: MEAT, option: "Bistec / Steak" }], { quantity: 2 });
  const withinState = stateOf([within], [item({ maxQuantity: 4, minQuantity: 1 })]);
  const empty = stateOf([line([])], []);
  const absent = stateOf([line([])], null as any);
  const malformed = stateOf([line([])], [{ name: "no id" }] as any);
  const unavailable = stateOf([line([{ step: MEAT, option: "Bistec / Steak" }])], [item({ available: false })]);
  const kept = line([{ step: MEAT, option: "Not A Catalog Meat" }]);
  stateOf([kept], menu);
  return [
    unit("duplicate-does-not-meet-min", dupState.validation === "unresolved", dupState.validation),
    unit("non-member-does-not-meet-min", alienState.validation === "unresolved", alienState.validation),
    unit("one-catalog-choice-meets-min-max", okState.validation === "clear" && okLine.validation == null, okState.validation),
    unit("two-choices-exceed-max-1", twoState.validation === "unresolved", twoState.validation),
    unit("two-distinct-choices-within-max-3", spanState.validation === "clear", spanState.validation),
    unit("unknown-sku-unresolved", unknownState.validation === "unresolved" && unknownState.notes.some((n) => /no está en el menú/.test(n)), unknownState.notes.join(" | ")),
    unit("sold-out-sku-unresolved", soldState.validation === "unresolved", soldState.notes.join(" | ")),
    unit("quantity-zero-unresolved", qtyState.validation === "unresolved", qtyState.notes.join(" | ")),
    unit("quantity-above-max-unresolved", overState.validation === "unresolved", overState.notes.join(" | ")),
    unit("quantity-within-min-max-clear", withinState.validation === "clear", withinState.validation),
    unit("empty-menu-unresolved", empty.validation === "unresolved" && empty.notes.some((n) => /menú: empty/.test(n)), empty.notes.join(" | ")),
    unit("absent-menu-unresolved", absent.validation === "unresolved" && absent.notes.some((n) => /menú: absent/.test(n)), absent.notes.join(" | ")),
    unit("malformed-menu-unresolved", malformed.validation === "unresolved" && malformed.notes.some((n) => /menú: malformed/.test(n)), malformed.notes.join(" | ")),
    unit("unavailable-menu-unresolved", unavailable.validation === "unresolved" && unavailable.notes.some((n) => /menú: unavailable/.test(n)), unavailable.notes.join(" | ")),
    unit("staff-note-survives-failed-validation", (kept.elviNotes || []).includes("verdura aparte"), (kept.elviNotes || []).join(" | ")),
  ];
}

const QID = "sq-quesadilla-HLT6CR";
const TORT = "(A) Q Tortilla Options";
const CARN = "(B) Q Carnes / Meats";
const QCO = "(QCO) Quesadilla Comal / Homemade";
const BISTEC = "Bistec / Steak";

function askingModel(actions: any[]) {
  const menu = phoneMenu();
  const run: any = async (text: string) => {
    if (/así está bien|that'?s fine/i.test(text)) return { actions: [], reply: "Listo." };
    return { actions, reply: "¿De qué carne?" };
  };
  run.menu = () => menu;
  return run;
}

export async function integrationChecks(): Promise<Check[]> {
  const { buildTicketLines } = await import("../../src/twilio.ts");
  const turns = [{ speaker: "caller" as const, text: "Una quesadilla." }];
  const missing = await shadowOrderFromTurns(turns as any, askingModel([{ type: "add_item", itemId: QID, quantity: 1, modifiers: [] }]));
  const valid = await shadowOrderFromTurns(turns as any, askingModel([{
    type: "add_item", itemId: QID, quantity: 1,
    modifiers: [{ step: TORT, option: QCO }, { step: CARN, option: BISTEC }],
  }]));
  const unknown = await shadowOrderFromTurns(turns as any, askingModel([{ type: "add_item", itemId: "sq-not-in-catalog", quantity: 1, modifiers: [] }]));
  const ticketOf = (order: any) => buildTicketLines(
    (order.cart || []).map((l: any) => ({ name: "Quesadilla", quantity: l.quantity || 1, choices: (l.modifiers || []).map((m: any) => String(m.option || "")) })),
    order.cart || [],
    [],
    undefined,
    order.containers || null,
    { attributed: true, ambiguous: order.ambiguousRemovals || [] },
  );
  const missingTicket = ticketOf(missing);
  const validTicket = ticketOf(valid);
  const missingBlob = JSON.stringify(missingTicket);
  const validBlob = JSON.stringify(validTicket);
  const onMenu = (order: any) => (order.cart || []).some((l: any) => l.itemId === QID);
  return [
    {
      id: "shadow-missing-required-blocks-autoaccept",
      layer: "integration",
      ok: missing.autoAccepted === false && missing.validation === "unresolved" && onMenu(missing),
      detail: `auto=${missing.autoAccepted} validation=${missing.validation} lines=${(missing.cart || []).map((l: any) => l.itemId).join(",")}`,
    },
    {
      id: "ticket-keeps-confirmar-after-conversion",
      layer: "integration",
      ok: /confirmar /.test(missingBlob),
      detail: missingBlob.slice(0, 400),
    },
    {
      id: "shadow-valid-catalog-choices-stay-accepted",
      layer: "integration",
      ok: valid.autoAccepted === true && valid.validation === "clear" && onMenu(valid),
      detail: `auto=${valid.autoAccepted} validation=${valid.validation} lines=${(valid.cart || []).map((l: any) => `${l.itemId}:${l.validation || "ok"}:${(l.elviNotes || []).join("/")}`).join(" ; ")}`,
    },
    {
      id: "ticket-does-not-invent-confirmar-on-valid-line",
      layer: "integration",
      ok: !/confirmar /.test(validBlob),
      detail: validBlob.slice(0, 400),
    },
    {
      id: "shadow-unknown-sku-blocks-autoaccept",
      layer: "integration",
      ok: unknown.autoAccepted === false && unknown.validation === "unresolved",
      detail: `auto=${unknown.autoAccepted} validation=${unknown.validation}`,
    },
  ];
}

export async function menuValidationReport(): Promise<Check[]> {
  return [...unitChecks(), ...await integrationChecks()];
}
