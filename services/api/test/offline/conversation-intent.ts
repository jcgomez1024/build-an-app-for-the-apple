// Bilingual multi-turn intent. Deterministic cart after every turn, plus a stub shadow
// that must not be the thing that fills the cart. The model is not called.
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { flagUnresolvedRequired, gateTicketAcceptance, recoveryAcceptance } from "../../src/offline-evidence.ts";

const MEAT = { name: "(B) Carnes", minSelections: 1, maxSelections: 1, options: ["Bistec / Steak", "Pollo / Chicken"] };
const taco = { id: "sq-taco", name: "Taco", nameEs: "Taco", aliases: ["tacos"], modifierGroups: [MEAT] };
const quesadilla = { id: "sq-quesadilla", name: "Quesadilla", nameEs: "Quesadilla", aliases: ["quesadillas"], modifierGroups: [MEAT] };
const horchata = { id: "sq-horchata", name: "Horchata", nameEs: "Horchata", aliases: ["agua de horchata"] };
const jamaica = { id: "sq-jamaica", name: "Jamaica", nameEs: "Agua de Jamaica", aliases: ["jamaica"] };
const mole = { id: "sq-mole", name: "Mole", nameEs: "Mole", soldOut: true };
const tacoComal = { id: "sq-taco-comal", name: "Taco Comal", nameEs: "Taco de Comal", aliases: ["tacos de comal"], modifierGroups: [MEAT] };
const tacoStreet = { id: "sq-taco-street", name: "Taco Taquero", nameEs: "Taco Taquero", aliases: ["tacos taqueros"], modifierGroups: [MEAT] };
const menu = [taco, quesadilla, horchata, jamaica, mole];
const twoTacos = [tacoComal, tacoStreet, horchata];

type Turn = { speaker: "caller" | "staff"; text: string; language?: "en" | "es" };
type Expect = { itemId: string; quantity: number; options?: string[] };

export type IntentCase = {
  id: string;
  provenance: "example-illustration" | "holdout";
  menu?: typeof menu;
  turns: Turn[];
  afterEach: Expect[][];
  validation?: "unresolved" | "clear" | "empty";
  modelCalls?: number;
};

const line = (itemId: string, quantity: number, options: string[] = []): Expect => ({ itemId, quantity, options });

