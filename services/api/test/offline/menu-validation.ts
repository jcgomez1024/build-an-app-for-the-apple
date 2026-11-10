// Menu-validator checks. Unit cases call flagUnresolvedRequired. Integration cases call
// shadowOrderFromTurns (the auto-accept boundary) and buildTicketLines (ticket conversion).
// No Square, Twilio send, caller-memory write, or network.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as evidence from "../../src/offline-evidence.ts";

const flagUnresolvedRequired = evidence.flagUnresolvedRequired;
const orderValidation = evidence.orderValidation;
const gateTicketAcceptance = (evidence as { gateTicketAcceptance?: Function }).gateTicketAcceptance;
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
    ...propertyChecks(),
  ];
}

function propertyChecks(): Check[] {
  const menu = [item({ modifierGroups: [meatGroup(1, 1)] }), { id: "sq-side-TEST02", name: "Side", modifierGroups: [] }];
  const bad = { itemId: "sq-quesadilla-TEST01", quantity: 1, modifiers: [{ step: MEAT, option: "Bistec / Steak" }, { step: MEAT, option: "Pollo / Chicken" }], elviNotes: ["verdura aparte"] };
  const good = { itemId: "sq-side-TEST02", quantity: 1, modifiers: [], elviNotes: ["verdura aparte"] };
  const cart = [bad, good];
  flagUnresolvedRequired(cart, menu);
  const once = JSON.stringify(cart);
  const again = flagUnresolvedRequired(cart, menu);
  const nameless = [{ itemId: "sq-quesadilla-TEST01", quantity: 1, modifiers: [] }];
  flagUnresolvedRequired(nameless, [item({ modifierGroups: [{ minSelections: 1, maxSelections: 1, options: ["Bistec / Steak"] }] })]);
  const stale = gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: true, validation: "unresolved", cart: nameless, squareRef: { orderId: "square-kept" } });
  const validGate = gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: true, validation: "clear", cart: [good] });
  const reviewGate = gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: false, validation: "clear", cart: [good] });
  return [
    unit("idempotent-second-pass", again === false && JSON.stringify(cart) === once, String(again)),
    unit("no-cross-item-leakage", good.validation == null && !(good.elviNotes || []).some((n: string) => /^confirmar\b/.test(n)) && bad.validation === "unresolved", JSON.stringify(good.elviNotes)),
    unit("nameless-required-group-unresolved", nameless[0].validation === "unresolved" && (nameless[0].elviNotes || []).includes("confirmar grupo sin nombre"), (nameless[0].elviNotes || []).join(" | ")),
    unit("stale-staff-flag-revalidated", !!stale && stale.phase === "review" && stale.acceptance === "transcript-final" && stale.autoAccepted === false, stale ? `${stale.phase}/${stale.acceptance}` : "gateTicketAcceptance missing"),
    unit("clear-autoaccept-is-validation-complete", !!validGate && validGate.phase === "final" && validGate.acceptance === "validation-complete" && validGate.autoAccepted === true, validGate ? `${validGate.phase}/${validGate.acceptance}` : "gateTicketAcceptance missing"),
    unit("clear-without-autoaccept-stays-final-for-review", !!reviewGate && reviewGate.phase === "final" && reviewGate.acceptance === "validation-complete" && reviewGate.autoAccepted === false, reviewGate ? `${reviewGate.phase}/${reviewGate.acceptance}/${reviewGate.autoAccepted}` : "gateTicketAcceptance missing"),
    ...approvalChecks(),
  ];
}

