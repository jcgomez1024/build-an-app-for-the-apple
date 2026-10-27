// ca39e2bb (CA39e2bba846b462690f85f8cab67c37c9 ~1:12 PM ET Oct 27): desk Spanish pickup ~30s.
// Auditor: Queso Torta bistec + Coca; caller said "con extra bistec" — miss: no extra-meat note.
// Wrong name: kitchen shout "gordo, Guillermo, una quesitorta" saved as order_name (caller is woman / mija).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ELVI_SIMULATED_NOW = "2026-10-27T13:12:00-04:00";
const { shadowOrderFromTurns } = await import("../../src/call-scoring.ts");
const { nameFromTranscriptInfo, nameFromStaffVocative } = await import("../../src/order-name.ts");
const { buildTicketLines } = await import("../../src/twilio.ts");
const turns = JSON.parse(readFileSync(new URL("../fixtures/CA39e2bb-turns.json", import.meta.url), "utf8"));
const TOR = "sq-torta-4GNTTE";
const COCA = "sq-drink-coca-cola-JJE4KC";

/** Live-ish stub: QTO bistec + coca (no extra note — scoring must stamp it). */
const stub = async (text: string) => {
  const t = text.toLowerCase();
  if (/torta|quesitorta|queso/.test(t) && /bistec|extra/.test(t)) {
    return {
      reply: "Torta: queso torta, bistec. ¿Algo más?",
      actions: [{
        type: "add_item", itemId: TOR, quantity: 1,
        modifiers: [
          { step: "(A) Torta Options", option: "(QTO) Queso Torta (+$0.50)" },
          { step: "(B) Torta Carne Options", option: "Bistec / Steak" },
          { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada", isDefault: true },
        ],
        readback: "1 queso torta bistec",
      }],
    };
  }
  if (/coca|mexicana|refresco/.test(t)) {
    return { reply: "Coca. ¿Algo más?", actions: [{ type: "add_item", itemId: COCA, quantity: 1, modifiers: [], readback: "1 coca" }] };
  }
  return { reply: "", actions: [] };
};

test("ca39e2bb: kitchen vocative Guillermo is not order name", () => {
  const voc = nameFromStaffVocative(turns as any);
  assert.equal(voc, null, "vocative must ignore kitchen shout, got: " + voc);
  const info = nameFromTranscriptInfo(turns as any);
  assert.ok(!info || !info.name, "no ticket/caller name from kitchen shout: " + JSON.stringify(info));
});

test("ca39e2bb: QTO bistec + coca + extra bistec note on ticket", async () => {
  const r: any = await shadowOrderFromTurns(turns as any, stub as any);
  const dump = JSON.stringify(r.cart.map((l: any) => ({
    id: l.itemId, q: l.quantity,
    mods: (l.modifiers || []).map((m: any) => m.option),
    notes: l.elviNotes,
  })));
  const tortas = r.cart.filter((l: any) => /^sq-torta-/i.test(String(l.itemId)));
  assert.equal(tortas.length, 1, "one torta: " + dump);
  assert.ok((tortas[0].modifiers || []).some((m: any) => /\(QTO\)/i.test(String(m.option))), "QTO: " + dump);
  assert.ok((tortas[0].modifiers || []).some((m: any) => /Bistec/i.test(String(m.option))), "bistec: " + dump);
  assert.ok((tortas[0].elviNotes || []).some((n: string) => /extra bistec/i.test(n)), "extra bistec note: " + dump);
  assert.ok(r.cart.some((l: any) => l.itemId === COCA), "coca: " + dump);

  const described = r.cart.map((l: any) => ({
    name: /^sq-torta-/i.test(l.itemId) ? "Torta" : "Coca Cola",
    quantity: l.quantity || 1,
    choices: (l.modifiers || []).map((m: any) => String(m.option)),
  }));
  const ticket = buildTicketLines(described, r.cart, [], "note", null, { attributed: true });
  const tortaLine = ticket.find((l: any) => /torta/i.test(l.name));
  assert.ok(tortaLine, "torta on ticket: " + JSON.stringify(ticket));
  assert.ok((tortaLine!.notes || []).some((n: string) => /extra bistec/i.test(n)),
    "ticket shows extra bistec: " + JSON.stringify(tortaLine));
});