export const CASES: IntentCase[] = [
  {
    id: "en-availability-then-two",
    provenance: "example-illustration",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
    ],
    afterEach: [[], [line("sq-horchata", 2)]],
  },
  {
    id: "es-availability-then-dame-dos",
    provenance: "example-illustration",
    turns: [
      { speaker: "caller", text: "¿Tienen quesadilla?", language: "es" },
      { speaker: "caller", text: "Dame dos.", language: "es" },
    ],
    afterEach: [[], [line("sq-quesadilla", 2)]],
    validation: "unresolved",
  },
  {
    id: "en-holdout-ill-take-two",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Got any jamaica?", language: "en" },
      { speaker: "caller", text: "I'll take two.", language: "en" },
    ],
    afterEach: [[], [line("sq-jamaica", 2)]],
  },
  {
    id: "es-holdout-ponme-dos",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "¿Hay agua de jamaica?", language: "es" },
      { speaker: "caller", text: "Ponme dos.", language: "es" },
    ],
    afterEach: [[], [line("sq-jamaica", 2)]],
  },
  {
    id: "en-replace-not-add",
    provenance: "example-illustration",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
      { speaker: "caller", text: "Better give me tacos.", language: "en" },
    ],
    afterEach: [[], [line("sq-horchata", 2)], [line("sq-horchata", 2)]],
  },
  {
    id: "es-mejor-dame-replaces",
    provenance: "example-illustration",
    turns: [
      { speaker: "caller", text: "¿Tienen quesadilla?", language: "es" },
      { speaker: "caller", text: "Dame dos.", language: "es" },
      { speaker: "caller", text: "Mejor dame tacos.", language: "es" },
    ],
    afterEach: [[], [line("sq-quesadilla", 2)], [line("sq-quesadilla", 2)]],
    validation: "unresolved",
  },
  {
    id: "en-replace-explicit-two",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
      { speaker: "caller", text: "Better give me two tacos.", language: "en" },
    ],
    afterEach: [[], [line("sq-horchata", 2)], [line("sq-taco", 2)]],
    validation: "unresolved",
  },
  {
    id: "es-replace-explicit-dos",
    provenance: "example-illustration",
    turns: [
      { speaker: "caller", text: "¿Tienen quesadilla?", language: "es" },
      { speaker: "caller", text: "Dame dos.", language: "es" },
      { speaker: "caller", text: "Mejor dame dos tacos.", language: "es" },
    ],
    afterEach: [[], [line("sq-quesadilla", 2)], [line("sq-taco", 2)]],
    validation: "unresolved",
  },
  {
    id: "en-replace-singular-one",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
      { speaker: "caller", text: "Better give me one taco.", language: "en" },
    ],
    afterEach: [[], [line("sq-horchata", 2)], [line("sq-taco", 1)]],
    validation: "unresolved",
  },
  {
    id: "es-replace-singular-un",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "¿Tienen quesadilla?", language: "es" },
      { speaker: "caller", text: "Dame dos.", language: "es" },
      { speaker: "caller", text: "Mejor dame un taco.", language: "es" },
    ],
    afterEach: [[], [line("sq-quesadilla", 2)], [line("sq-taco", 1)]],
    validation: "unresolved",
  },
  {
    id: "en-same-number-keeps-old-qty",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
      { speaker: "caller", text: "Better give me the same number of tacos.", language: "en" },
    ],
    afterEach: [[], [line("sq-horchata", 2)], [line("sq-taco", 2)]],
    validation: "unresolved",
  },
  {
    id: "es-mismos-keeps-old-qty",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "¿Tienen quesadilla?", language: "es" },
      { speaker: "caller", text: "Dame dos.", language: "es" },
      { speaker: "caller", text: "Mejor dame los mismos tacos.", language: "es" },
    ],
    afterEach: [[], [line("sq-quesadilla", 2)], [line("sq-taco", 2)]],
    validation: "unresolved",
  },
  {
    id: "es-holdout-mejor-quiero",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "¿Tienen quesadilla?", language: "es" },
      { speaker: "caller", text: "Dame dos.", language: "es" },
      { speaker: "caller", text: "Mejor quiero tacos.", language: "es" },
    ],
    afterEach: [[], [line("sq-quesadilla", 2)], [line("sq-quesadilla", 2)]],
  },
  {
    id: "en-and-two-adds",
    provenance: "example-illustration",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
      { speaker: "caller", text: "And two tacos.", language: "en" },
    ],
    afterEach: [[], [line("sq-horchata", 2)], [line("sq-horchata", 2), line("sq-taco", 2)]],
    validation: "unresolved",
  },
  {
    id: "es-y-dos-adds",
    provenance: "example-illustration",
    turns: [
      { speaker: "caller", text: "¿Hay agua de jamaica?", language: "es" },
      { speaker: "caller", text: "Ponme dos.", language: "es" },
      { speaker: "caller", text: "Y dos tacos.", language: "es" },
    ],
    afterEach: [[], [line("sq-jamaica", 2)], [line("sq-jamaica", 2), line("sq-taco", 2)]],
  },
  {
    id: "en-holdout-and-also",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "I'll take two.", language: "en" },
      { speaker: "caller", text: "And also two tacos.", language: "en" },
    ],
    afterEach: [[], [line("sq-horchata", 2)], [line("sq-horchata", 2), line("sq-taco", 2)]],
  },
  {
    id: "replace-two-targets-asks",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
      { speaker: "caller", text: "And two tacos.", language: "en" },
      { speaker: "caller", text: "Mejor dame tacos.", language: "es" },
    ],
    afterEach: [
      [],
      [line("sq-horchata", 2)],
      [line("sq-horchata", 2), line("sq-taco", 2)],
      [line("sq-horchata", 2), line("sq-taco", 2)],
    ],
  },
  {
    id: "two-discussed-dishes-ask",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Do you have horchata or jamaica?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
    ],
    afterEach: [[], []],
  },
  {
    id: "two-taco-kinds-ask",
    provenance: "holdout",
    menu: twoTacos as typeof menu,
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
      { speaker: "caller", text: "Y dos tacos.", language: "es" },
    ],
    afterEach: [[], [line("sq-horchata", 2)], [line("sq-horchata", 2)]],
  },
  {
    id: "unclear-quantity-asks",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me a couple.", language: "en" },
    ],
    afterEach: [[], []],
  },
  {
    id: "named-option-kept-unknown-option-not-invented",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Y dos tacos de bistec.", language: "es" },
      { speaker: "caller", text: "And two tacos.", language: "en" },
    ],
    afterEach: [[line("sq-taco", 2, ["Bistec / Steak"])], [line("sq-taco", 2, ["Bistec / Steak"]), line("sq-taco", 2)]],
  },
  {
    id: "sold-out-not-added",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Do you have mole?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
    ],
    afterEach: [[], []],
  },
  {
    id: "staff-decline-blocks-accept",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "¿Tienen mole?", language: "es" },
      { speaker: "staff", text: "No, hoy no hay mole.", language: "es" },
      { speaker: "caller", text: "Dame dos.", language: "es" },
    ],
    afterEach: [[], [], []],
  },
  {
    id: "unknown-item-does-not-replace",
    provenance: "holdout",
    turns: [
      { speaker: "caller", text: "Do you have horchata?", language: "en" },
      { speaker: "caller", text: "Give me two.", language: "en" },
      { speaker: "caller", text: "Mejor dame pizza.", language: "es" },
    ],
    afterEach: [[], [line("sq-horchata", 2)], [line("sq-horchata", 2)]],
  },
];

