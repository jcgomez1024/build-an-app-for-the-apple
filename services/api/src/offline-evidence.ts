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

type Group = { name?: string; minSelections?: number; min?: number; options?: any[]; defaultOptions?: string[] };
type MenuItem = { id?: string; modifierGroups?: Group[] };

function groupMin(g: Group): number {
  const n = Number(g?.minSelections ?? g?.min ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function optionName(o: any): string {
  return typeof o === "string" ? o : String(o?.name || "");
}

/** A required catalog group with no selection is a visible staff note. No option is invented. */
export function flagUnresolvedRequired(cart: any[], menu: MenuItem[] | null | undefined): boolean {
  if (!Array.isArray(cart) || !Array.isArray(menu) || !menu.length) return false;
  let changed = false;
  for (const line of cart) {
    const item = menu.find((m) => m?.id === line?.itemId);
    if (!item) continue;
    const notes: string[] = Array.isArray(line.elviNotes) ? line.elviNotes : [];
    for (const g of item.modifierGroups || []) {
      if (groupMin(g) < 1 || !g?.name) continue;
      const chosen = (line.modifiers || []).filter((m: any) => m?.step === g.name);
      if (chosen.length >= groupMin(g)) continue;
      const marker = `confirmar ${g.name}`;
      if (!notes.some((n) => n === marker)) { notes.push(marker); changed = true; }
      line.validation = "unresolved";
    }
    if (notes.length) line.elviNotes = notes;
  }
  return changed;
}

export function orderValidation(cart: any[]): "unresolved" | "clear" | "empty" {
  if (!Array.isArray(cart) || !cart.length) return "empty";
  const open = cart.some((l) => l?.validation === "unresolved" || (l?.elviNotes || []).some((n: string) => /^confirmar\b/i.test(String(n))));
  return open ? "unresolved" : "clear";
}

/** Same ticket fields the listen-only path already uses, plus the validation flag. No network. */
export function ticketFromShadow(order: any): {
  phase: "listening" | "final";
  autoAccepted: boolean;
  noOrder: boolean;
  existingOrderCall: boolean;
  statusCall: boolean;
  fulfillment: string | null;
  validation: "unresolved" | "clear" | "empty";
  complete: boolean;
  lineCount: number;
} {
  const cart = Array.isArray(order?.cart) ? order.cart : [];
  const validation = order?.validation || orderValidation(cart);
  const noOrder = !!order?.noOrder || (!cart.length && !!order?.statusCall);
  const autoAccepted = !!order?.autoAccepted && validation !== "unresolved";
  const phase = order?.statusCall ? "listening" : "final";
  return {
    phase,
    autoAccepted,
    noOrder,
    existingOrderCall: !!order?.existingOrderCall,
    statusCall: !!order?.statusCall,
    fulfillment: order?.fulfillment || null,
    validation,
    complete: phase === "final" && autoAccepted && validation !== "unresolved" && !noOrder && cart.length > 0,
    lineCount: cart.length,
  };
}
