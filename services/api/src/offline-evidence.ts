// Offline evidence for order state. Confirmed speech and inferences stay in separate fields.
// Nothing here calls Square, Twilio, or caller memory.

export type Provenance = "transcript" | "staff-readback" | "pos-verified" | "inferred" | "synthetic" | "catalog-default" | "catalog-required";

/** Values a test may assert. Inferred, catalog, and POS labels are not ground truth. */
export type ConfirmedProvenance = "transcript" | "staff-readback" | "synthetic";

export type Confirmed<T> = { value: T; provenance: ConfirmedProvenance; note?: string };

export type UnresolvedField = {
  field: string;
  provenance: Exclude<Provenance, ConfirmedProvenance>;
  note: string;
};

const CONFIRMED = new Set<Provenance>(["transcript", "staff-readback", "synthetic"]);

export function isConfirmedProvenance(p: Provenance): p is ConfirmedProvenance {
  return CONFIRMED.has(p);
}

type Group = { name?: string; minSelections?: number; maxSelections?: number; min?: number; max?: number; options?: any[]; allowQuantities?: boolean };
type MenuItem = { id?: string; modifierGroups?: Group[] | unknown; available?: boolean; unavailable?: boolean; soldOut?: boolean; minQuantity?: number; maxQuantity?: number; quantityMin?: number; quantityMax?: number };