function view(cart: any[]): Expect[] {
  return (cart || []).map((line) => ({ itemId: line.itemId, quantity: Number(line.quantity) || 1, options: (line.modifiers || []).map((modifier: any) => modifier.option) }));
}

function same(actual: any[], expected: Expect[]): boolean {
  if (actual.length !== expected.length) return false;
  return expected.every((line, i) => {
    const got = actual[i];
    const options = (got.modifiers || []).map((m: any) => m.option);
    return got.itemId === line.itemId && got.quantity === line.quantity && JSON.stringify(options) === JSON.stringify(line.options || []);
  });
}

export async function shadowPrefix(turns: Turn[], useMenu = menu): Promise<{ cart: any[]; calls: number; validation: string; steps: any[] }> {
  let calls = 0;
  const run: any = async () => { calls += 1; return { actions: [], reply: "" }; };
  run.menu = () => useMenu;
  const order = await shadowOrderFromTurns(turns.map((turn, index) => ({
    speaker: turn.speaker, text: turn.text, language: turn.language || "es", start: index, end: index + 1,
  })), run);
  return { cart: order.cart || [], calls, validation: order.validation || "", steps: order.steps || [] };
}

export async function intentChecks(): Promise<Array<{ id: string; layer: string; ok: boolean; detail: string }>> {
  const out: Array<{ id: string; layer: string; ok: boolean; detail: string }> = [];
  let examples = "";
  try {
    const file = JSON.parse(readFileSync(new URL("../../data/conversation-intent.json", import.meta.url), "utf8"));
    examples = (file.examples || []).flatMap((example: { lines: string[] }) => example.lines).join("\n");
  } catch { examples = ""; }
  const holdouts = ["I'll take two", "Ponme dos", "Mejor quiero", "And also two", "Give me a couple", "pizza", "one taco", "un taco", "same number", "los mismos"];
  out.push({
    id: "holdout-phrases-are-not-memorized-examples",
    layer: "plumbing",
    ok: !!examples && holdouts.every((phrase) => !examples.includes(phrase)),
    detail: examples ? (holdouts.filter((phrase) => examples.includes(phrase)).join(",") || "absent from the illustrations") : "conversation-intent.json missing",
  });
  const elvi = await import("../../src/elvi.ts").catch(() => null) as any;
  const orderingInstructions = elvi?.orderingInstructions as undefined | ((language: "es", menu: any[], history: any[]) => string);
  const instructions = orderingInstructions ? orderingInstructions("es", menu as any, []) : "";
  out.push({
    id: "instructions-load-the-versioned-examples",
    layer: "plumbing",
    ok: instructions.includes("CONVERSATION_INTENT_V1") && instructions.includes("Give me two.") && instructions.includes("Dame dos.") && instructions.includes("Mejor dame tacos.") && instructions.includes("And two tacos.") && instructions.includes("Y dos tacos."),
    detail: instructions.includes("CONVERSATION_INTENT_V1") ? "marker present" : "marker missing",
  });
  const intentMod = await import("../../src/conversation-intent.ts").catch(() => null) as any;
  for (const item of CASES) {
    const useMenu = item.menu || menu;
    const expected = item.afterEach.map(view);
    let reducer: any[][] = [];
    let reducerFailed = "";
    if (!intentMod?.resolveConversationIntent) reducerFailed = "resolveConversationIntent missing";
    else {
      let cart: any[] = [];
      const history: Array<{ role: string; text: string }> = [];
      const staffTexts: string[] = [];
      for (let i = 0; i < item.turns.length; i++) {
        const turn = item.turns[i];
        if (turn.speaker === "staff") {
          staffTexts.push(turn.text);
          reducer.push(view(cart));
          if (!same(cart, item.afterEach[i])) reducerFailed = `turn ${i + 1} staff cart ${JSON.stringify(view(cart))}`;
          continue;
        }
        const decision = intentMod.resolveConversationIntent({
          transcript: turn.text, language: turn.language || "es", menu: useMenu, history, cart, staffTexts,
        });
        if (decision?.actions) cart = intentMod.applyIntentCart(cart, decision.actions);
        history.push({ role: "customer", text: turn.text });
        if (decision?.reply) history.push({ role: "assistant", text: decision.reply });
        reducer.push(view(cart));
        if (!reducerFailed && !same(cart, item.afterEach[i])) reducerFailed = `turn ${i + 1} cart ${JSON.stringify(view(cart))}`;
      }
      if (!reducerFailed && item.validation) {
        const copy = cart.map((line) => ({ ...line, modifiers: [...(line.modifiers || [])] }));
        flagUnresolvedRequired(copy, useMenu as any, "ok");
        const open = copy.some((line) => line.validation === "unresolved");
        if (item.validation === "unresolved" && !open) reducerFailed = "required choice was treated as clear";
      }
    }
    const shadowCarts: any[][] = [];
    let shadowFailed = "";
    for (let i = 0; i < item.turns.length; i++) {
      const shadow = await shadowPrefix(item.turns.slice(0, i + 1), useMenu);
      shadowCarts.push(view(shadow.cart));
      if (!shadowFailed && !same(shadow.cart, item.afterEach[i])) shadowFailed = `turn ${i + 1} cart ${JSON.stringify(view(shadow.cart))}`;
    }
    const ok = !reducerFailed && !shadowFailed;
    out.push({
      id: item.id,
      layer: "case",
      provenance: item.provenance,
      ok,
      expected,
      reducer,
      shadow: shadowCarts,
      detail: ok ? item.provenance : `reducer: ${reducerFailed || "ok"}; shadow: ${shadowFailed || "ok"}`,
    });
  }
  const openCart = [{ itemId: "sq-taco", quantity: 2, modifiers: [] }];
  flagUnresolvedRequired(openCart, menu as any, "ok");
  const gated = gateTicketAcceptance({ requestedPhase: "final", autoAccepted: true, validation: "unresolved", cart: openCart });
  out.push({
    id: "unresolved-choice-stays-review",
    layer: "acceptance",
    ok: gated.phase === "review" && gated.acceptance === "transcript-final" && gated.autoAccepted === false,
    detail: `${gated.phase}/${gated.acceptance}`,
  });
  const savedKey = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  let appDetail = "";
  try {
    if (!elvi?.chatWithElvi) throw new Error("chatWithElvi missing");
    const app = await elvi.chatWithElvi({
      transcript: "Give me two.",
      language: "en",
      menu: menu as any,
      history: [{ role: "customer", text: "Do you have horchata?" }, { role: "assistant", text: "Yes." }],
    });
    const add = (app.actions || []).find((action) => action.type === "add_item") as any;
    appDetail = `${add?.itemId || "none"} x${add?.quantity}`;
    out.push({
      id: "app-path-resolves-without-calling-the-model",
      layer: "plumbing",
      ok: add?.itemId === "sq-horchata" && add?.quantity === 2 && (add.modifiers || []).length === 0,
      detail: appDetail,
    });
  } catch (err) {
    out.push({ id: "app-path-resolves-without-calling-the-model", layer: "plumbing", ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
  if (savedKey) process.env.XAI_API_KEY = savedKey;
  const recovered = recoveryAcceptance(null);
  out.push({
    id: "recovery-missing-order-stays-review",
    layer: "acceptance",
    ok: recovered.phase === "review" && recovered.acceptance === "transcript-final",
    detail: `${recovered.phase}/${recovered.acceptance}`,
  });
  out.push({
    id: "model-example-evaluation",
    layer: "model",
    ok: true,
    detail: "unverified: no model call. Needs XAI_API_KEY and a paid realtime turn that returns tool-call cart lines. Stub passes do not verify the model.",
  });
  return out;
}