function approvalChecks(): Check[] {
  const matched = { matchedBy: "only ticket in 20 min", orderId: "guess" };
  const guessed = gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: true, validation: "clear", cart: [{ itemId: "sq-quesadilla-TEST01", quantity: 1 }], squareRef: matched });
  const approved = gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: true, validation: "clear", cart: [{ itemId: "sq-quesadilla-TEST01", quantity: 1 }], explicitApproval: true });
  const contradicted = gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: true, validation: "clear", reviewReason: "confirmar menú: missing", explicitApproval: true, cart: [{ itemId: "sq-quesadilla-TEST01", quantity: 1, elviNotes: ["confirmar grupo sin nombre"] }] });
  const missingField = gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: true, cart: [{ itemId: "sq-quesadilla-TEST01", quantity: 1 }] });
  const recovered = (evidence as { recoveryAcceptance?: Function }).recoveryAcceptance?.({ autoAccepted: true, validation: "unresolved", reviewReason: "confirmar menú: missing", cart: [{ itemId: "sq-quesadilla-TEST01", quantity: 1 }] }) || { phase: "missing", acceptance: "missing" };
  return [
    unit("guessed-square-link-is-not-staff-accepted", !!guessed && guessed.acceptance === "validation-complete" && guessed.phase === "final", guessed ? guessed.acceptance : "gate missing"),
    unit("explicit-approval-is-staff-accepted", !!approved && approved.acceptance === "staff-accepted" && approved.phase === "final", approved ? approved.acceptance : "gate missing"),
    unit("contradictory-approval-stays-review", !!contradicted && contradicted.phase === "review" && contradicted.acceptance === "transcript-final" && contradicted.autoAccepted === false, contradicted ? `${contradicted.phase}/${contradicted.acceptance}` : "gate missing"),
    unit("missing-validation-on-a-line-fails-closed", !!missingField && missingField.phase === "review" && missingField.autoAccepted === false, missingField ? missingField.phase : "gate missing"),
    unit("recovery-unresolved-is-not-final", recovered.phase === "review" && recovered.acceptance === "transcript-final", `${recovered.phase}/${recovered.acceptance}`),
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
  const twilio = await import("../../src/twilio.ts");
  const buildTicketLines = twilio.buildTicketLines;
  const upsertTicket = (twilio as { upsertTicket?: Function }).upsertTicket;
  const noteSquareMatch = (twilio as { noteSquareMatch?: Function }).noteSquareMatch;
  const turns = [{ speaker: "caller" as const, text: "Una quesadilla." }];
  const missing = await shadowOrderFromTurns(turns as any, askingModel([{ type: "add_item", itemId: QID, quantity: 1, modifiers: [] }]));
  const spoken = [{ speaker: "caller" as const, text: "Una quesadilla de bistec de comal." }];
  const valid = await shadowOrderFromTurns(spoken as any, askingModel([{
    type: "add_item", itemId: QID, quantity: 1,
    modifiers: [{ step: TORT, option: QCO }, { step: CARN, option: BISTEC }],
  }]));
  const HOR = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
  const english = await shadowOrderFromTurns([{ speaker: "caller", text: "One steak quesadilla on a homemade tortilla, and one horchata." }] as any, askingModel([
    { type: "add_item", itemId: QID, quantity: 1, modifiers: [{ step: TORT, option: QCO }, { step: CARN, option: BISTEC }] },
    { type: "add_item", itemId: HOR, quantity: 1, modifiers: [] },
  ]));
  const unknown = await shadowOrderFromTurns(turns as any, askingModel([{ type: "add_item", itemId: "sq-not-in-catalog", quantity: 1, modifiers: [] }]));
  const noMenuRun: any = async () => ({ actions: [{ type: "add_item", itemId: QID, quantity: 1, modifiers: [{ step: TORT, option: QCO }, { step: CARN, option: BISTEC }] }], reply: "Listo." });
  const missingLoader = await shadowOrderFromTurns(turns as any, noMenuRun);
  let thrown: any = { validation: "threw", autoAccepted: true, reviewReason: "" };
  try {
    const throwing: any = async () => ({ actions: [], reply: "Listo." });
    throwing.menu = () => { throw new Error("catalog down"); };
    thrown = await shadowOrderFromTurns([{ speaker: "caller", text: "Una quesadilla." }] as any, throwing);
  } catch (err) {
    thrown = { validation: "threw", autoAccepted: true, reviewReason: err instanceof Error ? err.message : String(err) };
  }
  const describe = async (cart: any[]) => cart.map((l) => ({ name: "Quesadilla", quantity: l.quantity || 1, choices: (l.modifiers || []).map((m: any) => String(m.option || "")), totalCents: 0 }));
  const sid = "CAoffline0000000000000000000000ab";
  const kept = [{ itemId: QID, quantity: 1, modifiers: [{ step: TORT, option: QCO }, { step: CARN, option: BISTEC }] }];
  const open = [{ itemId: QID, quantity: 1, modifiers: [], validation: "unresolved", elviNotes: ["confirmar (B) Q Carnes / Meats"] }];
  const accepted = upsertTicket ? await upsertTicket({ callSid: sid, at: "2026-11-07T23:00:00.000Z", caller: "", name: null, phase: "final" }, describe, kept, { autoAccepted: true, validation: "clear", removalsAttributed: true, cart: kept }) : null;
  const matched = accepted && noteSquareMatch ? noteSquareMatch({ phase: accepted.phase, acceptance: accepted.acceptance, reviewReason: accepted.reviewReason, lines: accepted.lines }, { matchedBy: "phone", orderId: "guessed-order", receiptNumber: null, ticketName: null, paymentId: null, dashboardUrl: null, receiptUrl: null, linkedAt: "2026-11-07T23:01:00.000Z" }) : null;
  const downgraded = upsertTicket && accepted ? await upsertTicket({ callSid: sid, at: accepted.at, caller: "", name: null, phase: "final" }, describe, open, { autoAccepted: true, validation: "unresolved", removalsAttributed: true, cart: open }) : null;
  const clearedLater = upsertTicket && downgraded ? await upsertTicket({ callSid: sid, at: downgraded.at, caller: "", name: null, phase: "final" }, describe, kept, { autoAccepted: true, validation: "clear", removalsAttributed: true, cart: kept }) : null;
  const sid2 = "CAoffline0000000000000000000000ac";
  const again = upsertTicket ? await upsertTicket({ callSid: sid2, at: "2026-11-07T23:02:00.000Z", caller: "", name: null, phase: "final" }, describe, kept, { autoAccepted: true, validation: "clear", removalsAttributed: true, cart: kept }) : null;
  const explicit = upsertTicket && again ? await upsertTicket({ callSid: sid2, at: again.at, caller: "", name: null, phase: "final", explicitApproval: true } as any, describe, kept, { autoAccepted: true, validation: "clear", removalsAttributed: true, cart: kept }) : null;
  const held = upsertTicket && explicit ? await upsertTicket({ callSid: sid2, at: explicit.at, caller: "", name: null, phase: "final" }, describe, kept, { autoAccepted: true, validation: "clear", removalsAttributed: true, cart: kept }) : null;
  const linkedAfter = held && noteSquareMatch ? noteSquareMatch(held, { matchedBy: "items", orderId: "guessed-after-approval", receiptNumber: null, ticketName: null, paymentId: null, dashboardUrl: null, receiptUrl: null, linkedAt: "2026-11-07T23:03:00.000Z" }) : null;
  const reopened = upsertTicket && explicit ? await upsertTicket({ callSid: sid2, at: explicit.at, caller: "", name: null, phase: "final" }, describe, open, { autoAccepted: true, validation: "unresolved", reviewReason: "confirmar menú: missing", removalsAttributed: true, cart: open }) : null;
  const restored = upsertTicket && reopened ? await upsertTicket({ callSid: sid2, at: reopened.at, caller: "", name: null, phase: "final" }, describe, kept, { autoAccepted: true, validation: "clear", removalsAttributed: true, cart: kept }) : null;
  const bare: any = async () => ({ actions: [{ type: "add_item", itemId: QID, quantity: 1, modifiers: [{ step: TORT, option: QCO }, { step: CARN, option: BISTEC }] }], reply: "Listo." });
  const recoveredOrder = await shadowOrderFromTurns(turns as any, bare);
  const recoveredGate = (evidence as { recoveryAcceptance?: Function }).recoveryAcceptance?.(recoveredOrder) || { phase: "missing", acceptance: "missing" };
  const attach = (evidence as { attachRecoveryMenu?: Function }).attachRecoveryMenu;
  const attached: any = attach ? attach(async () => ({ actions: [{ type: "add_item", itemId: QID, quantity: 1, modifiers: [{ step: TORT, option: QCO }, { step: CARN, option: BISTEC }] }], reply: "Listo." }), null) : null;
  const nullMenu = attached ? await shadowOrderFromTurns(turns as any, attached) : { validation: "missing", autoAccepted: true, noOrder: true, cart: [] };
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
      ok: valid.validation === "clear" && valid.autoAccepted === false && onMenu(valid) && !valid.reviewReason && !(valid.cart || []).some((l: any) => (l.elviNotes || []).some((note: string) => /^confirmar\b/.test(note))) && gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: valid.autoAccepted, validation: valid.validation, reviewReason: valid.reviewReason, cart: valid.cart }).phase === "final",
      detail: `validation=${valid.validation} reason=${valid.reviewReason || ""} gate=${gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: valid.autoAccepted, validation: valid.validation, reviewReason: valid.reviewReason, cart: valid.cart }).phase} lines=${(valid.cart || []).map((l: any) => `${l.itemId}:${l.validation || "ok"}:${(l.elviNotes || []).join("/")}`).join(" ; ")}`,
    },
    {
      id: "shadow-english-two-line-order-finalizes-clean",
      layer: "integration",
      ok: english.validation === "clear" && (english.cart || []).length >= 2 && !english.reviewReason && !(english.cart || []).some((l: any) => (l.elviNotes || []).some((note: string) => /^confirmar\b/.test(note))) && gateTicketAcceptance?.({ requestedPhase: "final", autoAccepted: english.autoAccepted, validation: english.validation, reviewReason: english.reviewReason, cart: english.cart }).phase === "final",
      detail: `validation=${english.validation} reason=${english.reviewReason || ""} lines=${(english.cart || []).map((l: any) => l.itemId).join(",")}`,
    },
    {
      id: "ticket-does-not-invent-confirmar-on-valid-line",
      layer: "integration",
      ok: !/confirmar /.test(validBlob) && /Quesadilla/.test(validBlob),
      detail: validBlob.slice(0, 400),
    },
    {
      id: "shadow-unknown-sku-blocks-autoaccept",
      layer: "integration",
      ok: unknown.autoAccepted === false && unknown.validation === "unresolved",
      detail: `auto=${unknown.autoAccepted} validation=${unknown.validation}`,
    },
    {
      id: "missing-menu-loader-fails-closed-without-dropping",
      layer: "integration",
      ok: missingLoader.validation === "unresolved" && missingLoader.autoAccepted === false && !missingLoader.noOrder && (missingLoader.cart || []).some((l: any) => l.itemId === QID),
      detail: `auto=${missingLoader.autoAccepted} validation=${missingLoader.validation} noOrder=${missingLoader.noOrder} n=${(missingLoader.cart || []).length} reason=${missingLoader.reviewReason}`,
    },
    {
      id: "throwing-menu-loader-fails-closed",
      layer: "integration",
      ok: thrown.validation === "unresolved" && thrown.autoAccepted === false && thrown.reviewReason === "confirmar menú: throwing",
      detail: `validation=${thrown.validation} reason=${thrown.reviewReason}`,
    },
    {
      id: "persisted-valid-ticket-is-validation-complete",
      layer: "integration",
      ok: !!accepted && accepted.phase === "final" && accepted.acceptance === "validation-complete" && (accepted.lines || []).length > 0,
      detail: accepted ? `${accepted.phase}/${accepted.acceptance}` : "upsertTicket not exported",
    },
    {
      id: "persisted-unresolved-does-not-stay-final",
      layer: "integration",
      ok: !!downgraded && downgraded.phase === "review" && downgraded.acceptance === "transcript-final" && (downgraded.lines || []).length > 0 && downgraded.phase !== "final",
      detail: downgraded ? `${downgraded.phase}/${downgraded.acceptance} lines=${(downgraded.lines || []).length}` : "upsertTicket not exported",
    },
    {
      id: "later-clear-after-review-is-validation-complete",
      layer: "integration",
      ok: !!clearedLater && clearedLater.phase === "final" && clearedLater.acceptance === "validation-complete" && clearedLater.acceptance !== "staff-accepted" && (clearedLater.lines || []).length > 0,
      detail: clearedLater ? `${clearedLater.phase}/${clearedLater.acceptance} lines=${(clearedLater.lines || []).length}` : "upsertTicket not exported",
    },
    {
      id: "matched-link-does-not-upgrade-acceptance",
      layer: "integration",
      ok: !!matched && matched.acceptance === "validation-complete" && matched.squareRef?.matchedBy === "phone",
      detail: matched ? `${matched.acceptance}/${matched.squareRef?.matchedBy}` : "noteSquareMatch not exported",
    },
    {
      id: "later-explicit-approval-after-clear",
      layer: "integration",
      ok: !!again && again.acceptance === "validation-complete" && !!explicit && explicit.acceptance === "staff-accepted" && explicit.phase === "final" && (explicit.lines || []).length > 0,
      detail: explicit ? `${again?.acceptance}->${explicit.acceptance}` : "upsertTicket not exported",
    },
    {
      id: "approval-survives-later-clear-write-and-guessed-link",
      layer: "integration",
      ok: !!held && held.acceptance === "staff-accepted" && held.explicitlyApproved === true && !!linkedAfter && linkedAfter.acceptance === "staff-accepted" && linkedAfter.squareRef?.matchedBy === "items",
      detail: held ? `${held.acceptance}/${held.explicitlyApproved} link=${linkedAfter?.acceptance}/${linkedAfter?.squareRef?.matchedBy}` : "upsertTicket not exported",
    },
    {
      id: "approval-fails-closed-while-unresolved-then-returns",
      layer: "integration",
      ok: !!reopened && reopened.phase === "review" && reopened.acceptance === "transcript-final" && (reopened.lines || []).length > 0 && reopened.explicitlyApproved === true && !!restored && restored.phase === "final" && restored.acceptance === "staff-accepted",
      detail: reopened ? `${reopened.phase}/${reopened.acceptance}/${reopened.explicitlyApproved}->${restored?.phase}/${restored?.acceptance}` : "upsertTicket not exported",
    },
    {
      id: "recovery-without-loader-stays-review",
      layer: "integration",
      ok: recoveredOrder.validation === "unresolved" && !recoveredOrder.noOrder && (recoveredOrder.cart || []).length > 0 && recoveredGate.phase === "review" && recoveredGate.acceptance === "transcript-final",
      detail: `order=${recoveredOrder.validation}/${recoveredOrder.reviewReason} gate=${recoveredGate.phase}/${recoveredGate.acceptance} n=${(recoveredOrder.cart || []).length}`,
    },
    {
      id: "recovery-null-menu-attachment-fails-closed",
      layer: "integration",
      ok: !!attached && typeof attached.menu === "function" && nullMenu.validation === "unresolved" && nullMenu.autoAccepted === false && !nullMenu.noOrder && (nullMenu.cart || []).length > 0,
      detail: attached ? `validation=${nullMenu.validation} auto=${nullMenu.autoAccepted} n=${(nullMenu.cart || []).length}` : "attachRecoveryMenu missing",
    },
  ];
}

export async function menuValidationReport(): Promise<Check[]> {
  return [...unitChecks(), ...await integrationChecks()];
}