const foldOpt = (s: string) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s*\(\+\s*\$[\d.]+\)\s*$/g, "").replace(/\s+/g, " ").trim();
function optionName(o: any): string {
  return typeof o === "string" ? o : String(o?.name || o?.option || "");
}
function groupMin(g: Group): number {
  const n = Number(g?.minSelections ?? g?.min ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
/** Site `max: 0` means no cap. A positive max is the most distinct valid choices. */
function groupMax(g: Group): number | null {
  const raw = g?.maxSelections ?? g?.max;
  if (raw == null || raw === ("" as any)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function finiteInt(n: unknown): number | null {
  const v = Number(n);
  return Number.isInteger(v) ? v : null;
}
function usableItem(m: any): m is MenuItem & { id: string } {
  return !!m && typeof m === "object" && typeof m.id === "string" && m.id.length > 0;
}
function itemUnavailable(item: MenuItem): boolean {
  return item.available === false || item.unavailable === true || item.soldOut === true;
}
type MenuProblem = "absent" | "empty" | "malformed" | "unavailable" | null;
function menuProblem(menu: unknown): MenuProblem {
  if (menu == null) return "absent";
  if (!Array.isArray(menu)) return "malformed";
  if (!menu.length) return "empty";
  if (menu.some((m) => !usableItem(m))) return "malformed";
  if (menu.every((m) => itemUnavailable(m))) return "unavailable";
  return null;
}
function notesOf(line: any): string[] {
  if (!Array.isArray(line.elviNotes)) line.elviNotes = [];
  return line.elviNotes;
}
function addNote(notes: string[], marker: string): boolean {
  if (notes.includes(marker)) return false;
  notes.push(marker);
  return true;
}
function dropNote(notes: string[], marker: string): boolean {
  const i = notes.indexOf(marker);
  if (i < 0) return false;
  notes.splice(i, 1);
  return true;
}
/** Distinct catalog options this line actually selected for the group. Duplicates and non-members do not count. */
function validChoiceCount(line: any, g: Group): { count: number; invalid: boolean; unusable: boolean } {
  const listed = Array.isArray(g.options) ? g.options.map(optionName).map((n) => n.trim()).filter(Boolean) : null;
  if (!listed) return { count: 0, invalid: false, unusable: true };
  const catalog = new Map(listed.map((n) => [foldOpt(n), n]));
  const distinct = new Map<string, number>();
  let invalid = false;
  for (const raw of (line?.modifiers || []).filter((m: any) => m?.step === g.name)) {
    const hit = catalog.get(foldOpt(optionName(raw?.option ?? raw?.name)));
    if (!hit) { invalid = true; continue; }
    const qty = raw?.quantity == null ? 1 : finiteInt(raw.quantity);
    if (qty == null || qty < 1) { invalid = true; continue; }
    const key = foldOpt(hit);
    distinct.set(key, (distinct.get(key) || 0) + (g.allowQuantities ? qty : 0));
    if (!g.allowQuantities) distinct.set(key, 1);
  }
  const count = g.allowQuantities ? [...distinct.values()].reduce((s, n) => s + n, 0) : distinct.size;
  return { count, invalid, unusable: false };
}
function groupUnresolved(line: any, g: Group): boolean {
  if (!g?.name) return groupMin(g) > 0;
  const min = groupMin(g);
  const max = groupMax(g);
  const { count, invalid, unusable } = validChoiceCount(line, g);
  if (unusable) return min > 0 || (line?.modifiers || []).some((m: any) => m?.step === g.name);
  if (invalid) return true;
  if (count < min) return true;
  if (max != null && count > max) return true;
  return false;
}

export type MenuLoader = "ok" | "missing" | "throwing";

/** Required choices must be distinct members of that group's catalog options. A bad menu cannot look resolved. No option is invented. */
export function flagUnresolvedRequired(cart: any[], menu: MenuItem[] | null | undefined, loader: MenuLoader = "ok"): boolean {
  if (!Array.isArray(cart)) return false;
  let changed = false;
  const problem = loader === "ok" ? menuProblem(menu) : loader;
  if (problem) {
    const marker = `confirmar menú: ${problem}`;
    for (const line of cart) {
      const notes = notesOf(line);
      if (addNote(notes, marker)) changed = true;
      if (line.validation !== "unresolved") { line.validation = "unresolved"; changed = true; }
      if (!notes.length) delete line.elviNotes;
    }
    return changed;
  }
  const items = menu as MenuItem[];
  for (const line of cart) {
    const notes = notesOf(line);
    let bad = false;
    const item = items.find((m) => m?.id === line?.itemId);
    if (!item) {
      bad = true;
      if (addNote(notes, "confirmar catálogo: ítem no está en el menú")) changed = true;
    } else if (itemUnavailable(item)) {
      bad = true;
      if (addNote(notes, "confirmar catálogo: ítem no disponible")) changed = true;
    } else {
      if (dropNote(notes, "confirmar catálogo: ítem no está en el menú")) changed = true;
      if (dropNote(notes, "confirmar catálogo: ítem no disponible")) changed = true;
      const qty = finiteInt(line?.quantity);
      const minQ = finiteInt(item.minQuantity ?? item.quantityMin);
      const maxQ = finiteInt(item.maxQuantity ?? item.quantityMax);
      const qtyBad = qty == null || qty < 1 || (minQ != null && minQ > 0 && qty < minQ) || (maxQ != null && maxQ > 0 && qty > maxQ);
      if (qtyBad) { bad = true; if (addNote(notes, "confirmar cantidad")) changed = true; }
      else if (dropNote(notes, "confirmar cantidad")) changed = true;
      const groups = Array.isArray(item.modifierGroups) ? item.modifierGroups : null;
      if (!groups) {
        if (item.modifierGroups != null) { bad = true; if (addNote(notes, "confirmar menú: malformed")) changed = true; }
      } else {
        if (dropNote(notes, "confirmar menú: malformed")) changed = true;
        for (const g of groups) {
          const name = String(g?.name || "").trim();
          if (!name) {
            if (groupMin(g) > 0) { bad = true; if (addNote(notes, "confirmar grupo sin nombre")) changed = true; }
            else if (dropNote(notes, "confirmar grupo sin nombre")) changed = true;
            continue;
          }
          if (dropNote(notes, "confirmar grupo sin nombre")) changed = true;
          const marker = `confirmar ${name}`;
          if (groupUnresolved(line, g)) { bad = true; if (addNote(notes, marker)) changed = true; }
          else if (dropNote(notes, marker)) changed = true;
        }
      }
    }
    const still = notes.some((n) => /^confirmar\b/i.test(n));
    if (bad || still) { if (line.validation !== "unresolved") { line.validation = "unresolved"; changed = true; } }
    else if (line.validation === "unresolved") { delete line.validation; changed = true; }
    if (!notes.length) delete line.elviNotes;
  }
  return changed;
}

export function orderValidation(cart: any[]): "unresolved" | "clear" | "empty" {
  if (!Array.isArray(cart) || !cart.length) return "empty";
  const open = cart.some((l) => l?.validation === "unresolved" || (l?.elviNotes || []).some((n: string) => /^confirmar\b/i.test(String(n))));
  return open ? "unresolved" : "clear";
}

export type TicketAcceptance = "transcript-final" | "validation-complete" | "staff-accepted";
export type TicketPhase = "listening" | "review" | "final";

function cartUnresolved(cart: any[] | null | undefined): boolean {
  return (cart || []).some((l) => l?.validation === "unresolved" || (l?.elviNotes || []).some((n: string) => /^confirmar\b/i.test(String(n))));
}

/** Persistence gate. transcript-final = call is done and still needs a person.
 *  validation-complete = catalog checks passed, staff have not accepted.
 *  staff-accepted = a human Square link is already on the ticket and the catalog check still passes.
 *  Unresolved validation never stays phase "final". Items are not dropped and this is not noOrder. */
export function gateTicketAcceptance(input: {
  requestedPhase?: string | null;
  autoAccepted?: boolean;
  validation?: "unresolved" | "clear" | "empty" | null;
  reviewReason?: string | null;
  statusCall?: boolean;
  cart?: any[] | null;
  squareRef?: unknown;
}): { phase: TicketPhase; acceptance: TicketAcceptance; autoAccepted: boolean; reviewReason: string | null } {
  if (input.statusCall || input.requestedPhase === "listening") {
    return { phase: "listening", acceptance: "transcript-final", autoAccepted: false, reviewReason: null };
  }
  const cart = Array.isArray(input.cart) ? input.cart : [];
  const validation = input.validation ?? (cart.length ? "unresolved" : "empty");
  const reason = input.reviewReason || (cartUnresolved(cart) ? "confirmar" : null);
  if (validation === "unresolved" || reason) {
    return { phase: "review", acceptance: "transcript-final", autoAccepted: false, reviewReason: reason || "confirmar" };
  }
  if (input.squareRef && validation === "clear") {
    return { phase: "final", acceptance: "staff-accepted", autoAccepted: !!input.autoAccepted, reviewReason: null };
  }
  if (validation === "clear") {
    return { phase: "final", acceptance: "validation-complete", autoAccepted: !!input.autoAccepted, reviewReason: null };
  }
  return { phase: "final", acceptance: "transcript-final", autoAccepted: false, reviewReason: null };
}

/** Read-only view of a shadow result. Persistence uses gateTicketAcceptance inside upsertTicket. */
export function ticketFromShadow(order: any): {
  phase: TicketPhase;
  acceptance: TicketAcceptance;
  autoAccepted: boolean;
  noOrder: boolean;
  existingOrderCall: boolean;
  statusCall: boolean;
  fulfillment: string | null;
  validation: "unresolved" | "clear" | "empty";
  reviewReason: string | null;
  complete: boolean;
  lineCount: number;
} {
  const cart = Array.isArray(order?.cart) ? order.cart : [];
  const validation = order?.validation || orderValidation(cart);
  const noOrder = !!order?.noOrder || (!cart.length && !!order?.statusCall);
  const gated = gateTicketAcceptance({
    requestedPhase: order?.statusCall ? "listening" : "final",
    autoAccepted: order?.autoAccepted,
    validation, reviewReason: order?.reviewReason, statusCall: !!order?.statusCall, cart, squareRef: order?.squareRef,
  });
  return {
    phase: gated.phase,
    acceptance: gated.acceptance,
    autoAccepted: gated.autoAccepted,
    noOrder,
    existingOrderCall: !!order?.existingOrderCall,
    statusCall: !!order?.statusCall,
    fulfillment: order?.fulfillment || null,
    validation,
    reviewReason: gated.reviewReason,
    complete: gated.acceptance === "validation-complete" || gated.acceptance === "staff-accepted",
    lineCount: cart.length,
  };
}
