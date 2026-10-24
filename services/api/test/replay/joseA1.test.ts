// joseA1: CA3e6d74ea78b330c083588dc10ae084e9 — Sat Oct 24 ~2:33 PM ET
// 3× torta bistec con chorizo + horchata 32oz. Name José Acevedo volunteered.
// "Sí, no se preocupe" is reassure ≠ order. Address confirmed when set_address ran.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromAnswer, nameFromTranscriptInfo } from "../../src/order-name.ts";
import { shadowOrderFromTurns, kindOfItem } from "../../src/call-scoring.ts";
import { applySharedAliases } from "../../src/aliases.ts";

const TOR = "sq-torta-4GNTTE";
const HOR = "sq-drink-agua-fresca-horchata-32oz";

test("joseA1: Es José Acevedo saves full name without staff ask", () => {
  assert.equal(nameFromAnswer("Es José Acevedo."), "José Acevedo");
  assert.equal(nameFromAnswer("Es José Acevedo"), "José Acevedo");
  const turns = [
    { speaker: "caller" as const, text: "Eh, serían tres tortas, eh, de bistec con chorizo." },
    { speaker: "caller" as const, text: "127 Morse, Morse Avenue. Sí. Sí. Es José Acevedo." },
    { speaker: "staff" as const, text: "Gracias, José." },
  ];
  const info = nameFromTranscriptInfo(turns);
  assert.equal(info?.name, "José Acevedo");
  assert.equal(info?.thirdPerson, false);
});

test("joseA1: shadow — 3 tortas bistec+chorizo + horchata; no-preocupe is not an order; addressConfirmed", async () => {
  let n = 0;
  const run = async (t: string) => {
    const s = applySharedAliases(t, "phone");
    n++;
    const acts: any[] = [];
    // Live bug: split into 1 bistec + 2 chorizo (=qty 2), then another on "Sí, no se preocupe"
    if (/torta/i.test(s) && /bistec|chorizo/i.test(s)) {
      acts.push({ type: "add_item", itemId: TOR, quantity: 1, modifiers: [{ option: "(TO) Torta" }, { option: "Bistec / Steak" }] });
      acts.push({ type: "add_item", itemId: TOR, quantity: 2, modifiers: [{ option: "(TO) Torta" }, { option: "Chorizo / Mexican Sausage" }] });
    } else if (/preocupe|preocup/i.test(s)) {
      acts.push({ type: "add_item", itemId: TOR, quantity: 1, modifiers: [{ option: "(TO) Torta" }, { option: "Bistec / Steak" }] });
    }
    if (/horchata/i.test(s)) {
      acts.push({ type: "add_item", itemId: HOR, quantity: 1, modifiers: [] });
    }
    if (/morse|127/i.test(s)) {
      acts.push({ type: "set_address", address: "127 Morse Avenue" });
      acts.push({ type: "set_fulfillment", fulfillment: "DELIVERY" });
    }
    return { reply: "OK", actions: acts };
  };
  const turns = [
    { speaker: "caller", text: "quiero hacer un pedido a domicilio, por favor.", language: "es" },
    { speaker: "staff", text: "Ah, sí, claro, dígame.", language: "es" },
    { speaker: "caller", text: "Eh, son tres tortas.", language: "es" },
    { speaker: "staff", text: "¿Qué te voy a dar?", language: "es" },
    { speaker: "caller", text: "Eh, serían tres tortas, eh, de bistec con chorizo.", language: "es" },
    { speaker: "staff", text: "Muy bien. Pero me, ¿me permites poquito?", language: "es" },
    { speaker: "caller", text: "Sí, no se preocupe.", language: "es" },
    { speaker: "staff", text: "A ver, serían tres tortas de bistec con chorizo, ¿algo más?", language: "es" },
    { speaker: "caller", text: "Eh, ¿me trae un agua, por favor?", language: "es" },
    { speaker: "caller", text: "127 Morse, Morse Avenue. Sí. Sí. Es José Acevedo.", language: "es" },
    { speaker: "caller", text: "Me la pone de horchata, por favor.", language: "es" },
    { speaker: "caller", text: "Sí, está bien. Sí.", language: "es" },
  ].map((t, i) => ({ ...t, start: i, end: i + 1, speaker: t.speaker as "caller" | "staff" }));

  const r: any = await shadowOrderFromTurns(turns as any, run as any);
  const tortas = r.cart.filter((l: any) => kindOfItem(l.itemId) === "torta" || /torta/i.test(l.itemId));
  const tQty = tortas.reduce((n: number, l: any) => n + (Number(l.quantity) || 1), 0);
  assert.equal(tQty, 3, `torta qty ${tQty}: ${JSON.stringify(r.cart)}`);
  // each (or the merged line) should carry both meats
  const allOpts = tortas.flatMap((l: any) => (l.modifiers || []).map((m: any) => String(m.option))).join("; ");
  assert.match(allOpts, /bistec/i, allOpts);
  assert.match(allOpts, /chorizo/i, allOpts);
  assert.ok(r.cart.some((l: any) => /horchata/i.test(l.itemId)), JSON.stringify(r.cart));
  assert.ok(r.addressConfirmed === true, `addressConfirmed=${r.addressConfirmed} address=${r.address}`);
  assert.ok(r.address && /morse/i.test(String(r.address)), `address=${r.address}`);
  assert.equal(nameFromTranscriptInfo(turns as any)?.name, "José Acevedo");
});
