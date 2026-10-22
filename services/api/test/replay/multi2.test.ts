import test from "node:test"; import assert from "node:assert/strict";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
// scripted Elvi: nachos need meat then toppings; esquite needs Tajín/no; tacos add directly
function stub() {
  let pend: any = null;
  return async (t: string) => {
    const x = t.toLowerCase();
    if (pend?.k === "nachos" && !pend.meat && /bistec/.test(x)) { pend.meat = 1; return { reply: "Nachos Elvis: ¿Frijoles, Lechuga, Pico de Gallo o Crema?", actions: [] }; }
    if (pend?.k === "nachos" && pend.meat && /frijoles|lechuga|pico|crema/.test(x)) { pend = null; return { reply: "Listo. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-nachos-elvis-N1", quantity: 1, modifiers: [{ step: "T", option: x.includes("pico") ? "ALL" : "SOME" }] }] }; }
    if ((pend?.k === "esq" || /esquite/.test(x)) && /tajin/.test(x)) { pend = null; return { reply: "Listo. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-esquite-elvis-E1", quantity: 1, modifiers: [] }] }; }
    if (pend?.k === "esq" && /así está bien/.test(x)) { pend = null; return { reply: "Muy bien. ¿Algo más?", actions: [] }; }
    if (pend && /así está bien/.test(x)) return { reply: pend.q, actions: [] };
    if (/nachos/.test(x)) { pend = { k: "nachos", q: "Nachos Elvis: ¿Bistec, Cabeza, Carnitas o Chorizo?" }; return { reply: pend.q, actions: [] }; }
    if (/esquite/.test(x)) { pend = { k: "esq", q: "Esquite Elvis: ¿Tajin o NO TAJIN?" }; return { reply: pend.q, actions: [] }; }
    if (pend) return { reply: pend.q, actions: [] };
    const m = /(dos|un[oa]?)\s+tacos?\s+taqueros?\s+de\s+(\p{L}+)/u.exec(x);
    if (m) return { reply: "Listo. ¿Algo más?", actions: [{ type: "add_item", itemId: "sq-taco-T1", quantity: m[1] === "dos" ? 2 : 1, modifiers: [{ step: "M", option: m[2] }] }] };
    return { reply: "¿Algo más?", actions: [] };
  };
}
test("multi2: second person's order after 'para [nombre]': bare meat + 'con todo' close the open question, later dishes still added, tagged by person", async () => {
  const turns: any[] = [
    { speaker: "caller", text: "Dos tacos taqueros de bistec.", language: "es" },
    { speaker: "staff", text: "Okay, ¿algo más?" },
    { speaker: "caller", text: "Y aparte, para Juana es una porción de nachos.", language: "es" },
    { speaker: "staff", text: "Permíteme." },
    { speaker: "caller", text: "Bistec.", language: "es" },
    { speaker: "staff", text: "Unos nachos de bistec, ajá, frijoles, lechuga." },
    { speaker: "caller", text: "Eso es, sí, con todo.", language: "es" },
    { speaker: "staff", text: "¿Qué más?" },
    { speaker: "caller", text: "Y un esquite, por favor.", language: "es" },
    { speaker: "staff", text: "Ajá." },
    { speaker: "caller", text: "Y dos tacos de qué? Deshebrada. Deshebrada. Dos tacos taqueros de deshebrada.", language: "es" },
  ];
  const r: any = await shadowOrderFromTurns(turns, stub() as any);
  const got = r.cart.map((l: any) => `${l.quantity}×${l.itemId.split("-")[1]}${l.person ? "@" + l.person : ""}`);
  assert.ok(got.includes("2×taco"), got.join(","));
  assert.ok(got.includes("1×nachos@Juana"), got.join(","));
  assert.ok(got.includes("1×esquite@Juana"), got.join(","));
  assert.ok(got.some((g: string) => /^2×taco@Juana/.test(g)), got.join(","));
  assert.equal(r.cart.find((l: any) => l.itemId.includes("nachos")).modifiers[0].option, "ALL", "'con todo' = every topping offered");
  assert.deepEqual(r.groups, ["Juana"]);
});
